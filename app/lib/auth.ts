import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { betterAuth } from "better-auth";

const databasePath = process.env.DANCE_DATABASE_PATH || join(process.cwd(), "data", "dance.sqlite");

// Better Auth owns its user, account, session, and verification tables. The
// rest of the app continues to use the same SQLite file for dance data.
mkdirSync(dirname(databasePath), { recursive: true });

export const auth = betterAuth({
  appName: "One",
  baseURL: process.env.BETTER_AUTH_URL || "http://localhost:3000",
  database: new DatabaseSync(databasePath),
  emailAndPassword: {
    enabled: true,
  },
});
