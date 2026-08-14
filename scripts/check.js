#!/usr/bin/env node
// Boundary checks for the storm plugin — SPEC.md invariants as executable assertions.
// Usage: node scripts/check.js [--smoke] [--selftest]
//        node scripts/check.js --audit <run-dir>
//   (no args)      static checks only: milliseconds, zero tokens
//   --smoke        additionally run paid headless load checks (haiku, a few cents)
//   --selftest     additionally prove the checker can fail (injects violations into a temp copy)
//   --audit <dir>  verify a finished run's artifacts instead (citation traceability, pool
//                  integrity) — zero tokens, so a run's own claims never rest on the model
//                  that produced them
// Node built-ins only — no package.json, no dependencies (SPEC decisions 20–21).
// Canonical runtime: CI's ubuntu runner. Local-environment portability is a non-goal.
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');

const argv = process.argv.slice(2);
const auditAt = argv.indexOf('--audit');
const AUDIT_DIR = auditAt === -1 ? null : argv[auditAt + 1];
const SMOKE = argv.includes('--smoke');
const SELFTEST = argv.includes('--selftest');
const known = ['--smoke', '--selftest', '--audit', AUDIT_DIR];
const unknownArgs = argv.filter((a) => !known.includes(a));
if (unknownArgs.length) {
  console.error(`unknown argument(s): ${unknownArgs.join(' ')}`);
  process.exit(2);
}
if (auditAt !== -1 && !AUDIT_DIR) {
  console.error('--audit requires a run directory');
  process.exit(2);
}

let fails = 0;
const pass = (m) => console.log(`PASS  ${m}`);
const fail = (m) => { console.log(`FAIL  ${m}`); fails += 1; };
const check = (ok, m) => (ok ? pass(m) : fail(m));
const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };

const summary = () => {
  console.log('----');
  if (fails === 0) { console.log('ALL CHECKS PASSED'); process.exit(0); }
  console.log(`${fails} CHECK(S) FAILED`);
  process.exit(1);
};

