# 複数ページPiP動画（v0.9.0-dev）

## 目的・実装
攻略メモの1textareaを維持し、単独行 --- page --- で最大6手動ページ。完全一致、CRLF/CRをLFへ正規化、空ページも数える。フロントとAPI双方で7ページ以上を拒否する。
サーバーは既存のwrap_text（保守的1em幅、改行と結合文字を保持）で描画行を作る。タイトル領域・余白を引いた高さを行送りで割ってcapacity算出。既存28/24/22/20pxから選択し、20pxでも収まらなければcapacityごとに分割する。本文は省略せず、自動総ページ数は6超可。タイトルは従来同様最大2行で各ページに繰り返す。
ffmpegのdrawtextに時間区間gte/ltを付け、単一color入力から全ページを1本に生成。総尺=pages×pageSeconds、640x360/30fps/H.264 High/yuv420p/AAC無音/faststartを維持。videoの既存loopを利用し複数周は生成しない。pages.filterファイルを読み、コマンド長依存を回避する。

## UI・API・キー
表示秒数2/3/4/5、初期3。メモ保存にも含め、旧メモは3として読む。変更はgenerationを無効化し、requestに秒数を固定する。
改ページコピーと既存ログコピーはclipboard.jsで共通化。Clipboard APIなしの場合は同期textarea/execCommand fallback。直接挿入なし。
POST /api/renderのpageSecondsは省略時3。responseへpageCount/pageSecondsを追加しdurationは総尺。7手動ページ/不正秒数は400。
キーはJSON配列[pages-v2,title,全content,pageSeconds]。内容の順序・区切り・秒数・styleを区別し、改行による曖昧な連結も回避。旧キャッシュ形式の読込互換は維持するが旧v1キーは新レイアウトで再利用しない。LRUに任せ一括削除しない。

## 変更ファイル
README.md、app/js/app.js、app/js/core/video_render_client.js、app/js/ui/editor.js、app/js/ui/list.js、新規app/js/ui/clipboard.js、server/render_server.py。
新規tests/render_pages.py、tests/multipage.cjs。既存tests/video-prepare-race.cjs（キー期待値）、tests/render_job_cleanup.py（API追加fieldと初期3秒）、tests/memo-delete.cjsとtests/video-metadata-retry.cjs（版表示期待値）。本ログ。

## Desktop検証
Chrome152とffmpeg9/Python、隔離jobとブラウザデータで検証。
- render_pages: 1/2/6手動、7拒否、長文行保持、手動内自動分割、総6超、2/3/4/5秒実MP4、総フレーム数、映像仕様、ページ境界前後のフレーム差を検証PASS。
- multipage: 実2ページ生成、6秒総尺、bytes HIT/render0、秒数変更別生成、実PiP、一時停止/再開、末尾から先頭loop、7ページUI/API400、秒数変更中stale、秒数保存、改ページClipboard/HTTP fallback、320/390/1280幅PASS。
- fallback17グループ、LRU全件、競合13、寿命管理7（URL生成8/解放8、不適切0）、旧Blob診断全件、削除UI、mobile UI/ログコピー全幅PASS。
- cleanup12件、既存text_layout6件PASS。旧text_layout関数は過去単ページレイアウトの回帰用に保持し、本番生成はpage_layoutsを使用。

## 失敗・修正
ffmpeg9では旧filter_script:vオプションが削除済みだったため-/filter:vへ変更。対応ビルドが必要。H.264の同一ページフレームは非可逆圧縮でバイト一致しないため、描画内容検証は画素差の許容値とページ間差で比較するようテスト修正。cleanupテストの旧4秒固定期待値を新API初期3秒へ更新。

## 既存機能・移行
bytes保存、metadata-only touch、LRU、fallback、stale、PiP保護、Object URL寿命管理を維持。video_pip.jsとvideo_cache.jsは変更なし。新たな固定LAN URL/PC固有パスなし。既存フォント設定等のクラウド移行は今回行わない。

