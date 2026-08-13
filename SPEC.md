# Spec: storm — STORM for Claude Code

> **Provenance.** Consolidated in English from the interactive design sessions of 2026-08-12 (`/grilling` decision-tree walks: the v1 pipeline, then the Co-STORM extension). Every decision below was resolved with the owner *before* implementation; v0.1.0 implements decisions 1–12, v0.2.0 adds 13–24. This is a living document and the repo's **single design document**: update it first when a decision changes. The decision table below is the full decision record.

## Objective

Port the Stanford STORM methodology (multi-perspective question asking, simulated grounded conversations, outline-driven writing) natively into Claude Code: one slash command takes a topic, researches it on the live web through parallel perspective agents, and delivers a Wikipedia-style, fully-cited long-form article plus an auditable research trail.

v0.2.0 adds the Co-STORM half: `/storm:discuss` hosts a moderated multi-expert roundtable on a topic — the user steers between beats, a dynamic mind map organizes what has been established, and at any point the discussion can wrap into a cited `report.md`.

- **Users:** any Claude Code user. Zero setup: no Python, no litellm, no search API keys.
- **Positioning:** unofficial native re-implementation of the method; shares no code with `knowledge-storm`.
- **Success:** see [Success Criteria](#success-criteria).

## Design Decisions (consolidated from the design session)

| # | Decision | Chosen | Rejected alternatives (why) |
|---|----------|--------|------------------------------|
| 1 | Implementation route | Native re-implementation: skills + agents + built-in WebSearch/WebFetch. Claude Code's model + native search naturally play STORM's LM + RM roles — zero-config for users | Wrapping `knowledge-storm` pip package (fragile install chain, extra API keys, double billing); hybrid bridge (double maintenance surface) |
| 2 | v1 scope | STORM batch pipeline only | Co-STORM in v1 (different interaction model, doubles scope); reserved as `/storm:discuss` v2 |
| 3 | Pipeline fidelity | Full five stages: perspective discovery → simulated questioner×expert conversations (search-before-answer) → two-step outline (draft blind, then refine against notes) → per-section writing → polish (lead + dedup) | Dropping the conversation mechanism (loses follow-up depth and citation discipline — the paper's biggest ablation win); free-form deep-research prompt |
| 4 | Execution topology | Parallel researcher subagent per lane; parallel writer subagent per section; orchestrator (main thread) does discovery, outline, polish; **disk is the inter-stage interface** | Sequential main-thread writing (context blowup, slow); everything sequential |
| 5 | Citation discipline | Strict: snippets route only (never citable); fetched-before-cited; encyclopedias never citable (orientation only); unopenable/paywalled pages excluded; `[n]` markers + References section | Medium/loose tiers (snippet hallucination leaks in; undermines the "Wikipedia-grade" positioning) |
| 6 | Artifacts & resume | Everything under `storm/<slug>/`; `run.json` records stage state; rerunning the same topic auto-resumes; `--fresh` restarts; param mismatch → ask | Keep only `article.md` (no audit, no resume); no resume (interrupted runs burn money) |
| 7 | Plugin form | Single plugin `storm`, multiple skills (`/storm:research` now, `/storm:discuss` later) — mirrors upstream's one-package-two-engines shape; shared agents | Two plugins `storm` + `co-storm` (marketplace-layout repo, duplicated agent definitions, only brand symmetry gained) |
| 8 | Command surface | Minimal: only pipeline-starting actions get commands. v1 ships exactly one. Verb `research` (industry-aligned "deep research"). Status/list/continue are deliberately *not* commands (chat + auto-resume cover them) | `write` (understates research), `explore` (no deliverable connotation, clashes with future `discuss`); `/storm:outline`, `/storm:rewrite` deferred until demonstrated need (re-affirmed 2026-08-12; future shape pre-agreed as research flags, not commands — see Open Questions) |
| 9 | Trigger policy | Slash-only (`disable-model-invocation: true`): a run spawns dozens of subagents and hundreds of fetches — heavy paid operations require informed consent. Model may suggest, never auto-start | Model-invocable (accidental-trigger cost risk); reversible via one frontmatter line if it proves inconvenient |
| 10 | Scale control | Depth tiers — quick: 2+1 lanes × 2 turns, 3–5 sections; standard (default): 4+1 × 3, 5–8; deep: 6+1 × 5, 8–12 — plus `--perspectives/--turns` overrides. **Perspective gate**: pause after cheap discovery so the user can drop/edit/add lanes; `--yes` skips (a slice of Co-STORM's human steering, brought forward) | No tiers (single default); no gate (wrong direction discovered only after the money is spent) |
| 11 | Language policy | Article language follows the topic's language (`--lang` overrides). Research is language-unrestricted (at least topic language + English). Source titles stay in their original language | Coupling research language to article language (starves citation quality for non-English topics); always-English articles |
| 12 | Distribution | Repo = plugin = self-listing marketplace (`plugin.json` + `marketplace.json`); bilingual README (EN + 中文); v0.1.0; Apache-2.0; papers credited, "unofficial, no upstream code" stated | Plugin without marketplace manifest (extra friction for installers); community-marketplace submission deferred (manual form; owner's future call) |
| 13 | Discuss interaction model | Beat-based: each assistant turn advances one **beat** (default 3 utterances — e.g. expert answers → second expert complements/rebuts → follow-up or moderator question), then yields. The user's reply steers the discourse, says "continue", or asks for the report; `--beat N` adjusts | One utterance per turn (latency-dominated, low information density); auto-running many rounds (loses human steering — degrades into a slow `/storm:research`) |
| 14 | Discuss grounding topology | Hybrid: the main thread is the discourse director — voices all speakers, runs moderator logic, maintains the mind map; each grounded expert answer delegates search+fetch to the lightweight **storm-expert** agent (single-shot grounded Q&A → content block + sources), which the director polishes into the speaker's voice. Mirrors upstream's QA-LM / utterance-polishing-LM split. Raw search results never enter main context | All main-thread (context blowup over long discussions); fully agent-voiced experts (per-utterance context shipping, broken voice continuity) |
| 15 | Warm start | Smart: if same-topic `/storm:research` artifacts exist, reuse them free (mind map seeded from research notes, roster derived from `perspectives.md`, reference numbering continues); otherwise upstream-shaped mini research (3 lanes × 2 turns via storm-researcher) → initial mind map + pool → moderator opening | Always re-researching (wastes the single-plugin synergy of decision 7); cold start (paper: no shared conceptual space, weak opening beats) |
| 16 | Discuss artifacts | Colocated in `storm/<slug>/`: `mindmap.md` (hierarchical concept tree, leaves carry [n]; a node holding >~10 items splits into subtopics), `discourse.md` (speaker-tagged transcript, human interjections marked), `discuss.json` (roster, moderator counter, beat config), `report.md`. `references.md` is shared with research mode — append-only global numbering. Rejoining the same topic resumes with a recap; `--fresh` clears only the four discuss files, never research artifacts or the pool | Separate `storm-discuss/` directory (breaks shared [n] numbering, cross-directory warm start); session-only state (a disconnect loses everything — violates the resume philosophy of decision 6) |
| 17 | Report generation | In-discussion trigger phrase ("generate report") — no new global command (decision 8's minimal surface). Mind map is the outline skeleton with human-probed branches weighted up; reuses storm-writer per section in parallel + main-thread polish → `report.md`. Discussion may continue afterwards; regenerating overwrites (history belongs to git) | `/storm:report` command (meaningless outside a live discussion; widens the command surface); auto-generate on exit (chat has no exit signal; not every discussion needs a report) |
| 18 | Discuss interface | `/storm:discuss <topic> [--experts N] [--beat N] [--lang <language>] [--fresh]`; defaults mirror upstream — roster 4, ≤2 experts active per beat, moderator injects a fresh angle from undiscussed sources after 3 consecutive expert-answer turns without substantive human steering; slash-only (`disable-model-invocation: true`); **no opening gate** — the user is present at every beat, warm start costs less than a quick research run, and the roster is shown before beat 1 and editable by chat. Version 0.1.0 → 0.2.0 | Opening gate (an extra interruption with little value in an interactive mode); frozen knobs (no `--experts/--beat`) |
| 19 | Agent instruction files | Dual-file: `AGENTS.md` (open cross-tool standard) holds the ~15-line contributor digest — "SPEC.md is the single design document", boundary digest, dev loop; `CLAUDE.md` is a one-line `@AGENTS.md` import (the official interop pattern — Claude Code natively reads only CLAUDE.md). These are session-loading infrastructure for *contributors working in this repo* — plugin installers never see them (Claude Code loads only plugin components: `skills/`, `agents/`, manifests; a plugin cannot inject CLAUDE.md-style instructions into its users' sessions, by design); design content stays exclusively in this SPEC | CLAUDE.md only (ties the digest to one tool; owner prefers the open standard); `@SPEC.md` import (would inject the whole spec into every session's launch context); nothing (fresh sessions, machines, and contributors lose the boundary discipline) |
| 20 | Testing | Guard script `scripts/check.js` (Node built-ins only, no package.json — Node is already the workflow's hard dependency for installing the CLI): the SPEC's mechanical invariants as deterministic zero-token assertions with *structural* frontmatter parsing — tool restrictions are checked against the parsed tools list in both `key: value` and YAML-list forms, so reformatting can't smuggle a tool past the guard (proven by an injected list-format violation); `--smoke` wraps the paid haiku load checks; `--selftest` proves fail-capability by injected violations (exit 1). Conventional TDD/unit frameworks don't apply — no executable code, and LLM behavior can't be asserted deterministically; paid E2E stays manual pre-release | A test framework (nothing to unit-test; a dependency would contradict decision 1's zero-dep stance); no automation (a frontmatter boundary regression passes `claude plugin validate` silently — schema checks don't know our design rules); the original bash version (text-shape greps fail open when frontmatter is reformatted to YAML lists — retired after the Node port); Python (a second CI runtime where Node is already required) |
| 21 | CI | Zero-secret GitHub Actions workflow, modeled on addyosmani/agent-skills' `test-plugin-install.yml` (which proved `claude plugin validate` and `plugin install` run keyless in CI): job 1 = `node scripts/check.js --selftest` (boundary checks + the checker's own fail-proof, their validator-self-test idea), job 2 = real installability test of the repo-as-marketplace chain (`marketplace add ./` → `install storm@stanford-oval-storm-skills`) — the one path no other layer exercised; verified step-by-step locally with clean rollback. Paid layers (`--smoke`, E2E) never run in CI | Adopting their evals scaffolding (empty even upstream; our behavioral layer is decision 20's manual E2E); cross-tool command-parity checks (single-tool repo); `--smoke` in CI (needs a paid API key — breaks the zero-secret stance) |
| 22 | Researcher least-privilege + SECURITY.md | Dropped the unused `Read` grant from storm-researcher (`tools: WebSearch, WebFetch, Write`) after the pre-push security audit flagged Read+WebFetch in one agent as a latent read-local-then-exfiltrate primitive a malicious fork could weaponize. Enabling change: orchestrators delete a failed lane's leftover notes before respawning, since Write-tool overwrites require a prior Read the agent no longer has. `SECURITY.md` documents per-agent grants, runtime behavior, and install provenance; README links it from both Install sections | Keeping `Read` "just in case" (unused capability is pure attack surface); documenting grants without shrinking them |
| 23 | E2E hardening | The first two real quick runs (2026-08-12) A/B-tested executor robustness on an identical playbook: a Haiku orchestrator skipped every state-file step (`run.json` never created, `perspectives.md` claimed-but-not-written, `storm/.gitignore` skipped) and botched the References consistency pass (3 uncited entries listed); a Sonnet orchestrator passed all of it unaided. Hardened the research playbook with three explicit commands — create `run.json` immediately at request parse (§0); the perspective gate requires `perspectives.md` on disk first (§1); the polish consistency pass is mechanical, extracting cited numbers from the assembled text, never from memory (§6). Plugin bumped to 0.2.1 | Hardening #4, banning social-media/content-farm sources beyond the existing "prefer primary" rule (deferred: strong executors already comply; revisit if weak-executor runs recur); pinning a recommended orchestrator model in README (doesn't raise the floor) |
| 24 | E2E baseline model | The manual E2E layer's baseline executor is pinned to Sonnet 5 at xhigh reasoning effort: per-run success criteria are accepted only on runs executed with this configuration (the setup of the passing 2026-08-12 run). Runs on other executors — cheaper or stronger — are robustness probes whose findings feed hardening (decision 23), never acceptance. The baseline is declared user-facing in README (both languages) as a transparency note — an addition to decision 23's hardening, not the rejected substitute for it | Haiku as baseline (decision 23's A/B proved it skips protocol steps); leaving the baseline unpinned (runs on different executors produced incomparable results) |

## Tech Stack

Pure prompt-engineering plugin — Markdown and JSON only. No runtime code, no build step, no dependencies.

- Claude Code plugin system: `.claude-plugin/plugin.json`, `skills/`, `agents/`
- Native tools: WebSearch, WebFetch, subagent parallelism (Task/Agent), Read/Write
- Verified against Claude Code CLI 2.1.228

## Commands

```bash
# Development
node scripts/check.js             # boundary invariants + validate — zero tokens, must pass before push
node scripts/check.js --smoke     # + paid headless load checks (haiku, a few cents)
node scripts/check.js --selftest  # + prove the checker itself can fail (injected violations)
claude plugin validate .        # official validation alone (also run inside check.js)
claude --plugin-dir .           # load locally for a live session
/reload-plugins                 # pick up prompt edits inside a session

# Headless smoke checks (cheap, haiku)
claude --plugin-dir . --model claude-haiku-4-5-20251001 -p \
  "Do not use any tools. Name every agent whose name contains 'storm'."
claude --plugin-dir . --model claude-haiku-4-5-20251001 -p "/storm:research"

# End-user
/storm:research <topic> [--depth quick|standard|deep] [--lang <language>]
                        [--perspectives N] [--turns N] [--yes] [--fresh]
/storm:discuss  <topic> [--experts N] [--beat N] [--lang <language>] [--fresh]
# inside a discussion: reply to steer, "continue" to observe, "generate report" to wrap up
```

## Project Structure

```
.claude-plugin/plugin.json      → plugin manifest (name: storm, v0.2.1)
.claude-plugin/marketplace.json → self-listing marketplace (stanford-oval-storm-skills)
skills/research/SKILL.md        → research orchestrator: five stages, gate,
                                  run.json resume protocol, depth presets
skills/discuss/SKILL.md         → discourse director: beats, moderator logic,
                                  mind map maintenance, warm start, report
agents/storm-researcher.md      → researcher role (WebSearch/WebFetch/Write — no
                                  Read: least privilege, decision 22)
SECURITY.md                     → per-agent tool grants, runtime behavior,
                                  install provenance, reporting
agents/storm-writer.md          → writer role (Read/Write ONLY — no search, by design)
agents/storm-expert.md          → discuss-mode grounding role: single-shot grounded
                                  Q&A (WebSearch/WebFetch/Read — no Write; the
                                  director is the run directory's single writer)
SPEC.md                         → this file (the single design document)
AGENTS.md                       → contributor digest (open standard): points to
                                  SPEC.md, boundary summary, dev loop
CLAUDE.md                       → one-line @AGENTS.md import (Claude Code interop)
scripts/check.js                → boundary guard: SPEC invariants as structural
                                  assertions, Node built-ins only, no package.json
                                  (--smoke paid load checks; --selftest fail-proof)
.github/workflows/check.yml     → zero-secret CI: check.js --selftest + real
                                  marketplace install test on push/PR
README.md                       → bilingual user documentation
storm/                          → runtime artifacts when run in this repo (gitignored)
```

Runtime artifact layout (created in the *user's* project at run time):

```
storm/<topic-slug>/
├── run.json          # params + per-stage/per-lane/per-section status (resume checkpoint)
├── perspectives.md   # the approved research plan
├── research/*.md     # per-lane notes: Q&A, claims tagged with lane-local [S#]
├── references.md     # global reference pool; maps lane [S#] → stable global [n]
├── outline.md        # H2 sections + scope bullets + likely-reference hints
├── sections/*.md     # one file per section, citing global [n]
└── article.md        # deliverable: lead + sections + References (cited [n] only, gaps allowed)
```

Discuss mode adds four colocated files to the same run directory (`references.md` is shared, append-only):

```
storm/<topic-slug>/
├── mindmap.md        # hierarchical concept tree; leaves carry [n]; overloaded nodes split
├── discourse.md      # speaker-tagged transcript with [n] citations; human turns marked
├── discuss.json      # roster, moderator counter, beat config, warm-start provenance
├── report-outline.md # report skeleton derived from the mind map (report time only)
└── report.md         # cited takeaway report; regenerable snapshot (overwrites)
                      # (report sections land in sections/report-<nn>-*.md)
```

## Code Style

All executable prompts (SKILL.md, agents/*.md) are written in **English**, imperative second person, with output-language rules embedded. User-facing docs are bilingual, English first.

Canonical terminology (use these words consistently across all prompts and docs):

- **Run** — one topic→article execution; all artifacts under its run directory; resumable.
- **Perspective / Lane** — a persona-bound interrogation angle; lanes = discovered perspectives + the fixed *Foundational Facts* lane.
- **Simulated Conversation** — the multi-turn questioner×expert Q&A inside one lane; the expert answers only from fetched sources.
- **Research Notes** — a lane's distilled output: questions, answers, and their sources.
- **Reference Pool** — the run-wide registry of deduplicated sources with stable global `[n]` numbering.
- **Perspective Gate** — the confirmation pause between cheap discovery and expensive parallel research.
- **Depth** — the scale preset (quick / standard / deep).
- **Orchestrator / Researcher / Writer / Expert** — the execution roles (main thread; per-lane agent; per-section agent; per-utterance grounding agent in discuss mode).
- **Discourse** — the running roundtable conversation in discuss mode: speaker-tagged, citation-carrying utterances.
- **Beat** — one assistant turn's advance of the discourse (default 3 utterances) before yielding to the user.
- **Expert Roster** — the per-topic cast of expert personas; at most 2 active within a beat.
- **Moderator** — the director behavior that injects a fresh angle drawn from undiscussed sources after 3 consecutive expert-answer turns without substantive human steering.
- **Mind Map** — the hierarchical concept tree organizing established information; overloaded nodes split; the report's skeleton.
- **Warm Start** — pre-discussion seeding of mind map and roster, by reusing research artifacts or a mini research pass.
- **Report** — the cited takeaway document generated from the mind map on request; a regenerable snapshot of the discussion.

Representative style (from `agents/storm-writer.md`):

```markdown
---
name: storm-writer
description: STORM section writer. Writes one article section strictly from the
  run's research notes and shared reference pool — it has no search tools by
  design, so it cannot introduce new sources.
tools: Read, Write
---

You write exactly one section of a STORM article. …
You have no search tools, deliberately. The research stage is over; your entire
universe of admissible facts is what is on disk.
```

Conventions: tool restrictions encode policy (don't just instruct — remove the tool); frontmatter `description` states both *what* and *when spawned*; stage contracts name exact file paths; hard rules live in a dedicated section at the end of the orchestrator playbook.

## Testing Strategy

No code → no unit-test framework. Layered verification instead:

1. **Static guard (`node scripts/check.js`, Node built-ins only)** — zero tokens, milliseconds: every mechanical SPEC invariant as an executable assertion (agent tool restrictions asserted on *parsed* frontmatter — both `key: value` and YAML-list forms, so a reformat can't smuggle a tool past the check; slash-only frontmatter for every skill found by scan; allowlists for skills and agents, so an unvetted addition fails the run; a runtime-dependency-file tripwire; manifest validity including the marketplace install coordinate; single-design-doc link hygiene; bilingual README) plus `claude plugin validate .` with zero warnings. Proven able to fail: `--selftest` injects violations into a temp copy and asserts the copy's run goes red with exit 1. The checker's canonical runtime is CI's ubuntu runner; local-environment portability (e.g. Windows command shims) is a non-goal.
2. **Load smoke (`node scripts/check.js --smoke`, cheap)** — headless haiku: all three agents load under the `storm:` namespace; `/storm:research` and `/storm:discuss` each invoke their playbook (ask for a topic). The skills stay absent from the model-side listing (correct: slash-only — observed manually; the smoke layer does not assert it).
3. **E2E (paid, manual, before releases; baseline executor: Sonnet 5 at xhigh effort, decision 24)** — `/storm:research <small topic> --depth quick`, then assert: artifact tree complete; every `[n]` in `article.md` traces to `references.md`; no encyclopedia citations; interrupting and rerunning resumes without redoing completed stages; the gate accepts lane edits. For discuss: `/storm:discuss` on the same topic must reuse the research artifacts as warm start; one beat yields ≤3 grounded utterances; "generate report" produces `report.md` with traceable `[n]`.

Rerun layers 1–2 after any prompt edit; layer 3 before tagging a release. CI (`.github/workflows/check.yml`, zero secrets — modeled on addyosmani/agent-skills) runs layer 1 plus the selftest and a real installability test (`marketplace add ./` → `plugin install storm@stanford-oval-storm-skills`) on every push/PR; the paid layers never run in CI.

## Boundaries

- **Always:** use the canonical terminology (see Code Style) in all prompts and docs; run `claude plugin validate .` before pushing; keep global `[n]` numbering stable/auditable against `references.md`; update this SPEC when a decision changes; keep `/storm:research` slash-only.
- **Ask first:** adding any new command (the command surface is deliberately minimal); loosening citation discipline; changing depth-tier defaults; submitting to the community marketplace; any git commit/push.
- **Never:** add runtime dependencies (Python, packages, API keys) — that silently reverses design decision #1; give writer agents search tools; cite encyclopedias as references; make the pipeline model-invocable; copy code from `knowledge-storm` (the README's "no upstream code" claim and license cleanliness depend on it).

## Success Criteria

v0.1.0 (all verified on 2026-08-12):

- [x] `claude plugin validate .` passes with zero warnings
- [x] Both agents load in a real session under the `storm:` namespace
- [x] `/storm:research` registers as a slash command; empty-arg invocation shows the orchestrator behaving per playbook (asks for topic, lists flags)
- [x] Bilingual README with install/usage/pipeline/attribution
- [x] The full design-decision record is consolidated in this SPEC

v0.2.0 (all verified on 2026-08-12):

- [x] `claude plugin validate .` still passes with zero warnings
- [x] `storm-expert` loads alongside the other agents under the `storm:` namespace
- [x] `/storm:discuss` registers as a slash command; empty-arg invocation shows the director behaving per playbook
- [x] `scripts/check.js` (Node port of the original bash guard) passes — 33 static checks — and `--selftest` proves it fails with exit 1 on three injected violations, one in YAML-list form
- [x] Structural frontmatter parsing catches YAML-list tool smuggling that the bash text-shape greps missed (proven with an injected list-format violation)
- [x] Repo-as-marketplace install chain verified locally: `marketplace add ./` → `install storm@stanford-oval-storm-skills` → uninstall/remove leaves config clean
- [x] CI workflow green on GitHub — first run passed on commit 5b164c9 (2026-08-12): boundary checks + selftest job and the real marketplace install-test job

Per-run (qualitative, checked at E2E on the baseline executor — decision 24):

- [x] First real `--depth quick` end-to-end run produces a complete artifact tree with every claim's `[n]` traceable to a fetched source — verified 2026-08-12 on a Sonnet-executed run (28/28 citations traceable, zero broken or fabricated, all state files written unaided); an earlier Haiku-executed run surfaced the executor-robustness gaps closed by decision 23
- [x] An interrupted run resumes from the first incomplete stage — verified 2026-08-13 on the baseline executor (RSS的兴衰 quick run: Esc after the research stage, then `/clear` so resume could rely only on disk). Evidence from artifacts + session transcripts: the fresh session announced "resuming from stage 3 (reference pool)" and cross-checked artifacts before trusting run.json; exact spawn counts were 3 researchers + 0 writers before the interrupt, 0 researchers + 5 writers after (zero re-research, notes mtimes untouched); the finished article passed the citation audit 23/23 clean
- [ ] A discussion on a previously-researched topic warm-starts from the existing artifacts, holds beats of ≤3 grounded utterances, and wraps into a traceable `report.md`

## Open Questions

- Community-marketplace submission — owner's call; materials are validation-ready.
- Outline-stop and write-side-rewrite capabilities — still deferred; the need has not materialized (re-examined 2026-08-12 after two real E2E runs surfaced no such pain — the impulse traced back to the README's own Roadmap section, which was removed for reading as a promise). Future shape is pre-agreed to avoid re-litigation: **flags on `/storm:research`, not new commands** — `--until-outline` stops after §4 (existing resume later continues into writing; zero new state semantics), `--rewrite` reopens only the write-side stages (sections + polish) with research artifacts and the append-only pool untouched, old output overwritten (history belongs to git). Not commands because playbooks cannot import across skill files: a separate outline command would duplicate §0–§4 wholesale and drift.
- The paid E2E runs (layer 3, both modes) have not been executed yet — only static + smoke layers have.
- Mind-map weighting for the report (how strongly human-probed branches expand) may need tuning after real discussions.
