import type { NextFunction, Request, Response } from "express";

type Bucket = {
  windowStartMs: number;
  count: number;
};

const buckets = new Map<string, Bucket>();
const WINDOW_MS = 60_000;

export const perKeyRateLimit = (req: Request, res: Response, next: NextFunction) => {
  const developer = req.developer;
  if (!developer) {
    return res.status(401).json({ error: "Developer context missing" });
  }

  const now = Date.now();
  const key = developer.apiKeyId;
  const existing = buckets.get(key);

  if (!existing || now - existing.windowStartMs >= WINDOW_MS) {
    buckets.set(key, { windowStartMs: now, count: 1 });
    return next();
  }

  existing.count += 1;
  if (existing.count > developer.rpmLimit) {
    const retryAfterSec = Math.ceil((WINDOW_MS - (now - existing.windowStartMs)) / 1000);
    return res.status(429).json({
      error: "Rate limit exceeded for this API key",
      retryAfterSec
    });
  }

  return next();
};
