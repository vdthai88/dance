/** SQLite remains the default until every server-side store has been migrated. */
export function usesPostgres() {
  return process.env.DATABASE_DRIVER === "postgres";
}
