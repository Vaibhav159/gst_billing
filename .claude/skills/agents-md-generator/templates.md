# AGENTS.md templates

Skeletons only. Every `<placeholder>` must be replaced with something you verified — see the Iron Law in SKILL.md. Delete any section you have no verified content for; an empty heading is worse than a missing one.

---

## Root — `AGENTS.md`

Lightweight. Only what is true on both sides of the stack. Cap 120 lines.

```markdown
# <Project> — agent guide

<2-4 lines: what the product is, the two surfaces, and the note that each
directory below has its own AGENTS.md with the detail. Agents read the
nearest one.>

## Run it

| What | Where | Command |
|---|---|---|
| Backend | repo root | `<verified>` |
| Frontend | `<dir>` | `<verified>` |
| Both together | | `<how they connect - proxy/port>` |

<One line on why the frontend must run through the dev server, if that is
true here.>

## Contracts that span both sides

<The heart of this file. Each line: what breaks, and both paths.>

- **<Contract>** — `<backend/path>` and `<frontend/path>` are mirrors. Change both.
- **<Contract>** — <field/route> is produced by `<path>` and consumed by `<path>`.

## Conventions everywhere

<3-6 lines: money/precision rules, timezone, commit and branch style, PR size.
Only what applies to both surfaces.>

## Security

<3-5 lines: secrets, prod-data guardrails, what must never be committed or
pointed at production.>

## Definition of done

<The exact commands that must pass, copy-pasteable, matching CI.>

## Where things live

- `<dir>/` — <one line> → see [`<dir>/AGENTS.md`](<dir>/AGENTS.md)
- `<dir>/` — <one line> → see [`<dir>/AGENTS.md`](<dir>/AGENTS.md)

## Finding things fast

- <purpose>: `rg -n "<real pattern>" <real dir>`
```

---

## Backend — `billing/AGENTS.md`

Cap 150 lines.

```markdown
# Backend (Django) — agent guide

<2-3 lines: framework versions, what this app owns, where the API surface is.>

## Setup & commands

<Verified: venv activation, migrate, runserver, test, lint. Note which
settings module each uses.>

## Layout

- `<file>` — <what lives here and when you touch it>

## Patterns

- **<Rule>** — DO: `<exemplar path>`. DON'T: `<anti-pattern path:line>` <why>.
- **<Rule>** — ...

## Domain rules

<The non-obvious business logic an agent will get wrong: where a rule is
decided, which helper is authoritative, which property looks authoritative
but is not.>

## Tests

<Runner, where tests live, how to run one file, the shadowing/collection
traps.>

## Gotchas

- <Each one a line you can point at.>

## Before you push

<Copy-paste command chain matching CI.>
```

---

## Frontend — `sweet-rebuild-suite-main/AGENTS.md`

Cap 150 lines.

```markdown
# Frontend (Vite + React + TS) — agent guide

<2-3 lines: stack, what it talks to, how it authenticates.>

## Setup & commands

<Verified scripts from package.json, plus the typecheck command if `build`
does not typecheck.>

## Layout

- `src/<dir>/` — <what belongs here>

## Patterns

- **<Rule>** — DO: `<exemplar path>`. DON'T: `<anti-pattern path:line>`.
- **Imports** — <alias and where it is configured>
- **UI** — <component library, where primitives live, whether to hand-roll>
- **Data** — <fetching layer, auth/token handling, error shape>

## Talking to the backend

<Client path, base URL, how the dev proxy works, which types must track
which serializer.>

## Tests

<Runner, config, where setup lives, how to run one file.>

## Gotchas

- <Each one a line you can point at.>

## Before you push

<Copy-paste command chain matching CI.>
```

---

## E2E — `e2e-tests/AGENTS.md`

Cap 60 lines. Short by design: this surface has few rules and they are all about environment.

```markdown
# E2E (Playwright) — agent guide

<2 lines: separate package, what must be running first.>

## Prerequisites

<The stack that must be up, and the BASE_URL it expects.>

## Commands

<Install, run all, run one spec, headed debugging.>

## Structure

<Auth setup project vs main project, storage state, where helpers live.>

## Writing specs

<Selector conventions, seeded fixture data, what must not be assumed.>
```

---

## Deploy — `deploy/AGENTS.md`

Cap 60 lines.

```markdown
# Deploy & serving — agent guide

<2 lines: which image serves what. This is the most commonly mistaken
thing in a split-image setup - be explicit.>

## Images

- `<image>` — <what it contains and serves>

## Config

- `<path>` — <what it controls, and what breaks when it is wrong>

## Release

<How a change reaches production, what gates it, what auto-deploys.>

## Rules

- <Guardrails: what must never be changed without checking the other image,
  limits that bite in prod but not locally.>
```
