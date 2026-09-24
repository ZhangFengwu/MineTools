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

// AhrefsBacklink panel
const ahrefsDomainInput = document.getElementById('ahrefs-domain');
const ahrefsQueryBtn = document.getElementById('ahrefs-query-btn');
const ahrefsExtractBtn = document.getElementById('ahrefs-extract-btn');
const ahrefsStatus = document.getElementById('ahrefs-status');
const ahrefsHistory = document.getElementById('ahrefs-history');
const ahrefsDetail = document.getElementById('ahrefs-detail');
const ahrefsClearHistory = document.getElementById('ahrefs-clear-history');

const STORAGE_KEY = 'minetools_ahrefs_history';
let ahrefsHistoryData = [];
let ahrefsLastTabId = null;

function loadAhrefsHistory() {
  try {
    ahrefsHistoryData = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch {
    ahrefsHistoryData = [];
  }
  renderAhrefsHistory();
}

function saveAhrefsHistory() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(ahrefsHistoryData));
}

function setAhrefsStatus(message, state) {
  ahrefsStatus.textContent = message;
  ahrefsStatus.dataset.state = state || 'idle';
}

function isValidDomain(domain) {
  return /^[a-zA-Z0-9][a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(domain.trim());
}

function updateAhrefsControls() {
  const domain = ahrefsDomainInput.value.trim();
  ahrefsQueryBtn.disabled = !isValidDomain(domain);
}

ahrefsDomainInput.addEventListener('input', updateAhrefsControls);

ahrefsQueryBtn.addEventListener('click', () => {
  const domain = ahrefsDomainInput.value.trim();
  if (!isValidDomain(domain)) return;
  const url = `https://ahrefs.com/backlink-checker/?input=${encodeURIComponent(domain)}&mode=subdomains`;
  chrome.tabs.create({ url }, (tab) => {
    ahrefsLastTabId = tab?.id || null;
  });
  setAhrefsStatus(`已打开 Ahrefs 页面，等待加载完成后可点击提取。`, 'ready');
});

ahrefsExtractBtn.addEventListener('click', async () => {
  setAhrefsStatus('正在查找 Ahrefs 页面…', 'loading');

  try {
    // Find the Ahrefs tab
    let targetTabId = ahrefsLastTabId;
    let targetTabUrl = '';

    if (targetTabId) {
      // Verify the tab still exists and is an Ahrefs page
      try {
        const tab = await chrome.tabs.get(targetTabId);
        if (tab?.url?.includes('ahrefs.com/backlink-checker')) {
          targetTabUrl = tab.url;
        } else {
          targetTabId = null;
        }
      } catch {
        targetTabId = null;
      }
    }

    if (!targetTabId) {
      // Search for any Ahrefs backlink-checker tab
      const tabs = await chrome.tabs.query({ url: '*://ahrefs.com/backlink-checker/*' });
      if (tabs.length > 0) {
        targetTabId = tabs[tabs.length - 1].id;
        targetTabUrl = tabs[tabs.length - 1].url;
      }
    }

    if (!targetTabId) {
      setAhrefsStatus('未找到 Ahrefs 反链页面，请先输入域名并点击查询。', 'error');
      return;
    }

    // Check if the page is loaded
    const tab = await chrome.tabs.get(targetTabId);
    if (tab?.status !== 'complete') {
      setAhrefsStatus('Ahrefs 页面仍在加载中，请稍后再试。', 'error');
      return;
    }

    setAhrefsStatus('正在提取DR数据…', 'loading');

    const injections = await chrome.scripting.executeScript({
      target: { tabId: targetTabId, allFrames: false },
      world: 'ISOLATED',
      files: ['ahrefs-content.js']
    });

    const result = injections?.find(entry => entry.frameId === 0)?.result;
    if (!result?.ok) {
      setAhrefsStatus('页面尚未准备好，请等待 Ahrefs 页面完全加载后重试。', 'error');
      return;
    }

    // Extract domain from URL if input is empty
    let domain = ahrefsDomainInput.value.trim();
    if (!domain && targetTabUrl) {
      try {
        const urlObj = new URL(targetTabUrl);
        const inputParam = urlObj.searchParams.get('input');
        if (inputParam) domain = inputParam;
      } catch {}
    }

    if (!domain) {
      setAhrefsStatus('无法获取域名，请在输入框中填写域名。', 'error');
      return;
    }

    const record = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      domain,
      timestamp: new Date().toISOString(),
      domainRating: result.domainRating || '',
      backlinks: result.backlinks || '',
      linkingWebsites: result.linkingWebsites || '',
      referringPages: result.referringPages || []
    };

    ahrefsHistoryData.unshift(record);
    if (ahrefsHistoryData.length > 50) ahrefsHistoryData = ahrefsHistoryData.slice(0, 50);
    saveAhrefsHistory();
    renderAhrefsHistory();

    const details = [];
    if (result.domainRating) details.push(`DR: ${result.domainRating}`);
    if (result.backlinks) details.push(`Backlinks: ${result.backlinks}`);
    if (result.linkingWebsites) details.push(`Linking: ${result.linkingWebsites}`);
    details.push(`${result.referringPages?.length || 0} 条外链`);
    
    setAhrefsStatus(`提取成功！${details.join('，')}。`, 'success');
  } catch (error) {
    setAhrefsStatus(error.message, 'error');
  }
});

