# CACHE HIT access touch停止実験（v0.8.2.4-dev）

## 目的
IndexedDB由来Blobの読込失敗と、HIT時のlastAccessedAt更新によるrecord再保存との関係を切り分ける。原因断定・LRU恒久削除は行わない。

## 一次資料と観測
ユーザー提供の C:\Users\shiny\Documents\DQW-Memo_iOS_cache_debug_logs_v0.8.2.3.txt を確認した。
Safari 1:21:59、Chrome 1:23:57 / 1:24:17 / 1:24:31 / 1:24:39で通常・同一URL再試行・URL再生成に失敗し、Blob再構築前段でNotFoundErrorとなる。今回の生ログではChromeにもmetadata-errorがある。再生成後は正常。アプリのURL解放ログはこの失敗の後であり、ログだけでBlobのバイト破損やtouchとの因果関係は確定できない。

## 修正内容・変更ファイル
- app/js/core/video_cache.js: 可逆なtouchOnReadオプションを追加。falseならreadonly取得とmetadata正規化のみで戻し、readwrite transaction/record putを行わない。既定trueの従来動作は維持。
- app/js/app.js: CACHE_ACCESS_TOUCH_ENABLED=falseでアプリのキャッシュ取得時更新を停止。CACHE HIT ACCESS TOUCH=disabledを出力。
- app/js/ui/list.js: v0.8.2.4-devへ更新。
- tests/video-cache-lru.cjs: 更新なしのBlob取得、put 0回、timestamp不変、保存時件数・容量整理を追加。
- tests/video-metadata-retry.cjs: アプリ実経路でHIT復旧時のrecord put 0回、診断文言、版表示を検証。
- tests/memo-delete.cjs: 版表示の期待値更新。
- 本開発ログ。

## 実験範囲とfallback
アプリのgetVideoはHITだけでなく生成後の読戻しも更新停止となる。保存時のput、metadata付与、20件/1MiB制限、古い順のcleanup、DB schemaは変更なし。
実験中はHITしても利用日時が進まないため、よく読む古い動画も削除候補になる。恒久的なLRU設計ではない。将来のread/touch責務分離は実機結果を踏まえて判断する。
同一URL retry、URL refresh、Blob rebuild、最終render fallback、stale判定、PiP中src保護、Object URL cleanup、ENV診断は維持した。

## 検証
実Chrome 152.0.7977.76、隔離したPython/ffmpeg serverとIndexedDBで検証。
- video-cache-lru: 更新なしHITでBlob読込、put 0、日時不変。保存時件数/容量整理と従来touchありLRUの回帰PASS。
- video-metadata-retry: 同一URL/新URL/Blob再構築の復旧時render/delete/record put 0。失敗fallback、errorイベント、stale、PiP保護、URL生成解放整合性、Blob全バイト/type/size一致PASS。
- video-prepare-race: 13件PASS。
- video-cache-fallback: 10件PASS。
- video-lifecycle: 全7グループPASS。URL生成8/解放8、不適切解放0。
Desktopの注入テストはiOSの自然発生NotFoundErrorを再現した証拠ではない。

## 実機確認
v0.8.2.4-devはiPhone未確認。Safari/Chrome各々でENV版表示とTOUCH=disabledを確認し、既存キャッシュを初期化せず繰り返しHIT、PiP終了/再準備、画面移動後のHITを確認する。過去に取得不能となったキャッシュが初回に残る可能性もあるため、新規生成後の繰り返しHITも分けて記録する。metadata-error/timeout/NotFoundErrorの有無とfallback回数を生ログで比較する。

## Git状態
開始時main/HEAD: 653f0d169ae2172b70c935bc9b881c1bfc3a12ad。以前の削除UI・metadata実験の未コミット差分を保持。今回もcommit/pushなし。spikes/003-ffmpeg-memo-video/generated.mp4は未追跡のまま保持。

## 次の課題
実機結果からtouch停止の効果を評価する。少数回の成功のみで原因とは断定しない。LRUの最終設計・migrationは今回対象外。

## 最終Desktop確認
- memo-delete: 320/390/1280幅、実Chrome touch・縦スクロール・pointercancel・キーボード・削除後操作PASS。
- mobile-ui: 320/390/768/1280幅でPASS。
- node --check（app.js / video_cache.js / list.js / 変更テスト）とgit diff --check PASS。
