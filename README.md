# storm — STORM for Claude Code

[中文](#storm--claude-code-版-storm) | English

A Claude Code plugin that ports the [Stanford STORM](https://github.com/stanford-oval/storm) methodology — multi-perspective question asking, simulated grounded conversations, outline-driven writing — into two commands: `/storm:research` turns a topic into a Wikipedia-style, fully-cited article through parallel multi-perspective research, and `/storm:discuss` (Co-STORM) hosts a moderated expert roundtable you steer beat by beat, wrappable at any point into a cited report.

**Unofficial, native implementation.** It contains no upstream code and needs no Python, no litellm, no search API keys: Claude Code's own WebSearch/WebFetch and subagents play the roles of STORM's LM and retrieval modules (design rationale in [SPEC.md](SPEC.md)).

## Install

```bash
# From GitHub (recommended)
/plugin marketplace add coolTheWorld/oval-storm-skill
/plugin install storm@oval-storm

# Or, for local development
claude --plugin-dir /path/to/oval-storm-skill
```

Install only from this canonical repository (`coolTheWorld/oval-storm-skill`) — for a prompt-only plugin, a fork or typosquat can silently change what the agents are allowed to do. Per-agent tool grants are documented in [SECURITY.md](SECURITY.md).

## Usage

```
/storm:research <topic> [--depth quick|standard|deep] [--lang <language>]
                        [--perspectives N] [--turns N] [--yes] [--fresh]
```

```
/storm:research History of quantum computing --depth deep
/storm:research 量子计算发展史                       # Chinese topic → Chinese article
```

| Flag                    | Meaning                                                                       |
| ----------------------- | ----------------------------------------------------------------------------- |
| `--depth`               | `quick` (2+1 lanes × 2 turns), `standard` (4+1 × 3, default), `deep` (6+1 × 5) |
| `--lang`                | Article language (default: the language the topic is written in)              |
| `--perspectives/--turns`| Fine-grained overrides of the preset                                          |
| `--yes`                 | Skip the perspective gate — fully unattended run                              |
| `--fresh`               | Discard a previous run of the same topic and start over                       |

The command is **slash-only** (the model never auto-triggers it — a run spawns many subagents and hundreds of searches). After the cheap perspective-discovery step it pauses at the **perspective gate** and shows the research plan; you can drop, edit, or add perspectives before the expensive parallel research starts.

### /storm:discuss — the Co-STORM roundtable

```
/storm:discuss <topic> [--experts N] [--beat N] [--lang <language>] [--fresh]
```

Warm start is smart: a topic already researched by `/storm:research` reuses its notes and reference pool for free; otherwise a quick background pass (3 mini-lanes) seeds the mind map. The roundtable then advances one **beat** per reply (default 3 grounded utterances — experts answer, complement, rebut; a moderator injects a fresh angle after 3 unsteered turns). You steer between beats: push back, redirect, say `continue`, or say `generate report` to turn the mind map into a cited `report.md` (the discussion may go on afterwards). Rejoining the same topic resumes with a recap; `--fresh` restarts the discussion but never deletes research artifacts or the reference pool.

## Pipeline

```
topic ─▶ ① perspective discovery ─▶ [gate: you approve/edit the plan]
      ─▶ ② parallel research     one researcher subagent per perspective;
                                 each simulates a questioner×expert conversation,
                                 experts answer only from fetched sources
      ─▶ ③ reference pool        dedupe, global [n] numbering
      ─▶ ④ outline               draft blind, then refine against the notes
      ─▶ ⑤ parallel writing      one writer subagent per section — writers have
                                 no search tools, so no new sources can leak in
      ─▶ ⑥ polish                lead, cross-section dedup ─▶ article.md
```

Citation discipline (strict by design): search snippets only route and are never citable; every cited source was fetched and read; encyclopedias are never citations; unopenable/paywalled pages are excluded; every claim in the article carries a [n] that traces to the reference pool.

## Output

Everything lands in `storm/<topic>/` in your current project (add `storm/` to your `.gitignore` if you don't want run artifacts committed):

```
storm/<topic>/
├── run.json          # parameters + stage status (the resume checkpoint)
├── perspectives.md   # the approved research plan
├── research/*.md     # per-perspective notes: Q&A with sources
├── references.md     # global reference pool, stable [n] numbering
├── outline.md
├── sections/*.md
├── article.md        # the research deliverable
├── mindmap.md        # discuss: hierarchical concept tree (leaves carry [n])
├── discourse.md      # discuss: speaker-tagged roundtable transcript
├── discuss.json      # discuss: session state (roster, counters, beat config)
└── report.md         # discuss: cited takeaway report (regenerable)
```

Interrupted? Run the same `/storm:research <topic>` again — it resumes from the first incomplete stage.

## Roadmap

- `/storm:outline` (pre-writing stages only) and `/storm:rewrite` (re-write from existing notes) — deliberately deferred; added only on demonstrated need.

## Attribution & license

Based on the methodology of the papers [*Assisting in Writing Wikipedia-like Articles From Scratch with Large Language Models*](https://arxiv.org/abs/2402.14207) (NAACL 2024) and [*Into the Unknown Unknowns: Engaged Human Learning through Participation in Language Model Agent Conversations*](https://arxiv.org/abs/2408.15232) (EMNLP 2024) by the Stanford OVAL lab. This project is not affiliated with or endorsed by Stanford; it reimplements the method and shares no code with [`knowledge-storm`](https://github.com/stanford-oval/storm). Licensed under [Apache-2.0](LICENSE).

---

# storm — Claude Code 版 STORM

把 [Stanford STORM](https://github.com/stanford-oval/storm) 的方法论——多视角提问、有据可依的模拟对话、大纲驱动写作——移植成两条 Claude Code 命令：`/storm:research` 对主题做联网深度研究，产出维基风格、全程带引用的长文；`/storm:discuss`（Co-STORM）主持一场你随时可引导的多专家圆桌，随时可收束成带引用的报告。

**非官方原生实现。** 不含上游代码，不需要 Python、litellm 或任何搜索 API key：Claude Code 自带的 WebSearch/WebFetch 与子代理充当了 STORM 中的语言模型与检索模块（设计依据见 [SPEC.md](SPEC.md)）。

## 安装

```bash
# 从 GitHub 安装（推荐）
/plugin marketplace add coolTheWorld/oval-storm-skill
/plugin install storm@oval-storm

# 或本地开发加载
claude --plugin-dir /path/to/oval-storm-skill
```

请只从本仓库（`coolTheWorld/oval-storm-skill`）安装——纯提示词插件的 fork/仿冒仓库可以悄悄改变代理的行为权限。各代理的工具授权见 [SECURITY.md](SECURITY.md)。

## 用法

```
/storm:research <主题> [--depth quick|standard|deep] [--lang <语言>]
                       [--perspectives N] [--turns N] [--yes] [--fresh]
```

| 参数                     | 含义                                                              |
| ------------------------ | ----------------------------------------------------------------- |
| `--depth`                | `quick`（2+1 路 × 2 轮）、`standard`（4+1 × 3，默认）、`deep`（6+1 × 5） |
| `--lang`                 | 成文语言（默认跟随主题输入的语言；检索始终中英不限）              |
| `--perspectives/--turns` | 细粒度覆盖预设                                                    |
| `--yes`                  | 跳过视角关卡，一条命令到底                                        |
| `--fresh`                | 丢弃同主题的既有运行，从头开始                                    |

命令**仅限斜杠显式触发**（一次运行要开几十个子代理、上百次搜索，模型不会自动开跑）。廉价的视角发现完成后会停在**视角关卡**，展示研究计划供你删改视角，确认后才开始烧钱的并行研究。

### /storm:discuss —— Co-STORM 圆桌

```
/storm:discuss <主题> [--experts N] [--beat N] [--lang <语言>] [--fresh]
```

Warm start 是智能的：被 `/storm:research` 研究过的主题免费复用其笔记与引源池，否则先跑一轮快速背景研究（3 路 mini）播种思维导图。此后每次回复推进一拍（默认 3 条有据话语——专家作答、补充、反驳；连续 3 轮无人引导时主持人从未讨论过的引源里注入新角度）。拍与拍之间由你掌舵：追问、反驳、说 `continue` 继续观战，或说 `生成报告` 把思维导图收束成带引用的 `report.md`（之后还能继续聊）。重进同主题自动续聊；`--fresh` 只重置讨论，绝不删研究产物和引源池。

## 管线

视角发现 → 视角关卡（你审改计划）→ 并行研究（每视角一个研究员子代理，内部自演"提问者×专家"，专家只能凭已抓取的来源作答）→ 引源池（去重、全局 [n] 编号）→ 大纲（先盲写再用笔记精化）→ 并行成文（每章节一个写手子代理，写手没有搜索工具，新来源物理上进不来）→ 润色（导语、跨节去重）→ `article.md`。

引用纪律（从严）：搜索摘要只用于选路、不可引用；凡被引用的来源必被抓取读过原文；百科不作引源；打不开/付费墙的页面不引；正文每个论断都带可回溯到引源池的 [n] 角标。

产物全部落在当前项目的 `storm/<主题>/` 下（run.json 为断点，重跑同主题自动续跑；不想提交产物就把 `storm/` 加进 `.gitignore`）。讨论态在同一目录追加 `mindmap.md`（思维导图）、`discourse.md`（话语记录）、`discuss.json`（会话状态）与 `report.md`（报告）；`references.md` 两态共用、只增不删。

## 路线图

- `/storm:outline`（只跑预写作）与 `/storm:rewrite`（用既有笔记改写，不重新研究）——刻意推迟，确有需求再加。

## 归属与许可

基于 Stanford OVAL 实验室两篇论文的方法论（NAACL 2024 与 EMNLP 2024，链接见英文部分）。本项目与 Stanford 无隶属或背书关系，仅复刻方法、不含 [`knowledge-storm`](https://github.com/stanford-oval/storm) 代码。许可证 [Apache-2.0](LICENSE)。