## 実機未確認・次の課題
iPhone Safari / Chromeでv0.9.0-devを確認し、手動3ページ×3秒の9秒切替/loop、PiP一時停止固定・再開、DQW上の表示維持を試す。6/7手動ページ、長文自動分割、日本語改行、コピー、秒数変更後の再準備/HIT、PiP中の別動画準備も確認する。
自動ページ数増加に伴う生成時間/動画サイズ増加、既存120秒APIタイムアウトと1MiBキャッシュ制限は維持。上限超過時は既存直接再生。長い動画のiPhone実用性は未確認。

## Git状態
開始main HEAD fbc52931e8c6797c4f0683fcf50a659eb3869148。開始時はgenerated.mp4のみ未追跡。stage/commit/pushなし。spikes/003-ffmpeg-memo-video/generated.mp4を未追跡のまま保持。

## iPhone実機回帰結果（v0.9.0-dev）
一次資料: DQW-Memo_v0.9.0_iPhone_multipage_verification.txt。ユーザー提供の検証まとめと実機操作報告を確認した結果であり、Codexが今回iPhone操作を再実行したものではない。上記「実機未確認」はDesktop検証完了時点の記録として残す。

Safari（ENV browser=Safari、ENV app=v0.9.0-dev）:
- 3ページ・3秒でCACHE MISS、render、bytes保存、POST-SAVE VERIFY、PiP開始成功。
- 同一内容・同一3秒設定の後続CACHE HITでFORMAT=bytes、BYTES READ OK、BLOB REBUILT FROM BYTES、PiP開始成功。
- 2秒・5秒への変更はそれぞれCACHE MISSとなり、bytes保存・verify・PiP成功。旧秒数キャッシュの誤HITなし。
- 手動区切りを外した長文も生成成功。自動ページ分割とPiP表示を実機で確認。

Chrome（ENV browser=Chrome、ENV app=v0.9.0-dev）:
- 3ページ・3秒でCACHE MISS、render、bytes保存、POST-SAVE VERIFY、PiP開始成功。
- 2秒への変更でCACHE MISS、bytes保存・verify・PiP成功。

ユーザーの実機操作で、3ページ×3秒の自動切替、最終ページから先頭へのloop、PiP一時停止によるページ固定と再開によるページ送り、DQW上の表示維持を確認。2秒／5秒変更、旧秒数キャッシュの誤再利用なし、長文自動分割、改ページコピー、PiP中の別動画準備、旧PiP終了待ちとObject URL寿命管理も問題なし。
提供ログ範囲ではNotFoundError 0、cache read fallback 0、PiP開始失敗 0。全ブラウザ×全秒数の網羅試験ではない。ログにない時刻・追加件数は記録しない。

評価: Safari / Chrome実機で複数ページ方式は採用候補としてPASS。
採用仕様は1つのtextarea、単独行「--- page ---」、手動最大6ページ、自動分割後6超可、2/3/4/5秒（初期3秒）、1周分MP4とvideo loop、PiP一時停止／再生によるページ操作、bytesキャッシュ維持。

## 実機結果追記後のcommit前監査
変更は複数ページ生成・入力補助・秒数設定・キーとstale整合・共通コピー処理・対応テスト／文書に分類できる。video_cache.js / video_pip.js自体は変更していない。
READMEの仕様説明は概ね整合するが、PiP一時停止／再開の「iPhone実機確認待ち」は今回結果に対して古い。今回は報告のみとしREADMEを変更しない。
本番処理に固定LAN URLや新しいPC固有パス依存の追加はない。新規DesktopテストにはWindows Chromeの既定パス、ffprobe.exe、ローカル検証ポートがあり、本番依存とは区別する。既存Windowsフォント設定等のクラウド対応は引き続き別課題。
旧text_layoutは回帰テスト用に保持。page_layoutsは入力検証と実生成で重複計算されるが、今回削除／整理しない。
stage / commit / pushは行わず、generated.mp4は除外・未追跡保持。推奨commit対象は本項追記を含む14ファイル。
