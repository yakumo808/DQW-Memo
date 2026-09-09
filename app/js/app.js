import { copyText } from './ui/clipboard.js';
import { state } from './core/app_state.js';
import { ListUI, DEV_VERSION } from './ui/list.js';
import { EditorUI } from './ui/editor.js';
import { MemoRepository } from './api.js';
import { VideoPipController } from './core/video_pip.js';
import { renderMemoVideo } from './core/video_render_client.js';
import { VideoCache } from './core/video_cache.js';
// 案A floating / captureStream は保持・既定OFF

const VIDEO_STYLE_VERSION = 'pages-v2';

const appContainer = document.getElementById('app');
const videoPip = new VideoPipController('pip-video');
// LRU touches update access metadata only; new video records store bytes.
const CACHE_ACCESS_TOUCH_ENABLED = true;
const videoCache = new VideoCache({ touchOnRead: CACHE_ACCESS_TOUCH_ENABLED });

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
  content: (draft && draft.content) || '',
  pageSeconds: [2,3,4,5].includes(draft?.pageSeconds) ? draft.pageSeconds : 3
});

const makeSignature = (draft) => {
  const next = normalizeDraft(draft);
  return JSON.stringify([VIDEO_STYLE_VERSION, next.title, next.content, next.pageSeconds]);
};

const currentSignature = () => makeSignature(editorDraft);

function snapshotRequest() {
  return Object.freeze({
    memoId: state.selectedMemo?.id ?? null,
    title: editorDraft.title,
    content: editorDraft.content,
    pageSeconds: editorDraft.pageSeconds,
    hash: currentSignature(),
    generation: requestGeneration,
  });
}

