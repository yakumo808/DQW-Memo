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
  status: 'idle', // idle, checking, rendering, waiting-pip, ready, error
  prepareSource: '', // cache | server | direct | ''
  cacheWarning: '',
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
let requestGeneration = 0;
// One video element/controller: never share an in-flight prepare across requests.
let prepareQueue = Promise.resolve();
const retiredObjectUrls = new Set();
const lifecycleWaiters = new Set();
let pipStarting = false;

function isPipActive() {
  const v = videoPip.video;
  return !!v && (document.pictureInPictureElement === v ||
    v.webkitPresentationMode === 'picture-in-picture');
}

function cleanupRetiredUrls() {
  const v = videoPip.video;
  for (const url of retiredObjectUrls) {
    const attached = v && (v.getAttribute('src') === url || v.currentSrc === url);
    if (attached && (pipStarting || isPipActive())) continue;
    if (v && v.getAttribute('src') === url) {
      v.pause();
      v.removeAttribute('src');
      v.load();
    }
    URL.revokeObjectURL(url);
    retiredObjectUrls.delete(url);
    log(`Object URL cleanup: ${url}`);
  }
}

function notifyVideoLifecycle() {
  cleanupRetiredUrls();
  for (const resolve of lifecycleWaiters) resolve();
  lifecycleWaiters.clear();
}

for (const event of ['enterpictureinpicture', 'leavepictureinpicture', 'webkitpresentationmodechanged']) {
  videoPip.video?.addEventListener(event, notifyVideoLifecycle);
}

function retireObjectUrl(url) {
  if (!url) return;
  retiredObjectUrls.add(url);
  cleanupRetiredUrls();
}

const normalizeDraft = (draft) => ({
  title: (draft && draft.title) || '',
  content: (draft && draft.content) || ''
});

const makeSignature = (draft) => {
  const next = normalizeDraft(draft);
  return next.title + '\n' + next.content + '\n' + VIDEO_STYLE_VERSION;
};

const currentSignature = () => makeSignature(editorDraft);

function snapshotRequest() {
  return Object.freeze({
    memoId: state.selectedMemo?.id ?? null,
    title: editorDraft.title,
    content: editorDraft.content,
    hash: currentSignature(),
    generation: requestGeneration,
  });
}

function isCurrentRequest(request) {
  return request.generation === requestGeneration &&
    state.currentView === 'editor' &&
    request.memoId === (state.selectedMemo?.id ?? null) &&
    request.title === editorDraft.title && request.content === editorDraft.content;
}

function resetPreparedState() {
  renderState.status = 'idle';
  renderState.prepareSource = '';
  renderState.cacheWarning = '';
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
    const url = renderState.objectUrl;
    renderState.objectUrl = '';
    retireObjectUrl(url);
  }
}

