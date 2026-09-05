# Codex引き継ぎ記録

2026-09-06

## 目的

Codexや別AIが、完成範囲・実機成功の引き継ぎ情報・未検証事項をGitから復元できるよう、現在の基準状態を文書化する。

一次情報はGitリポジトリ実体と `docs/devlog/` とし、過去会話の推測で状態を補完しない。本記録の実機成功については、今回ユーザーが提示し、引き継ぎ確認内容を承認した情報を出典とする。

今回の変更ファイルは `README.md` と本ファイルのみ。実装内容は文書の新規作成であり、機能修正は行わない。既存コード、Spike、ローカル動画を変更せず、commit／pushもしない。

## 引き継ぎ時Git状態

以下は文書作成前に実コマンドで再確認した状態。

| 項目 | 状態 |
| --- | --- |
| HEAD | `89bc6d5fedd60c743c52f7f152ee0eb85e021db5` |
| origin/main | `89bc6d5fedd60c743c52f7f152ee0eb85e021db5` |
| branch | `main` |
| 追跡ファイルの未コミット変更 | なし |
| ステージ済み変更 | なし |
| 未追跡ファイル | `spikes/003-ffmpeg-memo-video/generated.mp4` |

`origin/main` はローカルのリモート追跡参照であり、今回fetchしてリモートサーバー側と照合したものではない。

直近5件：

```text
89bc6d5 Phase 3.2 D-4 add IndexedDB video cache
bca3e27 Phase 3.2 D-3B connect editor to render server
64cafa1 Phase 3.1 establish iPhone system PiP with standard mp4
b5eb638 Fix PiP interaction for iOS Safari and optimize DOM structure
cae6c16 Phase 3 MVP: Foundation complete with PiP integration and UI separation
```

文書作成前はルートREADMEと `docs/devlog/` は存在しなかった。今回の2文書は新規ファイルとして追加し、ステージしない。ローカル動画は未追跡のまま保持する。

文書作成後の検証結果：`git diff` は追跡ファイルの差分なし、`git diff --check` は問題なし。未追跡の新規文書は通常のdiff対象外のため、各文書を `/dev/null` と比較する `git diff --no-index` と同オプションの `--check` でも確認し、空白エラーなし。Gitの改行設定によるLF→CRLF変換予告のみ表示された。作成後の未追跡ファイルは指定の2文書と既存のローカル動画のみで、既存追跡ファイルの変更はない。

## 現在の完成状態

- Phase 3.1（`64cafa1`）：通常MP4を使うPiPコントローラーとSpike 002が存在する。
- Phase 3.2 D-3B（`bca3e27`）：Editorの未保存title/contentを生成APIへ送り、Pythonとffmpegで動画化する接続がある。
- Phase 3.2 D-4（`89bc6d5`）：IndexedDBへのMP4 Blob保存・再取得、CACHE HIT時の生成API省略、Blob URL準備と本体PiPへの接続がある。キャッシュ動画の準備失敗時には削除・再生成を試みる。

これらは実ファイルとコミット履歴・差分で確認した実装範囲であり、すべての異常系や実運用の完成を意味しない。

## アーキテクチャ

Vanilla JavaScriptの一覧・Editorを `app/js/app.js` が統括する。メモは `app/js/api.js` からlocalStorageの `dqw_memo_data` に保存する。

正式な新規生成経路：

```text
Editor → render server → ffmpeg H.264 MP4
       → fetchでBlob取得 → IndexedDB保存・再読込 → Blob URL
       → iPhone Safari WebKit PiP → DQW
```

CACHE HIT時はrender APIを再実行せず、IndexedDBからBlobを読む。DBは `DQW-Memo`、バージョン1、storeは `videoCache`、keyPathは `key`。現キャッシュキーはtitle・content・styleVersion `v1` の改行連結文字列。

`video_render_client.js` は同一オリジンの `POST /api/render` を呼ぶ。`server/render_server.py` が静的ファイルとAPI、`/videos/<jobId>.mp4` を配信する。起動はリポジトリルートで `python server/render_server.py --host 0.0.0.0 --port 8782`。iPhoneでは同一LANのPCアドレス `http://<PCのLAN IPv4アドレス>:8782/` を開く。

