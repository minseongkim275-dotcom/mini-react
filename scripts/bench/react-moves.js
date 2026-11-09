/**
 * key 목록이 old → new로 바뀔 때 "기존 노드를 몇 번 옮기는가"를 두 알고리즘으로 센다. 비교 자료용이며 엔진은 쓰지 않는다.
 *
 * - lisMoves: 이 프로젝트(src/diff/diff.js)와 Vue 3의 방식. 새 순서로 늘어놓은 이전 위치 수열의
 *   가장 긴 증가 부분 수열(LIS)은 그대로 두고 나머지만 옮긴다 → 이동 수 = 짝지은 노드 수 - LIS 길이 (최소).
 * - reactMoves: React의 reconcileChildrenArray 방식(lastPlacedIndex). 새 순서대로 훑으며
 *   이전 위치가 "지금까지 제자리에 둔 노드 중 가장 뒤의 이전 위치"보다 앞이면 옮긴다.
 *   한 방향으로만 보므로 맨 뒤 노드를 맨 앞으로 보내면 나머지 전부를 옮긴다.
 */
import { longestIncreasingSubsequence } from '../../src/diff/lis.js';

/** 새 순서로 늘어놓은 "이전 위치" 수열 (이전에 없던 key는 빠진다) */
function oldPositions(oldKeys, newKeys) {
  const index = new Map(oldKeys.map((key, i) => [key, i]));
  const seq = [];
  for (const key of newKeys) if (index.has(key)) seq.push(index.get(key));
  return seq;
}

export function lisMoves(oldKeys, newKeys) {
  const seq = oldPositions(oldKeys, newKeys);
  return seq.length - longestIncreasingSubsequence(seq).length;
}

export function reactMoves(oldKeys, newKeys) {
  let lastPlacedIndex = 0;
  let moves = 0;
  for (const oldIndex of oldPositions(oldKeys, newKeys)) {
    if (oldIndex < lastPlacedIndex) moves += 1;
    else lastPlacedIndex = oldIndex;
  }
  return moves;
}
