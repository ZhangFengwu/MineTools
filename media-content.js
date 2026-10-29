// MineTools 页面素材嗅探内容脚本。由侧边栏“下素材”按钮按需注入。
(function () {
  const PANEL_ID = 'minetools-media-panel';
  const IMAGE_EXTENSION = /\.(?:avif|bmp|gif|ico|jpe?g|jfif|png|svg|webp)$/i;
  const VIDEO_EXTENSION = /\.(?:avi|flv|m4v|mkv|mov|mp4|ogv|webm|wmv)$/i;
  const KIND_LABEL = { image: '图片', video: '视频', audio: '音频' };
  const LAZY_ATTRIBUTES = ['data-src', 'data-original', 'data-original-src', 'data-lazy-src', 'data-actualsrc', 'data-url'];

  const previous = document.getElementById(PANEL_ID);
  if (previous) previous.remove();

  function absoluteUrl(value) {
    if (!value) return '';
    const text = String(value).trim();
    if (!text || /^(?:javascript|mailto|tel|about|data):/i.test(text)) return '';
    try {
      const url = new URL(text, document.baseURI);
      if (url.protocol !== 'http:' && url.protocol !== 'https:' && url.protocol !== 'blob:') return '';
      return url.href;
    } catch {
      return '';
    }
  }

  function extensionOf(url) {
    try {
      const match = new URL(url).pathname.match(/\.[a-z0-9]{2,5}$/i);
      return match ? match[0].toLowerCase() : '';
    } catch {
      return '';
    }
  }

  function kindForUrl(url) {
    const extension = extensionOf(url);
    if (VIDEO_EXTENSION.test(extension)) return 'video';
    if (IMAGE_EXTENSION.test(extension)) return 'image';
    return '';
  }

  function hostnameOf(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return '';
    }
  }

  const found = new Map();

  function add(value, kind, label, poster) {
    const url = absoluteUrl(value);
    if (!url) return;
    const type = kind || kindForUrl(url);
    if (!type) return;
    const existing = found.get(url);
    if (existing) {
      if (type === 'video') existing.kind = 'video';
      if (!existing.label && label) existing.label = label;
      if (!existing.poster && poster) existing.poster = absoluteUrl(poster);
      return;
    }
    found.set(url, { url, kind: type, label: label || '', poster: absoluteUrl(poster) });
  }

  function addSrcset(value, label) {
    if (!value) return;
    for (const part of String(value).split(',')) {
      const candidate = part.trim().split(/\s+/)[0];
      if (candidate) add(candidate, '', label);
    }
  }

  function labelOf(element) {
    return (element.getAttribute('alt') || element.getAttribute('title') || element.getAttribute('aria-label') || '').trim();
  }

  function scanMedia() {
    document.querySelectorAll('img').forEach(image => {
      // 1×1 统计像素不是素材。
      if (image.naturalWidth > 0 && image.naturalWidth <= 2 && image.naturalHeight <= 2) return;
      const label = labelOf(image);
      add(image.currentSrc, 'image', label);
      add(image.getAttribute('src'), 'image', label);
      addSrcset(image.getAttribute('srcset'), label);
      addSrcset(image.getAttribute('data-srcset'), label);
      addSrcset(image.getAttribute('data-lazy-srcset'), label);
      for (const attribute of LAZY_ATTRIBUTES) add(image.getAttribute(attribute), 'image', label);
    });

    document.querySelectorAll('picture source').forEach(source => {
      addSrcset(source.getAttribute('srcset'), '');
      add(source.getAttribute('src'), '', '');
    });

    document.querySelectorAll('video').forEach(video => {
      const label = labelOf(video);
      const poster = video.getAttribute('poster');
      add(video.currentSrc, 'video', label, poster);
      add(video.getAttribute('src'), 'video', label, poster);
      add(poster, 'image', label);
      video.querySelectorAll('source').forEach(source => {
        add(source.getAttribute('src'), 'video', label, poster);
        addSrcset(source.getAttribute('srcset'), label, poster);
      });
    });

    document.querySelectorAll('source[type]').forEach(source => {
      const type = source.getAttribute('type') || '';
      if (!/^(?:image|video)\//i.test(type)) return;
      add(source.getAttribute('src'), /^video\//i.test(type) ? 'video' : 'image', '');
      addSrcset(source.getAttribute('srcset'), '');
    });

    document.querySelectorAll('a[href]').forEach(link => {
      const url = absoluteUrl(link.getAttribute('href'));
      if (!kindForUrl(url)) return;
      const text = (link.innerText || '').trim().replace(/[\r\n]+/g, ' ');
      add(url, '', text.slice(0, 80));
    });

    document.querySelectorAll('link[rel][href]').forEach(link => {
      const rel = (link.getAttribute('rel') || '').toLowerCase();
      if (!/(?:^|\s)(?:preload|image_src)(?:\s|$)/.test(rel)) return;
      const as = (link.getAttribute('as') || '').toLowerCase();
      if (as === 'image') add(link.getAttribute('href'), 'image', '');
      else if (as === 'video') add(link.getAttribute('href'), 'video', '');
    });

    document.querySelectorAll('meta[property], meta[name]').forEach(meta => {
      const key = (meta.getAttribute('property') || meta.getAttribute('name') || '').toLowerCase();
      if (!/^(?:og:(?:image|video)(?::(?:url|secure_url))?|twitter:image|twitter:player:stream)$/.test(key)) return;
      add(meta.getAttribute('content'), key.includes('video') ? 'video' : 'image', '');
    });

    document.querySelectorAll('[style*="background"]').forEach(element => {
      const background = element.style.backgroundImage;
      if (!background || background === 'none') return;
      for (const match of background.matchAll(/url\((['"]?)([^'")]+)\1\)/g)) add(match[2], 'image', '');
    });

    const records = [...found.values()];
    records.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'image' ? -1 : 1));
    return records;
  }

  // extension.js 在 MAIN world 解析 YouTube 播放器后写在 DOM 中的直链数据。
  function readYouTubeData() {
    const tag = document.getElementById('minetools-youtube-data');
    if (!tag) return null;
    const text = tag.textContent || '';
    tag.remove();
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  function buildYouTubeRecords(data) {
    if (!data?.ok || data.isLive) return [];
    const title = data.title || 'YouTube 视频';
    const safeTitle = title.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/^\.+/, '').trim().slice(0, 100) || 'YouTube 视频';
    const poster = data.thumbnail || '';
    const variants = [];
    const seen = new Set();

    if (data.hasAudio) {
      for (const format of data.adaptiveVideo || []) {
        const quality = format.qualityLabel || '';
        if (!quality || seen.has(quality)) continue;
        seen.add(quality);
        variants.push({
          quality,
          height: format.height || (parseInt(quality, 10) || 0),
          mode: 'capture',
          filename: `${safeTitle}-${quality}.mp4`,
          meta: '抓取画面+音频'
        });
      }
    }

    const progressive = data.progressive?.[0];
    if (progressive) {
      const quality = progressive.qualityLabel || '360p';
      const index = variants.findIndex(variant => variant.quality === quality);
      if (index >= 0) variants.splice(index, 1);
      variants.push({
        quality,
        url: progressive.url,
        mode: 'direct',
        filename: `${safeTitle}-${quality}.mp4`,
        meta: '含音频'
      });
    }

    variants.sort((a, b) => (parseInt(b.quality, 10) || 0) - (parseInt(a.quality, 10) || 0));
    const records = [];
    if (variants.length) {
      const first = variants[0];
      records.push({
        kind: 'video',
        label: title,
        poster,
        priority: 0,
        url: '',
        filename: first.filename,
        meta: first.meta,
        variants,
        videoId: data.videoId || ''
      });
    }
    if (data.hasAudio) {
      records.push({
        kind: 'audio',
        label: title,
        poster,
        priority: 0,
        url: '',
        filename: `${safeTitle}-音频.m4a`,
        meta: 'M4A · 仅音频',
        mode: 'capture',
        videoId: data.videoId || ''
      });
    }
    return records;
  }

  function decodeSegment(segment) {
    try {
      return decodeURIComponent(segment);
    } catch {
      return segment;
    }
  }

  function displayName(record) {
    if (record.filename) return record.filename;
    try {
      const base = decodeSegment(new URL(record.url).pathname.split('/').pop() || '');
      if (base) return base;
    } catch {}
    return record.label || hostnameOf(record.url) || '素材文件';
  }

  function suggestedName(record) {
    const name = decodeSegment(displayName(record))
      .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_')
      .replace(/^\.+/, '')
      .trim();
    if (!name || !/\.[a-z0-9]{2,5}$/i.test(name)) return '';
    return name.slice(0, 120);
  }

  function anchorDownload(url, name) {
    const link = document.createElement('a');
    link.href = url;
    if (name) link.download = name;
    link.rel = 'noopener';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  // 自适应流直链受 6MB 限制；改为刷新页面，由播放器抓取脚本截获 MSE 缓冲。
  function requestCapture(record, button, select) {
    const request = {
      kind: record.kind === 'audio' ? 'audio' : 'video',
      videoId: record.videoId,
      height: record.height || 0,
      label: record.quality || '',
      title: record.label || 'YouTube 视频',
      filename: record.filename || '',
      createdAt: Date.now()
    };

    button.disabled = true;
    if (select) select.disabled = true;
    button.textContent = '刷新抓取…';
    button.title = '页面刷新后由播放器抓取画面与音频，通常需要 30–90 秒。';

    try {
      sessionStorage.setItem('minetools-capture', JSON.stringify(request));
    } catch {
      button.textContent = '失败';
      button.title = '无法写入抓取请求。';
      setTimeout(() => {
        button.disabled = false;
        if (select) select.disabled = false;
        button.textContent = '下载';
        button.title = '';
      }, 2000);
      return;
    }
    setTimeout(() => location.reload(), 400);
  }

  function requestDownload(record, button, select) {
    if (record.mode === 'capture') {
      requestCapture(record, button, select);
      return;
    }
    const filename = suggestedName(record);
    button.disabled = true;
    const finish = (text) => {
      button.textContent = text;
      setTimeout(() => {
        button.disabled = false;
        button.textContent = '下载';
      }, 1000);
    };

    if (record.url.startsWith('blob:')) {
      fetch(record.url)
        .then(response => response.blob())
        .then(blob => {
          const objectUrl = URL.createObjectURL(blob);
          anchorDownload(objectUrl, filename);
          setTimeout(() => URL.revokeObjectURL(objectUrl), 20000);
          finish('已下载');
        })
        .catch(() => finish('失败'));
      return;
    }

    try {
      chrome.runtime.sendMessage({ type: 'minetools-media-download', url: record.url, filename }, response => {
        if (chrome.runtime.lastError || !response?.ok) {
          anchorDownload(record.url, filename);
          finish('已下载');
          return;
        }
        finish('已下载');
      });
    } catch {
      anchorDownload(record.url, filename);
      finish('已下载');
    }
  }

  function buildThumb(record) {
    const thumb = document.createElement('div');
    thumb.className = 'thumb';
    const fallback = document.createElement('span');
    fallback.className = 'thumb-fallback';
    fallback.textContent = KIND_LABEL[record.kind];
    thumb.appendChild(fallback);

    const source = record.kind === 'image' ? record.url : record.poster || '';
    if (source) {
      const image = document.createElement('img');
      image.loading = 'lazy';
      image.referrerPolicy = 'no-referrer';
      image.alt = '';
      image.addEventListener('error', () => image.remove(), { once: true });
      image.src = source;
      thumb.appendChild(image);
    }
    return thumb;
  }

  function buildRow(record) {
    const row = document.createElement('div');
    row.className = 'item';

    const info = document.createElement('div');
    info.className = 'info';
    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = record.variants ? record.label : displayName(record);
    name.title = record.variants ? record.label : record.url || record.filename || '';
    const meta = document.createElement('div');
    meta.className = 'meta';
    const extension = extensionOf(record.url);
    const kind = document.createElement('span');
    kind.className = `kind kind-${record.kind}`;
    kind.textContent = KIND_LABEL[record.kind];
    meta.appendChild(kind);

    let selected = record.variants?.[0] || null;
    let quality = null;
    if (record.variants?.length > 1) {
      quality = document.createElement('select');
      quality.className = 'quality';
      quality.setAttribute('aria-label', '选择清晰度');
      for (const variant of record.variants) {
        const option = document.createElement('option');
        option.value = variant.quality;
        option.textContent = variant.quality;
        quality.appendChild(option);
      }
      quality.addEventListener('change', () => {
        selected = record.variants[quality.selectedIndex] || record.variants[0];
        metaText.textContent = ` ${selected.meta}`;
      });
      meta.appendChild(quality);
    }

    const metaText = document.createElement('span');
    metaText.textContent = record.meta
      ? ` ${record.meta}`
      : ` ${extension ? extension.slice(1).toUpperCase() : 'URL'} · ${hostnameOf(record.url) || '本站'}`;
    meta.appendChild(metaText);
    info.append(name, meta);

    const download = document.createElement('button');
    download.type = 'button';
    download.className = 'get';
    download.textContent = '下载';
    download.addEventListener('click', () => {
      requestDownload(selected ? { ...record, ...selected } : record, download, quality);
    });

    row.append(buildThumb(record), info, download);
    return row;
  }

  function createPanel(records, notice) {
    const imageCount = records.filter(record => record.kind === 'image').length;
    const videoCount = records.filter(record => record.kind === 'video').length;
    const audioCount = records.filter(record => record.kind === 'audio').length;
    const currentHost = hostnameOf(location.href) || location.hostname;

    const host = document.createElement('div');
    host.id = PANEL_ID;
    host.style.cssText = 'all:initial!important;position:fixed!important;top:16px!important;right:16px!important;width:min(460px,calc(100vw - 32px))!important;z-index:2147483647!important;display:block!important;';

    const root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = [
      ':host{color-scheme:light}',
      '.panel{box-sizing:border-box;display:flex;flex-direction:column;max-height:calc(100vh - 32px);overflow:hidden;color:#172033;background:rgba(248,250,252,.94);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border:1px solid rgba(148,163,184,.5);border-radius:14px;box-shadow:0 12px 40px rgba(15,23,42,.22);font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}',
      '.header{display:flex;align-items:center;gap:8px;padding:12px 14px 8px;cursor:grab;user-select:none;touch-action:none}.header.dragging{cursor:grabbing}',
      'h2{font-size:16px;margin:0}',
      '.count{font-size:12px;color:#168072;background:#e8f5f1;padding:2px 8px;border-radius:10px;font-variant-numeric:tabular-nums}',
      'button{border:0;border-radius:6px;background:transparent;color:#475569;font-family:inherit;font-size:13px;line-height:1.4;cursor:pointer;padding:6px 10px}button:hover{background:rgba(148,163,184,.2)}',
      '.close{font-size:20px;line-height:1;padding:4px 8px;margin-left:auto}',
      'button:focus-visible{outline:2px solid #2563eb;outline-offset:2px}',
      '.hint{margin:0;padding:0 16px 8px;font-size:12px;color:#64748b;overflow-wrap:anywhere}',
      '.list{overflow:auto;min-height:0;padding:0 12px}',
      '.item{display:flex;align-items:center;gap:10px;padding:8px 4px;border-bottom:1px solid #e2e8f0}',
      '.thumb{position:relative;flex:0 0 46px;width:46px;height:46px;border-radius:6px;overflow:hidden;background:#e2e8f0}',
      '.thumb img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;background:#e2e8f0}',
      '.thumb-fallback{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:11px;color:#64748b}',
      '.info{flex:1;min-width:0}',
      '.name{font-size:13px;font-weight:600;color:#172033;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.meta{font-size:11px;color:#64748b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.kind{display:inline-block;padding:0 5px;border-radius:4px;font-size:10px;line-height:1.6}',
      '.kind-image{background:#e8f5f1;color:#168072}.kind-video{background:#eef2f6;color:#475569}.kind-audio{background:#f3eef9;color:#6b4fa0}',
      '.quality{display:inline-block;vertical-align:middle;max-width:92px;height:20px;margin:0 4px;border:1px solid #cbd5e1;border-radius:4px;background:#fff;color:#172033;font:11px system-ui,-apple-system,"Segoe UI",sans-serif;padding:0 2px;cursor:pointer}',
      '.quality:disabled{color:#899aa8;background:#f1f5f9;cursor:default}',
      '.get{flex-shrink:0;background:#15354b;color:#fff;font-weight:600;font-size:12px}.get:hover{background:#205570}.get:disabled{background:#e9eef2;color:#899aa8;cursor:default}',
      '.empty{text-align:center;color:#64748b;padding:28px 8px}',
      '.notice{margin:0 16px 8px;padding:8px 10px;border-radius:6px;background:#fdf1e3;color:#8a5a12;font-size:12px;overflow-wrap:anywhere}',
      '.footer{margin:0;padding:8px 16px 12px;font-size:11px;color:#64748b}'
    ].join('');
    root.appendChild(style);

    const panel = document.createElement('section');
    panel.className = 'panel';
    panel.setAttribute('aria-label', '页面素材嗅探结果');
    panel.innerHTML = '<div class="header"><h2 title="拖动标题栏左右移动">页面素材</h2><span class="count"></span><button type="button" class="close" aria-label="关闭素材面板" title="关闭">×</button></div><p class="hint"></p><div class="list"></div><p class="footer"></p>';
    root.appendChild(panel);

    const counts = [`图片 ${imageCount}`, `视频 ${videoCount}`];
    if (audioCount) counts.push(`音频 ${audioCount}`);
    panel.querySelector('.count').textContent = `${records.length} 个`;
    panel.querySelector('.hint').textContent = `${currentHost} · ${counts.join(' · ')}`;
    if (notice) {
      const box = document.createElement('div');
      box.className = 'notice';
      box.textContent = notice;
      panel.querySelector('.hint').after(box);
    }
    panel.querySelector('.footer').textContent = videoCount && records.some(record => record.priority === 0)
      ? '高于 360p 的画质会刷新页面，由播放器抓取画面与音频后合并，通常 30–90 秒；抓取期间请保持页面在前台。'
      : '下载由浏览器完成；受防盗链或登录限制的素材可能失败。';

    const list = panel.querySelector('.list');
    if (records.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = '未发现可下载的图片或视频素材';
      list.appendChild(empty);
    } else {
      for (const record of records) list.appendChild(buildRow(record));
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

    panel.querySelector('.close').addEventListener('click', () => {
      window.removeEventListener('resize', keepPanelInView);
      host.remove();
    });

    document.body.appendChild(host);
  }

  const youtube = readYouTubeData();
  const youtubeRecords = buildYouTubeRecords(youtube);
  const records = [...youtubeRecords, ...scanMedia()];
  records.sort((a, b) => {
    const priorityA = a.priority ?? 1;
    const priorityB = b.priority ?? 1;
    if (priorityA !== priorityB) return priorityA - priorityB;
    return a.kind === b.kind ? 0 : a.kind === 'image' ? -1 : 1;
  });

  const isYouTube = /(^|\.)youtube\.com$/.test(location.hostname);
  let notice = '';
  if (isYouTube && youtubeRecords.length === 0) {
    notice = youtube?.isLive
      ? '直播流暂不支持下载。'
      : '未从 YouTube 播放器获取到视频直链，请等播放器加载完成后重新嗅探。';
  }

  createPanel(records, notice);
  return {
    ok: true,
    count: records.length,
    images: records.filter(record => record.kind === 'image').length,
    videos: records.filter(record => record.kind === 'video').length,
    audios: records.filter(record => record.kind === 'audio').length
  };
})();
