# One Dance Practice

A web prototype for reviewing solo dance practice videos.

## Run locally

1. Install Node.js 22.13 or newer (the app uses Node's built-in SQLite module).
2. From this folder, run `npm install`.
3. Run `npm run dev` and open <http://localhost:3000>.

## Sign in

The app now uses local email-and-password accounts. On first visit, create an account at `/sign-up`; the main practice page requires a signed-in session and has a **Sign out** control in its header. Better Auth stores its `user`, `account`, `session`, and `verification` tables in the existing `data/dance.sqlite` file.

For a new machine, copy `.env.example` to `.env.local`, set a unique `BETTER_AUTH_SECRET`, then restart the development server. The generated local secret must stay private and must never be committed.

## Social sign-in

Email/password remains available. Google, Apple, and Facebook/Meta sign-in are also supported when configured. Add a provider's client ID and secret to `.env.local` (or to your cloud host's secret settings); its button appears only when both values are present. Each provider must allow this callback URL:

```
https://your-domain.example/api/auth/callback/google
https://your-domain.example/api/auth/callback/apple
https://your-domain.example/api/auth/callback/facebook
```

For local testing, use your temporary HTTPS tunnel URL rather than a LAN IP, because social providers require a publicly reachable HTTPS callback. A new social account created from the sign-in page defaults to Student; the Create Account page lets the person explicitly start as Student or Teacher. Existing accounts are linked only when the provider verifies the same email address. Instagram Login is not included as a normal account-login option: Meta positions it for Instagram professional-account API access rather than general consumer sign-in.

## Access model

- `user` is the single sign-in identity. A person can hold multiple records in `user_roles` (`student`, `teacher`, or `admin`).
- `students` and `teacher_profiles` are optional role-specific profiles linked to a user when that person has an account.
- `student_teacher_assignments` explicitly gives a teacher `view` or `manage` access to a student.
- `student_company_assignments` associates students with a company independently of an individual teacher.
- `company_memberships` connects people to companies as `owner`, `admin`, `teacher`, or `staff`. Company owners/admins can see company-assigned students and the company team; teachers see only their explicitly assigned students.

## Current prototype

- Select or drag a video into the page. The selected video is previewed locally in the browser and is not uploaded to a server.
- ReplAI automatically requests an instructor-style **AI critique** after a video finishes uploading. Adding a newer take automatically requests an AI comparison after audio matching finishes. A failed analysis can be retried with **Retry AI critique** or **Retry AI comparison**. The prompt currently lives in `app/lib/gemini-critique.ts`.
- The critique uses 5 FPS sampling and returns timestamped observations, suggested adjustments, exercises, confidence, and limitations as structured JSON.
- Run MediaPipe Pose Landmarker in the browser, sampling about 3 frames per second for videos up to 3 minutes.
- Display sampled body landmarks over the video, seek to moments selected from those measurements, and open synchronized side-by-side playback.
- Estimate elbow extension, torso angle, pose detection coverage, movement amount and smoothness from the sampled landmarks.
- Estimate music tempo and beat alignment from the audio playing through the browser's Web Audio API. This estimate is approximate and may be unavailable for quiet, speech-only or unclear audio.
- When a second take is selected, automatically search the first 25 seconds of both clips for matching audio and set their song-start markers. Failed alignment pauses the comparison instead of sending zero-default markers to AI. Enter both starts in seconds and select **Use these start times and compare**, or choose **Retry audio alignment**. Confirmed automatic/manual alignment is required by the API. A cached comparison is reused only when its saved markers match the request, so correcting the times generates fresh feedback. Saved reviews show their video filenames and comparison start times. If the VS Code browser cannot read audio, use an external browser or confirm the starts manually.
- Store AI critiques in the configured database. SHA-256 fingerprints and the account ID identify saved feedback; identical uploads in separate accounts never reuse each other's critiques. Comparison critiques use the account and ordered pair of video fingerprints. Videos are saved in the configured local/R2 storage driver.
- A silence pause found in only one clip now falls back to audio cross-correlation instead of stopping immediately. The fallback retains the minimum similarity and confidence-margin checks; weak or ambiguous audio still requires manual starts.
- Regular uploads no longer make a separate saved-critique lookup request. If that account already has the exact file fingerprint, the app reports the existing group's name without moving the video, changing its name/date, or starting another AI request. This also applies when uploading into another group or choosing **Add newer take**. Different bytes (even with the same filename) or another account are treated separately. Restoring a deleted video can start analysis again. Comparison uploads still load the original critique and send it to AI with mapped timestamps.
- Switch between Student and Teacher prototype profiles. Teachers can create local student profiles and dated practice sessions with a location. A session can have teacher feedback even without a video; videos and their Gemini critiques can also be attached to that session. The microphone recording is sent to Gemini for a structured summary and action items, and only the summary is stored in SQLite. Video bytes are not stored by this feature; the session stores video filename and SHA-256 fingerprint. Student and Teacher remain demo roles within the signed-in prototype account for now.
- The Teacher mode can associate its local teacher profile with a company and type it as a dance studio, private company, or other organization. This is stored in SQLite and is not an authenticated account or access-control boundary.
- Student profiles can optionally belong to the Teacher profile's company. Teacher mode lists company-associated students and unassigned AI-only profiles; leaving the company blank keeps a student unassociated for independent AI use.
- The local Teacher profile also stores a Company owner flag. This is profile metadata only; permissions must be enforced after authentication and company-owner portal access are implemented.

