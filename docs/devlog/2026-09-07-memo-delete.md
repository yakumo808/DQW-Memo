# メモ履歴の個別削除

## 目的・変更ファイル

2026-09-07。一覧の左スワイプで削除ボタンを開き、明示的なタップで対象だけを削除する。

- app/js/ui/list.js: Pointer Eventsによる開閉と削除ボタン、既存delete API呼出、一覧更新。
- app/css/style.css: 88px幅の赤い削除ボタンと前面行の移動、縦パン許可。
- app/js/app.js: 削除通知時にselectedMemo/editorDraftを解除しready状態を無効化。
- tests/memo-delete.cjs: 実Chromeのマウス/タッチ/キーボードと削除検証。
- docs/devlog/2026-09-07-memo-delete.md: 本記録。

## 実装・スワイプ方針

12px以上移動して横成分が縦の1.5倍を超えた場合だけ横操作へ固定。横48pxで左は開く、右は閉じる。横操作時のみpointer captureを使用。touch-action: pan-y pinch-zoomで縦スクロールと拡大をブラウザに任せる。
移動・pointercancel後のclickは抑止して誤Editor遷移を防止。スワイプだけでは削除しない。開ける行は1件だけ。他項目やカード上の操作で開いた行を閉じる。他項目の通常タップは既存どおりEditorも開く。
マウスドラッグ対応。キーボードでは行にフォーカスして左矢印で開き、削除ボタンへフォーカス。右矢印/Escapeで閉じる。

## 削除処理・失敗時

既存MemoRepository.delete(id)を使用し、対象IDのみlocalStorageから削除する。成功後に一覧を即再描画し先頭行または新規ボタンへフォーカス。ストレージ書込例外なら一覧を消さずエラーを表示。
appへの通知で古い選択・Editor draft・準備状態を解除する。既存invalidateReadyStateを使用するため、使用中PiP URLの保護方針は変えない。
動画キャッシュは連動削除せずLRU管理に任せる。render/IndexedDB/PiPの実装変更なし。

## Desktop検証

- memo-delete.cjs: 390/1280pxで左スワイプ表示、スワイプのみでは削除なし、右戻し、他項目操作、縦方向誤判定なし。
- 先頭/中央/最後をそれぞれ削除し、他IDの保持を確認。最後の1件削除、空一覧、selectedMemo解除、新規作成/保存/再編集PASS。
- キーボード開閉、横はみ出しなし、pageErrors=0。
- Chrome DevToolsの実タッチ入力で左スワイプ表示、縦操作によるscrollY増加、縦操作で削除UIが開かないことPASS。
- video-lifecycle.cjs既存7群PASS。実MISS/HIT/PiP、一覧遷移、終了待ち、古い状態破棄。URL生成8/解放8、不適切revokeなし。
- mobile-ui.cjs 320/390/768/1280pxで全PASS。
- node --check (list.js/app.js/memo-delete.cjs)、git diff --check PASS。

再現: `node tests/memo-delete.cjs`。既存puppeteer-coreとChrome、独立localStorageを使用。ユーザーの実メモは削除しない。
今回、再生中メモ自体の削除を伴う実PiPケースとストレージ書込障害注入は未検証。既存寿命管理回帰とは区別する。

## 実機確認・次の課題

iPhone Safari未確認。スワイプ閾値の自然さ、斜め/縦スクロール、右へ戻す操作、他項目タップ、削除タップ後の空一覧/編集を確認したい。PiP中に一覧へ戻ってそのメモを削除してもPiPが継続し、別メモへ古い状態が引き継がれないことも実機確認対象。
復元・一括削除・検索等は対象外。大規模UI再設計なし。

## Git状態

開始HEAD: 653f0d169ae2172b70c935bc9b881c1bfc3a12ad (main)。上記5ファイルのみ変更・追加。commit/push未実施。
spikes/003-ffmpeg-memo-video/generated.mp4は未追跡のまま保持。

## iPhoneスワイプ不具合への追補（2026-09-07）

ユーザー実機で左スワイプが反応せず、削除ボタンが出ないとの報告。上記Chrome PASSはSafari実機の成功を意味しない。
実機のイベントトレースは未取得で、pointercancelの発生やSafariの処理順序が原因とは断定できない。実コード上はPointer Eventsだけに依存し、12px時点で斜め移動も縦へ固定、48px到達前にpointercancelされると認識できない構造だった。

今回の追加変更はlist.js、memo-delete.cjs、本ログのみ。
タッチはTouch Events専用経路、マウス/ペンは既存Pointer Events経路として二重処理を回避。touch由来pointercancelはタッチ状態を破棄しない。
touchstart/end/cancelはpassive、touchmoveは明示的にpassive:false。横方向確定時のみcancelableを確認してpreventDefault。縦・方向未確定・通常タップ・複数指は抑止しない。CSSのpan-y pinch-zoomは維持。
タッチ方向判定は8px・横/縦比1.25、開閉36px。曖昧な斜めは未確定を維持する。マウス閾値は変更なし。
イベント対象の子要素に依存せず、リスナーを付けたfrontを使用。削除ボタンはfrontの兄弟で、Touch処理対象外。カード外側閉じる判定にtouchstartも追加。

検証: 390/1280pxの削除全ケース・マウス・キーボードPASS。Chrome実タッチで横スワイプと縦スクロールPASS。合成Touch Eventsではpointercancel併発後も開閉でき、横のみdefaultPrevented=true、縦はfalseを確認。pageErrors=0。node --check、git diff --check PASS。
既存の削除/状態解除/app側処理には今回追加変更なし。iPhone修正完了は未確認、commit/pushなし。

実機再確認: server配信中のページを再読み込みしてから、行中央付近から左へ36px以上操作。タイトル/日付のどちらからも開くか、右戻し、斜め/縦スクロール、複数指ズーム、タップ編集、削除ボタンの対象限定を確認。PiP再生中の削除確認も引き続き未完了。

## 開発用バージョン表示

追加要望により一覧の「DQWメモ」横へ小さな `v0.8.1-dev` を表示。定義はapp/js/ui/list.js冒頭のDEV_VERSION定数に集約し、節目で手動更新する。CSSは12px相当、淡色、見出し内の折り返しを許容。
320/390/1280pxでバージョン表示と画面幅への収まりを確認し、スワイプ・削除・タッチ縦スクロール・pointercancel併発回帰も全PASS。node構文とgit diff --check PASS。iPhone実機は再確認待ち。commit/pushなし。
固定表示は読み込まれた一覧UIの識別用で、全ファイルのキャッシュ更新を自動保証するものではない。今回の実機再確認では一覧にv0.8.1-devが見えることを確認してから操作する。

## 左スワイプ削除・バージョン表示の実機PASS

ユーザーよりiPhone Safari / Chrome双方で正常動作との報告を受領。左スワイプで削除表示、スワイプのみでは削除されず、削除タップで対象だけ削除。操作性に問題なし。
メモ履歴をすべて削除しても再生中PiP小窓を維持し、PiP終了後に別メモを正常利用できた。左スワイプ削除機能を実機PASSとして扱う。DQWメモ v0.8.1-dev表示も両ブラウザで確認済み。
Codex自身の実機操作ではなくユーザー報告に基づく。commit/pushは未実施。
別件としてCACHE HIT後のmetadata未確立から再生成fallbackする現象を受領。削除機能のPASSと分離して原因調査する。
