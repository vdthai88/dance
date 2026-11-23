"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent, DragEvent } from "react";
import { alignClipsByAudio } from "./lib/clip-alignment";
import { isDanceCritique } from "./lib/gemini-critique";
import { readApiJson } from "./lib/api-response";
import { checkVideoPlayback } from "./lib/video-playback-check";
import { AccountMenu } from "./components/account-menu";
import { TeacherFeedbackPanel } from "./components/teacher-feedback-panel";
import { SessionPanel } from "./components/session-panel";
import { ProfilePage } from "./components/profile-page";
import { VideoLibrary } from "./components/video-library";
import { ReplaiName } from "./components/replai-name";
import type { LibraryUploadResult, LibraryVideo } from "./lib/video-library-types";
import { DancerSelectionPanel } from "./components/dancer-selection-panel";
import { isDancerDetection } from "./lib/dancer-selection";
import type { DancerChoiceRequest } from "./lib/dancer-selection";

function formatPreciseTime(seconds: number) {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const remaining = (safe % 60).toFixed(1).padStart(4, "0");
  return `${minutes}:${remaining}`;
}

type TeacherCompany = { id: string; name: string; type: "studio" | "private_company" | "other"; isDefault?: boolean };

export default function Home() {
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [comparisonFile, setComparisonFile] = useState<File | null>(null);
  const [earlierSongStart, setEarlierSongStart] = useState(0);
  const [newerSongStart, setNewerSongStart] = useState(0);
  const [alignmentSource, setAlignmentSource] = useState<"auto" | "manual" | null>(null);
  const [alignmentFailed, setAlignmentFailed] = useState(false);
  const [isAutoAligning, setIsAutoAligning] = useState(false);
  const [autoAlignProgress, setAutoAlignProgress] = useState(0);
  const [alignmentMessage, setAlignmentMessage] = useState("");
  const [profile, setProfile] = useState<"student" | "teacher">("student");
  const [profileRequired, setProfileRequired] = useState(false);
  const [activePage, setActivePage] = useState<"replai" | "coaching" | "profile">("replai");
  const [hasProfileActions, setHasProfileActions] = useState(false);
  const [teacherCompanies, setTeacherCompanies] = useState<TeacherCompany[]>([]);
  const [activeTeacherCompanyId, setActiveTeacherCompanyId] = useState("");
  const [studentCompanies, setStudentCompanies] = useState<TeacherCompany[]>([]);
  const [companyListRevision, setCompanyListRevision] = useState(0);
  const [activeStudentCompanyId, setActiveStudentCompanyId] = useState("");
  const [routeReady, setRouteReady] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [isCritiquing, setIsCritiquing] = useState(false);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [libraryRefreshKey, setLibraryRefreshKey] = useState(0);
  const [savingVideos, setSavingVideos] = useState(0);
  const [videoSaveError, setVideoSaveError] = useState("");
  const [uploadNotice, setUploadNotice] = useState("");
  const [uploadCheckMessage, setUploadCheckMessage] = useState("");
  const [autoCritiquePending, setAutoCritiquePending] = useState(false);
  const [focusedLibraryVideoId, setFocusedLibraryVideoId] = useState<string | null>(null);
  const [activeLibraryVideoId, setActiveLibraryVideoId] = useState<string | null>(null);
  const [dancerChoices, setDancerChoices] = useState<Array<DancerChoiceRequest & { videoId: string; filename: string }>>([]);
  const [forceDancerChoice, setForceDancerChoice] = useState(false);
  const savedVideoIds = useRef(new WeakMap<File, string>());
  const critiqueRequestId = useRef(0);
  const critiqueRequest = useRef<AbortController | null>(null);
  const alignmentRequestId = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);

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
  }, [activePage, companyListRevision]);

  useEffect(() => {
    let active = true;
    void fetch("/api/user-companies", { cache: "no-store" }).then(async (response) => {
      const companies = await response.json() as TeacherCompany[];
      if (!response.ok || !active) return;
      setStudentCompanies(companies);
      setActiveStudentCompanyId((current) => current && companies.some((company) => company.id === current) ? current : companies[0]?.id ?? "");
    }).catch(() => { if (active) setStudentCompanies([]); });
    return () => { active = false; };
  }, [activePage, companyListRevision]);

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

  async function saveVideoToLibrary(file: File, groupId?: string | null, earlierVideoId?: string) {
    const selectionId = critiqueRequestId.current;
    setSavingVideos((current) => current + 1);
    setVideoSaveError("");
    try {
      await checkVideoPlayback(file);
      if (selectionId !== critiqueRequestId.current) return;
      const form = new FormData();
      form.set("video", file, file.name);
      if (earlierVideoId) form.set("earlierVideoId", earlierVideoId);
      else if (groupId) form.set("groupId", groupId);
      const response = await fetch("/api/replai-videos", { method: "POST", body: form });
      const saved = await readApiJson(response, "Save video") as LibraryUploadResult;
      if (!saved?.id) throw new Error("The server did not confirm the saved video. Choose it again to retry.");
      savedVideoIds.current.set(file, saved.id);
      if (!saved.alreadyExists) {
        setLibraryRefreshKey((current) => current + 1);
        if (selectionId === critiqueRequestId.current) {
          setActiveLibraryVideoId(saved.id);
          setFocusedLibraryVideoId(saved.id);
        }
      }
      return saved;
    } catch (caught) {
      setVideoSaveError(`“${file.name}” was not saved: ${caught instanceof Error ? caught.message : "Please choose the file again to retry."}`);
    } finally { setSavingVideos((current) => current - 1); }
  }

  function cancelCurrentCritique() {
    setDancerChoices([]); setForceDancerChoice(false);
    setActiveLibraryVideoId(null);
    critiqueRequestId.current += 1;
    critiqueRequest.current?.abort();
    setIsCritiquing(false);
    alignmentRequestId.current += 1;
    setIsAutoAligning(false);
    setAlignmentSource(null);
    setAlignmentFailed(false);
  }

  function reportDuplicateUpload(saved: LibraryUploadResult) {
    cancelCurrentCritique();
    setAutoCritiquePending(false);
    setVideoFile(null); setComparisonFile(null);
    setError(""); setUploadNotice("");
    setUploadCheckMessage(saved.existingGroupName
      ? `This video was previously uploaded to "${saved.existingGroupName}". It has not been moved.`
      : "This video was previously uploaded to your library. It has not been moved.");
  }

  function chooseFile(file?: File, groupId?: string) {
    if (!file) return;
    setError("");
    if (!file.type.startsWith("video/")) { setError("Choose a video file to continue."); return; }
    if (file.size > 250 * 1024 * 1024) { setError("This preview supports videos up to 250 MB."); return; }
    cancelCurrentCritique();
    const selectionId = critiqueRequestId.current;
    setUploadNotice("");
    setAutoCritiquePending(false);
    setComparisonFile(null); setNewerSongStart(0);
    setVideoFile(file);
    void saveVideoToLibrary(file, groupId).then((saved) => {
      if (!saved || selectionId !== critiqueRequestId.current) return;
      if (saved.alreadyExists) {
        reportDuplicateUpload(saved);
      } else {
        setAutoCritiquePending(true);
      }
    });
    setEarlierSongStart(0);
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) { chooseFile(event.target.files?.[0]); event.currentTarget.value = ""; }

  function chooseComparison(file?: File, groupId?: string | null, earlierVideoId?: string) {
    if (!file) return;
    setError("");
    if (!file.type.startsWith("video/")) { setError("Choose a video file for the newer take."); return; }
    if (file.size > 250 * 1024 * 1024) { setError("This preview supports videos up to 250 MB per clip."); return; }
    cancelCurrentCritique();
    setUploadNotice("");
    const selectionId = critiqueRequestId.current;
    setAutoCritiquePending(true);
    setComparisonFile(file); setNewerSongStart(0);
    void saveVideoToLibrary(file, groupId, earlierVideoId).then((saved) => {
      if (saved?.alreadyExists && selectionId === critiqueRequestId.current) reportDuplicateUpload(saved);
    });
  }

  async function startLibraryComparison(video: LibraryVideo, newerFile: File) {
    if (!newerFile.type.startsWith("video/")) throw new Error("Choose a video file for the newer take.");
    if (newerFile.size + video.byteSize > 250 * 1024 * 1024) throw new Error("The two takes must total 250 MB or less.");
    cancelCurrentCritique();
    const selectionId = critiqueRequestId.current;
    const response = await fetch(`/api/replai-videos/${encodeURIComponent(video.id)}/content`, { cache: "no-store" });
    if (!response.ok) throw new Error("The saved earlier take could not be loaded. Upload it again to compare.");
    const blob = await response.blob();
    if (selectionId !== critiqueRequestId.current) return;
    const earlierFile = new File([blob], video.filename, { type: video.contentType || blob.type || "video/mp4" });
    savedVideoIds.current.set(earlierFile, video.id);
    setVideoFile(earlierFile);
    setEarlierSongStart(0);
    setVideoSaveError("");
    chooseComparison(newerFile, video.groupId, video.id);
  }


  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault(); setDragging(false); chooseFile(event.dataTransfer.files[0]);
  }

  async function reviewLibraryVideo(video: LibraryVideo, chooseDancer: boolean) {
    cancelCurrentCritique();
    const selectionId = critiqueRequestId.current;
    const response = await fetch(`/api/replai-videos/${encodeURIComponent(video.id)}/content`, { cache: "no-store" });
    if (!response.ok) throw new Error("This saved video could not be opened.");
    const blob = await response.blob();
    if (selectionId !== critiqueRequestId.current) return;
    const file = new File([blob], video.filename, { type: video.contentType || blob.type || "video/mp4" });
    savedVideoIds.current.set(file, video.id);
    setVideoFile(file); setComparisonFile(null); setForceDancerChoice(chooseDancer);
    setActiveLibraryVideoId(video.id); setFocusedLibraryVideoId(video.id);
    setLibraryRefreshKey((current) => current + 1);
    setError(""); setVideoSaveError(""); setUploadNotice(""); setAutoCritiquePending(true);
  }

  const requestAiCritique = useCallback(async () => {
    if (!videoFile) return;
    if (dancerChoices.length) return;
    if (savingVideos > 0) return;
    if (comparisonFile && (!alignmentSource || isAutoAligning)) {
      setError("Confirm the song start times below before sending this comparison to AI.");
      return;
    }
    if (!savedVideoIds.current.get(videoFile) || (comparisonFile && !savedVideoIds.current.get(comparisonFile))) {
      setError("Save both selected videos before requesting AI feedback. Choose the failed upload again to retry.");
      return;
    }
    const requestId = ++critiqueRequestId.current;
    critiqueRequest.current?.abort();
    const controller = new AbortController();
    critiqueRequest.current = controller;
    setIsCritiquing(true);
    setError("");
    try {
      const form = new FormData();
      form.set("video", videoFile, videoFile.name);
      if (forceDancerChoice) form.set("chooseDancer", "1");
      if (comparisonFile) form.set("comparisonVideo", comparisonFile, comparisonFile.name);
      if (comparisonFile) {
        form.set("earlierSongStart", String(earlierSongStart));
        form.set("newerSongStart", String(newerSongStart));
        form.set("alignmentSource", alignmentSource!);
      }
      const response = await fetch("/api/dance-critique", { method: "POST", body: form, signal: controller.signal });
      const result = await readApiJson(response, "Video critique");
      if (requestId !== critiqueRequestId.current) return;
      if (response.status === 202) {
        const data = result as { needsDancerSelection?: boolean; choices?: DancerChoiceRequest[] };
        if (!data.needsDancerSelection || !Array.isArray(data.choices) || !data.choices.length || !data.choices.every((choice) => ["earlier", "newer"].includes(choice.take) && isDancerDetection(choice.detection))) throw new Error("AI returned an invalid dancer selection. Please retry.");
        const choices = data.choices.map((choice) => {
          const file = choice.take === "newer" ? comparisonFile : videoFile;
          const videoId = file ? savedVideoIds.current.get(file) : null;
          if (!file || !videoId) throw new Error("Save this video before choosing its dancer.");
          return { ...choice, videoId, filename: file.name };
        });
        setDancerChoices(choices); setForceDancerChoice(false); setAutoCritiquePending(false);
        return;
      }
      if (!isDanceCritique(result)) throw new Error("The server returned an invalid critique. Check Render Logs for this request, then retry.");
      if (requestId !== critiqueRequestId.current) return;
      setFocusedLibraryVideoId(savedVideoIds.current.get(comparisonFile ?? videoFile) ?? null);
      setActiveLibraryVideoId(null);
      setLibraryRefreshKey((current) => current + 1);
      alignmentRequestId.current += 1;
      setIsAutoAligning(false);
      setVideoFile(null);
      setComparisonFile(null);
      setEarlierSongStart(0); setNewerSongStart(0); setAlignmentMessage("");
      setAutoCritiquePending(false);
    } catch (caught) {
      if (controller.signal.aborted || requestId !== critiqueRequestId.current) return;
      setError(caught instanceof TypeError && caught.message.toLowerCase().includes("fetch")
        ? "The connection to the dance app was interrupted. Check the VS Code terminal for a server timeout or restart, then retry."
        : caught instanceof Error ? caught.message : "AI could not critique this video.");
    } finally {
      if (requestId === critiqueRequestId.current) setIsCritiquing(false);
    }
  }, [videoFile, comparisonFile, earlierSongStart, newerSongStart, savingVideos, alignmentSource, isAutoAligning, dancerChoices, forceDancerChoice]);

  useEffect(() => {
    if (!autoCritiquePending || !videoFile || savingVideos > 0 || videoSaveError || isAutoAligning || isCritiquing) return;
    if (dancerChoices.length) return;
    if (comparisonFile && !alignmentSource) return;
    const timer = window.setTimeout(() => {
      setAutoCritiquePending(false);
      void requestAiCritique();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [autoCritiquePending, videoFile, savingVideos, videoSaveError, isAutoAligning, isCritiquing, requestAiCritique, comparisonFile, alignmentSource, dancerChoices]);

  useEffect(() => () => { critiqueRequest.current?.abort(); }, []);

  const autoAlignMusic = useCallback(async () => {
    if (!videoFile || !comparisonFile) return;
    const alignmentId = ++alignmentRequestId.current;
    setIsAutoAligning(true);
    setAlignmentSource(null); setAlignmentFailed(false);
    setAutoAlignProgress(0);
    setAlignmentMessage("Matching the song automatically in the first 25 seconds…");
    try {
      const match = await alignClipsByAudio(videoFile, comparisonFile, (progress) => { if (alignmentId === alignmentRequestId.current) setAutoAlignProgress(progress); });
      if (alignmentId !== alignmentRequestId.current) return;
      setEarlierSongStart(match.earlierSeconds);
      setNewerSongStart(match.newerSeconds);
      setAlignmentSource("auto");
      setAutoAlignProgress(1);
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
      if (alignmentId !== alignmentRequestId.current) return;
      setAlignmentSource(null); setAlignmentFailed(true); setAutoCritiquePending(false);
      setAlignmentMessage(caught instanceof Error ? caught.message : "Could not detect the song starts. Set them manually instead.");
    } finally {
      if (alignmentId === alignmentRequestId.current) setIsAutoAligning(false);
    }
  }, [videoFile, comparisonFile]);

  useEffect(() => {
    if (!videoFile || !comparisonFile) return;
    const timeout = window.setTimeout(() => { void autoAlignMusic(); }, 0);
    return () => window.clearTimeout(timeout);
  }, [videoFile, comparisonFile, autoAlignMusic]);

  const activeCompanies = profile === "teacher" ? teacherCompanies : studentCompanies;
  const activeCompanyId = profile === "teacher" ? activeTeacherCompanyId : activeStudentCompanyId;
  const headerCompanies = activePage === "coaching" ? activeCompanies
    : [...new Map([...studentCompanies, ...teacherCompanies].map((company) => [company.id, company])).values()];
  const headerCompany = headerCompanies.find((company) => company.id === activeCompanyId)
    ?? headerCompanies.find((company) => company.id === activeTeacherCompanyId || company.id === activeStudentCompanyId)
    ?? headerCompanies[0];
  const aiFeedbackBusy = isCritiquing || savingVideos > 0 || isAutoAligning || (autoCritiquePending && !videoSaveError && (!comparisonFile || Boolean(alignmentSource)));
  const uploadModalMessage = uploadCheckMessage || videoSaveError;

  function changeActiveCompany(companyId: string) {
    if (activePage === "coaching") {
      if (profile === "teacher") setActiveTeacherCompanyId(companyId);
      else setActiveStudentCompanyId(companyId);
    } else {
      const canTeach = teacherCompanies.some((company) => company.id === companyId);
      const canStudy = studentCompanies.some((company) => company.id === companyId);
      if (canTeach) setActiveTeacherCompanyId(companyId);
      if (canStudy) setActiveStudentCompanyId(companyId);
      if (canTeach && !canStudy) setProfile("teacher");
      else if (canStudy && !canTeach) setProfile("student");
    }
    setActiveSessionId(null);
  }

  const pendingReviewContent = activeLibraryVideoId && videoFile ? <div className="insights-column">
    {dancerChoices.map((choice) => <DancerSelectionPanel key={choice.take + choice.videoId} videoId={choice.videoId} title={(comparisonFile ? (choice.take === "earlier" ? "Earlier: " : "Newer: ") : "") + choice.filename} detection={choice.detection} onChosen={() => { setDancerChoices((current) => current.filter((item) => item.take !== choice.take)); setAutoCritiquePending(true); }} />)}
    {!dancerChoices.length && comparisonFile && <div className="comparison-alignment-controls">
                <p className={alignmentFailed ? "error-message" : "critique-cache-notice"} role="status">{isAutoAligning ? `Matching audio: ${Math.round(autoAlignProgress * 100)}%` : alignmentFailed ? `Comparison paused. ${alignmentMessage}` : alignmentMessage}</p>
                <p>Song starts in seconds. If audio cannot be read here, check the clips in an external browser and enter their start times.</p>
                <div className="comparison-start-fields">
                  <label>Earlier: {videoFile?.name}<input type="number" min="0" step="0.01" value={Number.isFinite(earlierSongStart) ? earlierSongStart : ""} disabled={isAutoAligning || isCritiquing} onChange={(event) => { setEarlierSongStart(event.currentTarget.valueAsNumber); setAlignmentSource(null); setAutoCritiquePending(false); }} /></label>
                  <label>Newer: {comparisonFile.name}<input type="number" min="0" step="0.01" value={Number.isFinite(newerSongStart) ? newerSongStart : ""} disabled={isAutoAligning || isCritiquing} onChange={(event) => { setNewerSongStart(event.currentTarget.valueAsNumber); setAlignmentSource(null); setAutoCritiquePending(false); }} /></label>
                </div>
                <button className="toggle-button" type="button" disabled={isAutoAligning || isCritiquing || savingVideos > 0 || !Number.isFinite(earlierSongStart) || earlierSongStart < 0 || !Number.isFinite(newerSongStart) || newerSongStart < 0} onClick={() => { setAlignmentSource("manual"); setAlignmentFailed(false); setAutoCritiquePending(true); setError(""); }}>Use these start times and compare</button>
                <button className="text-button" type="button" disabled={isAutoAligning || isCritiquing || savingVideos > 0} onClick={() => { setAutoCritiquePending(true); void autoAlignMusic(); }}>Retry audio alignment</button>
              </div>}
    {!dancerChoices.length && <aside className="aside-card ai-feedback-status" aria-busy={aiFeedbackBusy}>
                <div className="eyebrow muted">AI FEEDBACK</div>
                <div role="status" aria-live="polite">
                  <h3>{isCritiquing ? "AI is reviewing your video" : savingVideos > 0 ? "Uploading your video" : aiFeedbackBusy ? "Preparing your AI feedback" : comparisonFile && !alignmentSource ? "Confirm song starts" : "Your next take starts here."}</h3>
                  {aiFeedbackBusy && <div className="ai-feedback-spinner" aria-hidden="true" />}
                  <p>{isCritiquing ? "Analyzing your video. Your feedback will appear here when it is ready." : savingVideos > 0 ? "Your AI critique will start automatically once the upload finishes." : isAutoAligning ? "Matching the audio before comparing your videos." : aiFeedbackBusy ? "Checking for saved feedback and preparing your critique." : comparisonFile && !alignmentSource ? "The comparison is paused. Enter and confirm both song starts beside the video before continuing." : videoSaveError ? "Your video could not be saved. Choose it again to retry the upload." : "You can retry your AI feedback below."}</p>
                </div>
                {!aiFeedbackBusy && (!comparisonFile || alignmentSource) && <button className="button button-dark" type="button" onClick={() => { setAutoCritiquePending(false); void requestAiCritique(); }}>{comparisonFile ? "Retry AI comparison" : "Retry AI critique"}</button>}
              </aside>}
    {error && <p className="error-message" role="alert">{error}</p>}
  </div> : null;

  return (
    <main className="shell app-shell">
      {(savingVideos > 0 || uploadModalMessage) && <div className="upload-check-overlay" role="dialog" aria-modal="true" aria-labelledby="upload-check-title" aria-describedby="upload-check-description">
        <div className="upload-check-modal">
          {uploadModalMessage ? <>
            <div className="upload-check-message-icon" aria-hidden="true">✓</div>
            <h2 id="upload-check-title">Upload notice</h2>
            <p id="upload-check-description">{uploadModalMessage}</p>
            <button className="button button-dark upload-check-ok" type="button" onClick={() => { setUploadCheckMessage(""); setVideoSaveError(""); }}>OK</button>
          </> : <>
          <div className="upload-check-spinner" aria-hidden="true" />
          <h2 id="upload-check-title">Checking your video</h2>
          <p id="upload-check-description">We’re checking playback and saving your video securely. This may take a moment.</p>
          </>}
        </div>
      </div>}
      <aside className="sidebar" aria-label="Main navigation">
        <a className="sidebar-logo" href="#top" aria-label="One home">O</a>
        <nav className="sidebar-nav">
          <button className="sidebar-item active" type="button" title="Replai" onClick={() => { setProfile("student"); document.getElementById("studio")?.scrollIntoView({ behavior: "smooth" }); }}><span>▶</span><b><ReplaiName /></b></button>
          <button className="sidebar-item" type="button" title="Coaching" onClick={() => { setProfile("teacher"); document.getElementById("coaching")?.scrollIntoView({ behavior: "smooth" }); }}><span>✦</span><b>Coaching</b></button>
          <button className="sidebar-item" type="button" title="Profile"><span>◉</span><b>Profile</b></button>
          <button className="sidebar-item" type="button" title="Team"><span>♧</span><b>Team</b></button>
          <button className={`sidebar-item ${activePage === "replai" ? "active" : ""}`} type="button" title="Replai" onClick={() => { if (profileRequired) { setActivePage("profile"); return; } setActivePage("replai"); setProfile("student"); document.getElementById("studio")?.scrollIntoView({ behavior: "smooth" }); }}><span aria-hidden="true">▶</span><b><ReplaiName /></b></button>
          <button className={`sidebar-item ${activePage === "coaching" ? "active" : ""}`} type="button" title="Coaching" onClick={() => { if (profileRequired) { setActivePage("profile"); return; } void openCoaching(); }}><span aria-hidden="true">✦</span><b>Coaching</b></button>
          <button className={`sidebar-item ${activePage === "profile" ? "active" : ""}`} type="button" title={hasProfileActions ? "Profile — actions required" : "Profile"} onClick={() => { setActivePage("profile"); document.getElementById("profile")?.scrollIntoView({ behavior: "smooth" }); }}><span className="sidebar-icon" aria-hidden="true">◉{hasProfileActions && <i className="profile-action-star" aria-label="Actions required">★</i>}</span><b>Profile</b></button>
        </nav>
        <button className="sidebar-item sidebar-settings" type="button" title="Settings"><span>⚙</span><b>Settings</b></button>
      </aside>
      <header className="topbar">
        <a className="brand brand-logo" href="#top" aria-label="One Dance home"><img src="/one_dance_logo.png?v=20261111" alt="One Dance" width={76} height={62} /></a>
        <p className="header-slogan">Every move has a <em>next step.</em></p>
        <div className="header-account-controls">
          {headerCompany && (headerCompanies.length > 1
            ? <select className="header-company" value={headerCompany.id} onChange={(event) => changeActiveCompany(event.target.value)} aria-label="Current company" title={headerCompany.name}>
                {headerCompanies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
              </select>
            : <span className="header-company" title={headerCompany.name}>{headerCompany.name}</span>)}
          <AccountMenu />
        </div>
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

        <section className="replai-intro">
          <div className="replai-intro-heading">
            <h1>Replai your moments.</h1>
            <p className="replai-tagline">Small steps add up.</p>
          </div>
          <div className="replai-steps">
            <article>
              <span>01</span>
              <h2>Upload a practice video</h2>
              <p>Choose a video from your device and confirm which dancer you want Replai to focus on.</p>
            </article>
            <article>
              <span>02</span>
              <h2>Review your AI feedback</h2>
              <p>Jump to specific moments in your video to see what worked and what to try next.</p>
            </article>
            <article>
              <span>03</span>
              <h2>Try again and compare</h2>
              <p>Pick one thing to work on, then add a newer take to see what’s changed.</p>
            </article>
          </div>
        </section>

        <VideoLibrary refreshKey={libraryRefreshKey} focusVideoId={focusedLibraryVideoId} onCompare={startLibraryComparison} onUpload={chooseFile} onReview={reviewLibraryVideo} pendingReview={activeLibraryVideoId && pendingReviewContent ? { videoId: activeLibraryVideoId, content: pendingReviewContent } : null} busy={isCritiquing || savingVideos > 0 || (autoCritiquePending && !videoSaveError)}>
        <p className="video-save-status" role="status">{savingVideos > 0 ? `Checking playback and saving ${savingVideos === 1 ? "your video" : "your videos"} to your library...` : "Uploaded videos are saved privately and automatically sent for AI feedback."}</p>
        {videoSaveError && <p className="error-message" role="alert">{videoSaveError}</p>}
        {uploadNotice && <p className="video-library-message" role="status">{uploadNotice}</p>}
          <div className={`upload-card ${dragging ? "dragging" : ""}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop}>
            <input ref={fileInput} className="visually-hidden" type="file" accept="video/*" onChange={onFileChange} aria-label="Choose a dance video" />
            <div className="upload-icon"><span>{"\u2191"}</span></div><h3>Drop your video here</h3><p>or find a take you love</p>
            <button className="button button-dark" onClick={() => fileInput.current?.click()}>Choose a video <span>{"\u2197"}</span></button>
            <div className="file-meta">MP4, MOV or WebM <span>{"\u00b7"}</span> Up to 250 MB <span>{"\u00b7"}</span> 3 minutes for analysis</div>
          </div>
        {error && !activeLibraryVideoId && <p className="error-message" role="alert">{error}</p>}
        </VideoLibrary>
      </section>}

        {activePage === "coaching" && <section className="workspace coaching-workspace" id="studio"><div className="coaching-heading"><div className="eyebrow muted">COACHING</div><h1>{profile === "student" ? "Your coaching space." : "Guide every next step."}</h1><p>{profile === "student" ? "The current studio in the header filters the sessions you can review." : "The current studio in the header determines which students and sessions are shown."}</p></div><SessionPanel key={`${profile}-${activeCompanyId || "none"}`} role={profile} companyId={activeCompanyId || null} onRoleChange={setProfile} onSessionChange={(session) => setActiveSessionId(session?.id ?? null)} /><div id="coaching"><TeacherFeedbackPanel sessionId={activeSessionId} role={profile} /></div></section>}
      {activePage === "profile" && <ProfilePage required={profileRequired} teacherCompanies={teacherCompanies} onCompaniesChanged={() => setCompanyListRevision((revision) => revision + 1)} onDefaultStudio={async (companyId) => { const response = await fetch("/api/teacher-companies", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ companyId }) }); if (response.ok) { setTeacherCompanies((current) => current.map((company) => ({ ...company, isDefault: company.id === companyId }))); setActiveTeacherCompanyId(companyId); } }} onComplete={() => { setProfileRequired(false); }} />}

      <footer><a className="brand footer-brand" href="#top"><span className="brand-mark">o.</span><span>one</span></a><span>Practice with curiosity. {"\u2733"}</span><span><ReplaiName /> uploads are automatically sent for AI feedback.</span></footer>
    </main>
  );
}
