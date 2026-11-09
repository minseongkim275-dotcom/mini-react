#!/usr/bin/env node
/**
 * 대량 목록 벤치마크 (Node + jsdom). js-framework-benchmark의 시나리오를 본떠 1,000행 표를 조작한다.
 *
 *   node scripts/bench/run.js [--rows 1000] [--runs 15] [--json out.json]
 *
 * 측정값 (시나리오마다)
 *   - ms: diff+patch에 걸린 시간의 중앙값 (render() 한 번. 준비 단계는 재지 않는다)
 *   - diff ms / patch ms: 위 시간을 둘로 나눈 것
 *   - patches: diff가 만든 패치 수 (종류별)
 *   - mutations: MutationObserver가 받은 기록 수 (실제 DOM이 바뀐 횟수)
 *
 * 행 구조: <tr key=id class?><td>id</td><td><a onClick>label</a></td><td><a onClick>x</a></td></tr>
 * 핸들러는 실제 앱처럼 렌더마다 새 화살표 함수로 만든다.
 */
import { JSDOM } from 'jsdom';
import { performance } from 'node:perf_hooks';
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? def : args[i + 1];
};
const ROWS = Number(opt('rows', 1000));
const RUNS = Number(opt('runs', 15));
const WARMUP = 5;
const JSON_OUT = opt('json', null);

// 시나리오마다 새 jsdom 창을 쓰고 끝나면 닫는다. 한 창을 계속 쓰면 jsdom이 노드를 붙잡아 10k에서 메모리가 넘친다.
let win;
function freshWindow() {
  win?.close();
  win = new JSDOM('<!doctype html><html><body></body></html>').window;
  globalThis.window = win;
  globalThis.document = win.document;
  globalThis.MutationObserver = win.MutationObserver;
}
freshWindow();

const { h, diff, patch } = await import('../../src/index.js');

let nextId = 1;
const ADJ = ['pretty', 'large', 'big', 'small', 'tall', 'short', 'long', 'handsome', 'plain', 'quaint'];
const NOUN = ['table', 'chair', 'house', 'bbq', 'desk', 'car', 'pony', 'cookie', 'sandwich', 'burger'];
function buildData(count) {
  const data = new Array(count);
  for (let i = 0; i < count; i += 1) {
    data[i] = { id: nextId, label: `${ADJ[nextId % ADJ.length]} ${NOUN[(nextId * 7) % NOUN.length]}` };
    nextId += 1;
  }
  return data;
}

const noop = () => {};
function view(data, selected = 0) {
  return h(
    'table',
    { class: 'table' },
    h(
      'tbody',
      null,
      data.map((row) =>
        h(
          'tr',
          { key: row.id, class: row.id === selected ? 'danger' : null },
          h('td', { class: 'col-md-1' }, String(row.id)),
          h('td', { class: 'col-md-4' }, h('a', { onClick: () => noop(row.id) }, row.label)),
          h('td', { class: 'col-md-1' }, h('a', { onClick: () => noop(-row.id) }, 'x')),
        ),
      ),
    ),
  );
}

/** 시나리오: setup(빈 컨테이너에서 준비할 데이터) → run(data)이 다음 데이터를 돌려준다 */
const scenarios = [
  { name: 'create 1k (from null)', setup: () => null, run: () => buildData(ROWS) },
  { name: 'create 1k (empty tbody)', setup: () => [], run: () => buildData(ROWS) },
  { name: 'replace all 1k', setup: () => buildData(ROWS), run: () => buildData(ROWS) },
  {
    name: 'update every 10th',
    setup: () => buildData(ROWS),
    run: (d) => d.map((r, i) => (i % 10 === 0 ? { ...r, label: `${r.label} !!!` } : r)),
  },
  { name: 'select row', setup: () => buildData(ROWS), run: (d) => d, selected: (d) => d[5].id },
  {
    name: 'swap 2 rows',
    setup: () => buildData(ROWS),
    run: (d) => {
      const n = d.slice();
      [n[1], n[n.length - 2]] = [n[n.length - 2], n[1]];
      return n;
    },
  },
  { name: 'last to first', setup: () => buildData(ROWS), run: (d) => [d[d.length - 1], ...d.slice(0, -1)] },
  { name: 'reverse', setup: () => buildData(ROWS), run: (d) => d.slice().reverse() },
  { name: 'remove 1 row', setup: () => buildData(ROWS), run: (d) => d.filter((_, i) => i !== 500) },
  { name: 'append 1k to 1k', setup: () => buildData(ROWS), run: (d) => [...d, ...buildData(ROWS)] },
  { name: 'no-op re-render', setup: () => buildData(ROWS), run: (d) => d },
  { name: 'clear 1k', setup: () => buildData(ROWS), run: () => [] },
];

function countByType(patches) {
  const out = {};
  for (const p of patches) out[p.type] = (out[p.type] ?? 0) + 1;
  return out;
}

const median = (xs) => {
  const s = xs.slice().sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

function runScenario(sc) {
  freshWindow();
  const times = [];
  const diffTimes = [];
  const patchTimes = [];
  let patchCount = null;
  let byType = null;
  let mutations = null;
  for (let r = 0; r < WARMUP + RUNS; r += 1) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const before = sc.setup(); // null이면 이전 트리 없음, []이면 빈 tbody
    // 준비: 이전 트리를 그려 두고 그 트리를 그대로 diff의 "이전 트리"로 쓴다 (render()와 같은 경로)
    const prevTree = before !== null ? view(before) : null;
    if (prevTree) patch(container, diff(null, prevTree));

    const nextData = sc.run(before ?? []);
    const nextTree = view(nextData, sc.selected ? sc.selected(nextData) : 0);

    const observer = new MutationObserver(() => {});
    observer.observe(container, { childList: true, subtree: true, attributes: true, characterData: true });

    const t0 = performance.now();
    const patches = diff(prevTree, nextTree);
    const t1 = performance.now();
    patch(container, patches);
    const t2 = performance.now();

    const records = observer.takeRecords();
    observer.disconnect();
    container.remove();
    if (r >= WARMUP) {
      times.push(t2 - t0);
      diffTimes.push(t1 - t0);
      patchTimes.push(t2 - t1);
      patchCount = patches.length;
      byType = countByType(patches);
      mutations = records.length;
    }
  }
  return {
    name: sc.name,
    ms: +median(times).toFixed(2),
    diffMs: +median(diffTimes).toFixed(2),
    patchMs: +median(patchTimes).toFixed(2),
    patches: patchCount,
    byType,
    mutations,
  };
}

const results = scenarios.map(runScenario);

console.log(`mini-react bench · rows=${ROWS} · runs=${RUNS} (median) · node ${process.version} · jsdom`);
console.table(
  results.map((r) => ({
    scenario: r.name,
    'total ms': r.ms,
    'diff ms': r.diffMs,
    'patch ms': r.patchMs,
    patches: r.patches,
    kinds: Object.entries(r.byType)
      .map(([k, v]) => `${k}:${v}`)
      .join(' '),
    mutations: r.mutations,
  })),
);
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify({ rows: ROWS, runs: RUNS, node: process.version, results }, null, 2));