// --- audit mode: verify a finished run's artifacts ----------------------------
if (AUDIT_DIR) {
  const dir = path.resolve(AUDIT_DIR);
  const at = (f) => path.join(dir, f);
  const nums = (text, re) => new Set((text.match(re) ?? []).map((m) => parseInt(m.replace(/\D/g, ''), 10)));

  check(fs.existsSync(dir), `run directory exists: ${dir}`);

  // A run directory may hold a research run, a discussion, or both. Only a
  // research run owns run.json/perspectives.md; a discussion owns discuss.json
  // and writes warm-start notes under research/, so directory presence alone
  // cannot tell them apart.
  const isResearch = ['run.json', 'outline.md', 'article.md'].some((f) => fs.existsSync(at(f)));
  const isDiscuss = fs.existsSync(at('discuss.json'));
  console.log(`      (mode: ${[isResearch && 'research', isDiscuss && 'discuss'].filter(Boolean).join(' + ') || 'unknown'})`);

  let run = null;
  if (isResearch) {
    try { run = JSON.parse(read(at('run.json')) ?? ''); pass('run.json exists and parses (playbook §0: created at request parse)'); }
    catch { fail('run.json exists and parses (playbook §0: created at request parse)'); }
    check(fs.existsSync(at('perspectives.md')), 'perspectives.md on disk (playbook §1: gate precondition)');
  }
  if (isDiscuss) {
    try { JSON.parse(read(at('discuss.json')) ?? ''); pass('discuss.json exists and parses'); }
    catch { fail('discuss.json exists and parses'); }
  }
  if (run !== null && run.stages && run.stages.research) {
    const lanes = Object.entries(run.stages.research);
    const missing = lanes.filter(([lane, st]) => st === 'done' && !fs.existsSync(at(`research/${lane}.md`)));
    check(missing.length === 0,
      `every lane marked done has its notes file${missing.length ? ` — missing: ${missing.map((l) => l[0]).join(', ')}` : ''}`);
  }

  const pool = read(at('references.md'));
  const poolNums = [];
  const poolUrls = [];
  if (pool === null) {
    fail('references.md exists');
  } else {
    pass('references.md exists');
    for (const line of pool.split(/\r?\n/)) {
      const m = line.match(/^\[(\d+)\]/);
      if (!m) continue;
      poolNums.push(parseInt(m[1], 10));
      const u = line.match(/(https?:\/\/\S+)/);
      if (u) poolUrls.push(u[1]);
    }
    const contiguous = poolNums.length > 0
      && poolNums.every((n, i) => n === i + 1);
    check(contiguous,
      `pool numbering is contiguous from [1] (${poolNums.length} entries, max [${Math.max(0, ...poolNums)}])`);
    const dupes = poolUrls.filter((u, i) => poolUrls.indexOf(u) !== i);
    check(dupes.length === 0, `pool is deduped by URL${dupes.length ? ` — duplicates: ${[...new Set(dupes)].join(', ')}` : ''}`);
    const ency = poolUrls.filter((u) => /wikipedia\.org|baike\.baidu|britannica\.com/i.test(u));
    check(ency.length === 0, `no encyclopedia sources in the pool${ency.length ? ` — found: ${ency.join(', ')}` : ''}`);

    // Advisory, not a verdict: whether an original was reachable is a judgement
    // no script can make. Surfacing the candidates beats trusting the prompt.
    const FARMS = /csdn\.net|zhihu\.com|jianshu\.com|cnblogs\.com|51cto\.com|sohu\.com|163\.com|baijiahao|toutiao\.com|medium\.com|dayanzai/i;
    const farms = poolUrls.filter((u) => FARMS.test(u));
    if (farms.length) {
      console.log(`WARN  ${farms.length} aggregator/repost source(s) in the pool — check the original was unreachable: ${farms.join(', ')}`);
    } else {
      pass('no aggregator/repost sources in the pool');
    }
  }
  const poolSet = new Set(poolNums);

  for (const deliverable of ['article.md', 'report.md']) {
    const text = read(at(deliverable));
    if (text === null) continue;
    const [body, refs] = (() => {
      const i = text.lastIndexOf('## References');
      return i === -1 ? [text, ''] : [text.slice(0, i), text.slice(i)];
    })();
    const cited = nums(body, /\[\d+\]/g);
    const listed = nums(refs, /^\[\d+\]/gm);
    const broken = [...cited].filter((n) => !listed.has(n));
    const uncited = [...listed].filter((n) => !cited.has(n));
    const fabricated = [...cited].filter((n) => !poolSet.has(n));
    check(broken.length === 0, `${deliverable}: every in-text [n] is in its References list${broken.length ? ` — broken: ${broken.join(', ')}` : ` (${cited.size} distinct)`}`);
    check(uncited.length === 0, `${deliverable}: every listed reference is actually cited${uncited.length ? ` — uncited: ${uncited.join(', ')}` : ''}`);
    check(fabricated.length === 0, `${deliverable}: every citation traces to the pool${fabricated.length ? ` — not in pool: ${fabricated.join(', ')}` : ''}`);
    check(!/<!--\s*gap:/.test(text), `${deliverable}: no unresolved <!-- gap --> markers survived polish`);
  }

  for (const f of ['mindmap.md', 'article.md', 'report.md']) {
    const text = read(at(f));
    if (text === null) continue;
    const leaks = text.match(/\[S\d+\]/g) ?? [];
    check(leaks.length === 0, `${f}: no lane-local [S#] tags leaked${leaks.length ? ` — found ${leaks.length}` : ''}`);
  }

  summary();
}

process.chdir(ROOT);

// The declared surface. Growing any of these sets is an owner decision (SPEC Boundaries:
// "Ask first: adding any new command") and requires a deliberate edit here.
const KNOWN_SKILLS = ['research', 'discuss'];
const AGENT_TOOLS = {
  'storm-researcher': ['WebSearch', 'WebFetch', 'Write'],
  'storm-writer': ['Read', 'Write'],
  'storm-expert': ['WebSearch', 'WebFetch', 'Read'],
};
const DEPTH_PRESETS = { quick: [2, 2], standard: [4, 3], deep: [6, 5] };

