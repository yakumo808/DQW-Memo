// @ts-check
import { MemoRepository } from './api.js';
import { PipRenderer } from './core/pip.js';

/**
 * メモ編集画面コンポーネント
 */
export function EditorUI(container, onBack) {
  let renderer: PipRenderer | null = null;

  const render = () => {
    container.innerHTML = `
      <div class="card">
        <h1 class.app-title>メモ編集</h1>
        <input type="text" id="memo-title" placeholder="タイトル" />
        <textarea id="memo-content" rows="12" placeholder="メモの内容を入力してください"></textarea>
        <div class="controls" style="display: flex; gap: 8px; margin-top: 8px;">
          <button id="btn-save" class="btn btn-success">保存</button>
          <button id="btn-pip" class="btn btn-primary">PiPで表示</button>
          <button id="btn-back" class="btn btn-ghost">戻る</button>
        </div>
        <div id="status" style="margin-top: 12px; font-size: 0.8rem; color: #9ca3af;"></div>
        <div id="log-box" class="log-box" style="margin-top: 12px;"></div>
      </div>
    `;

    const titleInput = container.querySelector('#memo-title') as HTMLInputElement;
    const contentInput = container.querySelector('#memo-content') as HTMLTextAreaElement;
    const btnSave = container.querySelector('#btn-save') as HTMLButtonElement;
    const btnBack = container.querySelector('#btn-back') as HTMLButtonElement;
    const btnPip = container.querySelector('#btn-pip') as HTMLButtonElement;
    const statusEl = container.querySelector('#status') as HTML_HTMLElement;
    const logBox = container.querySelector('#log-box') as HTML_HTMLElement;

    // 既存メモの取得
    let currentMemoId: string | null = null;
    if (window.currentMemoId) {
      const m = MemoRepository.getById(window.currentMemoId);
      if (m) {
        titleInput.value = m.title;
        contentInput.value = m.content;
        currentMemoId = m.id;
      }
    }

    // PipRendererの初期化 (DOMが存在する場合のみ)
    if (document.getElementById('pip-video')) {
      renderer = new PipRenderer('pip-canvas', 'pip-video');
      renderer.init();
    }

    // 保存処理
    btnSave.addEventListener('click', () => {
      const title = titleInput.value;
      const content = contentInput.value;

      if (currentMemoId) {
        MemoRepository.update(currentMemoId, { title, content });
        onBack();
      } else {
        const saved = MemoRepository.save({ title, content });
        window.currentMemoId = saved.id;
        onBack();
      }
    });

    // 戻る処理
    btnBack.addEventListener('click', () => {
      onBack();
    });

    // PiP表示処理
    btnPip.addEventListener('click', () => {
      if (!renderer) {
        alert('PiPレンダラーを初期化できませんでした。');
        return;
      }
      const m = currentMemo ? MemoRepository.getById(currentMemoId) : { title: titleInput.value, content: contentInput.value };
      if (m) {
        renderer.render(m);
        renderer.startPip();
      }
    });

    // ログ出力の同期
    const log = (msg: string) => {
      if (logBox) {
        const entry = document.createElement('div');
        entry.className = 'log-entry';
        entry.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
        logBox.appendChild(entry);
        logBox.scrollTop = logBox.scrollHeight;
      }
    };

    // 簡易的な状態表示
    const updateStatus = () => {
      if (renderer) {
        statusEl.textContent = renderer.isActive ? 'PiP表示中' : 'PiP停止中';
      }
    };
    
    // 状態変更イベントの監視
    if (renderer) {
      renderer.isActive = false; // 初期状態
      // ここでは実際には renderer の内部状態を監視するための仕組みを呼ぶ
      // 現時点では手動監視として扱う
      // （実際の実装では renderer.isActive の変化を監視する）
    }
  };

  // 監視用: 状態変更イベントをキャッチするためのグローバル的な処理は
  // renderer の内部で addLog を呼んでいるため、UI への反映は renderer のメソッドを拡張するか
  // ここで再描画する
  
  container.innerHTML = '';
  render();
}
