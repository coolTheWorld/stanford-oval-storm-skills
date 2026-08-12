#!/usr/bin/env node
// Boundary checks for the storm plugin — SPEC.md invariants as executable assertions.
// Usage: node scripts/check.js [--smoke] [--selftest]
//   (no args)   static checks only: milliseconds, zero tokens
//   --smoke     additionally run paid headless load checks (haiku, a few cents)
//   --selftest  additionally prove the checker can fail (injects violations into a temp copy)
// Node built-ins only — no package.json, no dependencies (SPEC decisions 20–21).
// Canonical runtime: CI's ubuntu runner. Local-environment portability is a non-goal.
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
process.chdir(ROOT);

const args = process.argv.slice(2);
const SMOKE = args.includes('--smoke');
const SELFTEST = args.includes('--selftest');
const unknownArgs = args.filter((a) => a !== '--smoke' && a !== '--selftest');
if (unknownArgs.length) {
  console.error(`unknown argument(s): ${unknownArgs.join(' ')}`);
  process.exit(2);
}

let fails = 0;
const pass = (m) => console.log(`PASS  ${m}`);
const fail = (m) => { console.log(`FAIL  ${m}`); fails += 1; };
const check = (ok, m) => (ok ? pass(m) : fail(m));

const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };
const sameSet = (a, b) => a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');

// The declared surface. Growing either set is an owner decision (SPEC Boundaries:
// "Ask first: adding any new command") and requires a deliberate edit here.
const KNOWN_SKILLS = ['research', 'discuss'];
const AGENT_TOOLS = {
  'storm-researcher': ['WebSearch', 'WebFetch', 'Write'],
  'storm-writer': ['Read', 'Write'],
  'storm-expert': ['WebSearch', 'WebFetch', 'Read'],
};

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
const DEP_FILES = ['package.json', 'package-lock.json', 'node_modules',
  'requirements.txt', 'pyproject.toml', 'Pipfile', 'Gemfile', 'Cargo.toml'];
const depsFound = DEP_FILES.filter((f) => fs.existsSync(f));
check(depsFound.length === 0,
  `no runtime-dependency files at repo root${depsFound.length ? ` — found: ${depsFound.join(', ')}` : ''}`);

// --- manifests ----------------------------------------------------------------
let plugin = null;
try { plugin = JSON.parse(read('.claude-plugin/plugin.json') ?? ''); pass('plugin.json is valid JSON'); }
catch { fail('plugin.json is valid JSON'); }
let market = null;
try { market = JSON.parse(read('.claude-plugin/marketplace.json') ?? ''); pass('marketplace.json is valid JSON'); }
catch { fail('marketplace.json is valid JSON'); }
check(plugin !== null && plugin.name === 'storm', "plugin name is 'storm'");
check(market !== null && market.name === 'stanford-oval-storm-skills', "marketplace name is 'stanford-oval-storm-skills'");
const entry = market && Array.isArray(market.plugins) ? market.plugins[0] : null;
check(entry !== null && entry.name === 'storm' && entry.source === './',
  "marketplace lists plugin 'storm' with source './' (CI's install coordinate)");

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

// --- SPEC boundary: single design doc — no links to CONTEXT.md / ADR files ----
const mdFiles = ['README.md', 'SPEC.md', 'AGENTS.md'];
for (const dir of ['skills', 'agents']) {
  for (const f of fs.readdirSync(dir, { recursive: true })) {
    if (String(f).endsWith('.md')) mdFiles.push(path.join(dir, String(f)));
  }
}
const badLinks = mdFiles.filter((f) => /\]\((\.\/)?(CONTEXT\.md|docs\/adr)/.test(read(f) ?? ''));
check(badLinks.length === 0,
  `no markdown links to CONTEXT.md or docs/adr (SPEC is the single design doc)${badLinks.length ? ` — offenders: ${badLinks.join(', ')}` : ''}`);

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
// Prove the checker is capable of failing: inject three boundary violations into
// a temp copy (one of them in YAML-list form, per SPEC decision 20's claim) and
// assert the copy's run goes red with exactly those checks.
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
  ];
  const missing = expected.filter((line) => !out.includes(line));
  check(injectionErrors.length === 0 && status !== 0 && missing.length === 0,
    `selftest: 3 injected violations (incl. YAML-list form) turn the checker red (exit ${status})`
    + (injectionErrors.length ? ` — ${injectionErrors.join('; ')}` : '')
    + (missing.length ? ` — missing: ${missing.join(' | ')}` : ''));
  fs.rmSync(tmp, { recursive: true, force: true });
}

// --- summary ------------------------------------------------------------------
console.log('----');
if (fails === 0) { console.log('ALL CHECKS PASSED'); process.exit(0); }
console.log(`${fails} CHECK(S) FAILED`);
process.exit(1);
