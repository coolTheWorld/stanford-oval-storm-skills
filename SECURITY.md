# Security

This plugin is pure prompt engineering — no runtime code executes on install. Two different kinds of limit apply to it, and it matters which is which:

- **Enforced by tool grant** — the tool set each agent may use. `scripts/check.js` asserts these as exact sets and CI enforces them on every push. A fork that widens a grant fails the check.
- **Instructed by prompt** — where an agent reads and writes, and how it treats fetched text. These are defense in depth against prompt injection, not guarantees. A model can misread an instruction, and a fork can rewrite one.

**Your permission settings are the actual boundary.** The table below tells you what each component is allowed to reach for; your Claude Code permission rules decide whether it gets it.

## What the plugin can do on your machine

| Component | Tools (enforced) | Scope (instructed) |
| --- | --- | --- |
| `storm-researcher` | WebSearch, WebFetch, Write | **No Read** — it cannot look at your local files at all. Because Claude Code requires reading a file before overwriting it, a Read-less agent can only create files, never clobber existing ones. Prompted to write exactly one notes file at the path it is given. |
| `storm-writer` | Read, Write | **No network** — it cannot transmit anything itself. Its `Read` is not path-restricted, so treat the run directory as a channel shared with the other agents. Prompted to write exactly one section file. |
| `storm-expert` | WebSearch, WebFetch, Read | **No Write** — it cannot modify your files. It holds `Read` plus network by necessity (it must read the reference pool to reuse existing `[n]` instead of re-fetching and renumbering); `Read` is not path-restricted, and the prompt directs it to the reference pool only. This is the one agent that could in principle carry local data outward, which is why it is also the one with no write access and an explicit rule never to fetch a URL suggested by page content. |
| Orchestrator / Director | Your session's toolset | The skills run in your main Claude Code session with whatever tools you have, like any skill you invoke. |

Runtime behavior:

- **Network**: research and discussion fetch arbitrary public web pages that your topic surfaces. Every context that ingests fetched text — both orchestrators and all three agents — carries an explicit rule that such content (including titles, snippets, and anything read back from the run directory) is untrusted data, never instructions. Reference titles are sanitized both where they are produced and again where they are merged.
- **Disk**: the prompts direct every write under `storm/<topic>/` in your current project, and the run directory gets a `storm/.gitignore` (`*`) so fetched content stays out of your version control by default. Path discipline is prompt-level; your permission rules are what enforce it.
- **Nothing else**: no telemetry, no external services, no API keys, no install hooks, no MCP servers, no shell commands shipped in the plugin. `scripts/check.js` is a dev-only checker that never runs for plugin users, and CI asserts that none of those component types appear in the repo.

## Running unattended

`--yes` skips the human review gate, and heavy runs make many per-domain fetch prompts. If you plan to auto-approve permissions for a run, remember that the permission system — not these prompts — is the containment boundary: prefer approving interactively, keep auto-approval scoped to the project directory, and do not run storm with permission checks disabled entirely.

## Install provenance

For a prompt-only plugin there is no binary to sign — a fork or typosquat can silently change what the agents are allowed to do. Install only from the canonical repository:

```
/plugin marketplace add coolTheWorld/stanford-oval-storm-skills
/plugin install storm@stanford-oval-storm-skills
```

This project is unofficial and not affiliated with Stanford OVAL, whose GitHub organization publishes the upstream `knowledge-storm`; the marketplace name describes the methodology it reimplements, not its origin. Verify the owner spelling (`coolTheWorld`) before adding the marketplace, and review `agents/*.md` frontmatter after updates if you want to re-verify the grants — they are three short files.

## Hardening in this repo

- Exact-set tool assertions, skill/agent allowlists, an executable-component tripwire (`hooks/`, `commands/`, `.mcp.json`, `mcpServers`/`hooks` manifest keys, stray `.py`/`.sh`), and a dependency-file tripwire in `scripts/check.js`, run by CI on every push and pull request.
- Zero-secret CI: `pull_request` trigger (forks get no secrets and a read-only token), `permissions: contents: read`, job timeouts.
- Append-only reference pool and fetched-before-cited citation discipline across both pipelines.
- `node scripts/check.js --audit <run-dir>` re-verifies a finished run's artifacts mechanically (citation traceability, pool numbering, no `[S#]` leaks), so the pipeline's own claims can be checked without trusting the model that made them.

## Reporting

Open an issue at the canonical repository, or use GitHub's private vulnerability reporting on it if the finding is sensitive.
