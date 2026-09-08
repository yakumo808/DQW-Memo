# Blob early read切り分け実験 v0.8.2.5-dev

## 目的・背景
v0.8.2.4の実機生ログではTOUCH=disabledでもSafari/ChromeのHITでmetadata-errorとBlob再構築前段NotFoundErrorが継続した。この版で再生成したキャッシュの次HITでも再発しており、touch唯一原因・旧版キャッシュ限定という仮説は弱まった。原因は未確定。
一次資料: C:\Users\shiny\Documents\DQW-Memo_iOS_cache_debug_logs_v0.8.2.4.txt。

## 変更ファイル・実装
- app/js/app.js: HIT確定直後、loadBlobIntoVideo呼出し前（Object URL生成・videoへの設定前）に元Blob.arrayBuffer()を1回awaitする。
- app/js/ui/list.js: v0.8.2.5-dev。
- tests/video-metadata-retry.cjs: early成功、early NotFoundError、early待機中staleを追加。既存の後段失敗・復旧テストも継続。
- tests/memo-delete.cjs: 版表示期待値更新。
- 本ログ。
成功時はSTART/OKとsize/type/byteLength、generation/staleを記録。失敗時はFAILEDと例外名/内容を記録し既存の削除・render fallbackへ渡す。staleなら削除/renderしない。
取得bytesによる再構築やキャッシュ再保存は行わず、成功後は元のBlobを既存フローへ渡す。HIT touch停止を維持。

## 診断の読み方
CACHE BLOB EARLY READ START stage=before-object-url → OK → EARLY BLOB → CACHE OBJECT URL → PREPARE ATTEMPTの順序。
同じgenerationでEARLY READ OKの後にBLOB REBUILD FAILED NotFoundErrorがあれば、少なくともearly時点では読めていたことが分かる。
今回の最小変更はvideo処理前の読込に限定。Object URL生成直後とsrc設定/load直後それぞれでの追加バイト読込は行わないため、それらのどちらが境界かはまだ確定できない。既存のURL生成・prepareイベント・結果ログを維持する。
診断読込自体がBlobの内部状態やタイミングに影響する可能性もあり、成功増加だけで原因を断定しない。

## 安全条件
early await後にgeneration確認。PiP中のsrcは変更せず、その後の既存待機処理を維持。Object URL所有権、retry、URL refresh、Blob rebuild、ENVログ、LRU保存時cleanupに変更なし。

## Desktop検証
Chrome 152.0.7977.76 + 隔離Python/ffmpeg server。
metadata試験PASS: early成功→通常HIT、put/render 0。early NotFoundError→キャッシュprepareなし→fallback。early成功後のtimeout/error/retry/refresh/rebuild成功と失敗、後段arrayBuffer失敗fallback。early中staleでURL/prepare/render/deleteなし。PiP保護・URL解放整合性・Blob全バイト/type/size一致。

## 実機確認
iPhone Safari/Chrome未確認。ENV v0.8.2.5-devとTOUCH=disabledを確認し、既存キャッシュHITを試す。before-object-urlで失敗するか、early成功後に後段で失敗するかを同じgenerationで比較する。再生成直後/次HIT/別画面から戻ったHITを分けて記録する。

## Git状態・次の課題
開始HEAD main: 653f0d169ae2172b70c935bc9b881c1bfc3a12ad。既存未コミット差分を保持。commit/pushなし。spikes/003-ffmpeg-memo-video/generated.mp4は未追跡のまま保持。
次は実機のearly read結果に基づいて取得直後の読込不能か後段の変化かを判断する。恒久的な保存形式変更は未実施。

## 最終回帰結果
競合13件、fallback10件、lifecycle全7グループ（URL生成8/解放8、不適切解放0）、LRU全件、memo-delete、mobile-ui全幅PASS。変更JS/CJSのnode --checkおよびgit diff --check PASS。
