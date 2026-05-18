import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { convertRunPyToMjs } from "../src/plugins/periodic/pyToMjsHeuristic.js";
import { migrateJobWorkspaceHeuristic } from "../src/plugins/periodic/jobScript.js";

describe("convertRunPyToMjs", () => {
  it("converts simple print and os.environ", () => {
    const py = `#!/usr/bin/env python3
import os

def main():
    name = os.environ.get("USER_NAME", "guest")
    print(name)

if __name__ == "__main__":
    main()
`;
    const r = convertRunPyToMjs(py);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.mjs).toContain("console.log");
      expect(r.mjs).toContain("process.env.USER_NAME");
      expect(r.mjs).not.toContain("import os");
    }
  });

  it("rejects requests dependency", () => {
    const py = "import requests\nprint(requests.get('https://example.com').text)\n";
    const r = convertRunPyToMjs(py);
    expect(r.ok).toBe(false);
  });
});

describe("migrateJobWorkspaceHeuristic", () => {
  const prevRoot = process.env.PERIODIC_JOB_ROOT;
  let tmpRoot = "";

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "periodic-jobs-"));
    process.env.PERIODIC_JOB_ROOT = tmpRoot;
  });

  afterEach(() => {
    if (prevRoot === undefined) delete process.env.PERIODIC_JOB_ROOT;
    else process.env.PERIODIC_JOB_ROOT = prevRoot;
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("migrates run.py to run.mjs and removes python files", async () => {
    const jobId = "00000000-0000-4000-8000-000000000001";
    const dir = path.join(tmpRoot, jobId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "run.py"),
      'import os\n\ndef main():\n    print(os.environ.get("X", "0"))\n\nif __name__ == "__main__":\n    main()\n',
      "utf-8",
    );
    fs.writeFileSync(path.join(dir, "requirements.txt"), "requests\n", "utf-8");

    const r = await migrateJobWorkspaceHeuristic(jobId);
    expect(r.ok).toBe(true);
    expect(fs.existsSync(path.join(dir, "run.mjs"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "run.py"))).toBe(false);
    expect(fs.existsSync(path.join(dir, "requirements.txt"))).toBe(false);
  });
});
