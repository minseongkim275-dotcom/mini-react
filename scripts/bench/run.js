#!/usr/bin/env node
/**
 * 대량 목록 벤치마크 (Node + jsdom). 시나리오와 지표는 scripts/bench/scenarios.js에 있다.
 *
 *   npm run bench                         1,000행, 11회 중앙값
 *   npm run bench -- --rows 10000 --runs 1 --warmup 0
 *   npm run bench -- --json docs/bench/<이름>.json
 *
 * 실행마다 새 jsdom 창을 쓰고, 시나리오마다 새 Node 프로세스에서 돌린다.
 * 한 문서를 계속 쓰면 남은 노드 때문에 삽입 시간이 2~3배 부풀고, 닫은 jsdom 창도 메모리가 다 풀리지 않아
 * 한 프로세스에서 전부 돌리면 1k에서도 4GB를 넘는다. 10k는 --runs 1 --warmup 0으로 돌려라.
 *
 * 패치 수·기록 수·노드 수는 결정적이고, 시간은 jsdom 기준 참고값이다(실행마다 ±30%).
 */
import { JSDOM } from 'jsdom';
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SCENARIOS, measureScenario } from './scenarios.js';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? def : args[i + 1];
};
const ROWS = Number(opt('rows', 1000));
const RUNS = Number(opt('runs', 11));
const WARMUP = Number(opt('warmup', 3));
const JSON_OUT = opt('json', null);
const ONLY = opt('only', null); // 시나리오 id 하나만 (자식 프로세스가 쓴다)
const CHILD = args.includes('--child'); // 결과를 JSON 한 줄로 stdout에 낸다

const median = (xs) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const round = (x) => Math.round(x * 100) / 100;

function runScenario(scenario) {
  const diffMs = [];
  const patchMs = [];
  let last;
  for (let r = 0; r < WARMUP + RUNS; r += 1) {
    const win = new JSDOM('<!doctype html><html><body></body></html>').window;
    last = measureScenario(scenario, ROWS, win.document);
    win.close();
    if (r >= WARMUP) {
      diffMs.push(last.diffMs);
      patchMs.push(last.patchMs);
    }
  }
  const result = { ...last, diffMs: round(median(diffMs)), patchMs: round(median(patchMs)) };
  result.totalMs = round(result.diffMs + result.patchMs);
  process.stderr.write(`  ${scenario.id}: ${result.totalMs}ms\n`);
  return result;
}

if (CHILD) {
  const scenario = SCENARIOS.find((s) => s.id === ONLY);
  process.stdout.write(JSON.stringify(runScenario(scenario)));
  process.exit(0);
}

// 부모: 시나리오마다 자식 프로세스를 띄운다
const self = fileURLToPath(import.meta.url);
const ids = ONLY ? [ONLY] : SCENARIOS.map((s) => s.id);
if (ONLY && !SCENARIOS.some((s) => s.id === ONLY)) {
  console.error(`알 수 없는 시나리오: ${ONLY} (있는 것: ${SCENARIOS.map((s) => s.id).join(', ')})`);
  process.exit(1);
}
const results = ids.map((id) =>
  JSON.parse(
    execFileSync(
      process.execPath,
      ['--max-old-space-size=6144', self, '--child', '--only', id, '--rows', ROWS, '--runs', RUNS, '--warmup', WARMUP].map(String),
      { stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 1 << 26 },
    ).toString(),
  ),
);

console.log(`mini-react bench · rows=${ROWS} · runs=${RUNS} (median, warmup ${WARMUP}) · node ${process.version} · jsdom`);
console.table(
  results.map((r) => ({
    scenario: r.id,
    'diff ms': r.diffMs,
    'patch ms': r.patchMs,
    patches: r.patches,
    kinds: Object.entries(r.kinds)
      .map(([k, v]) => `${k}:${v}`)
      .join(' '),
    records: r.records,
    'added+removed': r.addedRemoved,
    created: r.created,
    'moves engine/LIS min/React': `${r.moves.engine}/${r.moves.lisMin}/${r.moves.react}`,
  })),
);
if (JSON_OUT) {
  writeFileSync(JSON_OUT, `${JSON.stringify({ rows: ROWS, runs: RUNS, warmup: WARMUP, node: process.version, results }, null, 2)}\n`);
}
