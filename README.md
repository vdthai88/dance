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
- Use **Send to Gemini** to request an instructor-style critique using the prompt in `app/lib/gemini-critique.ts`. Small clips are sent directly in the request; larger clips use Gemini's temporary Files API upload, which the app deletes after the response.
- The critique uses 5 FPS sampling and returns timestamped observations, suggested adjustments, exercises, confidence, and limitations as structured JSON.
- Run MediaPipe Pose Landmarker in the browser, sampling about 3 frames per second for videos up to 3 minutes.
- Display sampled body landmarks over the video, seek to moments selected from those measurements, and open synchronized side-by-side playback.
- Estimate elbow extension, torso angle, pose detection coverage, movement amount and smoothness from the sampled landmarks.
- Estimate music tempo and beat alignment from the audio playing through the browser's Web Audio API. This estimate is approximate and may be unavailable for quiet, speech-only or unclear audio.
- When a second take is selected, automatically search the first 25 seconds of both clips for matching audio and set their song-start markers. The **Retry audio matching** button reruns the search if needed; markers can still be adjusted manually.
- Store Gemini critiques in a local SQLite database at `data/dance.sqlite`. The app fingerprints uploaded video bytes with SHA-256 and reuses the saved critique when the same file is uploaded again. It stores each uploaded filename, the fingerprint, critique JSON, model name, and creation time; it does not store the video. Comparison critiques are keyed to the ordered pair of video files and store both filenames.
- Selecting an earlier video automatically looks up its saved single-video critique. If one is found, the critique is shown and included in a two-video Gemini comparison with baseline timestamps mapped to the newer take using the aligned song-start markers.
- Switch between Student and Teacher prototype profiles. Teachers can create local student profiles and dated practice sessions with a location. A session can have teacher feedback even without a video; videos and their Gemini critiques can also be attached to that session. The microphone recording is sent to Gemini for a structured summary and action items, and only the summary is stored in SQLite. Video bytes are not stored by this feature; the session stores video filename and SHA-256 fingerprint. Student and Teacher remain demo roles within the signed-in prototype account for now.
- The Teacher mode can associate its local teacher profile with a company and type it as a dance studio, private company, or other organization. This is stored in SQLite and is not an authenticated account or access-control boundary.
- Student profiles can optionally belong to the Teacher profile's company. Teacher mode lists company-associated students and unassigned AI-only profiles; leaving the company blank keeps a student unassociated for independent AI use.
- The local Teacher profile also stores a Company owner flag. This is profile metadata only; permissions must be enforced after authentication and company-owner portal access are implemented.

## Configure Gemini

1. Copy `.env.example` to `.env.local` in this `dance` folder.
2. Add your Gemini API key to `GEMINI_API_KEY` in `.env.local`. Keep the key private; the browser never receives it.
3. Restart `npm run dev` after changing `.env.local`.

The local pose preview does not upload the clip. Choosing **Send to Gemini** sends the video to Google's Gemini API for processing. The route requests 5 FPS sampling, validates the structured response, and deletes any temporary Gemini file after the response. Google’s API data handling and the account’s current tier terms still apply; get permission before uploading another person’s video.

Unless an exact-file critique is already saved locally, choosing **Send to Gemini** sends the video to Google's Gemini API. A validated response is saved in SQLite, and any temporary Gemini Files API uploads are deleted after the response.

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

ReplAI lists the signed-in user's latest 100 saved personal uploads and videos attached to their own student sessions. Choosing an earlier or newer take saves a private library copy automatically, independently of requesting Gemini feedback. The list refreshes after uploads and offers streamed playback. Previously previewed ReplAI clips were not stored and must be uploaded again. Apply migration `0004_personal_replai_videos.sql` with `npm run db:migrate` before using this feature; PostgreSQL stores the metadata and the configured local/R2 driver stores the video bytes.

The trash-can action offers **Delete video only**, **Delete video and critiques**, and **Cancel**. Deletion removes the owned upload from storage and marks its metadata as deleted. The second option also removes its single-video critiques and comparisons from the account, including saved-critique lookups after reuploading. Because exact-file critiques can share a cache across accounts, account-specific deletion markers preserve other users' access. Requesting a new critique restores only the requester's access to the new result. Apply migration `0005_user_critique_deletions.sql` before using these options. Students can view teacher-uploaded session videos, but only their own uploads have an enabled delete action. Ownership is checked again on the server; a storage failure leaves the entry available for retry.

Video upload routes stream multipart requests into temporary files in the operating system's temporary directory. SHA-256 fingerprints are calculated as bytes arrive. The app then streams those files to Gemini and, for session videos, to the configured storage driver. It removes temporary files after each request, including handled failures. Saved-video playback also streams data and supports byte-range requests for seeking.

The limit remains 250 MB total per upload request. Temporary disk must have enough space for active uploads; it is working space, not permanent storage. On Render, keep `VIDEO_STORAGE_DRIVER=r2` for saved videos. This bounds video-buffer memory usage but does not guarantee every workload will fit a 512 MB instance. Direct browser-to-object-storage uploads and background processing remain options for higher concurrency.

## Limits of these estimates

The measurements are simple computer-vision proxies, not validated dance grades or instructor feedback. The pose model can miss joints when the dancer is occluded, out of frame or poorly lit. Beat detection uses an approximate audio-energy method, and the pose samples are too sparse for precise choreography timing. Treat the notes as prompts to review, not definitive corrections.

The app downloads MediaPipe's WebAssembly runtime from jsDelivr the first time analysis runs; the pose model itself is bundled in `public/models/`. The uploaded video is processed in the browser and is not sent to that CDN. MediaPipe documents that its task processes input on-device and sends usage metrics; see its [privacy notice](https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/tasks/web/vision/README.md#privacy-notice).

## Later backend work

This remains a local-development prototype. Sign-in is implemented, but student/teacher/company data is not yet owned by individual account IDs; that is the next authorization step before deploying for multiple people. A hosted release will also need per-user data access enforcement on every API route, upload limits, abuse protection, consent and retention controls, and an asynchronous worker for long video requests. SHA-256 matching only recognizes byte-for-byte identical files; re-encoded or edited copies will be treated as new videos. Configure `DANCE_DATABASE_PATH` to choose a different SQLite file location.
