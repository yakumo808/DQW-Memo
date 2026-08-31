// 画面遷移とアプリ全体の状態を管理する
class AppState {
  constructor() {
    this.currentView = 'list'; // list, editor, pip
    this.selectedMemo = null;
  }

  setView(viewName) {
    this.currentView = viewName;
    // ここでUIの切り替え処理を呼ぶ（後述のUIコンポーネントで処理）
  }

  selectMemo(memo) {
    this.selectedMemo = memo;
    this.setView('editor');
  }
}

const state = new AppState();
