import { copyText } from './clipboard.js';
// @ts-check
import { MemoRepository } from '../api.js';

/**
 * メモ編集画面
 * EditorUI(container, memo, { onBack, onSaved, onPip, onChange })
 * @returns {{ setStatus: function, setPipLabel: function }}
 */
export function EditorUI(container, memo, callbacks) {
  let localMemoId = null;

  container.innerHTML = `
    <div class="card editor-card">
      <h1 class="app-title">メモ編集</h1>
      <label for="memo-title">タイトル</label>
      <input type="text" id="memo-title" placeholder="タイトル" />
      <label for="memo-content">本文</label>
      <textarea id="memo-content" rows="8" placeholder="メモの内容を入力してください"></textarea>
      <button id="copy-page" class="btn btn-ghost" type="button">改ページをコピー</button>
      <span id="copy-page-status" role="status"></span>
      <div id="status" class="editor-status" role="status" aria-live="polite" aria-atomic="true"></div>
      <div class="editor-actions">
        <label for="page-seconds">1ページの表示時間</label>
        <select id="page-seconds" class="btn"><option value="2">2秒</option><option value="3" selected>3秒</option><option value="4">4秒</option><option value="5">5秒</option></select>
        <button id="btn-pip" class="btn btn-primary" aria-describedby="status">動画を準備</button>
        <div class="controls editor-secondary">
          <button id="btn-save" class="btn btn-success">保存</button>
          <button id="btn-back" class="btn btn-ghost">一覧へ戻る</button>
        </div>
      </div>
    </div>
  `;

  const titleInput = container.querySelector('#memo-title');
  const contentInput = container.querySelector('#memo-content');
  const btnSave = container.querySelector('#btn-save');
  const btnBack = container.querySelector('#btn-back');
  const btnPip = container.querySelector('#btn-pip');
  const statusEl = container.querySelector('#status');

  const seconds = container.querySelector('#page-seconds');
  seconds.value = String([2,3,4,5].includes(memo?.pageSeconds) ? memo.pageSeconds : 3);
  container.querySelector('#copy-page').addEventListener('click', async () => {
    const feedback = container.querySelector('#copy-page-status');
    try { await copyText('--- page ---'); feedback.textContent = 'コピーしました'; }
    catch (_) { feedback.textContent = 'コピーに失敗しました'; }
  });
  const emitChange = () => {
    if (callbacks.onChange) {
      callbacks.onChange({
        id: localMemoId,
        title: titleInput.value,
        content: contentInput.value,
        pageSeconds: Number(seconds.value)
      });
    }
  };

  if (memo) {
    titleInput.value = memo.title || '';
    contentInput.value = memo.content || '';
    localMemoId = memo.id || null;
  }

  seconds.addEventListener('change', emitChange);
  titleInput.addEventListener('input', emitChange);
  contentInput.addEventListener('input', emitChange);

  btnSave.addEventListener('click', () => {
    const title = titleInput.value;
    const content = contentInput.value;
    let saved = null;

    if (localMemoId) {
      saved = MemoRepository.update(localMemoId, { title, content, pageSeconds: Number(seconds.value) });
    } else {
      saved = MemoRepository.save({ title, content, pageSeconds: Number(seconds.value) });
      localMemoId = saved.id;
    }

    if (callbacks.onSaved) {
      callbacks.onSaved(saved || (localMemoId ? MemoRepository.getById(localMemoId) : null));
    }
  });

  btnBack.addEventListener('click', () => {
    if (callbacks.onBack) {
      callbacks.onBack();
    }
  });

  btnPip.addEventListener('click', () => {
    if (callbacks.onPip) {
      // 未保存の現在入力を渡す（改行含む）
      callbacks.onPip({
        id: localMemoId,
        title: titleInput.value,
        content: contentInput.value,
        pageSeconds: Number(seconds.value)
      });
    }
  });

  return {
    setStatus: function (text, state) {
      if (statusEl) {
        statusEl.textContent = text || '';
        statusEl.dataset.state = state || 'idle';
      }
    },
    setPipLabel: function (text) {
      if (btnPip) btnPip.textContent = text || '動画を準備';
    }
  };
}
