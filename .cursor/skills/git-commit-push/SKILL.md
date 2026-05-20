---
name: git-commit-push
description: >-
  Updates README.md to match code changes, then stages, commits, and pushes with
  project git safety rules. Use when the user asks to git add, git commit, push
  to remote, sync with origin/main, or publish code to GitHub (including via HTTP
  proxy on Windows).
disable-model-invocation: true
---

# Git Commit and Push

## When to use

Apply when the user wants to save work to git and update `origin`, e.g.:

- 「先 git add + git commit，再推送」
- 「提交并推送到远程」
- 「使用代理推送」

## Safety (required)

- **Never** change `git config` (local or global).
- **Never** commit `.env`, credentials, or `data/` runtime files (respect `.gitignore`).
- **Never** `git push --force` to `main`/`master` unless the user explicitly requests it.
- **Only** create commits when the user asked to commit (this skill implies commit is requested).
- Do **not** push unless the user asked to push (this skill includes push when invoked for the full workflow).

## Workflow

### 1. Inspect (run in parallel)

```bash
git status
git diff
git diff --cached
git log -8 --oneline
```

Review staged/unstaged changes; confirm no secrets or build artifacts that should stay ignored (`dist/`, `data/`).

### 2. Update README (required before every commit)

**Always edit [README.md](../../README.md) at the repo root before `git add`.** README is the user-facing contract; it must reflect what ships in this commit.

1. Read `git diff` (and new/untracked files) and list **user-visible** deltas: commands, env vars, platforms, wizards, APIs, setup steps, behavior changes.
2. Update the matching README sections (do not append a changelog unless the repo already uses one):
   - **快速开始** — install/build/run steps
   - **主要能力** / platform sections — capabilities table
   - **微信中的命令** / **QQ 机器人** — slash commands and subcommands
   - **消息交互流程** — routing or outbound behavior if architecture changed
   - **配置** — new or renamed `.env` keys (cross-check [`.env.example`](../../.env.example))
3. Remove or correct README text that the commit makes **outdated** (deleted commands, old Python/cron notes, wrong paths).
4. Keep edits **minimal and accurate** — document behavior, not implementation detail. Match existing README language (Chinese for user text) and table style.
5. **Skip README edits only** when the diff is purely internal (refactor, tests, comments) with zero user-visible impact; state that briefly in the commit body.

Include `README.md` in the same commit as the code changes.

### 3. Stage

```bash
git add -A
```

Re-run `git status` and unstage anything that must not ship (e.g. accidental `.env`).

### 4. Commit message

Match recent repo style: short imperative subject (`feat:`, `fix:`, `refactor:`, `docs:`), optional body with **why**. Mention README updates in the body when non-trivial.

PowerShell (two `-m` flags):

```powershell
git commit -m "feat: short summary" -m "Optional body explaining why."
```

### 5. Push

**HTTPS remote, no proxy:**

```powershell
git push origin main
```

**HTTPS remote with HTTP proxy (Windows PowerShell — do not use `&&`):**

```powershell
$env:HTTP_PROXY="http://127.0.0.1:10808"
$env:HTTPS_PROXY="http://127.0.0.1:10808"
$env:ALL_PROXY="http://127.0.0.1:10808"
git push origin main
```

Use the proxy URL the user gives; default in this project has been `http://127.0.0.1:10808`.

**SSH remote:** proxy env vars do not apply; configure SSH `ProxyCommand` separately if needed.

### 6. Verify

```bash
git status
```

Expect: working tree clean; branch up to date with `origin/<branch>` (or ahead by 0 after push).

## Checklist

```
- [ ] git status / diff / log reviewed
- [ ] README.md updated for user-visible changes (or explicitly N/A)
- [ ] No secrets in staged files
- [ ] git add (and status rechecked)
- [ ] Commit message matches change purpose
- [ ] git push (with proxy if user specified)
- [ ] git status clean after push
```

## If push fails

| Error | Action |
|-------|--------|
| `rejected (fetch first)` | `git pull --rebase origin main` then push again (only if user wants sync; no force) |
| `401` / auth | User must fix credentials (`gh auth login` or HTTPS token); do not ask for tokens in chat |
| `Everything up-to-date` | Report: no new commits to push; offer to commit if only unstaged changes remain |
| Proxy timeout | Confirm proxy is running; retry with user-provided proxy URL |

## Branch

Default branch is `main`. If the user is on another branch, push that branch: `git push -u origin HEAD`.
