# IndexedDB動画キャッシュの容量制限とLRU

2026-09-06

## 目的

動画キャッシュを件数・Blob総容量の両方で制限し、古い動画をLRU順で削除する。キャッシュ障害が再生を阻害しない既存fallbackと、Object URLの寿命管理を維持する。

## 現状問題・事前確認

DBは `DQW-Memo`、storeは `videoCache`、versionは1、keyPathは `key`、追加indexなし。既存項目はkey、blob、mimeType、createdAt、width、height、duration、source、styleVersion。Blob.sizeは取得できるが、総件数・総容量取得APIと最終アクセス日時の更新はなかった。

app.jsのMISSはputVideo→getVideo、HITはgetVideoを利用する。そのためVideoCache内で上限適用とアクセス更新ができ、app.jsの動画経路を変える必要はない。

実装前に既存render-jobs内の生成MP4を12件読み取り確認した。サイズは12,005～23,737 bytes。Spike 003のローカルgenerated.mp4は17,787 bytes。上限と削除方式をユーザーへ提示してから実装した。

## metadata設計

- `size`：Blob.sizeを保存。容量計算では保存済みsizeを信用せず、常に実Blob.sizeを使う。
- `createdAt`：既存項目を継続。日時文字列をISO形式へ正規化する。
- `lastAccessedAt`：保存時に現在日時。getVideoのHIT時にも更新する。
- その他の既存項目は維持する。DB名・store・versionを変更せず、レコードへの項目追加のみとした。

旧レコードはsize欠落や誤値をBlob.sizeで補完する。lastAccessedAt欠落・無効時はcreatedAt、それも欠落・無効なら1970-01-01を使い、未利用の古いレコードとして扱う。HIT時には正規化したmetadataを書き戻す。更新に失敗しても読込済みBlobを返す。

metadata更新は別readwriteトランザクションで現在のレコードを再確認して行う。取得後に別の処理で削除されたレコードを復活させない。更新日時は保存済み値より戻さない。

## 上限値

- `MAX_CACHE_ENTRIES = 20`
- `MAX_CACHE_BYTES = 1024 * 1024`（1MiB）

実測の短いメモ動画20件なら約240～475KB相当。動画が大きくなった場合は1MiB側も制限する。総容量はBlobのbytes合計であり、IndexedDB内部やキー・metadataのディスク使用量までは含まない。

本体は固定値を使用。小Blobの機械テスト用にVideoCacheのconstructorでmaxEntries/maxBytesを指定できるが、設定UIは追加していない。単体で上限を超えるBlobはSIZE_LIMITとして保存しない。既存キャッシュを消してから保存不能になることを避け、app.jsの直接Blob利用fallbackへ進む。

## LRU方針・削除タイミング

保存前に、単一readwriteトランザクション内で全レコード列挙→サイズ計算→必要分の削除→putを行う。同じキーの旧レコードは計算から除外し、置換分を二重に数えない。新しいレコードは今回の削除候補に含めない。

削除順：lastAccessedAt昇順→createdAt昇順→IndexedDBのkey比較順。同時刻でも安定した順序になる。件数・容量の両方が上限以下になるまで古いものを削除する。

列挙・削除・putを同一トランザクションに置き、複数インスタンスからの同時保存でも上限計算を直列化する。失敗時は削除も含めてrollbackし、既存キャッシュを保護する。容量整理に失敗した回は新規キャッシュを増やさず、再生は取得済みBlobで続ける。

getStats()を追加し、キャッシュ件数とBlob合計bytesを取得できるようにした。統計取得ではアクセス日時を更新しない。

## 失敗時fallback

| 失敗 | 分離方法・動作 |
| --- | --- |
| metadata更新 | METADATAをconsole.warn、取得済みHITレコードを返す。render再実行不要 |
| LRU列挙 | LRU_ENUMERATEとしてreject、保存トランザクションをabort |
| 削除 | DELETEとしてreject、削除をrollback |
| size計算 | SIZEとしてreject、推測で容量を小さく数えない |
| put | PUTとしてreject、削除をrollback |
| 単体上限超過 | SIZE_LIMITとしてreject、既存レコードは保持 |

putVideoのrejectは既存app.jsがCACHE STORE ERRORとして記録し、保持中Blobの直接利用でprepare・PiPへ進む。エラーメッセージに工程名を含め、整理失敗とput失敗を区別する。Object URLは操作しないため、IndexedDBから削除しても既存PiPのBlob URLをrevokeしない。

## 変更ファイル

- `app/js/core/video_cache.js`
- `tests/video-cache-lru.cjs`（新規）
- `docs/devlog/2026-09-06-video-cache-lru.md`（本記録）

app.js、video_pip.js、既存テスト、server、ffmpeg、UIは未変更。TTL、サーバーcleanup、手動削除UI、Service Workerは追加していない。

## テスト結果

Desktop Chrome `152.0.7977.76`（headlessなし）で実IndexedDBを使用。容量テストは3件／12bytes上限と小Blobを使い、日付を固定して削除順を確認した。PiP検証は実Python/ffmpegと実標準PiP。専用一時ブラウザーと一時LOCALAPPDATAを使用し、通常のユーザーキャッシュを整理していない。

