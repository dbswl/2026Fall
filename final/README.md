# 한 줄 진단 (기말 프로젝트 프로토타입)

학원 수학 강사를 위한 오답 진단 서비스. 채점한 풀이 사진을 올리면 학생이 **처음 틀린 줄**과 그 **원인**(개념 부족 · 계산 실수 · 문제 오독 · 풀이 전략 오류)을 찾아 진단서를 만들고, 선생님이 확인한 진단은 **진찰 기록**(반 전체)과 **오답 처방전**(학생별)에 반영된다.

## 구성
| 경로 | 내용 |
|---|---|
| `index.html` | 서비스 소개 페이지 |
| `app.html` | 선생님 화면: 새 진단 · 진찰 기록 · 오답 처방전 · 진단서 확인 |
| `assets/app.js` | 화면 동작 (진단 요청, 기록 반영, 통계) |
| `assets/data.js` | 샘플 반 데이터 (가상: 중1 A반 8명, 16문항) |
| `api/diagnose.js` | 진단 API (Vercel 서버리스 함수, Claude 비전 모델 호출) |
| `dev/server.js` | 로컬 확인용 서버 (배포에는 쓰이지 않음) |

## 동작 방식
1. 브라우저에서 사진을 1600px 이하 JPEG로 줄여 `/api/diagnose`로 보낸다.
2. 서버 함수가 Claude API에 사진·문제·정답을 보내고, `submit_diagnosis` 도구 형식(JSON)으로 판독한 줄, 처음 틀린 줄, 원인, 근거, 신뢰도, 처방 문제를 받는다.
3. 선생님이 확인·수정하면 기록에 반영된다. 기록은 브라우저(localStorage)에만 저장된다. 사진은 서버에 저장하지 않는다.
4. API 키가 없으면 **데모 모드**로, 샘플 반의 예시 결과를 보여 준다.

## 배포 (Vercel)
1. Vercel에서 이 저장소를 Import, Root Directory를 이 폴더로 지정.
2. Settings → Environment Variables에 `ANTHROPIC_API_KEY` 추가 (선택: `CLAUDE_MODEL`).
3. Deploy. 이후 GitHub에 커밋하면 자동으로 다시 배포된다.

## 로컬 실행
```
ANTHROPIC_API_KEY=... node dev/server.js   # http://localhost:3000
```
