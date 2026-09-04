import { state } from './core/app_state.js';
import { ListUI } from './ui/list.js';
import { EditorUI } from './ui/editor.js';
import { MemoRepository } from './api.js';
import { VideoPipController } from './core/video_pip.js';
import { renderMemoVideo } from './core/video_render_client.js';
import { VideoCache } from './core/video_cache.js';
// 案A floating / captureStream は保持・既定OFF

const VIDEO_STYLE_VERSION = 'v1';

const appContainer = document.getElementById('app');
const videoPip = new VideoPipController('pip-video');
const videoCache = new VideoCache();

/** @type {{ setStatus?: function, setPipLabel?: function } | null} */
let editorApi = null;

const renderState = {
  status: 'idle', // idle, checking, rendering, ready, error
  prepareSource: '', // cache | server | ''
  contentHash: '',
  preparedHash: '',
  videoUrl: '',
  serverUrl: '',
  objectUrl: '',
  activeRequestHash: '',
  failurePhase: '', // cache, render, prepare, pip
  errorMessage: '',
  jobId: '',
};

let editorDraft = { title: '', content: '' };

const normalizeDraft = (draft) => ({
  title: (draft && draft.title) || '',
  content: (draft && draft.content) || ''
});

const makeSignature = (draft) => {
  const next = normalizeDraft(draft);
  return next.title + '\n' + next.content + '\n' + VIDEO_STYLE_VERSION;
};

const currentSignature = () => makeSignature(editorDraft);

async function computeContentHash(signature) {
  return signature;
}

function resetPreparedState() {
  renderState.status = 'idle';
  renderState.prepareSource = '';
  renderState.contentHash = '';
  renderState.preparedHash = '';
  renderState.videoUrl = '';
  renderState.serverUrl = '';
  renderState.activeRequestHash = '';
  renderState.failurePhase = '';
  renderState.errorMessage = '';
  renderState.jobId = '';
}

function revokeCurrentObjectUrl() {
  if (renderState.objectUrl) {
    try {
      URL.revokeObjectURL(renderState.objectUrl);
    } catch (_) {
      /* ignore */
    }
    renderState.objectUrl = '';
  }
}

function invalidateReadyState() {
  if (renderState.status === 'ready' || renderState.status === 'error' || renderState.status === 'idle') {
    revokeCurrentObjectUrl();
    resetPreparedState();
  }
  syncEditorUi();
}

function log(msg) {
  const line = '[' + new Date().toLocaleTimeString() + '] ' + msg;
  const logBox = document.getElementById('log-box');
  if (logBox) {
    const el = document.createElement('div');
    el.className = 'log-entry';
    el.textContent = line;
    logBox.appendChild(el);
    logBox.scrollTop = logBox.scrollHeight;
  }
  try {
    console.log(line);
  } catch (_) {
    /* ignore */
  }
}

function statusText() {
  if (renderState.status === 'checking') return 'キャッシュ確認中…';
  if (renderState.status === 'rendering') return '動画生成中…';
  if (renderState.status === 'ready') {
    if (renderState.prepareSource === 'cache') {
      return 'キャッシュから準備完了 — 「PiPで表示」でシステムPiP';
    }
    return '新規生成して準備完了 — 「PiPで表示」でシステムPiP';
  }
  if (renderState.status === 'error') {
    if (renderState.failurePhase === 'cache') return 'キャッシュエラー: ' + (renderState.errorMessage || 'unknown');
    if (renderState.failurePhase === 'render') return '動画生成失敗: ' + (renderState.errorMessage || 'unknown');
    if (renderState.failurePhase === 'prepare') return '動画準備失敗: ' + (renderState.errorMessage || 'unknown');
    if (renderState.failurePhase === 'pip') return 'PiP開始失敗: ' + (renderState.errorMessage || 'unknown');
    return '失敗: ' + (renderState.errorMessage || 'unknown');
  }
  return '動画を準備してください';
}

function pipLabel() {
  if (renderState.status === 'checking' || renderState.status === 'rendering') return '準備中…';
  if (renderState.status === 'ready') return 'PiPで表示';
  if (renderState.status === 'error') return '再試行';
  return '動画を準備';
}

