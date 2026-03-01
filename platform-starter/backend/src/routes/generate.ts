import { Router } from "express";
import OpenAI from "openai";
import { z } from "zod";
import { env } from "../config/env.js";
import { db } from "../db/client.js";
import { apiKeyAuth } from "../middleware/apiKeyAuth.js";
import { perKeyRateLimit } from "../middleware/perKeyRateLimit.js";

const router = Router();
const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });

const requestSchema = z.object({
  prompt: z.string().trim().min(1).max(env.MAX_INPUT_CHARS),
  system: z.string().trim().max(4000).optional(),
  model: z.string().trim().min(1).max(120).optional(),
  maxTokens: z.coerce.number().int().min(64).max(env.MAX_OUTPUT_TOKENS).optional()
});

const sanitizePrompt = (value: string): string =>
  value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const getMonthlyTokenUsage = async (userId: string): Promise<number> => {
  const result = await db.query(
    `
      SELECT COALESCE(SUM(total_tokens), 0) AS total
      FROM usage_logs
      WHERE user_id = $1
        AND created_at >= date_trunc('month', NOW())
    `,
    [userId]
  );
  return Number(result.rows[0]?.total ?? 0);
};

router.post("/api/generate", apiKeyAuth, perKeyRateLimit, async (req, res, next) => {
  try {
    const parsed = requestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request payload", details: parsed.error.flatten() });
    }

    const developer = req.developer!;
    const userQuota = await db.query("SELECT monthly_token_quota FROM users WHERE id = $1 LIMIT 1", [developer.userId]);
    const monthlyQuota = Number(userQuota.rows[0]?.monthly_token_quota ?? 0);
    const usedThisMonth = await getMonthlyTokenUsage(developer.userId);

    if (usedThisMonth >= monthlyQuota) {
      return res.status(402).json({
        error: "Monthly token quota reached",
        usedThisMonth,
        monthlyQuota,
        planTier: developer.planTier
      });
    }

    const prompt = sanitizePrompt(parsed.data.prompt);
    const model = parsed.data.model ?? env.OPENAI_MODEL;
    const maxOutputTokens = parsed.data.maxTokens ?? Math.min(800, env.MAX_OUTPUT_TOKENS);

    const completion = await openai.chat.completions.create({
      model,
      messages: [
        ...(parsed.data.system ? [{ role: "system" as const, content: parsed.data.system }] : []),
        { role: "user" as const, content: prompt }
      ],
      max_tokens: maxOutputTokens,
      temperature: 0.2
    });

    const text = completion.choices[0]?.message?.content?.trim() ?? "";
    const usage = completion.usage ?? {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0
    };

    await db.query(
      `
        INSERT INTO usage_logs (
          user_id,
          api_key_id,
          endpoint,
          model,
          prompt_tokens,
          completion_tokens,
          total_tokens,
          request_count
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, 1)
      `,
      [
        developer.userId,
        developer.apiKeyId,
        "/api/generate",
        model,
        usage.prompt_tokens,
        usage.completion_tokens,
        usage.total_tokens
      ]
    );

    return res.status(200).json({
      ok: true,
      model,
      output: text,
      usage: {
        promptTokens: usage.prompt_tokens,
        completionTokens: usage.completion_tokens,
        totalTokens: usage.total_tokens
      },
      quota: {
        usedThisMonth: usedThisMonth + Number(usage.total_tokens ?? 0),
        monthlyQuota
      }
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
