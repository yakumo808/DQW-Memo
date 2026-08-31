import { state } from './core/app_state.js';
import { ListUI } from './ui/list.js';
import { EditorUI } from './ui/editor.js';
import { PipRenderer } from './core/pip.js';
import { MemoRepository } from './api.js';

const appContainer = document.getElementById('app');
let renderer = null;

const render = () => {
  appContainer.innerHTML = '';
  if (state.currentView === 'list') {
    ListUI(appContainer, (id) => {
      if (!id) {
        const newMemo = { title: '', content: '' };
        const saved = MemoRepository.save(newMemo);
        state.selectMemo(saved);
        render(); // Added render() call
      } else {
        const m = MemoRepository.getById(id);
        state.selectMemo(m);
        render(); // Added render() call
      }
    });
  } else if (state.currentView === 'editor') {
    EditorUI(appContainer, state.selectedMemo, {
      onBack: () => {
        state.setView('list');
        render();
      },
      onSaved: (savedMemo) => {
        render();
      },
      onPip: (memo) => {
        if (!renderer) {
          renderer = new PipRenderer('pip-canvas', 'pip-video');
          renderer.init();
        }
        renderer.render(memo);
        renderer.startPip();
      }
    });
  }
};

// 初期表示
render();