const sameSet = (a, b) => a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');

// --- tiny frontmatter parser --------------------------------------------------
// Supports `key: value` and YAML list values — the two shapes our files may use.
// Structural on purpose: a reformat from "tools: A, B" to a YAML list must not
// smuggle a tool past the exact-set checks below.
function frontmatter(file) {
  const text = read(file);
  if (text === null) return null;
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/);
  if (!m) return null;
  const fm = {};
  let lastKey = null;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (kv) {
      lastKey = kv[1];
      fm[lastKey] = kv[2].trim();
    } else {
      const item = line.match(/^\s*-\s+(.+)$/);
      if (item && lastKey !== null) {
        if (!Array.isArray(fm[lastKey])) fm[lastKey] = fm[lastKey] === '' ? [] : [fm[lastKey]];
        fm[lastKey].push(item[1].trim());
      }
    }
  }
  return fm;
}

function toolsOf(fm) {
  const t = fm && fm.tools;
  if (!t) return [];
  const arr = Array.isArray(t) ? t : String(t).split(',');
  return arr.map((s) => s.trim()).filter(Boolean);
}

// Walk the repo, skipping .git and run artifacts.
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.git' || e.name === 'storm' || e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else out.push(path.relative(ROOT, p));
  }
  return out;
}
const ALL_FILES = walk(ROOT);

// --- required files -----------------------------------------------------------
const REQUIRED = [
  '.claude-plugin/plugin.json', '.claude-plugin/marketplace.json',
  'skills/research/SKILL.md', 'skills/discuss/SKILL.md',
  'agents/storm-researcher.md', 'agents/storm-writer.md', 'agents/storm-expert.md',
  'SPEC.md', 'README.md', 'AGENTS.md', 'CLAUDE.md', 'LICENSE', 'SECURITY.md',
  '.github/workflows/check.yml',
];
for (const f of REQUIRED) check(fs.existsSync(f), `exists: ${f}`);

// --- SPEC boundary: never add runtime dependencies ----------------------------
const DEP_FILES = ['package-lock.json', 'node_modules', 'requirements.txt',
  'pyproject.toml', 'Pipfile', 'Gemfile', 'Cargo.toml'];
const depsFound = DEP_FILES.filter((f) => fs.existsSync(f))
  .concat(ALL_FILES.filter((f) => path.basename(f) === 'package.json'));
check(depsFound.length === 0,
  `no runtime-dependency files anywhere${depsFound.length ? ` — found: ${depsFound.join(', ')}` : ''}`);

// --- SPEC boundary: no component type that executes on a user's machine -------
// Claude Code loads more than skills and agents: hooks run shell on every tool
// use, .mcp.json launches servers, commands/ registers extra slash commands that
// the slash-only rule below would never see. SECURITY.md promises users none of
// these ship; this is what makes that promise checkable.
const EXEC_PATHS = ['hooks', 'commands', '.mcp.json', 'mcp'];
const execFound = EXEC_PATHS.filter((f) => fs.existsSync(f))
  .concat(ALL_FILES.filter((f) => /\.(py|sh)$/.test(f)));
check(execFound.length === 0,
  `no executable plugin components (hooks/, commands/, .mcp.json, .py, .sh)${execFound.length ? ` — found: ${execFound.join(', ')}` : ''}`);

// --- manifests ----------------------------------------------------------------
let plugin = null;
try { plugin = JSON.parse(read('.claude-plugin/plugin.json') ?? ''); pass('plugin.json is valid JSON'); }
catch { fail('plugin.json is valid JSON'); }
let market = null;
try { market = JSON.parse(read('.claude-plugin/marketplace.json') ?? ''); pass('marketplace.json is valid JSON'); }
catch { fail('marketplace.json is valid JSON'); }
check(plugin !== null && plugin.name === 'storm', "plugin name is 'storm'");
check(plugin !== null && !plugin.hooks && !plugin.mcpServers,
  'plugin.json declares no hooks and no mcpServers');
check(market !== null && market.name === 'stanford-oval-storm-skills', "marketplace name is 'stanford-oval-storm-skills'");
const entry = market && Array.isArray(market.plugins) ? market.plugins[0] : null;
check(entry !== null && entry.name === 'storm' && entry.source === './',
  "marketplace lists plugin 'storm' with source './'");
