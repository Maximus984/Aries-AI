import type { NextFunction, Request, Response } from "express";
import { db } from "../db/client.js";
import { hashApiKey } from "../security.js";

export const apiKeyAuth = async (req: Request, res: Response, next: NextFunction) => {
  const apiKey = req.header("x-api-key")?.trim();
  if (!apiKey) {
    return res.status(401).json({ error: "Missing x-api-key header" });
  }

  const keyHash = hashApiKey(apiKey);

  const query = await db.query(
    `
      SELECT
        k.id AS api_key_id,
        k.user_id,
        k.key_prefix,
        k.rpm_limit,
        u.plan_tier
      FROM api_keys k
      INNER JOIN users u ON u.id = k.user_id
      WHERE k.key_hash = $1
        AND k.is_active = TRUE
        AND k.revoked_at IS NULL
        AND u.plan_status = 'active'
      LIMIT 1
    `,
    [keyHash]
  );

  const row = query.rows[0];
  if (!row) {
    return res.status(401).json({ error: "Invalid API key" });
  }

  req.developer = {
    userId: row.user_id as string,
    apiKeyId: row.api_key_id as string,
    planTier: row.plan_tier as "free" | "pro" | "enterprise",
    rpmLimit: Number(row.rpm_limit ?? 60),
    keyPrefix: row.key_prefix as string
  };

  void db.query("UPDATE api_keys SET last_used_at = NOW() WHERE id = $1", [row.api_key_id]);
  return next();
};
