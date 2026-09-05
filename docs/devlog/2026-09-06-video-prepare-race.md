# 動画準備の非同期競合修正

2026-09-06

## 目的

動画準備開始時のメモ識別子・title・content・cache key・要求世代を固定し、Editorの編集や画面切替後に古い処理結果を現在のメモへ適用しないようにする。今回はこの競合修正のみを対象とする。

## 原因

実コードを再確認し、以下を確認した。

- IndexedDB検索に使うキーを作った後、render時にグローバルの `editorDraft` を読み直していた。検索待ち中の編集で旧キーと新本文が組み合わされ得た。
- `currentSignature() !== makeSignature(editorDraft)` は同じ現在データを比較するため、開始時からの変更検出にならなかった。
- 検索・動画取得・Blob保存・prepareの各待機後に一貫したstale判定がなく、メモ切替でも旧処理を失効させていなかった。
- `video_pip.js` は進行中のprepare Promiseを共有する。旧要求と新要求が並行してprepareすると、新要求が旧動画の完了を受け取る可能性があった。

## 修正内容

変更ファイル：

- `app/js/app.js`
- `tests/video-prepare-race.cjs`（新規）
- `docs/devlog/2026-09-06-video-prepare-race.md`（本記録、新規）

`snapshotRequest()` がメモID・title・content・既存形式のcache key・世代番号を同期的に取得し、`Object.freeze()` した要求を後続処理へ渡す。render本文とIndexedDB検索・保存キーはこの要求だけから取得する。

編集・画面遷移・新規準備開始時に世代番号を進め、ready状態を無効にする。各非同期境界と失敗処理では、世代・Editor表示中か・メモID・title/contentの一致を確認する。古い処理は現在UI・renderStateを更新せず終了する。本文を変更して元に戻しても、また同じメモへ戻っても、古い世代は再び有効にならない。

編集後のUIは既存の「動画を準備」「動画を準備してください」に戻る。新しい要求のreadyを遅れて届いた旧要求が上書き・リセットしない。

共有videoへのprepareだけを呼び出し側で直列化した。Blob URLは準備中は要求ローカルに保持し、成功かつ要求が有効な場合だけrenderStateへ渡す。staleまたは失敗時は、その要求のURLをvideoから外し解放してから次のprepareを開始する。新しい要求のURLは解放しない。

既に始まったIndexedDB保存は取り消さない。保存が編集後に完了しても、保存対象のBlobとキーは同じ開始時スナップショットに由来するため整合する。完了後のUI適用は破棄する。renderサーバーの実行も中断せず、古い応答を破棄する。

`video_pip.js` のPiP開始ロジック、server API、キャッシュ形式は変更していない。LRU・容量管理・UI大改修は行っていない。`app.js` のPiP完了後にも同じstaleチェックを置き、古い完了通知でreadyが復活することを防ぐ。

## 検証

Codexが今回実行したDesktop Chrome検証。引き継ぎ情報のみの成功報告とは区別する。

環境：Windows、Chrome `152.0.7977.76`（headlessなし）、Node `v24.14.0`、puppeteer-core `24.43.1`、Python `3.12.14`。既存の `ffmpeg-9.0-full_build/bin/ffmpeg.exe` と指定NotoSansJPフォントを使用。

未変更のPythonサーバーを `127.0.0.1:18782` で起動し、実際にffmpegで動画を生成した。Chromeは専用の一時プロファイル、生成先はテスト専用の一時LOCALAPPDATAとし、既存のブラウザーデータ・通常のrender-jobs・Spike動画は使用・変更しない。

テストでは実モジュールのメソッドをブラウザー内で一時ラップし、IndexedDB・render応答・Blob取得・保存・prepareの完了通知を任意に保留する。実際のDB処理・HTTP・ffmpeg・video読込を行った上で、編集／画面遷移を挟んで通知を解放する。固定時間だけに頼らず、保留地点に到達したことを確認して操作する。保留はテスト内だけで、本体にテスト用APIを追加していない。