## Configure AI feedback

1. Copy `.env.example` to `.env.local` in this `dance` folder.
2. Add your Gemini API key to `GEMINI_API_KEY` in `.env.local`. Keep the key private; the browser never receives it.
3. Restart `npm run dev` after changing `.env.local`.

Uploading a ReplAI video automatically starts AI processing after the private library copy is saved. A matching saved critique from the same account is reused; otherwise the configured AI provider analyzes the video. The current provider is Gemini, configured through `GEMINI_API_KEY` and `GEMINI_MODEL`. User-facing labels say **AI** so they do not depend on the provider. The provider's data handling and quota terms apply. Temporary provider uploads are deleted after the response; the private library copy remains until the user deletes it.

## Video storage

Local development uses the gitignored `data/uploads/` folder by default:

```env
VIDEO_STORAGE_DRIVER=local
LOCAL_UPLOAD_DIR=./data/uploads
```

For a deployed environment, the same application can store session videos in a private Cloudflare R2 bucket. Create an R2 API token restricted to **Object Read & Write** for that bucket, set the values below in the host's environment settings, and switch the driver:

```env
VIDEO_STORAGE_DRIVER=r2
R2_ACCOUNT_ID=your_cloudflare_account_id
R2_BUCKET=one-dance-videos-production
R2_ACCESS_KEY_ID=your_r2_access_key_id
R2_SECRET_ACCESS_KEY=your_r2_secret_access_key
# Optional when R2_ACCOUNT_ID is set:
R2_ENDPOINT=https://your_cloudflare_account_id.r2.cloudflarestorage.com
```

The bucket remains private. The app checks session access before it retrieves a stored video, so do not configure a public bucket for practice videos. Keep `VIDEO_STORAGE_DRIVER=local` on your computer; no R2 account or credentials are needed to develop locally.

### Video processing on small instances

New Replai and coaching uploads must pass validation before permanent storage or database attachment. The browser checks decoded frames at the beginning, middle and end. The server uses bundled FFmpeg to scan the file's packets from temporary disk and decode short video and audio samples at the beginning, middle and end. This catches unreadable files, missing video tracks, and corruption detected during the scan or sampling. Corrupt frames outside the samples can still pass. MP4/MOV and WebM containers are supported. Rejected uploads leave no new library video, session attachment or automatic group; temporary upload files are removed. Existing saved files are not retroactively deleted, and an AI outage does not delete a valid upload.

Validation processes one upload at a time per server process, with one decoder thread, bounded output and a combined 120-second limit for the scan and samples. Up to three requests can wait; additional requests receive a retry message. A file that exceeds the validation window is rejected with a request for a shorter/lower-resolution clip. `ffmpeg-static` installs the platform-specific executable during dependency installation; optional `FFMPEG_PATH` overrides it. If the validator is unavailable, uploads fail without being saved.

ReplAI lists the signed-in user's latest 100 saved personal uploads and videos attached to their own student sessions. Choosing an earlier or newer take saves a private library copy automatically, then queues AI feedback. Failed uploads do not trigger automatic analysis, and failed AI requests are retried only when the user chooses to retry. Replacing or removing a selected take prevents an older response from appearing on the new selection. The list refreshes after uploads and offers streamed playback. Previously previewed ReplAI clips were not stored and must be uploaded again. Apply migration `0004_personal_replai_videos.sql` with `npm run db:migrate` before using this feature; PostgreSQL stores the metadata and the configured local/R2 driver stores the video bytes.

The trash-can action offers **Delete video only**, **Delete video and critiques**, and **Cancel**. Deletion removes the owned upload from storage and marks its metadata as deleted. The second option also removes the account's single-video critiques and comparisons, including saved-critique lookups after reuploading. Requesting a new critique restores only the requester's access to the new result. Apply migration `0005_user_critique_deletions.sql` before using these options. Students can view teacher-uploaded session videos, but only their own uploads have an enabled delete action. Ownership is checked again on the server; a storage failure leaves the entry available for retry.

