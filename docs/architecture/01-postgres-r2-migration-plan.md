# PostgreSQL and video-storage migration plan

## Goal

Move One from a single-computer prototype to a deployable application without changing its current coaching workflow:

```text
Browser
  -> One Next.js app (Render web service)
       -> PostgreSQL on Neon (accounts, roles, studios, sessions, notes, video metadata)
       -> Cloudflare R2 (actual video files)
       -> Gemini (only when a user asks for AI feedback)
```

PostgreSQL will store records and relationships. Cloudflare R2 will store the actual video bytes. The database will store an R2 object key, original filename, content type, size, checksum, and the session that owns the video.

## Why this change is needed

The current app uses `data/dance.sqlite`, a file on the development computer. It is suitable for the prototype but not for a multi-user deployed app. The current session-video upload creates a session/video record with a filename and SHA-256 fingerprint; it does not retain the video file after the browser upload ends.

## Current data to preserve

The migration must preserve these groups of tables:

| Area | Current tables |
| --- | --- |
| Authentication | `user`, `account`, `session`, `verification` |
| Profiles and roles | `user_profiles`, `roles`, `user_roles`, `teacher_profiles`, `students` |
| Studios and access | `organizations`, `company_memberships`, `student_company_assignments`, `student_teacher_assignments` |
| Requests and invitations | `connection_requests`, `company_join_requests`, `invitations` |
| Coaching | `practice_sessions`, `session_teacher_feedback` |
| Video and AI metadata | `session_videos`, `critiques`, `session_critiques`, `teacher_feedback` |

## Target database changes

Keep the same business concepts, with these improvements:

1. Use PostgreSQL `uuid` IDs, `timestamptz` for timestamps, `boolean` for flags, and `jsonb` for Gemini critique/feedback payloads.
2. Rename `session_videos` to `videos` or extend it with the fields below. Either is acceptable; the important part is one row per uploaded file.

```text
videos
  id                 uuid primary key
  session_id         uuid not null -> practice_sessions.id
  object_key         text not null unique        # R2 path, never a public URL
  original_filename  text not null
  content_type       text not null
  byte_size          bigint not null
  sha256             text not null
  created_at         timestamptz not null
  uploaded_by_user_id uuid not null -> user.id
```

3. Keep `company_memberships.is_default` for a teacher's default studio.
4. Add a partial unique index so a user has at most one default company membership:

```sql
CREATE UNIQUE INDEX one_default_company_per_user
ON company_memberships (user_id)
WHERE is_default = true;
```

5. Keep student-to-company links as a separate many-to-many table. A student can belong to multiple studios.

## Implementation phases

## Current implementation status

- Local PostgreSQL is installed and the versioned migrations in `db/migrations/` have been applied.
- The existing SQLite data has been imported and validated against PostgreSQL.
- The app still defaults to SQLite. The application routes have PostgreSQL implementations; run the PostgreSQL smoke test below before setting `DATABASE_DRIVER=postgres` for regular local use.
- The PostgreSQL-ready routes include authentication, profile/roles, studio selection, student access, company joins, student connection requests, invitations, practice sessions, session snapshots, session-video metadata, AI critiques, and session teacher feedback.
- Video metadata is recorded in PostgreSQL today. Actual video files will move to private R2 object storage in the next storage phase; no files are yet stored in PostgreSQL.

### Phase 0 — freeze the current schema

- Commit the current SQLite schema and migration plan.
- Export a read-only backup of `data/dance.sqlite`.
- Create a small, anonymized seed dataset for local development.
- Record data-cleanup decisions before migration:
  - each studio should have at least one owner or admin;
  - every student/studio association should be intentional;
  - duplicate display names must be resolved if the future product permits them.

**Done when:** the existing prototype can be restored from its SQLite backup.

### Phase 1 — provision development infrastructure

- Create a Neon PostgreSQL development database.
- Create a private Cloudflare R2 bucket, for example `one-dance-videos-dev`.
- Create an R2 API token restricted to that bucket with Object Read & Write access.
- Store only credentials and connection strings in Render/environment variables. Never commit them.

Suggested variables:

```text
DATABASE_URL=
R2_ACCOUNT_ID=
R2_BUCKET=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_ENDPOINT=
```

