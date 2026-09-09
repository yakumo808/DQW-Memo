"""Run with Python 3.12+: python -B tests/render_job_cleanup.py."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest.mock import patch, Mock
from urllib.request import Request, urlopen
from urllib.error import HTTPError

spec = importlib.util.spec_from_file_location('render_server', Path(__file__).resolve().parents[1] / 'server/render_server.py')
s = importlib.util.module_from_spec(spec)
spec.loader.exec_module(s)

class CleanupTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='dqw-cleanup-')
        self.root = Path(self.tmp.name).resolve()
        self.override = patch.object(s, 'JOBS_DIR', self.root)
        self.override.start()
        s.ACTIVE_JOBS.clear()

    def tearDown(self):
        self.override.stop()
        self.tmp.cleanup()

    def job(self, n, old=True):
        p = self.root / f'20260906-120000-{n:012x}'
        p.mkdir()
        for name in ('input.txt', 'generated.mp4', 'ffmpeg.log'):
            (p / name).write_bytes(b'test')
        stamp = time.time() - (s.RENDER_JOB_TTL_SECONDS + 60 if old else 0)
        os.utime(p, (stamp, stamp))
        return p

    def test_empty(self):
        s.cleanup_jobs()
        self.assertEqual(list(self.root.iterdir()), [])

    def test_old_only(self):
        old = self.job(1); recent = self.job(2, False); old2 = self.job(3)
        s.cleanup_jobs()
        self.assertFalse(old.exists()); self.assertFalse(old2.exists()); self.assertTrue(recent.exists())

    def test_active(self):
        p = self.job(1)
        s.ACTIVE_JOBS.add(p.name); s.cleanup_jobs(); self.assertTrue(p.exists())
        s.ACTIVE_JOBS.remove(p.name); s.cleanup_jobs(); self.assertFalse(p.exists())

    def test_completion_retention_and_failure_release(self):
        p = self.job(1)
        with self.assertRaises(RuntimeError):
            with s.active_job(p.name):
                s.cleanup_jobs(); self.assertTrue(p.exists())
                raise RuntimeError('render failed')
        self.assertFalse(s.ACTIVE_JOBS)
        s.cleanup_jobs(); self.assertTrue(p.exists())

    def test_delete_errors_continue(self):
        for error in (PermissionError('busy'), FileNotFoundError('gone')):
            with self.subTest(error=error):
                p = self.job(1); q = self.job(2)
                original = s.shutil.rmtree
                def remove(path):
                    if path == p: raise error
                    original(path)
                with patch.object(s.shutil, 'rmtree', side_effect=remove): s.cleanup_jobs()
                self.assertTrue(p.exists()); self.assertFalse(q.exists())
                original(p)

    def test_enumeration_failure(self):
        with patch.object(Path, 'iterdir', side_effect=PermissionError('denied')): s.cleanup_jobs()

    def test_unknown_directory_preserved(self):
        p = self.root / 'keep'; p.mkdir(); os.utime(p, (0, 0))
        s.cleanup_jobs(); self.assertTrue(p.exists())

    def test_parallel_active_job(self):
        p = self.job(1)
        entered = threading.Event(); release = threading.Event()
        def rendering():
            with s.active_job(p.name):
                entered.set(); release.wait(5)
        worker = threading.Thread(target=rendering)
        worker.start()
        try:
            self.assertTrue(entered.wait(5))
            s.cleanup_jobs(); self.assertTrue(p.exists())
        finally:
            release.set(); worker.join()
        self.assertFalse(s.ACTIVE_JOBS)

    def test_disappeared_after_listing(self):
        p = self.job(1)
        original = s.shutil.rmtree
        def vanished(path):
            original(path)
            raise FileNotFoundError('removed concurrently')
        with patch.object(s.shutil, 'rmtree', side_effect=vanished): s.cleanup_jobs()
        self.assertFalse(p.exists())

    def test_junction_excluded(self):
        p = self.job(1)
        with patch.object(Path, 'is_junction', return_value=True): s.cleanup_jobs()
        self.assertTrue(p.exists())

    def test_startup_cleanup(self):
        p = self.job(1)
        server = Mock(); server.serve_forever.side_effect = KeyboardInterrupt
        with patch.object(s, 'ThreadingHTTPServer', return_value=server), patch('sys.argv', ['server']):
            self.assertEqual(s.main(), 0)
        self.assertFalse(p.exists())

    def test_http_render_download_and_cleanup_failure(self):
        server = s.ThreadingHTTPServer(('127.0.0.1', 0), s.RenderHandler)
        worker = threading.Thread(target=server.serve_forever, daemon=True); worker.start()
        base = f'http://127.0.0.1:{server.server_port}'
        old = self.job(1)
        commands = []
        original_run = s.subprocess.run
        def run(cmd, **kwargs):
            commands.append(cmd)
            return original_run(cmd, **kwargs)
        try:
            # Actual ffmpeg and HTTP API; deletion failure must not affect success.
            with patch.object(s.shutil, 'rmtree', side_effect=PermissionError('injected busy')), patch.object(s.subprocess, 'run', side_effect=run):
                req = Request(base + '/api/render', data=json.dumps({'title':'テスト', 'content':'一行目\n二行目'}).encode(), headers={'Content-Type':'application/json'})
                with urlopen(req) as response: result = json.load(response)
            self.assertEqual(set(result), {'ok','jobId','jobDir','inputTxt','outputMp4','videoUrl','width','height','duration','mimeType','pageCount','pageSeconds'})
            self.assertTrue(result['ok']); self.assertTrue(old.exists())
            with urlopen(base + result['videoUrl']) as response:
                data = response.read(); self.assertIn(b'ftyp', data[:32]); self.assertEqual(response.headers['Content-Type'], 'video/mp4')
            self.assertEqual(data, Path(result['outputMp4']).read_bytes())
            cmd = commands[0]
            for flag, value in [('-c:v','libx264'),('-profile:v','high'),('-pix_fmt','yuv420p'),('-c:a','aac'),('-movflags','+faststart')]:
                self.assertEqual(cmd[cmd.index(flag)+1], value)
            self.assertIn('color=c=0x1f2937:s=640x360:r=30:d=3', cmd)
            self.assertIn('anullsrc=r=48000:cl=stereo', cmd)
            # Next render request performs cleanup, without changing API shape.
            with urlopen(req) as response: self.assertTrue(json.load(response)['ok'])
            self.assertFalse(old.exists())
            with self.assertRaises(HTTPError) as error: urlopen(base + '/videos/' + old.name + '.mp4')
            self.assertEqual(error.exception.code, 404)
        finally:
            server.shutdown(); server.server_close(); worker.join()

if __name__ == '__main__':
    unittest.main(verbosity=2)
