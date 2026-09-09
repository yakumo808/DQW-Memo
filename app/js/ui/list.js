// @ts-check
import { MemoRepository } from '../api.js';

// Update manually at development milestones to identify the loaded UI build.
export const DEV_VERSION = 'v0.9.0-dev';

/**
 * メモ一覧を表示するコンポーネント
 */
export function ListUI(container, onSelect, onDeleted = () => {}) {
  container.innerHTML = `
    <div class="card">
      <h1 class="app-title memo-heading">DQWメモ <small class="dev-version">${DEV_VERSION}</small></h1>
      <button id="btn-new" class="btn btn-primary">新規メモ</button>
      <div id="memo-list-container"></div>
    </div>
  `;

  const listContainer = container.querySelector('#memo-list-container');
  const btnNew = container.querySelector('#btn-new');

  let opened = null;
  const close = () => {
    if (opened) {
      opened.classList.remove('delete-open');
      opened.querySelector('.memo-delete').disabled = true;
      opened = null;
    }
  };
  const closeOutside = event => {
    if (opened && !opened.contains(event.target)) close();
  };
  container.querySelector('.card').addEventListener('pointerdown', closeOutside);
  container.querySelector('.card').addEventListener('touchstart', closeOutside, { passive: true });

  const render = () => {
    close();
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

        const front = document.createElement('div');
        front.className = 'memo-front';
        front.tabIndex = 0;
        front.setAttribute('role', 'button');
        front.setAttribute('aria-label', (m.title || '無題') + 'を編集。左矢印で削除ボタンを表示');
        front.append(title, date);
        const remove = document.createElement('button');
        remove.className = 'memo-delete';
        remove.textContent = '削除';
        remove.setAttribute('aria-label', (m.title || '無題') + 'を削除');
        remove.disabled = true;
        const open = () => {
          close();
          opened = item;
          item.classList.add('delete-open');
          remove.disabled = false;
        };
        let gesture = null;
        let suppressClick = false;
        front.addEventListener('pointerdown', event => {
          if (event.pointerType === 'touch' || !event.isPrimary || event.button !== 0) return;
          suppressClick = false;
          gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, axis: null };
        });
        front.addEventListener('pointermove', event => {
          if (event.pointerType === 'touch' || !gesture || event.pointerId !== gesture.id) return;
          const dx = event.clientX - gesture.x;
          const dy = event.clientY - gesture.y;
          if (!gesture.axis && Math.max(Math.abs(dx), Math.abs(dy)) > 12) {
            gesture.axis = Math.abs(dx) > Math.abs(dy) * 1.5 ? 'x' : 'y';
            suppressClick = true;
            if (gesture.axis === 'x') front.setPointerCapture(event.pointerId);
          }
          if (gesture.axis === 'x' && Math.abs(dx) >= 48) {
            if (dx < 0) open(); else close();
          }
        });
        const finish = () => { gesture = null; };
        front.addEventListener('pointerup', event => { if (event.pointerType !== 'touch') finish(); });
        front.addEventListener('pointercancel', event => {
          if (event.pointerType !== 'touch') { suppressClick = true; finish(); }
        });
        // Touch has its own stream: a browser pointercancel must not erase it.
        let touchGesture = null;
        front.addEventListener('touchstart', event => {
          suppressClick = false;
          if (event.touches.length !== 1) { touchGesture = null; return; }
          const touch = event.touches[0];
          touchGesture = { id: touch.identifier, x: touch.clientX, y: touch.clientY, axis: null };
        }, { passive: true });
        front.addEventListener('touchmove', event => {
          if (!touchGesture) return;
          if (event.touches.length !== 1) { touchGesture = null; suppressClick = true; return; }
          const touch = Array.from(event.touches).find(t => t.identifier === touchGesture.id);
          if (!touch) return;
          const dx = touch.clientX - touchGesture.x;
          const dy = touch.clientY - touchGesture.y;
          if (!touchGesture.axis && Math.max(Math.abs(dx), Math.abs(dy)) >= 8) {
            // Ambiguous diagonals remain undecided; never lock them to vertical early.
            if (Math.abs(dx) > Math.abs(dy) * 1.25) touchGesture.axis = 'x';
            else if (Math.abs(dy) > Math.abs(dx) * 1.25) touchGesture.axis = 'y';
            suppressClick = true;
          }
          if (touchGesture.axis !== 'x') return;
          if (event.cancelable) event.preventDefault();
          if (Math.abs(dx) >= 36) {
            if (dx < 0) open(); else close();
          }
        }, { passive: false });
        front.addEventListener('touchend', () => { touchGesture = null; }, { passive: true });
        front.addEventListener('touchcancel', () => {
          touchGesture = null;
          suppressClick = true;
        }, { passive: true });
        front.addEventListener('click', () => {
          if (suppressClick) { suppressClick = false; return; }
          if (opened === item) { close(); return; }
          onSelect(m.id);
        });
        front.addEventListener('keydown', event => {
          if (event.key === 'ArrowLeft') { event.preventDefault(); open(); remove.focus(); }
          if (event.key === 'ArrowRight' || event.key === 'Escape') { close(); }
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(m.id); }
        });
        remove.addEventListener('keydown', event => {
          if (event.key === 'Escape' || event.key === 'ArrowRight') { close(); front.focus(); }
        });
        remove.addEventListener('click', () => {
          try {
            MemoRepository.delete(m.id);
          } catch (error) {
            window.alert('削除できませんでした。もう一度お試しください。');
            return;
          }
          onDeleted(m.id);
          render();
          (listContainer.querySelector('.memo-front') || btnNew).focus();
        });
        item.append(remove, front);
        listContainer.appendChild(item);
      });
  };

  btnNew.addEventListener('click', () => {
    onSelect(null);
  });

  render();
}
