import { describe, expect, it } from "vitest";
import { parsePeriodicStdout, PERIODIC_STDOUT_SEP } from "../src/plugins/periodic/stdoutParse.js";

describe("parsePeriodicStdout", () => {
  it("splits on newlines", () => {
    expect(parsePeriodicStdout("a\nb\nc")).toEqual(["a", "b", "c"]);
  });

  it("splits on RS separator", () => {
    const sep = PERIODIC_STDOUT_SEP;
    expect(parsePeriodicStdout(`head${sep}one${sep}two\n`)).toEqual(["head", "one", "two"]);
  });

  it("parses JSON array stdout", () => {
    const raw = JSON.stringify(["line-a", "line-b"]);
    expect(parsePeriodicStdout(raw)).toEqual(["line-a", "line-b"]);
  });

  it("parses quoted segments on one line", () => {
    const one = '"a", "b", "c"';
    expect(parsePeriodicStdout(one)).toEqual(["a", "b", "c"]);
  });
});
