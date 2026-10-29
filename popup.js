import { getSearchTab, openPanel, runDomainCheck, openBacklinkChecker, runExternalLinkScan, runMediaScan, readCurrentExplore, isValidDomain, normalizeDomain } from './extension.js';

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
    openButton.disabled = true;
  }
}

let serpRefreshTimer = 0;
function scheduleSerpRefresh() {
  clearTimeout(serpRefreshTimer);
  serpRefreshTimer = setTimeout(initializeSerp, 120);
}

chrome.tabs.onActivated.addListener(scheduleSerpRefresh);
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tab.active && (changeInfo.status === 'complete' || changeInfo.url)) scheduleSerpRefresh();
});

openButton.addEventListener('click', async () => {
  openButton.disabled = true;
  setStatus('正在提取当前页结果…', 'loading');
  try {
    const result = await openPanel(chrome);
    const count = Number.isInteger(result?.resultCount) ? ` · ${result.resultCount} 条结果` : '';
    setStatus(`采集面板已打开${count}`, 'ready');
  } catch (error) {
    setStatus(error.message, 'error');
  } finally {
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

function updateAhrefsControls() {
  ahrefsQueryBtn.disabled = !isValidDomain(ahrefsDomainInput.value);
}

ahrefsDomainInput.addEventListener('input', updateAhrefsControls);

ahrefsQueryBtn.addEventListener('click', () => {
  const domain = normalizeDomain(ahrefsDomainInput.value);
  if (!isValidDomain(domain)) return;
  ahrefsDomainInput.value = domain;
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
    let domain = normalizeDomain(ahrefsDomainInput.value);
    if (!domain && targetTabUrl) {
      try {
        const urlObj = new URL(targetTabUrl);
        const inputParam = urlObj.searchParams.get('input');
        if (inputParam) domain = normalizeDomain(inputParam);
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

// Domain panel
const domainRun = document.getElementById('domain-run');
const domainStatus = document.getElementById('domain-status');

domainRun.addEventListener('click', async () => {
  domainRun.disabled = true;
  domainStatus.textContent = '正在当前页执行查域名…';
  domainStatus.dataset.state = 'loading';
  try {
    await runDomainCheck(chrome);
    domainStatus.textContent = '已执行，结果面板显示在页面右侧。';
    domainStatus.dataset.state = 'ready';
  } catch (error) {
    domainStatus.textContent = error.message;
    domainStatus.dataset.state = 'error';
  } finally {
    domainRun.disabled = false;
  }
});

// Backlink panel
const backlinkRun = document.getElementById('backlink-run');
const backlinkStatus = document.getElementById('backlink-status');

backlinkRun.addEventListener('click', async () => {
  backlinkRun.disabled = true;
  backlinkStatus.textContent = '正在读取当前页域名…';
  backlinkStatus.dataset.state = 'loading';
  try {
    const hostname = await openBacklinkChecker(chrome);
    backlinkStatus.textContent = `已在新标签页打开 Ahrefs：${hostname}`;
    backlinkStatus.dataset.state = 'ready';
  } catch (error) {
    backlinkStatus.textContent = error.message;
    backlinkStatus.dataset.state = 'error';
  } finally {
    backlinkRun.disabled = false;
  }
});

// External links panel
const linksRun = document.getElementById('links-run');
const linksStatus = document.getElementById('links-status');

linksRun.addEventListener('click', async () => {
  linksRun.disabled = true;
  linksStatus.textContent = '正在扫描当前页外链…';
  linksStatus.dataset.state = 'loading';
  try {
    const result = await runExternalLinkScan(chrome);
    const count = Number.isInteger(result?.count) ? result.count : null;
    if (count === 0) {
      linksStatus.textContent = '未发现外部链接，浮窗显示空结果。';
    } else if (count === null) {
      linksStatus.textContent = '已执行，结果面板显示在页面右侧。';
    } else {
      linksStatus.textContent = `找到 ${count} 个外链，结果面板显示在页面右侧。`;
    }
    linksStatus.dataset.state = 'ready';
  } catch (error) {
    linksStatus.textContent = error.message;
    linksStatus.dataset.state = 'error';
  } finally {
    linksRun.disabled = false;
  }
});

// Media panel
const mediaRun = document.getElementById('media-run');
const mediaStatus = document.getElementById('media-status');

mediaRun.addEventListener('click', async () => {
  mediaRun.disabled = true;
  mediaStatus.textContent = '正在嗅探当前页素材…';
  mediaStatus.dataset.state = 'loading';
  try {
    const result = await runMediaScan(chrome);
    const images = Number.isInteger(result?.images) ? result.images : null;
    const videos = Number.isInteger(result?.videos) ? result.videos : null;
    const audios = Number.isInteger(result?.audios) ? result.audios : 0;
    if (result?.count === 0) {
      mediaStatus.textContent = '未发现图片或视频素材，浮窗显示空结果。';
    } else if (images === null || videos === null) {
      mediaStatus.textContent = '已执行，结果面板显示在页面右侧。';
    } else {
      const audioText = audios ? `、${audios} 个音频` : '';
      mediaStatus.textContent = `找到 ${images} 个图片、${videos} 个视频${audioText}，结果面板显示在页面右侧。`;
    }
    mediaStatus.dataset.state = 'ready';
  } catch (error) {
    mediaStatus.textContent = error.message;
    mediaStatus.dataset.state = 'error';
  } finally {
    mediaRun.disabled = false;
  }
});

// Explore panel
const EXPLORE_STORAGE_KEY = 'minetools_explore_history';
const EXPLORE_LIMIT = 50;
const exploreSave = document.getElementById('explore-save');
const exploreClear = document.getElementById('explore-clear');
const exploreStatus = document.getElementById('explore-status');
const exploreList = document.getElementById('explore-list');
let exploreHistory = [];

function saveExploreHistory() {
  try {
    localStorage.setItem(EXPLORE_STORAGE_KEY, JSON.stringify(exploreHistory));
  } catch {}
}

function setExploreStatus(message, state = 'idle') {
  exploreStatus.textContent = message;
  exploreStatus.dataset.state = state;
}

function formatExploreTime(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function renderExploreHistory() {
  exploreClear.disabled = exploreHistory.length === 0;
  exploreList.replaceChildren();
  if (exploreHistory.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'explore-empty';
    empty.textContent = '暂无保存的探索';
    exploreList.append(empty);
    return;
  }

  for (const record of exploreHistory) {
    const item = document.createElement('div');
    item.className = 'explore-item';
    item.title = `${record.url}\n点击打开`;

    const main = document.createElement('div');
    main.className = 'explore-main';
    const query = document.createElement('div');
    query.className = 'explore-query';
    query.textContent = record.query || '无关键词';
    const meta = document.createElement('div');
    meta.className = 'explore-meta';
    const parts = [];
    if (record.params?.date) parts.push(record.params.date);
    if (record.params?.geo) parts.push(record.params.geo);
    parts.push(formatExploreTime(record.timestamp));
    meta.textContent = parts.filter(Boolean).join(' · ');
    main.append(query, meta);

    const actions = document.createElement('div');
    actions.className = 'explore-actions';
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'explore-action';
    copy.textContent = '复制';
    copy.title = '复制链接';
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'explore-action explore-delete';
    remove.textContent = '×';
    remove.title = '删除';
    actions.append(copy, remove);

    item.append(main, actions);
    item.addEventListener('click', () => chrome.tabs.create({ url: record.url }));
    copy.addEventListener('click', (event) => {
      event.stopPropagation();
      navigator.clipboard.writeText(record.url).then(() => {
        copy.textContent = '已复制';
        setTimeout(() => { copy.textContent = '复制'; }, 1200);
      }).catch(() => setExploreStatus('复制失败，请手动复制。', 'error'));
    });
    remove.addEventListener('click', (event) => {
      event.stopPropagation();
      exploreHistory = exploreHistory.filter(entry => entry.id !== record.id);
      saveExploreHistory();
      renderExploreHistory();
      setExploreStatus('已删除该探索。', 'ready');
    });
    exploreList.append(item);
  }
}

function loadExploreHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(EXPLORE_STORAGE_KEY) || '[]');
    exploreHistory = Array.isArray(parsed)
      ? parsed.filter(item => item &&
          typeof item.id === 'string' &&
          typeof item.url === 'string' &&
          /^https:\/\/trends\.google\.com\//.test(item.url) &&
          typeof item.query === 'string' &&
          typeof item.timestamp === 'string')
      : [];
  } catch {
    exploreHistory = [];
  }
  renderExploreHistory();
}

exploreSave.addEventListener('click', async () => {
  exploreSave.disabled = true;
  setExploreStatus('正在读取当前页参数…', 'loading');
  try {
    const data = await readCurrentExplore(chrome);
    const existed = exploreHistory.some(item => item.url === data.url);
    exploreHistory = exploreHistory.filter(item => item.url !== data.url);
    exploreHistory.unshift({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      url: data.url,
      query: data.query,
      params: data.params,
      timestamp: new Date().toISOString()
    });
    if (exploreHistory.length > EXPLORE_LIMIT) exploreHistory.length = EXPLORE_LIMIT;
    saveExploreHistory();
    renderExploreHistory();
    setExploreStatus(existed ? '该探索已存在，已更新保存时间。' : '已保存当前探索。', 'ready');
  } catch (error) {
    setExploreStatus(error.message, 'error');
  } finally {
    exploreSave.disabled = false;
  }
});

exploreClear.addEventListener('click', () => {
  if (exploreHistory.length === 0) return;
  if (confirm('确定清空所有已存探索？')) {
    exploreHistory = [];
    saveExploreHistory();
    renderExploreHistory();
    setExploreStatus('已清空已存探索。', 'ready');
  }
});

loadExploreHistory();