Critiques are stored and looked up by **account plus video fingerprints**, including the pair of fingerprints for a comparison. Identical videos in two accounts do not reuse or overwrite one another's feedback. Apply `0006_account_owned_critiques.sql` before deploying this ownership change. Old hash-only critiques have no reliable account attribution: they and their existing session links are preserved, but they are excluded from personal ReplAI cache and baseline lookups. Users can request a new analysis under their account. Ownership is never guessed from who subsequently uploads the same file. The legacy SQLite fallback uses the same account-scoped keys and owner checks.

Uploads appear once in their saved group's review. The video opens automatically after saving, with **AI is reviewing your video** in the adjacent feedback area; the final critique replaces that status in place. There is no separate temporary video preview above the groups. Alignment controls, errors and retry actions also appear alongside the affected video. The uploader remains inside **Replai Video Library** for additional uploads. Each saved video has an independent **Video & critiques** action, so multiple reviews can remain expanded. The first take keeps its original critique; the newer take shows its comparison and fresh feedback with a single video player. Comparisons do not overwrite the original critique. Saved earlier timestamps are mapped to the newer video's timeline for playback. Use **Add newer take** beside a group name to compare a new performance. Both videos and the saved original critique are still sent to AI; the server loads the baseline when preparing the comparison, without a separate browser-side critique lookup. The earlier clip is loaded into the browser for the existing audio matcher. Server uploads and playback remain streamed. The newer take is saved directly in the earlier video's group without creating an extra group. Deleting the last video in a group also removes that group; the chosen video-only or video-and-critiques deletion option still applies.

Videos within each group display newest upload first. The **New group** form is below all groups. Empty groups have an **Upload video** button beside their name: the first upload stays in that named group and starts its individual AI critique. Once a playable video exists, the action becomes **Add newer take** and compares against the group's newest available video; its tooltip names that video. Both actions are available while the group is collapsed and are disabled during processing.

Comparison uploads identify the earlier video in the upload request. For a genuinely new upload, the server resolves that video's current group and saves the newer take into it in the same transaction. If the original is ungrouped, its filename supplies the shared group's name. A duplicate upload is reported in place and never moved into another group.

Comparison notes now include an AI-assessed progress badge and explanation: **Improved**, **Keep practising**, **Unable to assess**, or **NEW** for genuinely additional observations. These are separate from the `video` field, which only identifies the timestamp's clip. Revisited baseline notes carry a one-based reference to the original note. The AI must use visible evidence and retain uncertainty; song alignment alone is not evidence of improvement. Statuses are saved in the existing critique JSON, so no extra database migration is required. Older saved comparisons remain readable without invented labels; requesting that comparison again generates the updated format instead of reusing the old response. The original single-video critique is preserved.

New personal uploads receive a group named after the video filename (up to 100 characters). Re-uploading preserves the existing group and any custom name. Older ungrouped videos appear under their filenames too; renaming or collapsing one saves its group. Use **Rename group** beside a heading, move videos using their **Group** menu, and expand/collapse each group. A video belongs to one group per account. Named groups and their collapse settings are stored in PostgreSQL; grouping does not grant access to another account's videos. Apply `0007_video_library_groups.sql` before using saved groups and reviews. Collapsing a group unloads its players. Comparisons created before this migration have zero-default song-start markers because the old records did not retain alignment times.

Video upload routes stream multipart requests into temporary files in the operating system's temporary directory. SHA-256 fingerprints are calculated as bytes arrive. The app then streams those files to Gemini and, for session videos, to the configured storage driver. It removes temporary files after each request, including handled failures. Saved-video playback also streams data and supports byte-range requests for seeking.

Local storage accepts one video up to 600 MB. R2 environments accept up to 250 MB per upload request through the web server until direct uploads are enabled. Temporary disk must have enough space for active validation. Comparisons in the library use saved video IDs and stream the two files from storage for AI feedback. Older clients that send both raw files to the critique endpoint still share a 250 MB request limit.

### Direct uploads to R2

Keep the R2 bucket private. Add a bucket CORS rule permitting `PUT` from the app's exact HTTPS origin. The following rule covers both staging addresses:

```json
[
  {
    "AllowedOrigins": ["https://stage.theonedance.com", "https://one-dance-staging.onrender.com"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["content-type", "content-length"],
    "MaxAgeSeconds": 3600
  }
]
```

Add an object lifecycle rule that expires objects under `incoming-video/` after two days. This removes staged files from abandoned transfers. Keep existing lifecycle rules and scope this rule to that prefix so it only targets staged files.