check(market !== null && /unofficial|not affiliated/i.test(market.description ?? ''),
  'marketplace description carries the unofficial / not-affiliated disclaimer');

// CI must install the coordinate the manifest actually declares.
const ci = read('.github/workflows/check.yml') ?? '';
check(market !== null && ci.includes(`storm@${market.name}`),
  "CI install-test uses the manifest's own coordinate");

// --- SPEC boundary: every skill is slash-only; no unvetted skills -------------
const skillDirs = fs.existsSync('skills')
  ? fs.readdirSync('skills', { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
  : [];
for (const s of KNOWN_SKILLS) {
  const fm = frontmatter(`skills/${s}/SKILL.md`);
  check(fm !== null && fm['disable-model-invocation'] === 'true',
    `skills/${s} is slash-only (disable-model-invocation: true)`);
}
const unknownSkills = skillDirs.filter((d) => !KNOWN_SKILLS.includes(d));
check(unknownSkills.length === 0,
  `no unexpected skills (a new command needs an owner decision + an entry here)${unknownSkills.length ? ` — found: ${unknownSkills.join(', ')}` : ''}`);

// --- SPEC boundary: agent tool grants are exact sets; no unvetted agents ------
const agentFiles = fs.existsSync('agents')
  ? fs.readdirSync('agents').filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3))
  : [];
const unknownAgents = agentFiles.filter((a) => !(a in AGENT_TOOLS));
check(unknownAgents.length === 0,
  `no unexpected agent definitions${unknownAgents.length ? ` — found: ${unknownAgents.join(', ')}` : ''}`);
for (const [agent, wanted] of Object.entries(AGENT_TOOLS)) {
  const fm = frontmatter(`agents/${agent}.md`);
  const tools = toolsOf(fm);
  check(sameSet(tools, wanted), `${agent} tools are exactly [${wanted.join(', ')}]`);
  check(fm !== null && fm.name === agent, `agents/${agent}.md name matches`);
}

// --- SPEC boundary: depth-tier defaults (changing them is "ask first") --------
const researchSkill = read('skills/research/SKILL.md') ?? '';
for (const [tier, [lanes, turns]] of Object.entries(DEPTH_PRESETS)) {
  const row = researchSkill.match(new RegExp(`^\\|\\s*${tier}[^|]*\\|\\s*(\\d+)\\s*\\|\\s*(\\d+)\\s*\\|`, 'm'));
  check(row !== null && Number(row[1]) === lanes && Number(row[2]) === turns,
    `depth preset ${tier} is ${lanes} perspectives × ${turns} turns`);
}

// --- SPEC boundary: single design doc — no links to CONTEXT.md / ADR files ----
const mdFiles = ALL_FILES.filter((f) => f.endsWith('.md'));
const badLinks = mdFiles.filter((f) => /\]\((\.\/)?(CONTEXT\.md|docs\/adr)/.test(read(f) ?? ''));
check(badLinks.length === 0,
  `no markdown links to CONTEXT.md or docs/adr (SPEC is the single design doc)${badLinks.length ? ` — offenders: ${badLinks.join(', ')}` : ''}`);

