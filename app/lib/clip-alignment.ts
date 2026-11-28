export type ClipMatch = {
  earlierSeconds: number;
  newerSeconds: number;
  audioSimilarity: number;
  confidenceMargin: number;
  hasRunnerUp: boolean;
  method: "silence-pause" | "cross-correlation";
};

type AudioFrame = { time: number; rms: number; bands: number[] };
const HOP_SECONDS = 0.05;
const SCAN_SECONDS = 25;
const MIN_CORRELATION_SCORE = 0.72;
const MIN_CONFIDENCE_MARGIN = 0.06;
const BAND_CENTERS = [90, 130, 180, 250, 340, 460, 620, 820, 1080, 1400, 1800, 2300];

type AudioSource = File | { name: string; url: string };

async function readAudio(file: AudioSource, onProgress: (fraction: number) => void) {
  const context = new AudioContext();
  const video = document.createElement("video");
  const objectUrl = "url" in file ? null : URL.createObjectURL(file);
  video.preload = "metadata";
  video.playsInline = true;
  video.volume = 1;
  // High playback rates can mute media audio in some browsers, which would make
  // the Web Audio analyser report silence even though the video has a soundtrack.
  video.playbackRate = 1.5;
  video.src = "url" in file ? file.url : objectUrl!;
  video.style.cssText = "position:fixed;left:-10000px;top:0;width:1px;height:1px;opacity:0;pointer-events:none";
  document.body.appendChild(video);
  try {
    const metadata = new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error("The video took too long to open.")), 20_000);
      video.addEventListener("loadedmetadata", () => { window.clearTimeout(timeout); resolve(); }, { once: true });
      video.addEventListener("error", () => { window.clearTimeout(timeout); reject(new Error("The browser could not open this video.")); }, { once: true });
    });
    video.load();
    // A larger FFT gives useful frequency resolution for mapping partials to notes.
    const analyser = context.createAnalyser();
    analyser.fftSize = 8192;
    analyser.smoothingTimeConstant = 0;
    const source = context.createMediaElementSource(video);
    const silentOutput = context.createGain();
    silentOutput.gain.value = 0;
    source.connect(analyser);
    analyser.connect(silentOutput);
    silentOutput.connect(context.destination);
    // Wait for metadata before playback so each attempt samples from the same origin.
    await metadata;
    if (!Number.isFinite(video.duration) || video.duration < 1) throw new Error("This video has no readable duration.");
    video.pause();
    video.currentTime = 0;
    await context.resume();
    await video.play();
    const scanDuration = Math.min(video.duration, SCAN_SECONDS);

    const spectrum = new Float32Array(analyser.frequencyBinCount);
    const waveform = new Float32Array(analyser.fftSize);
    const levels: AudioFrame[] = [];
    let nextSampleAt = 0;
    let hasAudioSignal = false;
    await new Promise<void>((resolve, reject) => {
      const sample = () => {
        try {
          const time = video.currentTime;
          if (time >= nextSampleAt) {
            analyser.getFloatFrequencyData(spectrum);
            const binWidth = context.sampleRate / analyser.fftSize;
            const bands = BAND_CENTERS.map((frequency) => {
              const index = Math.round(frequency / binWidth);
              const nearby = spectrum.slice(Math.max(0, index - 1), Math.min(spectrum.length, index + 2));
              const finite = [...nearby].filter(Number.isFinite);
              return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : -120;
            });
            analyser.getFloatTimeDomainData(waveform);
            const rms = Math.sqrt(waveform.reduce((sum, value) => sum + value * value, 0) / waveform.length);
            levels.push({ time, rms, bands });
            if (rms > 0.00001 || bands.some((value) => value > -110)) hasAudioSignal = true;
            nextSampleAt = time + HOP_SECONDS;
            onProgress(Math.min(1, time / scanDuration));
          }
          if (video.ended || time >= scanDuration - 0.03) { resolve(); return; }
          requestAnimationFrame(sample);
        } catch (error) { reject(error); }
      };
      requestAnimationFrame(sample);
    });
    if (!hasAudioSignal) throw new Error(`No audio signal was detected in "${file.name}". Confirm this clip has audible sound, then retry.`);
    return { duration: scanDuration, levels };
  } catch (error) {
    if (error instanceof Error && /No audio signal|no readable duration/i.test(error.message)) throw error;
    throw new Error(`Could not read one video's audio in this browser. Try an MP4 with AAC audio. ${error instanceof Error ? error.message : ""}`.trim());
  } finally {
    video.pause();
    video.removeAttribute("src");
    video.load();
    video.remove();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    await context.close().catch(() => undefined);
  }
}

