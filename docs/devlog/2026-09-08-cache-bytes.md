# ArrayBuffer保存の切り分け実験（v0.8.3.1-dev）

## 目的・一次資料
DQW-Memo_iOS_cache_debug_logs_v0.8.3.0_metadata_only.txtの生ログを確認。Chromeの18:31:14 / 18:31:19などでmetadata-only HIT後にEARLY READとrefetchがNotFoundErrorとなりrenderへfallback。Safariでも18:35:38のMISS→コピー保存→post-save verify成功後、18:35:45の最初のHITで再発した。Object URL生成より前で発生し、HIT時Blob再put・Blobとmetadataの同一store更新は今回の失敗に必須ではなかった。根本原因は未確定。
Blob保存そのものを経路から外す比較実験としてArrayBuffer保存を導入する。正式移行と断定せず、旧recordの一括migrationは行わない。

## 実装
新規生成Blob→arrayBuffer→videoCacheへbytes保存。recordはkey / bytes / type / sizeと従来metadata。Blobプロパティは保存しない。既存putVideoのBlob引数も内部でbytes化するため、新規保存は統一される。DB version 2とvideoCacheAccessは維持。
getVideoはbytesなら毎回new Blobで組み立て、旧Blobならそのまま返す。LRUはbytes.byteLengthまたは旧blob.sizeで集計し、上限20件・1MiBとmetadata-only touchを維持。
bytes HITはprepare 1回。旧Blob用early read / refetch / 同一URL retry / URL refresh / Blob rebuildは残す。prepare失敗時のrender fallback、stale・PiP保護・URL寿命管理は共通。旧Blobが読めなければfallback生成物が同じキーのbytes recordとなる。
保存用arrayBuffer変換・put・readback失敗は元の生成Blobによる再生を維持。保存後verifyではreadback ArrayBufferの存在・byteLengthを確認し、getVideoで再構築したBlobを通常経路へ渡す。staleならUI反映を中断。

## 診断
CACHE STORAGE FORMAT=bytes、CACHE BYTES SAVE START/OK/FAILED、CACHE BYTES POST-SAVE VERIFY START/OK/READ FAILED、CACHE HIT FORMAT=bytes / blob-legacy、CACHE BYTES READ OK、CACHE BLOB REBUILT FROM BYTES。保存失敗stageとerror、size / type / byteLengthを記録。ENV・metadata-only touch・旧Blob診断を保持。

## 変更ファイル
- app/js/app.js
- app/js/core/video_cache.js
- app/js/ui/list.js
- tests/video-cache-fallback.cjs
- tests/video-cache-lru.cjs
- tests/video-metadata-retry.cjs
- tests/video-prepare-race.cjs
- tests/memo-delete.cjs（version期待値）
- 本ログ

## Desktop検証
Chrome 152.0.7977.76、隔離Python/ffmpegとIndexedDBでPASS。
- fallback試験17グループ: 実render bytes保存、DB raw recordにBlobなし、size/type/全バイトreadback一致、3回連続bytes HIT/render 0/PiP、旧Blob HIT/PiP、旧Blob NotFoundError注入→refetch失敗→render→bytes置換/PiP、変換/put/readback失敗時元Blob再生、stale。
- LRU全件: bytes件数/容量eviction、metadata touch、touch失敗時PiP、旧DB/record互換、並行保存、eviction中PiP保持。
- 旧Blob診断回帰全件: テスト用get結果をBlob-onlyとして旧診断を実行し、retry / refresh / rebuild / early / refetch / staleとPiP保護を確認。実際の旧Blob保存互換はfallback試験で別途確認。
- 競合13件: 実生成MP4と保存bytesのSHA256一致（5キー）、HIT/MISS/stale。
- 寿命管理7グループ: URL生成8・解放8、不適切解放0。
- 削除UI 320/390/1280px全PASS。
- mobile UI・ログコピー320/390/768/1280px全PASS（コピーAPIは注入検証）。
- node --check、git diff --check実施。
テストをbytes形式へ適合：旧copyログ期待値・raw Blob参照・readback失敗注入を更新した。文字コード未指定の編集スクリプトがcp932読取で一度停止したためUTF-8明示で再実行。

## 実機未確認・次の課題
Safari / ChromeでENV v0.8.3.1-devを確認。新規キーのbytes保存/verify、直後・連続・reload後HITのFORMAT=bytesとPiPを確認する。旧キーはblob-legacyと表示され、読めない場合の再生成後はbytesとなる。NotFoundError / fallback有無を記録し、ログコピーで収集する。長時間放置・ブラウザ終了・端末再起動後は継続検証。今回の結果だけで根本原因や正式採用を確定しない。

## Git状態
main HEAD 653f0d169ae2172b70c935bc9b881c1bfc3a12ad。先行作業の未コミット差分は保持。stage / commit / pushなし。spikes/003-ffmpeg-memo-video/generated.mp4は未追跡のまま保持。
