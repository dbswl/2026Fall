// 한 줄 진단: 풀이 사진 진단 API (Vercel 서버리스 함수)
// POST /api/diagnose  { image: "data:image/jpeg;base64,...", problem: "...", answer: "...", topic?: "..." }
// 환경 변수: ANTHROPIC_API_KEY (필수), CLAUDE_MODEL (선택, 기본 claude-sonnet-5-5)
// 키가 없으면 503 { error: "no_api_key" } 를 돌려주고, 화면은 데모 모드(예시 결과)로 전환한다.

const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5-5';

const SYSTEM = `당신은 학원 수학 강사의 채점을 돕는 오답 진단 도우미입니다.
선생님이 학생 한 명의 풀이 사진(한 문항)과 문제, 정답을 줍니다. 아래 순서로 진단하고 반드시 submit_diagnosis 도구로만 답하세요.

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
      similar_problem: {
        type: 'object',
        properties: { text: { type: 'string' }, answer: { type: 'string' } },
        required: ['text', 'answer']
      }
    },
    required: ['transcribed_lines', 'student_answer', 'is_correct', 'first_error_line', 'stopped_midway', 'cause', 'evidence', 'correct_line', 'confidence', 'legibility', 'teacher_note', 'similar_problem']
  }
};

function parseDataUrl(s) {
  const m = /^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/s.exec(s || '');
  return m ? { media_type: m[1], data: m[2] } : null;
}

module.exports = async function handler(req, res) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (req.method === 'GET') return res.status(200).json({ ready: !!key, model: key ? MODEL : null });
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  if (!key) return res.status(503).json({ error: 'no_api_key' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const img = parseDataUrl(body && body.image);
  const problem = String((body && body.problem) || '').slice(0, 2000);
  const answer = String((body && body.answer) || '').slice(0, 300);
  if (!img) return res.status(400).json({ error: 'bad_image' });
  if (img.data.length > 6_000_000) return res.status(413).json({ error: 'image_too_large' });
  if (!problem) return res.status(400).json({ error: 'no_problem' });

  const userText = `문제: ${problem}\n정답: ${answer || '(주어지지 않음: 직접 풀어서 판단)'}\n\n사진 속 학생의 풀이를 진단해 주세요.`;

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
        max_tokens: 2000,
        system: SYSTEM,
        tools: [TOOL],
        tool_choice: { type: 'auto' },
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: img.media_type, data: img.data } },
            { type: 'text', text: userText }
          ]
        }]
      })
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = (j && j.error && j.error.message) || `HTTP ${r.status}`;
      return res.status(502).json({ error: 'upstream', status: r.status, message: msg });
    }
    const block = (j.content || []).find(b => b.type === 'tool_use' && b.name === 'submit_diagnosis');
    let result = block ? block.input : null;
    if (!result) {
      // 도구 대신 글로 답한 경우: 본문에서 JSON을 찾아 읽는다
      const text = (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
      const m = text.match(/\{[\s\S]*\}/);
      if (m) { try { result = JSON.parse(m[0]); } catch (e) { result = null; } }
    }
    if (!result || !Array.isArray(result.transcribed_lines)) return res.status(502).json({ error: 'no_result' });
    return res.status(200).json({ ok: true, model: j.model || MODEL, result, usage: j.usage || null });
  } catch (e) {
    return res.status(502).json({ error: 'network', message: String(e && e.message || e) });
  }
};
