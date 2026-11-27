// 한 줄 진단: 풀이 사진 진단 API (Vercel 서버리스 함수)
// POST /api/diagnose  { image: "data:image/jpeg;base64,...", problem: "...", answer: "...", topic?: "..." }
//   또는 시험지 한 장 전체 사진이면 { image, question_no: "12", answer?: "..." } (문제는 사진에서 읽는다)
// 환경 변수: ANTHROPIC_API_KEY (필수), CLAUDE_MODEL (선택, 기본 claude-sonnet-5-5)
// 키가 없으면 503 { error: "no_api_key" } 를 돌려주고, 화면은 데모 모드(예시 결과)로 전환한다.

const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5-5';

const SYSTEM = `당신은 학원 수학 강사의 채점을 돕는 오답 진단 도우미입니다.
선생님이 학생 한 명의 풀이 사진(한 문항)과 문제, 정답을 줍니다. 아래 순서로 진단하고 반드시 submit_diagnosis 도구로만 답하세요.
사진에서 어둡게 칠한 '개인정보 가림' 영역은 개인정보 보호를 위해 가린 부분이니 무시하세요. 사진에 여러 문항이 함께 찍혀 있으면 주어진 문제에 해당하는 문항과 그 풀이만 보고 진단하세요.
문제 대신 문항 번호만 주어지면(시험지 한 장 전체 사진), 사진에서 그 번호의 문항을 찾아 문제를 problem_text에 그대로 옮겨 적고(보기가 있으면 보기도), 그 문항 근처에 학생이 쓴 풀이와 고른 답만 보고 진단합니다.
- 다른 문항의 풀이를 섞지 않습니다. 풀이가 다른 문항 쪽으로 넘어가 있으면 내용으로 판단합니다.
- 객관식이면 student_answer에 고른 번호와 그 값을 함께 적습니다. 예) "② -2"
- 정답이 주어지지 않으면 직접 풀어 correct_answer에 적고 그 답으로 채점합니다. 선생님의 채점 표시(빨간 동그라미·빗금·체크)는 참고만 하고, 판단은 풀이 내용으로 합니다.
- question_region에 그 문항과 풀이가 들어 있는 영역을 넉넉하게 적습니다.
- 그 번호를 사진에서 찾지 못하면 question_found=false로 두고 나머지 항목은 비워 둡니다.

1. 판독: 학생이 쓴 풀이를 위에서 아래로 한 줄씩 그대로 옮겨 적습니다. 틀린 내용도 고치지 말고 학생이 쓴 그대로 적습니다.
   분수는 a/b, 거듭제곱은 x², 곱셈은 ×처럼 읽기 쉬운 텍스트로 씁니다. 지운 흔적이나 낙서는 빼고, 알아볼 수 없는 부분은 [?]로 둡니다.
2. 정답 여부: 학생의 최종 답이 정답과 같은 값이면 is_correct=true, first_error_line=-1, cause="none"으로 둡니다.
3. 틀린 줄: 틀렸다면, 앞 줄에서 바르게 이어지지 않는 "처음 틀린 줄"의 번호(0부터)를 찾습니다. 풀이가 맞게 가다가 멈췄다면 stopped_midway=true, first_error_line=-1 입니다.
4. 원인: 처음 틀린 줄의 원인을 아래 네 가지 중 하나로 고릅니다.
   - C 개념 부족: 필요한 개념·공식·규칙이 없거나 잘못 알고 있다. 예) 1시간 15분을 1.15시간으로 바꿈, 반비례를 y=ax로 세움, 이항할 때 부호를 바꾸지 않음.
   - K 계산 실수: 식과 방법은 맞지만 계산 과정에서 틀렸다. 예) 7+5=13, 15÷5=5, 부호를 옮겨 쓰다 빠뜨림. 같은 규칙을 다른 곳에서 바르게 썼다면 계산 실수로 봅니다.
   - R 문제 오독: 풀이는 맞지만 문제가 요구한 것과 다른 것을 답했다. 예) 가장 큰 수를 묻는데 가운데 수를 답함, 단위를 다르게 씀, '이하'를 '미만'으로 읽음.
   - S 풀이 전략 오류: 문제 상황을 식으로 옮기는 방향 자체가 틀렸거나, 무엇을 구할지 정하지 못하고 멈췄다. 예) 시간 대신 속력×거리를 더함, 풀이 없이 빈칸.
   개념 부족과 계산 실수가 헷갈리면, 학생이 그 규칙을 알고 있다는 근거가 있는지로 판단합니다.
5. 근거(evidence): 왜 그 줄이 틀렸고 왜 그 원인인지 한두 문장으로, 선생님이 바로 이해할 수 있게 씁니다.
6. 신뢰도(confidence): 0~1. 글씨가 흐리거나, 원인이 두 가지로 해석될 수 있으면 0.7 미만으로 낮춥니다. 이 값이 낮은 진단은 선생님이 반드시 다시 확인합니다.
7. 처방 문제(similar_problem): 같은 유형이면서 그 원인을 연습할 수 있는 새 문제 한 개와 정답을 만듭니다. 숫자만 바꾼 쉬운 변형이면 충분합니다.
모든 설명은 한국어로, 짧고 분명하게 씁니다. 학생을 탓하는 표현은 쓰지 않습니다.`;

