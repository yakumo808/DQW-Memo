# HIT touch単独再有効化 v0.8.2.9-dev

## 目的・変更
保存前コピー方式を維持してlastAccessedAt更新を復帰し、iPhoneでNotFoundError再発の有無を切り分ける。
app/js/app.jsのCACHE_ACCESS_TOUCH_ENABLEDをtrueに変更。既存getVideoのmetadata transactionをそのまま利用し、CACHE HIT ACCESS TOUCH=enabledを出力。共有インスタンスの設定なので既存のpost-save読戻し/refetchにも従来touchが適用される。
app/js/ui/list.jsをv0.8.2.9-devへ更新。copyBlobForCache、保存形式、診断、PiP、LRU上限には変更なし。

## 変更ファイル
app/js/app.js、app/js/ui/list.js、tests/video-cache-lru.cjs、tests/video-metadata-retry.cjs、tests/memo-delete.cjs、本ログ。

## Desktop検証
Chrome 152.0.7977.76と隔離Python/ffmpeg。
- HITでtimestamp更新・record put 1回。Blob全バイト/type、key/size/その他metadata維持。
- touch put失敗はmetadata警告に留まり、取得済みBlobでHIT/PiP継続。
- LRU全件PASS（touchで最近のHITが残る、上限整理、旧metadata互換含む）。
- fallback15ケースPASS（コピー保存・post-save全バイト一致、コピー失敗時元Blob PiP、旧直接保存Blob HIT含む）。
- metadata試験はtouchありのput回数へ期待値更新。refetchは2回の取得に対してput2回。

## 検証中の問題
metadataテストで以前のentered=trueが残り、実際の待機到達前に解放する競合が顕在化。Blob rebuild待機テスト開始時にentered=falseを設定して修正。アプリのstaleロジック変更はしていない。再実行PASS。

## 実機未確認・次の課題
Safari/Chrome未確認。新規キーでコピー保存・post-save verify、同じキーの反復HIT/リロード後HITを確認。ENV v0.8.2.9-dev、TOUCH=enabledを確認しNotFoundError/early/refetch/fallbackの有無を比較する。
診断削減は次フェーズ。今回の再有効化で原因が証明されたとはしない。

## Git状態
開始main HEAD 653f0d169ae2172b70c935bc9b881c1bfc3a12ad。既存未コミット変更を保持。commit/pushなし。spikes/003-ffmpeg-memo-video/generated.mp4は未追跡のまま保持。

## 最終回帰結果
metadata全件、競合13件、寿命管理7グループ（URL生成8/解放8、不適切解放0）、削除UIとmobile UI全幅PASS。node --checkとgit diff --check PASS。
