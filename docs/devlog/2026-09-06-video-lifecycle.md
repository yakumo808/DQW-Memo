# 画面・動画状態とObject URLの寿命管理

2026-09-06

## 目的

Editorの編集・画面遷移でUIの準備状態を破棄しながら、継続中のPiPを壊さず、不要になったObject URLを安全に解放する。寿命管理のみを対象とする。

## 問題点・実コードの確認

| 確認点 | 変更前の状態 |
| --- | --- |
| 状態の生成・破棄 | app.jsのrenderStateがUI状態を保持。prepareBlobでURL生成、成功時objectUrlに格納。invalidateReadyStateでrevokeとreset |
| 別メモのready/error | 既存のrender呼出しで初期化されるため、前回の競合修正でUI持越しは防止済み |
| Editor→一覧 | 同様に初期化済み。ただしvideoはapp領域の外に残る |
| PiP中のEditor終了 | PiP状態を確認せずURLを即revokeしていた。再生継続を保証できない構造 |
| PiP終了時の解放 | app.jsに終了イベント購読・解放待ち管理がなかった |
| 新動画準備 | 古いURLを解放し、同じvideoへ新srcを設定。PiP中もsrcを差し替える可能性があった |
| PiP状態の取得 | video_pip.jsは公開video参照を持ち、標準pictureInPictureElementとWebKit presentationModeを利用済み。app側で既存イベントを購読可能 |

## ライフサイクル方針

- メモを開く／編集／一覧へ戻る：generationを進め、ready・error・message・fallback警告を初期化。キャッシュ自体は削除しない。
- UIが手放したURLは解放待ちSetへ移す。PiPまたはPiP開始処理が参照中なら保持する。
- 新動画は生成・キャッシュ取得まで進められるが、共有videoへのprepareは現在のPiP終了まで待つ。「PiP終了待ち」「現在のPiPを終了すると新しい動画を準備します」と表示する。
- 終了後に不要URLを解放し、有効な要求のprepareを続ける。別タップで新しいPiPを開始する。
- PiPを終了しても同じEditorがready URLを必要としている場合は保持する。次の編集・画面遷移で解放する。

現在のPiPを強制終了したり、別メモの動画へ自動で切り替えたりしない。これは単一videoを安全に使うための今回の操作方針。

## 修正内容

変更ファイル：

- `app/js/app.js`
- `tests/video-lifecycle.cjs`（新規）
- `docs/devlog/2026-09-06-video-lifecycle.md`（本記録）

app.jsにretiredObjectUrls、PiP状態確認、開始中フラグ、cleanup通知、待機通知を追加。標準の `enterpictureinpicture`／`leavepictureinpicture` と `webkitpresentationmodechanged` をvideoで購読する。既存のvideo参照・状態で実装できたため、**video_pip.jsの変更は不要だった**。

PiP開始処理のfinallyでも通知し、API完了前に画面移動・PiP終了が起きた場合にURLを取り残さない。待機中に編集・画面遷移したら通知で起こし、generation/stale判定により旧要求を破棄する。既存prepare直列化は維持。

server、ffmpeg、IndexedDB仕様、既存テスト、キャッシュ容量・LRU、長文レイアウト、PWA、Service Workerは変更していない。

## Object URL cleanup方針

createObjectURLは引き続きprepareBlobだけが担当し、PiP待機完了・stale確認後に生成する。成功したURLは現在EditorのrenderStateが所有し、失敗・staleなURLは解放待ち管理へ渡す。

revokeObjectURLはcleanupRetiredUrlsへ集約。URLがvideoのsrc/currentSrcに一致し、PiP中または開始中ならrevokeしない。不要で安全ならvideoをpauseし、対応するsrcを外してloadした後にrevokeする。Setからも除去するため重複解放しない。srcが既に別URLの場合はそのvideoを変更しない。

PiPを維持するにはURL登録だけでなくvideo srcも保持する必要があるため、新prepareはPiP終了まで待つ。

## テスト結果

CodexがWindowsのDesktop Chrome `152.0.7977.76`（headlessなし）で実行。実Python/ffmpeg、実video再生・標準PiPを使用。専用一時プロファイル・一時LOCALAPPDATAを使用し、既存ユーザーデータやSpike動画は変更していない。

