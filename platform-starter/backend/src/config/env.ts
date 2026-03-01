import { config } from "dotenv";
import { z } from "zod";

config();

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL: z.string().min(1).default("gpt-4.1-mini"),
  DATABASE_URL: z.string().url(),
  ALLOWED_ORIGINS: z.string().default("http://localhost:5173"),
  GLOBAL_RATE_LIMIT_PER_MIN: z.coerce.number().int().min(10).max(5000).default(120),
  MAX_INPUT_CHARS: z.coerce.number().int().min(500).max(100000).default(20000),
  MAX_OUTPUT_TOKENS: z.coerce.number().int().min(64).max(8000).default(1200)
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const issues = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
  throw new Error(`Invalid env: ${issues}`);
}

export const env = {
  ...parsed.data,
  allowedOrigins: parsed.data.ALLOWED_ORIGINS.split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0)
};
