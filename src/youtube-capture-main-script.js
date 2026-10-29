// MineTools YouTube 播放器抓取脚本（MAIN world，document_start 注入）。
// 自适应流直链在没有 PO token 时只放行前 6MB；高画质改为截获播放器 MSE 缓冲，
// 抓完后交给桥接脚本在本地合并。
(() => {
  if (window.__mineToolsCaptureInstalled) return;
  window.__mineToolsCaptureInstalled = true;

  const REQUEST_KEY = 'minetools-capture';
  const MAX_BYTES = 300 * 1024 * 1024;
  const MAX_WAIT = 300000;
  const PLAY_RATE = 8;
  const GAP_TOLERANCE = 0.75;
  const END_TOLERANCE = 1;

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  function currentVideoId() {
    try {
      const url = new URL(location.href);
      if (url.pathname === '/watch') return url.searchParams.get('v') || '';
      const match = url.pathname.match(/^\/shorts\/([\w-]{5,})/);
      return match ? match[1] : '';
    } catch {
      return '';
    }
  }

  function readRequest() {
    try {
      const raw = sessionStorage.getItem(REQUEST_KEY);
      if (!raw) return null;
      sessionStorage.removeItem(REQUEST_KEY);
      const request = JSON.parse(raw);
      if (!request || typeof request !== 'object' || !request.videoId) return null;
      if (Date.now() - (Number(request.createdAt) || 0) > 120000) return null;
      return request;
    } catch {
      return null;
    }
  }

  const request = readRequest();
  if (!request || request.videoId !== currentVideoId()) return;

  let stopped = false;
  let capturing = false;
  let overflowed = false;
  let totalBytes = 0;
  let session = null;
  let lastQualityAt = 0;
  let lastSeekAt = 0;

  const streams = new Map();

  function post(payload, transfer) {
    try {
      window.postMessage({ source: 'minetools-capture', ...payload }, '*', transfer || []);
    } catch {}
  }

  // ---- 强制 H.264/AAC：mp4box + mp4-muxer 只处理 avc1/mp4a ----

  const BLOCKED_CODEC = /vp0?8|vp0?9|av0?1|opus|vorbis|webm/i;
  const isBlocked = type => typeof type === 'string' && BLOCKED_CODEC.test(type);

  try {
    const source = window.MediaSource;
    if (source && typeof source.isTypeSupported === 'function') {
      const isTypeSupported = source.isTypeSupported;
      source.isTypeSupported = type => (isBlocked(type) ? false : isTypeSupported.call(source, type));
    }
  } catch {}

  try {
    const proto = window.HTMLMediaElement?.prototype;
    const canPlayType = proto?.canPlayType;
    if (canPlayType) {
      proto.canPlayType = function (type) {
        return isBlocked(type) ? '' : canPlayType.call(this, type);
      };
    }
  } catch {}

  try {
    const capabilities = navigator.mediaCapabilities;
    if (capabilities?.decodingInfo) {
      const decodingInfo = capabilities.decodingInfo.bind(capabilities);
      capabilities.decodingInfo = config => {
        const codec = config?.video?.codec || config?.audio?.codec || '';
        if (isBlocked(codec)) return Promise.resolve({ supported: false, smooth: false, powerEfficient: false });
        return decodingInfo(config);
      };
    }
  } catch {}

  // ---- 截获 MSE 数据 ----

  function adShowing() {
    try {
      return Boolean(document.getElementById('movie_player')?.classList.contains('ad-showing'));
    } catch {
      return false;
    }
  }

  function wantsStream(buffer) {
    const stream = streams.get(buffer);
    if (!stream) return false;
    return request.kind === 'audio' ? /^audio\//i.test(stream.mime) : true;
  }

  function captureAppend(buffer, data) {
    const stream = streams.get(buffer);
    if (!stream) return;
    let bytes;
    if (data instanceof ArrayBuffer) bytes = new Uint8Array(data);
    else if (data && data.buffer instanceof ArrayBuffer) bytes = new Uint8Array(data.buffer, data.byteOffset || 0, data.byteLength);
    else return;
    if (!bytes.byteLength) return;
    if (totalBytes + bytes.byteLength > MAX_BYTES) {
      overflowed = true;
      return;
    }
    totalBytes += bytes.byteLength;
    stream.size += bytes.byteLength;
    stream.chunks.push(bytes.slice());
  }

  try {
    const sourceProto = window.MediaSource?.prototype;
    const appendBuffer = window.SourceBuffer?.prototype?.appendBuffer;
    if (sourceProto && appendBuffer) {
      const addSourceBuffer = sourceProto.addSourceBuffer;
      sourceProto.addSourceBuffer = function (type) {
        const buffer = addSourceBuffer.call(this, type);
        streams.set(buffer, { mime: String(type || ''), chunks: [], size: 0, parsed: null, parsedBytes: 0, parsedAt: 0 });
        return buffer;
      };
      window.SourceBuffer.prototype.appendBuffer = function (data) {
        if (capturing && !stopped && !overflowed && !adShowing() && wantsStream(this)) {
          captureAppend(this, data);
        }
        return appendBuffer.call(this, data);
      };
    }
  } catch {}

  function resetCapture() {
    totalBytes = 0;
    overflowed = false;
    for (const stream of streams.values()) {
      stream.chunks.length = 0;
      stream.size = 0;
      stream.parsed = null;
      stream.parsedBytes = 0;
      stream.parsedAt = 0;
    }
  }

  // ---- ISO BMFF 解析：按 init 分段、按 tfdt 去重排序 ----

  function boxType(bytes, offset) {
    return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
  }

  function readBox(bytes, view, offset, limit) {
    if (offset + 8 > limit) return null;
    let size = view.getUint32(offset);
    const type = boxType(bytes, offset + 4);
    let header = 8;
    if (size === 1) {
      if (offset + 16 > limit) return null;
      size = Number(view.getBigUint64(offset + 8));
      header = 16;
    } else if (size === 0) {
      size = limit - offset;
    }
    if (!/^[\x20-\x7e]{4}$/.test(type) || size < header || offset + size > limit) return null;
    return { type, start: offset, end: offset + size, header };
  }

  function childrenOf(bytes, view, parent) {
    const list = [];
    let offset = parent.start + parent.header;
    while (true) {
      const box = readBox(bytes, view, offset, parent.end);
      if (!box) break;
      list.push(box);
      offset = box.end;
    }
    return list;
  }

  function findChild(list, type) {
    return list.find(box => box.type === type) || null;
  }

  function parseTrak(bytes, view, trak) {
    const info = { kind: '', height: 0, codec: '', timescale: 0 };
    for (const child of childrenOf(bytes, view, trak)) {
      if (child.type === 'tkhd') {
        const content = child.start + child.header;
        const version = view.getUint8(content);
        const heightAt = content + (version === 1 ? 92 : 80);
        if (heightAt + 4 <= child.end) info.height = view.getUint32(heightAt) >>> 16;
      } else if (child.type === 'mdia') {
        for (const media of childrenOf(bytes, view, child)) {
          if (media.type === 'mdhd') {
            const content = media.start + media.header;
            const version = view.getUint8(content);
            const timescaleAt = content + (version === 1 ? 20 : 12);
            if (timescaleAt + 4 <= media.end) info.timescale = view.getUint32(timescaleAt);
          } else if (media.type === 'hdlr') {
            const typeAt = media.start + media.header + 8;
            if (typeAt + 4 <= media.end) {
              const handler = boxType(bytes, typeAt);
              if (handler === 'vide') info.kind = 'video';
              else if (handler === 'soun') info.kind = 'audio';
            }
          } else if (media.type === 'minf') {
            const stbl = findChild(childrenOf(bytes, view, media), 'stbl');
            const stsd = stbl && findChild(childrenOf(bytes, view, stbl), 'stsd');
            if (stsd && view.getUint32(stsd.start + stsd.header + 4) > 0) {
              const entry = readBox(bytes, view, stsd.start + stsd.header + 8, stsd.end);
              if (entry) info.codec = entry.type;
            }
          }
        }
      }
    }
    return info;
  }

  function parseMoov(bytes, view, moov) {
    for (const trak of childrenOf(bytes, view, moov)) {
      if (trak.type !== 'trak') continue;
      const info = parseTrak(bytes, view, trak);
      if (info.kind) return info;
    }
    return { kind: '', height: 0, codec: '', timescale: 0 };
  }

  function parseFragment(bytes, view, fragment) {
    let sequence = 0;
    let start = null;
    let duration = 0;
    for (const box of childrenOf(bytes, view, fragment.moof)) {
      if (box.type === 'mfhd') {
        if (box.start + box.header + 8 <= box.end) sequence = view.getUint32(box.start + box.header + 4);
      } else if (box.type === 'traf') {
        let defaultDuration = 0;
        const runs = [];
        for (const child of childrenOf(bytes, view, box)) {
          if (child.type === 'tfhd') {
            const content = child.start + child.header;
            const flags = view.getUint32(content) & 0xffffff;
            let cursor = content + 8;
            if (flags & 0x1) cursor += 8;
            if (flags & 0x2) cursor += 4;
            if (flags & 0x8) {
              if (cursor + 4 <= child.end) defaultDuration = view.getUint32(cursor);
              cursor += 4;
            }
            if (flags & 0x10) cursor += 4;
            if (flags & 0x20) cursor += 4;
          } else if (child.type === 'tfdt') {
            const content = child.start + child.header;
            if (content + 8 <= child.end) {
              start = view.getUint8(content) === 1
                ? Number(view.getBigUint64(content + 4))
                : view.getUint32(content + 4);
            }
          } else if (child.type === 'trun') {
            runs.push(child);
          }
        }
        for (const run of runs) {
          const content = run.start + run.header;
          const flags = view.getUint32(content) & 0xffffff;
          const count = view.getUint32(content + 4);
          let cursor = content + 8;
          if (flags & 0x1) cursor += 4;
          if (flags & 0x4) cursor += 4;
          for (let i = 0; i < count; i++) {
            let sampleDuration = defaultDuration;
            if (flags & 0x100) {
              if (cursor + 4 > run.end) break;
              sampleDuration = view.getUint32(cursor);
              cursor += 4;
            }
            if (flags & 0x200) {
              if (cursor + 4 > run.end) break;
              cursor += 4;
            }
            if (flags & 0x400) {
              if (cursor + 4 > run.end) break;
              cursor += 4;
            }
            if (flags & 0x800) {
              if (cursor + 4 > run.end) break;
              cursor += 4;
            }
            duration += sampleDuration;
          }
        }
      }
    }
    return start == null ? null : { sequence, start, duration };
  }

  function parseStream(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const groups = [];
    let current = null;
    let ftyp = null;
    let offset = 0;
    while (offset + 8 <= bytes.byteLength) {
      const box = readBox(bytes, view, offset, bytes.byteLength);
      if (!box) break;
      if (box.type === 'ftyp') {
        ftyp = box;
      } else if (box.type === 'moov') {
        const info = parseMoov(bytes, view, box);
        if (info.kind) {
          current = { info, ftyp, moov: box, fragments: [] };
          groups.push(current);
        }
      } else if (box.type === 'moof' && current) {
        current.fragments.push({ moof: box, start: box.start, end: box.end });
      } else if (current?.fragments.length) {
        const fragment = current.fragments[current.fragments.length - 1];
        fragment.end = box.end;
      }
      offset = box.end;
    }

    for (const group of groups) {
      group.timescale = group.info.timescale || 1000;
      group.fragments = group.fragments.filter(fragment => {
        const timing = parseFragment(bytes, view, fragment);
        if (!timing) return false;
        fragment.sequence = timing.sequence;
        fragment.startTime = timing.start;
        fragment.endTime = timing.start + timing.duration;
        return true;
      });
    }
    return { bytes, groups };
  }

  function streamBytes(stream) {
    const merged = new Uint8Array(stream.size);
    let offset = 0;
    for (const chunk of stream.chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return merged;
  }

  function summarize(groups, kind, targetHeight) {
    let candidates = groups.filter(group => group.info.kind === kind && group.fragments.length);
    if (!candidates.length) return null;
    if (kind === 'video') {
      const exact = candidates.filter(group => group.info.height === targetHeight);
      const pool = exact.length ? exact : candidates;
      let best = pool[0];
      for (const group of pool) {
        if (Math.abs(group.info.height - targetHeight) < Math.abs(best.info.height - targetHeight)) best = group;
      }
      candidates = candidates.filter(group => group.info.height === best.info.height);
    }

    const init = candidates[candidates.length - 1];
    const fragments = [];
    for (const group of candidates) {
      for (const fragment of group.fragments) {
        fragments.push({
          start: fragment.start,
          end: fragment.end,
          startTime: fragment.startTime,
          endTime: fragment.endTime,
          bytes: group.bytes
        });
      }
    }
    fragments.sort((a, b) => a.startTime - b.startTime);

    const kept = [];
    let lastEnd = -1;
    for (const fragment of fragments) {
      if (fragment.startTime < lastEnd) continue;
      kept.push(fragment);
      lastEnd = Math.max(lastEnd, fragment.endTime);
    }
    if (!kept.length) return null;
    return {
      height: init.info.height,
      timescale: init.timescale,
      init: { bytes: init.bytes, ftyp: init.ftyp, moov: init.moov },
      fragments: kept
    };
  }

  function coverageOf(summary) {
    let end = 0;
    let gap = null;
    for (const fragment of summary.fragments) {
      const start = fragment.startTime / summary.timescale;
      const stop = fragment.endTime / summary.timescale;
      if (start > end + GAP_TOLERANCE && !gap) gap = { start: end, end: start };
      if (stop > end) end = stop;
    }
    return { end, gap };
  }

  function analyze(force = false) {
    const targetHeight = Number(request.height) || parseInt(String(request.label || ''), 10) || 0;
    const now = Date.now();
    const groups = [];
    for (const stream of streams.values()) {
      if (!stream.size) continue;
      if (stream.parsedBytes !== stream.size && (force || now - stream.parsedAt > 800)) {
        stream.parsed = parseStream(streamBytes(stream));
        stream.parsedBytes = stream.size;
        stream.parsedAt = now;
      }
      if (!stream.parsed) continue;
      for (const group of stream.parsed.groups) groups.push({ ...group, bytes: stream.parsed.bytes });
    }

    const video = request.kind === 'audio' ? null : summarize(groups, 'video', targetHeight);
    const audio = summarize(groups, 'audio', 0);
    const duration = session?.duration || 0;
    const videoState = video ? coverageOf(video) : null;
    const audioState = audio ? coverageOf(audio) : null;

    const ends = [];
    if (request.kind === 'audio') {
      if (audioState) ends.push(audioState.end);
    } else {
      if (videoState) ends.push(videoState.end);
      if (audioState) ends.push(audioState.end);
    }
    const needed = request.kind === 'audio' ? 1 : 2;
    const gap = (request.kind === 'audio' ? null : videoState?.gap || null) || audioState?.gap || null;
    const end = ends.length ? Math.min(...ends) : 0;
    const ratio = duration ? Math.min(1, end / duration) : 0;
    const done = Boolean(duration)
      && ends.length === needed
      && ends.every(value => value >= duration - END_TOLERANCE)
      && !gap
      && !overflowed;

    return {
      video,
      audio,
      duration,
      gap,
      end,
      ratio,
      percent: Math.min(99, Math.floor(ratio * 100)),
      done
    };
  }

  function buildBuffer(summary) {
    const parts = [];
    let total = 0;
    // 每个分片携带所属 SourceBuffer 的完整字节流，不能统一按 init 的字节流取偏移。
    const push = (bytes, start, end) => {
      parts.push(bytes.subarray(start, end));
      total += end - start;
    };
    if (summary.init.ftyp) push(summary.init.bytes, summary.init.ftyp.start, summary.init.ftyp.end);
    push(summary.init.bytes, summary.init.moov.start, summary.init.moov.end);
    for (const fragment of summary.fragments) push(fragment.bytes, fragment.start, fragment.end);

    const merged = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
      merged.set(part, offset);
      offset += part.byteLength;
    }
    return merged.buffer;
  }

  // ---- 播放器控制 ----

  function qualityLabel() {
    const height = Number(request.height) || parseInt(String(request.label || ''), 10) || 0;
    const labels = { 2160: 'highres', 1440: 'hd1440', 1080: 'hd1080', 720: 'hd720', 480: 'large', 360: 'medium', 240: 'small', 144: 'tiny' };
    return labels[height] || String(request.label || 'hd720');
  }

  function applyQuality() {
    const player = session?.player;
    if (!player || Date.now() - lastQualityAt < 1500) return;
    lastQualityAt = Date.now();
    const label = qualityLabel();
    try {
      if (typeof player.setPlaybackQualityRange === 'function') player.setPlaybackQualityRange(label, label);
    } catch {}
    try {
      if (typeof player.setPlaybackQuality === 'function') player.setPlaybackQuality(label);
    } catch {}
  }

  function clickSkip() {
    if (!adShowing()) return;
    for (const selector of ['.ytp-ad-skip-button-modern', '.ytp-ad-skip-button', '.ytp-skip-ad-button']) {
      const button = document.querySelector(selector);
      if (button) {
        try {
          button.click();
        } catch {}
        return;
      }
    }
  }

  async function waitForPlayer() {
    const deadline = Date.now() + 60000;
    while (!stopped && Date.now() < deadline) {
      const player = document.getElementById('movie_player');
      const video = document.querySelector('video.html5-main-video') || document.querySelector('video');
      if (player && typeof player.setPlaybackQualityRange === 'function') {
        const label = qualityLabel();
        try {
          player.setPlaybackQualityRange(label, label);
        } catch {}
      }
      if (player && video && !adShowing()) {
        let duration = 0;
        try {
          duration = typeof player.getDuration === 'function' ? Number(player.getDuration()) : 0;
        } catch {}
        if (Number.isFinite(duration) && duration > 0) return { player, video, duration };
      }
      clickSkip();
      await sleep(300);
    }
    return null;
  }

  function seekTo(value) {
    if (!session) return;
    const video = session.video;
    try {
      if (typeof session.player.seekTo === 'function') session.player.seekTo(value, true);
      else video.currentTime = value;
    } catch {
      try {
        video.currentTime = value;
      } catch {}
    }
  }

  function restartPlayer() {
    if (!session) return;
    try {
      if (typeof session.player.loadVideoById === 'function') {
        session.player.loadVideoById(request.videoId, 0);
        return;
      }
    } catch {}
    seekTo(0);
  }

  function restorePlayer() {
    if (!session) return;
    const video = session.video;
    try {
      video.pause();
      video.playbackRate = 1;
      video.muted = false;
      video.currentTime = 0;
    } catch {}
  }

  function stopCapture() {
    stopped = true;
    capturing = false;
    restorePlayer();
  }

  function fail(message) {
    if (stopped) return;
    stopCapture();
    post({ type: 'error', error: message });
  }

  function finish(state) {
    if (stopped) return;
    stopCapture();
    try {
      const videoBuffer = state.video ? buildBuffer(state.video) : null;
      const audioBuffer = state.audio ? buildBuffer(state.audio) : null;
      if (state.video && !videoBuffer) throw new Error('未整理出视频数据。');
      if (!audioBuffer) throw new Error('未整理出音频数据。');

      const title = String(request.title || 'YouTube 视频')
        .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_')
        .replace(/^\.+/, '')
        .trim()
        .slice(0, 100) || 'YouTube 视频';
      const filename = request.kind === 'audio'
        ? `${title}-音频.m4a`
        : `${title}-${state.video.height}p.mp4`;

      const transfer = [audioBuffer];
      if (videoBuffer) transfer.push(videoBuffer);
      post({
        type: 'result',
        mode: request.kind === 'audio' ? 'audio' : 'video',
        filename,
        height: state.video?.height || 0,
        duration: state.duration,
        video: videoBuffer,
        audio: audioBuffer
      }, transfer);
    } catch (error) {
      post({ type: 'error', error: error?.message || '整理抓取数据失败。' });
    }
  }

  function seekTarget(state) {
    if (!session) return null;
    const video = session.video;
    const time = Number(video.currentTime) || 0;
    if (state.gap) {
      if (time + 1 < state.gap.start || time - 1 > state.gap.end) return Math.max(0, state.gap.start + 0.15);
      return null;
    }
    const ranges = video.buffered;
    let bufferedEnd = 0;
    if (ranges?.length) bufferedEnd = ranges.end(ranges.length - 1);
    if (!state.duration || bufferedEnd >= state.duration - 0.5) return null;
    if (bufferedEnd - time > 5) return null;
    return Math.max(0, Math.min(state.duration - 0.5, bufferedEnd - 0.2));
  }

  async function run() {
    const deadline = Date.now() + MAX_WAIT;
    let lastReport = 0;
    while (!stopped && Date.now() < deadline) {
      if (overflowed) {
        fail('抓取的数据超过 300MB，请选择较低画质。');
        return;
      }
      if (adShowing()) {
        clickSkip();
        await sleep(400);
        continue;
      }

      const { video } = session;
      applyQuality();
      if (video.paused) {
        try {
          await video.play();
        } catch {}
      }
      try {
        video.muted = true;
        if (video.playbackRate !== PLAY_RATE) video.playbackRate = PLAY_RATE;
      } catch {}

      let state = analyze();
      if (state.done) {
        // 完成前强制重解析，确保最后几秒刚追加的分片也进入结果。
        state = analyze(true);
        if (state.done) {
          finish(state);
          return;
        }
      }

      const now = Date.now();
      if (now - lastSeekAt > 1200) {
        const target = seekTarget(state);
        if (target != null) {
          lastSeekAt = now;
          seekTo(target);
        }
      }
      if (now - lastReport > 800) {
        lastReport = now;
        const label = state.video ? `${state.video.height}p` : '音频';
        post({ type: 'progress', percent: state.percent, detail: `${label} · 已抓取 ${state.percent}%` });
      }
      await sleep(400);
    }
    if (stopped) return;
    if (overflowed) fail('抓取的数据超过 300MB，请选择较低画质。');
    else fail('抓取超时。请让页面保持在前台后重试，或选择较低画质。');
  }

  async function start() {
    const player = await waitForPlayer();
    if (stopped) return;
    if (!player) {
      fail('YouTube 播放器未就绪，请刷新页面后重试。');
      return;
    }
    session = player;
    post({ type: 'start', filename: request.filename || '', quality: request.label || '' });

    capturing = true;
    resetCapture();
    try {
      player.video.muted = true;
      player.video.playbackRate = PLAY_RATE;
    } catch {}
    applyQuality();
    // 清空缓冲并重新加载当前视频，确保从头按锁定画质重新建立 MSE 流。
    restartPlayer();
    applyQuality();
    await sleep(400);
    try {
      await player.video.play();
    } catch {}
    run();
  }

  window.addEventListener('message', event => {
    if (event.source !== window) return;
    const data = event.data;
    if (data?.source !== 'minetools-capture-control' || data.type !== 'cancel' || stopped) return;
    stopCapture();
    post({ type: 'error', error: '已取消抓取。' });
  });

  start();
})();
