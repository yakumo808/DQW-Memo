# 保存直後Blob検証実験 v0.8.2.7-dev

## 目的
保存直後からBlobが読めないのか、保存直後は読めるが後のHITで読めなくなるのかを実機ログで切り分ける。v0.8.2.6では別参照のrefetchもNotFoundErrorだったが根本原因は未確定。

## 変更ファイル・内容
- app/js/app.js: 保存完了後に既存の1回のgetVideo readbackを利用してarrayBufferを診断。START/FOUND/READ OK/READ FAILEDと元/復元Blobのsize・type・一致、byteLength、generation/staleを記録。
- app/js/ui/list.js: v0.8.2.7-dev。
- tests/video-cache-fallback.cjs: post-save read失敗、全バイト一致、stale検証追加。
- tests/video-metadata-retry.cjs / tests/memo-delete.cjs: 版表示期待値更新。
- 本ログ。

## 保存方式・fallback・安全性
Blob保存方式、TOUCH=disabled、保存時LRUを維持。診断readbackは既存取得を兼用して1回のみ。bytesによる置換、再保存なし。
post-save readbackまたはarrayBuffer失敗時は保存レコードを削除せず、保持している生成Blobを直接prepareする。これまでreadback失敗時に行っていたdeleteをこの経路では停止。通常HIT失敗時の既存削除/render fallbackは維持。
get/read各await後staleなら現在UIやvideoへ結果を適用しない。PiP終了待ち、Object URL寿命管理、HIT early read/refetch、metadata retry/URL refresh/Blob rebuild、ENVは維持。

## Desktop検証
隔離したChrome 152.0.7977.76、Python/ffmpegで検証。
- 保存成功→readback成功、元生成Blobと復元Blobのsize/type/byteLength/全バイト一致。
- 保存成功→arrayBuffer NotFoundError、get失敗、キーなし→元生成Blobでready/PiP。post-save失敗でdelete 0、取得は初期MISS+readbackの計2回。
- post-save read待機中stale→新しいreadyとPiPを壊さない。
- fallback拡張12ケースPASS。

## 実機未確認・次の確認
iPhone Safari/Chrome未確認。ENV v0.8.2.7-devとTOUCH=disabledを確認し、新しい内容を生成してPOST-SAVE VERIFYの結果を取得。その同じキーで後続HITのEARLY READ結果と比較する。保存確認失敗時も生成BlobからPiP可能か確認する。
同じキーでも再生成されれば別保存データとなる。ログ内のCACHE STOREDとgenerationで対応を確認する。size/type一致だけでは内容の正常性を断定しない。本番ログで重い全バイト比較やハッシュは行わず、Desktopテスト側のみで比較。

## Git状態・次の課題
開始HEAD main: 653f0d169ae2172b70c935bc9b881c1bfc3a12ad。既存未コミット作業を保持。commit/pushなし。spikes/003-ffmpeg-memo-video/generated.mp4は未追跡のまま保持。
実機結果で保存直後と後続HITの読込可否を比較し、次の切り分けを判断する。恒久的な保存形式変更は今回行わない。

## 最終回帰確認
metadata診断全件、競合13件、寿命管理7グループ（URL生成8/解放8、不適切解放0）、LRU全件、削除UI・mobile UI全幅PASS。変更JS/CJSのnode --check、git diff --check PASS。