Then set `VIDEO_DIRECT_UPLOADS=true` on the web service with `VIDEO_STORAGE_DRIVER=r2`. The browser uploads 16 MiB parts directly to R2 with progress reporting. If a transfer stops, select the same file on the same device within 24 hours to resume from completed parts. Completed transfers remain private while the server streams the file to temporary disk for fingerprinting and sampled validation. Only validated videos appear in the library or session.

## Limits of these estimates

The measurements are simple computer-vision proxies, not validated dance grades or instructor feedback. The pose model can miss joints when the dancer is occluded, out of frame or poorly lit. Beat detection uses an approximate audio-energy method, and the pose samples are too sparse for precise choreography timing. Treat the notes as prompts to review, not definitive corrections.

The app downloads MediaPipe's WebAssembly runtime from jsDelivr the first time analysis runs; the pose model itself is bundled in `public/models/`. The uploaded video is processed in the browser and is not sent to that CDN. MediaPipe documents that its task processes input on-device and sends usage metrics; see its [privacy notice](https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/tasks/web/vision/README.md#privacy-notice).

## Later backend work

This remains a local-development prototype. Sign-in is implemented, but student/teacher/company data is not yet owned by individual account IDs; that is the next authorization step before deploying for multiple people. A hosted release will also need per-user data access enforcement on every API route, upload limits, abuse protection, consent and retention controls, and an asynchronous worker for long video requests. SHA-256 matching only recognizes byte-for-byte identical files; re-encoded or edited copies will be treated as new videos. Configure `DANCE_DATABASE_PATH` to choose a different SQLite file location.
### Email verification

For local development, set `AUTH_EMAIL_DEV_LOG=true` in `.env.local` and restart `npm run dev`. Create a test account and open the verification link printed in the terminal, then sign in. This mode is available only under Next.js development.

For staging, [verify a sending domain in Resend](https://resend.com/docs/dashboard/domains/introduction) and create a sending API key. Add `RESEND_API_KEY` and `AUTH_EMAIL_FROM` (for example, `One Dance <accounts@updates.example.com>`) in Render, with `BETTER_AUTH_URL` set to the public app URL. Deploy the app, create a new test account, and confirm the email arrives and the link opens the staging sign-in page. Keep the key in Render or your local environment file.

To make staging invite-only, set `STAGING_ALLOWED_EMAILS` in the staging Render service to a comma-separated list of approved email addresses, including your own. Redeploy after adding or removing addresses. An empty value blocks all accounts. Leave the variable unset in production and in local development unless you are testing the gate. Approved email/password users still need to verify their email, so keep the staging email sender configured. Removing an address blocks its existing sessions when they next access the app. The staging sign-in page remains publicly reachable.

When a sender is configured, Better Auth requires email verification for email/password sign-in. Links expire after one hour. Signing in with valid credentials before verification sends a fresh link. This also applies to existing unverified password accounts at their next sign-in. Social sign-in continues to use the provider's existing flow. With no sender variables and local logging disabled, verification is inactive. The existing auth schema supports this flow.

### Dancer selection before AI feedback

Before a new critique, AI checks who is visible in each video. One clearly identified dancer continues automatically. Multiple dancers or an uncertain result pause the critique and show a reference frame, candidate descriptions, and an editable dancer description. Choose the person and press **Use this dancer** to resume. Mirror reflections should not count as additional people. This is a visual cue for AI, not guaranteed frame-by-frame tracking; the critique must acknowledge uncertainty when the dancer cannot be followed reliably.

Selections are saved per account and video fingerprint. Each video in a comparison has its own selection, and saved critiques are matched to those selections so changing the dancer does not reuse another person's feedback. Existing records remain stored. Use **Choose dancer** beside a saved video to select or change its subject without uploading another library copy. The preliminary check adds an AI request when no detection is saved; a paused request uploads the video to the provider again after confirmation, while retaining the private library copy.

Apply `0009_video_dancer_selection.sql` before deploying this feature. Run `npm run db:migrate` and `npm run db:validate` against staging separately; migrating the local database does not migrate staging.

### Pro trial enrollment

On Profile, **Try Pro now!** starts a trial and adds the signed-in account's teacher role while preserving its student role. Assigned roles refresh immediately. Teacher role assignment time is already stored in `user_roles.created_at`; explicit Pro enrollment is stored in `user_pro_trials.started_at`, with an optional `ends_at`. Repeated requests, role removal/reassignment, and expired trials never restart the enrollment clock. Existing teachers retain their original role-assignment date.

Apply `0008_pro_trials.sql` before deploying this feature. Set optional server variable `PRO_TRIAL_DAYS` to a whole number from 1 to 365 for newly started trial end dates; blank records the start only. Trial expiration enforcement and billing are not implemented yet. The Pro popup displays the recorded start and configured end date. Local development migration is applied separately from staging.
