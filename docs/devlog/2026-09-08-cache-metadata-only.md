# 動画キャッシュのmetadata分離とログコピー（v0.8.3.0-dev）

## 目的・実機観測
一次資料 DQW-Memo_iOS_cache_debug_logs_v0.8.2.9_touch_enabled.txt を確認。Safari / Chrome両方でTOUCH=enabled後のEARLY READ / refetchにNotFoundErrorが再発し、render fallback後は成功している。Safariではreload後も再発。保存前コピー＋touch停止では報告済み8キー48 HIT（24はreload後）、NotFoundError / fallback 0だった。ただしtouch停止単独でも過去に失敗したため、touchだけが根本原因とは断定しない。Blob入りrecord再putを再発要因候補と評価する。

## 設計・変更
IndexedDBはrecordのフィールドだけを更新できないため、アクセス時刻専用のvideoCacheAccess store（keyPath: key、key / lastAccessedAt）を追加。DB DQW-Memoをversion 2へ更新し、既存videoCacheのキー・Blob保存形式・内容は維持。旧recordは移行時に書き換えず、専用metadataがない場合は従来timestampをLRUで使用する。
HITではBlobを取得し、存在をtransaction内で再確認してmetadataだけputする。Blob入りrecordはputしない。ログは CACHE HIT ACCESS TOUCH=metadata-only。metadata更新失敗は警告とし、取得済みBlobを返す。
LRUは専用timestampを優先。20件・1MiBの上限を維持。保存・eviction・個別削除・clearは両storeを同じtransactionで処理し、古いmetadataも削除する。新規保存時は過去touchを削除して新しい保存timestampを利用する。
保存前コピー、post-save verify、early read、refetch、retry、URL refresh、Blob rebuild、fallback、stale、PiP保護は変更していない。

## ログコピーUI
開発用ログの見出し付近に48px以上の「ログをコピー」ボタンを配置。折りたたんだまま全文コピー可能。Clipboard APIを優先し、APIがないLAN HTTP等では一時textareaとexecCommandを使用。成功・失敗は別のstatusに表示し、2.5秒で消す。ログ内容は変更しない。

## 今回変更ファイル
- app/js/core/video_cache.js
- app/js/app.js
- app/js/ui/list.js（v0.8.3.0-dev）
- index.html
- app/css/style.css
- tests/video-cache-lru.cjs
- tests/video-metadata-retry.cjs
- tests/video-prepare-race.cjs
- tests/memo-delete.cjs
- tests/mobile-ui.cjs
- 本ログ
既存の未コミット変更は保持。上記以外にも先行作業の差分が存在する。

## Desktop検証
Chrome 152.0.7977.76で以下PASS。
- LRU: version 1旧Blob維持→version 2、HIT timestamp更新、Blob record timestamp不変、Blob内容・size・type・既存metadata維持、metadata失敗時HIT/PiP、上限eviction・並行保存・旧record互換。
- metadata/retry全件: HIT時Blob put 0、early/refetch/retry/refresh/rebuild、stale、PiP保護。
- fallback 15ケース: コピーBlob保存、post-save全バイト一致、copy/readback失敗時元Blob利用、旧Blob HIT、再生成fallback。
- 競合13件: Python/ffmpeg実生成、HIT、stale、キーと動画SHA256整合。
- 寿命管理7グループ: URL生成8 / 解放8、不適切解放0。
- 削除UI: 320/390/1280px、touch・マウス・キーボード、縦スクロール、削除後作成編集。
- mobile UI: 320/390/768/1280px、横はみ出しなし、折りたたみ・48pxボタン。
- コピー: 全文一致、成功表示、API拒否時の失敗表示、折りたたみ維持、APIなしfallback。Clipboard API/execCommandは注入による確認で、実OSクリップボード・iPhoneの確認は未実施。

## 検証中の問題
LRU試験用の古いtimestamp注入が専用metadataを残していたためfixtureも同時に消すよう更新。競合試験にversion 1固定openが残っており現行DBを開く指定へ修正。再実行で一度render 500による待機timeoutが出たため、テスト指定のPYTHON_PATHでbundled Pythonを明示して全件再実行PASS。アプリの競合処理は変更なし。

## 実機未確認・次の課題
Safari / ChromeでENV app=v0.8.3.0-dev、TOUCH=metadata-onlyを確認し、新規保存と旧キーの反復HIT・reload後HIT、NotFoundErrorの有無を比較する。既に読めない旧Blobは既存fallback対象。旧版タブがDBを保持するとversion 2へのupgradeが待機する可能性があるため、更新時は旧DQW-Memoタブを閉じて開き直す。ログコピーを折りたたみ状態で押し、実際の貼り付け全文も確認する。根本原因・長期安定性は未確定。診断削減は別フェーズ。

## Git状態
main HEAD 653f0d169ae2172b70c935bc9b881c1bfc3a12ad。先行未コミット差分を保持。stage / commit / pushなし。spikes/003-ffmpeg-memo-video/generated.mp4は未追跡のまま保持。
