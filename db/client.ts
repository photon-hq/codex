import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const globalForDb = globalThis as unknown as {
  __sql?: ReturnType<typeof postgres>;
};

function getSql() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set");
  }

  if (!globalForDb.__sql) {
    globalForDb.__sql = postgres(url, {
      max: 10,
      idle_timeout: 30,
      prepare: false,
    });
  }
  return globalForDb.__sql;
}

export function getDb() {
  return drizzle(getSql(), { schema });
}
