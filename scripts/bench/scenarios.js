/**
 * 대량 목록 벤치마크의 시나리오와 측정 함수. `scripts/bench/run.js`(시간 측정)와
 * `tests/bench/budget.test.js`(성능 예산)가 같은 시나리오를 쓴다.
 *
 * 행 구조는 js-framework-benchmark와 같다.
 *   <tr key=id class?><td>id</td><td><a onClick>label</a></td><td><a onClick>x</a></td></tr>
 * 핸들러는 실제 앱처럼 렌더마다 새 화살표 함수로 만든다.
 *
 * 결정적 지표 넷 (ADR 0001 강한 예산)
 *   patches       diff가 만든 패치 수
 *   records       MutationObserver 기록 수 (DOM에 변경을 몇 번 알렸나)
 *   addedRemoved  기록 안의 addedNodes + removedNodes 합 = 붙이거나 뗀 하위 트리 뿌리 수.
 *                 하위 트리를 통째로 붙이면 1, 옮기기 1번은 떼기·붙이기로 2다.
 *   created       patch 뒤 컨테이너 안에 새로 생긴 노드 수 (patch 전에 없던 노드를 하위 트리 전체에서 센다).
 *                 createElement든 cloneNode든 만드는 방법과 상관없이 잡힌다. 만들었다가 붙이지 않은 노드는 세지 않는다.
 * 시간(diffMs, patchMs)은 참고용이다. jsdom이고 실행마다 흔들린다.
 *
 * 이 파일은 측정 준비(빈 컨테이너, attach 시나리오의 시작 HTML)에서만 DOM을 직접 만든다.
 * 측정하는 구간의 DOM 변경은 모두 src/diff/patch.js가 한다.
 */
import { h, diff, patch, domToVNode } from '../../src/index.js';
import { lisMoves, reactMoves } from './react-moves.js';

const ADJ = ['pretty', 'large', 'big', 'small', 'tall', 'short', 'long', 'handsome', 'plain', 'quaint'];
const NOUN = ['table', 'chair', 'house', 'bbq', 'desk', 'car', 'pony', 'cookie', 'sandwich', 'burger'];

/** id가 start부터 이어지는 행 count개. 같은 인자면 항상 같은 데이터다. */
export function buildRows(start, count) {
  const rows = new Array(count);
  for (let i = 0; i < count; i += 1) {
    const id = start + i;
    rows[i] = { id, label: `${ADJ[id % ADJ.length]} ${NOUN[(id * 7) % NOUN.length]}` };
  }
  return rows;
}

const noop = () => {};

