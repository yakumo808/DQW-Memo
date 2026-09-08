# 保存前Blobコピー実験 v0.8.2.8-dev

## 目的・一次資料
C:\Users\shiny\Documents\DQW-Memo_iOS_cache_debug_logs_v0.8.2.7.txt のraw診断を確認。Chrome新規キー12436 bytes、Safari新規キー12206 bytesで保存直後verify成功、各後続HIT3回もearly成功/PiP成功。保存直後に必ず壊れるとは言えず根本原因は未確定。
network Blobを直接保存する場合と、bytesから作ったBlobを保存する場合を切り分ける。

## 変更ファイル
- app/js/app.js: 新規render BlobからarrayBuffer→new Blobを作成し、そのコピーだけをputVideoへ渡す。
- app/js/ui/list.js: v0.8.2.8-dev。
- tests/video-cache-fallback.cjs: network Blobと保存Blobの別参照・size/type/全バイト一致、コピー失敗とstaleを追加。
- tests/video-metadata-retry.cjs / tests/memo-delete.cjs: 版表示期待値。
- 本ログ。

## 保存と再生方針
Blob形式/schemaの変更なし。typeは元type、空ならvideo/mp4。START/OK/FAILED、元とコピーのsize/type/byteLength、一致判定、generation/staleを記録。コピー失敗は保存をスキップし元の生成Blobで直接prepare。
コピー成功後は既存の保存後verify/readbackを維持。verify成功時は読戻しBlobからprepare、verify失敗時は元生成Blobへfallbackし保存レコードは保持する。
コピー待ち中staleならputせず中断。既存HIT early/refetch/refresh/rebuild、PiP保護・URL寿命管理、LRU、TOUCH=disabled、ENV、削除UIを維持。旧レコードへのmigrationや再コピーは行わない。

## Desktop検証
Chrome 152.0.7977.76と隔離Python/ffmpegで実行。保存に渡されたBlobがnetwork Blobと別参照でsize/type/全バイト一致、post-save復元Blobも全バイト一致。コピーarrayBuffer失敗でも元Blobでready/PiP、コピー待機中staleで保存/readbackなし。fallback拡張14ケースPASS。

## 実機未確認・次の課題
iPhone Safari/Chrome未確認。v0.8.2.8-devで新しいキーを生成しPRE-SAVE COPY OK→POST-SAVE VERIFY READ OKを確認。同じキーの繰返しHIT、画面移動、再読込後のearly readを比較する。旧キーはコピー保存されていないので区別する。少数回成功でも内部backing仮説の証明とはしない。

## Git状態
開始main HEAD 653f0d169ae2172b70c935bc9b881c1bfc3a12ad。以前の差分を保持。commit/pushなし。spikes/003-ffmpeg-memo-video/generated.mp4は未追跡のまま保持。

## 最終回帰結果
metadata診断、競合13件、寿命管理、LRU、削除UI、mobile UI全件PASS。変更JS/CJSのnode --checkとgit diff --check PASS。