function findSoundAfterSilence(levels: AudioFrame[]): number | null {
  if (levels.length < 20) return null;
  const sortedLevels = levels.map((sample) => sample.rms).sort((a, b) => a - b);
  const peak = sortedLevels[Math.floor((sortedLevels.length - 1) * 0.95)] ?? 0;
  if (peak < 0.005) return null;
  const floor = sortedLevels[Math.floor((sortedLevels.length - 1) * 0.1)] ?? 0;
  const silenceThreshold = Math.max(0.001, Math.min(peak * 0.08, floor * 1.5));
  const onsetThreshold = Math.max(silenceThreshold * 3, peak * 0.06);
  const quiet = levels.map((sample) => sample.rms <= silenceThreshold);

  for (let gapStart = 0; gapStart < levels.length; gapStart += 1) {
    if (!quiet[gapStart]) continue;
    let gapEnd = gapStart;
    while (gapEnd + 1 < levels.length && quiet[gapEnd + 1]) gapEnd += 1;
    const gapDuration = levels[gapEnd].time - levels[gapStart].time;
    const hasEarlierSound = levels.slice(Math.max(0, gapStart - 24), gapStart)
      .filter((sample) => sample.rms > onsetThreshold).length >= 4;
    if (gapDuration < 0.4 || !hasEarlierSound) {
      gapStart = gapEnd;
      continue;
    }

    const searchEnd = levels[gapEnd].time + 4;
    for (let onset = gapEnd + 1; onset < levels.length && levels[onset].time <= searchEnd; onset += 1) {
      if (levels[onset].rms <= onsetThreshold) continue;
      const sustained = levels.slice(onset, onset + 4);
      if (sustained.length < 4 || sustained.some((sample) => sample.rms <= onsetThreshold)) continue;
      return levels[onset].time;
    }
    gapStart = gapEnd;
  }
  return null;
}

function regularizeAudioFrames(frames: AudioFrame[]) {
  const result: AudioFrame[] = [];
  if (!frames.length) return result;
  let right = 0;
  const count = Math.floor(Math.min(SCAN_SECONDS, frames[frames.length - 1].time) / HOP_SECONDS) + 1;
  for (let index = 0; index < count; index += 1) {
    const time = index * HOP_SECONDS;
    while (right < frames.length - 1 && frames[right + 1].time < time) right += 1;
    const leftFrame = frames[Math.max(0, right)];
    const rightFrame = frames[Math.min(frames.length - 1, right + 1)];
    const span = rightFrame.time - leftFrame.time;
    const amount = span > 0 ? Math.max(0, Math.min(1, (time - leftFrame.time) / span)) : 0;
    result.push({
      time,
      rms: leftFrame.rms + (rightFrame.rms - leftFrame.rms) * amount,
      bands: leftFrame.bands.map((value, band) => value + (rightFrame.bands[band] - value) * amount),
    });
  }
  return result;
}

function normalizedCrossCorrelation(first: AudioFrame[], second: AudioFrame[], a: number, b: number, length: number) {
  let total = 0;
  let channels = 0;
  for (let band = -1; band < BAND_CENTERS.length; band += 1) {
    let meanA = 0;
    let meanB = 0;
    for (let time = 0; time < length; time += 1) {
      meanA += band === -1 ? Math.log(Math.max(1e-6, first[a + time].rms)) : first[a + time].bands[band];
      meanB += band === -1 ? Math.log(Math.max(1e-6, second[b + time].rms)) : second[b + time].bands[band];
    }
    meanA /= length;
    meanB /= length;
    let covariance = 0;
    let energyA = 0;
    let energyB = 0;
    for (let time = 0; time < length; time += 1) {
      const valueA = (band === -1 ? Math.log(Math.max(1e-6, first[a + time].rms)) : first[a + time].bands[band]) - meanA;
      const valueB = (band === -1 ? Math.log(Math.max(1e-6, second[b + time].rms)) : second[b + time].bands[band]) - meanB;
      covariance += valueA * valueB;
      energyA += valueA * valueA;
      energyB += valueB * valueB;
    }
    if (energyA < 1e-6 || energyB < 1e-6) continue;
    total += covariance / Math.sqrt(energyA * energyB);
    channels += 1;
  }
  return channels ? total / channels : -1;
}

