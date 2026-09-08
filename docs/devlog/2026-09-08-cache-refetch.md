# CACHE Blob refetch実験 v0.8.2.6-dev

## 目的
v0.8.2.5の実機ログでObject URL生成前のarrayBufferがNotFoundErrorとなったため、同じキーを再取得した別Blob参照で読めるか切り分ける。原因は断定しない。

## 実装・変更ファイル
- app/js/app.js: early read失敗時のみ同じスナップショットのキーでgetVideoを1回追加。非空Blobを検証しarrayBufferを読む。成功後は取得し直したrecordを通常prepareへ渡す。
- app/js/ui/list.js: v0.8.2.6-devへ更新。
- tests/video-metadata-retry.cjs: refetch成功、キーなし、get待機/read待機stale、PiP中refetch成功を追加。early/read両方失敗は既存注入で検証。
- tests/memo-delete.cjs: バージョン期待値更新。
- 本ログ。

## ログ
CACHE BLOB REFETCH START / FOUND / READ OK または READ FAILED。generation、キー、sameReference、size/typeと元Blobとの一致、byteLength、失敗理由、staleを記録。get/read完了後staleならSTALEと段階を記録して終了する。

## 安全条件・fallback
refetch経路では再保存・削除・bytesからのBlob再構築なし。TOUCH=disabledを維持。get/read各await後にstale確認。取得・読込失敗時だけ既存fallback（cache delete試行とrender）へ進む。復旧後の通常prepare失敗には従来retry/URL refresh/Blob rebuild/fallbackが適用される。
PiP中src保護、Object URL所有権と解放、ENV診断を維持。恒久的なLRU/保存形式変更なし。

## Desktop検証
実Chrome 152.0.7977.76、隔離Python/ffmpeg環境で注入テスト。
refetch成功で取得計2回・render/delete/put 0、ready。early/read両方失敗とキー未取得はfallback。get中/read中staleでURL生成/prepare/delete/renderなし。PiP中refetch成功後も旧src保護し終了待ち、終了後準備と復旧。既存metadata試験全PASS。
実機の自然発生NotFoundErrorをDesktopで再現したものではない。

## 実機未確認・次の課題
iPhone Safari/Chrome未確認。ENV v0.8.2.6-dev / TOUCH=disabledを確認。同じgenerationのEARLY READ FAILEDからREFETCH FOUND、READ OK/FAILEDへ進むログを比較。成功時render/deleteなし、失敗時fallback成功を確認する。参照同一性ログはJSオブジェクトの同一性であり、内部保存実体の独立性を証明しない。

## Git状態
開始HEAD main: 653f0d169ae2172b70c935bc9b881c1bfc3a12ad。以前の未コミット作業を保持し、今回もcommit/pushなし。spikes/003-ffmpeg-memo-video/generated.mp4は未追跡のまま保持。

## 最終回帰確認
競合13件、fallback10件、寿命管理全7グループ（URL生成8/解放8、不適切解放0）、LRU全件、削除UI、mobile UI全幅PASS。変更JS/CJSのnode --check、git diff --check PASS。