// --- docs hygiene: relative links resolve, versions agree --------------------
const brokenLinks = [];
for (const f of mdFiles) {
  for (const m of (read(f) ?? '').matchAll(/\]\(([^)#\s]+)\)/g)) {
    const target = m[1];
    if (/^(https?:|mailto:|#)/.test(target)) continue;
    if (!fs.existsSync(path.resolve(path.dirname(path.join(ROOT, f)), target))) {
      brokenLinks.push(`${f} -> ${target}`);
    }
  }
}
check(brokenLinks.length === 0,
  `every relative markdown link resolves${brokenLinks.length ? ` — broken: ${brokenLinks.join(', ')}` : ''}`);
check(plugin !== null && (read('SPEC.md') ?? '').includes(`v${plugin.version}`),
  `SPEC.md mentions the shipped version (v${plugin && plugin.version})`);

// --- bilingual README ---------------------------------------------------------
const readme = read('README.md') ?? '';
check(/^## Install/m.test(readme) && /^## 安装/m.test(readme),
  'README is bilingual (## Install + ## 安装)');

// --- official validation: must pass with zero warnings ------------------------
{
  let out = null;
  try {
    out = execFileSync('claude', ['plugin', 'validate', '.'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    if (e.code === 'ENOENT') fail('claude plugin validate: claude CLI not found on PATH');
    else out = `${e.stdout ?? ''}${e.stderr ?? ''}`;
  }
  if (out !== null) {
    check(out.includes('Validation passed') && !/warning/i.test(out),
      'claude plugin validate: passed with zero warnings');
  }
}

// --- optional paid smoke layer ------------------------------------------------
if (SMOKE) {
  const HAIKU = 'claude-haiku-4-5-20251001';
  const run = (prompt) => {
    try {
      return execFileSync('claude',
        ['--plugin-dir', '.', '--model', HAIKU, '-p', prompt],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) { return `${e.stdout ?? ''}${e.stderr ?? ''}`; }
  };
  const aout = run("Do not use any tools. Name every agent whose name contains 'storm'. Plain list.");
  for (const a of Object.keys(AGENT_TOOLS)) {
    check(aout.includes(a), `smoke: agent ${a} loads`);
  }
  for (const s of KNOWN_SKILLS) {
    check(/topic/i.test(run(`/storm:${s}`)), `smoke: /storm:${s} registered (asks for a topic)`);
  }
}

// --- optional validator self-test ---------------------------------------------
// Prove the checker is capable of failing: inject four boundary violations into a
// temp copy — one in YAML-list form, one an executable component that Claude Code
// really does load — and assert the copy's run goes red with exactly those checks.
if (SELFTEST) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'storm-check-'));
  fs.cpSync('.', tmp, {
    recursive: true,
    filter: (src) => {
      const rel = path.relative(ROOT, src);
      return !(rel === '.git' || rel.startsWith(`.git${path.sep}`)
            || rel === 'storm' || rel.startsWith(`storm${path.sep}`));
    },
  });

  const injectionErrors = [];
  const inject = (file, pattern, replacement) => {
    const p = path.join(tmp, file);
    const before = fs.readFileSync(p, 'utf8');
    const after = before.replace(pattern, replacement);
    if (after === before) injectionErrors.push(`injection no-oped (anchor drifted?): ${file} ${pattern}`);
    else fs.writeFileSync(p, after);
  };
  inject('agents/storm-writer.md', /^tools: Read, Write$/m, 'tools: Read, Write, WebSearch');
  inject('skills/research/SKILL.md', /^disable-model-invocation: true\r?\n/m, '');
  inject('agents/storm-expert.md', /^tools: WebSearch, WebFetch, Read$/m,
    'tools:\n  - WebSearch\n  - WebFetch\n  - Read\n  - Write');
  fs.mkdirSync(path.join(tmp, 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'hooks/hooks.json'), '{"PreToolUse":[]}\n');

  let out = '';
  let status = 0;
  try {
    out = execFileSync('node', [path.join(tmp, 'scripts/check.js')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    out = `${e.stdout ?? ''}${e.stderr ?? ''}`;
    status = e.status ?? 1;
  }
  const expected = [
    'FAIL  storm-writer tools are exactly [Read, Write]',
    'FAIL  skills/research is slash-only',
    'FAIL  storm-expert tools are exactly [WebSearch, WebFetch, Read]',
    'FAIL  no executable plugin components',
  ];
  const missing = expected.filter((line) => !out.includes(line));
  check(injectionErrors.length === 0 && status !== 0 && missing.length === 0,
    `selftest: 4 injected violations (YAML-list tool smuggling, a loadable hooks/ component) turn the checker red (exit ${status})`
    + (injectionErrors.length ? ` — ${injectionErrors.join('; ')}` : '')
    + (missing.length ? ` — missing: ${missing.join(' | ')}` : ''));
  fs.rmSync(tmp, { recursive: true, force: true });
}

summary();
