import { describe, it, expect } from 'vitest';
import { SCENARIOS, measureScenario } from '../../scripts/bench/scenarios.js';

/**
 * 성능 예산 (ADR 0001 "강한 예산"). 1,000행 시나리오마다 결정적 지표 넷의 상한.
 *   patches       diff가 만든 패치 수
 *   records       MutationObserver 기록 수
 *   addedRemoved  붙이거나 뗀 하위 트리 뿌리 수 (기록 안의 addedNodes + removedNodes 합, 옮기기 1번 = 2)
 *   created       patch 뒤 컨테이너 안에 새로 생긴 노드 수 (만드는 API와 상관없이)
 *
 * 처음 값은 dev 5cbca8b의 측정값이다. 최적화 브랜치는 자기가 줄인 만큼 상한을 낮추고(그 값이 다음 기준),
 * 상한을 올려야 하면 PR 본문에 이유를 적는다. 시간은 jsdom에서 흔들려 여기서 검사하지 않는다(`npm run bench`).
 *
 * 지금 값에서 눈여겨볼 것 (개선 대상)
 * - 핸들러가 렌더마다 새 함수라 행마다 PROPS 2개가 생긴다: 같은 데이터 다시 렌더 = 패치 2000, DOM 변경 0
 * - 빈 tbody 생성·덧붙이기·지우기는 행마다 DOM 연산 1번 (기록 1000)
 * - attach 시나리오는 시작 HTML의 key 속성을 행마다 지운다 (PROPS·기록 1000). 텍스트 갱신 비용이 아니다
 */
const ROWS = 1000;
const BUDGET = {
  'create-null': { patches: 1, records: 1, addedRemoved: 1, created: 9002 },
  'create-empty': { patches: 1000, records: 1000, addedRemoved: 1000, created: 9000 },
  'replace-all': { patches: 2000, records: 2000, addedRemoved: 2000, created: 9000 },
  'update-10th': { patches: 2100, records: 100, addedRemoved: 0, created: 0 },
  select: { patches: 2001, records: 1, addedRemoved: 0, created: 0 },
  swap: { patches: 2002, records: 4, addedRemoved: 4, created: 0 },
  'last-to-first': { patches: 2001, records: 2, addedRemoved: 2, created: 0 },
  reverse: { patches: 2999, records: 1998, addedRemoved: 1998, created: 0 },
  'remove-one': { patches: 1999, records: 1, addedRemoved: 1, created: 0 },
  append: { patches: 3000, records: 1000, addedRemoved: 1000, created: 9000 },
  noop: { patches: 2000, records: 0, addedRemoved: 0, created: 0 },
  clear: { patches: 1000, records: 1000, addedRemoved: 1000, created: 0 },
  'attach-update-10th': { patches: 3100, records: 1100, addedRemoved: 0, created: 0 },
  'attach-clear': { patches: 1000, records: 1000, addedRemoved: 1000, created: 0 },
};

describe(`성능 예산: ${ROWS}행 목록 시나리오`, () => {
  it('모든 시나리오에 예산이 있다', () => {
    expect(SCENARIOS.map((s) => s.id).sort()).toEqual(Object.keys(BUDGET).sort());
  });

  for (const scenario of SCENARIOS) {
    it(`${scenario.name}: 패치·DOM 변경·붙이고 뗀 노드·새 노드 수가 상한 이하`, () => {
      const r = measureScenario(scenario, ROWS, document);
      const actual = { patches: r.patches, records: r.records, addedRemoved: r.addedRemoved, created: r.created };
      for (const [metric, limit] of Object.entries(BUDGET[scenario.id])) {
        expect(actual[metric], `${scenario.id}.${metric} (종류: ${JSON.stringify(r.kinds)})`).toBeLessThanOrEqual(limit);
      }
    });
  }

  it('지표가 실제로 센다: 같은 데이터 다시 렌더는 DOM을 바꾸지 않고, 생성은 노드를 만든다', () => {
    const byId = Object.fromEntries(SCENARIOS.map((s) => [s.id, s]));
    expect(measureScenario(byId.noop, 10, document)).toMatchObject({ records: 0, addedRemoved: 0, created: 0 });
    // 행 하나 = tr·td 3개·a 2개·텍스트 3개 = 9노드, 표 = table·tbody 2노드
    expect(measureScenario(byId['create-null'], 10, document)).toMatchObject({ patches: 1, records: 1, created: 92 });
  });

  it('created는 엔진이 만든 노드만 센다: 옮기기·지우기는 0', () => {
    const byId = Object.fromEntries(SCENARIOS.map((s) => [s.id, s]));
    expect(measureScenario(byId.reverse, 10, document)).toMatchObject({ created: 0, moves: { engine: 9, lisMin: 9, react: 9 } });
    expect(measureScenario(byId.clear, 10, document)).toMatchObject({ created: 0, records: 10 });
  });

  it('측정이 끝나면 컨테이너를 문서에서 뗀다', () => {
    const before = document.body.childNodes.length;
    measureScenario(SCENARIOS[0], 3, document);
    expect(document.body.childNodes.length).toBe(before);
  });
});