function audioMatches(rawFirst: AudioFrame[], rawSecond: AudioFrame[], minimumWindow: number) {
  const first = regularizeAudioFrames(rawFirst);
  const second = regularizeAudioFrames(rawSecond);
  const minFrames = Math.ceil(minimumWindow / HOP_SECONDS);
  if (first.length < minFrames || second.length < minFrames) throw new Error("Both clips need at least 4 seconds of readable audio.");
  const stride = 5;
  const coarseFirst = first.filter((_, index) => index % stride === 0);
  const coarseSecond = second.filter((_, index) => index % stride === 0);
  const minCoarse = Math.ceil(minFrames / stride);
  const matches: Array<{ a: number; b: number; score: number }> = [];
  for (let offset = -coarseFirst.length + minCoarse; offset <= coarseSecond.length - minCoarse; offset += 1) {
    let best = { a: 0, b: 0, score: -Infinity };
    const firstStart = Math.max(0, -offset);
    const secondStart = Math.max(0, offset);
    const overlap = Math.min(coarseFirst.length - firstStart, coarseSecond.length - secondStart);
    if (overlap < minCoarse) continue;
    const window = Math.min(overlap, Math.max(minCoarse, Math.round(8 / (HOP_SECONDS * stride))));
    for (let start = 0; start <= overlap - window; start += 2) {
      const a = firstStart + start;
      const b = secondStart + start;
      const score = normalizedCrossCorrelation(coarseFirst, coarseSecond, a, b, window);
      if (score > best.score) best = { a, b, score };
    }
    matches.push({ a: best.a * stride, b: best.b * stride, score: best.score });
  }
  matches.sort((left, right) => right.score - left.score);
  const unique = matches.filter((candidate, index) => matches.slice(0, index).every((prior) => Math.abs(prior.a - candidate.a) > 30 || Math.abs(prior.b - candidate.b) > 30));
  const refined = unique.slice(0, 60).map((candidate) => {
    let best = { a: candidate.a, b: candidate.b, score: -Infinity };
    const compareFrames = Math.min(Math.ceil(8 / HOP_SECONDS), first.length - candidate.a, second.length - candidate.b);
    for (let adjustA = -stride; adjustA <= stride; adjustA += 1) {
      for (let adjustB = -stride; adjustB <= stride; adjustB += 1) {
        const a = candidate.a + adjustA;
        const b = candidate.b + adjustB;
        if (a < 0 || b < 0 || a + compareFrames > first.length || b + compareFrames > second.length) continue;
        const score = normalizedCrossCorrelation(first, second, a, b, compareFrames);
        if (score > best.score) best = { a, b, score };
      }
    }
    return { ...best, score: Math.max(0, Math.min(1, (best.score + 1) / 2)) };
  }).sort((left, right) => right.score - left.score);
  return refined;
}

/** Finds a shared audio-energy pattern in the opening 25 seconds of each clip. */
export async function alignClipsByAudio(
  earlierFile: AudioSource,
  newerFile: AudioSource,
  onProgress: (progress: number) => void,
): Promise<ClipMatch> {
  onProgress(0.05);
  let earlierProgress = 0;
  let newerProgress = 0;
  const reportAudioProgress = () => onProgress(((earlierProgress + newerProgress) / 2) * 0.9);
  const [earlierAudio, newerAudio] = await Promise.all([
    readAudio(earlierFile, (progress) => { earlierProgress = progress; reportAudioProgress(); }),
    readAudio(newerFile, (progress) => { newerProgress = progress; reportAudioProgress(); }),
  ]);
  onProgress(0.9);
  const match = matchAudioFrames(earlierAudio.levels, newerAudio.levels);
  onProgress(1);
  return match;
}

/** Compare already sampled audio, independent of browser playback and capture. */
export function matchAudioFrames(earlierFrames: AudioFrame[], newerFrames: AudioFrame[]): ClipMatch {
  const earlierAfterPause = findSoundAfterSilence(earlierFrames);
  const newerAfterPause = findSoundAfterSilence(newerFrames);
  if (earlierAfterPause !== null && newerAfterPause !== null) {
    return {
      earlierSeconds: earlierAfterPause,
      newerSeconds: newerAfterPause,
      audioSimilarity: 1,
      confidenceMargin: 1,
      hasRunnerUp: false,
      method: "silence-pause",
    };
  }
  // One recording may have audience noise throughout its introduction. A pause
  // in only one clip does not prevent matching the shared music in both tracks.
  const candidates = audioMatches(earlierFrames, newerFrames, 4);
  if (!candidates.length) {
    throw new Error("No shared music section was found in the first 25 seconds. Try clips with more music, or adjust the markers manually.");
  }
  const best = candidates[0];
  const runnerUp = candidates.find((candidate) => Math.abs((candidate.b - candidate.a) - (best.b - best.a)) > Math.ceil(1 / HOP_SECONDS));
  if (best.score < MIN_CORRELATION_SCORE) {
    const scoreText = ` Best cross-correlation score was ${Math.round(best.score * 100)}%.`;
    const alternateText = runnerUp ? ` The next distinct timing scored ${Math.round(runnerUp.score * 100)}%.` : "";
    throw new Error(`No confident shared audio pattern was found in the first 25 seconds.${scoreText}${alternateText} Try clips with more music, or adjust the markers manually.`);
  }
  const confidenceMargin = runnerUp ? best.score - runnerUp.score : 1;
  if (runnerUp && confidenceMargin < MIN_CONFIDENCE_MARGIN) {
    throw new Error(`The audio match is ambiguous: the best offset scored ${Math.round(best.score * 100)}%, but another timing offset scored ${Math.round(runnerUp.score * 100)}%. Try a longer section with distinct music or adjust the markers manually.`);
  }
  return {
    earlierSeconds: best.a * HOP_SECONDS,
    newerSeconds: best.b * HOP_SECONDS,
    audioSimilarity: best.score,
    confidenceMargin,
    hasRunnerUp: Boolean(runnerUp),
    method: "cross-correlation",
  };
}