function syncEditorUi() {
  if (!editorApi) return;
  if (editorApi.setStatus) editorApi.setStatus(statusText());
  if (editorApi.setPipLabel) editorApi.setPipLabel(pipLabel());
}

async function loadBlobIntoVideo(blob, hash, prepareSource, meta) {
  if (!(blob instanceof Blob) || blob.size <= 0) {
    throw new Error('invalid blob');
  }

  const previousObjectUrl = renderState.objectUrl;
  const nextObjectUrl = URL.createObjectURL(blob);
  renderState.objectUrl = nextObjectUrl;
  log(`${prepareSource.toUpperCase()} OBJECT URL ${nextObjectUrl}`);

  const prep = await videoPip.prepare(nextObjectUrl);
  if (!prep.ok) {
    try {
      URL.revokeObjectURL(nextObjectUrl);
    } catch (_) {
      /* ignore */
    }
    renderState.objectUrl = previousObjectUrl;
    throw new Error(prep.message || 'prepare failed');
  }

  if (previousObjectUrl) {
    try {
      URL.revokeObjectURL(previousObjectUrl);
      log(`Object URL revoked: ${previousObjectUrl}`);
    } catch (_) {
      /* ignore */
    }
  }

  renderState.contentHash = hash;
  renderState.preparedHash = hash;
  renderState.prepareSource = prepareSource;
  renderState.videoUrl = nextObjectUrl;
  renderState.serverUrl = (meta && meta.serverUrl) || '';
  renderState.jobId = (meta && meta.jobId) || '';
  renderState.failurePhase = '';
  renderState.errorMessage = '';
  renderState.status = 'ready';
  syncEditorUi();

  const v = document.getElementById('pip-video');
  if (v) {
    log(`prepared readyState=${v.readyState} videoWidth=${v.videoWidth} videoHeight=${v.videoHeight}`);
  }
}

async function renderAndPrepareFromServer(hash) {
  const { title, content } = editorDraft;
  renderState.status = 'rendering';
  renderState.failurePhase = 'render';
  renderState.errorMessage = '';
  renderState.activeRequestHash = hash;
  syncEditorUi();

  const result = await renderMemoVideo({ title, content });
  if (renderState.activeRequestHash !== hash || currentSignature() !== makeSignature(editorDraft)) {
    renderState.activeRequestHash = '';
    resetPreparedState();
    syncEditorUi();
    return;
  }

  if (!result.ok) {
    renderState.activeRequestHash = '';
    renderState.status = 'error';
    renderState.failurePhase = 'render';
    renderState.errorMessage = result.message || result.errorCode || 'render failed';
    renderState.videoUrl = '';
    renderState.preparedHash = '';
    renderState.jobId = '';
    syncEditorUi();
    return;
  }

  renderState.serverUrl = result.videoUrl || '';
  renderState.jobId = result.jobId || '';
  log(`RENDER OK ${hash} jobId=${renderState.jobId} videoUrl=${renderState.serverUrl}`);

  const response = await fetch(result.videoUrl, { cache: 'no-store' });
  if (!response.ok) {
    renderState.activeRequestHash = '';
    renderState.status = 'error';
    renderState.failurePhase = 'render';
    renderState.errorMessage = `fetch(videoUrl) HTTP ${response.status}`;
    syncEditorUi();
    return;
  }

  const blob = await response.blob();
  log(`BLOB RECEIVED ${hash} size=${blob.size} type=${blob.type}`);

  try {
    await videoCache.putVideo(hash, {
      blob,
      mimeType: blob.type || result.mimeType || 'video/mp4',
      createdAt: new Date().toISOString(),
      width: result.width,
      height: result.height,
      duration: result.duration,
      source: 'server',
      styleVersion: VIDEO_STYLE_VERSION,
    });
    log(`CACHE STORED ${hash}`);
  } catch (cacheError) {
    log(`CACHE STORE ERROR ${hash}: ${cacheError instanceof Error ? cacheError.message : String(cacheError)}`);
  }

  const cached = await videoCache.getVideo(hash);
  if (!cached || !(cached.blob instanceof Blob) || cached.blob.size <= 0) {
    renderState.activeRequestHash = '';
    renderState.status = 'error';
    renderState.failurePhase = 'cache';
    renderState.errorMessage = 'IndexedDB から Blob を再取得できませんでした';
    syncEditorUi();
    return;
  }

  await loadBlobIntoVideo(cached.blob, hash, 'server', { serverUrl: result.videoUrl, jobId: result.jobId });
  renderState.activeRequestHash = '';
  syncEditorUi();
}

