#!/usr/bin/env python3
"""Verify every machine-checkable claim in the repo's AGENTS.md files.

Checks each backticked token, classified by shape:
  @/foo          -> frontend alias; must resolve under sweet-rebuild-suite-main/src/
  /api/token/    -> URL route; a matching segment must appear in a urls.py or nginx conf
  npm run x      -> the script must exist in the relevant package.json
  path/to/file   -> must exist repo-relative, file-relative, or by basename anywhere
  owner/image    -> must appear in docker-compose.yml or a Dockerfile
Also enforces the per-file line caps from SKILL.md and checks markdown links.

Usage: .claude/skills/agents-md-generator/verify_agents_md.py [file ...]
Exit 0 = clean, 1 = at least one unverifiable claim.
"""
import json
import os
import re
import subprocess
import sys
from pathlib import Path

SKIP_DIRS = {"node_modules", ".venv", ".git", "dist", "__pycache__", "staticfiles", "ios"}
CAPS = {"AGENTS.md": 120, "e2e-tests/AGENTS.md": 60, "deploy/AGENTS.md": 60}
DEFAULT_CAP = 150
FRONTEND = "sweet-rebuild-suite-main"
CODE_CHARS = set('()"\'=<>|$*?{}')
EXT_GUESSES = ["", ".ts", ".tsx", ".js", ".jsx", ".py", ".md"]
KNOWN_EXT = re.compile(r"\.(py|ts|tsx|js|jsx|json|toml|ya?ml|conf|sh|md|lock|html|css|txt)$")


def repo_root() -> Path:
    try:
        out = subprocess.run(["git", "rev-parse", "--show-toplevel"],
                             capture_output=True, text=True, check=True)
        return Path(out.stdout.strip())
    except Exception:
        return Path.cwd()


ROOT = repo_root()


def prune(dirpath, dirnames):
    """Drop skip-dirs and any nested checkout (a dir containing its own .git)."""
    return [d for d in dirnames
            if d not in SKIP_DIRS
            and not (Path(dirpath) / d / ".git").exists()]


def walk_files():
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = prune(dirpath, dirnames)
        for fn in filenames:
            yield Path(dirpath) / fn


_index = None


def index():
    """basename -> True, for every file and directory in the repo."""
    global _index
    if _index is None:
        _index = set()
        for dirpath, dirnames, filenames in os.walk(ROOT):
            for n in list(dirnames) + list(filenames):
                _index.add(n)      # record before pruning: dist/ exists, we just don't descend
            dirnames[:] = prune(dirpath, dirnames)
    return _index


_packages = None


def packages():
    """Every package.json in the repo (node_modules excluded)."""
    global _packages
    if _packages is None:
        _packages = [p for p in walk_files() if p.name == "package.json"]
    return _packages


_haystack = None


def haystack():
    """Concatenated text of routing/compose/CI files, for route + image claims."""
    global _haystack
    if _haystack is None:
        parts = []
        for rel in ["billing/api/urls.py", "gst_billing/urls.py", "docker-compose.yml",
                    "nginx/Dockerfile", "Dockerfile"]:
            p = ROOT / rel
            if p.is_file():
                parts.append(p.read_text(errors="ignore"))
        conf = ROOT / "nginx" / "conf.d"
        if conf.is_dir():
            for c in conf.iterdir():
                parts.append(c.read_text(errors="ignore"))
        wf = ROOT / ".github" / "workflows"
        if wf.is_dir():
            for c in wf.iterdir():
                parts.append(c.read_text(errors="ignore"))
        _haystack = "\n".join(parts)
    return _haystack


def is_ignored(tok: str, base: Path) -> bool:
    """True when git would ignore this path - i.e. a build output or local file
    that is expected to be missing from a clean checkout."""
    cands = {tok}
    try:
        cands.add(str((base / tok).relative_to(ROOT)))
    except ValueError:
        pass
    # Try the trailing-slash form too: a directory-only pattern (`dist/`) does
    # not match a bare `dist` when the directory is absent from the checkout.
    cands |= {c + "/" for c in cands}
    return any(subprocess.run(["git", "check-ignore", "-q", c], cwd=ROOT,
                              capture_output=True).returncode == 0
               for c in cands)


