import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AppStore } from "../security/store.js";

const tempDirs: string[] = [];

const createStore = () => {
  const dir = mkdtempSync(join(tmpdir(), "aries-auth-test-"));
  tempDirs.push(dir);
  const store = new AppStore(join(dir, "app-data.json"), 24);
  return store;
};

afterEach(() => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("AppStore auth", () => {
  it("creates founder and supports signin sessions", () => {
    const store = createStore();
    const founder = store.ensureFounder("founder@example.com", "FounderPass!123");

    expect(founder.role).toBe("founder");

    const signedIn = store.signIn("founder@example.com", "FounderPass!123");
    expect(signedIn).not.toBeNull();

    const token = store.createSession(founder.id);
    const authUser = store.getUserByToken(token);

    expect(authUser?.email).toBe("founder@example.com");
  });

  it("registers users and prevents duplicate emails", () => {
    const store = createStore();
    store.ensureFounder("founder@example.com", "FounderPass!123");

    const user = store.createUser("user@example.com", "UserPass!123", "user");
    expect(user.role).toBe("user");

    expect(() => store.createUser("user@example.com", "AnotherPass!123", "user")).toThrow(
      "Email is already registered"
    );
  });

  it("creates API keys and resolves user by key", () => {
    const store = createStore();
    const admin = store.ensureAccount("admin@example.com", "AdminPass!123", "admin");

    const created = store.createApiKey(admin.id, "integration");
    expect(created.apiKey.startsWith("aries_live_")).toBe(true);

    const fromKey = store.getUserByApiKey(created.apiKey);
    expect(fromKey?.email).toBe("admin@example.com");

    const keys = store.listApiKeysForUser(admin.id);
    expect(keys).toHaveLength(1);
    expect(keys[0].label).toBe("integration");
  });

  it("syncs seeded account password and role on ensureSystemAccount", () => {
    const store = createStore();
    store.ensureSystemAccount("ops@example.com", "InitialPass!123", "staff");

    expect(store.signIn("ops@example.com", "InitialPass!123")).not.toBeNull();

    store.ensureSystemAccount("ops@example.com", "UpdatedPass!456", "admin");

    expect(store.signIn("ops@example.com", "InitialPass!123")).toBeNull();
    const signedIn = store.signIn("ops@example.com", "UpdatedPass!456");
    expect(signedIn?.role).toBe("admin");
  });

  it("loads legacy users without status and normalizes them to active", () => {
    const store = createStore();
    const seeded = store.ensureSystemAccount("legacy@example.com", "LegacyPass!123", "user");
    const dataPath = join(tempDirs[tempDirs.length - 1]!, "app-data.json");
    const raw = JSON.parse(readFileSync(dataPath, "utf8")) as { users: Array<Record<string, unknown>> };
    raw.users = raw.users.map((user) => {
      const copy = { ...user };
      delete copy.status;
      return copy;
    });
    writeFileSync(dataPath, JSON.stringify(raw, null, 2), "utf8");

    const reloaded = new AppStore(dataPath, 24);
    const signedIn = reloaded.signIn("legacy@example.com", "LegacyPass!123");
    expect(signedIn?.id).toBe(seeded.id);
    expect(signedIn?.status).toBe("active");
  });
});
