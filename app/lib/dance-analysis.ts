export type Landmark = { x: number; y: number; z: number; visibility: number };
export type PoseFrame = { time: number; landmarks: Landmark[]; armExtension: number | null; torsoTilt: number | null; movement: number };
export type DanceMetric = { name: string; score: number | null; detail: string; color: string; icon: string };
export type DanceNote = { time: number; label: string; text: string; kind: "focus" | "good" };
export type DanceReport = {
  metrics: DanceMetric[];
  notes: DanceNote[];
  overall: number | null;
  bpm: number | null;
  beatConfidence: number;
  analyzedSeconds: number;
  detectedPosePercent: number;
};
type AudioSample = { time: number; level: number };

const MAX_ANALYSIS_SECONDS = 180;
const SAMPLE_INTERVAL = 0.32;
const MIN_VISIBILITY = 0.35;

function visible(point?: Landmark) { return Boolean(point && point.visibility >= MIN_VISIBILITY); }

function angleAt(a: Landmark, b: Landmark, c: Landmark) {
  const first = { x: a.x - b.x, y: a.y - b.y };
  const second = { x: c.x - b.x, y: c.y - b.y };
  const lengths = Math.hypot(first.x, first.y) * Math.hypot(second.x, second.y);
  if (!lengths) return null;
  const cosine = Math.max(-1, Math.min(1, (first.x * second.x + first.y * second.y) / lengths));
  return Math.acos(cosine) * (180 / Math.PI);
}

function midpoint(a: Landmark, b: Landmark) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }

function poseMeasures(landmarks: Landmark[]) {
  const armAngles = [[11, 13, 15], [12, 14, 16]]
    .map(([shoulder, elbow, wrist]) => {
      const points = [landmarks[shoulder], landmarks[elbow], landmarks[wrist]];
      return points.every(visible) ? angleAt(points[0], points[1], points[2]) : null;
    }).filter((value): value is number => value !== null);
  const armExtension = armAngles.length ? armAngles.reduce((sum, value) => sum + value, 0) / armAngles.length : null;
  const shoulders = [landmarks[11], landmarks[12]];
  const hips = [landmarks[23], landmarks[24]];
  let torsoTilt: number | null = null;
  if (shoulders.every(visible) && hips.every(visible)) {
    const shoulderCenter = midpoint(shoulders[0], shoulders[1]);
    const hipCenter = midpoint(hips[0], hips[1]);
    torsoTilt = Math.abs(Math.atan2(shoulderCenter.x - hipCenter.x, hipCenter.y - shoulderCenter.y) * (180 / Math.PI));
  }
  return { armExtension, torsoTilt };
}

function estimateBeat(samples: AudioSample[]) {
  if (samples.length < 100 || samples.at(-1)!.time - samples[0].time < 4) return null;
  const step = (samples.at(-1)!.time - samples[0].time) / (samples.length - 1);
  if (step <= 0) return null;
  const levels = samples.map((sample) => sample.level);
  const onset = levels.map((level, index) => index < 2 ? 0 : Math.max(0, level - levels[index - 2]));
  const mean = onset.reduce((sum, value) => sum + value, 0) / onset.length;
  const envelope = onset.map((value) => Math.max(0, value - mean));
  const energy = envelope.reduce((sum, value) => sum + value * value, 0);
  if (energy < 0.0001) return null;

  let best = { lag: 0, confidence: 0 };
  for (let bpm = 65; bpm <= 180; bpm += 1) {
    const lag = Math.round((60 / bpm) / step);
    if (lag < 2 || lag >= envelope.length / 3) continue;
    let correlation = 0;
    for (let index = lag; index < envelope.length; index += 1) correlation += envelope[index] * envelope[index - lag];
    const normalized = correlation / energy;
    if (normalized > best.confidence) best = { lag, confidence: normalized };
  }
  if (!best.lag || best.confidence < 0.035) return null;

  const period = best.lag * step;
  let bestPhase = 0;
  let phaseStrength = -1;
  const phaseSteps = Math.max(1, Math.round(period / step));
  for (let phaseIndex = 0; phaseIndex < phaseSteps; phaseIndex += 1) {
    const phase = phaseIndex * step;
    let strength = 0;
    for (let time = phase; time < samples.at(-1)!.time; time += period) {
      const index = Math.round((time - samples[0].time) / step);
      strength += envelope[Math.max(0, Math.min(envelope.length - 1, index))];
    }
    if (strength > phaseStrength) { bestPhase = phase; phaseStrength = strength; }
  }
  const beats: number[] = [];
  for (let time = samples[0].time + bestPhase; time <= samples.at(-1)!.time; time += period) beats.push(time);
  return { bpm: 60 / period, period, beats, confidence: best.confidence };
}