function invalidateReadyState() {
  requestGeneration += 1;
  revokeCurrentObjectUrl();
  resetPreparedState();
  notifyVideoLifecycle();
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
  if (renderState.status === 'waiting-pip') return '現在のPiPを終了すると新しい動画を準備します';
  if (renderState.status === 'checking') return 'キャッシュ確認中…';
  if (renderState.status === 'rendering') return '動画生成中…';
  if (renderState.status === 'ready') {
    if (renderState.prepareSource === 'cache') {
      return 'キャッシュから準備完了';
    }
    if (renderState.prepareSource === 'direct') {
      return '新規生成成功／' + renderState.cacheWarning + '／Blob直接利用で準備完了';
    }
    return '新規生成して準備完了（キャッシュ保存成功）';
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
  if (renderState.status === 'waiting-pip') return 'PiP終了待ち';
  if (renderState.status === 'checking' || renderState.status === 'rendering') return '準備中…';
  if (renderState.status === 'ready') return 'PiPで表示';
  if (renderState.status === 'error') return '再試行';
  return '動画を準備';
}

function syncEditorUi() {
  if (!editorApi) return;
  if (editorApi.setStatus) editorApi.setStatus(statusText(), renderState.status);
  if (editorApi.setPipLabel) editorApi.setPipLabel(pipLabel());
}

function loadBlobIntoVideo(blob, request, prepareSource, meta) {
  const pending = prepareQueue.then(() => prepareBlob(blob, request, prepareSource, meta));
  prepareQueue = pending.catch(() => {});
  return pending;
}

async function prepareBlob(blob, request, prepareSource, meta) {
  if (!isCurrentRequest(request)) return;
  // Preserve the visible PiP's src, not just its URL registration.
  while (pipStarting || isPipActive()) {
    renderState.status = 'waiting-pip';
    syncEditorUi();
    await new Promise(resolve => lifecycleWaiters.add(resolve));
    if (!isCurrentRequest(request)) return;
  }
  renderState.status = 'rendering';
  syncEditorUi();
  const { hash } = request;
  if (!(blob instanceof Blob) || blob.size <= 0) {
    throw new Error('invalid blob');
  }

  const nextObjectUrl = URL.createObjectURL(blob);
  log(`${prepareSource.toUpperCase()} OBJECT URL ${nextObjectUrl}`);

  let applied = false;
  try {
    const prep = await videoPip.prepare(nextObjectUrl);
    if (!isCurrentRequest(request)) return;
    if (!prep.ok) throw new Error(prep.message || 'prepare failed');
    revokeCurrentObjectUrl();
    renderState.objectUrl = nextObjectUrl;
    applied = true;
  } finally {
    if (!applied) {
      retireObjectUrl(nextObjectUrl);
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

async function renderAndPrepareFromServer(request) {
  if (!isCurrentRequest(request)) return;
  const { title, content, hash } = request;
  renderState.status = 'rendering';
  renderState.failurePhase = 'render';
  renderState.errorMessage = '';
  renderState.activeRequestHash = hash;
  syncEditorUi();

  const result = await renderMemoVideo({ title, content });
  if (!isCurrentRequest(request)) return;

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
  if (!isCurrentRequest(request)) return;
  if (!response.ok) {
    renderState.activeRequestHash = '';
    renderState.status = 'error';
    renderState.failurePhase = 'render';
    renderState.errorMessage = `fetch(videoUrl) HTTP ${response.status}`;
    syncEditorUi();
    return;
  }

  const blob = await response.blob();
  if (!isCurrentRequest(request)) return;
  log(`BLOB RECEIVED ${hash} size=${blob.size} type=${blob.type}`);

  let saved = false;
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
    if (!isCurrentRequest(request)) return;
    saved = true;
    log(`CACHE STORED ${hash}`);
  } catch (cacheError) {
    if (!isCurrentRequest(request)) return;
    log(`CACHE STORE ERROR ${hash}: ${cacheError instanceof Error ? cacheError.message : String(cacheError)}`);
    renderState.cacheWarning = 'キャッシュ保存失敗';
  }
  if (!isCurrentRequest(request)) return;

  let playbackBlob = blob;
  let source = 'direct';
  if (saved) {
    try {
      const cached = await videoCache.getVideo(hash);
      if (!isCurrentRequest(request)) return;
      if (!cached || !(cached.blob instanceof Blob) || cached.blob.size <= 0) {
        throw new Error('IndexedDB から有効な Blob を再取得できませんでした');
      }
      playbackBlob = cached.blob;
      source = 'server';
    } catch (cacheError) {
      if (!isCurrentRequest(request)) return;
      log(`CACHE READBACK ERROR ${hash}: ${cacheError instanceof Error ? cacheError.message : String(cacheError)}`);
      renderState.cacheWarning = 'キャッシュ再読込失敗（保存成功）';
      await deleteBrokenCache(request);
      if (!isCurrentRequest(request)) return;
    }
  }

  if (source === 'direct') log(`CACHE BYPASS ${hash}: ${renderState.cacheWarning} — 取得済みBlobを直接利用`);
  await loadBlobIntoVideo(playbackBlob, request, source, { serverUrl: result.videoUrl, jobId: result.jobId });
  if (!isCurrentRequest(request)) return;
  renderState.activeRequestHash = '';
  syncEditorUi();
}

async function deleteBrokenCache(request) {
  if (!isCurrentRequest(request)) return;
  try {
    await videoCache.deleteVideo(request.hash);
    if (!isCurrentRequest(request)) return;
    log(`CACHE DELETED ${request.hash}`);
  } catch (error) {
    if (!isCurrentRequest(request)) return;
    log(`CACHE DELETE ERROR ${request.hash}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function prepareFromCacheOrRender(request) {
  const { hash } = request;
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
    if (cached && (!(cached.blob instanceof Blob) || cached.blob.size <= 0)) {
      throw new Error('invalid cached blob');
    }
  } catch (cacheError) {
    if (!isCurrentRequest(request)) return;
    log(`CACHE GET ERROR ${hash}: ${cacheError instanceof Error ? cacheError.message : String(cacheError)}`);
    renderState.failurePhase = 'cache';
    renderState.errorMessage = cacheError instanceof Error ? cacheError.message : String(cacheError);
    cached = null;
    log(`CACHE READ FAILED / REGENERATE ${hash}`);
    await deleteBrokenCache(request);
  }

  if (!isCurrentRequest(request)) return;
  if (cached && cached.blob instanceof Blob && cached.blob.size > 0) {
    log(`CACHE HIT ${hash}`);
    try {
      await loadBlobIntoVideo(cached.blob, request, 'cache', { serverUrl: cached.serverUrl || '', jobId: cached.jobId || '' });
      if (!isCurrentRequest(request)) return;
      renderState.activeRequestHash = '';
      syncEditorUi();
      return;
    } catch (cachePrepareError) {
      if (!isCurrentRequest(request)) return;
      log(`CACHE BROKEN ${hash}: ${cachePrepareError instanceof Error ? cachePrepareError.message : String(cachePrepareError)}`);
      log(`CACHE READ FAILED / REGENERATE ${hash}`);
      await deleteBrokenCache(request);
      if (!isCurrentRequest(request)) return;
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
  await renderAndPrepareFromServer(request);
}

async function startPreparedPip(request) {
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

  pipStarting = true;
  let result;
  try {
    result = await videoPip.startPip();
  } finally {
    pipStarting = false;
    notifyVideoLifecycle();
  }
  if (!isCurrentRequest(request)) return;
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
  invalidateReadyState();
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
        invalidateReadyState();
      },
      onPip: async (memo) => {
        editorDraft = normalizeDraft(memo);
        let request = snapshotRequest();
        try {
          const nextHash = request.hash;

          if (renderState.status === 'ready' && renderState.preparedHash === nextHash) {
            await startPreparedPip(request);
            return;
          }

          if (renderState.status === 'rendering' || renderState.status === 'checking' || renderState.status === 'waiting-pip') {
            syncEditorUi();
            return;
          }

          if (renderState.status === 'error' && renderState.preparedHash === nextHash && renderState.prepareSource) {
            await startPreparedPip(request);
            return;
          }

          invalidateReadyState();
          request = snapshotRequest();
          renderState.contentHash = nextHash;
          await prepareFromCacheOrRender(request);
        } catch (error) {
          if (!isCurrentRequest(request)) return;
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