def resolve(tok: str, base: Path) -> bool:
    """True when the token names something that provably exists."""
    if tok.startswith("@/"):
        sub = tok[2:]
        for ext in EXT_GUESSES:
            if (ROOT / FRONTEND / "src" / (sub + ext)).exists():
                return True
        return False

    if tok.startswith("/"):  # URL route, not a filesystem path
        seg = tok.strip("/").split("/")[0]
        return bool(seg) and seg in haystack()

    tok = tok.rstrip("/")
    for cand in (ROOT / tok, base / tok):
        if cand.exists():
            return True

    # A bare name mentioned in prose ("serializers.py", "ui") only has to exist
    # somewhere. A token with directory parts must resolve exactly - otherwise
    # `src/lib/api.ts` would pass on the strength of some other api.ts.
    if "/" not in tok:
        if tok in index():
            return True
    # docker image refs, relative API paths: things the repo states about itself
    elif tok in haystack():
        return True

    # Build outputs and local-only files (dist/, .env, auth-state.json) are
    # gitignored on purpose: absent from a clean checkout, still worth naming.
    # Require the parent dir to exist, or a stale ignore rule (this repo ignores
    # `lib/`) would rubber-stamp a typo like src/lib/api.ts.
    if is_ignored(tok, base):
        return any(c.parent.is_dir() for c in (ROOT / tok, base / tok))
    return False


def check(path: Path, problems: list):
    try:
        rel = str(path.relative_to(ROOT))
    except ValueError:
        rel = str(path)
    base = path.parent
    text = path.read_text()

    cap = CAPS.get(rel, DEFAULT_CAP)
    n = len(text.splitlines())
    if n > cap:
        problems.append(f"{rel}: OVER CAP {n} lines (cap {cap}) — move detail into a child file")

    for raw in set(re.findall(r"`([^`\n]+)`", text)):
        tok = raw.strip()
        if not tok or " " in tok or set(tok) & CODE_CHARS:
            continue
        tok = re.sub(r":\d+$", "", tok)            # strip :line
        if tok.startswith("["):
            continue                                # TOML/section header, not a path
        if "/" not in tok and not KNOWN_EXT.search(tok):
            continue                                # dotted identifier (billing.Invoice), not a path
        if tok.startswith(("http://", "https://", "git@")):
            continue
        if not resolve(tok, base):
            problems.append(f"{rel}: unresolved path claim `{tok}`")

    pkgs = [base / "package.json"] + sorted(packages())
    pkgs = [p for p in pkgs if p.is_file()]
    for script in set(re.findall(r"npm run ([a-zA-Z0-9:_-]+)", text)):
        if not pkgs:
            problems.append(f"{rel}: `npm run {script}` but no package.json to check")
        elif not any(script in json.loads(p.read_text()).get("scripts", {}) for p in pkgs):
            where = ", ".join(str(p.relative_to(ROOT)) for p in pkgs)
            problems.append(f"{rel}: `npm run {script}` not in any of: {where}")

    for pm in ("pnpm", "yarn", "bun run"):
        if re.search(rf"\b{re.escape(pm)}\b", text) and (ROOT / FRONTEND / "package-lock.json").is_file():
            problems.append(f"{rel}: mentions `{pm}` but this repo uses npm (package-lock.json)")

    for link in set(re.findall(r"\]\(([^)]+)\)", text)):
        if link.startswith(("http", "#", "mailto:")):
            continue
        if not ((ROOT / link).exists() or (base / link).exists()):
            problems.append(f"{rel}: broken link ({link})")


def main():
    if len(sys.argv) > 1:
        files = [Path(a).resolve() for a in sys.argv[1:]]
    else:
        files = sorted(p for p in walk_files() if p.name == "AGENTS.md")
    if not files:
        print(f"No AGENTS.md found under {ROOT}")
        return 1

    problems = []
    for f in files:
        if not f.is_file():
            problems.append(f"{f}: missing")
            continue
        check(f, problems)

    for p in problems:
        print("  " + p)
    print()
    if problems:
        print(f"FAILED — {len(problems)} unverifiable claim(s). A wrong line is worse than a missing one.")
        return 1
    print(f"OK — {len(files)} file(s) verified; every path, script and link resolves.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
