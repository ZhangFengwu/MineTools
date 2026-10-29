// MineTools YouTube 抓取桥接脚本（ISOLATED world，document_start 注入）。
// 接收抓取脚本通过 window.postMessage 传来的 ArrayBuffer，本地合并后下载。
(() => {
  if (window.__mineToolsCaptureBridge) return;
  window.__mineToolsCaptureBridge = true;

  const SOURCE = 'minetools-capture';
  const OVERLAY_ID = 'minetools-capture-overlay';
  const WATCHDOG = 330000;

  let host = null;
  let percentEl = null;
  let barEl = null;
  let detailEl = null;
  let stopEl = null;
  let watchdog = 0;
  let closing = 0;

  function sanitizeName(value) {
    return String(value || '')
      .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_')
      .replace(/^\.+/, '')
      .trim()
      .slice(0, 120);
  }

  function ensureOverlay() {
    if (host) return;
    host = document.createElement('div');
    host.id = OVERLAY_ID;
    host.style.cssText = 'all:initial!important;position:fixed!important;right:16px!important;bottom:16px!important;width:272px!important;z-index:2147483647!important;';
    const root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = [
      ':host{color-scheme:light}',
      '.card{box-sizing:border-box;width:272px;padding:10px 12px;border:1px solid rgba(148,163,184,.55);border-radius:10px;background:rgba(255,255,255,.97);box-shadow:0 10px 30px rgba(15,23,42,.18);font:13px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;color:#172033}',
      '.head{display:flex;align-items:center;gap:6px;margin-bottom:6px}',
      '.title{font-weight:600;font-size:13px}',
      '.percent{margin-left:auto;font-variant-numeric:tabular-nums;color:#15354b;font-weight:600;font-size:12px}',
      '.stop{border:0;background:transparent;color:#64748b;font:inherit;font-size:12px;cursor:pointer;padding:2px 4px;border-radius:4px}',
      '.stop:hover{background:rgba(148,163,184,.22);color:#172033}',
      '.stop:disabled{color:#b6c2cf;cursor:default;background:transparent}',
      '.bar{height:4px;border-radius:2px;background:#e9eef2;overflow:hidden}',
      '.bar i{display:block;height:100%;width:0;background:#15354b;transition:width .25s ease}',
      '.detail{margin:6px 0 0;font-size:11px;color:#64748b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.hint{margin:2px 0 0;font-size:11px;color:#94a3b8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.card.error{border-color:rgba(220,38,38,.45)}',
      '.card.error .bar i{background:#dc2626}',
      '.card.error .detail{color:#b91c1c}',
      '.card.done .bar i{background:#168072}'
    ].join('');
    root.appendChild(style);

    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = '<div class="head"><span class="title">MineTools 抓取</span><span class="percent">0%</span><button class="stop" type="button">取消</button></div><div class="bar"><i></i></div><p class="detail">正在准备…</p><p class="hint">请保持此标签页在前台</p>';
    root.appendChild(card);

    percentEl = card.querySelector('.percent');
    barEl = card.querySelector('.bar i');
    detailEl = card.querySelector('.detail');
    stopEl = card.querySelector('.stop');
    stopEl.addEventListener('click', cancel);

    (document.body || document.documentElement).appendChild(host);
  }

  function update(percent, detail) {
    ensureOverlay();
    const value = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
    percentEl.textContent = `${value}%`;
    barEl.style.width = `${value}%`;
    if (detail) detailEl.textContent = detail;
    clearTimeout(closing);
  }

  function setState(name) {
    if (!host) return;
    const card = host.shadowRoot?.querySelector('.card');
    if (!card) return;
    card.classList.remove('error', 'done');
    if (name) card.classList.add(name);
  }

  function close(delay) {
    clearTimeout(closing);
    closing = setTimeout(() => {
      clearTimeout(watchdog);
      host?.remove();
      host = null;
    }, delay);
  }

  function showError(message) {
    ensureOverlay();
    clearTimeout(watchdog);
    setState('error');
    percentEl.textContent = '失败';
    detailEl.textContent = String(message || '抓取失败，请重试。');
    stopEl.disabled = true;
    close(12000);
  }

  function cancel() {
    if (!stopEl || stopEl.disabled) return;
    stopEl.disabled = true;
    detailEl.textContent = '正在取消…';
    try {
      window.postMessage({ source: 'minetools-capture-control', type: 'cancel' }, '*');
    } catch {}
  }

  function save(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = sanitizeName(filename) || 'youtube.mp4';
    link.rel = 'noopener';
    link.style.display = 'none';
    (document.body || document.documentElement).appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return link.download;
  }

  async function handleResult(data) {
    ensureOverlay();
    update(99, '正在合并音视频…');
    stopEl.disabled = true;
    setState('');
    try {
      let saved;
      if (data.mode === 'audio') {
        if (!data.audio) throw new Error('未收到音频数据。');
        const { remuxAudio } = await import(chrome.runtime.getURL('media-merge.js'));
        saved = save(await remuxAudio(data.audio), data.filename || 'youtube-audio.m4a');
      } else {
        if (!data.video || !data.audio) throw new Error('未收到完整的音视频数据。');
        const { mergeBuffers } = await import(chrome.runtime.getURL('media-merge.js'));
        saved = save(await mergeBuffers(data.video, data.audio), data.filename || 'youtube.mp4');
      }
      clearTimeout(watchdog);
      update(100, `已下载 ${saved}`);
      setState('done');
      close(5000);
    } catch (error) {
      showError(error?.message || '合并失败，请重试。');
    }
  }

  window.addEventListener('message', event => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== SOURCE) return;
    if (data.type === 'start') {
      ensureOverlay();
      setState('');
      update(0, data.quality ? `锁定画质 ${data.quality}` : '正在加载播放器…');
      clearTimeout(watchdog);
      watchdog = setTimeout(() => showError('抓取超时，请重试。'), WATCHDOG);
      return;
    }
    if (data.type === 'progress') {
      update(data.percent, data.detail);
      return;
    }
    if (data.type === 'result') {
      handleResult(data);
      return;
    }
    if (data.type === 'error') showError(data.error);
  });
})();
