---
name: agents-md-generator
description: Use when creating, refreshing, or auditing AGENTS.md / CLAUDE.md context files for this repo - "create AGENTS.md", "generate agent docs", "set up AI documentation", "the agent docs are stale", or after a restructure moved directories, renamed commands, or added a package.
---

# AGENTS.md Generator

Produce a hierarchical set of AGENTS.md files for this repo: one lightweight root, one per working surface (Django backend, Vite/React frontend, Playwright E2E, deploy), where **every path and command has been proven to exist.**

Agents read the *nearest* AGENTS.md to the file they are editing. Root carries only what is true everywhere; the detail lives next to the code.

## The Iron Law

**NOTHING GOES IN AN AGENTS.md UNTIL YOU HAVE RUN IT OR PROVEN IT EXISTS.**

A doc that says `pnpm test` in an npm repo, or points at `src/lib/api.ts` when the file is `src/utils/api.ts`, is *worse than no doc*: the next agent trusts it, acts on it, and burns a turn discovering the lie. Confident-and-wrong is the failure this skill exists to prevent.

| Claim | Proof required before writing it |
|---|---|
| A file or directory path | `ls <path>` exits 0 |
| An npm script | the key is in that package.json `scripts` |
| A management command | the file exists in `billing/management/commands/` |
| A test / lint / build command | you ran it (or `--collect-only` / `--help` / `--version`) |
| "X is how we do Y here" | `grep` shows real call sites, and you cite one by path |
| "We use library L" | call sites in `src/`, **not** an entry in package.json |
| A gotcha | you can point at the line that causes it |

**No exceptions:**
- Not for "obviously standard" commands. This repo is **npm** (not pnpm/yarn) and **pytest** (not `manage.py test`).
- Not for anything read out of a README. READMEs go stale; the filesystem does not. `README.md` here still says `pip install -e .` while CI uses `uv`.
- Not "I'll flag it as TODO." Delete the line instead.
- Copying a line from the previous AGENTS.md is a **new** claim. Re-verify it.
- A dependency in package.json is not a convention. This repo ships
  `@tanstack/react-query` and mounts its provider in `src/App.tsx`, yet has
  **zero** `useQuery`/`useMutation` call sites — documenting it as "how we fetch
  data" would send the next agent down a path nothing here follows. Grep for use,
  not for installation.

Finish by running `.claude/skills/agents-md-generator/verify_agents_md.py`. Not optional.

## Repo shape

Everything lives under `gst_billing/` (the git root). Two deployable surfaces, one shared money domain.

| Surface | Path | Stack |
|---|---|---|
| Backend | `billing/`, `gst_billing/` | Django 5.2 LTS, DRF, SimpleJWT, Postgres (Neon), cacheops |
| Frontend | `sweet-rebuild-suite-main/` | Vite + React 18 + TS, Tailwind, shadcn/ui, TanStack Query, axios, Capacitor (iOS) |
| E2E | `e2e-tests/` | Playwright, its own package.json |
| Serving | `nginx/`, `deploy/`, `docker-compose.yml` | nginx image builds+serves the frontend; Django image is API only |

Re-derive this before trusting it — the map is a starting point, not the source of truth:

```bash
cd "$(git rev-parse --show-toplevel)"
ls -d billing gst_billing sweet-rebuild-suite-main e2e-tests nginx deploy 2>/dev/null
find . -name package.json -not -path '*/node_modules/*' -maxdepth 3
python -c "import json,sys;print(list(json.load(open('sweet-rebuild-suite-main/package.json'))['scripts']))"
ls billing/management/commands/
sed -n '/^\[tool.pytest/,/^\[/p' pyproject.toml
```

## Where the files go

Write exactly these five. More files than working surfaces is noise; fewer means an agent editing the frontend reads Django rules.

| File | Audience | Cap |
|---|---|---|
| `AGENTS.md` | anyone, anywhere in the repo | 120 lines |
| `billing/AGENTS.md` | editing Django models/API/services | 150 lines |
| `sweet-rebuild-suite-main/AGENTS.md` | editing React/TS | 150 lines |
| `e2e-tests/AGENTS.md` | editing Playwright specs | 60 lines |
| `deploy/AGENTS.md` | editing nginx/compose/CI | 60 lines |

Root gets **only** what holds on both sides of the stack: how to run each half, the cross-stack contracts, security rules, definition of done, and links down. Anything that is true of only one surface belongs in that surface's file. If a line would be identical in two files, it belongs in the parent, once.

## Workflow

### Phase 1 — Discover, and verify as you go