| 検証項目 | 結果 |
| --- | --- |
| 1. 通常CACHE MISS | 成功。実生成、Blob URL準備、videoWidth=640、ready表示 |
| 2. 通常CACHE HIT | 成功。追加render要求0件、キャッシュ準備完了表示 |
| 3. IndexedDB検索中の本文変更 | HIT・MISS両方で旧結果を破棄。renderを追加実行せずidleを維持 |
| 4. render応答待ち中の本文変更 | 旧応答でreadyに戻らない |
| 5. 準備中に別メモへ切替 | 前メモの結果を新メモへ適用しない |
| 6. 元メモへ戻って再準備 | 正常にCACHE HIT |
| 7. キーと動画内容の整合 | 最終実行の全5キャッシュでキー→POST本文→input.txt→生成MP4→保存Blobを照合 |
| 8. node --check | app.jsとテストスクリプトで成功 |
| 9. git diff --check | 成功。新規ファイルもno-indexのcheckで確認 |
| Blob取得・保存完了待ち中の編集 | 旧結果でreadyに戻らない。保存済み旧Blobは旧キーと整合 |
| prepare中の編集→すぐ新要求 | prepareは直列化、旧URL解放、新要求のURLでready |
| 本文変更→元の本文へ戻す | 世代違いにより旧要求を破棄 |
| 新要求ready後に旧render応答が到着 | 新URL・readyを維持。新URLを解放しない |
| Blob URLの実再生 | play成功、currentTimeの進行を確認 |
| 検索中のタイトル変更 | 旧要求を破棄 |
| staleなprepareの例外 | 別メモにエラーを反映せず、後続prepareも正常終了 |

ブラウザーのpageerrorは0件。テスト全体の終了コードは0。

キー整合性検証では、各キャッシュキーに対応するPOSTのtitle/contentと、サーバーが実際に書いた `input.txt` を照合した。さらにサーバー生成MP4とIndexedDB BlobのSHA-256一致を確認した。画像OCRによる文字認識検証は行っていない。

初回修正時の最終実行のジョブ証跡はローカルの `C:\Users\shiny\AppData\Local\Temp\dqw-race-ft4i0Y` に残る。一時資産なのでGitからは復元できないが、テストと本結果記録はGit管理可能なファイルとして残す。

実機合格報告後、commit直前に同じ競合テストを再実行し、全13件のPASS、全5キャッシュのSHA-256一致、pageerror 0件、終了コード0を再確認した。再実行のジョブ保存先は `C:\Users\shiny\AppData\Local\Temp\dqw-race-Y4sCKz`。`node --check app/js/app.js` と差分の空白チェックも成功。

### 再実行手順

リポジトリルートで実行する。Nodeから `puppeteer-core` を解決できること、Chrome、Python、ffmpeg、指定フォントが必要。今回既存の `node_modules/puppeteer-core` を使用し、依存の新規インストールはしていない。

```powershell
$env:PYTHON_PATH = 'C:/Users/shiny/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'
$env:FFMPEG = 'C:/Users/shiny/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-9.0-full_build/bin/ffmpeg.exe'
node tests/video-prepare-race.cjs
node --check app/js/app.js
node --check tests/video-prepare-race.cjs
git diff --check
```

別環境では実在する配置先へ置き換える。Chromeは既定で `C:/Program Files/Google/Chrome/Application/chrome.exe`、必要なら `CHROME_PATH` を指定する。18782が空いていることを確認し、必要なら `TEST_PORT` を指定する。テストは終了時に自分で起動したChromeとPythonサーバーを終了する。

## 実機確認

初回実装報告時点ではiPhone実機回帰は未実施だった。その後、2026-09-06にユーザーが以下の実機回帰成功を報告し、添付画像をCodexが確認した。**iPhone Safari実機確認済み、DQW上PiP残存確認済み。** 操作の実施者はユーザーであり、CodexがiPhoneを操作した結果ではない。

