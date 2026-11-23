"use client";

import type { DanceCritique, ProgressStatus } from "../lib/gemini-critique";
import { DANCE_SCORE_CATEGORIES, totalDanceScore } from "../lib/gemini-critique";

function formatTime(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}

const progressLabels: Record<ProgressStatus, { label: string; path: string }> = {
  improved: { label: "Improved", path: "M3 17l6-6 4 4 8-10M15 5h6v6" },
  keep_practising: { label: "Keep practising", path: "M20 7v5h-5M4 17v-5h5M5.5 7a7 7 0 0 1 12-2L20 8M4 16l2.5 3a7 7 0 0 0 12-2" },
  new: { label: "NEW", path: "M12 5v14M5 12h14" },
  unassessable: { label: "Unable to assess", path: "M9 8a3 3 0 0 1 6 0c0 2-3 2-3 5M12 17h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0" },
};

const scoreCategories = Object.keys(DANCE_SCORE_CATEGORIES) as Array<keyof typeof DANCE_SCORE_CATEGORIES>;

export function CritiqueCard({ critique, currentTime, onSeek, title, videoName }: { critique: DanceCritique; currentTime: number; onSeek: (time: number, target?: "earlier" | "new" | "both") => void; title?: string; videoName?: string }) {
  const comparison = critique.comparison !== undefined;
  const legacyProgress = comparison && critique.observations.some((note) => !note.progressStatus);
  const scores = critique.scores;
  const total = scores ? totalDanceScore(scores) : null;
  return <aside className="critique-card">
    <div className="report-top"><div><div className="eyebrow muted">{title || "AI VIDEO CRITIQUE"}</div><h3>Notes for your<br/><em>next practice.</em></h3></div><span className="sample-tag">AI FEEDBACK</span></div>
    {scores && <dl className="critique-scores" aria-label={comparison ? "AI scores for the newer take" : "AI scores"}>
      <div className="critique-score-total">
        <dt>Total score</dt>
        <dd>{total === null ? "Not assessable" : `${total} / 100`}</dd>
      </div>
      {scoreCategories.map((key) => {
        const { label, maximum } = DANCE_SCORE_CATEGORIES[key];
        return <div key={key}>
          <dt>{label}</dt>
          <dd>{scores[key] === null ? "Not assessable" : `${scores[key]} / ${maximum}`}</dd>
        </div>;
      })}
    </dl>}
    {videoName && <p className="critique-video-name">Feedback for <strong>{videoName}</strong></p>}
    {critique.subject && <p className="critique-video-name"><strong>Dancer focus:</strong> {critique.subject.description}</p>}
    <p className="critique-summary">{critique.comparison || critique.summary}</p>
    {legacyProgress && <p className="progress-legacy-notice">This saved comparison predates progress labels. Its notes have not been classified as improved, ongoing, or new.</p>}
    <div className="moments-heading"><h4>Moments to review</h4><span>{critique.observations.length} NOTES</span></div>
    <div className="feedback-list">{critique.observations.map((item, index) => {
      const status = item.progressStatus ? progressLabels[item.progressStatus] : null;
      return <button key={`${item.timestampSeconds ?? "general"}-${item.area}-${index}`} className={`feedback-item ${item.timestampSeconds !== null && currentTime >= item.timestampSeconds && currentTime < item.timestampSeconds + 3 ? "current" : ""}`} onClick={() => { if (item.timestampSeconds !== null) onSeek(item.timestampSeconds, item.video === "new" ? "new" : item.video === "both" ? "both" : "earlier"); }} disabled={item.timestampSeconds === null}>
        <span className="feedback-dot focus"/>
        <span className="feedback-content">
          <span className="feedback-meta"><strong>{item.area}</strong><time>{item.timestampSeconds !== null ? `${formatTime(item.timestampSeconds)} \u2197` : "General note"}</time></span>
          {status && <span className={`progress-badge progress-${item.progressStatus}`}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={status.path}/></svg>{status.label}</span>}
          {item.baselineObservationIndex != null && <span className="feedback-text">Revisits original note {item.baselineObservationIndex}</span>}
          {item.progressReason && <span className="feedback-text progress-reason"><strong>{item.progressStatus === "new" ? "New focus: " : "Progress: "}</strong>{item.progressReason}</span>}
          <span className="feedback-text"><strong>Observed: </strong>{item.observation}</span>
          <span className="feedback-text"><strong>Try: </strong>{item.suggestedAdjustment}</span>
          {item.exercise && <span className="feedback-text"><strong>Exercise: </strong>{item.exercise}</span>}
          <span className={`confidence confidence-${item.confidence}`}>{item.confidence} confidence</span>
        </span>
      </button>;
    })}</div>
    {critique.limitations.length > 0 && <div className="critique-limitations"><strong>Hard to assess from this clip</strong><ul>{critique.limitations.map((limitation, index) => <li key={index}>{limitation}</li>)}</ul></div>}
    <p className="report-footnote">AI-generated coaching suggestions. Review each note against the video and your dance style.</p>
  </aside>;
}
