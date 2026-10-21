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
