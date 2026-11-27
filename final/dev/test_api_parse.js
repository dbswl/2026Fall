// 진단 API가 깨진 AI 답을 바로잡거나 다시 묻는지 (Claude 응답은 가짜)
process.env.ANTHROPIC_API_KEY = 'sk-fake';
const handler = require('../api/diagnose.js');
const IMG = 'data:image/jpeg;base64,' + Buffer.alloc(100).toString('base64');
function call(body, answers) {
  let n = 0;
  global.fetch = async () => ({ ok: true, status: 200, json: async () => answers[Math.min(n++, answers.length - 1)] });
  return new Promise(resolve => {
    const res = { code: 200, status(c) { this.code = c; return this; }, setHeader() {}, json(o) { resolve({ code: this.code, body: o, calls: n }); } };
    handler({ method: 'POST', headers: {}, body }, res);
  });
}
const good = { content: [{ type: 'tool_use', name: 'submit_page', input: { questions: [{ no: 1, x: .1, y: .2, w: .4, h: .2, verdict: 'correct', student_answer: '④', topic: '소인수분해' }] } }], usage: {} };
const textOnly = { content: [{ type: 'text', text: '문항을 찾았습니다.' }], stop_reason: 'end_turn' };
const stringified = { content: [{ type: 'tool_use', name: 'submit_page', input: { questions: JSON.stringify([{ no: '24', region: { x: 0, y: .5, w: .5, h: .3 }, verdict: 'wrong', student_answer: '-150', topic: '새로 약속한 연산</topic>\n<parameter name="unit">정수와 유리수' }]) } }] };
(async () => {
  let r = await call({ image: IMG, scan: true }, [textOnly, good]);
  console.log('글만 온 뒤 다시 묻기:', r.code, r.calls, 'calls', r.body.result && r.body.result.questions.length, 'questions');
  r = await call({ image: IMG, scan: true }, [stringified]);
  console.log('문자열로 감싼 답:', r.code, JSON.stringify(r.body.result.questions[0]));
  r = await call({ image: IMG, scan: true }, [textOnly, textOnly]);
  console.log('두 번 모두 실패:', r.code, r.body.error, r.calls, 'calls');
})();
