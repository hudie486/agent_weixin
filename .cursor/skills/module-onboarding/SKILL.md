---
name: module-onboarding
description: Unify naming, layering, and onboarding flow for command/wizard driven modules (periodic, code, env). Use when creating or refactoring modules, command keywords, wizard registration, or framework dispatch integration.
disable-model-invocation: true
---

# Module Onboarding

## Purpose

Standardize modules like `periodic`, `code`, `env` so they:
- use one naming scheme,
- expose one command entry contract,
- register to framework dispatch + wizard consistently,
- avoid cross-module direct imports.

## Canonical Naming

Use one canonical term per concept. Do not mix synonyms.

- **Domain name**: short lowercase, e.g. `periodic`, `code`, `env`.
- **Action name**: verb-style canonical key, e.g. `create`, `list`, `detail`, `set`.
- **Keyword aliases**: defined only in `keywords.ts`.
- **Command parser**: `resolve<Action>`, `parse<Action>`.
- **Service methods**: `do<Action>`, `run<Action>`, or domain-specific verb.
- **Wizard registration**: `register<Domain>WizardModule`.
- **Module handler factory**: `create<Domain>Module`.

## Required Directory Shape

For each command/wizard-driven domain:

```text
src/modules/<domain>/
  keywords.ts
  commands.ts
  service.ts
  wizard.ts
  module.ts
  dto.ts              # optional but recommended
```

Keep low-level reusable capabilities in existing domain infra folders (e.g. `src/plugins/...`), but command parsing/dispatch belongs in `src/modules/<domain>/`.

## Layer Rules

Allowed direction only:

`wizard -> commandRouter -> commands -> service -> adapter/repository/view`

Hard rules:
- `wizard` must not call `service` directly.
- `modules/<a>` must not import `modules/<b>`.
- Cross-domain communication goes through framework (`registry/router`) only.
- Keywords must not be hardcoded in branch conditions outside `keywords.ts`.

## Framework Integration Contract

1. Add/maintain domain in `src/framework/contracts/module.ts` (`ModuleDomain`).
2. Implement `create<Domain>Module()` in `src/modules/<domain>/module.ts`.
3. Register in `src/framework/registerModules.ts`.
4. Ensure slash routing reaches this domain via `src/wizard/slashCatalog.ts` + framework dispatcher.

## Command Registration Pattern

In `commands.ts`:
- define canonical action enum/union,
- define alias map,
- expose `resolveAction(token)` and `executeCommand(ctx, msg, sub)`.

In `keywords.ts`:
- single source of truth for aliases and help labels.
- clean-break mode: keep only new canonical keywords.

Minimal pattern:

```ts
export type EnvAction = "help" | "list" | "set" | "delete";

const ENV_KEYWORDS: Readonly<Record<EnvAction, readonly string[]>> = {
  help: ["help"],
  list: ["list"],
  set: ["set"],
  delete: ["delete"],
};

export function resolveEnvAction(token: string): EnvAction | null {
  // lookup table
}
```

## Wizard Integration Pattern

`wizard.ts` only handles:
- step definitions,
- collecting params,
- building command payload/sub string.

Terminal execution must call unified command entry (not old handler, not service directly).

## Migration Workflow (When Refactoring Existing Domain)

1. Move keyword literals to `keywords.ts`.
2. Move command parsing branches to `commands.ts`.
3. Keep business logic in `service.ts`.
4. Replace old handler usage with module command entry.
5. Wire module in framework registry.
6. Update wizard terminal to call command router/entry.
7. Delete obsolete handler glue after compile/tests pass.

## Validation Checklist

Before finishing:

- [ ] `src/modules/<domain>/keywords.ts` exists and is the only keyword source.
- [ ] No hardcoded action keyword branches outside `keywords.ts`/`commands.ts`.
- [ ] `wizard.ts` does not import `service.ts` directly.
- [ ] `src/framework/registerModules.ts` includes the domain.
- [ ] No cross-module direct import (`modules/a` -> `modules/b`).
- [ ] Help text is generated from command spec/keyword table (or shares same source).
- [ ] `npm run build` and `npm test` pass.

## Multi-user Extension Rules

When adding or refactoring domains in this repository, follow these multi-user constraints:

- All user-facing data must be tenant-scoped by `userId` unless the feature is explicitly global.
- Keep `code` / `periodic` / `env` data isolated per user.
- Cross-user operations must be explicit via command payload (for example: `for <userId>`), never implicit context switching inside service logic.
- Admin-only features must require two checks:
  1. user is admin identity;
  2. user has active admin verification session (password verified in current process runtime).
- Admin verification state is in-memory session only (cleared on process restart), while password source may be env or persisted auth config.
- Normal users may call admins, but cannot call other normal users directly.
- Admin may proactively notify a target user by explicit user ID.

Recommended layering for multi-user auth:

`service -> security/adminAuth -> userStore/configStore`

Avoid direct cross-domain imports under `src/modules/*`; shared auth helpers should live under `src/security/*`.

## Suggested Reviews for This Repository

When touching `periodic`, `code`, `env`:
- verify consistency with:
  - `src/framework/contracts/module.ts`
  - `src/framework/registerModules.ts`
  - `src/framework/dispatcher/moduleDispatcher.ts`
- keep domain behavior backward compatibility decision explicit (clean-break vs compatible mode) in PR summary.
