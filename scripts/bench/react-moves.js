/**
 * key 목록이 old → new로 바뀔 때 "기존 노드를 몇 번 옮기는가"를 두 알고리즘으로 센다. 비교 자료용이며 엔진은 쓰지 않는다.
 *
 * - lisMovesByKeys: 이 프로젝트(src/diff/diff.js)와 Vue 3의 방식. 새 순서로 늘어놓은 이전 위치 수열의
 *   가장 긴 증가 부분 수열(LIS)은 그대로 두고 나머지만 옮긴다 → 이동 수 = 짝지은 노드 수 - LIS 길이 (최소).
 * - reactMovesByKeys: React의 reconcileChildrenArray 방식(lastPlacedIndex). 계산은 종합 데모의 `reactMoves`를 그대로 쓴다
 *   (구현을 한 곳에만 둔다). 한 방향으로만 보므로 맨 뒤 노드를 맨 앞으로 보내면 나머지 전부를 옮긴다.
 */
import { longestIncreasingSubsequence } from '../../src/diff/lis.js';
import { reactMoves } from '../../demo/integrated/concepts.js';

/** 새 순서로 늘어놓은 "이전 위치" 수열 (이전에 없던 key는 빠진다) */
export function oldPositions(oldKeys, newKeys) {
  const index = new Map(oldKeys.map((key, i) => [key, i]));
  const seq = [];
  for (const key of newKeys) if (index.has(key)) seq.push(index.get(key));
  return seq;
}

export function lisMovesByKeys(oldKeys, newKeys) {
  const seq = oldPositions(oldKeys, newKeys);
  return seq.length - longestIncreasingSubsequence(seq).length;
}

export function reactMovesByKeys(oldKeys, newKeys) {
  return reactMoves(oldPositions(oldKeys, newKeys));
}
