import { Router } from "express";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { db } from "../db/client.js";
import { generateApiKey } from "../security.js";

const router = Router();

const keyRequestSchema = z.object({
  userId: z.string().uuid(),
  label: z.string().trim().min(1).max(80),
  rpmLimit: z.coerce.number().int().min(10).max(5000).optional()
});

router.post("/api/developer/keys", async (req, res, next) => {
  try {
    const parsed = keyRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid key creation payload", details: parsed.error.flatten() });
    }

    const { userId, label } = parsed.data;
    const user = await db.query("SELECT id, plan_tier FROM users WHERE id = $1 LIMIT 1", [userId]);
    if (!user.rows[0]) {
      return res.status(404).json({ error: "User not found" });
    }

    const raw = generateApiKey();
    const rpmLimit = parsed.data.rpmLimit ?? (user.rows[0].plan_tier === "free" ? 60 : user.rows[0].plan_tier === "pro" ? 180 : 600);

    await db.query(
      `
        INSERT INTO api_keys (id, user_id, label, key_prefix, key_hash, rpm_limit, is_active)
        VALUES ($1, $2, $3, $4, $5, $6, TRUE)
      `,
      [randomUUID(), userId, label, raw.prefix, raw.hash, rpmLimit]
    );

    return res.status(201).json({
      ok: true,
      apiKey: raw.plaintext,
      metadata: {
        keyPrefix: raw.prefix,
        rpmLimit
      }
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
