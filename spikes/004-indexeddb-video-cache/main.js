import { renderMemoVideo } from '../../app/js/core/video_render_client.js';
import { VideoCache, formatVideoCacheError, VIDEO_CACHE_DB_NAME, VIDEO_CACHE_STORE_NAME } from '../../app/js/core/video_cache.js';

const KEY = 'd4a-test-video';
const cache = new VideoCache();
const titleEl = document.getElementById('title');
const contentEl = document.getElementById('content');
const btnRun = document.getElementById('btn-run');
const btnLoad = document.getElementById('btn-load');
const btnDelete = document.getElementById('btn-delete');
const statusEl = document.getElementById('status');
const metaEl = document.getElementById('meta');
const logEl = document.getElementById('log');
const videoEl = document.getElementById('video');

let currentObjectUrl = '';

function log(msg) {
  const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
  logEl.textContent += `${line}\n`;
  logEl.scrollTop = logEl.scrollHeight;
  console.log(line);
}

function setStatus(msg) {
  statusEl.textContent = msg;
}

function setMeta(v) {
  metaEl.textContent = v
    ? `readyState=${v.readyState} videoWidth=${v.videoWidth} videoHeight=${v.videoHeight} duration=${Number.isFinite(v.duration) ? v.duration.toFixed(3) : 'NaN'} currentSrc=${v.currentSrc || v.src || ''}`
    : '';
}

function revokeCurrentObjectUrl() {
  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
    log(`Object URL revoked: ${currentObjectUrl}`);
    currentObjectUrl = '';
  }
}

async function waitForMetadata(video) {
  if (video.readyState >= 1 && video.videoWidth > 0) return;
  await new Promise((resolve, reject) => {
    const onReady = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(video.error || new Error('video load failed'));
    };
    const cleanup = () => {
      video.removeEventListener('loadedmetadata', onReady);
      video.removeEventListener('canplay', onReady);
      video.removeEventListener('error', onError);
      clearTimeout(timer);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('metadata timeout'));
    }, 15000);
    video.addEventListener('loadedmetadata', onReady, { once: true });
    video.addEventListener('canplay', onReady, { once: true });
    video.addEventListener('error', onError, { once: true });
    video.load();
  });
}

async function loadFromBlob(blob) {
  if (!(blob instanceof Blob) || blob.size <= 0) {
    throw new Error('invalid blob');
  }
  revokeCurrentObjectUrl();
  currentObjectUrl = URL.createObjectURL(blob);
  log(`Object URL created: ${currentObjectUrl}`);
  videoEl.src = currentObjectUrl;
  videoEl.muted = true;
  videoEl.playsInline = true;
  await waitForMetadata(videoEl);
  setMeta(videoEl);
  const played = videoEl.play();
  if (played && typeof played.then === 'function') {
    await played;
  }
  log('video.play() resolved');
}

async function fetchAndCacheRenderedVideo() {
  const title = titleEl.value || '';
  const content = contentEl.value || '';
  setStatus('rendering...');
  log(`POST /api/render title=${JSON.stringify(title)} contentLength=${content.length}`);

  const result = await renderMemoVideo({ title, content });
  if (!result.ok) {
    setStatus(`render error: ${result.errorCode || 'unknown'} ${result.message || ''}`.trim());
    log(`render error: ${JSON.stringify(result)}`);
    return;
  }

  log(`render ok jobId=${result.jobId} videoUrl=${result.videoUrl}`);
  const response = await fetch(result.videoUrl, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`fetch(videoUrl) HTTP ${response.status}`);
  }
  const blob = await response.blob();
  log(`blob received size=${blob.size} type=${blob.type}`);

  setStatus('saving to IndexedDB...');
  const saved = await cache.putVideo(KEY, {
    blob,
    mimeType: blob.type || result.mimeType || 'video/mp4',
    createdAt: new Date().toISOString(),
    width: result.width,
    height: result.height,
    duration: result.duration,
  });
  log(`IndexedDB put ok key=${saved.key}`);

  setStatus('reading back from IndexedDB...');
  const loaded = await cache.getVideo(KEY);
  if (!loaded) {
    throw new Error('IndexedDB get returned null');
  }
  log(`IndexedDB get ok key=${loaded.key} size=${loaded.blob.size} mimeType=${loaded.mimeType}`);

  setStatus('creating blob URL and loading video...');
  await loadFromBlob(loaded.blob);
  setStatus(`ready: readyState=${videoEl.readyState} ${videoEl.videoWidth}x${videoEl.videoHeight}`);
}

async function loadCachedVideo() {
  setStatus('loading from IndexedDB...');
  const loaded = await cache.getVideo(KEY);
  if (!loaded) {
    setStatus('cache miss');
    return;
  }
  log(`cache hit key=${loaded.key} size=${loaded.blob.size} mimeType=${loaded.mimeType}`);
  await loadFromBlob(loaded.blob);
  setStatus(`cache playback ready: readyState=${videoEl.readyState} ${videoEl.videoWidth}x${videoEl.videoHeight}`);
}

btnRun.addEventListener('click', async () => {
  try {
    await fetchAndCacheRenderedVideo();
  } catch (error) {
    const msg = formatVideoCacheError(error);
    setStatus(`error: ${msg}`);
    log(`error: ${msg}`);
  }
});

btnLoad.addEventListener('click', async () => {
  try {
    await loadCachedVideo();
  } catch (error) {
    const msg = formatVideoCacheError(error);
    setStatus(`error: ${msg}`);
    log(`error: ${msg}`);
  }
});

btnDelete.addEventListener('click', async () => {
  try {
    await cache.deleteVideo(KEY);
    revokeCurrentObjectUrl();
    videoEl.removeAttribute('src');
    videoEl.load();
    setMeta(videoEl);
    setStatus('cache deleted');
    log(`IndexedDB delete ok key=${KEY}`);
  } catch (error) {
    const msg = formatVideoCacheError(error);
    setStatus(`error: ${msg}`);
    log(`error: ${msg}`);
  }
});

window.addEventListener('beforeunload', () => {
  revokeCurrentObjectUrl();
});

(async () => {
  log(`DB=${VIDEO_CACHE_DB_NAME} store=${VIDEO_CACHE_STORE_NAME} key=${KEY}`);
  try {
    await loadCachedVideo();
  } catch (error) {
    log(`initial cache load skipped: ${formatVideoCacheError(error)}`);
  }
})();
