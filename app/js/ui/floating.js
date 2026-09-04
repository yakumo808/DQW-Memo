/**
 * 画面内フローティングメモ（同一タブ内オーバーレイ）
 * システム PiP（他アプリ上）ではない。ドラッグなし・固定位置＋閉じるのみ。
 */
export function showFloatingMemo(root, memo, options) {
  const opts = options || {};
  const onClose = opts.onClose;
  const reason = opts.reason || '';

  if (!root) return;

  const title = (memo && memo.title) ? String(memo.title) : '（無題）';
  const content = (memo && memo.content != null) ? String(memo.content) : '';

  root.innerHTML = '';
  root.className = 'floating-memo-root';
  root.setAttribute('aria-live', 'polite');

  const panel = document.createElement('div');
  panel.className = 'floating-memo-panel';
  panel.innerHTML =
    '<div class="floating-memo-header">' +
      '<div class="floating-memo-title"></div>' +
      '<button type="button" class="floating-memo-close btn btn-ghost" aria-label="閉じる">閉じる</button>' +
    '</div>' +
    '<div class="floating-memo-note">' +
      '同一タブ内のフローティング表示です。他のアプリの上には表示されません。' +
    '</div>' +
    (reason
      ? '<div class="floating-memo-reason"></div>'
      : '') +
    '<div class="floating-memo-body"></div>';

  panel.querySelector('.floating-memo-title').textContent = title;
  panel.querySelector('.floating-memo-body').textContent = content;
  if (reason) {
    panel.querySelector('.floating-memo-reason').textContent = reason;
  }

  const closeBtn = panel.querySelector('.floating-memo-close');
  closeBtn.addEventListener('click', () => {
    hideFloatingMemo(root);
    if (typeof onClose === 'function') onClose();
  });

  root.appendChild(panel);
  root.hidden = false;
}

export function hideFloatingMemo(root) {
  if (!root) return;
  root.innerHTML = '';
  root.hidden = true;
}

export function isFloatingVisible(root) {
  return !!(root && !root.hidden && root.childNodes.length > 0);
}
