# storm plugin — contributor instructions

**`SPEC.md` is the single design document.** Read it before changing anything. When a decision changes, update `SPEC.md` first, then the implementation.

## Hard boundaries (digest — authoritative versions in `SPEC.md` § Boundaries)

- Pure prompt plugin: Markdown + JSON only. Never add runtime dependencies (Python, packages, API keys).
- Tool grants are exact and minimal: writer = Read+Write (no search), expert = WebSearch+WebFetch+Read (no write), researcher = WebSearch+WebFetch+Write (no read). In discuss mode the director is the run directory's single writer from beat 1 onward; in research mode and warm start, researchers and writers write only their own assigned files.
- Citation discipline is non-negotiable: sources are fetched before they are cited; encyclopedias are never citable; search snippets only route.
- `/storm:research` and `/storm:discuss` stay slash-only (`disable-model-invocation: true`).
- Design docs: `SPEC.md` only — no CONTEXT.md, no ADR files. Ask the owner before adding any new documentation file or command.
- `README.md` stays bilingual (English + 中文); executable prompts stay English.

## Dev loop

- Checks: `node scripts/check.js` — SPEC boundary invariants + manifest validation, zero tokens, Node built-ins only; must pass before any push. `--smoke` adds paid headless load checks (a few cents); `--selftest` proves the checker itself can fail; `--audit <run-dir>` verifies a finished run's artifacts (citation traceability, pool integrity) with zero tokens
- CI: `.github/workflows/check.yml` runs `node scripts/check.js --selftest` plus a real marketplace-install test on every push/PR (zero secrets; paid layers never run in CI)
- Live test: `claude --plugin-dir .`, then `/reload-plugins` after edits
- Full test ladder: see `SPEC.md` § Testing Strategy (paid E2E stays manual, pre-release; baseline executor: Sonnet 5 at xhigh effort)
