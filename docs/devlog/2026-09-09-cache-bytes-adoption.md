# ArrayBuffer保存方式の採用整理（v0.8.3.2-dev）

## 目的・採用判断
新規動画キャッシュの標準形式をArrayBuffer bytesとする。正式採用候補として合格と評価するが、iOS IndexedDBのBlob実装が根本原因だったとは断定しない。

## 実機結果の一次資料
ユーザー提供 DQW-Memo_iOS_cache_bytes_v0.8.3.1_verified_summary.txt を読んで記録。Codexが実機を再操作した結果ではない。
- Chrome6 / Safari6 / Safari7 / Safari8 / Safari9 / Chrome7 / Chrome9の7新規キーでbytes保存・post-save verify・PiP成功。
- HIT内訳：Chrome6 7、Safari6 6、Safari7 6、Safari8 6、Safari9 9、Chrome7 6、Chrome8 3、Chrome9 6。重複除外計49回成功。Chrome8はHIT集計に含まれるが今回の7新規保存確認とは区別する。
- Safari / Chrome両方、ENVブロック更新で確認されたリロード後HITを含む。
- NotFoundError 0、cache read失敗によるfallback render 0。

## 分かった範囲
旧Blob保存ではObject URL生成前にNotFoundErrorが繰り返し発生。HIT時Blob再put廃止・metadata別store化後も再発し、保存直後verify成功から数秒後に読めない例もあった。bytes保存→HIT時new Blobの今回の検証範囲では再発しなかった。根本原因特定ではなく実機検証で有効性を確認した方式として扱う。

## 標準経路・互換性
新規：render Blob→arrayBuffer→IndexedDB bytes。
HIT：bytes→new Blob→既存prepare/PiP。新規Blob形式保存はしない。
旧Blobは読込互換のみ。読めれば再生、読めなければ既存render fallbackを経てbytesで同じキーを上書き。一括migrationなし。
videoCacheAccessのmetadata-only touch、20件/1MiB LRU、bytes.byteLength集計、cache key、stale、PiP、URL寿命管理を維持。

## 診断整理・POST-SAVE VERIFY
bytes通常経路は既にprepare1回で、旧Blob用early/refetch/retry/URL refresh/rebuildを通さない。旧形式の診断は今後の障害追跡用に維持する。
保存後のFOUND・Blob比較・byteLength別行を成功ログ1行に集約。ENV、HIT/MISS/形式、metadata-only、bytes保存/読込/Blob再構築、render/fallback、prepare/PiP結果、エラーを保持。
POST-SAVE VERIFY自体は今回残す。通常運用の必須要件とはしないが、1回のreadbackで確認でき、失敗時は生成済み元Blobによる再生を継続する。削除による経路変更を採用整理と同時に行わず、今後必要性を再評価する。長時間放置やプロセス終了・端末再起動後の耐久性は継続観測事項。

## 今回の変更ファイル
app/js/app.js（標準経路コメントと重複ログ整理）、app/js/ui/list.js（v0.8.3.2-dev）、tests/memo-delete.cjsとtests/video-metadata-retry.cjs（version期待値）、本ログ。
server、レイアウト、削除UI、コピーUI、cache保存ロジックは今回変更なし。

## Desktop検証
Chrome 152.0.7977.76、隔離Python/ffmpeg/ブラウザで実行。
- video-cache-fallback: 新規bytes保存・全バイト一致、複数HIT/render0/PiP、旧Blob互換・失敗からbytes置換、保存/readback障害とstale PASS。
- video-cache-lru: metadata-only touch・失敗時PiP、件数/容量上限・旧record互換・並行保存 PASS。
- video-metadata-retry: 旧Blob診断とstale/PiP保護 PASS。
- video-prepare-race: 13件PASS、5キーで実MP4と保存bytes SHA256一致。
- video-lifecycle: 7グループPASS、URL生成8/解放8、不適切解放0。

## Git状態・注意点
main HEAD 653f0d169ae2172b70c935bc9b881c1bfc3a12ad。memo削除以降の未commit差分が重なった状態をgit statusとdiffで確認。今回もstage/commit/pushなし。generated.mp4は未追跡のまま保持。最終commit前には全差分と対象ファイルの確認が必要。

## 次の課題
v0.8.3.2-devの実機は未確認。長時間放置・ブラウザ終了・端末再起動後のbytes HITは通常利用で継続観測する。必要ならPOST-SAVE VERIFYの運用方針を別途決定する。

## 最終検証結果
memo-delete（320/390/1280px）とmobile-ui（320/390/768/1280px）も全PASS。ログ全文コピー・成功/失敗表示・折りたたみ・APIなしfallbackは注入テストで確認。実OSクリップボードは今回未検証。node --check、git diff --check PASS。

## v0.8.3.2-dev iPhone実機確認PASS
ユーザー提供 DQW-Memo_iOS_cache_logs_v0.8.3.2.txt を確認。ファイル自身の注記どおり、全行の生ログではなく構造化された集計と代表マーカーである。以下はその資料とユーザー報告に基づき、Codex自身がiPhoneを再操作した結果ではない。ログにない実行時刻は補わない。
- Chrome: ENV browser=Chrome / app=v0.8.3.2-dev、新規bytes保存1件・POST-SAVE VERIFY成功。同一セッション4/4、リロード後3/3、計7/7 HIT成功。
- Safari: ENV browser=Safari / app=v0.8.3.2-dev、新規bytes保存1件・POST-SAVE VERIFY成功。同一セッション3/3、リロード後3/3、計6/6 HIT成功。
- 合計新規保存2件、HIT13/13、リロード後6/6成功。
- NotFoundError 0、cache read fallback / regenerate 0、記録されたPiP失敗0。
- 各HITでmetadata-only touch、FORMAT=bytes、BYTES READ OK、BLOB REBUILT FROM BYTES、WebKit PiP開始成功を確認したとの報告。
bytes標準経路は診断整理後もSafari / Chrome双方で正常と評価する。過去のIndexedDB Blob障害の根本原因は引き続き断定しない。上記の「v0.8.3.2-devの実機は未確認」はこの追記で更新する。

## commit前監査（コード変更なし）
mainとローカルorigin/mainは653f0d169ae2172b70c935bc9b881c1bfc3a12adで一致。remote fetchは未実施。追跡差分10ファイル（582追加/84削除）、未追跡15ファイル（devlog12、テスト2、保護対象MP4 1）。indexは空。
コード・テスト12ファイルとdevlog12ファイルの計24ファイルがcommit候補。generated.mp4は唯一の除外対象として未追跡で保持。複数機能がapp.js/list.js/CSS等で重なっているため、途中実験版へ機械的に分割せず、検証済み最終状態を1つの統合commitにする案を推奨。
削除/修正候補は報告のみ：app.js冒頭のpre-save copyingコメントが旧方式を指す、POST-SAVEの同期処理後stage=read stale判定は途中にawaitがなく到達しない、touch停止スイッチと旧試験名copyは調査時の名残。旧Blob用retry/refetch等は互換経路に残す意図があり未使用コードではない。
READMEは引き継ぎ時のDB v1/Blob保存・cleanupなし・解決済み負債等の記載が残る。現在仕様として読むと不整合のため更新候補（今回変更なし）。
DB upgradeのonblocked処理がなく、旧タブがDBを保持すると待機し続ける可能性、DB open失敗Promiseの保持も残る。通常経路の実機合格とは別の未解決条件として扱う。
この監査で機能コードは変更していない。直前のv0.8.3.2-dev Desktop全回帰PASSを最終実行結果として参照し、今回は構文・diffチェックを再確認。stage/commit/pushは行わない。
