# IndexedDB障害時のBlob直接利用

2026-09-06

## 目的

renderとMP4取得に成功している場合、IndexedDB保存・再取得の失敗が動画準備とPiPまで阻害しないようにする。今回はキャッシュ障害時のフォールバックのみを変更する。

## 原因

現コードを再確認した。MISS時はrender API→MP4 Blob取得→IndexedDB put→get→再取得BlobのObject URL化という順序だった。put失敗をログに残してもgetを必須としており、getの例外・null・無効Blobで全体が失敗した。最初に取得した正常Blobを使う経路がなかった。

## 修正内容

変更ファイル：

- `app/js/app.js`
- `tests/video-cache-fallback.cjs`（新規）
- `docs/devlog/2026-09-06-video-cache-fallback.md`（本記録）

保存結果と動画準備結果を分離し、保存に成功した場合だけ再読込を試みる。put失敗時は再読込を省略し、保持中のBlobを既存の `loadBlobIntoVideo` に渡す。保存後のgetが例外・null・無効Blobなら、エントリ削除を試みた後、同じ保持中Blobを利用する。

初回キャッシュ読込の例外・無効Blob、またはHIT動画のprepare失敗では、該当キーの削除を試みて再生成する。削除失敗もログに残して続行する。再生成後の保存が失敗しても直接利用へ進む。

要求スナップショット、generation、stale判定、prepare直列化と要求単位のURL管理を維持。新たなawaitの後にもstale判定を置いた。`video_pip.js`、server API、DB名/store名/version、既存競合テストは変更していない。LRU・容量管理は未実装。

## フォールバック方針

| 条件 | 処理・識別表示 |
| --- | --- |
| 正常HIT | キャッシュBlobを利用。「キャッシュから準備完了」 |
| 正常MISS | 保存・再読込Blobを利用。「新規生成して準備完了（キャッシュ保存成功）」 |
| put失敗 | CACHE STORE ERRORとCACHE BYPASSを記録。「キャッシュ保存失敗／Blob直接利用で準備完了」 |
| 保存後get失敗 | CACHE READBACK ERRORとCACHE BYPASSを記録。「キャッシュ再読込失敗（保存成功）／Blob直接利用で準備完了」 |
| 初回get失敗 | CACHE READ FAILED / REGENERATE、削除結果を記録して再生成 |
| render自体の失敗 | 動画生成失敗・再試行表示。Blobがないのでフォールバックしない |
| Blobが利用不能・prepare失敗 | 既存の動画準備失敗・再試行表示。キャッシュ障害だけでreadyにすることはない |

直接利用はObject URLを作成してvideoを準備することであり、自動でPiPを開始する意味ではない。従来どおり準備完了後の別タップでPiP開始する。キャッシュ読込失敗→再生成という経緯はログに残し、正常なキャッシュ利用と混同しない。

## テスト結果

CodexがDesktop Chrome `152.0.7977.76`（headlessなし）で実施。既存Pythonとffmpegで実際に生成し、専用ブラウザープロファイル・一時LOCALAPPDATAを使用。IndexedDBメソッドの例外等はテスト内のラップで模擬し、PiP APIは模擬せず、ボタンクリック後の `document.pictureInPictureElement === video` を確認した。

| ケース | 結果 |
| --- | --- |
| 正常MISS→保存→ready→PiP | PASS |
| 正常HIT→追加render 0回→PiP | PASS |
| put失敗→生成Blob直接利用→ready→PiP | PASS |
| get失敗→削除試行→再生成→直接利用→PiP | PASS |
| put/get両方失敗→直接利用→PiP | PASS |
| 保存後の再取得だけ失敗→直接利用→PiP | PASS |
| 保存後の再取得null→直接利用→PiP | PASS |
| getと削除が失敗→直接利用→PiP | PASS |
| render API失敗→error→同じ入力で再試行→PiP | PASS |
| 遅れた旧put失敗→新ready/URLを維持→PiP | PASS |
| 既存競合再現テスト13件 | 全件PASS、5件のキャッシュBlob整合性も一致 |
| node --check | app.jsと新規テストで成功 |
| git diff --check | 成功。新規ファイルもno-indexでチェック |

新規フォールバックテストは10件PASS、pageerror 0件、終了コード0。既存競合テストもpageerror 0件、終了コード0。ジョブ保存先はそれぞれ一時フォルダー `dqw-fallback-Ty4K1J` と `dqw-race-7Kbdf6`。本体・既存Spike動画は変更していない。

### 再実行

実機合格後のcommit前にも再実行し、フォールバック10件・既存競合13件が全PASS、両方pageerror 0件・終了コード0を確認した。再実行の一時ジョブ先は `dqw-fallback-F9WeG3` と `dqw-race-uKQVQH`。構文・差分チェックも成功。

Node、puppeteer-core、Chrome、Python、ffmpeg、既存の指定フォントが必要。依存のインストールは今回行っていない。以下は今回使用した配置先で、別環境では置き換える。

```powershell
$env:PYTHON_PATH = 'C:/Users/shiny/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'
$env:FFMPEG = 'C:/Users/shiny/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-9.0-full_build/bin/ffmpeg.exe'
node tests/video-cache-fallback.cjs
node tests/video-prepare-race.cjs
node --check app/js/app.js
node --check tests/video-cache-fallback.cjs
git diff --check
```

新テストの既定ポートは18783、既存競合テストは18782。空きポートで実行する。必要なら `TEST_PORT` と `CHROME_PATH` を指定できる。

## 実機確認

初回実装報告時点では未実施だったが、2026-09-06にユーザーから今回のフォールバック修正に対するiPhone Safari／DQW実機回帰成功の報告を受けた。実施者はユーザーであり、CodexがiPhoneを操作した結果ではない。

- 通常MISS：新規生成→キャッシュ保存成功→PiP成功→DQW上で小窓維持。
- 通常HIT：キャッシュ再利用→PiP成功→DQW上で小窓維持。
- readyState=4、videoWidth=640、videoHeight=360。
- WebKit PiP成功、日本語・改行正常。

判定：今回のIndexedDB障害フォールバック修正は通常MISS/HITの実機回帰合格。IndexedDB障害自体はDesktopで模擬検証し、iPhoneでの障害再現は実施報告なし（今回必須ではない）。端末機種とiOS/Safariバージョンは未提示。

## 失敗・迷走

新規テストと既存テストは初回実行で通過した。キャッシュ障害の注入は意図的な検証であり、実環境のIndexedDB障害を観測したわけではない。

## Git状態

- 開始時HEAD／ローカルorigin/main：`ec3fb880e4aac6ead9312c154cafda18dc82a4b9`、branch `main`。
- 開始時は追跡ファイルの変更なし、未追跡は `spikes/003-ffmpeg-memo-video/generated.mp4` のみ。
- 初回報告時はapp.js変更、新規テストと本ログ追加、ステージ・commit・pushは未実施。実機合格後、ユーザーがこの3ファイルのみのcommitとorigin/mainへの通常pushを承認した。
- commit message：`fix: allow video playback when cache operations fail`。本記録を含むcommitのSHAはGit履歴から参照する。
- `generated.mp4` は未追跡のまま保持し、削除・変更・commitしない。

## 次の課題

- 今回の通常MISS/HIT実機回帰は完了。今後の動画準備経路変更時も回帰確認を継続する。
- この変更は失敗を返すキャッシュ操作へのフォールバック。永久にpendingの操作のタイムアウトやDB再接続は未対応。
- キャッシュの容量・期限・掃除、長文表示等は今回の対象外。