| ケース | 結果 |
| --- | --- |
| A準備ready→一覧→B | Aの不要URL解放、Bは初期状態 |
| A準備後Bを準備・PiP | Aと異なるURLでBのMISS/PiP成功 |
| AのCACHE HIT | 追加render 0回、PiP成功 |
| AのPiP中→一覧 | PiP要素一致、URL未revoke、currentTime進行を確認 |
| 一覧でPiP終了 | 不要URL解放、video src除去 |
| AのPiP中にBを準備 | Aのsrc・URLを保持し待機、終了後にAを解放しBでready/PiP |
| 同じEditorでPiP終了 | ready URL保持、編集で解放、新動画準備も成功 |
| PiP終了待ち中にメモ切替 | 終了後も旧要求がreadyを復活させない |
| PiP開始の完了待ちで画面移動・終了 | 開始処理完了まで保護し、その後解放 |
| 前メモのerror/message | 別メモでは初期状態に戻る |
| URL生成・revoke追跡 | 最終実行は8件生成・8件解放、二重解放0、PiP中の不適切revoke 0 |
| 既存競合テスト | 13件全PASS、5キャッシュの動画整合性一致 |
| 既存フォールバックテスト | 10件全PASS、実PiP成功 |
| node --check / git diff --check | 成功。新規ファイルもno-indexで空白チェック |

全テスト終了コード0、pageerror 0。寿命管理テストは7グループのPASS。初回7URLを確認後、開始完了待ちとerror遷移のテストを追加して再実行し、8URL全解放を確認した。機能実装上のテスト失敗・迷走はなかった。

今回の一時ジョブ先：`dqw-lifecycle-E8BQ45`（寿命管理最終実行）、`dqw-race-W0kI88`（競合）、`dqw-fallback-qOKSuB`（フォールバック）。一時資産自体はGitに含めない。

### 再実行手順

既存Node・puppeteer-core・Chrome、Python、ffmpegと指定フォントが必要。今回依存をインストールしていない。配置先は環境に合わせて変更する。

```powershell
$env:PYTHON_PATH = 'C:/Users/shiny/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'
$env:FFMPEG = 'C:/Users/shiny/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-9.0-full_build/bin/ffmpeg.exe'
node tests/video-lifecycle.cjs
node tests/video-prepare-race.cjs
node tests/video-cache-fallback.cjs
node --check app/js/app.js
node --check tests/video-lifecycle.cjs
git diff --check
```

既定ポートは順に18784／18782／18783。空きポートで実行し、必要ならTEST_PORT、CHROME_PATHを指定する。

## 実機確認

初回実装報告時は未確認だったが、その後ユーザーが今回の寿命管理修正についてiPhone Safari／DQW実機回帰を実施し、全項目PASSと報告した。以下はユーザーによる実機結果であり、Codex自身がiPhoneを操作した結果ではない。

| 実機確認項目 | 結果 |
| --- | --- |
| 通常CACHE MISS | 新規生成→準備完了→WebKit PiP開始→DQW上で表示維持。PASS |
| 通常CACHE HIT | IndexedDBから準備完了→WebKit PiP開始→DQW上で表示維持。PASS |
| PiP中に一覧へ戻る | 現在のPiPが継続し、再生が壊れない。PASS |
| PiP中に別メモ／別内容を準備 | 旧内容のPiPと現在のsrcを維持。新動画は生成・キャッシュ保存され、UIは「PiP終了待ち」。PASS |
| 現在のPiP終了後 | 待機中の新動画が準備済み状態へ移行。古いready状態の持ち越しなし。PASS |
| 新動画でPiP開始 | 新内容を表示し、DQW上でも正常表示。日本語・改行正常。PASS |

Desktopで確認したObject URL生成8件／解放8件、二重解放0件、不適切revoke 0件と合わせ、今回の寿命管理修正は実機合格。URL件数はDesktop測定値であり、iPhoneで測定した値ではない。端末機種とiOS/Safariバージョンは未提示。

## Git状態

- 開始時HEAD／ローカルorigin/main：`c561f8fdfaf88ffc0eb23215db48f36736bf2a59`、branch `main`。
- 開始時追跡ファイルの変更なし。未追跡は `spikes/003-ffmpeg-memo-video/generated.mp4` のみ。
- 初回報告時はapp.js変更、本テスト・本ログ追加、ステージ・commit・pushは未実施。実機合格後にユーザーがこの3ファイルのみのcommit・通常pushを承認した。
- commit message：`fix: manage video object URL lifecycle safely`。本記録を含むcommitのSHAはGit履歴から参照する。
- generated.mp4は未追跡のまま保持し、commit対象に含めない。

## 次の課題

- 上記iPhone Safari／DQW実機回帰は完了。今後の動画経路変更時も同様の回帰確認を行う。
- 別動画への切替は現在のPiP終了が必要。待機中の画面移動・編集では旧要求を破棄できる。
- キャッシュ容量管理・永久pending対策などは今回対象外。
