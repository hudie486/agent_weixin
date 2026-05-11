import { describe, it, expect } from "vitest";
import { extractJsonObjectsFromText } from "../src/agent/streamRunner.js";

describe("extractJsonObjectsFromText", () => {
  it("splits concatenated json objects on one line", () => {
    const line = '{"a":1}{"b":2}';
    const objs = extractJsonObjectsFromText(line);
    expect(objs).toHaveLength(2);
    expect(JSON.parse(objs[0]!)).toEqual({ a: 1 });
    expect(JSON.parse(objs[1]!)).toEqual({ b: 2 });
  });
});
