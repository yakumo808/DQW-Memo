# キャッシュ動画metadata再試行・診断

## 目的・原因候補

CACHE HIT後のmetadata未確立を即破損扱いせず、同じキャッシュBlobで1回復旧を試す。iPhone Safari/Chromeでユーザーが観測。添付IMG_7674よりiPhone 17 Pro Max / iOS 26.6.1。実機の原因は未確定。
従来は12秒待機失敗もCACHE BROKENとして削除・再生成していた。通常の新規生成でもIndexedDB保存後の読戻しBlobを再生するので、再生成後成功だけではBlob破損を証明しない。

## 今回の変更ファイル

- app/js/app.js: cache経路のみ最大2試行、同じBlob/Object URLを保持。試行・generation・stale・type/sizeログ。CACHE BROKENをCACHE PREPARE FAILEDへ変更。
- app/js/core/video_pip.js: metadata-timeout reason、networkState/error/assignedSrcとイベント・経過時間ログ。load例外もログへ。
- tests/video-metadata-retry.cjs: 実Chromeで初回/2回失敗、stale、URL解放、Blob読戻し整合性。
- docs/devlog/2026-09-07-metadata-retry.md: 本記録。
既存の未commit個別削除・開発バージョン変更は保持し、今回追加変更と区別。

## 再試行フロー

cache Blob取得→URLを1回作成→prepare。metadata-timeoutなら削除/revokeせず同じURLで1回再prepare。未readyなら既存prepareがloadを実行する。遅れてreadyになっていれば既存のskip-ready判定を利用。
2回とも失敗時だけ従来のキャッシュ削除・render fallback。invalid Blobやmetadata-timeout以外の失敗には追加再試行なし。server/direct経路は従来どおり1試行。
タイムアウトは1試行12秒のまま。最大で約24秒＋render時間になる可能性はある。
prepareQueue内で再試行し、各試行前後にstale判定。stale時は再試行・削除・renderを行わず既存finallyでURLをretireする。PiP保護とURL所有権移管は維持。startPipは変更なし。

## 診断ログ

PREPARE ATTEMPT/RESULTに試行回数、URL、generation、stale、経過ms、結果reason。URL作成ログにBlob type/sizeとgeneration。既存の時刻付きObject URL cleanupログで解放を追跡。
video snapshotへreadyState/寸法に加えnetworkState、error code/message、assignedSrcを追加。
load前にloadedmetadata/loadeddata/canplay/error/abort/stalled/loadstart/emptied/suspendのリスナーを登録し、対象URLと経過msを記録。finallyでリスナーを解除。errorイベントでは即破損扱いせず既存12秒待機を維持。
本番コードにBlobハッシュ・コピー処理は追加しない。

## Desktop検証

Chrome 152.0.7977.76 / 実Python・ffmpeg。
- 新規テストPASS: 初回metadata失敗注入→同じURLで復旧・実PiP、render/delete 0。
- 2回失敗注入→delete/render各1回→実PiP。
- 準備待ち中一覧へ戻る→stale破棄、再試行/delete/renderなし。
- URL生成/解放集合一致、二重解放なし、接続中URLの不適切解放なし。
- 保存前/IndexedDB読戻し後のBlob type/size/全バイト一致（テストのみ比較）。
- 既存競合13件、fallback10件、寿命管理7群、LRU全項目PASS。競合テストでは生成MP4とキャッシュBlobのSHA256も5件一致。
- 寿命管理URL生成8/解放8、不適切revokeなし。pageErrorsなし。
- node --check、git diff --check PASS。
失敗注入はcontrollerの_doPrepareがmetadata-timeoutを返す方式。実機での自然発生タイムアウトや12秒の実経過を再現したテストではない。

## 分かったこと・未解決

DesktopではBlob破損の証拠なし。iPhoneに保存された問題Blob自体の内容は未採取なので、実機の破損/参照問題/一時的media読込停止は未確定。再試行の実機有効性も未確認。

