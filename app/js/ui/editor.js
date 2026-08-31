import { MemoRepository } from '../api.js';
import { ListUI } from './list.js';

export function initList(container) {
  ListUI(container, (id) => {
    if (!id) {
      const newMemo = { title: '', content: '' };
      MemoRepository.save(newMemo);
      renderEditor(null);
    } else {
      renderEditor(id);
    }
  });
}

function renderEditor(id) {
  const container = document.getElementById('editor-container');
  if (!container) return;
  
  container.innerHTML = `
    <div class="card">
      <h1 class="app-title">メモ編集</h1>
      <input type="text" id="memo-title" placeholder="タイトル" />
      <textarea id="memo-content" rows="12" placeholder="メモの内容を入力してください"></textarea>
      <div class="controls" style="display: flex; gap: 8px; margin-top: 12px;">
        <button id="btn-save" class="btn btn-success">保存</button>
        <button id="btn-pip" class="btn btn-primary">PiPで表示</button>
        <button id="btn-back" class="btn btn-ghost">戻る</button>
      </div>
      <div id="status" style="margin-top: 12px; font-size: 0.8rem; color: #9ca3af;"></div>
      <div id="log-box" class="log-box" style="margin-top: 12px;"></div>
    </div>
  `;

  const titleInput = container.querySelector('#memo-title');
  const contentInput = container.querySelector('#memo-content');
  const btnSave = container.querySelector('#btn-save');
  const btnBack = container.querySelector('#btn-back');
  const btnPip = container.querySelector('#btn-pip');
  const statusEl = container.querySelector('#status');
  const logBox = container.querySelector('#log-box');

  let localMemoId = null;

  if (id) {
    const m = MemoRepository.getById(id);
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
      MemoRepository.update(localMemoId, { title, content });
    } else {
      const saved = MemoRepository.save({ title, content });
      localMemoId = saved.id;
    }
    
    renderList();
    if (logBox) {
      const entry = document.createElement('div');
      entry.className = 'log-entry';
      entry.textContent = `[${new Date().toLocaleTimeString()}] 保存完了`;
      logBox.appendChild(entry);
    }
  });

  btnBack.addEventListener('click', () => {
    renderList();
  });

  btnPip.addEventListener('click', () => {
    const m = localMemoId ? MemoRepository.getById(localMemoId) : { 
      title: titleInput.value, 
      content: contentInput.value 
    };
    
    // ここでPipRendererをインスタンス化するのではなく、
    // app.js側で管理するPipRendererに渡す設計にするためのプレースホルダ
    if (logBox) {
      const entry = document.createElement('div');
      entry.className = 'log-entry';
      entry.textContent = `[${new Date().toLocaleTimeString()}] PiPボタン押下`;
      logBox.appendChild(entry);
    }
  });
}

function renderList() {
  const container = document.getElementById('list-container');
  if (!container) return;
  
  const todos = MemoRepository.getAll();
  if (todos.length === 0) {
    container.innerHTML = `<p style="text-align:center; padding:20px;">メモがありません</p>`;
    return;
  }
  container.innerHTML = todos
    .sort((a, b) => new Date(b.updated) - new Date(a.updated))
    .map(m => `
      <div class="memo-item" data-id="${m.id}">
        <div class="memo-title">${m.title || '無題'}</div>
        <div class="memo-date">${new Date(m.updated).toLocaleString()}</div>
      </div>
    `).join('');

    container.querySelectorAll('.memo-item').forEach(el => {
      el.addEventListener('click', () => initList(container)); // ここは実際には編集画面への遷移にする
    });
}
