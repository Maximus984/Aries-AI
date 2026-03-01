import { afterEach, describe, expect, it, vi } from "vitest";
import { signIn, signUp } from "./api";

describe("auth API network error messaging", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("returns actionable message for sign-in network failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch")) as unknown as typeof fetch
    );

    try {
      await signIn("user@example.com", "Password!123");
      throw new Error("expected sign-in to fail");
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      expect(message).toContain("Auth service unavailable");
      expect(message).toContain("http://localhost:3000");
      expect(message).toContain(window.location.origin);
      expect(message).toContain("CORS allows");
    }
  });

  it("returns actionable message for sign-up network failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Network down")) as unknown as typeof fetch
    );

    try {
      await signUp("user@example.com", "Password!123");
      throw new Error("expected sign-up to fail");
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      expect(message).toContain("Auth service unavailable");
      expect(message).toContain("http://localhost:3000");
      expect(message).toContain(window.location.origin);
      expect(message).toContain("CORS allows");
    }
  });
});