必要環境はPython、ffmpeg、`C:/Windows/Fonts/NotoSansJP-VF.ttf`。ffmpegはPATHまたは環境変数 `FFMPEG` で指定する。生成ジョブの `input.txt`・`generated.mp4`・`ffmpeg.log` は `%LOCALAPPDATA%\DQW-Memo\render-jobs\<jobId>\` に保存する。

生成設定は640×360、30fps、4秒、H.264 High、yuv420p、AAC無音、faststart。videoはloop再生する。

動画準備とPiP開始は別タップに分離している。生成・キャッシュ取得・メタデータ読込を先に済ませ、開始タップでは再loadせずplayとPiP APIを呼ぶ。`video_pip.js` はWebKit APIを優先し、標準PiP APIにも対応する。旧canvas／floatingコードは残置されているが本体の正式経路では使わない。

Spike 002は通常MP4とPiP、003は日本語テキストとdrawtext、004は固定キーでのIndexedDB保存・再生・削除を検証するもの。004自体にPiP操作はない。

## 実機確認済み事項

**以下は、今回の引き継ぎ情報としてユーザーから成功報告を受け、内容の承認を得た事項。今回Codex自身が再実行した実機試験ではない。**

1. Phase 3.1：通常H.264 MP4 → iPhone Safari WebKit PiP → DQW上表示に成功。
2. D-3B：Editor title/content → Python render server → ffmpeg H.264 MP4生成 → iPhone Safari PiP → DQW上表示に成功。
3. D-4：IndexedDBにMP4 Blobを保存し、CACHE HIT時はrender APIを再実行せず、Blob URL再生 → iPhone Safari WebKit PiP → DQW上表示に成功。

実機の機種、iOS/Safariバージョン、確認時刻、詳細な操作条件、実機ログは今回提示されていないため記録上は不明とする。成功したという引き継ぎ事実と、独立した再現試験の証拠を混同しない。

## 今回未検証の事項

- 現HEADをブラウザーで起動した画面操作、生成APIの実行、ffmpegによる再生成。
- iPhone SafariのPiP開始・DQW上表示・長時間維持の再試験。
- CACHE HIT時の通信観測、再読み込み後の永続性、容量不足・破損・DB接続失敗。
- 編集中・画面切替中の非同期競合、PiP中の編集とBlob URL解放。
- 動画バイナリの再生・ffprobe等による今回の仕様実測。
- リモートサーバー側のmainとの差分確認。

今回確認したものはGit状態・履歴・差分、指定ソース、関連UIと入口、Spike内のファイル。指定フォントの存在は確認した。確認用シェルの `Get-Command` ではPython・ffmpeg・ffprobeを解決できず、実際の実行環境は未確認。未インストールとは断定しない。

Git管理外の `scripts/` に過去のChrome PiP成功JSONがあるが、現HEADの再試験証拠として扱わない。Spike 002 READMEの合格チェックは未記入で、「commit前」など古い記述も残っている。

## 発見した技術的負債

静的なコード確認で得た事項。障害の動的再現は未実施。

1. `app.js` の `currentSignature() !== makeSignature(editorDraft)` は同じ現在データの比較で、開始時からの変更を検出できない。D-3Bにあった開始時キーとの比較がD-4で失われている。キャッシュ検索後のdraft読み直しにより、検索待ち中の編集で旧キーと新内容が混在する可能性もある。
2. キャッシュ保存失敗後もIndexedDB再取得を必須とし、生成済みBlobの直接再生経路がない。DB接続失敗のPromiseを保持し、再接続処理もない。
3. メモ切替時に前の準備状態を表示し得る。PiP中の編集、画面移動、Blob URLの寿命管理が未整理。
4. キャッシュキーはハッシュではなく本文を含み、ログにも出る。容量上限・期限・自動整理・本体削除UIがない。
5. 文字サイズ固定で、長文の自動折返し・ページ分割がない。
6. サーバーはffmpeg実行の時間制限・同時実行制限・ジョブ掃除がなく、JSONが配列やnullの場合の型検査も不足。認証なし・CORS全許可・リポジトリルート配信の検証構成。
7. 現行の回帰テストと実機条件のGit内記録が不足している。今回READMEと本記録を追加するが、実機証跡不足は解消していない。

今回の失敗・迷走として、機能実装の試行錯誤は行っていない。確認時にルートREADMEが存在しないことと、確認用シェルで実行依存を解決できないことが分かった。どちらも推測で補完せず記録する。

## 引き継ぎ上の注意点

- `spikes/003-ffmpeg-memo-video/generated.mp4` は意図的にGit管理外のローカル検証資産。削除・commitしない。現 `.gitignore` では除外されていないため、一括 `git add .` を避ける。Gitだけでこの動画自体を復元することはできない。
- `python -m http.server` だけでは動画生成APIは動作しない。Python render serverで本体とAPIを同一オリジン配信する。詳細な起動手順はルートREADMEを参照する。
- localStorageとIndexedDBは別管理。アクセス元オリジンが変わると保存領域も変わる。
- 動画仕様、videoのDOM・属性、load/play/PiP呼出し、非同期処理、Blob URL、IndexedDB、配信経路を変更する場合はiPhone Safari→DQWの実機回帰確認が必要。
- 新規生成とCACHE HITの両経路、HIT時のAPI未実行、Blob URL再生、WebKit PiP、DQW前面での表示を確認する。
- 今後の各Phase・大きな変更の完了時は `docs/devlog/` に、目的、変更ファイル、実装内容、検証結果、実機確認、失敗・迷走、Git状態、次の課題を記録する。未検証を明記し、実機結果には端末・OS・ブラウザー・対象コミットも残す。
- 今回は文書2件のみを作成し、機能修正・commit・pushは行わない。

## 次の候補タスク

1. 非同期処理の入力スナップショットと開始時キーを整理し、キャッシュ検索中・生成中の編集とメモ切替を回帰検証する。
2. IndexedDB障害時の方針を決め、容量不足・接続失敗・破損時の動作を整備する。
3. PiP中の編集・切替・終了とBlob URL管理を整理する。
4. 長文表示、キャッシュ容量管理、サーバージョブ管理を段階的に改善する。
5. 各変更で必要な実機確認を行い、条件と結果をGit内に残す。

次のPhase番号は未決定。今回これらの機能タスクには着手していない。
