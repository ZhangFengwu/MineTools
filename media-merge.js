import { createFile, DataStream, MP4BoxBuffer } from './vendor/mp4box.all.mjs';
import { Muxer, ArrayBufferTarget } from './vendor/mp4-muxer.mjs';

function demux(arrayBuffer) {
  return new Promise((resolve, reject) => {
    const file = createFile();
    const samples = [];
    let movie = null;
    let track = null;
    let settled = false;

    const fail = error => {
      if (settled) return;
      settled = true;
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    file.onError = fail;
    file.onReady = info => {
      movie = info;
      track = info.videoTracks[0] || info.audioTracks[0];
      if (!track) {
        fail(new Error('未找到媒体轨道。'));
        return;
      }
      file.setExtractionOptions(track.id, null, { nbSamples: 500 });
      file.onSamples = (id, user, chunk) => {
        for (const sample of chunk) {
          if (sample.data?.length) samples.push(sample);
        }
      };
      file.start();
    };

    try {
      // 抓取脚本给的是 init + 分片连续字节流；mp4box 同步解析，返回时样本已全部回调。
      file.appendBuffer(MP4BoxBuffer.fromArrayBuffer(arrayBuffer, 0), true);
    } catch (error) {
      fail(error);
      return;
    }

    if (settled) return;
    if (!track) {
      fail(new Error('未找到媒体轨道。'));
      return;
    }
    if (!samples.length) {
      fail(new Error('未解析到媒体帧。'));
      return;
    }
    settled = true;
    resolve({ file, movie, track, samples });
  });
}

function avcDescription(file, track) {
  const entry = file.getTrackById(track.id)?.mdia?.minf?.stbl?.stsd?.entries?.[0];
  const avcC = entry?.avcC;
  if (!avcC) return null;
  const stream = new DataStream(undefined, 0);
  avcC.write(stream);
  const bytes = new Uint8Array(stream.buffer);
  // avcC.write includes the 8-byte box header; mp4-muxer expects the record itself.
  return bytes.slice(8, avcC.size || bytes.length);
}

function toChunks(samples) {
  return samples.map(sample => {
    const timescale = sample.timescale || 1;
    return {
      data: sample.data,
      type: sample.is_sync ? 'key' : 'delta',
      timestamp: Math.round(sample.cts * 1e6 / timescale),
      duration: Math.round(sample.duration * 1e6 / timescale),
      compositionOffset: Math.round((sample.cts - sample.dts) * 1e6 / timescale)
    };
  });
}

export async function mergeBuffers(videoBuffer, audioBuffer) {
  const [video, audio] = await Promise.all([demux(videoBuffer), demux(audioBuffer)]);
  const videoTrack = video.movie.videoTracks[0];
  const audioTrack = audio.movie.audioTracks[0];
  if (!videoTrack?.video || !audioTrack?.audio) throw new Error('缺少视频或音频轨道。');
  if (!/^avc[13]/.test(videoTrack.codec || '')) throw new Error('暂不支持该视频编码。');

  const description = avcDescription(video.file, videoTrack);
  if (!description) throw new Error('未读取到视频编码信息。');

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: 'avc', width: videoTrack.video.width, height: videoTrack.video.height },
    audio: { codec: 'aac', numberOfChannels: audioTrack.audio.channel_count, sampleRate: audioTrack.audio.sample_rate },
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset'
  });

  const videoChunks = toChunks(video.samples);
  const audioChunks = toChunks(audio.samples);
  const videoMeta = { decoderConfig: { codec: videoTrack.codec, description } };
  let vi = 0;
  let ai = 0;
  while (vi < videoChunks.length || ai < audioChunks.length) {
    const takeVideo = ai >= audioChunks.length || (vi < videoChunks.length && videoChunks[vi].timestamp <= audioChunks[ai].timestamp);
    if (takeVideo) {
      const chunk = videoChunks[vi++];
      muxer.addVideoChunkRaw(chunk.data, chunk.type, chunk.timestamp, chunk.duration, vi === 1 ? videoMeta : undefined, chunk.compositionOffset);
    } else {
      const chunk = audioChunks[ai++];
      muxer.addAudioChunkRaw(chunk.data, chunk.type, chunk.timestamp, chunk.duration);
    }
  }
  muxer.finalize();

  return new Blob([muxer.target.buffer], { type: 'video/mp4' });
}

export async function remuxAudio(audioBuffer) {
  const audio = await demux(audioBuffer);
  const track = audio.movie.audioTracks[0];
  if (!track?.audio) throw new Error('缺少音频轨道。');
  if (!/^mp4a/.test(track.codec || '')) throw new Error('暂不支持该音频编码。');

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    audio: { codec: 'aac', numberOfChannels: track.audio.channel_count, sampleRate: track.audio.sample_rate },
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset'
  });
  for (const chunk of toChunks(audio.samples)) {
    muxer.addAudioChunkRaw(chunk.data, chunk.type, chunk.timestamp, chunk.duration);
  }
  muxer.finalize();

  return new Blob([muxer.target.buffer], { type: 'audio/mp4' });
}
