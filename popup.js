import { getSearchTab, openPanel } from './extension.js';

const status = document.getElementById('status');
const openButton = document.getElementById('open-panel');
const setStatus = (message, state) => {
  status.textContent = message;
  status.dataset.state = state;
};

async function initialize() {
  try {
    const tab = await getSearchTab(chrome);
    setStatus(`已就绪 · ${new URL(tab.url).hostname}`, 'ready');
    openButton.disabled = false;
  } catch (error) {
    setStatus(error.message, 'error');
  }
}

openButton.addEventListener('click', async () => {
  openButton.disabled = true;
  setStatus('正在提取当前页结果…', 'loading');
  try {
    await openPanel(chrome);
    window.close();
  } catch (error) {
    setStatus(error.message, 'error');
    openButton.disabled = false;
  }
});

initialize();
