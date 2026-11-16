import { Pool } from "pg";

let pool: Pool | undefined;

/** Returns the server-side PostgreSQL pool used after the Neon cutover. */
export function getPostgresPool() {
  if (pool) return pool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required to use PostgreSQL.");
  pool = new Pool({
    connectionString,
    ssl: process.env.POSTGRES_SSL === "false" ? false : { rejectUnauthorized: false },
  });
  return pool;
}
