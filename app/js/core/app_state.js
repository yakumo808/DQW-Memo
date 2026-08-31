class AppState {
  constructor() {
    this.currentView = 'list'; // list, editor, pip
    this.selectedMemo = null;
  }

  setView(viewName) {
    this.currentView = viewName;
  }

  selectMemo(memo) {
    this.selectedMemo = memo;
    this.setView('editor');
  }
}

// 状態を外部から利用可能にするための単一インスタンス
export const state = new AppState();
