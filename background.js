// Opens a window-wide global side panel so it survives tab switches.
// The action click also refreshes the activeTab grant for the current tab.
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId }).catch((error) => {
    console.error('MineTools: failed to open the side panel.', error);
  });
});