## iPhone再確認手順

配信ページを再読み込みし、開発用ログを開く。Safari/Chromeでそれぞれ新規MISS→同じ内容のHIT、一覧往復、PiP終了後、ページ再読込後を確認。
失敗時はPREPARE ATTEMPT 1/2からRESULTまで連続ログを保存。CACHE PREPARE RETRYの次が2/2、同一URLであることを確認。復旧したらCACHE DELETED/RENDER OKが出ずPiP→DQWへ進むことを確認。
両方失敗時はCACHE PREPARE FAILEDの後だけ削除・再生成になることを確認。待機中に編集/一覧へ戻った場合はstale=trueとcleanup、新しいメモに旧readyが残らないことを確認。
v0.8.1-devは既存の一覧UI識別値のまま。今回の診断コード更新確認はPREPARE ATTEMPTログの有無で行う。

## Git状態

HEAD 653f0d169ae2172b70c935bc9b881c1bfc3a12ad (main)。個別削除などの先行未commit変更あり。今回もcommit/pushなし。
spikes/003-ffmpeg-memo-video/generated.mp4は未追跡のまま保持。

## 実機retry不一致への追補

Safari/Chrome実機で1/2から2/2が見えずfallbackしたとのユーザー報告。実コードではerror=4専用の即fallback分岐はなかったが、reasonがmetadata-timeout以外ならbreakし、prepare例外は結果ログも通らず外側catchへ進む穴があった。実機の根因と断定はしない。配信済みモジュールの版の混在も現時点では否定できない。

今回の修正: app.jsでprepare例外・理由なし失敗も共通結果へ正規化。キャッシュの初回失敗はvideo要素欠落を除き1回retry。staleは明示的中断ログ。invalid Blobは従来の事前検証を維持。
video_pip.jsはmetadata結果に理由を付与。video.errorありはmetadata-errorで終了。abort/stalledは発生を記録し、旧srcのload中断を誤って失敗にしないよう即終了せず、期限時にmetadata-abort/stalledとして返す。無イベントはmetadata-timeout。1試行12秒のまま。
ログ系列: PREPARE ATTEMPT 1/2 → ATTEMPT 1 RESULT → CACHE PREPARE RETRY → PREPARE ATTEMPT 2/2 → ATTEMPT 2 RESULT → RETRY RECOVERED または FALLBACK TO RENDER。URLとgenerationを照合する。同じBlob/Object URLで再試行し、途中でrevokeしない。

Desktop: retry専用7シナリオPASS（timeout復旧、連続timeout fallback、実wait関数へのerrorイベント/code4注入復旧・連続失敗fallback、例外復旧、理由なし失敗復旧、stale破棄/URL整合性）。自然発生するiOS障害ではなく制御された注入テスト。既存fallback10件・寿命管理7群・競合13件PASS。寿命管理URL生成8/解放8、不適切解放なし。構文・diffチェックPASS。
今回LRUは未再実行（前回PASS、cacheコード変更なし）。abort/stalledの実機挙動は未確認。

再確認: Safari/Chromeそれぞれページを再読み込みしてHIT。1/2からの連続ログを採取。ATTEMPT 1 RESULTのreason/stale、2/2の有無とURL一致、RECOVERED時renderなし、両失敗時のみFALLBACK TO RENDERを確認。中断ならPREPARE INTERRUPTED/NOT RETRYABLEを確認。
開発バージョンはv0.8.2-devのままなので、今回の更新判別は新しいATTEMPT 1 RESULTというログ表記で行う。commit/pushなし。

## 実機確認用バージョン更新方針

ユーザー指定により、実機再確認が必要になる変更のたびにDEV_VERSIONを更新する。今回のretryフロー修正はv0.8.2.1へ更新。上記の「v0.8.2-devのまま」という記載はこの追記で更新する。実機では一覧表題のv0.8.2.1とATTEMPT 1 RESULTログを確認する。commit/pushなし。

