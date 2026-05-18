import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readInjectedEnvForUser, writeInjectedEnvForUser } from "../src/config/injectedEnv.js";

describe("injected env user isolation", () => {
  it("stores and reads env by user id", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "inj-env-"));
    process.env.INJECTED_ENV_PATH = path.join(dir, "injected-env.json");

    writeInjectedEnvForUser("u1", { API_KEY: "k1", TOKEN: "t1" });
    writeInjectedEnvForUser("u2", { API_KEY: "k2" });

    expect(readInjectedEnvForUser("u1")).toEqual({ API_KEY: "k1", TOKEN: "t1" });
    expect(readInjectedEnvForUser("u2")).toEqual({ API_KEY: "k2" });
    expect(readInjectedEnvForUser("u3")).toEqual({});
  });

  it("reads legacy flat json under legacy namespace", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "inj-env-"));
    const p = path.join(dir, "legacy.json");
    process.env.INJECTED_ENV_PATH = p;
    fs.writeFileSync(p, JSON.stringify({ A: "1", B: "2" }), "utf-8");

    expect(readInjectedEnvForUser("__legacy__")).toEqual({ A: "1", B: "2" });
  });
});
