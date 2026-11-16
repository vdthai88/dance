# Database workspace

This folder holds the version-controlled PostgreSQL definition for One.

- `migrations/` contains ordered, immutable SQL changes.
- `postgres.ts` creates the server-side PostgreSQL connection when `DATABASE_URL` is configured.
- `seeds/` is reserved for safe development-only sample data.

Run `npm run db:migrate` only after setting `DATABASE_URL` to a Neon PostgreSQL connection string. The current local SQLite prototype is not switched automatically.

Before applying a migration to a shared database, run `npm run db:validate`.