function renderAhrefsHistory() {
  ahrefsHistory.innerHTML = '';
  ahrefsClearHistory.disabled = ahrefsHistoryData.length === 0;

  if (ahrefsHistoryData.length === 0) {
    ahrefsHistory.innerHTML = '<div class="ahrefs-history-empty">暂无查询记录</div>';
    return;
  }

  for (const record of ahrefsHistoryData) {
    const item = document.createElement('div');
    item.className = 'ahrefs-history-item';

    const date = new Date(record.timestamp);
    const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;

    item.innerHTML = `
      <div class="ahrefs-history-main">
        <span class="ahrefs-history-domain">${escHtml(record.domain)}</span>
        <span class="ahrefs-history-date">${dateStr}</span>
      </div>
      <div class="ahrefs-history-metrics">
        <span>DR: ${escHtml(record.domainRating || '-')}</span>
        <span>外链数: ${escHtml(record.backlinks || '-')}</span>
        <span>域名数: ${escHtml(record.linkingWebsites || '-')}</span>
      </div>
    `;

    item.addEventListener('click', () => showAhrefsDetail(record));

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'ahrefs-history-delete';
    deleteBtn.textContent = '×';
    deleteBtn.title = '删除';
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteAhrefsRecord(record.id);
    });

    item.appendChild(deleteBtn);
    ahrefsHistory.appendChild(item);
  }
}

function escHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function deleteAhrefsRecord(id) {
  ahrefsHistoryData = ahrefsHistoryData.filter(r => r.id !== id);
  saveAhrefsHistory();
  renderAhrefsHistory();
  if (ahrefsDetail.dataset.recordId === id) {
    hideAhrefsDetail();
  }
}

ahrefsClearHistory.addEventListener('click', () => {
  if (confirm('确定清空所有查询历史？')) {
    ahrefsHistoryData = [];
    saveAhrefsHistory();
    renderAhrefsHistory();
    hideAhrefsDetail();
  }
});

function showAhrefsDetail(record) {
  ahrefsDetail.dataset.recordId = record.id;
  ahrefsDetail.classList.add('active');
  ahrefsHistory.style.display = 'none';

  const date = new Date(record.timestamp);
  const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;

  let pagesHtml = '';
  if (record.referringPages && record.referringPages.length > 0) {
    pagesHtml = record.referringPages.map((p, i) => `
      <tr>
        <td>${p.dr || '-'}</td>
        <td><a href="${escHtml(p.pageUrl)}" target="_blank">${escHtml(p.pageUrl)}</a></td>
        <td>${escHtml(p.anchorText || '-')}</td>
        <td><a href="${escHtml(p.targetUrl)}" target="_blank">${escHtml(p.targetUrl)}</a></td>
      </tr>
    `).join('');
  } else {
    pagesHtml = '<tr><td colspan="4" style="text-align:center;color:#62798c;">无外链数据</td></tr>';
  }

  ahrefsDetail.innerHTML = `
    <div class="ahrefs-detail-header">
      <button id="ahrefs-detail-back" type="button" class="btn-text">← 返回</button>
      <span class="ahrefs-detail-title">${escHtml(record.domain)}</span>
      <span class="ahrefs-detail-date">${dateStr}</span>
      <button id="ahrefs-detail-copy" type="button" class="btn-copy">复制 MD</button>
    </div>
    <div class="ahrefs-detail-content">
      <div class="ahrefs-detail-metrics">
        <span><em>DR</em>${escHtml(record.domainRating || '-')}</span>
        <span><em>外链数</em>${escHtml(record.backlinks || '-')}</span>
        <span><em>域名数</em>${escHtml(record.linkingWebsites || '-')}</span>
      </div>
      <div class="ahrefs-detail-table-wrap">
        <table class="ahrefs-detail-table">
          <thead>
            <tr>
              <th>DR</th>
              <th>Referring Page</th>
              <th>Anchor Text</th>
              <th>Target URL</th>
            </tr>
          </thead>
          <tbody>${pagesHtml}</tbody>
        </table>
      </div>
    </div>
  `;

  document.getElementById('ahrefs-detail-back').addEventListener('click', hideAhrefsDetail);
  document.getElementById('ahrefs-detail-copy').addEventListener('click', () => copyAhrefsAsMarkdown(record));
}

function hideAhrefsDetail() {
  ahrefsDetail.classList.remove('active');
  ahrefsDetail.dataset.recordId = '';
  ahrefsHistory.style.display = '';
}

function copyAhrefsAsMarkdown(record) {
  const date = new Date(record.timestamp);
  const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;

  let md = `# Ahrefs 反链分析 - ${record.domain}\n\n`;
  md += `**查询时间**: ${dateStr}\n\n`;
  md += `## 域名指标\n\n`;
  md += `| 指标 | 值 |\n| --- | --- |\n`;
  md += `| Domain Rating | ${record.domainRating || '-'} |\n`;
  md += `| Backlinks | ${record.backlinks || '-'} |\n`;
  md += `| Linking Websites | ${record.linkingWebsites || '-'} |\n\n`;

  if (record.referringPages && record.referringPages.length > 0) {
    md += `## 外链列表 (${record.referringPages.length} 条)\n\n`;
    md += `| DR | Referring Page | Anchor Text | Target URL |\n| --- | --- | --- | --- |\n`;
    for (const p of record.referringPages) {
      const anchor = p.anchorText ? `[${p.anchorText}](${p.targetUrl})` : p.targetUrl;
      md += `| ${p.dr || '-'} | ${p.pageUrl} | ${anchor} | ${p.targetUrl} |\n`;
    }
  }

  navigator.clipboard.writeText(md).then(() => {
    const copyBtn = document.getElementById('ahrefs-detail-copy');
    if (copyBtn) {
      const original = copyBtn.textContent;
      copyBtn.textContent = '已复制!';
      setTimeout(() => { copyBtn.textContent = original; }, 1500);
    }
  }).catch(() => {
    setAhrefsStatus('复制失败，请手动复制。', 'error');
  });
}

loadAhrefsHistory();
