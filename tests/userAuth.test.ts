import { beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  clearAdminVerify,
  initializeAdminPassword,
  isAdminVerified,
  listVerifiedAdmins,
  requireVerifiedAdminOrThrow,
  verifyAdminPassword,
} from "../src/security/adminAuth.js";
import { upsertManagedUser } from "../src/modules/user/store.js";

describe("admin auth session", () => {
  beforeEach(() => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "user-auth-"));
    process.env.USER_STORE_PATH = path.join(dir, "users.json");
    process.env.ADMIN_AUTH_PATH = path.join(dir, "admin-auth.json");
  });

  it("verifies runtime admin session by password only", () => {
    upsertManagedUser("admin-1", { enabled: true });

    initializeAdminPassword("admin-1", "secret-1");
    expect(verifyAdminPassword("admin-1", "secret-1")).toBe(true);
    expect(isAdminVerified("admin-1")).toBe(true);
    expect(listVerifiedAdmins()).toContain("admin-1");
    expect(() => requireVerifiedAdminOrThrow("admin-1")).not.toThrow();

    clearAdminVerify("admin-1");
    expect(isAdminVerified("admin-1")).toBe(false);
    expect(() => requireVerifiedAdminOrThrow("admin-1")).toThrow();
  });

  it("rejects wrong password verification", () => {
    upsertManagedUser("user-1", { enabled: true });
    initializeAdminPassword("user-1", "secret");
    expect(verifyAdminPassword("user-1", "wrong-secret")).toBe(false);
  });
});
