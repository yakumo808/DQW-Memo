# DQW-Memo

DQWを操作しながらメモを参照するためのWebアプリです。Editorのテキストを動画に変換し、iPhone SafariのシステムPicture-in-Picture（PiP）でDQW上に表示します。

このプロジェクトでは、Gitリポジトリ実体と `docs/devlog/` を一次情報とします。過去会話の推測で状態を補完しません。

## 基準状態と到達点

2026-09-06の引き継ぎ基準は `89bc6d5fedd60c743c52f7f152ee0eb85e021db5` です。引き継ぎ時の `main` のHEADとローカルの `origin/main` は一致し、追跡ファイルに未コミット変更はありませんでした。リモートへのfetchは実施していません。

| 段階 | コミット | 到達点 |
| --- | --- | --- |
| Phase 3.1 | `64cafa1` | 通常H.264 MP4 → iPhone Safari WebKit PiP → DQW上表示に成功 |
| Phase 3.2 D-3B | `bca3e27` | Editorのtitle/content → Python render server → ffmpeg H.264 MP4生成 → iPhone Safari PiP → DQW上表示に成功 |
| Phase 3.2 D-4 | `89bc6d5` | IndexedDBへのMP4 Blob保存 → CACHE HIT時はrender API再実行なし → Blob URL再生 → iPhone Safari WebKit PiP → DQW上表示に成功 |

**上記の実機成功は、ユーザーから提示・承認された今回の引き継ぎ情報として確認済みです。今回Codex自身が再実行した結果ではありません。** ソースとGit履歴から実装経路を確認しましたが、ブラウザー・生成API・iPhone実機の再試験は行っていません。端末機種、iOS/Safariのバージョン、実機ログなど未提示の条件は補完しません。

詳細は [Codex引き継ぎ記録](docs/devlog/2026-09-06-codex-handoff.md) を参照してください。

## 現在のアーキテクチャ

フロントエンドはVanilla JavaScriptのES Modules、サーバーはPython標準ライブラリと外部コマンドffmpegで構成します。

| ファイル | 役割 |
| --- | --- |
| `index.html` | アプリの入口。画面切替領域とは別にPiP用video要素を保持 |
| `app/js/app.js` | 一覧・Editorの遷移、編集中データ、キャッシュ検索、動画生成・準備・PiP開始の統括 |
| `app/js/ui/list.js` / `editor.js` | メモ一覧と編集UI |
| `app/js/api.js` | localStorageの `dqw_memo_data` にメモを保存 |
| `app/js/core/video_render_client.js` | 同一オリジンの `POST /api/render`。要求タイムアウト120秒 |
| `app/js/core/video_cache.js` | IndexedDBへのMP4 Blob保存・読込・削除 |
| `app/js/core/video_pip.js` | video準備とPiP開始を分離。WebKit API優先、標準PiP APIにも対応 |
| `server/render_server.py` | 静的ファイル配信、動画生成、`GET /videos/<jobId>.mp4` |

### 正式PiP経路

新規生成時：

```text
Editor（未保存のtitle/contentも利用）
  → render server
  → ffmpeg H.264 MP4
  → fetchでBlob取得
  → IndexedDBへ保存・再読込
  → Blob URL
  → iPhone Safari WebKit PiP
  → DQW上表示
```

CACHE HIT時はrender serverへの生成要求を省略し、IndexedDB内のBlobからBlob URLを作成します。読み出した動画の準備に失敗した場合は、該当キャッシュを削除して再生成を試みます。

メモ本文の保存先はlocalStorage、動画の保存先はIndexedDBであり、別の保存領域です。旧canvas.captureStream／MediaStreamとfloating関連コードは残っていますが、現在の本体の正式PiP経路には使いません。

### 動画準備とPiP開始を分離する理由

最初の「動画を準備」でキャッシュ検索・必要な生成・videoのメタデータ読込を済ませ、準備完了後の別タップ「PiPで表示」で `play()` とPiP APIを呼びます。長い非同期生成処理をPiP開始操作から分離し、ユーザー操作を起点とする開始経路を保つためです。PiP開始時は再度 `load()` せず、`readyState >= 1` と `videoWidth > 0` を確認します。

## 必要環境と起動

- Python：サーバーは標準ライブラリを使用します。動作確認済みの具体的バージョンは未記録です。
- ffmpeg：`libx264`、AAC、drawtext、lavfiを利用できるビルド。PATH上の `ffmpeg`、または環境変数 `FFMPEG` で実行ファイルを指定します。
- 日本語フォント：現実装は `C:/Windows/Fonts/NotoSansJP-VF.ttf` を固定参照します。
- iPhone Safariと、同一LANに接続されたサーバーPC。

Windows PowerShellでリポジトリルートから起動します。

```powershell
cd C:\Users\shiny\Desktop\DQW-Memo
python server/render_server.py --host 0.0.0.0 --port 8782
```

必要な場合のみ、起動前にffmpegの実際のパスを設定します。

```powershell
$env:FFMPEG = 'C:\実際の配置先\ffmpeg.exe'
```

PCでは `http://127.0.0.1:8782/` を開きます。iPhoneは同一LANに接続し、Safariで `http://<PCのLAN IPv4アドレス>:8782/` を開きます。PCのアドレスは `ipconfig` で確認し、Windowsファイアウォール等でLANからTCP 8782への接続が許可されていることを確認してください。`0.0.0.0` は待受指定であり、iPhoneで開く宛先ではありません。

