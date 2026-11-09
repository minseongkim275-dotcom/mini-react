# 제안서: 정확성·개발 경험(mr-dx) 관점

기준: `dev` 5cbca8b (= 코드는 6853949와 같음). 재현 스크립트는 공유 노트 폴더 `dx-repro/`에 있다
(실행: `node <스크립트> <repo 경로>`, Node 22 + jsdom 26, 의존성 추가 없음).

## 1. 정확성 기준선

### 1.1 지금 fuzz가 다루는 범위

`tests/diff/fuzz.test.js` (시드 고정, 300라운드 × 4단계 = 1,200번 patch)

| 다룸 | 다루지 않음 |
|---|---|
| `createElement`로 만든 트리 | HTML 문자열 → `htmlToVNodes` → patch (Phase 1 실제 경로) |
| 태그 6종 `div p span ul li b` | table·form·select·textarea·pre·svg·details·void 요소 |
| 속성 2종 `class`, `title` | boolean 속성, style, key 속성, 엔티티가 든 값 |
| key 목록(이동·추가·삭제·중복·혼합) | 폼 "프로퍼티" 상태(checked·value·selected·open) |
| 결과 DOM의 속성·자식 구조 | 직렬화 왕복(`childrenToHTML` → 다시 읽기), DOM 변경 횟수 |

오라클이 `createElement + setAttribute`라서 "patch가 처음부터 그린 것과 같은가"는 보지만,
"브라우저가 같은 HTML을 파싱한 결과와 같은가"(Phase 1 요구)와 "화면 상태(프로퍼티)가 맞는가"는 보지 않는다.

### 1.2 차등 테스트로 잰 결과

오라클 = **브라우저 자신의 파서**(`div.innerHTML = html`)에서 domToVNode 규칙(주석·줄바꿈 공백 제거)만 똑같이 걷어 낸 DOM.
비교 = 속성·자식 구조(정규화) + 폼 프로퍼티(`checked`, `value`, `selectedIndex`, `option.selected`, `details.open`).

| 실험 | 입력 | 결과 |
|---|---|---|
| `repro.mjs` 고정 사례 | 41종(table·잘못된 중첩·form·select·textarea·pre·svg·xlink·foreignObject·MathML·details·중첩 목록·엔티티·공백·닫히지 않은 태그·template·커스텀 요소·대문자 태그·주석 등) × 이전 상태 3종 | 실패 8건 → 원인 4개 |
| `fuzzhtml.mjs` 무작위 HTML | 1,500라운드 × 4단계 = **6,000번 patch**, 태그 30여 종 | DOM 불일치 1건, **프로퍼티 불일치 377건(6.3%)**, 예외 0, 왕복 불일치 0 |
| `dirty.mjs` 사용자 조작 | 실제 영역에서 체크·입력·펼치기 후 Patch·뒤로가기 | 화면 상태가 기록과 어긋난 채 남음 |
| `comment.mjs` | 실제 영역에 주석 | 아무것도 고치지 않은 Patch가 DOM을 2번 바꾸고 기록을 남김 |

통과한 것(좋은 소식): table 자동 tbody, 잘못된 중첩(`<b><i>x</b>y</i>`, `<p><div>`), 엔티티·`&nbsp;`, 속성 값의 따옴표, pre/textarea 앞 줄바꿈,
svg 네임스페이스·xlink·foreignObject, template, 커스텀 요소, 대문자 태그, details, 중첩 목록은 **모두 정확**했다.

### 1.3 찾은 버그 (재현 입력 포함)

