import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { resolveUserByRef } from "../src/modules/user/userResolve.js";
import { saveUsersState, upsertManagedUser } from "../src/modules/user/store.js";

describe("userResolve", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "user-resolve-"));
    process.env.USER_STORE_PATH = path.join(tmpDir, "users.json");
    saveUsersState({ version: 1, users: [] });
    upsertManagedUser("wx:a@im.wechat");
    const u = upsertManagedUser("wx:b@im.wechat");
    saveUsersState({
      version: 1,
      users: [{ ...u, shortName: "宝宝" }],
    });
  });

  it("resolves by shortName", () => {
    const r = resolveUserByRef("宝宝");
    expect(r.status).toBe("found");
    if (r.status === "found") expect(r.user.userId).toBe("wx:b@im.wechat");
  });
});