**Done when:** a local test script can connect to Postgres and list the R2 bucket without exposing credentials.

### Phase 2 — introduce a database access layer

- Stop importing `node:sqlite` directly from feature code.
- Choose one PostgreSQL-compatible database layer and use it consistently:
  - recommended: a typed query/migration tool such as Drizzle plus PostgreSQL;
  - acceptable: parameterized SQL through a PostgreSQL driver.
- Move schema creation and schema changes into versioned migrations.
- Configure Better Auth to use the PostgreSQL database adapter instead of the SQLite file.
- Keep all authorization checks server-side and parameterized.

**Done when:** a fresh PostgreSQL database can be built entirely by running migrations.

### Phase 3 — migrate application tables and APIs

Migrate in this order to honor foreign keys:

1. Better Auth tables: users, accounts, sessions, verification.
2. Roles and user profiles.
3. Organizations and company memberships.
4. Students, teacher/student links, and student/company links.
5. Requests and invitations.
6. Practice sessions and teacher feedback.
7. Critiques and video metadata.

For each API route, replace SQLite calls with the new repository/database functions and retain the current authorization tests:

- a teacher sees only students belonging to the active studio;
- a student sees only their own profile, studios, sessions, and videos;
- an owner/admin can process company requests;
- users cannot access a session or video solely by guessing an ID.

**Done when:** the local app can run against Postgres with the same visible workflow as SQLite.

### Phase 4 — implement actual video storage in R2

The upload workflow should become:

1. User selects a session.
2. App requests an upload authorization from the Next.js server.
3. Server confirms the user can access that session.
4. Browser uploads the file to a private R2 object key, preferably using a short-lived presigned URL.
5. Browser calls the server to finalize the upload.
6. Server verifies the object and writes the `videos` row in Postgres.
7. To replay a video, the server verifies access and returns a short-lived signed download URL.

Example object-key shape:

```text
companies/{companyId}/students/{studentId}/sessions/{sessionId}/{videoId}-{safeFilename}
```

Do not make the bucket public. Do not save permanent public video URLs in the database.

**Done when:** an uploaded video remains available after browser refresh, server restart, and redeploy, but is inaccessible to users without session permission.

### Phase 5 — move existing SQLite data

- Put the production app in read-only/maintenance mode briefly.
- Export SQLite tables in foreign-key order.
- Import them into Postgres in a transaction or repeatable migration script.
- Validate row counts, role assignments, studio memberships, session counts, feedback, and critique records.
- Existing video rows migrate as metadata only because the old app did not retain the source files. Users can re-upload those videos if the actual file is needed.

**Done when:** validation reports match expected counts and no foreign-key violations exist.

### Phase 6 — deploy and cut over

- Deploy the Next.js app to a Render web service.
- Point it to Render Postgres and R2 production credentials.
- Apply migrations as a release step.
- Run a private pilot with two studios, teachers, and students.
- Monitor upload failures, database errors, Gemini calls, and R2 storage growth.
- Switch the production domain only after the pilot passes.

## Testing checklist

- Create a teacher, student, and owner/admin.
- Create two studios and assign the same teacher to both.
- Assign different students to each studio and verify studio switching isolates results.
- Assign one student to two studios and verify their sessions are separately scoped.
- Upload, replay, and delete a video as an authorized teacher and student.
- Confirm a different studio's teacher receives `403` for the video/session.
- Request Gemini feedback from a stored video and save the result to the correct session.
- Test backup/restore for Postgres and recovery of a deleted R2 object.

## Rollback plan

Keep the SQLite app and backup untouched until the pilot is stable. If the Postgres/R2 release fails, point the deployment back to the prior stable version and preserve the failed environment for diagnosis. Do not overwrite the SQLite backup.

## Decisions needed before implementation

1. Create a Neon PostgreSQL project for development.
2. Confirm Cloudflare R2 as the video store.
3. Set video policy: maximum file size, supported formats, retention period, delete/restore rules.
4. Decide whether an upload may begin directly in R2 using presigned URLs (recommended for larger videos).
5. Decide whether to migrate existing user accounts or start a clean pilot database.
