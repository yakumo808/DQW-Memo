// @ts-check
import { memoRepo } from '../api.js';
import { ListUI } from './list.js';

export function initList(container) {
  ListUI(container, (id) => {
    if (!id) {
      const newMemo = { title: '', content: '' };
      memoRepo.save(newMemo);
      renderEditor(id, null);
    } else {
      renderEditor(id, id);
    }
  });
}

function renderEditor(id, currentId) {
  const container = document.getElementById('editor-container');
  if (!container) return;
  
  // Clear current view
  container.innerHTML = '';
  
  // Editor UI
  const editor = document.createElement('div');
  editor.className = 'card';
  editor.innerHTML = `
    <h1 class="app-title">メモ編集</h1>
    <input type="text" id="memo-title" placeholder="タイトル" />
    <textarea id="memo-content" rows="12" placeholder="メモの内容を入力してください"></textarea>
    <div class="controls" style="display: flex; gap: 8px; margin-top: 12px;">
      <button id="btn-save" class="btn btn-success">保存</button>
      <button id="btn-pip" class.btn btn-primary>PiPで表示</button>
      <button id="btn-back" class.btn btn-ghost">戻る</button>
    </div>
    <div id="status" style="margin-top: 12px; font-size: 0.8rem; color: #9ca3af;"></div>
    <div id="log-box" class="log-box" style="margin-top: 12px;"></div>
  `;
  container.appendChild(editor);

  const titleInput = editor.querySelector('#memo-title');
  const contentInput = editor.querySelector('#memo-content');
  const btnSave = editor.querySelector('#btn-save');
  const btnBack = editor.querySelector('#btn-back');
  const btnPip = editor.querySelector('#btn-pip');
  const statusEl = editor.querySelector('#status');
  const logBox = editor.querySelector('#log-box');

  let localMemoId = currentId;

  if (currentId) {
    const m = memoRepo.getById(currentId);
    if (m) {
      titleInput.value = m.title;
      contentInput.value = m.content;
      localMemoId = m.id;
    }
  }

  btnSave.addEventListener('click', () => {
    const title = titleInput.value;
    const content = contentInput.value;

    if (localMemoId) {
      memoRepo.update(localMemoId, { title, content });
    } else {
      const saved = memoRepo.save({ title, content });
      localMemoId = saved.id;
    }
    
    // Update local state
    window.currentMemoId = localMemoId;
    
    // UI refresh
    renderList();
    addLog(`保存完了: ${localMemoId}`);
  });

  btnBack.addEventListener('click', () => {
    window.currentMemoId = null;
    renderList();
  });

  btnPip.addEventListener('click', () => {
    // This is handled by the app's PipRenderer integration
    // For now, we'll just log it.
    addLog('PiPボタン押下');
  });
}