function clampScore(value: number) { return Math.max(0, Math.min(100, Math.round(value))); }

function buildReport(frames: PoseFrame[], audio: AudioSample[], duration: number): DanceReport {
  const valid = frames.filter((frame) => frame.landmarks.length > 0);
  const armValues = valid.map((frame) => frame.armExtension).filter((value): value is number => value !== null);
  const tiltValues = valid.map((frame) => frame.torsoTilt).filter((value): value is number => value !== null);
  const armScore = armValues.length ? clampScore(armValues.reduce((sum, value) => sum + value, 0) / armValues.length / 180 * 100) : null;
  const postureScore = tiltValues.length ? clampScore(100 - tiltValues.reduce((sum, value) => sum + value, 0) / tiltValues.length * 1.25) : null;
  const speeds = valid.slice(1).map((frame, index) => frame.movement / Math.max(0.1, frame.time - valid[index].time));
  const speedChanges = speeds.slice(1).map((speed, index) => Math.abs(speed - speeds[index]) / Math.max(0.1, valid[index + 2].time - valid[index + 1].time));
  const smoothnessScore = speedChanges.length ? clampScore(100 - speedChanges.reduce((sum, value) => sum + value, 0) / speedChanges.length * 28) : null;
  const energyScore = speeds.length ? clampScore(20 + speeds.reduce((sum, value) => sum + value, 0) / speeds.length * 85) : null;
  const detectionPercent = frames.length ? Math.round(valid.length / frames.length * 100) : 0;
  const audioBeat = estimateBeat(audio);
  let timingScore: number | null = null;
  if (audioBeat && speeds.length >= 3) {
    const peaks = speeds.map((speed, index) => ({ speed, time: valid[index + 1].time }))
      .filter((item, index, list) => item.speed > 0.08 && item.speed >= (list[index - 1]?.speed ?? -1) && item.speed >= (list[index + 1]?.speed ?? -1));
    if (peaks.length) {
      const tolerance = Math.min(0.28, audioBeat.period * 0.22);
      const matched = peaks.filter((peak) => audioBeat.beats.some((beat) => Math.abs(beat - peak.time) <= tolerance)).length;
      timingScore = clampScore(matched / peaks.length * 100);
    }
  }
  const visibilityScore = detectionPercent >= 85 ? 95 : detectionPercent >= 60 ? 75 : detectionPercent >= 35 ? 50 : 25;
  const metrics: DanceMetric[] = [
    { name: "Beat match", score: timingScore, detail: audioBeat ? `Estimated ${Math.round(audioBeat.bpm)} BPM · approximate` : "No clear beat could be estimated", color: "coral", icon: "◷" },
    { name: "Upright alignment", score: postureScore, detail: "Estimated from shoulder and hip landmarks", color: "blue", icon: "♧" },
    { name: "Movement flow", score: smoothnessScore, detail: "Estimated from changes between sampled poses", color: "gold", icon: "〰" },
    { name: "Arm extension", score: armScore, detail: "Average elbow extension in sampled frames", color: "purple", icon: "↗" },
    { name: "In-frame visibility", score: visibilityScore, detail: `${detectionPercent}% of sampled frames included a detected pose`, color: "green", icon: "◎" },
    { name: "Movement amount", score: energyScore, detail: "Estimated from body landmark movement", color: "coral", icon: "✳" },
  ];
  const values = metrics.map((metric) => metric.score).filter((value): value is number => value !== null);
  const notes: DanceNote[] = [];
  const weakestArm = valid.filter((frame) => frame.armExtension !== null).sort((a, b) => a.armExtension! - b.armExtension!)[0];
  const greatestTilt = valid.filter((frame) => frame.torsoTilt !== null).sort((a, b) => b.torsoTilt! - a.torsoTilt!)[0];
  const strongestMove = valid.slice(1).sort((a, b) => b.movement - a.movement)[0];
  if (weakestArm && armScore !== null && armScore < 88) notes.push({ time: weakestArm.time, label: "Arm extension", text: "The sampled elbow angle bends here. Check whether you want to finish this arm line more fully.", kind: "focus" });
  if (greatestTilt && postureScore !== null && postureScore < 82) notes.push({ time: greatestTilt.time, label: "Torso angle", text: "Your torso angle changes here. Review the frame and decide whether that lean fits the movement.", kind: "focus" });
  if (audioBeat && timingScore !== null && timingScore < 55) {
    const offBeat = valid.find((frame) => !audioBeat.beats.some((beat) => Math.abs(beat - frame.time) <= Math.min(0.28, audioBeat.period * 0.22)));
    if (offBeat) notes.push({ time: offBeat.time, label: "Beat check", text: "This sampled movement did not line up closely with the estimated beat. Check the music count here.", kind: "focus" });
  }
  if (strongestMove) notes.push({ time: strongestMove.time, label: "Movement peak", text: "This is one of the larger position changes in the sampled video. Review how the transition feels.", kind: "good" });
  if (notes.length === 0 && valid.length) notes.push({ time: valid[Math.floor(valid.length / 2)].time, label: "Keep exploring", text: "The model found a pose here. Use the overlay to inspect your shape; this report is a movement estimate, not an instructor's judgement.", kind: "good" });
  return {
    metrics,
    notes: notes.slice(0, 4).sort((a, b) => a.time - b.time),
    overall: values.length ? clampScore(values.reduce((sum, value) => sum + value, 0) / values.length) : null,
    bpm: audioBeat ? Math.round(audioBeat.bpm) : null,
    beatConfidence: audioBeat?.confidence ?? 0,
    analyzedSeconds: Math.min(duration, MAX_ANALYSIS_SECONDS),
    detectedPosePercent: detectionPercent,
  };
}

