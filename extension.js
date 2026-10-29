export function normalizeDomain(value) {
  const input = String(value ?? '').trim();
  if (!input) return '';
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `https://${input}`;
  try {
    const url = new URL(candidate);
    if (!/^https?:$/.test(url.protocol)) return '';
    return url.hostname.replace(/\.+$/, '').toLowerCase();
  } catch {
    return '';
  }
}

export function isValidDomain(value) {
  return /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(normalizeDomain(value));
}

// activeTab 只在用户点击扩展后临时授予当前页面访问权。
export function isGoogleSearch(value) {
  try {
    const url = new URL(value);
    return /^https?:$/.test(url.protocol) &&
      /^(?:www\.)?google\.(?:com|[a-z]{2}|(?:com|co)\.[a-z]{2})$/i.test(url.hostname) &&
      /^\/search\/?$/.test(url.pathname);
  } catch { return false; }
}

export async function getSearchTab(browserAPI) {
  const [tab] = await browserAPI.tabs.query({ active: true, currentWindow: true });
  if (!Number.isInteger(tab?.id) || !isGoogleSearch(tab.url)) {
    throw new Error('请先打开 Google 搜索结果页，再使用 SERP 采集。');
  }
  return tab;
}

export async function openPanel(browserAPI) {
  // 点击时重新读取，防止弹窗打开期间用户已经切换页面。
  const tab = await getSearchTab(browserAPI);
  let injections;
  try {
    injections = await browserAPI.scripting.executeScript({
      target: { tabId: tab.id, allFrames: false },
      world: 'ISOLATED',
      files: ['content.js']
    });
  } catch {
    throw new Error('未能打开面板。请等待页面加载完成；若刚切换过标签页，请点击扩展图标授权当前页后重试。');
  }
  const result = injections?.find(entry => entry.frameId === 0)?.result;
  if (!result?.ok) {
    throw new Error('页面尚未准备好，请刷新搜索页后重试。');
  }
  return result;
}

export async function runDomainCheck(browserAPI) {
  const [tab] = await browserAPI.tabs.query({ active: true, currentWindow: true });
  if (!Number.isInteger(tab?.id)) {
    throw new Error('未找到当前标签页。');
  }
  if (!/^https?:/i.test(tab.url || '')) {
    throw new Error('当前页面不支持查域名，请打开普通网页后重试。');
  }
  try {
    await browserAPI.scripting.executeScript({
      target: { tabId: tab.id, allFrames: false },
      world: 'ISOLATED',
      files: ['domain-content.js']
    });
  } catch {
    throw new Error('无法在当前页执行查域名。请等待页面加载完成；若刚切换过标签页，请点击扩展图标授权当前页后重试。');
  }
}

export async function openBacklinkChecker(browserAPI) {
  const [tab] = await browserAPI.tabs.query({ active: true, currentWindow: true });
  let hostname;
  try {
    const url = new URL(tab?.url || '');
    if (!/^https?:$/.test(url.protocol) || !url.hostname) throw new Error();
    hostname = url.hostname;
  } catch {
    throw new Error('无法读取当前页域名，请打开普通网页后重试；若刚切换过标签页，请点击扩展图标授权当前页。');
  }
  await browserAPI.tabs.create({
    url: `https://ahrefs.com/backlink-checker?input=${encodeURIComponent(hostname)}&mode=subdomains`
  });
  return hostname;
}

export async function runExternalLinkScan(browserAPI) {
  const [tab] = await browserAPI.tabs.query({ active: true, currentWindow: true });
  if (!Number.isInteger(tab?.id)) {
    throw new Error('未找到当前标签页。');
  }
  if (!/^https?:/i.test(tab.url || '')) {
    throw new Error('当前页面不支持找外链，请打开普通网页后重试。');
  }
  let injections;
  try {
    injections = await browserAPI.scripting.executeScript({
      target: { tabId: tab.id, allFrames: false },
      world: 'ISOLATED',
      files: ['external-links-content.js']
    });
  } catch {
    throw new Error('无法在当前页执行找外链。请等待页面加载完成；若刚切换过标签页，请点击扩展图标授权当前页后重试。');
  }
  const result = injections?.find(entry => entry.frameId === 0)?.result;
  if (!result?.ok) {
    throw new Error('页面脚本未返回结果，请刷新页面后重试。');
  }
  return result;
}

