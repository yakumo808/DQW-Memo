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

**上記の実機成功は、ユーザーから提示・承認された今回の引き継ぎ情報として確認済みです。引き継ぎ当時にCodex自身が再実行した結果ではありません。** ソースとGit履歴から実装経路を確認しましたが、ブラウザー・生成API・iPhone実機の再試験は行っていません。端末機種、iOS/Safariのバージョン、実機ログなど未提示の条件は補完しません。

詳細は [Codex引き継ぎ記録](docs/devlog/2026-09-06-codex-handoff.md) を参照してください。

現在の標準キャッシュはArrayBuffer bytesです。v0.8.3.2-devでSafari / Chromeの実機HIT計13/13（リロード後6/6）、NotFoundError・cache read fallback 0をユーザー提供資料で確認しています。根本原因の断定はしていません。現状の検証は [bytes採用記録](docs/devlog/2026-09-09-cache-bytes-adoption.md) を参照してください。

## 現在のアーキテクチャ

フロントエンドはVanilla JavaScriptのES Modules、サーバーはPython標準ライブラリと外部コマンドffmpegで構成します。

| ファイル | 役割 |
| --- | --- |
| `index.html` | アプリの入口。画面切替領域とは別にPiP用video要素を保持 |
| `app/js/app.js` | 一覧・Editorの遷移、編集中データ、キャッシュ検索、動画生成・準備・PiP開始の統括 |
| `app/js/ui/list.js` / `editor.js` | メモ一覧と編集UI |
| `app/js/api.js` | localStorageの `dqw_memo_data` にメモを保存 |
| `app/js/core/video_render_client.js` | 同一オリジンの `POST /api/render`。要求タイムアウト120秒 |
| `app/js/core/video_cache.js` | IndexedDBへのMP4 bytes保存・旧Blob読込互換・metadata-only touch・LRU削除 |
| `app/js/core/video_pip.js` | video準備とPiP開始を分離。WebKit API優先、標準PiP APIにも対応 |
| `server/render_server.py` | 静的ファイル配信、動画生成、`GET /videos/<jobId>.mp4` |

### 正式PiP経路

新規生成時：

```text
Editor（未保存のtitle/contentも利用）
  → render server
  → ffmpeg H.264 MP4
  → fetchでBlob取得
  → arrayBuffer()で動画バイト列を取得
  → IndexedDBへbytes保存・再読込確認
  → new Blob([bytes], { type })
  → Blob URL
  → iPhone Safari WebKit PiP
  → DQW上表示
```

CACHE HIT時はrenderを省略し、IndexedDBのbytesから毎回new Blobを作ってBlob URL→prepare→PiPへ進みます。旧Blob形式は読込互換のみ残し、正常なら再生、読込・準備失敗なら削除を試行してrenderへfallbackします。再生成後は同じキーをbytes形式で保存します。一括migrationは行いません。

bytes変換・保存・保存後読戻しに失敗しても、取得済みの生成Blobがあれば直接再生へ進みます。metadata更新失敗も再生を止めません。stale判定で旧準備結果を破棄し、PiP中のURLは保護します。別動画の準備は「PiP終了待ち」となり、終了後に切り替わります。

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
cd C:\AI\Projects\DQW-Memo
python server/render_server.py --host 0.0.0.0 --port 8782
```

必要な場合のみ、起動前にffmpegの実際のパスを設定します。

```powershell
$env:FFMPEG = 'C:\実際の配置先\ffmpeg.exe'
```

PCでは `http://127.0.0.1:8782/` を開きます。iPhoneは同一LANに接続し、Safariで `http://<PCのLAN IPv4アドレス>:8782/` を開きます。PCのアドレスは `ipconfig` で確認し、Windowsファイアウォール等でLANからTCP 8782への接続が許可されていることを確認してください。`0.0.0.0` は待受指定であり、iPhoneで開く宛先ではありません。

このPythonサーバーがフロントエンドと生成APIを同じオリジンで配信します。`python -m http.server` のみでは `/api/render` は動作しません。現在は認証なし・CORS全許可・リポジトリルート配信のローカル検証構成です。

今回の引き継ぎ確認では指定フォントの存在を確認しましたが、確認用シェルの `Get-Command` ではPython・ffmpeg・ffprobeを解決できませんでした。未インストールとは断定せず、実際に起動するシェルのPATHや配置先を確認してください。上記の起動手順は現コードから記載したもので、引き継ぎ当時は実行していません。

## 保存場所と動画仕様