| # | 증상 | 최소 재현 | 원인 | 빈도 |
|---|---|---|---|---|
| B1 | `<select multiple>`의 선택이 틀림 | 빈 영역 → `<select multiple><option selected>a</option><option>b</option><option selected>c</option></select>` : 기대 a·c 선택, 실제 c만. 선택 없는 multiple은 기대 `selectedIndex -1`, 실제 0 | `createDom`이 자식(option)을 먼저 붙이고 속성을 나중에 넣는다. `multiple`이 없는 동안 select가 "하나만 선택" 규칙을 적용한다 | fuzz 6,000번 중 377번 |
| B2 | input 종류를 바꾸면 없는 `value` 속성이 생김 | `<input type="range" min="0" max="300" value="250">` → `<input type="radio" name="r">` : 실제 DOM에 `value="50"`가 남음 | PROPS 패치가 value를 먼저 지우고 type을 나중에 바꾼다. HTML 표준상 value 모드("value"→"default/on")가 바뀌는 순간 현재 value가 속성으로 복사된다. React도 `type`을 가장 먼저 넣는다 | 6,000번 중 1번(입력 생성 비율이 낮아서) |
| B3 | 주석이 있으면 손대지 않은 Patch도 DOM을 바꿈 | 실제 영역 `<p>a<!-- note -->b</p>` → 수정 없이 Patch : `TEXT "a"→"ab"`, `REMOVE "b"`, 기록 1개 추가 | 주석을 버리면 텍스트 노드 2개가 붙어 남는데, 직렬화하면 "ab" 1개가 된다(왕복이 같지 않음) | 주석·`<wbr>` 없이 텍스트가 갈리는 모든 입력 |
| B4 | 사용자가 실제 영역을 조작하면 기록과 화면이 어긋남 | 체크박스 클릭·입력·details 펼치기 → 다른 곳만 고쳐 Patch → 뒤로가기 : 체크·입력값·펼침이 그대로 | diff는 가상 트리끼리만 비교한다. 프로퍼티는 가상 트리에 없으므로 "바뀐 것 없음"으로 본다 | 버그라기보다 설계 한계. React의 비제어 컴포넌트와 같은 현상 |

설계상 의도라 버그로 세지 않은 것: `@click`·`:bind` 같은 이름은 DOM API가 받지 않아 경고 후 버림. `<noscript>`는 jsdom(스크립트 꺼짐)과 브라우저 파싱이 다름(환경 차이).

## 2. 특화 분야 제안

**"브라우저 파서가 정답지인 미니 React": 어떤 HTML을 넣어도 브라우저가 직접 그린 것과 같다는 것을 차등 fuzz로 증명한다.**

mr-lead의 A안("최소 DOM 변경을 증명하는 엔진")에 동의하고, 그 짝으로 붙인다.
"적게 바꾼다"는 주장은 "그래도 결과가 맞다"는 증명이 있어야 의미가 있다. 두 지표를 한 하네스에서 같이 잰다.

- 정확성 지표: 차등 fuzz 불일치 0 (DOM 구조 + 폼 프로퍼티 + 직렬화 왕복 + 무변경 Patch = 패치 0)
- 성능 지표(perf와 공유): 같은 fuzz 단계에서 MutationObserver 기록 수 ≤ 예산

## 3. 개선 후보 (기대 효과 · 측정 방법)

