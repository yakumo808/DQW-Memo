// @ts-check

const DEFAULT_ENDPOINT = '/api/render';
const DEFAULT_TIMEOUT_MS = 120000;

function makeMessage(prefix, detail) {
  return detail ? `${prefix}: ${detail}` : prefix;
}

function safeJsonParse(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (error) {
    return { ok: false, error };
  }
}

/**
 * POST /api/render -> { ok, jobId, videoUrl, width, height, duration, mimeType }
 * @param {{ title: string, content: string, pageSeconds?: number, endpoint?: string, timeoutMs?: number }} params
 * @returns {Promise<{ok:boolean, jobId?:string, videoUrl?:string, width?:number, height?:number, duration?:number, mimeType?:string, errorCode?:string, message?:string}>}
 */
export async function renderMemoVideo(params) {
  const endpoint = params.endpoint || DEFAULT_ENDPOINT;
  const timeoutMs = typeof params.timeoutMs === 'number' ? params.timeoutMs : DEFAULT_TIMEOUT_MS;
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeoutId = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8'
      },
      body: JSON.stringify({
        title: params.title,
        content: params.content,
        pageSeconds: params.pageSeconds ?? 3
      }),
      signal: controller ? controller.signal : undefined,
      credentials: 'same-origin'
    });

    const text = await response.text();
    const parsed = safeJsonParse(text);
    if (!parsed.ok) {
      return {
        ok: false,
        errorCode: 'JSON_PARSE_FAILED',
        message: makeMessage('JSON parse失敗', parsed.error && parsed.error.message ? parsed.error.message : 'invalid JSON response')
      };
    }

    const data = parsed.value || {};
    if (!response.ok) {
      return {
        ok: false,
        errorCode: data.errorCode || 'HTTP_ERROR',
        message: data.message || makeMessage('HTTPエラー', String(response.status))
      };
    }

    if (!data || data.ok !== true) {
      return {
        ok: false,
        errorCode: data.errorCode || 'API_OK_FALSE',
        message: data.message || 'ok=false'
      };
    }

    return {
      ok: true,
      jobId: data.jobId,
      videoUrl: data.videoUrl,
      width: data.width,
      height: data.height,
      duration: data.duration,
      mimeType: data.mimeType
    };
  } catch (error) {
    const aborted = error && error.name === 'AbortError';
    return {
      ok: false,
      errorCode: aborted ? 'TIMEOUT' : 'NETWORK_ERROR',
      message: aborted ? 'render request timed out' : makeMessage('サーバー未到達', error && error.message ? error.message : String(error))
    };
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}
