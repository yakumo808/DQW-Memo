# 動画内長文レイアウト

## 目的・原因

攻略メモを640×360の1画面で読みやすくする。従来はtitle+空行+content全体を28pxで中央描画し、自動折り返し・行数制限がなかった。

## 変更ファイル・実装

- server/render_server.py: 標準ライブラリのみの折り返し、サイズ選択、行数制限。行ごとにffmpeg drawtextで固定位置へ描画。
- tests/render_text_layout.py: 長文専用6テスト（実動画4ケースを含む）。
- docs/devlog/2026-09-07-text-layout.md: 本記録。

## レイアウト方針

上下左右24px、影用に幅4pxを予約。有効幅588px。タイトル28px、行ピッチ36px、最大2行。タイトル後に12pxの間隔。
本文は28/24/22/20pxから収まる最大サイズを選ぶ。行ピッチはサイズ+6px。タイトル1行なら本文は最大10行（20px）、タイトル2行なら最大8行。
全角1文字を1emとする保守的な列数（28pxは21列、20pxは29列）。Latinも1em扱いなので英数字が多い場合は右側が余る。フォント実測や単語単位の英語折り返しは行わない。
CRLF/CRをLFに正規化し、明示改行・空行を保持。結合濁点等は基底文字に連結。簡易禁則として境界の句読点・括弧を1文字手前へ折り返す。完全な禁則処理・絵文字の書記素処理は対象外。
20pxでも収まらない本文、2行を超えるタイトルは末尾に「…」。全文を無理に縮小せず、元のinput.txtは無加工のまま保持する。短文も28pxを維持するが配置は従来の中央から左上に変更。

## 既存仕様への影響

APIの入力・レスポンス形式とMP4仕様（640×360、30fps、4秒、H.264 High、yuv420p、AAC無音、faststart）は維持。変更はdrawtextのレイアウトのみ。
各jobにlayout-NN.txtを最大で表示行数分追加。既存のディレクトリ単位TTL削除で一緒に削除される。cleanupコードは変更しない。
expansion=noneで本文の%や%{localtime}を文字どおり表示。
app/IndexedDB/LRU/Object URL/PiP/UIは変更なし。既存CACHE HITの動画は旧レイアウトのまま。新レイアウト検証には内容を変えてMISSにする必要がある。styleVersion変更は今回の対象外として未実施。

## Desktop検証結果

2026-09-07、Windows / Python 3.12.14 / ffmpeg / Chrome 152.0.7977.76。

- 長文専用6テストPASS: 短文、文字保持、自動折り返し、明示改行・結合濁点、長文サイズ/行数/省略、空入力、実動画4種類。
- 実動画: 短文／中程度の攻略メモ／長文／日本語・空行・%記号。ffprobeで仕様、moovがmdatより前にあること、input.txtの原文保持を検証。
- 4フレーム目視: 行重なり・表示範囲外へのはみ出しなし、タイトル本文分離、長文省略記号、記号の文字どおり表示を確認。
- 既存render_job_cleanup.py: 12件PASS（実POST/MP4取得/404とcleanup障害時render成功を含む）。
- 既存video-cache-fallback.cjs: 10件PASS、実Chrome PiP成功、pageErrors=0。MISS/HIT、put/get両失敗、読戻し失敗、render失敗後retry、stale破棄。
- Python構文チェック、git diff --check PASS。
- app側競合/LRU/寿命管理の独立スイートは今回は未再実行。関連するfallback内のstaleケースはPASS。

動画・フレームは隔離一時領域 C:\Users\shiny\AppData\Local\Temp\dqw-layout-gplebad3 に保持。再現はFFMPEG環境変数を指定し `python -B tests/render_text_layout.py`。実フォントNotoSansJP-VF.ttfが必要。

## 失敗・切り分け

移動後のリポジトリは旧sandbox書込範囲外のため、最初の書込が拒否された。許可付きで実装。画像表示ツールも旧作業ディレクトリ参照で失敗したため、生成フレームを読み取りJPEG表示で目視検証した。

## 実機確認・次の課題

実装報告時は未確認だったが、2026-09-07にユーザーによるiPhone Safari / DQW実機結果と添付画像IMG_7653～IMG_7656を確認。Codex自身が実機操作を再実行したものではない。

- 新規生成・キャッシュ保存成功・動画準備完了を確認（IMG_7653/7654）。
- WebKit PiP開始成功。ログでreadyState=4、640×360を確認（IMG_7654）。
- DQW上で長文PiP表示を確認（IMG_7655）。日本語、本文の改行・空行、自動折り返し、末尾の省略記号を表示。
- 再準備で「キャッシュから準備完了」とWebKit PiP開始成功を確認（IMG_7656）。
- タイトルは任意改行ではなく、長文時の自動折り返しで2行になることをユーザーが確認。現仕様として問題なしとの評価。
- 今回は実機結果の記録とcommit/pushのみ。追加の機能変更は行わない。
全文を必ず表示する仕様ではない。長すぎる場合は省略する。複数ページ化は未実装。
絵文字・複雑な結合文字・厳密な禁則は未保証。通常の日本語攻略メモを主対象とする。

## Git状態

開始時main/ origin/main/ HEAD: 107883ad1bfe7541c7dca423868b58d3df1fa98b。
実装報告時は上記3ファイルのみ変更・追加、stage/commit/pushなし。実機結果確認後、指定3ファイルを `feat: improve long memo video text layout` でcommit・通常pushする承認を受領。確定SHAはGit履歴を参照。
spikes/003-ffmpeg-memo-video/generated.mp4は未追跡のまま保持。