| P | 후보 | 기대 효과 | 측정 방법 | 비용 위치 |
|---|---|---|---|---|
| **P1** | **차등 fuzz 하네스** `tests/diff/differential.test.js`: 무작위 HTML(위 30여 태그, 엔티티, 공백, 잘못된 중첩) → 이전 상태에서 patch → 브라우저 파서 결과와 구조·프로퍼티 비교. 실패 시 시드·단계·최소화한 HTML을 출력 | perf 최적화의 병합 게이트. B1·B2 같은 버그를 자동으로 잡음 | 불일치 0 (현재 378건). CI 시간 +3초 이내(라운드 수 조절) | tests만 |
| **P1** | B1·B2·B3 수정 (각각 실패 테스트 먼저) | Phase 1에 select multiple·input 종류 변경·주석을 넣어도 정확 | 위 재현 입력이 테스트로 통과, fuzz 불일치 0 | `patch.js` 몇 줄(B1·B2), `domToVNode.js` 인접 텍스트 병합은 attach가 아닐 때만 + Phase 1 로드 때 attach 트리를 diff·patch로 한 번 정규화(B3, mr-lead 지적 반영: attach 트리를 합치면 vnode 1개가 DOM 노드 2개를 대표해 TEXT 패치가 틀림) |
| **P1** | 중점 포인트 설명 보강(lead 브리프): Document/Window, DOM 변화 감지 API 비교(MutationObserver vs 이벤트 vs 폴링, 이 프로젝트가 쓰는 곳), 컴포넌트 분할, State 위치(Lifting State Up) | 체크리스트 6.x 충족 | 체크리스트 상태 ✅ | demo/integrated 개념 절 |
| **P2** | Phase 1 프리셋 시나리오 (표·폼·select·중첩 목록·key 재정렬·SVG·엔티티/공백·잘못된 HTML) + 프리셋마다 "기대 패치" 기능 테스트 | 체크리스트 1.11 충족, 시연에서 한 번에 보여 줌 | 프리셋 N개 각각 "브라우저 결과와 같음" 테스트 통과 | demo/phase1 |
| **P2** | **DOM 어긋남 감지(drift)**: Patch·뒤로가기 전에 실제 영역의 폼 프로퍼티·속성을 가상 트리와 비교해 "가상 DOM이 모르는 변경 N건"을 보여 주고, 기록 이동 때는 기록 상태로 맞춘다(B4) | "VDOM은 아무도 DOM을 직접 건드리지 않을 때만 진실이다"를 눈으로 보여 줌. React 제어 컴포넌트 설명으로 이어짐 | dirty.mjs 시나리오에서 뒤로가기 후 화면=기록 | demo/phase1 (src는 읽기만) |
| **P2** | 개발 모드 경고: 목록에 key 누락(같은 태그 형제 ≥ 2이고 일부만 key), 중복 key(이미 있음, 어느 key인지 표시), 훅 순서 변화(이미 있음) | 실수를 원인과 함께 알려 줌 | 경고 사례별 테스트 | `src/dev/` 별도 모듈 + 데모에서만 켬. diff 핫 경로에 분기 추가 안 함 |
| **P2** | 실제 React와의 차이 표 `docs/react-differences.md` | 체크리스트 6.11 | 항목마다 근거 테스트 이름 | docs |
| P3 | 렌더 트리·패치 시각화 패널(devtools): 마지막 커밋의 패치 목록을 트리 위에 색으로, 훅 상태 표 | 학습 도구 | 기능 테스트 | demo/shared, src 비용 0 |
| P3 | 시간 여행 확장: 종합 페이지 기록에 "이 단계의 패치"를 같이 저장해 재생 | 학습 도구 | 기능 테스트 | demo |
| P3 | 접근성: 데모 버튼·라이브 영역 `aria-live`, 키보드 조작, 대비 | 포트폴리오 완성도 | 수동 점검표 | demo |

## 4. mr-perf 최적화가 깨뜨릴 수 있는 정확성 사례 (lead 질문에 대한 답)

각 사례는 차등 fuzz와 별도 회귀 테스트로 넣는다.

| 최적화 | 깨질 수 있는 입력 | 왜 |
|---|---|---|
| 연속 CREATE를 DocumentFragment로 묶기 | 빈 `<svg>`에 key 있는 `<circle>` 여러 개 생성 | `createDom`은 `parentDom.namespaceURI`로 SVG 여부를 정한다. 부모가 fragment면 namespace가 없어 HTML 요소로 만들어진다(화면에 안 보임) |
| 〃 | `<template>` 안 목록, `<select>` 안 option 생성 후 `value` | 자식은 `template.content`에 들어가야 함. select value PROPS는 option이 붙은 뒤여야 함 |
| 〃 | `before`가 있는 중간 삽입이 섞인 목록 | 연속 구간만 묶어야 함. 뒤에서부터 처리하는 순서와 `before` 참조가 맞아야 함 |
| 전체 삭제 빠른 경로(`textContent = ''`/`replaceChildren()`) | Phase 1 실제 영역 `<ul>\n  <li>a</li>\n</ul>` (attach로 읽음) | domToVNode가 버린 들여쓰기 공백 텍스트가 실제 DOM에는 남아 있다. "가상 자식 수 = 실제 자식 수"를 가정하면 안 됨. 반대로 index(`childNodes[i]`) 기반 접근은 바로 틀림 |
| 〃 | `<textarea>` 텍스트 삭제, `<template>` 비우기 | textarea는 defaultValue 동기화, template은 content를 비워야 함 |
| 〃 | patch 도중 실패 → `restore()` | 복구는 `vnode.dom` 참조로 짝짓는다. 빠른 경로가 참조를 정리하지 않으면 복구가 틀림 |
| 텍스트 하나뿐인 자식을 `textContent`로 | `<p>a</p>` → `<p>b</p>` → `<p>c</p>` | textContent는 텍스트 노드를 새로 만든다. 가상 노드의 `dom`이 떨어진 노드를 가리켜 다음 TEXT 패치가 화면에 안 보임 |
| key 목록 앞뒤 공통 구간 건너뛰기 | 중복 key 섞인 목록, key·key 없음 혼합, 같은 vnode 객체를 두 자리에 재사용 | 지금은 중복이면 위치 비교로 바꾸고 `own()`이 재사용 객체를 복제한다. 빠른 경로가 이 단계보다 먼저 돌면 dom 참조가 덮임 |
| `collectNodes` 생략·지연 | 이전 트리의 하위 트리 객체를 다음 트리 다른 자리에 재사용 | 재사용 판단이 이 Set에 의존. 생략하면 같은 DOM 노드를 두 자리에서 가리킴 |
| 이벤트 위임(루트 하나에서 처리) | `onFocus`·`onBlur`·`onMouseEnter`·`onScroll`, 핸들러 안 `stopPropagation`, 자식 실제 영역이 다른 루트로 이동 | 버블링하지 않는 이벤트, 전파 순서 |
| props 객체가 같으면 비교 생략 | 같은 style 객체를 고쳐 다시 렌더 | 지금도 못 잡음(React도 불변 전제). 문서화 대상 |