function isCurrentRequest(request) {
  return request.generation === requestGeneration &&
    state.currentView === 'editor' &&
    request.memoId === (state.selectedMemo?.id ?? null) &&
    request.title === editorDraft.title && request.content === editorDraft.content && request.pageSeconds === editorDraft.pageSeconds;
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

  let nextObjectUrl = URL.createObjectURL(blob);
  const supersededUrls = [];
  log(`${prepareSource.toUpperCase()} OBJECT URL ${nextObjectUrl} generation=${request.generation} type=${blob.type} size=${blob.size}`);

  let applied = false;
  try {
    let prep;
    const attempts = prepareSource === 'cache' && !meta?.bytesFormat ? 4 : 1;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      if (!isCurrentRequest(request)) return;
      // A retry stays in this serialized operation and retains the same Blob URL.
      if (pipStarting || isPipActive()) throw new Error('PiP active before prepare');
      if (attempt === 3) {
        const oldUrl = nextObjectUrl;
        nextObjectUrl = URL.createObjectURL(blob);
        supersededUrls.push(oldUrl);
        log(`CACHE URL REFRESH sameBlob=true old=${oldUrl} new=${nextObjectUrl} generation=${request.generation} type=${blob.type} size=${blob.size}`);
      }
      if (attempt === 4) {
        log(`CACHE BLOB REBUILD START generation=${request.generation} old=${nextObjectUrl} size=${blob.size} type=${blob.type}`);
        let rebuilt;
        try {
          const bytes = await blob.arrayBuffer();
          if (!isCurrentRequest(request)) { log(`BLOB REBUILD INTERRUPTED stale=true generation=${request.generation}`); return; }
          rebuilt = new Blob([bytes], { type: blob.type || 'video/mp4' });
          if (rebuilt.size !== blob.size) throw new Error(`size mismatch original=${blob.size} rebuilt=${rebuilt.size}`);
          log(`CACHE BLOB REBUILD READY generation=${request.generation} sizeMatch=${rebuilt.size === blob.size} typeMatch=${rebuilt.type === blob.type}`);
          log(`REBUILT BLOB size=${rebuilt.size} type=${rebuilt.type} originalSize=${blob.size} originalType=${blob.type}`);
        } catch (error) {
          log(`BLOB REBUILD FAILED / FALLBACK TO RENDER stage=arrayBuffer-or-construction generation=${request.generation} stale=${!isCurrentRequest(request)} error=${String(error)}`);
          if (!isCurrentRequest(request)) return;
          throw error;
        }
        while (pipStarting || isPipActive()) {
          renderState.status = 'waiting-pip'; syncEditorUi();
          await new Promise(resolve => lifecycleWaiters.add(resolve));
          if (!isCurrentRequest(request)) return;
        }
        const oldUrl = nextObjectUrl;
        nextObjectUrl = URL.createObjectURL(rebuilt);
        supersededUrls.push(oldUrl);
        log(`REBUILT BLOB OBJECT URL old=${oldUrl} new=${nextObjectUrl} generation=${request.generation}`);
        renderState.status = 'rendering'; syncEditorUi();
      }
      const label = attempt === 4 ? 'rebuilt-blob' : attempt === 3 ? 'refreshed-url' : `${attempt}/${Math.min(attempts, 2)}`;
      const started = performance.now();
      log(`PREPARE ATTEMPT ${label} url=${nextObjectUrl} generation=${request.generation} stale=false type=${blob.type} size=${blob.size}`);
      try {
        prep = await videoPip.prepare(nextObjectUrl);
      } catch (error) {
        prep = { ok: false, reason: 'prepare-exception', message: String(error) };
      }
      if (!prep || typeof prep.ok !== 'boolean') prep = { ok: false, reason: 'invalid-prepare-result' };
      const stale = !isCurrentRequest(request);
      log(`ATTEMPT ${attempt} RESULT url=${nextObjectUrl} generation=${request.generation} stale=${stale} elapsedMs=${Math.round(performance.now() - started)} ok=${prep.ok} reason=${prep.reason || ''}`);
      if (stale) { log(`PREPARE INTERRUPTED stale=true url=${nextObjectUrl}`); return; }
      if (prep.ok) {
        if (attempt > 1) log(`${attempt === 4 ? 'BLOB REBUILD RECOVERED' : attempt === 3 ? 'URL REFRESH RECOVERED' : 'RETRY RECOVERED'} url=${nextObjectUrl} generation=${request.generation}`);
        break;
      }
      if (!videoPip.video || prep.reason === 'video-missing') {
        log(`PREPARE NOT RETRYABLE reason=video-missing url=${nextObjectUrl}`);
        break;
      }
      if (attempt === attempts) break;
      if (attempt === 1) log(`CACHE PREPARE RETRY reason=${prep.reason || 'unspecified'} sameBlob=true sameUrl=true url=${nextObjectUrl} generation=${request.generation}`);
    }
    if (!prep.ok) {
      if (supersededUrls.length) log(`BLOB REBUILD FAILED / FALLBACK TO RENDER stage=prepare url=${nextObjectUrl} generation=${request.generation}`);
      throw new Error(prep.message || 'prepare failed');
    }
    revokeCurrentObjectUrl();
    renderState.objectUrl = nextObjectUrl;
    applied = true;
  } finally {
    for (const url of supersededUrls) retireObjectUrl(url);
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

// Standard cache writes persist ArrayBuffer bytes. Legacy Blobs remain read-compatible.
// Conversion failure affects caching only; the original Blob remains playable.
async function bytesForCache(blob, request) {
  log(`CACHE STORAGE FORMAT=bytes`);
  log(`CACHE BYTES SAVE START generation=${request.generation}`);
  try {
    const bytes = await blob.arrayBuffer();
    if (!isCurrentRequest(request)) { log(`CACHE BYTES SAVE STALE generation=${request.generation}`); return null; }
    if (bytes.byteLength !== blob.size) throw new Error('bytes size mismatch');
    return bytes;
  } catch (error) {
    log(`CACHE BYTES SAVE FAILED stage=arrayBuffer error=${error.name}: ${error.message}`);
    throw error;
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

  const result = await renderMemoVideo({ title, content, pageSeconds: request.pageSeconds });
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
    const bytes = await bytesForCache(blob, request);
    if (!bytes || !isCurrentRequest(request)) return;
    await videoCache.putVideo(hash, {
      bytes,
      type: blob.type || 'video/mp4',
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
    log(`CACHE BYTES SAVE OK BYTES size=${bytes.byteLength} type=${blob.type || 'video/mp4'}`);
    log(`CACHE STORED ${hash}`);
  } catch (cacheError) {
    if (!isCurrentRequest(request)) return;
    log(`CACHE BYTES SAVE FAILED stage=conversion-or-put generation=${request.generation} error=${String(cacheError)}`);
    log(`CACHE STORE ERROR ${hash}: ${cacheError instanceof Error ? cacheError.message : String(cacheError)}`);
    // Byte conversion/put failures affect only caching; playback retains the original Blob.
    renderState.cacheWarning = 'キャッシュ保存失敗';
  }
  if (!isCurrentRequest(request)) return;

  let playbackBlob = blob;
  let source = 'direct';
  if (saved) {
    log(`CACHE BYTES POST-SAVE VERIFY START generation=${request.generation} key=${hash}`);
    try {
      // Verify the stored ArrayBuffer; getVideo constructs a fresh playback Blob.
      const cached = await videoCache.getVideo(hash);
      if (!isCurrentRequest(request)) {
        log(`CACHE BYTES POST-SAVE VERIFY STALE generation=${request.generation} stage=get`);
        return;
      }
      if (!cached || !(cached.blob instanceof Blob) || cached.blob.size <= 0) {
        throw new Error('IndexedDB から有効な Blob を再取得できませんでした');
      }
      const bytes = cached.bytes;
      if (!(bytes instanceof ArrayBuffer) || bytes.byteLength !== blob.size) throw new Error('invalid readback bytes');
      if (!isCurrentRequest(request)) {
        log(`CACHE BYTES POST-SAVE VERIFY STALE generation=${request.generation} stage=read`);
        return;
      }
      log(`CACHE BYTES POST-SAVE VERIFY OK byteLength=${bytes.byteLength} size=${cached.blob.size} type=${cached.blob.type} generation=${request.generation}`);
      playbackBlob = cached.blob;
      source = 'server';
    } catch (cacheError) {
      log(`CACHE BYTES POST-SAVE VERIFY READ FAILED stage=readback generation=${request.generation} stale=${!isCurrentRequest(request)} error=${cacheError instanceof Error ? cacheError.name + ': ' + cacheError.message : String(cacheError)}`);
      if (!isCurrentRequest(request)) return;
      log(`CACHE READBACK ERROR ${hash}: ${cacheError instanceof Error ? cacheError.message : String(cacheError)}`);
      renderState.cacheWarning = 'キャッシュ再読込失敗（保存成功）';
      // Preserve the saved record for diagnosis; prepare the original generated Blob.
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
  if (request.content.replace(/\r\n?/g, '\n').split('\n').filter(line => line === '--- page ---').length >= 6) {
    throw new Error('ページ数が多すぎます。手動ページは6ページまでです。');
  }
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
    log(`CACHE HIT ACCESS TOUCH=${CACHE_ACCESS_TOUCH_ENABLED ? 'metadata-only' : 'disabled'}`);
    try {
      log(`CACHE HIT FORMAT=${cached.bytes instanceof ArrayBuffer ? 'bytes' : 'blob-legacy'}`);
      if (cached.bytes instanceof ArrayBuffer) {
        log(`CACHE BYTES READ OK byteLength=${cached.bytes.byteLength}`);
        log(`CACHE BLOB REBUILT FROM BYTES size=${cached.blob.size} type=${cached.blob.type}`);
      } else {
      // Legacy Blob diagnostic only.
      log(`CACHE BLOB EARLY READ START stage=before-object-url generation=${request.generation}`);
      try {
        const bytes = await cached.blob.arrayBuffer();
        log(`CACHE BLOB EARLY READ OK generation=${request.generation} stale=${!isCurrentRequest(request)}`);
        log(`EARLY BLOB size=${cached.blob.size} type=${cached.blob.type} byteLength=${bytes.byteLength} generation=${request.generation}`);
      } catch (error) {
        log(`CACHE BLOB EARLY READ FAILED stage=before-object-url generation=${request.generation} stale=${!isCurrentRequest(request)} error=${error instanceof Error ? error.name + ': ' + error.message : String(error)}`);
        if (!isCurrentRequest(request)) return;
        log(`CACHE BLOB REFETCH START generation=${request.generation} key=${hash}`);
        try {
          const refetched = await videoCache.getVideo(hash);
          if (!isCurrentRequest(request)) {
            log(`CACHE BLOB REFETCH STALE generation=${request.generation} stage=get`);
            return;
          }
          if (!(refetched?.blob instanceof Blob) || refetched.blob.size <= 0) {
            throw new Error('refetch key missing or invalid Blob');
          }
          log(`CACHE BLOB REFETCH FOUND generation=${request.generation} sameReference=${refetched.blob === cached.blob}`);
          log(`REFETCHED BLOB size=${refetched.blob.size} type=${refetched.blob.type} sizeMatch=${refetched.blob.size === cached.blob.size} typeMatch=${refetched.blob.type === cached.blob.type} generation=${request.generation}`);
          const bytes = await refetched.blob.arrayBuffer();
          if (!isCurrentRequest(request)) {
            log(`CACHE BLOB REFETCH STALE generation=${request.generation} stage=read`);
            return;
          }
          log(`CACHE BLOB REFETCH READ OK generation=${request.generation}`);
          log(`REFETCH byteLength=${bytes.byteLength} generation=${request.generation}`);
          cached = refetched; // Use this acquired reference; never re-put or rebuild here.
        } catch (refetchError) {
          log(`CACHE BLOB REFETCH READ FAILED generation=${request.generation} stale=${!isCurrentRequest(request)} error=${refetchError instanceof Error ? refetchError.name + ': ' + refetchError.message : String(refetchError)}`);
          throw refetchError;
        }
      }
      if (!isCurrentRequest(request)) return;
      }
      if (!isCurrentRequest(request)) return;
      await loadBlobIntoVideo(cached.blob, request, 'cache', { bytesFormat: cached.bytes instanceof ArrayBuffer, serverUrl: cached.serverUrl || '', jobId: cached.jobId || '' });
      if (!isCurrentRequest(request)) return;
      renderState.activeRequestHash = '';
      syncEditorUi();
      return;
    } catch (cachePrepareError) {
      if (!isCurrentRequest(request)) return;
      log(`FALLBACK TO RENDER generation=${request.generation} reason=cache-prepare-failed`);
      log(`CACHE PREPARE FAILED ${hash}: ${cachePrepareError instanceof Error ? cachePrepareError.message : String(cachePrepareError)}`);
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
    }, () => {
      state.selectedMemo = null;
      editorDraft = normalizeDraft({ title: '', content: '' });
      invalidateReadyState();
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

// Diagnostic only; never use UA classification to choose playback behavior.
const diagnosticUa = navigator.userAgent;
const diagnosticBrowser = /CriOS|Chrome\//.test(diagnosticUa) && !/Edg|OPR/.test(diagnosticUa) ? 'Chrome' :
  /Safari\//.test(diagnosticUa) && !/CriOS|Chrome|FxiOS|Edg|OPR/.test(diagnosticUa) ? 'Safari' : 'その他';
log(`ENV browser=${diagnosticBrowser}`);
log(`ENV app=${DEV_VERSION}`);
log(`ENV userAgent=${diagnosticUa}`);
log(`ENV platform=${navigator.platform || 'unknown'} iOS=${(/(?:CPU(?: iPhone)? OS|iPhone OS) ([\d_]+)/.exec(diagnosticUa) || [])[1] || 'unknown'}`);

render();


// Capture text before feedback; preserve line breaks even while details is closed.
const copyLogButton = document.getElementById('copy-log');
let copyFeedbackTimer;
copyLogButton?.addEventListener('click', async () => {
  const box = document.getElementById('log-box');
  const text = Array.from(box?.childNodes || []).map(node => node.textContent).join('\n');
  const feedback = document.getElementById('copy-log-status');
  copyLogButton.disabled = true;
  clearTimeout(copyFeedbackTimer);
  try {
    await copyText(text);
    feedback.textContent = 'コピーしました';
  } catch (error) {
    feedback.textContent = 'コピーに失敗しました';
  } finally {
    copyLogButton.disabled = false;
    copyFeedbackTimer = setTimeout(() => { feedback.textContent = ''; }, 2500);
  }
});