function waitForMedia(video: HTMLVideoElement, eventName: "loadedmetadata" | "seeked") {
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => { video.removeEventListener(eventName, onReady); video.removeEventListener("error", onError); };
    const onReady = () => { cleanup(); resolve(); };
    const onError = () => { cleanup(); reject(new Error("The browser could not read this video. Try an MP4 with H.264 video and AAC audio.")); };
    video.addEventListener(eventName, onReady, { once: true });
    video.addEventListener("error", onError, { once: true });
  });
}

export async function analyzeDanceVideo(
  file: File,
  onProgress: (progress: number) => void,
): Promise<{ frames: PoseFrame[]; report: DanceReport }> {
  const objectUrl = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.preload = "auto";
  video.playsInline = true;
  video.src = objectUrl;
  let audioContext: AudioContext | null = null;
  let landmarker: import("@mediapipe/tasks-vision").PoseLandmarker | null = null;
  try {
    const metadataReady = waitForMedia(video, "loadedmetadata");
    video.load();
    await metadataReady;
    if (!Number.isFinite(video.duration) || video.duration < 1) throw new Error("This video has no readable duration.");
    if (video.duration > MAX_ANALYSIS_SECONDS) throw new Error("For this on-device preview, trim the video to 3 minutes or less and try again.");

    audioContext = new AudioContext();
    const source = audioContext.createMediaElementSource(video);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.15;
    const silentOutput = audioContext.createGain();
    silentOutput.gain.value = 0;
    source.connect(analyser);
    analyser.connect(silentOutput);
    silentOutput.connect(audioContext.destination);
    const timeDomain = new Uint8Array(analyser.fftSize);

    // Start playback in the button gesture so browser autoplay policies allow local audio analysis.
    const contextReady = audioContext.resume();
    const playbackReady = video.play();
    await Promise.all([contextReady, playbackReady]);

    const { FilesetResolver, PoseLandmarker } = await import("@mediapipe/tasks-vision");
    const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1/wasm");
    landmarker = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: "/models/pose_landmarker_lite.task", delegate: "GPU" },
      runningMode: "VIDEO",
      numPoses: 2,
      minPoseDetectionConfidence: 0.45,
      minPosePresenceConfidence: 0.45,
      minTrackingConfidence: 0.45,
    }).catch(async () => PoseLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: "/models/pose_landmarker_lite.task", delegate: "CPU" },
      runningMode: "VIDEO",
      numPoses: 2,
      minPoseDetectionConfidence: 0.45,
      minPosePresenceConfidence: 0.45,
      minTrackingConfidence: 0.45,
    }));

    const frames: PoseFrame[] = [];
    const audio: AudioSample[] = [];
    let lastPoseTime = -SAMPLE_INTERVAL;
    let lastAudioTime = -1;
    let nextProgressTime = -1;
    await new Promise<void>((resolve, reject) => {
      const sample = () => {
        try {
          const time = video.currentTime;
          if (time > lastAudioTime + 0.018) {
            analyser.getByteTimeDomainData(timeDomain);
            let squares = 0;
            for (const value of timeDomain) { const centered = (value - 128) / 128; squares += centered * centered; }
            audio.push({ time, level: Math.sqrt(squares / timeDomain.length) });
            lastAudioTime = time;
          }
          if (time >= lastPoseTime + SAMPLE_INTERVAL && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
            const result = landmarker!.detectForVideo(video, time * 1000);
            const candidates = result.landmarks.map((points) => points.map((point) => ({ x: point.x, y: point.y, z: point.z, visibility: point.visibility ?? 1 })));
            const selected = candidates.sort((a, b) => {
              const area = (points: Landmark[]) => {
                const visiblePoints = points.filter(visible);
                if (!visiblePoints.length) return 0;
                const xs = visiblePoints.map((point) => point.x); const ys = visiblePoints.map((point) => point.y);
                return (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
              };
              return area(b) - area(a);
            })[0] ?? [];
            const measured = poseMeasures(selected);
            let movement = 0;
            const previous = frames.at(-1);
            if (previous && selected.length) {
              const indices = [11, 12, 15, 16, 23, 24];
              const distances = indices.filter((index) => visible(selected[index]) && visible(previous.landmarks[index]))
                .map((index) => Math.hypot(selected[index].x - previous.landmarks[index].x, selected[index].y - previous.landmarks[index].y));
              if (distances.length) movement = distances.reduce((sum, value) => sum + value, 0) / distances.length;
            }
            frames.push({ time, landmarks: selected, ...measured, movement });
            lastPoseTime = time;
          }
          if (time >= nextProgressTime) {
            onProgress(Math.min(99, Math.round(time / video.duration * 100)));
            nextProgressTime = time + 0.5;
          }
          if (video.ended || time >= video.duration - 0.03) { resolve(); return; }
          requestAnimationFrame(sample);
        } catch (error) { reject(error); }
      };
      requestAnimationFrame(sample);
    });
    const validPoseCount = frames.filter((frame) => frame.landmarks.length).length;
    if (!validPoseCount) throw new Error("No dancer pose was detected. Try a brighter video with the full body visible.");
    onProgress(100);
    return { frames, report: buildReport(frames, audio, video.duration) };
  } catch (error) {
    if (error instanceof Error && error.name === "NotAllowedError") throw new Error("Your browser blocked local audio analysis. Click Analyze again and allow playback.");
    if (error instanceof Error && /fetch|wasm|model/i.test(error.message)) throw new Error("The pose model could not load. Check your internet connection, then try again.");
    throw error;
  } finally {
    video.pause();
    video.removeAttribute("src");
    video.load();
    landmarker?.close();
    await audioContext?.close().catch(() => undefined);
    URL.revokeObjectURL(objectUrl);
  }
}