async function prepareFromCacheOrRender() {
  const signature = currentSignature();
  const hash = await computeContentHash(signature);
  renderState.contentHash = hash;
  renderState.activeRequestHash = hash;
  renderState.status = 'checking';
  renderState.prepareSource = '';
  renderState.failurePhase = '';
  renderState.errorMessage = '';
  syncEditorUi();

  let cached = null;
  try {
    cached = await videoCache.getVideo(hash);
  } catch (cacheError) {
    log(`CACHE GET ERROR ${hash}: ${cacheError instanceof Error ? cacheError.message : String(cacheError)}`);
    renderState.failurePhase = 'cache';
    renderState.errorMessage = cacheError instanceof Error ? cacheError.message : String(cacheError);
  }

  if (cached && cached.blob instanceof Blob && cached.blob.size > 0) {
    log(`CACHE HIT ${hash}`);
    try {
      await loadBlobIntoVideo(cached.blob, hash, 'cache', { serverUrl: cached.serverUrl || '', jobId: cached.jobId || '' });
      renderState.activeRequestHash = '';
      syncEditorUi();
      return;
    } catch (cachePrepareError) {
      log(`CACHE BROKEN ${hash}: ${cachePrepareError instanceof Error ? cachePrepareError.message : String(cachePrepareError)}`);
      try {
        await videoCache.deleteVideo(hash);
        log(`CACHE DELETED ${hash}`);
      } catch (deleteError) {
        log(`CACHE DELETE ERROR ${hash}: ${deleteError instanceof Error ? deleteError.message : String(deleteError)}`);
      }
      // fall through to render
    }
  } else {
    if (!renderState.errorMessage) {
      log(`CACHE MISS ${hash}`);
    } else {
      log(`CACHE MISS ${hash} (after cache error)`);
    }
  }

  renderState.status = 'rendering';
  renderState.prepareSource = 'server';
  syncEditorUi();
  await renderAndPrepareFromServer(hash);
}

async function startPreparedPip() {
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
}

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
        const memo = MemoRepository.getById(id);
        state.selectMemo(memo);
        render();
      }
    });
    return;
  }

  if (state.currentView === 'editor') {
    editorDraft = normalizeDraft(state.selectedMemo || { title: '', content: '' });

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
        editorDraft = normalizeDraft(draft);
        if (renderState.status !== 'checking' && renderState.status !== 'rendering') {
          revokeCurrentObjectUrl();
          resetPreparedState();
        }
        syncEditorUi();
      },
      onPip: async (memo) => {
        try {
          editorDraft = normalizeDraft(memo);

          const signature = currentSignature();
          const nextHash = await computeContentHash(signature);

          if (renderState.status === 'ready' && renderState.preparedHash === nextHash) {
            await startPreparedPip();
            return;
          }

          if (renderState.status === 'rendering' || renderState.status === 'checking') {
            syncEditorUi();
            return;
          }

          if (renderState.status === 'error' && renderState.preparedHash === nextHash && renderState.prepareSource) {
            await startPreparedPip();
            return;
          }

          renderState.status = 'checking';
          renderState.failurePhase = '';
          renderState.errorMessage = '';
          syncEditorUi();

          revokeCurrentObjectUrl();
          resetPreparedState();
          renderState.contentHash = nextHash;
          await prepareFromCacheOrRender();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          log(`PREPARE ERROR ${message}`);
          renderState.status = 'error';
          renderState.failurePhase = 'prepare';
          renderState.errorMessage = message || 'cache key error';
          renderState.activeRequestHash = '';
          syncEditorUi();
        }
      }
    });

    syncEditorUi();
  }
};

render();