// 序列化后在页面 MAIN world 执行；只能依赖页面全局对象，不能引用模块作用域。
async function collectYouTubeMedia() {
  const DATA_ID = 'minetools-youtube-data';
  document.getElementById(DATA_ID)?.remove();

  const write = payload => {
    // YouTube 启用 Trusted Types，script 文本会被拦截；隐藏 div 只做数据桥接，不执行。
    const holder = document.createElement('div');
    holder.id = DATA_ID;
    holder.hidden = true;
    holder.textContent = JSON.stringify(payload);
    (document.body || document.documentElement).appendChild(holder);
  };

  let videoId = '';
  try {
    const url = new URL(location.href);
    if (url.pathname === '/watch') videoId = url.searchParams.get('v') || '';
    else videoId = (url.pathname.match(/^\/shorts\/([\w-]{5,})/) || [])[1] || '';
  } catch {}
  if (!videoId) {
    write({ ok: false });
    return { ok: false };
  }

  let visitorData = '';
  try {
    visitorData = window.ytcfg?.get?.('VISITOR_DATA') || '';
  } catch {}

  // WEB 客户端已改用 SABR 不下发直链；ANDROID/IOS 仍返回带签名的播放地址。按顺序尝试。
  const clients = [
    { clientName: 'ANDROID', clientVersion: '20.10.38', clientId: '3', extra: { androidSdkVersion: 34, osName: 'Android', osVersion: '14' } },
    { clientName: 'IOS', clientVersion: '20.10.4', clientId: '5', extra: { deviceMake: 'Apple', deviceModel: 'iPhone16,2', osName: 'iPhone', osVersion: '18.3.2.22D82' } }
  ];

  let data = null;
  for (const client of clients) {
    try {
      const response = await fetch('/youtubei/v1/player?prettyPrint=false', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-YouTube-Client-Name': client.clientId,
          'X-YouTube-Client-Version': client.clientVersion,
          'X-Goog-Visitor-Id': visitorData
        },
        body: JSON.stringify({
          context: { client: { clientName: client.clientName, clientVersion: client.clientVersion, hl: 'en', gl: 'US', visitorData, ...client.extra } },
          videoId,
          contentCheckOk: true,
          racyCheckOk: true
        })
      });
      const payload = await response.json();
      if (payload?.streamingData && payload.playabilityStatus?.status === 'OK') {
        data = payload;
        break;
      }
    } catch {}
  }

  if (!data) {
    write({ ok: false, videoId });
    return { ok: false };
  }

  const streaming = data.streamingData;
  const details = data.videoDetails || {};
  const pick = format => ({
    itag: format.itag,
    qualityLabel: format.qualityLabel || '',
    height: Number(format.height) || parseInt(format.qualityLabel, 10) || 0,
    contentLength: Number(format.contentLength) || 0,
    url: format.url || ''
  });
  const formats = streaming.formats || [];
  const adaptive = streaming.adaptiveFormats || [];

  const progressive = formats.filter(format => format.url && /^video\//.test(format.mimeType || '')).map(pick);

  // 同名画质有 avc1/av01 等多个版本；只保留 H.264，播放器抓取时也强制 avc1。
  const byQuality = new Map();
  for (const format of adaptive) {
    if (!/^video\/mp4/.test(format.mimeType || '') || format.audioQuality) continue;
    if (!/avc1/.test(format.mimeType || '')) continue;
    const label = format.qualityLabel || '';
    if (!label) continue;
    const current = byQuality.get(label);
    if (!current || (Number(format.contentLength) || 0) > (Number(current.contentLength) || 0)) {
      byQuality.set(label, format);
    }
  }
  const adaptiveVideo = [...byQuality.values()]
    .map(pick)
    .sort((a, b) => (parseInt(b.qualityLabel, 10) || 0) - (parseInt(a.qualityLabel, 10) || 0));
  const hasAudio = adaptive.some(format => /^audio\/mp4/.test(format.mimeType || ''));

  write({
    ok: true,
    videoId,
    title: details.title || document.title.replace(/\s*-\s*YouTube$/, ''),
    isLive: Boolean(details.isLive),
    thumbnail: details.thumbnail?.thumbnails?.slice(-1)[0]?.url || '',
    progressive: progressive.slice(0, 1),
    adaptiveVideo,
    hasAudio
  });
  return { ok: true, progressive: progressive.length, adaptive: adaptiveVideo.length };
}

function isYouTubePage(value) {
  try {
    const url = new URL(value);
    return /(^|\.)youtube\.com$/.test(url.hostname) && (url.pathname === '/watch' || url.pathname.startsWith('/shorts/'));
  } catch {
    return false;
  }
}

export async function runMediaScan(browserAPI) {
  const [tab] = await browserAPI.tabs.query({ active: true, currentWindow: true });
  if (!Number.isInteger(tab?.id)) {
    throw new Error('未找到当前标签页。');
  }
  if (!/^https?:/i.test(tab.url || '')) {
    throw new Error('当前页面不支持嗅探素材，请打开普通网页后重试。');
  }
  if (isYouTubePage(tab.url)) {
    try {
      await browserAPI.scripting.executeScript({
        target: { tabId: tab.id, allFrames: false },
        world: 'MAIN',
        func: collectYouTubeMedia
      });
    } catch {}
  }
  let injections;
  try {
    injections = await browserAPI.scripting.executeScript({
      target: { tabId: tab.id, allFrames: false },
      world: 'ISOLATED',
      files: ['media-content.js']
    });
  } catch {
    throw new Error('无法在当前页嗅探素材。请等待页面加载完成；若刚切换过标签页，请点击扩展图标授权当前页后重试。');
  }
  const result = injections?.find(entry => entry.frameId === 0)?.result;
  if (!result?.ok) {
    throw new Error('页面脚本未返回结果，请刷新页面后重试。');
  }
  return result;
}

export async function readCurrentExplore(browserAPI) {
  const [tab] = await browserAPI.tabs.query({ active: true, currentWindow: true });
  let url;
  try {
    url = new URL(tab?.url || '');
  } catch {
    throw new Error('无法读取当前页地址，请打开 trends.google.com 的探索页后重试。');
  }
  if (url.hostname !== 'trends.google.com') {
    throw new Error('请先打开 trends.google.com 的探索页。');
  }
  return {
    url: url.href,
    query: url.searchParams.get('q') || '',
    params: Object.fromEntries(url.searchParams)
  };
}
