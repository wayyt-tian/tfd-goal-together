export const modeBase = location.pathname.match(/^\/(formal|demo)(?:\/|$)/)?.[0].replace(/\/$/, '') || '';
export const apiUrl = url => modeBase + url;
// 与服务端通信：JSON 接口、CSRF、增量游标、SSE 实时连接。
let csrf = null;
export function setCsrf(value) { csrf = value; }

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export async function request(method, url, body, { since } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && csrf) headers['X-CSRF-Token'] = csrf;
  if (since !== undefined && since !== null) headers['X-Since'] = String(since);
  let response;
  try {
    response = await fetch(apiUrl(url), { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, '网络好像断开了，检查一下连接再试。');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(response.status, data.error || '这一步没有成功，请稍后再试。');
  return data;
}
export const get = url => request('GET', url);
export const post = (url, body = {}, options) => request('POST', url, body, options);

// 实时：服务端只推送“有新变化”的游标；断线时自动重连，并用 60 秒轮询兜底。
export function connectLive({ onSeq, onCheer, onPresence, onState }) {
  let source = null, poll = null, closed = false;
  const open = () => {
    if (closed) return;
    source = new EventSource(apiUrl('/api/stream'));
    source.addEventListener('hello', event => { onState('live'); const data = JSON.parse(event.data); onPresence(data.online); onSeq(data.seq); });
    source.addEventListener('seq', event => onSeq(JSON.parse(event.data).seq));
    source.addEventListener('cheer', event => onCheer(JSON.parse(event.data)));
    source.addEventListener('presence', event => onPresence(JSON.parse(event.data).online));
    source.onerror = () => { onState('reconnecting'); };
  };
  open();
  poll = setInterval(() => { if (!source || source.readyState !== 1) onSeq(null); }, 60000);
  const onVisible = () => { if (document.visibilityState === 'visible') onSeq(null); };
  document.addEventListener('visibilitychange', onVisible);
  return () => { closed = true; source?.close(); clearInterval(poll); document.removeEventListener('visibilitychange', onVisible); };
}
