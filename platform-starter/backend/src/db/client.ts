import { Pool } from "pg";
import { env } from "../config/env.js";

export const db = new Pool({
  connectionString: env.DATABASE_URL,
  ssl: env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined
});