검증 계획: perf 브랜치마다 `differential.test.js`(시드 3개 × N라운드) + 위 표의 회귀 테스트 + DOM 변경 수 예산을 함께 돌린다. 측정 전 최적화는 "fuzz 불일치 0, 기존 테스트 통과, 변경 수 ≤ 기준"을 만족해야 병합 후보가 된다.

## 5. 실제 React와 비교할 포인트

- 자식 비교: React는 `lastPlacedIndex`(한 방향 스캔), 여기는 LIS(이동 최소). 역순·앞쪽 이동에서 차이(perf 비교표와 연결).
- 폼: React는 `type`을 먼저 넣고, 제어 컴포넌트(`value`+`onChange`)는 렌더마다 DOM 값을 상태로 되돌린다. 여기는 비제어에 가깝다(B4).
- select: React는 `<select value>`·`multiple`을 select 쪽에서 관리하고 `option selected`를 경고한다. 여기는 HTML 그대로 받는다(B1).
- 주석·인접 텍스트: React는 인접 텍스트 사이에 경계 주석을 넣어 hydration한다. 여기는 병합(B3 수정안).
- 개발 모드: React는 key 누락·훅 규칙을 개발 빌드에서만 경고하고 프로덕션에서 지운다. 여기도 `src/dev/`로 분리해 같은 구조를 보여 준다.
- 키 경고 위치: React는 배열을 자식으로 넘길 때(createElement) 검사. 여기는 평탄화로 배열 정보가 사라지므로 트리 검사로 대신한다(한계 명시).

## 6. 위험

| 위험 | 대응 |
|---|---|
| 차등 fuzz가 CI를 느리게 함(jsdom 6,000 patch ≈ 15초) | CI는 시드 1개 × 300라운드(≈3초 목표), 로컬 `npm run fuzz`로 긴 실행. 실측 후 확정 |
| jsdom과 브라우저 파서 차이(noscript 등) | 환경 의존 태그는 생성기에서 빼고 문서에 남김. 브라우저 페이지에서 같은 생성기를 돌리는 버전은 P3 |
| 개발 경고가 diff 핫 경로 비용을 늘림 | 핫 경로에 넣지 않고 별도 모듈로 트리를 한 번 훑음. 벤치 시나리오에서 켜고 끈 차이를 측정해 예산(약한 예산 20%) 안인지 확인 |
| B1 수정(속성 먼저)이 기존 "select value는 option 뒤" 규칙과 충돌 | `multiple`·`type`만 자식보다 먼저, `value`·`checked`·`selected`는 지금처럼 마지막. 기존 테스트로 확인 |
| drift 감지가 "patch에서만 DOM 변경" 규칙을 어김 | 감지는 읽기만, 되돌리기는 diff·patch로 |
| 파일 충돌(perf와 `src/diff/patch.js`) | B1·B2는 patch.js 작은 수정이므로 perf에 먼저 알리고 작은 브랜치로 먼저 넣는다 |
