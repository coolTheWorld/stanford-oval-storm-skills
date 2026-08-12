# Security

This plugin is pure prompt engineering — no runtime code executes on install. What it *can* do is defined entirely by the tool grants below, which `scripts/check.js` asserts as exact sets and CI enforces on every push.

## What the plugin can do on your machine

| Component | Tools | Why |
| --- | --- | --- |
| `storm-researcher` | WebSearch, WebFetch, Write | Grounded research; writes only its own notes file. **No Read** — it cannot look at your local files. |
| `storm-writer` | Read, Write | Writes one article section from on-disk notes. **No network** — it cannot fetch or leak anything. |
| `storm-expert` | WebSearch, WebFetch, Read | Single grounded answer; reads only the reference pool. **No Write** — it cannot touch your files. |
| Orchestrator / Director | Your session's toolset | The skills run in your main Claude Code session, like any skill you invoke. |

Runtime behavior:

- **Network**: research and discussion fetch arbitrary public web pages that your topic surfaces. Every web-facing prompt carries an explicit rule that fetched content (including titles and snippets) is untrusted data, never instructions; reference titles are sanitized before entering artifacts.
- **Disk**: artifacts are written only under `storm/<topic>/` in your current project, and the run directory gets a `storm/.gitignore` (`*`) so fetched content stays out of your version control by default.
- **Nothing else**: no telemetry, no external services, no API keys, no install hooks. `scripts/check.js` is a dev-only checker and never runs for plugin users.

## Install provenance

For a prompt-only plugin there is no binary to sign — a fork or typosquat can silently change what the agents are allowed to do. Install only from the canonical repository:

```
/plugin marketplace add coolTheWorld/stanford-oval-storm-skills
/plugin install storm@oval-storm
```

Verify the owner spelling (`coolTheWorld`) before adding the marketplace, and review `agents/*.md` frontmatter after updates if you want to re-verify the grants — they are three short files.

## Hardening in this repo

- Exact-set tool assertions, skill/agent allowlists, and a dependency-file tripwire in `scripts/check.js`, run by CI on every push and pull request.
- Zero-secret CI: `pull_request` trigger (forks get no secrets and a read-only token), `permissions: contents: read`, job timeouts.
- Append-only reference pool and fetched-before-cited citation discipline across both pipelines.

## Reporting

Open an issue at the canonical repository, or use GitHub's private vulnerability reporting on it if the finding is sensitive.
