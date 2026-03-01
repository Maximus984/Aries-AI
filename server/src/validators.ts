import { z } from "zod";

export const historyMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1).max(12000),
  model: z.enum(["gemini-pro", "gemini-flash"]).optional()
});

export const dualChatRequestSchema = z.object({
  sessionId: z.string().trim().min(1).max(120),
  message: z.string().trim().min(1).max(12000),
  history: z.array(historyMessageSchema).max(60),
  clientNowIso: z.string().datetime({ offset: true }).optional(),
  clientTimeZone: z.string().trim().min(1).max(80).optional(),
  clientLocale: z.string().trim().min(2).max(35).optional()
});

export const imageGenerationRequestSchema = z.object({
  sessionId: z.string().trim().min(1).max(120),
  prompt: z.string().trim().min(1).max(2000),
  count: z.coerce.number().int().min(1).max(4).default(1)
});

export const signUpSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(8).max(200)
});

export const signInSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(200)
});

export const createUserSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(8).max(200),
  role: z.enum(["admin", "staff", "user"])
});

export const reportStatusSchema = z.object({
  status: z.enum(["new", "reviewed", "closed"])
});

export const createApiKeySchema = z.object({
  label: z.string().trim().min(1).max(80),
  ownerEmail: z.string().trim().email().max(254).optional()
});

export const terminalCommandSchema = z.object({
  command: z.string().trim().min(1).max(4000)
});

export const liveTtsSchema = z.object({
  text: z.string().trim().min(1).max(12000),
  voiceId: z.string().trim().min(3).max(120).optional()
});

export const feedbackReportSchema = z.object({
  message: z.string().trim().min(5).max(2000),
  page: z.string().trim().min(1).max(120).optional()
});

export const accountActionSchema = z.object({
  reason: z.string().trim().min(3).max(300)
});

export type DualChatRequestInput = z.infer<typeof dualChatRequestSchema>;
export type ImageGenerationRequestInput = z.infer<typeof imageGenerationRequestSchema>;
export type SignInInput = z.infer<typeof signInSchema>;
export type SignUpInput = z.infer<typeof signUpSchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type ReportStatusInput = z.infer<typeof reportStatusSchema>;
export type CreateApiKeyInput = z.infer<typeof createApiKeySchema>;
export type TerminalCommandInput = z.infer<typeof terminalCommandSchema>;
export type LiveTtsInput = z.infer<typeof liveTtsSchema>;
export type FeedbackReportInput = z.infer<typeof feedbackReportSchema>;
export type AccountActionInput = z.infer<typeof accountActionSchema>;
