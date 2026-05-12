#!/usr/bin/env python3
"""Atomic periodic job store — invoked only from Node with fixed path (whitelist)."""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

from zoneinfo import ZoneInfo

try:
    from croniter import croniter as _croniter_cls
except ImportError:
    _croniter_cls = None  # type: ignore[misc, assignment]


def _require_croniter() -> None:
    if _croniter_cls is None:
        raise RuntimeError("请安装 croniter：pip install -r scripts/periodic/requirements.txt")


def cron_tz_name(j: dict[str, Any]) -> str:
    return str(j.get("cronTimeZone") or "Asia/Shanghai").strip() or "Asia/Shanghai"


def next_cron_run_ms(expr: str, tz_name: str, after_ms: int) -> int:
    """严格晚于 after_ms 的下一触发时刻（毫秒 epoch）。"""
    _require_croniter()
    tz = ZoneInfo(tz_name)
    base = datetime.fromtimestamp(after_ms / 1000.0, tz=tz)
    it = _croniter_cls(expr, base)  # type: ignore[misc]
    nxt: datetime = it.get_next(datetime)
    if nxt.tzinfo is None:
        nxt = nxt.replace(tzinfo=tz)
    return int(nxt.timestamp() * 1000)


def migrate_schedule_job_cron(j: dict[str, Any]) -> None:
    """无 cronExpression 的旧 schedule 任务：推导 CRON 并写入（供 bump / 启用 等路径）。"""
    if j.get("kind") != "schedule":
        return
    if j.get("cronExpression"):
        return
    sm = str(j.get("scheduleMode") or "").lower()
    expr: str | None = None
    if sm == "daily" and isinstance(j.get("dailyShanghai"), dict):
        ds = j["dailyShanghai"]
        try:
            h = int(ds.get("hour"))
            mi = int(ds.get("minute"))
        except (TypeError, ValueError):
            h, mi = 0, 0
        if 0 <= h <= 23 and 0 <= mi <= 59:
            expr = f"{mi} {h} * * *"
    if expr is None and j.get("intervalMs"):
        try:
            m = max(1, int(j["intervalMs"]) // 60000)
        except (TypeError, ValueError):
            m = 15
        if 1 <= m <= 59:
            expr = f"*/{m} * * * *"
        elif m == 60:
            expr = "0 * * * *"
        elif m == 1440:
            expr = "0 0 * * *"
        elif m % 60 == 0 and m < 1440:
            h = m // 60
            if 1 <= h <= 23:
                expr = f"0 */{h} * * *"
        if expr is None:
            expr = "0 * * * *"
    if expr is None:
        expr = "0 * * * *"
    j["cronExpression"] = expr
    if not j.get("cronTimeZone"):
        j["cronTimeZone"] = "Asia/Shanghai"
    if not j.get("intervalMs"):
        j["intervalMs"] = 60000


def sanitize_str(s: str) -> str:
    """Lone UTF-16 surrogates cannot be encoded to UTF-8; replace for storage."""
    if not isinstance(s, str):
        return str(s)
    return s.encode("utf-8", errors="replace").decode("utf-8")


def deep_sanitize(obj: Any) -> Any:
    if isinstance(obj, str):
        return sanitize_str(obj)
    if isinstance(obj, dict):
        return {k: deep_sanitize(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [deep_sanitize(x) for x in obj]
    return obj


def state_path() -> Path:
    raw = os.environ.get("PERIODIC_STATE_PATH", "").strip()
    if not raw:
        print("PERIODIC_STATE_PATH missing", file=sys.stderr)
        sys.exit(2)
    return Path(raw)


def load_state(p: Path) -> dict[str, Any]:
    if not p.exists():
        return {"version": 1, "jobs": []}
    with p.open(encoding="utf-8") as f:
        return json.load(f)


def save_atomic(p: Path, data: dict[str, Any]) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(p.suffix + f".{os.getpid()}.tmp")
    data = deep_sanitize(data)
    txt = json.dumps(data, ensure_ascii=False, indent=2)
    tmp.write_text(txt, encoding="utf-8")
    tmp.replace(p)


def print_json_stdout(obj: Any) -> None:
    """Write JSON as UTF-8 bytes so Windows GBK consoles cannot raise UnicodeEncodeError."""
    line = json.dumps(obj, ensure_ascii=False) + "\n"
    sys.stdout.buffer.write(line.encode("utf-8", errors="replace"))


def cmd_list(_args: argparse.Namespace) -> None:
    data = load_state(state_path())
    print_json_stdout(data)


def cmd_add(args: argparse.Namespace) -> None:
    raw = sys.stdin.read()
    try:
        payload = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError as e:
        print(f"invalid stdin json: {e}", file=sys.stderr)
        sys.exit(3)
    notify = sanitize_str(str(payload.get("notifyUserId") or "").strip())
    if not notify:
        print("notifyUserId required", file=sys.stderr)
        sys.exit(3)
    kind = str(payload.get("kind") or "").strip().lower()
    if kind not in ("schedule", "trigger"):
        print("kind must be schedule or trigger", file=sys.stderr)
        sys.exit(3)
    interval_ms = None
    next_run = None
    cron_expression: str | None = None
    cron_tz = "Asia/Shanghai"
    if kind == "schedule":
        cx = str(payload.get("cronExpression") or "").strip()
        if not cx:
            print(
                "cronExpression required for schedule (5 fields: minute hour day month weekday)",
                file=sys.stderr,
            )
            sys.exit(3)
        cron_tz = str(payload.get("cronTimeZone") or "Asia/Shanghai").strip() or "Asia/Shanghai"
        now_ms = int(time.time() * 1000)
        try:
            next_run = next_cron_run_ms(cx, cron_tz, now_ms)
        except Exception as e:
            print(f"invalid cronExpression: {e}", file=sys.stderr)
            sys.exit(3)
        cron_expression = cx
        gap = max(60_000, min(86_400_000, next_run - now_ms))
        interval_ms = gap
    user_prompt = sanitize_str(
        str(payload.get("userPrompt") or payload.get("prompt") or "").strip()
    )
    payload_obj = payload.get("payload")
    agent_chat = sanitize_str(str(payload.get("agentChatId") or "").strip()) or None
    gen_st: str | None

    if not isinstance(payload_obj, dict) or str(payload_obj.get("type") or "").strip() != "script":
        print("payload must be {\"type\":\"script\", ...}", file=sys.stderr)
        sys.exit(3)
    if not user_prompt:
        print("userPrompt or prompt required", file=sys.stderr)
        sys.exit(3)
    entry = sanitize_str(str(payload_obj.get("entryFile") or "run.py").strip()) or "run.py"
    dm = str(payload_obj.get("deliveryMode") or "stdout_nonempty").strip().lower()
    if dm not in ("stdout_nonempty", "every_run"):
        dm = "stdout_nonempty"
    py_exe = payload_obj.get("pythonExe")
    job_payload = {
        "type": "script",
        "entryFile": entry,
        "deliveryMode": dm,
        "pythonExe": (sanitize_str(str(py_exe)).strip() or None) if py_exe is not None else None,
    }
    gen_raw = payload.get("generationStatus")
    if gen_raw in ("pending", "ready", "failed"):
        gen_st = str(gen_raw)
    else:
        gen_st = "pending"
    short_sn = sanitize_str(str(payload.get("shortName") or "").strip()) or None

    p = state_path()
    data = load_state(p)
    jobs = data.setdefault("jobs", [])
    jid = str(uuid.uuid4())
    job: dict[str, Any] = {
        "id": jid,
        "kind": kind,
        "notifyUserId": notify,
        "enabled": True,
        "intervalMs": interval_ms,
        "nextRunAt": next_run,
        "payload": job_payload,
        "userPrompt": user_prompt,
        "agentChatId": agent_chat,
        "lastSuccessAt": None,
        "lastErrorAt": None,
        "lastErrorSummary": None,
        "lastRunAt": None,
        "missedTicksEstimate": 0,
    }
    if gen_st is not None:
        job["generationStatus"] = gen_st
    if short_sn:
        job["shortName"] = short_sn
    if kind == "schedule" and cron_expression is not None:
        job["cronExpression"] = cron_expression
        job["cronTimeZone"] = cron_tz
    jobs.append(job)
    save_atomic(p, data)
    print_json_stdout({"ok": True, "job": job})


def cmd_remove(args: argparse.Namespace) -> None:
    jid = args.id.strip()
    p = state_path()
    data = load_state(p)
    jobs = data.setdefault("jobs", [])
    data["jobs"] = [j for j in jobs if str(j.get("id")) != jid]
    save_atomic(p, data)
    print_json_stdout({"ok": True})


_PATCH_KEYS = frozenset(
    {
        "generationStatus",
        "payload",
        "agentChatId",
        "userPrompt",
        "enabled",
        "shortName",
        "cronExpression",
        "cronTimeZone",
    }
)


def cmd_patch_job(args: argparse.Namespace) -> None:
    jid = args.id.strip()
    raw = sys.stdin.read()
    try:
        patch = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError as e:
        print(f"invalid stdin json: {e}", file=sys.stderr)
        sys.exit(3)
    if not isinstance(patch, dict):
        print("patch must be a JSON object", file=sys.stderr)
        sys.exit(3)
    p = state_path()
    data = load_state(p)
    for j in data.setdefault("jobs", []):
        if str(j.get("id")) != jid:
            continue
        for k, v in patch.items():
            if k not in _PATCH_KEYS:
                continue
            if k == "generationStatus":
                if v in ("pending", "ready", "failed") or v is None:
                    j["generationStatus"] = v
                continue
            if k == "payload" and isinstance(v, dict):
                j["payload"] = deep_sanitize(v)
                continue
            if k == "enabled":
                j["enabled"] = bool(v)
                continue
            if k == "agentChatId":
                j["agentChatId"] = sanitize_str(str(v or "").strip()) or None
                continue
            if k == "userPrompt":
                j["userPrompt"] = sanitize_str(str(v or "").strip()) or None
                continue
            if k == "shortName":
                j["shortName"] = sanitize_str(str(v or "").strip()) or None
                continue
            if k == "cronExpression" and j.get("kind") == "schedule":
                ex = sanitize_str(str(v or "").strip())
                if not ex:
                    continue
                try:
                    nr = next_cron_run_ms(ex, cron_tz_name(j), int(time.time() * 1000))
                except Exception:
                    continue
                j["cronExpression"] = ex
                j["nextRunAt"] = nr
                gap = max(60_000, min(86_400_000, nr - int(time.time() * 1000)))
                j["intervalMs"] = gap
                continue
            if k == "cronTimeZone" and j.get("kind") == "schedule":
                tz = sanitize_str(str(v or "").strip()) or "Asia/Shanghai"
                j["cronTimeZone"] = tz
                ex = str(j.get("cronExpression") or "")
                if ex:
                    try:
                        j["nextRunAt"] = next_cron_run_ms(ex, tz, int(time.time() * 1000))
                    except Exception:
                        pass
                continue
        save_atomic(p, data)
        print_json_stdout({"ok": True, "job": j})
        return
    print("job not found", file=sys.stderr)
    sys.exit(4)


def cmd_note_result(args: argparse.Namespace) -> None:
    jid = args.id.strip()
    summary = sanitize_str((args.summary or "").strip())
    ok = bool(args.ok)
    p = state_path()
    data = load_state(p)
    found = False
    now = int(time.time() * 1000)
    for j in data.setdefault("jobs", []):
        if str(j.get("id")) != jid:
            continue
        found = True
        j["lastRunAt"] = now
        if ok:
            j["lastSuccessAt"] = now
            j["lastErrorAt"] = None
            j["lastErrorSummary"] = None
        else:
            j["lastErrorAt"] = now
            j["lastErrorSummary"] = summary[:500] if summary else "error"
    if not found:
        print("job not found", file=sys.stderr)
        sys.exit(4)
    save_atomic(p, data)
    print_json_stdout({"ok": True})


def cmd_bump_next(args: argparse.Namespace) -> None:
    jid = args.id.strip()
    p = state_path()
    data = load_state(p)
    now = int(time.time() * 1000)
    for j in data.setdefault("jobs", []):
        if str(j.get("id")) != jid:
            continue
        if j.get("kind") != "schedule":
            print("not a schedule job", file=sys.stderr)
            sys.exit(6)
        migrate_schedule_job_cron(j)
        ex = str(j.get("cronExpression") or "")
        if not ex:
            sys.exit(5)
        j["nextRunAt"] = next_cron_run_ms(ex, cron_tz_name(j), now)
        save_atomic(p, data)
        print_json_stdout({"ok": True})
        return
    print("job not found", file=sys.stderr)
    sys.exit(4)


def cmd_set_agent_chat(args: argparse.Namespace) -> None:
    jid = args.id.strip()
    chat = sanitize_str((args.chat or "").strip())
    p = state_path()
    data = load_state(p)
    for j in data.setdefault("jobs", []):
        if str(j.get("id")) == jid:
            j["agentChatId"] = chat or None
            save_atomic(p, data)
            print_json_stdout({"ok": True})
            return
    print("job not found", file=sys.stderr)
    sys.exit(4)


def cmd_set_enabled(args: argparse.Namespace) -> None:
    jid = args.id.strip()
    en = args.enabled
    p = state_path()
    data = load_state(p)
    found = False
    now = int(time.time() * 1000)
    for j in data.setdefault("jobs", []):
        if str(j.get("id")) == jid:
            j["enabled"] = bool(en)
            found = True
            if en and j.get("kind") == "schedule":
                migrate_schedule_job_cron(j)
                ex = str(j.get("cronExpression") or "")
                if ex:
                    try:
                        j["nextRunAt"] = next_cron_run_ms(ex, cron_tz_name(j), now)
                    except Exception:
                        pass
    if not found:
        print("job not found", file=sys.stderr)
        sys.exit(4)
    save_atomic(p, data)
    print_json_stdout({"ok": True})


def cmd_set_missed_estimate(args: argparse.Namespace) -> None:
    jid = args.id.strip()
    est = int(args.estimate)
    p = state_path()
    data = load_state(p)
    for j in data.setdefault("jobs", []):
        if str(j.get("id")) == jid:
            j["missedTicksEstimate"] = max(0, est)
            save_atomic(p, data)
            print_json_stdout({"ok": True})
            return
    print("job not found", file=sys.stderr)
    sys.exit(4)


def main() -> None:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)

    p_ls = sub.add_parser("list")
    p_ls.set_defaults(func=cmd_list)

    p_add = sub.add_parser("add")
    p_add.set_defaults(func=cmd_add)

    p_rm = sub.add_parser("remove")
    p_rm.add_argument("--id", required=True)
    p_rm.set_defaults(func=cmd_remove)

    p_patch = sub.add_parser("patch-job")
    p_patch.add_argument("--id", required=True)
    p_patch.set_defaults(func=cmd_patch_job)

    p_en = sub.add_parser("set-enabled")
    p_en.add_argument("--id", required=True)
    p_en.add_argument("--enabled", type=lambda x: str(x).lower() in ("1", "true", "yes"), required=True)
    p_en.set_defaults(func=cmd_set_enabled)

    p_nr = sub.add_parser("note-result")
    p_nr.add_argument("--id", required=True)
    p_nr.add_argument("--ok", type=lambda x: str(x).lower() in ("1", "true", "yes"), required=True)
    p_nr.add_argument("--summary", default="")
    p_nr.set_defaults(func=cmd_note_result)

    p_bn = sub.add_parser("bump-next")
    p_bn.add_argument("--id", required=True)
    p_bn.set_defaults(func=cmd_bump_next)

    p_ac = sub.add_parser("set-agent-chat")
    p_ac.add_argument("--id", required=True)
    p_ac.add_argument("--chat", default="")
    p_ac.set_defaults(func=cmd_set_agent_chat)

    p_me = sub.add_parser("set-missed-estimate")
    p_me.add_argument("--id", required=True)
    p_me.add_argument("--estimate", type=int, required=True)
    p_me.set_defaults(func=cmd_set_missed_estimate)

    args = ap.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
