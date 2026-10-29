import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

const connectionString =
  process.env.DATABASE_URL ||
  "postgresql://postgres:postgres@127.0.0.1:5432/cybernova";

export const pool = new Pool({
  connectionString,
  connectionTimeoutMillis: 1500,
});

pool.on("error", () => {
  // Prevent unhandled pool error crashes when running in standalone/fallback mode without Postgres
});

export const db = drizzle(pool, { schema });

export * from "./schema";