## v0.8.2.2-dev: 同じBlobからのURL再生成実験とENVログ

### 実機観測（ユーザー報告）

v0.8.2.1でretry自体は両ブラウザ実行済み。Safariは22:07:12 HITで25ms/15msのmetadata-error後render成功32ms。その後HIT41ms成功、内容変更後MISS成功とHIT40ms成功。
ChromeはMISS31ms成功、HIT34ms成功の後、22:14:02 HITで12005ms/12009ms失敗（ユーザーログ上reasonなし）、render後30ms成功。ブラウザを混同せず別の観測として記録。実機Blobのsize一致だけで内容一致/破損は断定しない。

### 今回変更

app.js: cache経路の同一URL2試行失敗後のみ、同じblob変数から新URLを作り1回prepare。新URL成功でrender/deleteなし、正式URLとして保持。新URL失敗後に既存fallback。
旧URLは新URLの試行が終了するまで保持し、finallyで既存retireObjectUrl経由で解放。stale時は新旧URLをretireしreadyを反映しない。新URL試行前もstale/PiPチェック、同一prepareQueue内で処理。
ログはCACHE URL REFRESH (sameBlob/old/new/generation/type/size)、PREPARE ATTEMPT refreshed-url、URL REFRESH RECOVERED または URL REFRESH FAILED / FALLBACK TO RENDER。
1試行12秒の変更なし。最悪時は3試行で約36秒＋render待ちとなる。これはタイムアウト延長ではなく、新URL復旧可否を切り分ける限定試行。

list.jsの既存DEV_VERSIONをexportしv0.8.2.2-devへ更新。一覧表示とapp起動ENVログで同一定数を使う。
ENV browser/app/userAgent/platform/iOSを起動時に既存開発ログへ出す。CriOS/Chrome、Safari、その他のUA分類は診断のみ。UAによる機能分岐なし。iOS推定不能ならunknown。ログは既存折りたたみ内で、追加の画面領域なし。

今回の追加変更ファイル: app/js/app.js、app/js/ui/list.js、tests/video-metadata-retry.cjs、tests/memo-delete.cjs（版番号期待値更新）、本ログ。video_pip.jsは前回変更のまま。

### Desktop検証

Chrome 152.0.7977.76、失敗注入と実render/PiPを併用。
- 同一URL2回失敗→別URL成功→render/delete 0。
- 新URLも失敗→render/delete各1回→PiP成功。
- Blob参照同一、新旧URL相違、新URL試行前の旧URL未解放をassert。
- 新URL試行中に一覧遷移→stale破棄、render/deleteなし、URL生成/解放集合一致、二重/不適切解放なし。
- 実PiP中の準備は待機、現在src未変更・未解放、PiP終了後にrefresh成功、render/deleteなし。
- 初回retry成功、error4、例外、理由なし結果の既存注入ケースもPASS。
- ENV: 実Chromeの出力、Safari/CriOS/その他UA模擬の分類、版番号/iOS表記PASS。UA模擬はSafari実機検証ではない。
- 主要回帰: 競合13件、fallback10件、寿命管理7群、LRU全項目PASS。寿命管理URL8生成/8解放、不適切解放なし。
- 構文・diffチェックPASS。

### 実機再確認

Safari/Chromeそれぞれ再読み込み。v0.8.2.2-devの表題とENV browser/app/userAgentを確認してログを保存。
HIT失敗時、1/2→2/2→CACHE URL REFRESH→PREPARE ATTEMPT refreshed-urlの順序とold/new URL相違を確認。RECOVEREDならrender/cache deleteがなくPiP/DQWで正常か確認。FAILEDなら従来fallbackで正常生成できるか確認。
今回も原因断定なし。Desktopの注入成功はiOSの自然発生障害での復旧を保証しない。実機未確認、commit/pushなし。未追跡generated.mp4と先行未commit変更は保持。

## v0.8.2.3-dev: Blob再構築実験

### 実機観測と目的

