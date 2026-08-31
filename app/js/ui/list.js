// @ts-check
import { MemoRepository } from '../api.js';
import { PipRenderer } from '../core/pip.js';

/**
 * メモ一覧を表示するコンポーネント
 */
export function ListUI(container, onSelect) {
  container.innerHTML = `
    <div class="card">
      <h1 class="app-title">DQWメモ</h1>
      <button id="btn-new" class="btn btn-primary">新規メモ</button>
      <div id="memo-list-container"></div>
    </div>
  `;

  const listContainer = container.querySelector('#memo-list-container');
  const btnNew = container.querySelector('#btn-new');

  const render = () => {
    const todos = MemoRepository.getAll();
    if (todos.length === 0) {
      listContainer.innerHTML = `<p style="text-align:center; padding:20px;">メモがありません</p>`;
      return;
    }
    listContainer.innerHTML = todos
      .sort((a, b) => new Date(b.updated) - new Date(a.updated))
      .map(m => `
        <div class.memo-item" data-id="${m.id}">
          <div class.memo-title">${m.title || '無題'}</div>
          <div class.memo-date">${new Date(m.updated).toLocaleString()}</div>
        </div>
      `).join('');

    listContainer.querySelectorAll('.memo-item').forEach(el => {
      el.addEventListener('click', () => onSelect(el.dataset.id));
    });
  };

  btnNew.addEventListener('click', () => {
    onSelect(null);
  });

  render();
}
