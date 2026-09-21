import { getSearchTab, openPanel } from './extension.js';

const MAX_SELECT = 8;
const selected = new Set();
let allKeywords = [];
let groupMap = new Map();

// Load keywords from JSON
async function loadKeywords() {
  const res = await fetch(chrome.runtime.getURL('keywords.json'));
  const data = await res.json();
  allKeywords = [];
  groupMap.clear();
  for (const group of data.groups) {
    for (const kw of group.keywords) {
      allKeywords.push(kw);
      groupMap.set(kw.en, group);
    }
  }
  renderKeywords();
}

// Tab switching
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`panel-${tab.dataset.tab}`).classList.add('active');
  });
});

// SERP panel
const status = document.getElementById('status');
const openButton = document.getElementById('open-panel');
const setStatus = (message, state) => {
  status.textContent = message;
  status.dataset.state = state;
};

async function initializeSerp() {
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

initializeSerp();

// Trends panel
const grid = document.getElementById('keyword-grid');
const countEl = document.getElementById('selected-count');
const clearBtn = document.getElementById('clear-btn');
const trendsBtn = document.getElementById('trends-btn');
const expansionArea = document.getElementById('expansion-area');
const expansionInput = document.getElementById('expansion-input');

function renderKeywords() {
  grid.innerHTML = '';
  for (const kw of allKeywords) {
    const chip = document.createElement('span');
    chip.className = 'keyword-chip';
    chip.textContent = kw.en;
    chip.dataset.tooltip = kw.zh;

    const group = groupMap.get(kw.en);
    if (group) {
      chip.dataset.group = group.id;
    }

    if (selected.has(kw.en)) {
      chip.classList.add('selected');
    } else if (selected.size >= MAX_SELECT) {
      chip.classList.add('disabled');
    }

    chip.addEventListener('click', () => toggleKeyword(kw.en));
    grid.appendChild(chip);
  }
  updateTrendsControls();
}

function toggleKeyword(keyword) {
  if (selected.has(keyword)) {
    selected.delete(keyword);
  } else if (selected.size < MAX_SELECT) {
    selected.add(keyword);
  }
  renderKeywords();
  updateExpansionInput();
}

function updateTrendsControls() {
  countEl.textContent = selected.size;
  clearBtn.disabled = selected.size === 0;
  trendsBtn.disabled = selected.size === 0;
  expansionArea.hidden = selected.size === 0;
}

function updateExpansionInput() {
  const parts = [];
  for (const kw of allKeywords) {
    if (selected.has(kw.en) && kw.examples) {
      parts.push(kw.examples);
    }
  }
  expansionInput.value = parts.join(', ');
}

clearBtn.addEventListener('click', () => {
  selected.clear();
  renderKeywords();
  updateExpansionInput();
});

trendsBtn.addEventListener('click', () => {
  if (selected.size === 0) return;
  const q = [...selected].join(',');
  const url = `https://trends.google.com/explore?q=${encodeURIComponent(q)}&date=today%201-m`;
  chrome.tabs.create({ url });
  window.close();
});

loadKeywords();
