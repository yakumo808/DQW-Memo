import { state } from './core/app_state.js';
import { ListUI } from './ui/list.js';
import { EditorUI } from './ui/editor.js';
import { MemoRepository } from './api.js';
import { VideoPipController } from './core/video_pip.js';
import { renderMemoVideo } from './core/video_render_client.js';
// 案A floating / captureStream は保持・既定OFF

const appContainer = document.getElementById('app');
const videoPip = new VideoPipController('pip-video');

/** @type {{ setStatus?: function, setPipLabel?: function } | null} */
let editorApi = null;

const renderState = {
  status: 'idle', // idle, rendering, ready, error
  videoUrl: '',
  preparedKey: '',
  activeRequestKey: '',
  failurePhase: '', // render, prepare, pip
  errorMessage: '',
  jobId: '',
};

let editorDraft = { title: '', content: '' };

const draftKeyOf = (draft) => JSON.stringify([
  (draft && draft.title) || '',
  (draft && draft.content) || ''
]);

const currentDraftKey = () => draftKeyOf(editorDraft);

const normalizeDraft = (draft) => ({
  title: (draft && draft.title) || '',
  content: (draft && draft.content) || ''
});

const setDraft = (draft) => {
  const next = normalizeDraft(draft);
  const nextKey = draftKeyOf(next);
  const prevKey = currentDraftKey();
  editorDraft = next;

  if (renderState.status !== 'rendering' && renderState.preparedKey && renderState.preparedKey !== nextKey) {
    renderState.status = 'idle';
    renderState.videoUrl = '';
    renderState.preparedKey = '';
    renderState.failurePhase = '';
    renderState.errorMessage = '';
    renderState.jobId = '';
  }

  if (renderState.status === 'error' && renderState.preparedKey && renderState.preparedKey !== nextKey) {
    renderState.status = 'idle';
    renderState.videoUrl = '';
    renderState.preparedKey = '';
    renderState.failurePhase = '';
    renderState.errorMessage = '';
    renderState.jobId = '';
  }

  if (prevKey !== nextKey && renderState.activeRequestKey && renderState.activeRequestKey !== nextKey) {
    // rendering中の変更は許容するが、完了時に stale 判定する
  }

  syncEditorUi();
};

const statusText = () => {
  if (renderState.status === 'rendering') return '動画を生成中…';
  if (renderState.status === 'ready') return '動画準備完了 — 「PiPで表示」でシステムPiP';
  if (renderState.status === 'error') {
    if (renderState.failurePhase === 'render') return '動画生成失敗: ' + (renderState.errorMessage || 'unknown');
    if (renderState.failurePhase === 'prepare') return '動画準備失敗: ' + (renderState.errorMessage || 'unknown');
    if (renderState.failurePhase === 'pip') return 'PiP開始失敗: ' + (renderState.errorMessage || 'unknown');
    return '失敗: ' + (renderState.errorMessage || 'unknown');
  }
  return '動画を準備してください';
};

const pipLabel = () => {
  if (renderState.status === 'rendering') return '準備中…';
  if (renderState.status === 'ready') return 'PiPで表示';
  if (renderState.status === 'error') return '再試行';
  return '動画を準備';
};

const syncEditorUi = () => {
  if (!editorApi) return;
  if (editorApi.setStatus) editorApi.setStatus(statusText());
  if (editorApi.setPipLabel) editorApi.setPipLabel(pipLabel());
};

const prepareExistingVideo = async () => {
  if (!renderState.videoUrl) {
    renderState.status = 'error';
    renderState.failurePhase = 'prepare';
    renderState.errorMessage = '準備済み動画URLがありません';
    syncEditorUi();
    return;
  }

  const key = currentDraftKey();
  renderState.status = 'rendering';
  renderState.failurePhase = 'prepare';
  renderState.errorMessage = '';
  renderState.activeRequestKey = key;
  syncEditorUi();

  const result = await videoPip.prepare(renderState.videoUrl);
  if (renderState.activeRequestKey !== key || currentDraftKey() !== key) {
    renderState.activeRequestKey = '';
    renderState.status = 'idle';
    renderState.videoUrl = '';
    renderState.preparedKey = '';
    renderState.jobId = '';
    renderState.errorMessage = '';
    renderState.failurePhase = '';
    syncEditorUi();
    return;
  }

  if (!result.ok) {
    renderState.activeRequestKey = '';
    renderState.status = 'error';
    renderState.failurePhase = 'prepare';
    renderState.errorMessage = result.message || 'prepare failed';
    syncEditorUi();
    return;
  }

  renderState.activeRequestKey = '';
  renderState.status = 'ready';
  renderState.failurePhase = '';
  renderState.errorMessage = '';
  syncEditorUi();
};

