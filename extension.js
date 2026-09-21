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
    throw new Error('请先打开 Google 搜索结果页，再点击 MineTools。');
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
    throw new Error('未能打开面板。请等待页面加载完成，或刷新搜索页后重试。');
  }
  const result = injections?.find(entry => entry.frameId === 0)?.result;
  if (!result?.ok) {
    throw new Error('页面尚未准备好，请刷新搜索页后重试。');
  }
  return result;
}
