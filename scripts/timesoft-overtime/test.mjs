// 用线上实测文本验证纯逻辑。运行：node test.mjs
import assert from "node:assert/strict";
import { roundEnd, parseClockOut, alreadySubmitted, yesterdayStr, meetsMinOvertime } from "./lib.mjs";

// —— 取整规则：向内（向下）取整到半小时 ——
assert.equal(roundEnd("18:39"), "18:30");
assert.equal(roundEnd("19:17"), "19:00");
assert.equal(roundEnd("19:44"), "19:30"); // 19:45 前 → 19:30
assert.equal(roundEnd("19:48"), "19:30");
assert.equal(roundEnd("20:24"), "20:00");
assert.equal(roundEnd("21:01"), "21:00");
assert.equal(roundEnd("17:30"), "17:30");
assert.equal(roundEnd("17:45"), "17:30"); // 原向上取整为 18:00
assert.equal(roundEnd("23:31"), "23:30");

// —— 出勤明细：实测抓到的原文 ——
const ATT = `出勤明细
常白班
2026-07-01
实际开始时间:
实际结束时间:
异常说明:出勤异常
常白班
2026-06-30
实际开始时间:2026-06-30 08:08
实际结束时间:2026-06-30 18:39
异常说明:
正常
常白班
2026-06-29
实际开始时间:2026-06-29 08:06
实际结束时间:2026-06-29 20:46
异常说明:`;

assert.equal(parseClockOut(ATT, "2026-06-30"), "18:39"); // 昨天下班
assert.equal(parseClockOut(ATT, "2026-07-01"), null); // 今天未打卡
assert.equal(parseClockOut(ATT, "2026-06-29"), "20:46");

// —— 加班查询：实测原文，昨天(6-30)没有记录，6-29 有 ——
const OT = `加班查询
平时加班
2026-06-29
加班开始时间:2026-06-29 17:05
加班截止时间:2026-06-29 21:00
平时加班3.5小时
加班原因：周会
审核中
平常加班
2026-06-25
加班开始时间:2026-06-25 17:05
加班截止时间:2026-06-25 21:30`;

assert.equal(alreadySubmitted(OT, "2026-06-30"), false); // 昨天未提交 → 应提交
assert.equal(alreadySubmitted(OT, "2026-06-29"), true); // 已提交 → 应跳过
assert.equal(alreadySubmitted(OT, "2026-06-25"), true);

// yesterdayStr 基本正确性
assert.equal(yesterdayStr(Date.parse("2026-07-01T09:00:00")), "2026-06-30");

// —— 申报门槛：实际下班打卡 ≥ 19:00 ——
assert.equal(meetsMinOvertime("18:59"), false);
assert.equal(meetsMinOvertime("19:00"), true);
assert.equal(meetsMinOvertime("19:17"), true);
assert.equal(meetsMinOvertime("19:30"), true);
assert.equal(meetsMinOvertime("20:01"), true);

console.log("OK: 全部断言通过（取整/出勤解析/加班查重/申报门槛 与实测数据一致）");
