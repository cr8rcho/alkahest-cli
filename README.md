# Alkahest

> 코드에서 제품을 역으로 복원해, 사람이 제품 결정을 내리게 한다.

React/Next 프론트엔드 코드베이스를 정적 분석해 **제품 지도(Product Map)** 를 만드는 CLI입니다.
화면(route/page)을 노드로, 화면 간 이동과 화면이 부르는 API/데이터 호출을 엣지로 뽑아
인터랙티브 대시보드로 보여주고, 거기서 PRD·요구사항 문서를 추출합니다. 대상: **PM/기획자**.

## 사용 (예정)

```bash
npx alkahest scan        # 프로젝트 분석 → .alkahest/map.json (+ index.html)
npx alkahest view        # 대시보드로 화면/호출 그래프 탐색
npx alkahest prd <화면>  # 화면별 PRD/요구사항 마크다운 생성
```

## 상태

개발 초기. **Phase 1 완료** — `scan`이 Next app-router를 분석해 화면·이동·리소스·호출·UI기능을
`.alkahest/map.json`으로 출력합니다. 대시보드(Phase 2)·LLM 요약/PRD(Phase 3)는 진행 예정.

설계 단일 출처는 [`ALKAHEST.md`](./ALKAHEST.md) 입니다.

## 개발

```bash
npm install
npm run build
node dist/cli.js scan examples/sample-next   # 번들 픽스처로 시험
```
