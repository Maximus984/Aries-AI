import type { NextFunction, Request, Response } from "express";

export const errorHandler = (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const message = error instanceof Error ? error.message : "Unexpected server error";
  const status = typeof (error as { status?: number })?.status === "number" ? (error as { status: number }).status : 500;
  return res.status(status).json({ error: message });
};