| 実機検証 | 結果 |
| --- | --- |
| CACHE MISS正常 | 新しいtitle/contentで「動画を準備」→「新規生成して準備完了」→WebKit PiP開始成功。DQW切替後も小窓が残存。日本語・改行正常 |
| CACHE HIT正常 | 同じ内容で「キャッシュから準備完了」。Blob URLからWebKit PiP成功、DQW上でも小窓が残存 |
| 編集後ready無効化正常 | 本文の「三行目」を「三行目だ」に変更すると、古いreadyをそのまま使用せず再準備が必要になった |
| 編集後の新内容で再生成・PiP正常 | 新内容で再生成し、「三行目だ」がPiP動画へ反映。DQW上でも正常表示したとのユーザー報告 |

添付画像で確認できた証跡：

- `IMG_7610.PNG`：新規生成して準備完了、Blob URL、640×360、`PiP開始成功 (WebKit)`、日本語の三行表示。
- `IMG_7611.PNG`：DQW画面上に「テスト／一行目／二行目／三行目」のPiP小窓。
- `IMG_7612.PNG`：キャッシュから準備完了、Blob URL、`PiP開始成功 (WebKit)`。
- `IMG_7613.PNG`：DQW画面上に同内容のPiP小窓。
- `IMG_7614.PNG`：新規生成して準備完了、変更後の「三行目だ」、CACHE STOREDとSERVER OBJECT URLのログ。

readyが無効化される操作途中と、変更後のDQW画面は添付静止画のみでは確認できないため、上表ではユーザーによる操作・結果報告を根拠とする。画像のローカル所在は `C:/Users/shiny/iCloudPhotos/Photos/`。画像自体は今回のcommit対象に含めず、この記録に確認内容を残す。iPhone機種とiOS/Safariバージョンは未提示。

判定：Desktop Chromeの非同期競合テストと、ユーザーによるiPhone Safari／DQWの上記実機回帰はともに合格。iPhoneでの遅延注入による各非同期境界の競合再現まで実施したという意味ではない。

## 失敗・迷走

ffmpegの既存配置先の読み取りがサンドボックスで拒否されたため、対象ディレクトリを限定して権限付きで確認した。既存環境のインストール・変更はしていない。Chrome検証は初回の全項目が通り、追加した逆順完了・タイトル編集・実再生のケースも再実行で通った。

## Git状態

- 開始時HEAD／ローカルorigin/main：`e2266f1631252c0abf81f0ef4d836e4c56c93c1b`。
- ブランチ：`main`。
- 開始時の追跡ファイル変更：なし。
- 開始時の未追跡：`spikes/003-ffmpeg-memo-video/generated.mp4` のみ。
- 初回実装報告時：`app/js/app.js` を変更、テストと本ログを新規追加し、ステージ・commit・pushは未実施。
- 実機合格後、ユーザーが上記3ファイルのみのcommitとorigin/mainへの通常pushを承認。commit messageは `fix: prevent stale video preparation results`。本記録を含むcommitのSHAはGit履歴から参照する。
- `spikes/003-ffmpeg-memo-video/generated.mp4` は未追跡のまま保持。既存Spike・server・video_pip.jsは未変更。

## 次の課題

- 今回のiPhone Safari→DQW回帰は上記範囲で完了。今後も動画準備経路を変更した際は実機回帰を行う。
- prepare直列化により、新要求が旧prepareの完了・既存の12秒メタデータ待機タイムアウトまで待つ場合がある。今回は安全な最小修正として中断APIを追加していない。
- 既に実行された旧サーバージョブ・整合した旧キャッシュは残る。掃除・容量管理は今回の対象外。
- キャッシュ障害時の再生切替、長文表示など、引き継ぎ時の他の技術的負債は未修正。