const TOOL = {
  name: 'submit_diagnosis',
  description: '풀이 사진 한 장에 대한 진단 결과를 제출한다.',
  input_schema: {
    type: 'object',
    properties: {
      transcribed_lines: { type: 'array', items: { type: 'string' }, description: '학생이 쓴 풀이를 줄 단위로, 고치지 않고 그대로' },
      student_answer: { type: 'string', description: '학생이 쓴 최종 답 (없으면 "무응답")' },
      is_correct: { type: 'boolean' },
      first_error_line: { type: 'integer', description: '처음 틀린 줄 번호(0부터). 정답이거나 틀린 줄 없이 멈췄으면 -1' },
      stopped_midway: { type: 'boolean', description: '풀이를 끝까지 하지 않고 멈췄는지' },
      cause: { type: 'string', enum: ['C', 'K', 'R', 'S', 'none'] },
      evidence: { type: 'string', description: '근거 한두 문장' },
      correct_line: { type: 'string', description: '처음 틀린 줄이 원래 어떻게 되어야 했는지 (정답이면 빈 문자열)' },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
      legibility: { type: 'string', enum: ['good', 'partial', 'poor'] },
      teacher_note: { type: 'string', description: '다음 수업에서 이 학생에게 짚어 줄 지도 포인트 한 문장' },
      question_found: { type: 'boolean', description: '문항 번호로 요청했을 때 사진에서 그 문항을 찾았는지 (문제를 직접 준 경우 true)' },
      problem_text: { type: 'string', description: '문항 번호로 요청했을 때 사진에서 읽은 문제 (보기 포함). 문제를 직접 준 경우 빈 문자열' },
      correct_answer: { type: 'string', description: '정답 (주어진 정답 또는 직접 푼 답)' },
      topic: { type: 'string', description: '문제 유형을 짧게 (예: 일차방정식의 활용 - 거리·속력·시간)' },
      unit: { type: 'string', description: '중등 수학 단원 이름 (예: 일차방정식)' },
      question_region: {
        type: 'object', description: '문항 번호로 요청했을 때, 사진 전체를 0~1로 볼 때 그 문항(문제와 학생 풀이 전체)이 차지하는 직사각형. x,y는 왼쪽 위 모서리',
        properties: { x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' } }
      },
      similar_problem: {
        type: 'object',
        properties: { text: { type: 'string' }, answer: { type: 'string' } },
        required: ['text', 'answer']
      }
    },
    required: ['transcribed_lines', 'student_answer', 'is_correct', 'first_error_line', 'stopped_midway', 'cause', 'evidence', 'correct_line', 'confidence', 'legibility', 'teacher_note', 'similar_problem']
  }
};

// 시험지 한 장 훑기: 문항을 모두 찾고 정답·오답을 먼저 가른다 (오답·애매한 문항만 자세히 진단)
const SCAN_SYSTEM = `당신은 학원 수학 강사의 채점을 돕는 도우미입니다. 학생 한 명이 푼 시험지 한 쪽 사진을 받습니다.
사진에서 어둡게 칠한 '개인정보 가림' 영역은 무시하세요. 반드시 submit_page 도구로만 답하세요.
사진에 있는 모든 문항을 번호 순서대로 찾고, 문항마다 다음을 적습니다.
- no: 인쇄된 문항 번호
- region: 사진 전체를 0~1로 볼 때 그 문항(문제와 학생 풀이 전체)이 차지하는 직사각형, 넉넉하게
- student_answer: 학생이 고른 보기 번호와 값, 또는 쓴 최종 답 (없으면 "무응답")
- correct_answer: 직접 풀어 본 정답 (정답표가 주어지면 그 값)
- verdict: 학생 답이 정답과 같으면 correct, 다르면 wrong, 답을 읽기 어렵거나 풀이가 확실하지 않으면 unsure
  선생님의 채점 표시(빨간 동그라미·빗금·체크)는 참고만 하고, 판단은 답의 내용으로 합니다. 조금이라도 의심되면 unsure로 둡니다.
- topic: 문제 유형을 짧게 (예: "일차방정식의 활용 - 거리·속력·시간", "정비례와 반비례 그래프")
- unit: 중등 수학 단원 이름 (예: "일차방정식", "좌표평면과 그래프", "정수와 유리수")
- note: 판정 근거 한 문장`;
const SCAN_TOOL = {
  name: 'submit_page',
  description: '시험지 한 쪽에서 찾은 문항 목록을 제출한다.',
  input_schema: {
    type: 'object',
    properties: {
      questions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            no: { type: 'string' },
            region: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' } } },
            student_answer: { type: 'string' },
            correct_answer: { type: 'string' },
            verdict: { type: 'string', enum: ['correct', 'wrong', 'unsure'] },
            topic: { type: 'string' },
            unit: { type: 'string' },
            note: { type: 'string' }
          },
          required: ['no', 'student_answer', 'verdict']
        }
      }
    },
    required: ['questions']
  }
};

