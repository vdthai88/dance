"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent, DragEvent } from "react";
import { alignClipsByAudio } from "./lib/clip-alignment";
import type { DanceCritique } from "./lib/gemini-critique";
import { isDanceCritique } from "./lib/gemini-critique";
import { readApiJson } from "./lib/api-response";
import { AccountMenu } from "./components/account-menu";
import { TeacherFeedbackPanel } from "./components/teacher-feedback-panel";
import { SessionPanel } from "./components/session-panel";
import { ProfilePage } from "./components/profile-page";
import { VideoLibrary } from "./components/video-library";

function formatTime(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}

function formatPreciseTime(seconds: number) {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const remaining = (safe % 60).toFixed(1).padStart(4, "0");
  return `${minutes}:${remaining}`;
}

type SavedBaseline = {
  critique: DanceCritique;
  filename: string;
  model: string;
  createdAt: string;
};
type TeacherCompany = { id: string; name: string; type: "studio" | "private_company" | "other"; isDefault?: boolean };

export default function Home() {
  const [videoUrl, setVideoUrl] = useState("");
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState("");
  const [comparisonUrl, setComparisonUrl] = useState("");
  const [comparisonFile, setComparisonFile] = useState<File | null>(null);
  const [comparisonName, setComparisonName] = useState("");
  const [earlierSongStart, setEarlierSongStart] = useState(0);
  const [newerSongStart, setNewerSongStart] = useState(0);
  const [alignmentReady, setAlignmentReady] = useState(true);
  const [audioSource, setAudioSource] = useState<"earlier" | "newer" | "muted">("earlier");
  const [isAutoAligning, setIsAutoAligning] = useState(false);
  const [autoAlignProgress, setAutoAlignProgress] = useState(0);
  const [alignmentMessage, setAlignmentMessage] = useState("");
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [danceCritique, setDanceCritique] = useState<DanceCritique | null>(null);
  const [savedBaseline, setSavedBaseline] = useState<SavedBaseline | null>(null);
  const [profile, setProfile] = useState<"student" | "teacher">("student");
  const [profileRequired, setProfileRequired] = useState(false);
  const [activePage, setActivePage] = useState<"replai" | "coaching" | "profile">("replai");
  const [hasProfileActions, setHasProfileActions] = useState(false);
  const [teacherCompanies, setTeacherCompanies] = useState<TeacherCompany[]>([]);
  const [activeTeacherCompanyId, setActiveTeacherCompanyId] = useState("");
  const [studentCompanies, setStudentCompanies] = useState<TeacherCompany[]>([]);
  const [activeStudentCompanyId, setActiveStudentCompanyId] = useState("");
  const [routeReady, setRouteReady] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [isLookingUpBaseline, setIsLookingUpBaseline] = useState(false);
  const [baselineLookupError, setBaselineLookupError] = useState("");
  const [critiqueCacheHit, setCritiqueCacheHit] = useState(false);
  const [isCritiquing, setIsCritiquing] = useState(false);
  const [sideBySide, setSideBySide] = useState(false);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [libraryRefreshKey, setLibraryRefreshKey] = useState(0);
  const [savingVideos, setSavingVideos] = useState(0);
  const [videoSaveError, setVideoSaveError] = useState("");
  const primaryVideo = useRef<HTMLVideoElement>(null);
  const secondaryVideo = useRef<HTMLVideoElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const comparisonInput = useRef<HTMLInputElement>(null);
  const baselineLookupId = useRef(0);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      const requestedPage = params.get("page");
      const profileIsRequired = params.get("required") === "1";

      if (profileIsRequired) {
        setProfileRequired(true);
        setActivePage("profile");
      } else if (requestedPage === "replai" || requestedPage === "coaching" || requestedPage === "profile") {
        setActivePage(requestedPage);
      }
      setRouteReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!routeReady) return;
    const url = new URL(window.location.href);
    url.searchParams.set("page", activePage);
    if (profileRequired) url.searchParams.set("required", "1");
    else url.searchParams.delete("required");
    window.history.replaceState({}, "", `${url.pathname}${url.search}`);
  }, [activePage, profileRequired, routeReady]);

  useEffect(() => () => { if (videoUrl) URL.revokeObjectURL(videoUrl); }, [videoUrl]);

  useEffect(() => {
    let active = true;
    async function checkProfileActions() {
      try {
        const [studentRequests, companyRequests] = await Promise.all([fetch("/api/connections?pending=true", { cache: "no-store" }), fetch("/api/company-join-requests", { cache: "no-store" })]);
        const studentData = studentRequests.ok ? await studentRequests.json() as unknown[] : [];
        const companyData = companyRequests.ok ? await companyRequests.json() as unknown[] : [];
        if (active) setHasProfileActions(studentData.length > 0 || companyData.length > 0);
      } catch { if (active) setHasProfileActions(false); }
    }
    void checkProfileActions();
    const interval = window.setInterval(() => { void checkProfileActions(); }, 20000);
    return () => { active = false; window.clearInterval(interval); };
  }, []);

  useEffect(() => {
    if (activePage !== "coaching") return;
    let active = true;
    void fetch("/api/account/roles", { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json() as { roles?: string[] };
        if (!response.ok) throw new Error("Could not load account roles.");
        if (active) setProfile(result.roles?.includes("teacher") || result.roles?.includes("admin") ? "teacher" : "student");
      })
      .catch(() => { if (active) setProfile("student"); });
    return () => { active = false; };
  }, [activePage]);

  useEffect(() => {
    let active = true;
    void fetch("/api/teacher-companies", { cache: "no-store" }).then(async (response) => {
      const companies = await response.json() as TeacherCompany[];
      if (!response.ok || !active) return;
      setTeacherCompanies(companies);
      setActiveTeacherCompanyId((current) => current && companies.some((company) => company.id === current) ? current : companies.find((company) => company.isDefault)?.id ?? companies[0]?.id ?? "");
    }).catch(() => { if (active) setTeacherCompanies([]); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    void fetch("/api/user-companies", { cache: "no-store" }).then(async (response) => {
      const companies = await response.json() as TeacherCompany[];
      if (!response.ok || !active) return;
      setStudentCompanies(companies);
      setActiveStudentCompanyId((current) => current && companies.some((company) => company.id === current) ? current : companies[0]?.id ?? "");
    }).catch(() => { if (active) setStudentCompanies([]); });
    return () => { active = false; };
  }, []);

  async function openCoaching() {
    try {
      const response = await fetch("/api/account/roles");
      const result = await response.json() as { roles?: string[] };
      setProfile(result.roles?.includes("teacher") || result.roles?.includes("admin") ? "teacher" : "student");
    } catch {
      setProfile("student");
    }
    setActivePage("coaching");
    document.getElementById("studio")?.scrollIntoView({ behavior: "smooth" });
  }

  async function loadSavedBaseline(file: File) {
    const lookupId = ++baselineLookupId.current;
    const form = new FormData();
    form.set("video", file, file.name);
    setIsLookingUpBaseline(true);
    setSavedBaseline(null);
    setBaselineLookupError("");
    try {
      const response = await fetch("/api/saved-critique", { method: "POST", body: form });
      const result = await readApiJson(response, "Saved critique lookup") as SavedBaseline | null;
      if (lookupId === baselineLookupId.current) setSavedBaseline(result as SavedBaseline | null);
    } catch (caught) {
      if (lookupId === baselineLookupId.current) setBaselineLookupError(caught instanceof Error ? caught.message : "Could not look up the saved critique.");
    } finally {
      if (lookupId === baselineLookupId.current) setIsLookingUpBaseline(false);
    }
  }

  async function saveVideoToLibrary(file: File) {
    setSavingVideos((current) => current + 1);
    setVideoSaveError("");
    try {
      const form = new FormData();
      form.set("video", file, file.name);
      const response = await fetch("/api/replai-videos", { method: "POST", body: form });
      await readApiJson(response, "Save video");
      setLibraryRefreshKey((current) => current + 1);
    } catch (caught) {
      setVideoSaveError(`“${file.name}” was not saved: ${caught instanceof Error ? caught.message : "Please choose the file again to retry."}`);
    } finally { setSavingVideos((current) => current - 1); }
  }

  function chooseFile(file?: File) {
    if (!file) return;
    setError("");
    setDanceCritique(null);
    setCritiqueCacheHit(false);
    setSavedBaseline(null);
    setBaselineLookupError("");
    if (!file.type.startsWith("video/")) { setError("Choose a video file to continue."); return; }
    if (file.size > 250 * 1024 * 1024) { setError("This preview supports videos up to 250 MB."); return; }
    setVideoUrl((previous) => { if (previous) URL.revokeObjectURL(previous); return URL.createObjectURL(file); });
    setVideoFile(file);
    void saveVideoToLibrary(file);
    void loadSavedBaseline(file);
    setFileName(file.name);
    setDuration(0);
    setCurrentTime(0);
    setEarlierSongStart(0);
    setAlignmentReady(true);
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) { chooseFile(event.target.files?.[0]); event.currentTarget.value = ""; }

  function chooseComparison(file?: File) {
    if (!file) return;
    setError(""); setDanceCritique(null); setCritiqueCacheHit(false);
    if (!file.type.startsWith("video/")) { setError("Choose a video file for the newer take."); return; }
    if (file.size > 250 * 1024 * 1024) { setError("This preview supports videos up to 250 MB per clip."); return; }
    setComparisonUrl((previous) => { if (previous) URL.revokeObjectURL(previous); return URL.createObjectURL(file); });
    setComparisonFile(file); setComparisonName(file.name); setSideBySide(true); setNewerSongStart(0); setAlignmentReady(true); setAudioSource("earlier");
    void saveVideoToLibrary(file);
  }

  useEffect(() => () => { if (comparisonUrl) URL.revokeObjectURL(comparisonUrl); }, [comparisonUrl]);

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault(); setDragging(false); chooseFile(event.dataTransfer.files[0]);
  }

  async function requestGeminiCritique() {
    if (!videoFile) return;
    if (savingVideos > 0) { setError("Please wait for your videos to finish saving, then send them to Gemini."); return; }
    setIsCritiquing(true);
    setError("");
    setDanceCritique(null);
    setCritiqueCacheHit(false);
    try {
      const form = new FormData();
      form.set("video", videoFile, videoFile.name);
      if (comparisonFile) form.set("comparisonVideo", comparisonFile, comparisonFile.name);
      if (comparisonFile) {
        form.set("earlierSongStart", String(earlierSongStart));
        form.set("newerSongStart", String(newerSongStart));
      }
      const response = await fetch("/api/dance-critique", { method: "POST", body: form });
      const result = await readApiJson(response, "Video critique");
      if (!isDanceCritique(result)) throw new Error("The server returned an invalid critique. Check Render Logs for this request, then retry.");
      setCritiqueCacheHit(response.headers.get("X-Critique-Cache") === "hit");
      setDanceCritique(result as DanceCritique);
    } catch (caught) {
      setError(caught instanceof TypeError && caught.message.toLowerCase().includes("fetch")
        ? "The connection to the dance app was interrupted. Check the VS Code terminal for a server timeout or restart, then retry."
        : caught instanceof Error ? caught.message : "Gemini could not critique this video.");
    } finally {
      setIsCritiquing(false);
    }
  }

  function seekTo(time: number, target: "earlier" | "new" | "both" = "both") {
    const first = primaryVideo.current;
    const second = secondaryVideo.current;
    if (!first) return;
    const clampTime = (video: HTMLVideoElement, value: number) => Math.min(Math.max(0, value), video.duration || value);
    setAlignmentReady(true);
    if (target === "new" && comparisonFile && second) {
      second.currentTime = clampTime(second, time);
      first.currentTime = clampTime(first, earlierSongStart + time - newerSongStart);
    } else {
      first.currentTime = clampTime(first, time);
      if (comparisonFile && second) second.currentTime = clampTime(second, newerSongStart + time - earlierSongStart);
    }
    void first.play();
    if (comparisonFile && second) void second.play();
  }

  function syncPlayback(source: "earlier" | "newer" = "earlier") {
    const first = primaryVideo.current;
    const second = secondaryVideo.current;
    if (!first || !second) return;
    if (!comparisonFile) {
      if (source === "earlier" && sideBySide) second.currentTime = first.currentTime;
      return;
    }
    if (!alignmentReady) return;
    const sourceTime = source === "earlier" ? first.currentTime : second.currentTime;
    const target = source === "earlier" ? second : first;
    const alignedTargetTime = source === "earlier"
      ? newerSongStart + sourceTime - earlierSongStart
      : earlierSongStart + sourceTime - newerSongStart;
    const boundedTime = Math.min(Math.max(0, alignedTargetTime), target.duration || alignedTargetTime);
    if (Math.abs(target.currentTime - boundedTime) >= 0.12) target.currentTime = boundedTime;
  }

  function startSynchronizedPlayback(source: "earlier" | "newer") {
    const first = primaryVideo.current;
    const second = secondaryVideo.current;
    if (!first || !second || !comparisonFile || !alignmentReady) return;
    const sourceTime = source === "earlier" ? first.currentTime : second.currentTime;
    const target = source === "earlier" ? second : first;
    const alignedTargetTime = source === "earlier"
      ? newerSongStart + sourceTime - earlierSongStart
      : earlierSongStart + sourceTime - newerSongStart;
    target.currentTime = Math.min(Math.max(0, alignedTargetTime), target.duration || alignedTargetTime);
    if (target.paused) void target.play();
  }

  function adjustSongStart(which: "earlier" | "newer", delta: number) {
    const first = primaryVideo.current;
    const second = secondaryVideo.current;
    first?.pause();
    second?.pause();
    setAlignmentReady(false);
    const video = which === "earlier" ? first : second;
    const current = which === "earlier" ? earlierSongStart : newerSongStart;
    const proposed = Math.max(0, current + delta);
    const next = video?.duration ? Math.min(proposed, video.duration) : proposed;
    if (which === "earlier") setEarlierSongStart(next);
    else setNewerSongStart(next);
    if (video) video.currentTime = next;
    setAlignmentMessage(`Fine-tuned the ${which} start to ${formatPreciseTime(next)}. Play from aligned starts to check the sync.`);
  }

  function toggleAlignment() {
    const first = primaryVideo.current;
    const second = secondaryVideo.current;
    if (alignmentReady) {
      setAlignmentReady(false);
      first?.pause();
      second?.pause();
      return;
    }
    setAlignmentReady(true);
    if (first) first.currentTime = Math.min(earlierSongStart, first.duration || earlierSongStart);
    if (second) second.currentTime = Math.min(newerSongStart, second.duration || newerSongStart);
    void first?.play();
    void second?.play();
  }

  const autoAlignMusic = useCallback(async () => {
    if (!videoFile || !comparisonFile) return;
    setIsAutoAligning(true);
    setAutoAlignProgress(0);
    setAlignmentMessage("Matching the song automatically in the first 25 seconds…");
    setAlignmentReady(false);
    primaryVideo.current?.pause();
    secondaryVideo.current?.pause();
    try {
      const match = await alignClipsByAudio(videoFile, comparisonFile, setAutoAlignProgress);
      setEarlierSongStart(match.earlierSeconds);
      setNewerSongStart(match.newerSeconds);
      setAutoAlignProgress(1);
      setAlignmentReady(true);
      if (primaryVideo.current) primaryVideo.current.currentTime = Math.min(match.earlierSeconds, primaryVideo.current.duration || match.earlierSeconds);
      if (secondaryVideo.current) secondaryVideo.current.currentTime = Math.min(match.newerSeconds, secondaryVideo.current.duration || match.newerSeconds);
      if (match.method === "silence-pause") {
        setAlignmentMessage(`Song starts estimated from the first sound after silence: earlier ${formatPreciseTime(match.earlierSeconds)}, newer ${formatPreciseTime(match.newerSeconds)}. Review the markers, then play.`);
        return;
      }
      const similarity = Math.round(match.audioSimilarity * 100);
      const confidenceGap = Math.round(match.confidenceMargin * 100);
      const confidenceNote = match.hasRunnerUp ? `${confidenceGap}-point lead over another timing` : "no competing timing found";
      setAlignmentMessage(match.audioSimilarity < 0.82 || match.confidenceMargin < 0.08
        ? `Tentative audio correlation: earlier ${formatPreciseTime(match.earlierSeconds)}, newer ${formatPreciseTime(match.newerSeconds)} (${similarity}% score; ${confidenceNote}). Check both positions before playing.`
        : `Matching audio sections found: earlier ${formatPreciseTime(match.earlierSeconds)}, newer ${formatPreciseTime(match.newerSeconds)} (${similarity}% correlation; ${confidenceNote}). Review the markers, then play.`);
    } catch (caught) {
      setAlignmentReady(false);
      setAlignmentMessage(caught instanceof Error ? caught.message : "Could not detect the song starts. Set them manually instead.");
    } finally {
      setIsAutoAligning(false);
    }
  }, [videoFile, comparisonFile]);

  useEffect(() => {
    if (!videoFile || !comparisonFile) return;
    const timeout = window.setTimeout(() => { void autoAlignMusic(); }, 0);
    return () => window.clearTimeout(timeout);
  }, [videoFile, comparisonFile, autoAlignMusic]);

  const activeCompanies = profile === "teacher" ? teacherCompanies : studentCompanies;
  const activeCompanyId = profile === "teacher" ? activeTeacherCompanyId : activeStudentCompanyId;
  const activeCompany = activeCompanies.find((company) => company.id === activeCompanyId) ?? null;

  function changeActiveCompany(companyId: string) {
    if (profile === "teacher") setActiveTeacherCompanyId(companyId);
    else setActiveStudentCompanyId(companyId);
    setActiveSessionId(null);
  }

  return (
    <main className="shell app-shell">
      <aside className="sidebar" aria-label="Main navigation">
        <a className="sidebar-logo" href="#top" aria-label="One home">O</a>
        <nav className="sidebar-nav">
          <button className="sidebar-item active" type="button" title="ReplAI" onClick={() => { setProfile("student"); document.getElementById("studio")?.scrollIntoView({ behavior: "smooth" }); }}><span>▶</span><b>ReplAI</b></button>
          <button className="sidebar-item" type="button" title="Coaching" onClick={() => { setProfile("teacher"); document.getElementById("coaching")?.scrollIntoView({ behavior: "smooth" }); }}><span>✦</span><b>Coaching</b></button>
          <button className="sidebar-item" type="button" title="Profile"><span>◉</span><b>Profile</b></button>
          <button className="sidebar-item" type="button" title="Team"><span>♧</span><b>Team</b></button>
          <button className={`sidebar-item ${activePage === "replai" ? "active" : ""}`} type="button" title="ReplAI" onClick={() => { if (profileRequired) { setActivePage("profile"); return; } setActivePage("replai"); setProfile("student"); document.getElementById("studio")?.scrollIntoView({ behavior: "smooth" }); }}><span aria-hidden="true">▶</span><b>ReplAI</b></button>
          <button className={`sidebar-item ${activePage === "coaching" ? "active" : ""}`} type="button" title="Coaching" onClick={() => { if (profileRequired) { setActivePage("profile"); return; } void openCoaching(); }}><span aria-hidden="true">✦</span><b>Coaching</b></button>
          <button className={`sidebar-item ${activePage === "profile" ? "active" : ""}`} type="button" title={hasProfileActions ? "Profile — actions required" : "Profile"} onClick={() => { setActivePage("profile"); document.getElementById("profile")?.scrollIntoView({ behavior: "smooth" }); }}><span className="sidebar-icon" aria-hidden="true">◉{hasProfileActions && <i className="profile-action-star" aria-label="Actions required">★</i>}</span><b>Profile</b></button>
        </nav>
        <button className="sidebar-item sidebar-settings" type="button" title="Settings"><span>⚙</span><b>Settings</b></button>
      </aside>
      <header className="topbar">
        <a className="brand brand-logo" href="#top" aria-label="One Dance home"><img src="/one_dance_logo.png?v=20261111" alt="One Dance" width={76} height={62} /></a>
        <p className="header-slogan">Every move has a <em>next step.</em></p>
        {activeCompany && (activePage === "coaching" || (profile === "teacher" && activePage === "profile")) && <label className="current-studio">Current studio: {activeCompanies.length > 1 ? <select value={activeCompanyId} onChange={(event) => changeActiveCompany(event.target.value)} aria-label="Current studio">{activeCompanies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select> : <b>{activeCompany.name}</b>}</label>}
        <AccountMenu />
      </header>

      {false && <section className="hero" id="top">
        <div className="hero-copy">
          <div className="eyebrow"><span className="eyebrow-dot" /> YOUR PERSONAL PRACTICE SPACE</div>
          <h1>Every move<br />has a <em>next step.</em></h1>
          <p>Bring your practice into focus. Upload a video, get thoughtful feedback, and keep finding your flow.</p>
          <div className="hero-note"><span>{"\u2733"}</span><span>Made for the work between classes.</span></div>
        </div>
        <div className="hero-art" aria-hidden="true"><div className="art-sun"/><div className="art-orbit orbit-one"/><div className="art-orbit orbit-two"/><div className="art-ribbon ribbon-one"/><div className="art-ribbon ribbon-two"/><div className="art-caption">find your<br/>own rhythm <span>{"\u2197"}</span></div><div className="art-number">01 / 04</div></div>
      </section>}

      {activePage === "replai" && <section className="workspace" id="studio">
        <div className="section-heading"><div><div className="eyebrow muted">THE STUDIO <span className="step-line"/> STEP 01</div><h2>Practice sessions</h2><p>Choose a student and session, then add coaching or videos.</p></div><div className="privacy"><span>{"\u2667"}</span> Your saved videos are private</div></div>

        <section className="replai-intro"><div className="eyebrow muted">A PRACTICE, NOT A PERFORMANCE</div><h1>Small steps add up.</h1><div className="replai-steps"><article><span>01</span><h2>Choose your take</h2><p>Upload a solo practice video from your device.</p></article><article><span>02</span><h2>Notice the details</h2><p>Explore a sample report with moments and movement cues.</p></article><article><span>03</span><h2>Try it your way</h2><p>Keep what resonates. Your practice belongs to you.</p></article></div></section>

        <p className="video-save-status" role="status">{savingVideos > 0 ? `Saving ${savingVideos === 1 ? "your video" : "your videos"} to your library...` : "Videos you choose are saved privately to your library. Gemini receives them only when you request feedback."}</p>
        {videoSaveError && <p className="error-message" role="alert">{videoSaveError}</p>}
        {!videoUrl ? (
          <div className={`upload-card ${dragging ? "dragging" : ""}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop}>
            <input ref={fileInput} className="visually-hidden" type="file" accept="video/*" onChange={onFileChange} aria-label="Choose a dance video" />
            <div className="upload-icon"><span>{"\u2191"}</span></div><h3>Drop your video here</h3><p>or find a take you love</p>
            <button className="button button-dark" onClick={() => fileInput.current?.click()}>Choose a video <span>{"\u2197"}</span></button>
            <div className="file-meta">MP4, MOV or WebM <span>{"\u00b7"}</span> Up to 250 MB <span>{"\u00b7"}</span> 3 minutes for analysis</div>
          </div>
        ) : (
          <div className="review-grid">
            <div className="video-panel">
              <div className="clip-slots"><div><strong>Earlier take</strong><span>{fileName}</span><button className="text-button" onClick={() => fileInput.current?.click()}>Replace</button></div><div><strong>Newer take</strong><span>{comparisonName || "Add a second video to compare progress"}</span><button className="text-button" onClick={() => comparisonInput.current?.click()}>{comparisonFile ? "Replace" : "Add video +"}</button>{comparisonFile && <button className="text-button" onClick={() => { setComparisonUrl(""); setComparisonFile(null); setComparisonName(""); setDanceCritique(null); setSideBySide(false); setAlignmentReady(true); }}>Remove</button>}</div></div>
              {comparisonFile && <div className="sync-controls"><p>{alignmentMessage || (alignmentReady ? "Clips are synchronized from their marked song starts." : "Adjust each clip independently to the same moment in the song, then mark that position in each clip.")}</p><button className="button button-dark" onClick={autoAlignMusic} disabled={isAutoAligning}>{isAutoAligning ? `Matching audio: ${Math.round(autoAlignProgress * 100)}%` : "Retry audio matching"}</button><div className="sync-markers"><button className="toggle-button" onClick={() => setEarlierSongStart(primaryVideo.current?.currentTime ?? 0)}>Mark earlier start: {formatPreciseTime(earlierSongStart)}</button><button className="toggle-button" onClick={() => setNewerSongStart(secondaryVideo.current?.currentTime ?? 0)}>Mark newer start: {formatPreciseTime(newerSongStart)}</button></div><div className="sync-nudges"><span>Fine tune starts:</span><button className="toggle-button" onClick={() => adjustSongStart("earlier", -0.1)}>Earlier -0.1s</button><button className="toggle-button" onClick={() => adjustSongStart("earlier", 0.1)}>Earlier +0.1s</button><button className="toggle-button" onClick={() => adjustSongStart("newer", -0.1)}>Newer -0.1s</button><button className="toggle-button" onClick={() => adjustSongStart("newer", 0.1)}>Newer +0.1s</button></div><button className="button button-dark" onClick={toggleAlignment}>{alignmentReady ? "Adjust song start points" : "Play from aligned starts"}</button><div className="audio-selector" role="group" aria-label="Choose which video audio to hear"><span>Audio</span><button className={audioSource === "earlier" ? "selected" : ""} onClick={() => setAudioSource("earlier")}>Earlier</button><button className={audioSource === "newer" ? "selected" : ""} onClick={() => setAudioSource("newer")}>Newer</button><button className={audioSource === "muted" ? "selected" : ""} onClick={() => setAudioSource("muted")}>Mute</button></div></div>}
              <input ref={fileInput} className="visually-hidden" type="file" accept="video/*" onChange={onFileChange} aria-label="Replace earlier dance video" />
              <input ref={comparisonInput} className="visually-hidden" type="file" accept="video/*" onChange={(event) => { chooseComparison(event.target.files?.[0]); event.currentTarget.value = ""; }} aria-label="Choose newer dance video" />
              <div className={`video-stage ${comparisonFile || sideBySide ? "comparison" : ""}`}>
                <div className="video-wrap"><video ref={primaryVideo} src={videoUrl} controls playsInline muted={Boolean(comparisonFile && audioSource !== "earlier")} onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || 0)} onTimeUpdate={(event) => { setCurrentTime(event.currentTarget.currentTime); syncPlayback("earlier"); }} onPlay={() => startSynchronizedPlayback("earlier")} onPause={() => { if (comparisonFile && alignmentReady) secondaryVideo.current?.pause(); }} /><span className="stage-label">{comparisonFile ? "EARLIER TAKE" : "ORIGINAL TAKE"}</span></div>
                {(comparisonFile || sideBySide) && <div className="video-wrap annotated"><video ref={secondaryVideo} src={comparisonFile ? comparisonUrl : videoUrl} controls playsInline muted={!comparisonFile || audioSource !== "newer"} onTimeUpdate={() => { if (comparisonFile) { setCurrentTime(secondaryVideo.current?.currentTime || 0); syncPlayback("newer"); } }} onPlay={() => startSynchronizedPlayback("newer")} onPause={() => { if (comparisonFile && alignmentReady && primaryVideo.current && !primaryVideo.current.paused) primaryVideo.current.pause(); }} /><span className="stage-label">{comparisonFile ? "NEWER TAKE" : "VIDEO PREVIEW"}</span></div>}
              </div>
              <div className="video-footer"><span>{formatTime(currentTime)} <span className="time-divider">/</span> {formatTime(duration)}</span><span className="local-badge">{"\u25c9"} LOCAL PREVIEW</span></div>
              <div className="video-actions">{!comparisonFile && <button className={`toggle-button ${sideBySide ? "selected" : ""}`} onClick={() => setSideBySide((value) => !value)}><span className="toggle-icon">Compare</span>{sideBySide ? "Hide duplicate preview" : "Side-by-side preview"}</button>}</div>
              {!danceCritique && <div className="analysis-cta gemini-cta"><div><strong>{isCritiquing ? "Gemini is reviewing the clip" : comparisonFile ? "Compare progress with Gemini" : "Ask Gemini for instructor-style feedback"}</strong><span>{isCritiquing ? "Uploading and analyzing your video..." : comparisonFile ? "Gemini receives both clips and compares observable changes. Temporary Gemini uploads are deleted after the request." : "Sending shares the clip with Google Gemini. Temporary Gemini uploads are deleted after the request; your saved video stays in your library."}</span></div><button className="button button-dark" disabled={isCritiquing || savingVideos > 0 || isAutoAligning || isLookingUpBaseline} onClick={requestGeminiCritique}>{isCritiquing ? <><span className="spinner"/> Working...</> : <>{comparisonFile ? "Compare takes" : "Send to Gemini"} <span>{"\u2197"}</span></>}</button></div>}
            </div>
            <div className="insights-column">
              {isLookingUpBaseline && <p className="critique-cache-notice">Looking for a saved critique for this video…</p>}
              {baselineLookupError && <p className="error-message" role="status">{baselineLookupError}</p>}
              {savedBaseline && (comparisonFile || !danceCritique) && <CritiqueCard title={`SAVED ORIGINAL · ${savedBaseline.filename}`} critique={savedBaseline.critique} currentTime={currentTime} onSeek={seekTo} />}
              {comparisonFile && !isLookingUpBaseline && !savedBaseline && !baselineLookupError && <p className="critique-cache-notice">No saved original critique matched this exact earlier video. Run its critique first to create a baseline.</p>}
              {danceCritique && <>{critiqueCacheHit && <p className="critique-cache-notice">Loaded your saved critique for this exact video upload.</p>}<CritiqueCard critique={danceCritique} currentTime={currentTime} onSeek={seekTo} /></>}
              {!danceCritique && <div className="aside-card"><div className="aside-icon">{"\u2733"}</div><div className="eyebrow muted">A LITTLE SPACE TO GROW</div><h3>Your next take<br/>starts here.</h3><p>Send the clip to Gemini for instructor-style feedback.</p><div className="aside-decoration">01 <span>{"\u2014"}</span> 04</div></div>}
            </div>
          </div>
        )}
        {error && <p className="error-message" role="alert">{error}</p>}
        <VideoLibrary refreshKey={libraryRefreshKey} busy={isCritiquing || savingVideos > 0} onCritiquesDeleted={() => { setDanceCritique(null); setSavedBaseline(null); setCritiqueCacheHit(false); baselineLookupId.current += 1; setIsLookingUpBaseline(false); }} />
      </section>}

        {activePage === "coaching" && <section className="workspace coaching-workspace" id="studio"><div className="coaching-heading"><div className="eyebrow muted">COACHING</div><h1>{profile === "student" ? "Your coaching space." : "Guide every next step."}</h1><p>{profile === "student" ? "The current studio in the header filters the sessions you can review." : "The current studio in the header determines which students and sessions are shown."}</p></div><SessionPanel key={`${profile}-${activeCompanyId || "none"}`} role={profile} companyId={activeCompanyId || null} onRoleChange={setProfile} onSessionChange={(session) => setActiveSessionId(session?.id ?? null)} /><div id="coaching"><TeacherFeedbackPanel sessionId={activeSessionId} role={profile} /></div></section>}
      {activePage === "profile" && <ProfilePage required={profileRequired} teacherCompanies={teacherCompanies} onDefaultStudio={async (companyId) => { const response = await fetch("/api/teacher-companies", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ companyId }) }); if (response.ok) { setTeacherCompanies((current) => current.map((company) => ({ ...company, isDefault: company.id === companyId }))); setActiveTeacherCompanyId(companyId); } }} onComplete={() => { setProfileRequired(false); }} />}

      <footer><a className="brand footer-brand" href="#top"><span className="brand-mark">o.</span><span>one</span></a><span>Practice with curiosity. {"\u2733"}</span><span>Clips are sent to Gemini only when you choose its critique action.</span></footer>
    </main>
  );
}

function CritiqueCard({ critique, currentTime, onSeek, title }: { critique: DanceCritique; currentTime: number; onSeek: (time: number, target?: "earlier" | "new" | "both") => void; title?: string }) {
  return <aside className="critique-card">
    <div className="report-top"><div><div className="eyebrow muted">{title || "GEMINI VIDEO CRITIQUE"}</div><h3>Notes for your<br/><em>next practice.</em></h3></div><span className="sample-tag">AI FEEDBACK</span></div>
    <p className="critique-summary">{critique.comparison || critique.summary}</p>
    <div className="moments-heading"><h4>Moments to review</h4><span>{critique.observations.length} NOTES</span></div>
    <div className="feedback-list">{critique.observations.map((item, index) => <button key={`${item.timestampSeconds ?? "general"}-${item.area}-${index}`} className={`feedback-item ${item.timestampSeconds !== null && currentTime >= item.timestampSeconds && currentTime < item.timestampSeconds + 3 ? "current" : ""}`} onClick={() => { if (item.timestampSeconds !== null) onSeek(item.timestampSeconds, item.video === "new" ? "new" : item.video === "both" ? "both" : "earlier"); }} disabled={item.timestampSeconds === null}><span className="feedback-dot focus"/><span className="feedback-content"><span className="feedback-meta"><strong>{item.video ? `${item.video.toUpperCase()} \u00b7 ` : ""}{item.area}</strong><time>{item.timestampSeconds !== null ? `${formatTime(item.timestampSeconds)} \u2197` : "General note"}</time></span><span className="feedback-text"><strong>Observed: </strong>{item.observation}</span><span className="feedback-text"><strong>Try: </strong>{item.suggestedAdjustment}</span>{item.exercise && <span className="feedback-text"><strong>Exercise: </strong>{item.exercise}</span>}<span className={`confidence confidence-${item.confidence}`}>{item.confidence} confidence</span></span></button>)}</div>
    {critique.limitations.length > 0 && <div className="critique-limitations"><strong>Hard to assess from this clip</strong><ul>{critique.limitations.map((limitation, index) => <li key={index}>{limitation}</li>)}</ul></div>}
    <p className="report-footnote">AI-generated coaching suggestions. Review each note against the video and your dance style.</p>
  </aside>;
}
