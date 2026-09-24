// MineTools Ahrefs backlink extractor content script.
// Injected into ahrefs.com/backlink-checker pages to extract domain metrics and referring pages.
(function () {
  if (!document.body) return { ok: false, error: 'No body' };

  function text(node) {
    return node ? node.textContent.trim() : '';
  }

  // Collect all elements whose own text (leaf-level) equals the label, excluding tables/headers
  function findLabelElements(label) {
    const matches = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const t = walker.currentNode.textContent.trim().toLowerCase();
      if (t !== label.toLowerCase()) continue;
      const el = walker.currentNode.parentElement;
      if (!el) continue;
      // Skip table headers and footer/marketing areas
      if (el.closest('th')) continue;
      if (el.closest('footer')) continue;
      matches.push(el);
    }
    return matches;
  }

  // From a label element, walk up to find a compact card container, then read
  // the count (smallest pure-number element) and dofollow pct (smallest element with %)
  function extractCardValue(labelEl) {
    let container = labelEl.parentElement;
    let bestResult = null;
    for (let depth = 0; depth < 8 && container; depth++) {
      const containerText = text(container);
      if (containerText.length > 0 && containerText.length < 500 && /\d/.test(containerText)) {
        let count = '';
        let pct = '';
        for (const el of container.querySelectorAll('*')) {
          const et = text(el);
          if (!et || et === containerText) continue;
          if (/^\d{1,3}\s*%/.test(et) && et.length < 40 && (!pct || et.length < pct.length)) {
            pct = et;
            continue;
          }
          if (!count && /^\d[\d.,]*$/.test(et)) {
            const n = et.replace(/[.,]$/, '');
            if (!isNaN(parseFloat(n.replace(/,/g, '')))) count = n;
          }
        }
        if (count) {
          if (!bestResult || (pct && !bestResult.pct)) {
            bestResult = { count: count, pct: pct, containerText: containerText };
          }
          if (bestResult.pct) break;
        }
      }
      container = container.parentElement;
    }
    return bestResult;
  }

  function extractMetric(labels, maxCount) {
    for (const label of labels) {
      const elements = findLabelElements(label);
      for (const el of elements) {
        const value = extractCardValue(el);
        if (!value) continue;
        if (maxCount !== undefined) {
          const num = parseInt(value.count.replace(/,/g, ''), 10);
          if (isNaN(num) || num < 0 || num > maxCount) continue;
        }
        return value;
      }
    }
    return null;
  }

  function formatMetric(value) {
    if (!value) return '';
    if (value.pct) return `${value.count} (${value.pct})`;
    return value.count;
  }

  function extractMetrics() {
    const dr = extractMetric(['domain rating'], 100) || extractMetric(['dr'], 100);
    const bl = extractMetric(['backlinks']);
    const lw = extractMetric(['linking websites', 'linking domains', 'referring domains']);

    // Diagnostic: log what the extractor actually matched (visible in Ahrefs page F12 console)
    console.log('[MineTools] metric extraction result:', {
      domainRating: dr ? dr.count : null,
      backlinks: bl ? { count: bl.count, pct: bl.pct } : null,
      linkingWebsites: lw ? { count: lw.count, pct: lw.pct } : null
    });

    return {
      domainRating: dr ? dr.count : '',
      backlinks: formatMetric(bl),
      linkingWebsites: formatMetric(lw)
    };
  }

  function extractReferringPages() {
    const pages = [];
    const seen = new Set();
    const tables = document.querySelectorAll('table');

    for (const table of tables) {
      const rows = table.querySelectorAll('tr');

      for (const row of rows) {
        // Skip header rows
        if (row.querySelector('th')) continue;

        const cells = row.querySelectorAll('td');
        if (cells.length < 2) continue;

        // First cell should start with a DR number (may include extra badge text)
        const drText = text(cells[0]);
        const drMatch = drText.match(/^\d{1,3}/);
        if (!drMatch) continue;

        const dr = parseInt(drMatch[0], 10);

        // Find the referring page URL: first http(s) link in remaining cells
        let pageUrl = '';
        let pageCellIdx = -1;
        for (let i = 1; i < cells.length; i++) {
          const a = cells[i].querySelector('a[href^="http"]');
          const candidate = a ? a.href : text(cells[i]);
          if (/^https?:\/\//.test(candidate)) {
            pageUrl = candidate;
            pageCellIdx = i;
            break;
          }
        }
        if (!pageUrl) continue;

        // Anchor text + target URL from cells after the referring page cell
        let anchorText = '';
        let targetUrl = '';
        for (let i = pageCellIdx + 1; i < cells.length; i++) {
          const links = cells[i].querySelectorAll('a[href^="http"]');
          for (const link of links) {
            if (link.href !== pageUrl && !targetUrl) {
              targetUrl = link.href;
            }
          }
        }

        // Anchor: prefer a cell whose text is short (not a URL)
        for (let i = 1; i < cells.length; i++) {
          if (i === pageCellIdx) continue;
          const ct = text(cells[i]);
          if (ct && !/^https?:\/\//.test(ct) && ct.length < 100) {
            anchorText = ct;
            break;
          }
        }

        const key = `${dr}|${pageUrl}|${anchorText}`;
        if (seen.has(key)) continue;
        seen.add(key);

        pages.push({
          dr: dr,
          pageUrl: pageUrl,
          anchorText: anchorText.slice(0, 200),
          targetUrl: targetUrl || pageUrl
        });
      }
    }

    return pages;
  }

  const metrics = extractMetrics();
  const referringPages = extractReferringPages();

  const data = {
    domainRating: metrics.domainRating,
    backlinks: metrics.backlinks,
    linkingWebsites: metrics.linkingWebsites,
    referringPages: referringPages,
    extractedAt: new Date().toISOString()
  };

  window.__mineToolsAhrefsData = data;
  return { ok: true, ...data };
})();
