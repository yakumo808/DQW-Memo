// @ts-check
import { MemoRepository } from '../api.js';

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
    listContainer.replaceChildren();
    todos
      .sort((a, b) => new Date(b.updated) - new Date(a.updated))
      .forEach(m => {
        const item = document.createElement('div');
        item.className = 'memo-item';
        item.dataset.id = m.id;

        const title = document.createElement('div');
        title.className = 'memo-title';
        title.textContent = m.title || '無題';

        const date = document.createElement('div');
        date.className = 'memo-date';
        date.textContent = new Date(m.updated).toLocaleString();

        item.append(title, date);
        item.addEventListener('click', () => onSelect(m.id));
        listContainer.appendChild(item);
      });
  };

  btnNew.addEventListener('click', () => {
    onSelect(null);
  });

  render();
}
