"""python -B tests/render_text_layout.py; real renders require FFMPEG and font."""
import importlib.util
from pathlib import Path
import os
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('renderer', Path(__file__).resolve().parents[1] / 'server/render_server.py')
s = importlib.util.module_from_spec(spec); spec.loader.exec_module(s)

class LayoutTests(unittest.TestCase):
    def test_short(self):
        rows = s.text_layout('テスト', '一行目\n二行目')
        self.assertEqual([r[0] for r in rows], ['テスト','一行目','二行目'])
        self.assertTrue(all(r[1] == 28 for r in rows))

    def test_wrap_preserves_text(self):
        value = '攻撃前に回復。耐性を確認して「まもりのたて」を使う。' * 10
        lines = s.wrap_text(value, 21)
        self.assertEqual(''.join(lines), value)
        self.assertTrue(all(len(line) <= 21 for line in lines))

    def test_explicit_newlines(self):
        self.assertEqual(s.wrap_text('あ\r\n\r\nか\rさ',21), ['あ','','か','さ'])
        self.assertEqual(s.wrap_text('か\u3099',21), ['か\u3099'])

    def test_long_bounded(self):
        rows = s.text_layout('攻略' * 100, '回復優先。' * 1000)
        self.assertTrue(rows[1][0].endswith('…'))
        self.assertTrue(rows[-1][0].endswith('…'))
        self.assertEqual(rows[-1][1], 20)
        self.assertTrue(all(y + size + 6 <= 336 for _,size,y in rows))
        self.assertTrue(all(len(text) * size <= s.TEXT_WIDTH for text,size,_ in rows))

    def test_empty(self):
        self.assertTrue(all(not text for text,_,_ in s.text_layout('', '')))

    def test_real_renders(self):
        # Retain isolated artifacts for visual inspection, never touch actual jobs.
        root = Path(tempfile.mkdtemp(prefix='dqw-layout-'))
        print('LAYOUT_ARTIFACTS=' + str(root), flush=True)
        ffprobe = str(Path(s.FFMPEG).with_name('ffprobe.exe'))
        cases = {
            'short': ('テスト', '一行目\n二行目\n三行目'),
            'medium': ('強敵攻略メモ', '開幕は全員まもりのたて。回復役は毎ターン回復を優先する。\n敵の予兆が出たら防御し、次のターンに攻撃。\n炎耐性を上げて、状態異常の解除アイテムも用意する。'),
            'long': ('高難度クエストの準備と立ち回り', '敵の攻撃に備えて耐性装備を用意する。回復役のMPを確認し、危険なターンは防御する。' * 15),
            'newlines': ('行間と記号の確認', '準備：炎耐性アップ\n\n・回復を優先\n・予兆の次は防御\nHP 50% / MP 100%\n%{localtime} はそのまま表示'),
        }
        import json
        with patch.object(s, 'JOBS_DIR', root):
            for name,(title,body) in cases.items():
                result = s.render_job(title,body)
                self.assertEqual(Path(result['inputTxt']).read_text(encoding='utf-8'),title+'\n\n'+body)
                movie = result['outputMp4']
                subprocess.run([s.FFMPEG,'-v','error','-i',movie,'-frames:v','1',str(root/(name+'.png'))],check=True)
                info = json.loads(subprocess.check_output([ffprobe,'-v','error','-show_streams','-of','json',movie]))
                video = next(x for x in info['streams'] if x['codec_type']=='video')
                audio = next(x for x in info['streams'] if x['codec_type']=='audio')
                self.assertEqual((video['width'],video['height'],video['pix_fmt'],video['profile'],video['r_frame_rate']), (640,360,'yuv420p','High','30/1'))
                self.assertEqual(audio['codec_name'],'aac')
                raw=Path(movie).read_bytes(); self.assertLess(raw.index(b'moov'),raw.index(b'mdat'))

if __name__ == '__main__': unittest.main(verbosity=2)