このPythonサーバーがフロントエンドと生成APIを同じオリジンで配信します。`python -m http.server` のみでは `/api/render` は動作しません。現在は認証なし・CORS全許可・リポジトリルート配信のローカル検証構成です。

今回の引き継ぎ確認では指定フォントの存在を確認しましたが、確認用シェルの `Get-Command` ではPython・ffmpeg・ffprobeを解決できませんでした。未インストールとは断定せず、実際に起動するシェルのPATHや配置先を確認してください。上記の起動手順は現コードから記載したもので、今回は実行していません。

## 保存場所と動画仕様

生成ジョブは次の場所に保存します。

```text
%LOCALAPPDATA%\DQW-Memo\render-jobs\<jobId>\
  input.txt       title、空行、contentをUTF-8で保存
  generated.mp4   生成動画
  ffmpeg.log      実行コマンドとffmpeg出力
```

`LOCALAPPDATA` が未設定の場合は、ホーム配下の `AppData/Local` を使用します。ジョブの自動削除処理はありません。

IndexedDBはDB名 `DQW-Memo`、バージョン `1`、store名 `videoCache`、keyPath `key` です。キーは現状 `title + '\n' + content + '\n' + 'v1'` の文字列で、暗号学的ハッシュではありません。Blob、MIME、作成日時、幅・高さ・秒数、source、styleVersionを保存します。アクセス先のオリジンを変えると、同じブラウザーでも保存領域が変わる点に注意してください。

生成動画の設定：

| 項目 | 設定 |
| --- | --- |
| 解像度 | 640×360 |
| フレームレート | 30fps |
| 映像 | H.264 High（libx264） |
| ピクセル形式 | yuv420p |
| 音声 | AAC無音、48kHzステレオ、96kbps |
| MP4配置 | faststart |
| 長さ | 4秒の設定。video側はloop再生 |
| 文字 | NotoSansJP-VF.ttf、28px、白、中央配置、影付き |

## Spikeとローカル資産

- `spikes/002-ios-video-pip/`：通常MP4の再生・PiP検証。`sample.mp4` はGit管理対象。READMEは当時の手順で、未記入の合格チェックや「commit前」の古い記述が残っています。
- `spikes/003-ffmpeg-memo-video/`：`memo.txt` と `drawtext.filter` による日本語動画生成検証。
- `spikes/004-indexeddb-video-cache/`：固定キー `d4a-test-video` でBlob保存・再生・削除を確認する独立画面。PiP操作はありません。

**`spikes/003-ffmpeg-memo-video/generated.mp4` は意図的にGit管理外のローカル検証資産です。削除・commitしないでください。** 現在の `.gitignore` では除外されておらず、未追跡として表示されます。一括 `git add .` を避け、追加対象を明示してください。このファイルはGitだけからは復元できません。

## 既知の技術的負債

以下は基準コミットのコード確認に基づく事項です。今回、障害の動的再現はしていません。

1. **非同期処理と編集の競合**：`app.js` の `currentSignature() !== makeSignature(editorDraft)` は現在データ同士の比較であり、開始時からの変更を検出できません。キャッシュ検索後にdraftを読み直すため、検索待ち中の編集によって旧キーに新内容の動画を保存する可能性もあります。
2. **キャッシュ障害時の再生経路不足**：保存失敗後もIndexedDB再取得が必須です。取得済みBlobの直接再生への切替がなく、DB接続失敗のPromiseも保持されます。
3. **画面・PiP・Blob URLの寿命管理**：メモ切替で前の準備状態が表示され得ます。PiP中の編集・画面移動・URL解放の扱いを整理する必要があります。
4. **キャッシュ管理**：キーは本文を含む文字列でログにも出ます。容量上限・期限・自動整理・本体の削除UIがありません。
5. **長文表示**：固定文字サイズで、自動折返し・ページ分割がありません。
6. **サーバーの堅牢性**：ffmpeg実行の時間制限・同時実行制限・ジョブ掃除がありません。配列やnullのJSONに対する型検査も不足しています。認証・配信範囲も検証用途の構成です。
7. **検証資産**：Git管理された現行の回帰テストと、条件付きの実機結果記録が不足しています。Git管理外の `scripts/` の過去Chrome結果は現HEADの再試験証拠ではありません。

## 実機回帰確認と開発ログ

次の変更では、iPhone SafariのPiP開始だけでなく、DQWを前面にした状態での表示維持まで回帰確認します。

- 動画形式、コーデック、音声、尺、解像度、faststart、ffmpeg設定。
- video要素のDOM配置・表示方法・属性、`load()`／`play()`、PiP APIの順序や待機処理。
- 準備ボタン、非同期処理、編集・画面切替・PiP終了、Blob URL解放。
- IndexedDB保存・読込、キャッシュキー、破損・容量不足時の処理。
- 配信元、URL、ポート、HTTP配信方法などアクセス経路。

少なくとも新規生成とCACHE HITの両経路、HIT時のrender API未実行、Blob URL再生、WebKit PiP、DQWへの切替を確認し、端末・OS・ブラウザー・コミット・操作・結果を記録します。

各Phaseまたは大きな変更の完了時には `docs/devlog/` にMarkdownを残します。最低限、目的、変更ファイル、実装内容、検証結果、実機確認、失敗・迷走、Git状態、次の課題を記録します。引き継いだ成功報告と自分で実行した検証を区別し、未検証事項は明記してください。
