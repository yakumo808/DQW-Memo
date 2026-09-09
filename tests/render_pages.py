"""Isolated real MP4 page timing and layout regression."""
import importlib.util, unittest, tempfile, subprocess, json
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('renderer',Path(__file__).resolve().parents[1]/'server/render_server.py')
s=importlib.util.module_from_spec(spec);spec.loader.exec_module(s)
class Pages(unittest.TestCase):
    def test_layout(self):
        self.assertEqual(s.page_layouts('title','short'),[s.text_layout('title','short')])
        for n in (1,2,6):
            self.assertEqual(len(s.page_layouts('title','\n--- page ---\n'.join(['本文']*n))),n)
        with self.assertRaisesRegex(ValueError,'6ページ'):
            s.page_layouts('', '\n--- page ---\n'.join(['a']*7))
        lines=['行'+str(i) for i in range(100)]
        pages=s.page_layouts('title','\n'.join(lines))
        self.assertGreater(len(pages),6)
        self.assertEqual([r[0] for p in pages for r in p[1:]],lines)
        self.assertEqual(len(s.page_layouts('title','\n'.join(lines)+'\n--- page ---\n終わり')),len(pages)+1)
        self.assertTrue(all(y+size+6<=336 for page in pages for _,size,y in page))
        text='日本語の長文です。'*100
        self.assertEqual(''.join(r[0] for page in s.page_layouts('',text) for r in page),text)
    def test_render(self):
        root=Path(tempfile.mkdtemp(prefix='dqw-pages-'));print(root)
        probe=str(Path(s.FFMPEG).with_name('ffprobe.exe'))
        with patch.object(s,'JOBS_DIR',root):
            for seconds in (2,3,4,5):
                r=s.render_job('攻略','先頭ページ\n--- page ---\n次のページ',seconds)
                self.assertEqual((r['pageCount'],r['duration']),(2,seconds*2))
                info=json.loads(subprocess.check_output([probe,'-v','error','-show_streams','-of','json',r['outputMp4']]))
                v=next(x for x in info['streams'] if x['codec_type']=='video')
                self.assertEqual(int(v['nb_frames']),seconds*2*30)
                self.assertEqual((v['width'],v['height'],v['pix_fmt'],v['profile']),(640,360,'yuv420p','High'))
                def frame(t):
                    return subprocess.check_output([s.FFMPEG,'-v','error','-ss',str(t),'-i',r['outputMp4'],'-frames:v','1','-pix_fmt','gray','-f','rawvideo','-'])
                a,b,c,d=frame(.5),frame(seconds-.5),frame(seconds+.5),frame(seconds*2-.5)
                delta=lambda x,y:sum(abs(i-j) for i,j in zip(x,y))/len(x)
                self.assertLess(delta(a,b),.5) # Lossy H.264 may vary between identical source frames.
                self.assertLess(delta(c,d),.5)
                self.assertGreater(delta(a,c),max(delta(a,b)*3,.1))
            for body in ['短文','\n--- page ---\n'.join(['短文']*6),'\n'.join(['長文']*60)]:
                r=s.render_job('',body,2)
                self.assertEqual(r['duration'],r['pageCount']*2)
if __name__=='__main__':unittest.main(verbosity=2)
