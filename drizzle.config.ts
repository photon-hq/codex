import type { Config } from "drizzle-kit";

export default {
  schema: "./db/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/codex",
  },
  strict: true,
} satisfies Config;