const renderCurrentDraft = async () => {
  const key = currentDraftKey();
  const { title, content } = editorDraft;
  renderState.status = 'rendering';
  renderState.failurePhase = 'render';
  renderState.errorMessage = '';
  renderState.activeRequestKey = key;
  syncEditorUi();

  const result = await renderMemoVideo({ title, content });
  if (renderState.activeRequestKey !== key || currentDraftKey() !== key) {
    renderState.activeRequestKey = '';
    renderState.status = 'idle';
    renderState.videoUrl = '';
    renderState.preparedKey = '';
    renderState.jobId = '';
    renderState.errorMessage = '';
    renderState.failurePhase = '';
    syncEditorUi();
    return;
  }

  if (!result.ok) {
    renderState.activeRequestKey = '';
    renderState.status = 'error';
    renderState.failurePhase = 'render';
    renderState.errorMessage = result.message || result.errorCode || 'render failed';
    renderState.videoUrl = '';
    renderState.preparedKey = '';
    renderState.jobId = '';
    syncEditorUi();
    return;
  }

  const videoUrl = result.videoUrl;
  renderState.videoUrl = videoUrl;
  renderState.jobId = result.jobId || '';

  const prep = await videoPip.prepare(videoUrl);
  if (renderState.activeRequestKey !== key || currentDraftKey() !== key) {
    renderState.activeRequestKey = '';
    renderState.status = 'idle';
    renderState.videoUrl = '';
    renderState.preparedKey = '';
    renderState.jobId = '';
    renderState.errorMessage = '';
    renderState.failurePhase = '';
    syncEditorUi();
    return;
  }

  if (!prep.ok) {
    renderState.activeRequestKey = '';
    renderState.status = 'error';
    renderState.failurePhase = 'prepare';
    renderState.errorMessage = prep.message || 'prepare failed';
    renderState.preparedKey = '';
    syncEditorUi();
    return;
  }

  renderState.activeRequestKey = '';
  renderState.status = 'ready';
  renderState.preparedKey = key;
  renderState.failurePhase = '';
  renderState.errorMessage = '';
  syncEditorUi();
};

const startPreparedPip = async () => {
  if (!renderState.videoUrl) {
    renderState.status = 'idle';
    renderState.failurePhase = '';
    renderState.errorMessage = '';
    syncEditorUi();
    return;
  }

  renderState.status = 'rendering';
  renderState.failurePhase = 'pip';
  renderState.errorMessage = '';
  syncEditorUi();

  const result = await videoPip.startPip();
  if (result.ok) {
    renderState.status = 'ready';
    renderState.failurePhase = '';
    renderState.errorMessage = '';
    syncEditorUi();
    return;
  }

  renderState.status = 'error';
  renderState.failurePhase = 'pip';
  renderState.errorMessage = result.message || 'pip failed';
  syncEditorUi();
};

const render = () => {
  editorApi = null;
  appContainer.innerHTML = '';

  if (state.currentView === 'list') {
    ListUI(appContainer, (id) => {
      if (!id) {
        const newMemo = { title: '', content: '' };
        const saved = MemoRepository.save(newMemo);
        state.selectMemo(saved);
        render();
      } else {
        const m = MemoRepository.getById(id);
        state.selectMemo(m);
        render();
      }
    });
    return;
  }

  if (state.currentView === 'editor') {
    editorDraft = normalizeDraft(state.selectedMemo || { title: '', content: '' });
    const currentKey = currentDraftKey();
    if (renderState.status !== 'rendering' && renderState.preparedKey && renderState.preparedKey !== currentKey) {
      renderState.status = 'idle';
      renderState.videoUrl = '';
      renderState.preparedKey = '';
      renderState.failurePhase = '';
      renderState.errorMessage = '';
      renderState.jobId = '';
    }
    if (renderState.status === 'error' && renderState.preparedKey && renderState.preparedKey !== currentKey) {
      renderState.status = 'idle';
      renderState.videoUrl = '';
      renderState.preparedKey = '';
      renderState.failurePhase = '';
      renderState.errorMessage = '';
      renderState.jobId = '';
    }

    editorApi = EditorUI(appContainer, state.selectedMemo, {
      onBack: () => {
        state.setView('list');
        render();
      },
      onSaved: (savedMemo) => {
        if (savedMemo) {
          state.selectedMemo = savedMemo;
          editorDraft = normalizeDraft(savedMemo);
        }
        state.setView('list');
        render();
      },
      onChange: (draft) => {
        setDraft(draft);
      },
      onPip: async (memo) => {
        setDraft(memo);
        if (renderState.status === 'rendering') {
          syncEditorUi();
          return;
        }
        if (renderState.status === 'ready' && renderState.preparedKey === currentDraftKey()) {
          await startPreparedPip();
          return;
        }

        if (renderState.status === 'error') {
          if (renderState.failurePhase === 'prepare' && renderState.videoUrl && renderState.preparedKey === currentDraftKey()) {
            await prepareExistingVideo();
            return;
          }
          if (renderState.failurePhase === 'pip' && renderState.videoUrl && renderState.preparedKey === currentDraftKey()) {
            await startPreparedPip();
            return;
          }
        }

        await renderCurrentDraft();
      }
    });

    syncEditorUi();
  }
};

render();
