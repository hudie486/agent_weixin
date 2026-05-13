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

## Suggested Reviews for This Repository

When touching `periodic`, `code`, `env`:
- verify consistency with:
  - `src/framework/contracts/module.ts`
  - `src/framework/registerModules.ts`
  - `src/framework/dispatcher/moduleDispatcher.ts`
- keep domain behavior backward compatibility decision explicit (clean-break vs compatible mode) in PR summary.
