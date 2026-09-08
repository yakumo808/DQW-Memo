# 保存前コピー方式の正式採用候補整理

## 問題と採用判断
IndexedDBから取得したMP4 BlobのarrayBuffer()がiPhone Safari/ChromeでNotFoundErrorとなる間欠障害を確認した。新規保存前にbytes経由でBlobをコピーする方式を、正式採用候補として合格とする。
これは「根本原因特定ではなく実機検証済み対策」である。再発の完全防止やブラウザ内部backingの因果関係を証明したものではない。既存fallbackを維持する。

## 切り分け履歴
- 同一URL retry、同じBlobのURL refreshでも復旧しない事例あり。
- Blob rebuildは前段arrayBufferでNotFoundErrorとなる事例あり。
- HIT touch停止でも再発。lastAccessedAt更新が唯一原因という仮説は弱まった。
- early readにより、その要求のObject URL生成/video.src/loadより前に読込失敗することを確認。
- 同じキーのrefetchで別Blob参照、size/type一致でも読込失敗。
- 保存直後verifyが成功する例もあり、保存直後から必ず壊れるとは言えない。
- 保存前コピー方式で新規キーの保存・後続HIT・リロード後HITを検証した。

## 実機結果と証拠
ユーザー提供の実機生ログを前ターンで集計確認した。Codex自身によるiPhone操作ではない。
一次資料:
- C:\Users\shiny\Documents\DQW-Memo_iOS_cache_debug_logs_v0.8.2.8_verified_reload.txt
- C:\Users\shiny\Documents\DQW-Memo_iOS_cache_stress_logs_v0.8.2.8.txt
対応付け済み前回2キー/12 HITと追加6キー/36 HITを合計し、8キー・48 HIT成功、そのうち24 HITはリロード後。Safari/Chrome双方でコピー保存・post-save verify・early read・WebKit PiP成功。NotFoundError 0、fallback 0。重複のある旧completeログはこの集計に加えない。
長時間放置、ブラウザ終了、端末再起動後の耐久性は継続確認事項。

## コード整理・変更ファイル
- app/js/app.js: copyBlobForCache(blob, request)へ保存前コピー責務を抽出。arrayBuffer→new Blob（元type、空ならvideo/mp4）、size検査、既存診断ログを集約。DB/video操作を持たせない。staleはnull、コピー例外は呼び出し側へ渡す。
- 本ログ。
呼び出し側のcopyCompleteフラグを廃止。コピー/put失敗時はキャッシュ保存失敗を表示し、保持した元生成Blobで再生を継続する。post-save verify成功時の読戻しBlob再生、失敗時の元Blob再生も維持。
保存形式/schema/旧Blobレコードの読込互換性は変更なし。旧レコードをmigrationや一括再保存しない。

## 診断と次フェーズ
TOUCH=disabled、early/refetch/retry/URL refresh/Blob rebuild/post-save verify/ENV診断を維持。touch再有効化と診断削減は次フェーズで別途検証する。HIT時刻が更新されない間も保存時の件数・容量制限は維持されるが、HITによるLRU昇格は行われない。

## バージョン
v0.8.2.8-devを維持。新機能追加ではなく責務整理であり、今回の整理後コードはDesktop回帰で確認する。既存の実機結果は整理前のv0.8.2.8で取得された結果として区別する。

## Git状態
開始main HEAD: 653f0d169ae2172b70c935bc9b881c1bfc3a12ad。前フェーズの未コミット変更を保持。今回commit/pushなし。spikes/003-ffmpeg-memo-video/generated.mp4は未追跡のまま保持。

## Desktop検証結果
Chrome 152.0.7977.76と隔離Python/ffmpegで主要回帰全PASS。コピーBlob保存と元Blob/コピー/readbackの全バイト・size/type一致、コピー失敗時の元Blob PiP、post-save verify、staleを確認。tests/video-cache-fallback.cjsには旧方式の直接取得Blob・metadata不足レコードを明示的に保存し、HIT/PiPでrender 0の互換テストを追加（今回の変更ファイルに含む）。拡張fallback15ケースPASS。metadata全件、競合13件、寿命管理7グループ（URL生成8/解放8、不適切解放0）、LRU、削除UI、mobile UI全幅PASS。node --checkとgit diff --check PASS。
