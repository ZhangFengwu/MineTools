// Opens a window-wide global side panel so it survives tab switches.
// The action click also refreshes the activeTab grant for the current tab.
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId }).catch((error) => {
    console.error('MineTools: failed to open the side panel.', error);
  });
});

// 素材下载经浏览器下载管理器完成，绕开页面内 fetch 的跨域限制。
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'minetools-media-download') return;
  const url = String(message.url || '');
  if (!/^(?:https?|data):/i.test(url)) {
    sendResponse({ ok: false, error: '不支持的下载地址。' });
    return;
  }
  const options = { url, conflictAction: 'uniquify' };
  const filename = String(message.filename || '').trim();
  if (filename) options.filename = filename;
  chrome.downloads.download(options, (downloadId) => {
    const error = chrome.runtime.lastError;
    sendResponse(error ? { ok: false, error: error.message } : { ok: true, downloadId });
  });
  return true;
});