function parseDataUrl(s) {
  const m = /^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/s.exec(s || '');
  return m ? { media_type: m[1], data: m[2] } : null;
}

// ---- 사용량 제한 ----
// ACCESS_CODE 가 설정되어 있으면 체험 코드가 맞을 때만 AI 진단을 한다 (코드가 없으면 화면은 데모 모드).
// 같은 IP의 요청은 10분에 RATE_LIMIT 번까지 (서버 인스턴스 단위의 간단한 제한).
const crypto = require('crypto');
const RATE_LIMIT = Number(process.env.RATE_LIMIT || 40);
const WINDOW_MS = 10 * 60 * 1000;
const hits = new Map();
function codeOk(given) {
  const want = process.env.ACCESS_CODE;
  if (!want) return true;
  const a = Buffer.from(String(given || '')), b = Buffer.from(want);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function clientIp(req) {
  const f = req.headers && (req.headers['x-forwarded-for'] || '');
  return String(f).split(',')[0].trim() || (req.socket && req.socket.remoteAddress) || 'unknown';
}
function rateOk(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter(t => now - t < WINDOW_MS);
  if (list.length >= RATE_LIMIT) { hits.set(ip, list); return false; }
  list.push(now); hits.set(ip, list);
  if (hits.size > 5000) hits.clear();
  return true;
}

module.exports = async function handler(req, res) {
  const key = process.env.ANTHROPIC_API_KEY;
  const code = req.headers && req.headers['x-access-code'];
  if (req.method === 'GET') {
    return res.status(200).json({ ready: !!key, needCode: !!process.env.ACCESS_CODE, codeOk: !!key && codeOk(code), model: key ? MODEL : null });
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  if (!key) return res.status(503).json({ error: 'no_api_key' });
  if (!codeOk(code)) return res.status(401).json({ error: 'bad_code' });
  if (!rateOk(clientIp(req))) return res.status(429).json({ error: 'rate_limited', message: '잠시 후 다시 시도해 주세요 (10분 사용 한도 초과)' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const img = parseDataUrl(body && body.image);
  const problem = String((body && body.problem) || '').slice(0, 2000);
  const scan = !!(body && body.scan);
  const qno = String((body && body.question_no) || '').replace(/[^0-9A-Za-z가-힣\-]/g, '').slice(0, 10);
  const answer = String((body && body.answer) || '').slice(0, 300);
  if (!img) return res.status(400).json({ error: 'bad_image' });
  if (img.data.length > 6_000_000) return res.status(413).json({ error: 'image_too_large' });
  if (!problem && !qno && !scan) return res.status(400).json({ error: 'no_problem' });
  const rg = body && body.region;
  const where = rg && [rg.x, rg.y, rg.w, rg.h].every(v => typeof v === 'number' && isFinite(v))
    ? `\n참고: 이 문항은 사진 전체를 0~1로 볼 때 대략 x=${rg.x.toFixed(2)}, y=${rg.y.toFixed(2)}, 너비 ${rg.w.toFixed(2)}, 높이 ${rg.h.toFixed(2)} 영역에 있습니다.` : '';

  const ansText = `정답: ${answer || '(주어지지 않음: 직접 풀어서 판단)'}`;
  const userText = qno && !problem
    ? `시험지 사진에서 ${qno}번 문항을 찾아, 문제를 사진에서 읽고 그 문항의 학생 풀이만 진단해 주세요.\n${ansText}${where}`
    : `문제: ${problem}\n${ansText}\n\n사진 속 학생의 풀이를 진단해 주세요.`;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: scan ? 3000 : 2500,
        system: scan ? SCAN_SYSTEM : SYSTEM,
        tools: [scan ? SCAN_TOOL : TOOL],
        tool_choice: { type: 'auto' },
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: img.media_type, data: img.data } },
            { type: 'text', text: scan ? `이 시험지 사진의 문항을 모두 찾아 주세요.${answer ? '\n정답표: ' + answer : ''}` : userText }
          ]
        }]
      })
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = (j && j.error && j.error.message) || `HTTP ${r.status}`;
      return res.status(502).json({ error: 'upstream', status: r.status, message: msg });
    }
    const block = (j.content || []).find(b => b.type === 'tool_use' && b.name === (scan ? 'submit_page' : 'submit_diagnosis'));
    let result = block ? block.input : null;
    if (!result) {
      // 도구 대신 글로 답한 경우: 본문에서 JSON을 찾아 읽는다
      const text = (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
      const m = text.match(/\{[\s\S]*\}/);
      if (m) { try { result = JSON.parse(m[0]); } catch (e) { result = null; } }
    }
    if (scan) {
      if (!result || !Array.isArray(result.questions)) return res.status(502).json({ error: 'no_result' });
      return res.status(200).json({ ok: true, model: j.model || MODEL, result, usage: j.usage || null });
    }
    if (result && result.question_found === false) return res.status(422).json({ error: 'question_not_found', message: `${qno}번 문항을 사진에서 찾지 못했습니다` });
    if (!result || !Array.isArray(result.transcribed_lines)) return res.status(502).json({ error: 'no_result' });
    return res.status(200).json({ ok: true, model: j.model || MODEL, result, usage: j.usage || null });
  } catch (e) {
    return res.status(502).json({ error: 'network', message: String(e && e.message || e) });
  }
};
