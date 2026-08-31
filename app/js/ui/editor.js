// @ts-check
import { MemoRepository } from '../api.js';

/**
 * メモ編集画面コンポーネント
 */
export function EditorUI(container, memo, callbacks) {
  let localMemoId = null;

  const render = () => {
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

    if (memo) {
      titleInput.value = memo.title;
      contentInput.value = memo.content;
      localMemoId = memo.id;
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
      if (callbacks.onSaved) {
        callbacks.onSaved(localMemoId ? MemoRepository.getById(localMemoId) : null);
      }
    });

    btnBack.addEventListener('click', () => {
      if (callbacks.onBack) {
        callbacks.onBack();
      }
    });

    btnPip.addEventListener('click', () => {
      if (callbacks.onPip) {
        callbacks.onPip({
          id: localMemoId,
          title: titleInput.value,
          content: contentInput.value
        });
      }
    });
  };

  container.innerHTML = '';
  render();
}