ユーザー報告: v0.8.2.2-devではSafari/Chromeともに同一URL2試行、新URLrefreshとも失敗しrenderで即復旧。その後のHITで一発成功する場合あり。Object URLを作り直すだけでは復旧せず、URL単体原因という仮説は弱まった。原因は未確定。
次の切り分けとして、refresh失敗後に同じ動画bytesから新しいBlobを1回作りprepareする。

### 変更・フロー

app.js: cacheのみ最大4試行。通常1/2→同一URL2/2→refreshed-url→rebuilt-blob。
4試行目直前に元Blob.arrayBuffer()をawaitし、staleなら中断。new Blob([bytes], {type: blob.type || 'video/mp4'})を作成。sizeが元と異なる場合は失敗とし、type一致/不一致もログ。元typeが空の場合はvideo/mp4へ補完するためtypeMatch=falseとなる。
再構築後にPiP状態を再確認し、必要なら終了待ち。元Blobを置換保存せず新URLで再生を試す。成功時render/cache deleteなし。arrayBuffer/構築例外は理由をログして既存fallback。stale時はfallbackしない。
旧URL群は試行中保持し、完了・失敗・stale時に既存retire処理で解放。新URL成功時は正式URLとして保持。
1試行12秒は維持。最大約48秒＋arrayBuffer読込＋render時間となり得る。arrayBuffer自体の独立タイムアウトは今回追加していない。再構築時はバイト列分の一時メモリを使用する。
ENV診断は維持、版番号v0.8.2.3-dev。一覧定数と関連テスト期待値を更新。
今回追加変更: app.js、list.js、video-metadata-retry.cjs、memo-delete.cjs（バージョン期待値）、本ログ。他の先行未commit変更は保持。

### ログ

CACHE BLOB REBUILD START → CACHE BLOB REBUILD READY (sizeMatch/typeMatch) → REBUILT BLOB size/type/originalSize/originalType → REBUILT BLOB OBJECT URL old/new → PREPARE ATTEMPT rebuilt-blob → BLOB REBUILD RECOVERED。
失敗はBLOB REBUILD FAILED / FALLBACK TO RENDERとstage/error、staleはBLOB REBUILD INTERRUPTED。ENV browser/app/userAgent/platform/iOSも起動時出力を維持。

### Desktopテスト

Chrome 152.0.7977.76、制御された失敗注入と実render/PiPを併用。
- 最初3試行失敗→再構築成功→render/delete 0、実PiP成功。
- 再構築prepareも失敗→render fallback。
- arrayBuffer拒否→render fallback。
- 新旧Blobが別参照でsize/type/全バイト一致。
- arrayBuffer待機中の一覧遷移→stale中断、render/deleteなし、URL集合生成/解放一致、二重/不適切解放なし。
- PiP再生中の準備は現在srcを保護して待機し、終了後に再構築で復旧。
- 既存timeout/error/例外/理由なし復旧とENV分類もPASS。
- 主要回帰: 競合13件、fallback10件、寿命管理7群、LRU全項目PASS。寿命管理URL生成8/解放8、不適切解放なし。
- 構文・git diff --check PASS。
最初のstaleテストは同一Blobへの待機注入がURL生成ごとに二重適用されPromiseが残った。WeakSetでBlobごと1回の注入に修正し全PASS。アプリの不具合とは区別。

### 実機再確認

Safari/Chromeそれぞれ再読み込み、ENV app=v0.8.2.3-devとbrowserを確認。同じメモのHITで失敗が起きた際に上記系列を採取。
READYまで進むか、sizeMatch/typeMatch、arrayBuffer失敗理由、新旧URL、rebuilt-blob結果を確認。RECOVEREDならrender/cache deleteなしでPiP/DQW表示できるか確認。
読込中の編集/一覧遷移とPiP中の保護も再確認。Desktop注入PASSはiOS障害の復旧保証ではない。実機未確認、原因断定なし、commit/pushなし。generated.mp4は未追跡のまま保持。
