import { describe, expect, it } from "vitest";
import { dualChatRequestSchema, liveTtsSchema } from "../validators.js";

describe("dualChatRequestSchema", () => {
  it("accepts a valid dual chat request", () => {
    const parsed = dualChatRequestSchema.safeParse({
      sessionId: "session-1",
      message: "How are you?",
      history: [{ role: "user", content: "Hello" }],
      clientNowIso: "2026-02-28T16:10:00.000Z",
      clientTimeZone: "America/Los_Angeles",
      clientLocale: "en-US"
    });

    expect(parsed.success).toBe(true);
  });

  it("rejects empty messages", () => {
    const parsed = dualChatRequestSchema.safeParse({
      sessionId: "session-1",
      message: "   ",
      history: []
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects malformed history roles", () => {
    const parsed = dualChatRequestSchema.safeParse({
      sessionId: "session-1",
      message: "Hello",
      history: [{ role: "system", content: "bad" }]
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects malformed clientNowIso", () => {
    const parsed = dualChatRequestSchema.safeParse({
      sessionId: "session-1",
      message: "Hello",
      history: [],
      clientNowIso: "not-a-date"
    });

    expect(parsed.success).toBe(false);
  });
});

describe("liveTtsSchema", () => {
  it("accepts text with optional voiceId", () => {
    const parsed = liveTtsSchema.safeParse({
      text: "Hello from Aries",
      voiceId: "OYTbf65OHHFELVut7v2H"
    });

    expect(parsed.success).toBe(true);
  });

  it("rejects empty text", () => {
    const parsed = liveTtsSchema.safeParse({
      text: "   "
    });

    expect(parsed.success).toBe(false);
  });
});