| テスト | 結果 |
| --- | --- |
| 空キャッシュ、1件保存とbytes集計 | PASS |
| HITのlastAccessedAt永続化 | PASS |
| 件数未満では削除なし、超過で最古1件削除 | PASS |
| 容量超過で古い順に複数削除 | PASS |
| 最近HITしたレコード保持 | PASS |
| 同時刻のcreatedAt・key安定順序 | PASS |
| 旧metadata欠落・size誤値の補完と修復 | PASS |
| 同じキーの置換、単体上限超過で既存保持 | PASS |
| 2インスタンスから8件同時保存しても上限維持 | PASS |
| put失敗分類と削除rollback | PASS |
| metadata更新失敗でもHIT Blobを返す | PASS |
| 列挙失敗・size失敗の工程分類 | PASS |
| delete失敗→実生成Blob直接利用→PiP | PASS |
| metadata更新失敗→HIT、追加render 0回→PiP | PASS |
| 再生中にLRU保存・削除してもObject URL/PiP維持 | PASS |
| 既存競合13件 | 全PASS、5キャッシュ整合性一致 |
| 既存フォールバック10件 | 全PASS |
| 寿命管理7グループ | 全PASS、生成8／解放8、不適切revoke・二重解放0 |
| node --check、git diff --check | 成功。新規ファイルもno-indexで確認 |

新LRUテストは20件のDB・上限等の確認と2グループの実PiP検証を通過。全テスト終了コード0、pageerror 0。

一時ジョブ先：dqw-lru-v7uq2c、dqw-race-ZItnBU、dqw-fallback-FoUWTx、dqw-lifecycle-T8v1sJ。これらの一時資産はGit対象外。

### 再実行

既存Node・puppeteer-core・Chrome、Python、ffmpeg、指定フォントを使用。今回依存のインストールはしていない。配置先を環境に合わせて指定する。

```powershell
$env:PYTHON_PATH = 'C:/Users/shiny/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'
$env:FFMPEG = 'C:/Users/shiny/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-9.0-full_build/bin/ffmpeg.exe'
node tests/video-cache-lru.cjs
node tests/video-prepare-race.cjs
node tests/video-cache-fallback.cjs
node tests/video-lifecycle.cjs
node --check app/js/core/video_cache.js
node --check tests/video-cache-lru.cjs
git diff --check
```

新LRUテストの既定ポートは18785。必要ならTEST_PORT、CHROME_PATHを指定する。

## 失敗・迷走

初回テストでput失敗によるabortが、巻き戻される削除要求のエラーに上書きされ、DELETEとして分類される不具合を検出した。最初の原因を保持するよう修正し、再実行で分類とrollbackを確認した。

## iPhone実機確認

初回実装報告時は未確認だったが、その後ユーザーがLRU・容量管理導入後のiPhone Safari／DQW実機回帰を完了し、以下の全項目PASSを報告した。実施者はユーザーであり、Codex自身がiPhoneを操作した結果ではない。

| 実機確認項目 | 結果 |
| --- | --- |
| 既存キャッシュ | CACHE HIT、再生成なし、WebKit PiP開始成功、DQW上で正常表示。PASS |
| 新規メモ | 新規生成・キャッシュ保存成功、WebKit PiP開始成功、DQW上で正常表示、日本語・改行正常。PASS |
| 新規保存メモを再準備 | CACHE HIT、再生成なし、PiP正常。PASS |
| PiP中に別メモを開く | 旧PiP継続、前メモのready状態を不正に引き継がない。PASS |
| PiP中に別メモで準備 | 「PiP終了待ち」となり、現在のPiPを壊さない。PASS |
| 既存Object URL寿命管理との共存 | 問題なし。PASS |
| 日本語表示 | 正常。PASS |

判定：今回のLRU・容量管理導入後の上記実機回帰は合格。件数・容量超過によるLRU削除順と障害注入はDesktopで検証済みであり、それらをiPhoneでも再現したという報告ではない。端末機種とiOS/Safariバージョンは未提示。

## Git状態

- 開始時HEAD：`31049228f7fbf938642e8ff24e47d4ec8ca06a3a`、branch main。
- 開始時追跡ファイル変更なし。未追跡は `spikes/003-ffmpeg-memo-video/generated.mp4` のみ。
- 初回報告時はvideo_cache.js変更、新テストと本ログ追加、ステージ・commit・pushは未実施。実機合格後、ユーザーがこの3ファイルのみのcommit・通常pushを承認した。
- commit message：`feat: add bounded LRU video cache`。本記録を含むcommitのSHAはGit履歴から参照する。
- generated.mp4は未変更・未追跡のまま保持。

## 次の課題・制限

- 上記iPhone実機回帰は完了。今後の動画・キャッシュ経路変更時も回帰確認を継続する。
- 上限は次の成功した保存時に適用する。起動直後の既存キャッシュを一括整理しない。
- Blob欠落など容量計算不能の破損レコードがある場合は整理・保存をabortして直接再生へfallbackする。永続的な破損の自動修復は対象外。
- 永久pending操作、DB再接続、TTL、サーバーcleanupは未対応。
- 総容量はBlob合計。ブラウザー内部の実ディスク使用量を厳密に1MiBにするものではない。
