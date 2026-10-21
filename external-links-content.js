// MineTools 页面外链扫描内容脚本。由侧边栏“找外链”按钮按需注入。
(function () {
  const PANEL_ID = 'minetools-external-links-panel';
  const HIGHLIGHT_ATTR = 'data-minetools-external-link';
  const STYLE_ID = 'minetools-external-link-style';

  const previous = document.getElementById(PANEL_ID);
  if (previous) previous.remove();

  const stripWww = hostname => hostname.replace(/^www\./, '');

  function escapeCsv(value) {
    const str = String(value ?? '').replace(/"/g, '""');
    return /("|,|\n|\r)/.test(str) ? `"${str}"` : str;
  }

  function isVisible(element) {
    return Boolean(element.offsetWidth || element.offsetHeight || element.getClientRects().length);
  }

  function ensureHighlightStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `a[${HIGHLIGHT_ATTR}]{outline:3px solid #ff0000!important;background:rgba(255,255,0,.3)!important;color:#000!important;box-shadow:0 0 10px rgba(255,0,0,.5)!important;transition:all .3s}`;
    (document.head || document.documentElement).appendChild(style);
  }

  function scanLinks() {
    document.querySelectorAll(`[${HIGHLIGHT_ATTR}]`).forEach(link => link.removeAttribute(HIGHLIGHT_ATTR));
    ensureHighlightStyle();

    const currentHost = stripWww(location.hostname);
    const seen = new Set();
    const records = [];
    let total = 0;

    for (const link of document.querySelectorAll('a[href]')) {
      let url;
      try {
        url = new URL(link.href, location.origin);
      } catch {
        continue;
      }
      if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;
      if (stripWww(url.hostname) === currentHost) continue;

      total += 1;
      link.setAttribute(HIGHLIGHT_ATTR, '');
      if (seen.has(url.href)) continue;
      seen.add(url.href);

      let text = link.innerText.trim().replace(/[\r\n]+/g, ' ');
      if (!text && link.querySelector('img')) {
        text = `[图片] ${link.querySelector('img').alt || '无Alt属性'}`;
      }
      text = text || '[无文字]';

      let rel = link.getAttribute('rel') || 'dofollow';
      if (rel === '') rel = 'dofollow';

      records.push({
        url: url.href,
        text,
        rel,
        target: link.getAttribute('target') || '_self',
        visible: isVisible(link) ? '可见' : '隐藏/不可见'
      });
    }
    return { records, total };
  }

  function toCsv(records) {
    const rows = [['URL', '锚文本/Alt', 'Rel属性', '打开方式', '可见性'].join(',')];
    for (const item of records) {
      rows.push([
        escapeCsv(item.url),
        escapeCsv(item.text),
        escapeCsv(item.rel),
        escapeCsv(item.target),
        escapeCsv(item.visible)
      ].join(','));
    }
    return '\uFEFF' + rows.join('\n');
  }

  function createPanel(records, total, currentHost) {
    const host = document.createElement('div');
    host.id = PANEL_ID;
    host.style.cssText = 'all:initial!important;position:fixed!important;top:16px!important;right:16px!important;width:min(680px,calc(100vw - 32px))!important;z-index:2147483647!important;display:block!important;';

    const root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = [
      ':host{color-scheme:light}',
      '.panel{box-sizing:border-box;display:flex;flex-direction:column;max-height:calc(100vh - 32px);overflow:hidden;color:#172033;background:rgba(248,250,252,.94);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border:1px solid rgba(148,163,184,.5);border-radius:14px;box-shadow:0 12px 40px rgba(15,23,42,.22);font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}',
      '.header{display:flex;align-items:center;flex-wrap:wrap;gap:8px;padding:12px 14px 8px;cursor:grab;user-select:none;touch-action:none}.header.dragging{cursor:grabbing}',
      'h2{font-size:16px;margin:0}',
      '.count{font-size:12px;color:#168072;background:#e8f5f1;padding:2px 8px;border-radius:10px;font-variant-numeric:tabular-nums}',
      'button{border:0;border-radius:6px;background:transparent;color:#475569;font-family:inherit;font-size:13px;line-height:1.4;cursor:pointer;padding:6px 10px}button:hover{background:rgba(148,163,184,.2)}',
      '.download{margin-left:auto;background:#15354b;color:#fff;font-weight:600}.download:hover{background:#205570}.download:disabled{background:#e9eef2;color:#899aa8;cursor:default}',
      '.close{font-size:20px;line-height:1;padding:4px 8px}',
      'button:focus-visible,a:focus-visible{outline:2px solid #2563eb;outline-offset:2px}',
      '.hint{margin:0;padding:0 16px 8px;font-size:12px;color:#64748b;overflow-wrap:anywhere}',
      '.list{overflow:auto;min-height:0;padding:0 16px}',
      'table{width:100%;min-width:560px;border-collapse:collapse;table-layout:fixed;text-align:left;font-size:12px}',
      'th{position:sticky;top:0;z-index:1;background:#eef2f6;font-weight:600;color:#475569}',
      'th,td{padding:8px;border-bottom:1px solid #e2e8f0;vertical-align:top;overflow-wrap:anywhere}',
      'th:nth-child(1),td:nth-child(1){width:38%}th:nth-child(2),td:nth-child(2){width:24%}th:nth-child(3),td:nth-child(3){width:14%}th:nth-child(4),td:nth-child(4){width:10%}th:nth-child(5),td:nth-child(5){width:14%}',
      'a{color:#1d4ed8;text-decoration:none}a:hover{text-decoration:underline}',
      '.tag{display:inline-block;padding:1px 6px;border-radius:4px;color:#fff;font-size:11px;overflow-wrap:anywhere}',
      '.tag-follow{background:#27ae60}.tag-nofollow{background:#e74c3c}',
      '.empty{text-align:center;color:#64748b;padding:28px 8px}',
      '.footer{margin:0;padding:8px 16px 12px;font-size:11px;color:#64748b}'
    ].join('');
    root.appendChild(style);

    const panel = document.createElement('section');
    panel.className = 'panel';
    panel.setAttribute('aria-label', '外部链接扫描结果');
    panel.innerHTML = '<div class="header"><h2 title="拖动标题栏左右移动">外部链接</h2><span class="count"></span><button type="button" class="download" disabled>下载 CSV</button><button type="button" class="close" aria-label="关闭外部链接面板" title="关闭">×</button></div><p class="hint"></p><div class="list"><table><thead><tr><th scope="col">URL</th><th scope="col">锚文本</th><th scope="col">Rel</th><th scope="col">Target</th><th scope="col">可见性</th></tr></thead><tbody></tbody></table></div><p class="footer"></p>';
    root.appendChild(panel);

    panel.querySelector('.count').textContent = `${records.length} 个`;
    panel.querySelector('.hint').textContent = `${currentHost} · 已高亮 ${total} 个外链元素`;
    panel.querySelector('.footer').textContent = `去重后 ${records.length} 个外链`;
    const download = panel.querySelector('.download');
    const tbody = panel.querySelector('tbody');

    if (records.length === 0) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 5;
      cell.className = 'empty';
      cell.textContent = '未发现外部链接';
      row.appendChild(cell);
      tbody.appendChild(row);
    } else {
      download.disabled = false;
      for (const item of records) {
        const row = document.createElement('tr');

        const urlCell = document.createElement('td');
        const link = document.createElement('a');
        link.href = item.url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = item.url;
        urlCell.appendChild(link);

        const textCell = document.createElement('td');
        textCell.textContent = item.text;

        const relCell = document.createElement('td');
        const tag = document.createElement('span');
        tag.className = `tag ${item.rel.includes('nofollow') ? 'tag-nofollow' : 'tag-follow'}`;
        tag.textContent = item.rel;
        relCell.appendChild(tag);

        const targetCell = document.createElement('td');
        targetCell.textContent = item.target;

        const visibleCell = document.createElement('td');
        visibleCell.textContent = item.visible;

        row.append(urlCell, textCell, relCell, targetCell, visibleCell);
        tbody.appendChild(row);
      }
    }

    const header = panel.querySelector('.header');
    let drag = null;
    function moveHorizontally(left) {
      const maxLeft = Math.max(16, document.documentElement.clientWidth - host.getBoundingClientRect().width - 16);
      host.style.setProperty('right', 'auto', 'important');
      host.style.setProperty('left', Math.max(16, Math.min(left, maxLeft)) + 'px', 'important');
    }
    function stopDragging(event) {
      if (!drag || (event && event.pointerId !== drag.pointerId)) return;
      const pointerId = drag.pointerId;
      drag = null;
      header.classList.remove('dragging');
      if (header.hasPointerCapture(pointerId)) header.releasePointerCapture(pointerId);
    }
    header.addEventListener('pointerdown', event => {
      if (!event.isPrimary || event.button !== 0 || event.target.closest('button')) return;
      drag = { pointerId: event.pointerId, startX: event.clientX, startLeft: host.getBoundingClientRect().left };
      header.setPointerCapture(event.pointerId);
      header.classList.add('dragging');
      event.preventDefault();
    });
    header.addEventListener('pointermove', event => {
      if (drag && event.pointerId === drag.pointerId) moveHorizontally(drag.startLeft + event.clientX - drag.startX);
    });
    header.addEventListener('pointerup', stopDragging);
    header.addEventListener('pointercancel', stopDragging);
    header.addEventListener('lostpointercapture', stopDragging);
    function keepPanelInView() {
      if (host.style.left) moveHorizontally(host.getBoundingClientRect().left);
    }
    window.addEventListener('resize', keepPanelInView);

    function removePanel() {
      window.removeEventListener('resize', keepPanelInView);
      host.remove();
    }
    host.removeExternalLinkPanel = removePanel;
    panel.querySelector('.close').addEventListener('click', removePanel);
    download.addEventListener('click', () => {
      const url = URL.createObjectURL(new Blob([toCsv(records)], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `External_Links_${currentHost}.csv`;
      link.style.display = 'none';
      root.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });

    document.body.appendChild(host);
  }

  const { records, total } = scanLinks();
  createPanel(records, total, stripWww(location.hostname));
  return { ok: true, count: records.length, total };
})();