/** 표 하나를 그리는 가상 트리. selected 행에는 class="danger"가 붙는다. */
export function view(rows, selected = 0) {
  return h(
    'table',
    { class: 'table' },
    h(
      'tbody',
      null,
      rows.map((row) =>
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

/** view()와 같은 표를 들여쓰기 공백이 든 HTML로 쓴다. Phase 1 실제 영역처럼 attach로 읽어 시작하는 시나리오용. */
function viewHTML(rows) {
  const tr = (r) =>
    `    <tr key="${r.id}">\n      <td class="col-md-1">${r.id}</td>\n` +
    `      <td class="col-md-4"><a>${r.label}</a></td>\n      <td class="col-md-1"><a>x</a></td>\n    </tr>\n`;
  return `<table class="table">\n  <tbody>\n${rows.map(tr).join('')}  </tbody>\n</table>`;
}

/**
 * 시나리오: before(n) = 준비할 행(null이면 이전 트리 없음), after(rows, n) = 다음 행.
 * selected(rows)가 있으면 그 id의 행을 선택한다. attach가 참이면 이전 트리를 HTML에서 attach로 읽는다.
 */
export const SCENARIOS = [
  { id: 'create-null', name: 'create (from null)', before: () => null, after: (_, n) => buildRows(1, n) },
  { id: 'create-empty', name: 'create (empty tbody)', before: () => [], after: (_, n) => buildRows(1, n) },
  { id: 'replace-all', name: 'replace all', before: (n) => buildRows(1, n), after: (_, n) => buildRows(n + 1, n) },
  {
    id: 'update-10th',
    name: 'update every 10th',
    before: (n) => buildRows(1, n),
    after: (rows) => rows.map((r, i) => (i % 10 === 0 ? { ...r, label: `${r.label} !!!` } : r)),
  },
  { id: 'select', name: 'select row', before: (n) => buildRows(1, n), after: (rows) => rows, selected: (rows) => rows[5].id },
  {
    id: 'swap',
    name: 'swap 2 rows',
    before: (n) => buildRows(1, n),
    after: (rows) => {
      const next = rows.slice();
      [next[1], next[next.length - 2]] = [next[next.length - 2], next[1]];
      return next;
    },
  },
  { id: 'last-to-first', name: 'last to first', before: (n) => buildRows(1, n), after: (rows) => [rows.at(-1), ...rows.slice(0, -1)] },
  { id: 'reverse', name: 'reverse', before: (n) => buildRows(1, n), after: (rows) => rows.slice().reverse() },
  { id: 'remove-one', name: 'remove 1 row', before: (n) => buildRows(1, n), after: (rows) => rows.filter((_, i) => i !== rows.length >> 1) },
  { id: 'append', name: 'append n to n', before: (n) => buildRows(1, n), after: (rows, n) => [...rows, ...buildRows(n + 1, n)] },
  { id: 'noop', name: 'same data re-render', before: (n) => buildRows(1, n), after: (rows) => rows },
  { id: 'clear', name: 'clear', before: (n) => buildRows(1, n), after: () => [] },
  {
    id: 'attach-update-10th',
    name: 'attach: update every 10th',
    attach: true,
    before: (n) => buildRows(1, n),
    after: (rows) => rows.map((r, i) => (i % 10 === 0 ? { ...r, label: `${r.label} !!!` } : r)),
  },
  { id: 'attach-clear', name: 'attach: clear', attach: true, before: (n) => buildRows(1, n), after: () => [] },
];

/** root 하위 트리의 모든 노드 (root 제외) */
function allNodes(root) {
  const out = new Set();
  const walker = root.ownerDocument.createTreeWalker(root);
  while (walker.nextNode()) out.add(walker.currentNode);
  return out;
}

/**
 * 시나리오 한 번을 실행해 지표를 돌려준다.
 * @param {object} scenario SCENARIOS의 원소
 * @param {number} rowCount 행 수
 * @param {Document} doc 측정할 문서 (jsdom 창의 document)
 */
export function measureScenario(scenario, rowCount, doc) {
  const MO = doc.defaultView.MutationObserver;
  const container = doc.createElement('div');
  doc.body.appendChild(container);

  const beforeRows = scenario.before(rowCount);
  let prevTree = null;
  if (scenario.attach) {
    container.innerHTML = viewHTML(beforeRows); // 준비: Phase 1처럼 "이미 화면에 있는 HTML"에서 시작
    prevTree = domToVNode(container.firstElementChild, { attach: true });
  } else if (beforeRows !== null) {
    prevTree = view(beforeRows);
    patch(container, diff(null, prevTree));
  }
  const nextRows = scenario.after(beforeRows ?? [], rowCount);
  const nextTree = view(nextRows, scenario.selected ? scenario.selected(nextRows) : 0);

  const observer = new MO(() => {});
  observer.observe(container, { childList: true, subtree: true, attributes: true, characterData: true });
  const existing = allNodes(container);

  let patches;
  let records;
  let created = 0;
  let t0;
  let t1;
  let t2;
  try {
    t0 = performance.now();
    patches = diff(prevTree, nextTree);
    t1 = performance.now();
    patch(container, patches);
    t2 = performance.now();
    records = observer.takeRecords();
    for (const node of allNodes(container)) if (!existing.has(node)) created += 1;
  } finally {
    observer.disconnect();
    container.remove();
  }

  const kinds = {};
  for (const p of patches) kinds[p.type] = (kinds[p.type] ?? 0) + 1;
  let addedRemoved = 0;
  for (const r of records) addedRemoved += r.addedNodes.length + r.removedNodes.length;

  // 이동 횟수: engine = 엔진이 실제로 만든 MOVE 패치 수, lisMin = LIS로 구한 이론 최소,
  // react = 같은 key 순서를 React식(lastPlacedIndex)으로 처리했을 때의 이동 수 (비교용 계산)
  const oldKeys = (beforeRows ?? []).map((r) => r.id);
  const newKeys = nextRows.map((r) => r.id);

  return {
    id: scenario.id,
    name: scenario.name,
    patches: patches.length,
    kinds,
    records: records.length,
    addedRemoved,
    created,
    moves: { engine: kinds.MOVE ?? 0, lisMin: lisMoves(oldKeys, newKeys), react: reactMoves(oldKeys, newKeys) },
    diffMs: t1 - t0,
    patchMs: t2 - t1,
  };
}
