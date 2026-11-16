import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { betterAuth } from "better-auth";
import { getPostgresPool } from "../../db/postgres";
import { usesPostgres } from "./database-driver";

const databasePath = process.env.DANCE_DATABASE_PATH || join(process.cwd(), "data", "dance.sqlite");
const localAllowedHosts = (process.env.BETTER_AUTH_ALLOWED_HOSTS || "localhost:*,127.0.0.1:*,192.168.86.162:*")
  .split(",")
  .map((host) => host.trim())
  .filter(Boolean);
const localTrustedOrigins = localAllowedHosts.map((host) => `http://${host.replace(/:\*$/, ":3000")}`);

// Better Auth owns its user, account, session, and verification tables. The
// rest of the app continues to use the same SQLite file for dance data.
mkdirSync(dirname(databasePath), { recursive: true });

export const auth = betterAuth({
  appName: "One",
  // Use the LAN address as the local development origin. Localhost remains a
  // trusted origin so the same server can still be used from this computer.
  baseURL: process.env.BETTER_AUTH_URL || "http://localhost:3000",
  trustedOrigins: process.env.NODE_ENV === "production" ? undefined : localTrustedOrigins,
  // Keep existing SQLite sign-in working until the full API migration is
  // complete. Once DATABASE_DRIVER=postgres, Better Auth reads the migrated
  // account/session tables from PostgreSQL too.
  database: usesPostgres() ? getPostgresPool() : new DatabaseSync(databasePath),
  emailAndPassword: {
    enabled: true,
  },
});
