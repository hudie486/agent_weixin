# Module Architecture Guardrails

This document defines onboarding rules for command/wizard controlled domains such as `periodic`, `code`, and `env`.

## Mandatory module shape

Each domain must contain:

- `keywords.ts`: canonical action keywords and resolver
- `commands.ts`: command parsing/dispatch
- `service.ts`: business orchestration
- `wizard.ts`: wizard registration and terminal payload mapping
- `module.ts`: framework module handler

Optional:

- `dto.ts`: domain command dto
- `repository.ts` or `adapter.ts`: external system/storage bridge
- `view.ts`: help/format rendering helpers

## Dependency direction

Allowed:

`wizard -> framework command router -> commands -> service -> repository/adapter/view`

Forbidden:

- `modules/<a>` importing `modules/<b>`
- `wizard` calling `service` directly
- hardcoded action keywords spread in business branches

## Command and wizard integration

- Slash path and wizard terminal path must execute the same command entry.
- Command keyword source must be `keywords.ts`.
- Help output should be generated from command specs.

## PR checklist

- [ ] Module shape is complete for changed domains.
- [ ] No cross-domain import under `src/modules/*`.
- [ ] Wizard terminal delegates to command router/command entry only.
- [ ] Command aliases are defined in one place (`keywords.ts`).
- [ ] `npm run build` and `npm test` pass.