生成ジョブは次の場所に保存します。

```text
%LOCALAPPDATA%\DQW-Memo\render-jobs\<jobId>\
  input.txt       title、空行、contentをUTF-8で保存
  generated.mp4   生成動画
  ffmpeg.log      実行コマンドとffmpeg出力
```

`LOCALAPPDATA` が未設定の場合は、ホーム配下の `AppData/Local` を使用します。起動時とrender開始時に24時間TTLのjob cleanupを行います。生成中jobを保護し、削除失敗はログを残して継続します。

IndexedDBはDB名 `DQW-Memo`、version `2`。両storeのkeyPathは `key` です。

- `videoCache`：新規保存は `bytes: ArrayBuffer`、`type`、`size`、作成時刻、幅・高さ・秒数、source、styleVersion等。旧 `blob` recordは読込互換のみ。
- `videoCacheAccess`：`key` と `lastAccessedAt`。HIT時はこのmetadataだけ更新し、bytes/Blob本体を再putしません。
- LRU上限は20件・1MiB。bytes.byteLength（旧形式はblob.size）で容量計算し、保存時に古いアクセスから削除します。専用metadataがなければ旧recordの時刻へfallback。削除・保存は両storeを同じtransactionで扱います。

キーは `title + '\n' + content + '\n' + 'v1'` で、暗号学的ハッシュではありません。オリジンやブラウザーが変わると保存領域も変わります。IndexedDBからの削除と再生中Object URLの寿命は別管理です。

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
| 文字 | NotoSansJP-VF.ttf、白・影付き。日本語自動折返し、本文28→24→22→20px、収まらない部分は省略。1画面構成 |

## Spikeとローカル資産

- `spikes/002-ios-video-pip/`：通常MP4の再生・PiP検証。`sample.mp4` はGit管理対象。READMEは当時の手順で、未記入の合格チェックや「commit前」の古い記述が残っています。
- `spikes/003-ffmpeg-memo-video/`：`memo.txt` と `drawtext.filter` による日本語動画生成検証。
- `spikes/004-indexeddb-video-cache/`：固定キー `d4a-test-video` でBlob保存・再生・削除を確認する独立画面。PiP操作はありません。

**`spikes/003-ffmpeg-memo-video/generated.mp4` は意図的にGit管理外のローカル検証資産です。削除・commitしないでください。** 現在の `.gitignore` では除外されておらず、未追跡として表示されます。一括 `git add .` を避け、追加対象を明示してください。このファイルはGitだけからは復元できません。

## 既知の技術的負債

- DB upgradeが旧タブでブロックされた場合の待機対応と、DB接続失敗Promiseの保持が残っています。
- 旧Blob互換用の診断・再試行を維持しています。bytesの長時間放置・ブラウザ終了・端末再起動後の耐久性は継続観測事項です。
- キャッシュキーと開発ログには本文が含まれます。開発ログは折りたたみ・全文コピーに対応しています。
- 長文は1画面内で折返し・縮小・省略し、複数ページ化は未対応です。
- 認証・外部公開向けの対応はありません。ローカルLAN用途です。

メモの個別削除は左スワイプでボタンを表示し、明示タップで削除します。動画キャッシュは連動削除せずLRUに任せます。過去の引き継ぎ時点の課題と解決経緯はdocs/devlogを参照してください。

## 実機回帰確認と開発ログ

次の変更では、iPhone SafariのPiP開始だけでなく、DQWを前面にした状態での表示維持まで回帰確認します。

- 動画形式、コーデック、音声、尺、解像度、faststart、ffmpeg設定。
- video要素のDOM配置・表示方法・属性、`load()`／`play()`、PiP APIの順序や待機処理。
- 準備ボタン、非同期処理、編集・画面切替・PiP終了、Blob URL解放。
- IndexedDB保存・読込、キャッシュキー、破損・容量不足時の処理。
- 配信元、URL、ポート、HTTP配信方法などアクセス経路。

少なくとも新規生成とCACHE HITの両経路、HIT時のrender API未実行、Blob URL再生、WebKit PiP、DQWへの切替を確認し、端末・OS・ブラウザー・コミット・操作・結果を記録します。

各Phaseまたは大きな変更の完了時には `docs/devlog/` にMarkdownを残します。最低限、目的、変更ファイル、実装内容、検証結果、実機確認、失敗・迷走、Git状態、次の課題を記録します。引き継いだ成功報告と自分で実行した検証を区別し、未検証事項は明記してください。