Run the discovery block above. Then, for each surface, collect and *check*:
- entry points and config (`vite.config.ts`, `pyproject.toml`, `gst_billing/settings.py`)
- the real commands (package.json scripts, `.github/workflows/test.yml` — CI is the most honest source of "what actually passes")
- the conventions, via grep, with call sites you can name

Do not write anything yet.

### Phase 2 — Find the cross-stack contracts (do not skip)

This is what makes the docs work for backend *and* frontend rather than being two unrelated docs. Find every place where a change on one side silently breaks the other, and name both files:

```bash
# Money rules mirrored in two languages
ls billing/tax_rules.py sweet-rebuild-suite-main/src/utils/taxRules.ts
# Serializer fields the TS types must match
grep -n "fields = " billing/api/serializers.py | head
wc -l sweet-rebuild-suite-main/src/types/api.ts
# Routes the axios client calls
grep -n "path(\|router.register" billing/api/urls.py | head -30
# Duplicated money math - the mechanism behind this repo's repeat bugs
grep -rn "> 1 ?" sweet-rebuild-suite-main/src/ | grep -i "rate\|gst"
```

Each contract becomes a "change both sides" line in the **root** file, with both paths.

### Phase 3 — Write

Use [`templates.md`](templates.md). Fill only from verified findings. Prefer a pointer over a paragraph: `see billing/tax_rules.py` beats re-explaining the rule, and never goes stale.

Every DO cites a real exemplar file. Every DON'T cites the real anti-pattern's path and line. A DON'T you cannot locate is a DON'T you delete.

### Phase 4 — Verify

```bash
.claude/skills/agents-md-generator/verify_agents_md.py          # all AGENTS.md
.claude/skills/agents-md-generator/verify_agents_md.py <file>   # just one
```

It resolves backticked paths (including `@/` aliases), `npm run` scripts,
markdown links, URL routes and image names, and enforces the line caps. To
confirm the verifier itself still works, run it against `selftest.md` in this
directory — that fixture must report 6 problems and exit 1.

Fix everything it reports. Then state in your summary what you verified — including anything you deliberately left out.

## What earns its place

Only content that changes what an agent *does*. Ask: "would an agent do the wrong thing without this line?" If no, cut it.

**Worth writing** (all verified in this repo — re-verify before reuse):
- `pytest` is the test runner; `manage.py test billing` aborts because the empty `billing/tests.py` stub shadows the `billing/tests/` package.
- `vite build` does not typecheck. CI runs `npx tsc --noEmit -p tsconfig.app.json` separately.
- The frontend must run through the Vite dev server for `/api` and `/media` to proxy (`vite.config.ts`); a static build of `dist/` will not reach Django.
- `billing/tax_rules.py` and `src/utils/taxRules.ts` are deliberate mirrors — change both or the preview disagrees with the stored row.
- Money is `Decimal` server-side. Interstate/intra is decided by `tax_rules.is_interstate` (GSTIN, falling back to state name), *not* the GSTIN-only `Invoice.is_igst_applicable` property at `billing/models.py:373`.
- Print/export/import paths are the ones that go stale: a fix applied to the primary write path usually needs the same fix in the import, AI, export, and print copies.
- `gst_billing/local.py` holds both dev and prod DSNs; prod is reachable only with `GST_DB=prod GST_ALLOW_PROD=1`. Never point migrations or `shell` at it.

**Not worth writing:** what the framework docs already say, what `ls` shows in a second, aspirational rules nobody follows, or a changelog. Agent docs describe how to work here *now*.

## Refreshing an existing set

Same law, no shortcuts. Run `verify_agents_md.py` first to find what has rotted, re-run Phase 1 discovery, then diff intent against reality. Delete lines that are no longer true — a stale line is a bug, and leaving it because "it might still be right" is exactly the failure mode above.

## Red flags — stop and verify

- "This is the standard command for this stack" → you have not checked package.json.
- "I'll write the structure now and verify at the end" → you will not; verify per claim.
- "The README says so" → the README is not the filesystem.
- "It was in the old AGENTS.md" → re-verify or delete.
- "Close enough, the agent will figure it out" → then the line is costing tokens and buying nothing.
- Writing a DON'T with no path attached → find the real anti-pattern or cut it.

## Checklist

- [ ] Discovery block run; layout matches (or map updated)
- [ ] Cross-stack contracts found and written into root with both paths
- [ ] Five files written, each under its cap
- [ ] Root contains nothing surface-specific; no line duplicated between root and a child
- [ ] Every DO/DON'T cites a real path
- [ ] `verify_agents_md.py` passes
- [ ] Summary states what was verified and what was left out
