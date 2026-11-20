/* 한 줄 진단: 선생님 화면
   - 새 진단: 풀이 사진 → /api/diagnose (Claude) → 진단서 → 선생님 확인 → 기록 반영
   - 진찰 기록 / 오답 처방전 / 진단서 확인: 반 전체 기록을 보여 준다 (샘플 반 + 새로 진단한 풀이)
   - API 키가 없거나 서버가 없으면 데모 모드(샘플 반의 예시 결과)로 동작한다 */
(function () {
'use strict';

const D = window.DATA;
const CK = ['C', 'K', 'R', 'S'];
const LOW = 0.7;
const STORE = 'handline.v1';
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const pct = x => Math.round(x * 1000) / 10;
const emptyBy = () => ({ C: 0, K: 0, R: 0, S: 0 });

// ---------- 상태 ----------
function freshState() {
  return {
    recs: D.records.map((r, i) => ({ ...r, id: 's' + i, confirmed: false, byTeacher: false, src: 'sample' })),
    custom: [],                 // 직접 입력한 문항
    students: D.students.slice(),
    session: []                 // 이번에 진단한 풀이 (최근 순)
  };
}
let S = load() || freshState();
const ui = { tab: 'dx', stu: 'A', showAll: false, ai: null, dx: { qid: 12, s: 'A', photo: null, thumb: null, custom: { text: '', ans: '' }, newName: '' }, current: null, pickLine: false, busy: false };

function load() {
  try { const j = JSON.parse(localStorage.getItem(STORE) || 'null'); return j && j.recs ? j : null; } catch (e) { return null; }
}
function save() {
  const data = JSON.stringify(S);
  try { localStorage.setItem(STORE, data); } catch (e) {
    // 저장 공간이 부족하면 사진 미리보기를 빼고 다시 시도
    try { localStorage.setItem(STORE, JSON.stringify({ ...S, recs: S.recs.map(r => ({ ...r, photo: null })), session: S.session.map(x => ({ ...x, thumb: null })) })); } catch (e2) { /* 저장 없이 계속 */ }
  }
}

const allQs = () => D.questions.concat(S.custom);
const qOf = id => allQs().find(q => String(q.id) === String(id));
const N = () => S.students.length;
const PQ = () => allQs().length;
const unitLabel = q => q.unit ? `${q.unit}단원 ${D.units[q.unit]}` : '직접 입력한 문항';
const causeTag = k => k && D.causes[k] ? `<span class="tag ${k}">${D.causes[k].short}</span>` : '';
const topNames = a => a.map(k => D.causes[k].name).join(' · ');
const recById = id => S.recs.find(r => r.id === id);

function qStat(q) {
  const rs = S.recs.filter(r => String(r.q) === String(q.id));
  const by = emptyBy(); rs.forEach(r => by[r.cause]++);
  const mx = Math.max(...CK.map(k => by[k]));
  const top = mx > 0 ? CK.filter(k => by[k] === mx) : [];
  return { q, rs, n: rs.length, rate: rs.length / N(), by, top, kinds: CK.filter(k => by[k] > 0).length };
}
function sStat(s) {
  const rs = S.recs.filter(r => r.s === s);
  const by = emptyBy(); rs.forEach(r => by[r.cause]++);
  const mx = Math.max(...CK.map(k => by[k]));
  return { s, rs, score: Math.round((PQ() - rs.length) / PQ() * 100), by, top: CK.filter(k => by[k] === mx && mx > 0) };
}

function workBox(r, opt) {
  opt = opt || {};
  const cls = 'paper' + (opt.sm ? ' sm' : '');
  if (!r.work || !r.work.length) return `<div class="${cls} empty">풀이 없음 (빈칸)</div>`;
  const lines = r.work.map((l, i) => {
    const pick = opt.pick ? ' pick' : '';
    const data = opt.pick ? ` data-line="${i}" role="button" tabindex="0" aria-label="${i + 1}번째 줄을 틀린 줄로 지정"` : '';
    if (i === r.err) {
      return `<div class="wl err${pick}"${data}><span class="t">${esc(l)}</span><span class="errmark">← 여기서 틀림</span></div>` +
        (r.fix ? `<div class="fix">바른 줄: ${esc(r.fix)}</div>` : '');
    }
    return `<div class="wl${pick}"${data}><span class="t">${esc(l)}</span></div>`;
  }).join('');
  return `<div class="${cls}" role="group" aria-label="학생 풀이">${lines}${r.stop ? '<div class="wl stop">… 여기서 풀이를 멈춤</div>' : ''}</div>`;
}
function statusTxt(r) {
  const lowMark = r.conf < LOW && !r.confirmed;
  return `<span class="small ${lowMark ? 'low' : 'muted'}">${r.byTeacher ? '교사 지정' : r.confirmed ? '교사 확인' : lowMark ? '확인 대기 (신뢰도 ' + pct(r.conf) + '%)' : '신뢰도 ' + pct(r.conf) + '%'}</span>`;
}
const srcTag = r => r.src === 'ai' ? '<span class="src">AI 진단</span>' : r.src === 'demo' ? '<span class="src" style="color:var(--cK)">예시 진단</span>' : '';

// ---------- AI 연결 상태 ----------
async function checkAI() {
  try {
    const r = await fetch('api/diagnose', { method: 'GET' });
    const j = await r.json();
    ui.ai = !!j.ready;
  } catch (e) { ui.ai = false; }
  const el = $('aiStatus');
  el.className = 'status ' + (ui.ai ? 'on' : 'demo');
  el.textContent = ui.ai ? 'AI 연결됨' : '데모 모드';
  el.title = ui.ai ? 'Claude가 실제로 풀이 사진을 읽고 진단합니다' : 'AI 키가 설정되지 않아 샘플 반의 예시 결과를 보여 줍니다';
  if (ui.tab === 'dx') renderDx();
}

// ---------- 사진 처리 ----------
function readImage(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('이미지를 열 수 없습니다'));
      img.src = fr.result;
    };
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(file);
  });
}
function resize(img, max, q) {
  const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  g.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', q);
}
async function takeFile(file) {
  if (!file || !/^image\//.test(file.type)) { toast('이미지 파일을 올려 주세요'); return; }
  try {
    const img = await readImage(file);
    ui.dx.photo = resize(img, 1600, 0.86);
    ui.dx.thumb = resize(img, 360, 0.7);
    ui.current = null;
    renderDx();
  } catch (e) { toast('사진을 읽지 못했습니다: ' + e.message); }
}

// ---------- 진단 ----------
function currentProblem() {
  if (ui.dx.qid === 'new') return { id: 'new', text: ui.dx.custom.text.trim(), ans: ui.dx.custom.ans.trim(), topic: '직접 입력' };
  return qOf(ui.dx.qid);
}
function currentStudent() {
  return ui.dx.s === '__new' ? ui.dx.newName.trim() : ui.dx.s;
}
function plain(html) { const d = document.createElement('div'); d.innerHTML = html; return d.textContent; }

function demoResult(q, s) {
  // 샘플 반에서 같은 문항의 오답 하나를 골라 예시 결과로 돌려준다
  const pool = D.records.filter(r => q && String(r.q) === String(q.id) && r.work.length);
  const pick = pool.find(r => r.s === s) || pool[0];
  if (!pick) {
    return { transcribed_lines: ['(데모 모드에서는 샘플 문항만 예시 결과가 나옵니다)'], student_answer: '-', is_correct: false, first_error_line: 0, stopped_midway: false, cause: 'S', evidence: 'AI 키를 연결하면 이 사진을 실제로 읽어 진단합니다.', correct_line: '', confidence: 0.5, legibility: 'good', teacher_note: '', similar_problem: { text: '-', answer: '-' } };
  }
  return {
    transcribed_lines: pick.work.slice(), student_answer: pick.given, is_correct: false,
    first_error_line: pick.err == null ? -1 : pick.err, stopped_midway: !!pick.stop, cause: pick.cause,
    evidence: pick.why, correct_line: '', confidence: pick.conf, legibility: 'good',
    teacher_note: D.causes[pick.cause].tip, similar_problem: { text: plain(q.sim.text), answer: q.sim.ans }
  };
}

const STEPS = ['풀이를 한 줄씩 읽는 중', '처음 틀린 줄을 찾는 중', '원인을 진단하는 중'];
function renderLoading(step) {
  $('dxOut').innerHTML = `<div class="card"><div><h2>진단 중</h2><p class="muted small">사진 속 풀이를 읽고 있습니다. 보통 10~20초 걸립니다.</p></div>
    <div class="loading">${STEPS.map((t, i) => `<div class="st ${i < step ? 'done' : i === step ? 'now' : ''}"><i>${i < step ? '✓' : ''}</i>${t}</div>`).join('')}</div></div>`;
}

async function diagnose() {
  const q = currentProblem(); const s = currentStudent();
  if (!ui.dx.photo) return toast('풀이 사진을 먼저 올려 주세요');
  if (!q || !q.text) return toast('문제를 입력해 주세요');
  if (!s) return toast('학생 이름을 입력해 주세요');
  ui.busy = true; ui.pickLine = false; renderDxForm();
  let step = 0; renderLoading(0);
  const timer = setInterval(() => { if (step < 2) renderLoading(++step); }, 4500);
  let result = null, mode = 'ai', note = '';
  try {
    if (ui.ai === false) throw Object.assign(new Error('demo'), { demo: true });
    const r = await fetch('api/diagnose', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ image: ui.dx.photo, problem: plain(q.text), answer: q.ans, topic: q.topic })
    });
    const j = await r.json().catch(() => ({}));
    if (r.status === 503 && j.error === 'no_api_key') throw Object.assign(new Error('demo'), { demo: true });
    if (!r.ok || !j.result) throw new Error(j.message || j.error || ('HTTP ' + r.status));
    result = j.result;
  } catch (e) {
    if (!e.demo) note = 'AI 진단에 실패해 예시 결과를 보여 줍니다 (' + e.message + ').';
    await new Promise(res => setTimeout(res, 2200));
    result = demoResult(q, s); mode = 'demo';
  }
  clearInterval(timer);
  ui.busy = false;
  ui.current = toCurrent(result, q, s, mode, note);
  renderDx();
}

function toCurrent(R, q, s, mode, note) {
  const lines = Array.isArray(R.transcribed_lines) ? R.transcribed_lines.map(String) : [];
  let err = Number.isInteger(R.first_error_line) && R.first_error_line >= 0 && R.first_error_line < lines.length ? R.first_error_line : null;
  const cause = CK.includes(R.cause) ? R.cause : (R.is_correct ? null : 'S');
  return {
    mode, note, s, qid: q.id, qtext: q.text, qans: q.ans, photo: ui.dx.photo, thumb: ui.dx.thumb,
    correct: !!R.is_correct,
    rec: {
      s, q: q.id, given: R.student_answer || '무응답', work: lines, err, stop: !!R.stopped_midway,
      cause, conf: typeof R.confidence === 'number' ? Math.max(0, Math.min(1, R.confidence)) : 0.5,
      why: R.evidence || '', fix: R.correct_line || '', tip: R.teacher_note || '',
      sim: R.similar_problem && R.similar_problem.text ? { text: esc(R.similar_problem.text), ans: R.similar_problem.answer || '' } : null,
      legibility: R.legibility || 'good', src: mode, confirmed: false, byTeacher: false
    },
    aiCause: cause, aiErr: err, saved: false
  };
}

function ensureQuestion(cur) {
  if (cur.qid !== 'new') return cur.qid;
  const id = 'c' + (S.custom.length + 1);
  const text = cur.qtext;
  S.custom.push({ id, unit: 0, topic: text.length > 14 ? text.slice(0, 14) + '…' : text, text: esc(text), ans: cur.qans || '-',
    sim: cur.rec.sim || { text: '-', ans: '-' }, hint: cur.rec.tip || '' });
  cur.qid = id; cur.rec.q = id;
  return id;
}
function ensureStudent(s) { if (!S.students.includes(s)) S.students.push(s); }

function confirmCurrent() {
  const cur = ui.current; if (!cur || cur.saved) return;
  ensureStudent(cur.s);
  const qid = ensureQuestion(cur);
  S.recs = S.recs.filter(r => !(r.s === cur.s && String(r.q) === String(qid)));
  let msg;
  if (cur.correct) {
    msg = `학생 ${cur.s}의 ${qLabel(qid)}을 정답으로 기록했어요`;
  } else {
    const r = { ...cur.rec, id: 'a' + Date.now().toString(36), q: qid, photo: cur.thumb, confirmed: true,
      byTeacher: cur.rec.cause !== cur.aiCause || cur.rec.err !== cur.aiErr };
    S.recs.push(r);
    msg = `학생 ${cur.s}의 진단을 진찰 기록에 반영했어요`;
  }
  S.session.unshift({ s: cur.s, q: qid, cause: cur.correct ? null : cur.rec.cause, correct: cur.correct, thumb: cur.thumb, mode: cur.mode, t: Date.now() });
  S.session = S.session.slice(0, 20);
  cur.saved = true; ui.stu = cur.s;
  save(); renderDx(); updateCounts();
  toast(msg, [['진찰 기록 보기', () => show('brief')], ['처방전 보기', () => show('stu')]]);
}
const qLabel = id => { const q = qOf(id); return q ? (q.unit ? `${q.id}번` : '직접 입력 문항') : '문항'; };

// ---------- 새 진단 화면 ----------
function renderDx() {
  if (!$('dxForm')) {
    $('p-dx').innerHTML = `<div class="dx"><div class="card" id="dxForm"></div><div id="dxOut"></div></div><div class="card" id="dxSession"></div>`;
  }
  renderDxForm(); renderDxOut(); renderSession();
}
function renderDxForm() {
  const q = ui.dx.qid === 'new' ? null : qOf(ui.dx.qid);
  const qOpts = D.questions.map(x => `<option value="${x.id}"${String(x.id) === String(ui.dx.qid) ? ' selected' : ''}>${x.id}번 · ${esc(x.topic)}</option>`).join('') +
    `<option value="new"${ui.dx.qid === 'new' ? ' selected' : ''}>+ 다른 문제 직접 입력</option>`;
  const sOpts = S.students.map(x => `<option value="${esc(x)}"${x === ui.dx.s ? ' selected' : ''}>학생 ${esc(x)}</option>`).join('') +
    `<option value="__new"${ui.dx.s === '__new' ? ' selected' : ''}>+ 새 학생</option>`;
  const can = !!ui.dx.photo && !ui.busy;
  $('dxForm').innerHTML = `
    <div><h2>풀이 사진 진단</h2><p class="muted small">한 문항의 풀이가 보이게 찍은 사진 한 장을 올립니다.</p></div>
    <div class="field"><label for="qsel"><span class="stepno">1</span>문항</label>
      <select id="qsel">${qOpts}</select>
      ${q ? `<div class="probbox">${q.text}<div class="a">정답 ${esc(q.ans)} · ${unitLabel(q)}</div></div>` :
        `<textarea id="ctext" placeholder="문제를 입력하세요">${esc(ui.dx.custom.text)}</textarea>
         <input type="text" id="cans" placeholder="정답 (모르면 비워 두세요)" value="${esc(ui.dx.custom.ans)}">`}
    </div>
    <div class="field"><label for="ssel"><span class="stepno">2</span>학생</label>
      <select id="ssel">${sOpts}</select>
      ${ui.dx.s === '__new' ? `<input type="text" id="sname" placeholder="학생 이름 또는 번호" value="${esc(ui.dx.newName)}">` : ''}
    </div>
    <div class="field"><span class="lab"><span class="stepno">3</span>풀이 사진</span>
      <label class="drop" id="drop">
        <input type="file" id="file" accept="image/*" capture="environment" aria-label="풀이 사진 선택">
        ${ui.dx.photo ? `<img src="${ui.dx.photo}" alt="올린 풀이 사진"><span class="small">다른 사진으로 바꾸려면 누르세요</span>` :
          `<span class="big">📷</span><b>사진 찍기 또는 파일 선택</b><span class="small">여기로 끌어다 놓거나 붙여 넣어도 됩니다</span>`}
      </label>
    </div>
    <button class="btn wide" id="go" ${can ? '' : 'disabled'}>${ui.busy ? '진단 중…' : '진단하기'}</button>
    <p class="privacy">사진은 진단에만 쓰이고 서버에 저장되지 않습니다. 학생 이름은 가리고 찍어 주세요.</p>`;
}
function renderDxOut() {
  const out = $('dxOut'); if (!out) return;
  if (ui.busy) return;
  const cur = ui.current;
  if (!cur) {
    out.innerHTML = `<div class="card empty">
      <div><h2>진단서</h2><p class="muted small">진단하면 여기에 결과가 나옵니다.</p></div>
      <ol><li>학생이 쓴 풀이를 한 줄씩 옮겨 적고</li><li>처음 틀린 줄에 빨간 물결을 긋고</li><li>원인을 개념 부족 · 계산 실수 · 문제 오독 · 풀이 전략 오류 중 하나로 진단합니다.</li></ol>
      <p class="small muted">${ui.ai === false ? '지금은 <b>데모 모드</b>입니다. 사진을 올리면 샘플 반의 예시 결과를 보여 줍니다.' : 'AI가 내린 진단은 제안이고, 선생님이 확인해야 기록에 반영됩니다.'}</p></div>`;
    return;
  }
  const r = cur.rec; const q = cur.qid === 'new' ? { text: esc(cur.qtext), ans: cur.qans, topic: '직접 입력' } : qOf(cur.qid);
  const head = `<div class="res-head"><div><h2>학생 ${esc(cur.s)} · ${q.topic ? esc(q.topic) : ''}</h2>
      <p class="muted small">${q.unit ? q.id + '번 · ' + unitLabel(q) : '직접 입력한 문항'}</p></div>
      <div class="meta">${cur.mode === 'ai' ? '<span class="badge ai">AI 진단</span>' : '<span class="badge demo">데모 모드 · 예시 결과</span>'}
      ${!cur.correct ? `<span class="badge ${r.conf < LOW ? 'low' : 'ai'}">신뢰도 ${pct(r.conf)}%</span>` : ''}</div></div>`;
  const notes = (cur.note ? `<div class="warn">${esc(cur.note)}</div>` : '') +
    (r.legibility !== 'good' ? `<div class="warn">글씨가 ${r.legibility === 'poor' ? '잘 보이지 않아' : '일부 흐려서'} 판독이 틀렸을 수 있습니다. 옮겨 적은 풀이를 사진과 비교해 주세요.</div>` : '');
  const photo = `<div class="photo" id="photoBox" title="크게 보기"><img src="${cur.photo}" alt="학생 풀이 사진"></div>`;

  if (cur.correct) {
    out.innerHTML = `<div class="card">${head}${notes}
      <div class="res-grid">${photo}<div class="side" style="display:flex;flex-direction:column;gap:10px">
        ${workBox({ work: r.work, err: null })}
        <div class="good"><b style="color:var(--ok)">정답 풀이입니다.</b><div class="small">쓴 답 ${esc(r.given)} · 정답 ${esc(q.ans || '-')}</div></div>
      </div></div>
      <div class="actions">${cur.saved ? '<span class="done">정답으로 기록했어요</span>' : '<button class="btn ok" data-act="confirm">정답으로 기록</button>'}
        <button class="btn ghost" data-act="again">다시 진단</button></div></div>`;
    return;
  }

  const causeSel = `<select data-act="cause" aria-label="원인 바꾸기">${CK.map(k => `<option value="${k}"${k === r.cause ? ' selected' : ''}>${D.causes[k].name}</option>`).join('')}</select>`;
  const sim = r.sim || (q.sim ? { text: q.sim.text, ans: q.sim.ans } : null);
  out.innerHTML = `<div class="card">${head}${notes}
    <div class="res-grid">${photo}
      <div class="side" style="display:flex;flex-direction:column;gap:10px;min-width:0">
        ${ui.pickLine && !cur.saved ? '<div class="warn" style="border-color:var(--accent);background:var(--soft)">처음 틀린 줄을 눌러 고르세요.</div>' : ''}
        ${workBox(r, { pick: ui.pickLine && !cur.saved })}
        <div class="ans"><span>쓴 답 <span class="w">${esc(r.given)}</span></span><span>정답 <b>${esc(q.ans || '-')}</b></span></div>
      </div>
    </div>
    <div class="cols" style="gap:14px">
      <div class="note"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><b>원인</b> ${causeTag(r.cause)} ${cur.saved ? '' : causeSel}</div>
        <div class="small" style="margin-top:6px">${esc(r.why)}</div>
        ${r.tip ? `<div class="small" style="margin-top:6px"><b>지도 포인트</b> ${esc(r.tip)}</div>` : ''}</div>
      ${sim ? `<div class="note small"><b>처방 문제</b> <span class="muted">같은 유형의 연습 문제</span><br>${sim.text}<details><summary>정답 보기</summary>${esc(sim.ans)}</details></div>` : ''}
    </div>
    <div class="actions">
      ${cur.saved ? '<span class="done">✓ 진찰 기록과 오답 처방전에 반영했어요</span><button class="btn ghost" data-go="brief">진찰 기록 보기</button><button class="btn ghost" data-go="stu">처방전 보기</button>' :
        `<button class="btn ok" data-act="confirm">진단 확인하고 반영</button>
         <button class="btn ghost" data-act="pick">${ui.pickLine ? '줄 고르기 취소' : '틀린 줄 다시 고르기'}</button>
         <button class="btn ghost" data-act="again">다시 진단</button>`}
    </div></div>`;
}
function renderSession() {
  const el = $('dxSession'); if (!el) return;
  if (!S.session.length) { el.innerHTML = `<div><h2>이번에 진단한 풀이</h2><p class="muted small">아직 없습니다. 확인을 누른 진단이 여기에 쌓입니다.</p></div>`; return; }
  el.innerHTML = `<div><h2>이번에 진단한 풀이</h2><p class="muted small">확인한 진단 ${S.session.length}건 · 최근 순</p></div>
    <div class="session">${S.session.map(x => { const q = qOf(x.q); return `<div class="row">
      ${x.thumb ? `<img src="${x.thumb}" alt="">` : '<span></span>'}
      <div><b>학생 ${esc(x.s)}</b> · ${q ? (q.unit ? q.id + '번 ' : '') + esc(q.topic) : ''} <span class="small muted">${x.mode === 'ai' ? 'AI 진단' : '예시 진단'}</span></div>
      <div>${x.correct ? '<span class="done">정답</span>' : causeTag(x.cause)}</div></div>`; }).join('')}</div>`;
}

// ---------- 진찰 기록 (반 전체) ----------
function renderVersus() {
  const qs = allQs().map(qStat).filter(o => o.n > 0);
  if (!qs.length) return '';
  const o = [...qs].sort((a, b) => b.kinds - a.kinds || b.n - a.n)[0];
  const groups = CK.filter(k => o.by[k] > 0).map(k => {
    const rs = o.rs.filter(r => r.cause === k);
    const who = rs.map(r => {
      const line = r.err != null ? `<span class="h">${esc(r.work[r.err])}</span>` : `<span class="h none">${r.work.length ? '풀이 중단' : '빈칸'}</span>`;
      return `<div class="mini"><b>학생 ${esc(r.s)}</b>${line}</div>`;
    }).join('');
    return `<div class="grp"><div>${causeTag(k)}<div class="small muted num">${rs.length}명</div></div>
      <div class="who">${who}<div class="rx"><b>지도</b> ${D.causes[k].tip}</div></div></div>`;
  }).join('');
  return `<div class="card">
    <div><h2>같은 문항, 다른 원인</h2><p class="muted small">${o.q.unit ? o.q.id + '번(' + unitLabel(o.q) + ')' : '직접 입력한 문항'}에서 ${o.n}명이 틀렸습니다. 풀이를 읽으면 원인이 ${o.kinds}가지로 나뉩니다. 빨간 물결은 학생이 처음 틀린 줄입니다.</p></div>
    <div class="versus">
      <div class="old"><span class="small muted">정답·오답만 보는 오답노트</span>
        <span class="big">${o.q.unit ? o.q.id + '번 ' : ''}${esc(o.q.topic)} · ${o.n}명 오답</span>
        <span class="small">"${o.q.unit ? D.units[o.q.unit] : '이 문항'} 단원이 약함"으로 묶고, 같은 단원 문제를 ${o.n}명 모두에게 더 풀게 합니다.</span></div>
      <div class="new"><span class="small muted">풀이 한 줄을 읽는 한 줄 진단 (원인별 처방)</span>${groups}</div>
    </div></div>`;
}
function renderBrief() {
  const qs = allQs().map(qStat);
  const ss = S.students.map(sStat);
  const scores = ss.map(x => x.score);
  const avg = scores.reduce((a, b) => a + b, 0) / N();
  const order = [...qs].filter(o => o.n).sort((a, b) => b.rate - a.rate || String(a.q.id).localeCompare(String(b.q.id), undefined, { numeric: true })).slice(0, 4);
  const by = emptyBy(); S.recs.forEach(r => by[r.cause]++);
  const total = S.recs.length;
  const pending = S.recs.filter(r => r.conf < LOW && !r.confirmed).length;
  const watch = ss.filter(x => x.score <= 50).sort((a, b) => a.score - b.score);
  const orderHtml = order.map(o => {
    const share = o.n ? o.by[o.top[0]] / o.n : 0;
    const mode = share >= 0.6 ? `<b>반 전체 설명</b> 대부분 ${topNames(o.top)}(${o.by[o.top[0]]}/${o.n}명)` : `<b>원인이 갈림</b> ${CK.filter(k => o.by[k] > 0).map(k => D.causes[k].short + ' ' + o.by[k]).join(', ')} → 학생별로 다르게 지도`;
    return `<li><div><b>${o.q.unit ? o.q.id + '번 · ' : ''}${esc(o.q.topic)}</b> <span class="muted num">${o.n}/${N()}명 오답 (${pct(o.rate)}%)</span>
      <div class="small muted">${unitLabel(o.q)}</div>
      <div class="small">${mode}</div>
      ${o.q.hint ? `<div class="small"><b>설명 포인트</b> ${esc(o.q.hint)}</div>` : ''}</div></li>`;
  }).join('');
  const causeBar = CK.filter(k => by[k] > 0).map(k => `<div class="${k}" style="flex:${by[k]}" title="${D.causes[k].name} ${by[k]}건">${by[k]}</div>`).join('');
  const legend = CK.map(k => `<span>${causeTag(k)} ${D.causes[k].name} <b class="num">${by[k]}건 (${total ? pct(by[k] / total) : 0}%)</b></span>`).join('');
  const qRows = qs.map(o => `<div class="qrow"><div class="lbl"><b>${o.q.unit ? o.q.id + '번' : '직접'}</b> <span class="muted">${esc(o.q.topic)}</span></div>
    <div class="track" role="img" aria-label="${esc(o.q.topic)} 오답률 ${pct(o.rate)}%">${CK.filter(k => o.by[k] > 0).map(k => `<div class="${k}" style="width:${o.by[k] / N() * 100}%" title="${D.causes[k].short} ${o.by[k]}명"></div>`).join('')}</div>
    <div class="num">${o.n}/${N()} · ${pct(o.rate)}%</div></div>`).join('');
  const axis = `<div class="axis"><div></div><div class="ticks"><span>0%</span><span>25%</span><span>50%</span><span>75%</span><span>100%</span></div><div></div></div>`;
  const watchHtml = watch.map(x => `<div class="row"><b>학생 ${esc(x.s)}</b><span class="num">${x.score}점</span>
    <span>${CK.filter(k => x.by[k] > 0).map(k => causeTag(k) + ' ' + x.by[k]).join(' &nbsp; ')}</span>
    <button class="btn ghost" data-go-stu="${esc(x.s)}">오답 처방전 보기</button></div>`).join('');
  $('p-brief').innerHTML = `
    ${pending ? `<div class="notice"><span>원인 분류의 신뢰도가 ${LOW * 100}% 미만인 <b class="num">${pending}건</b>이 확인을 기다립니다. 확인하면 아래 통계가 바로 바뀝니다.</span><button class="btn" data-go="chk">진단서 확인하러 가기</button></div>` : `<div class="notice" style="background:var(--soft);border-color:var(--line)"><span>신뢰도가 낮은 진단을 모두 확인했습니다.</span></div>`}
    <div class="kpis">
      <div class="kpi"><b class="num">${avg.toFixed(1)}점</b><span>반 평균 (${N()}명)</span></div>
      <div class="kpi"><b class="num">${Math.max(...scores)} / ${Math.min(...scores)}점</b><span>최고 / 최저</span></div>
      <div class="kpi"><b class="num">${total}건</b><span>오답 (${N() * PQ()}문항 중)</span></div>
      <div class="kpi"><b class="num">${S.recs.filter(r => r.src === 'ai' || r.src === 'demo').length}건</b><span>사진으로 진단한 풀이</span></div>
    </div>
    ${renderVersus()}
    <div class="cols">
      <div class="card"><div><h2>다음 수업 설명 순서</h2><p class="muted small">오답률이 높은 문항 순서입니다.</p></div><ol class="order">${orderHtml}</ol></div>
      <div class="card"><div><h2>주의가 필요한 학생</h2><p class="muted small">점수가 50점 이하인 학생입니다.</p></div><div class="watch">${watchHtml || "<p class='muted'>해당 학생이 없습니다.</p>"}</div></div>
    </div>
    <div class="card">
      <div><h2>오답 원인 분포</h2><p class="muted small">오답 ${total}건의 원인 비율입니다.</p></div>
      <div class="stack" role="img" aria-label="오답 원인 분포">${causeBar}</div>
      <div class="legend">${legend}</div>
    </div>
    <div class="card">
      <div><h2>문항별 오답률</h2><p class="muted small">막대 전체 길이가 ${N()}명입니다. 색은 오답 원인입니다.</p></div>
      <div style="display:flex;flex-direction:column;gap:8px">${qRows}${axis}</div>
    </div>`;
}

// ---------- 오답 처방전 (학생별) ----------
function renderStu() {
  if (!S.students.includes(ui.stu)) ui.stu = S.students[0];
  const s = ui.stu, st = sStat(s);
  const chips = S.students.map(x => `<button class="chip" aria-pressed="${x === s}" data-stu="${esc(x)}">학생 ${esc(x)}</button>`).join('');
  const items = [...st.rs].sort((a, b) => String(a.q).localeCompare(String(b.q), undefined, { numeric: true })).map(r => {
    const q = qOf(r.q) || { id: r.q, topic: '', text: '', ans: '-', unit: 0, sim: { text: '-', ans: '-' } };
    const sim = r.sim || q.sim;
    return `<div class="item">
      <div class="side">
        <div><b>${q.unit ? q.id + '번 · ' : ''}${esc(q.topic)}</b> <span class="small muted">${unitLabel(q)}</span> ${srcTag(r)}</div>
        <div class="prob muted">${q.text}</div>
        ${workBox(r)}
        <div class="ans"><span>쓴 답 <span class="w">${esc(r.given)}</span></span><span>정답 <b>${esc(q.ans)}</b></span></div>
      </div>
      <div class="side">
        <div>${causeTag(r.cause)} ${statusTxt(r)}</div>
        <div class="small">${esc(r.why)}</div>
        ${r.photo ? `<div class="photo" data-zoom="${r.id}" style="max-width:220px"><img src="${r.photo}" alt="학생 풀이 사진"></div>` : ''}
        <div class="note small"><b>처방 문제</b> <span class="muted">같은 유형의 연습 문제</span><br>${sim.text}<details><summary>정답 보기</summary>${esc(sim.ans)}</details></div>
      </div></div>`;
  }).join('');
  const focus = st.top.length ? st.top.map(k => `${D.causes[k].name}(${st.by[k]}문항)`).join(' · ') : '';
  $('p-stu').innerHTML = `
    <div class="chips" role="group" aria-label="학생 선택">${chips}</div>
    <div class="card">
      <div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:space-between;align-items:center">
        <div><h2>학생 ${esc(s)} 오답 처방전</h2><p class="muted small num">${D.exam.title} · ${st.score}점 · 오답 ${st.rs.length}문항 · ${CK.filter(k => st.by[k] > 0).map(k => D.causes[k].short + ' ' + st.by[k]).join(', ')}</p></div>
        ${st.rs.length ? '<button class="btn ghost" data-act="print">인쇄하기</button>' : ''}
      </div>
      ${st.rs.length ? `<div class="note"><b>가장 먼저 고칠 것</b><br>${focus}. ${st.top.map(k => D.causes[k].tip).join(' ')}</div>
      <div style="display:flex;flex-direction:column;gap:12px">${items}</div>` : `<p>틀린 문항이 없습니다.</p>`}
    </div>`;
}

// ---------- 진단서 확인 ----------
function renderChk() {
  const recs = [...S.recs].sort((a, b) => a.conf - b.conf);
  const list = recs.filter(r => ui.showAll || (r.conf < LOW && !r.confirmed));
  const qs = allQs();
  const grid = S.students.map(s => `<tr><td><b>학생 ${esc(s)}</b></td>${qs.map(q => {
    const r = S.recs.find(x => x.s === s && String(x.q) === String(q.id));
    return r ? `<td><button class="cell" data-rec="${r.id}" aria-label="학생 ${esc(s)} ${esc(q.topic)} 오답, ${D.causes[r.cause].name}">${D.causes[r.cause].short.slice(0, 1)}</button></td>` : `<td><span class="cell ok" aria-label="정답">○</span></td>`;
  }).join('')}</tr>`).join('');
  const items = list.map(r => {
    const q = qOf(r.q) || { id: r.q, topic: '', ans: '-' };
    return `<div class="rec" id="rec-${r.id}">
      <div class="side" style="display:flex;flex-direction:column;gap:8px;min-width:0"><div><b>학생 ${esc(r.s)} · ${q.unit ? q.id + '번' : '직접 입력'}</b> <span class="muted small">${esc(q.topic)}</span> ${srcTag(r)}</div>
        ${workBox(r, { sm: true })}
        <div class="ans"><span>쓴 답 <span class="w">${esc(r.given)}</span></span><span>정답 ${esc(q.ans)}</span></div></div>
      <div class="small" style="display:flex;flex-direction:column;gap:6px"><div>AI 분류 ${causeTag(r.cause)} ${statusTxt(r)}</div><div>${esc(r.why)}</div></div>
      <div class="ctl">
        <label class="small muted" for="sel-${r.id}">원인 지정</label>
        <select id="sel-${r.id}" data-sel="${r.id}">${CK.map(k => `<option value="${k}"${k === r.cause ? ' selected' : ''}>${D.causes[k].name}</option>`).join('')}</select>
        ${r.confirmed ? `<span class="done">${r.byTeacher ? '교사 지정 완료' : '확인 완료'}</span>` : `<button class="btn" data-ok="${r.id}">이 분류가 맞음</button>`}
      </div></div>`;
  }).join('');
  const pending = S.recs.filter(r => r.conf < LOW && !r.confirmed).length;
  $('p-chk').innerHTML = `
    <div class="card">
      <div><h2>채점표</h2><p class="muted small">○는 정답, 글자는 오답 원인의 첫 글자입니다 (개 개념, 계 계산, 오 오독, 전 전략). 칸을 누르면 아래 목록에서 해당 진단서를 찾습니다.</p></div>
      <div class="tablewrap"><table class="grid"><thead><tr><th></th>${qs.map(q => `<th title="${esc(unitLabel(q))}">${q.unit ? q.id : '직'}</th>`).join('')}</tr></thead><tbody>${grid}</tbody></table></div>
    </div>
    <div class="card">
      <div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:space-between;align-items:center">
        <div><h2>진단서 확인</h2><p class="muted small">AI가 짚은 틀린 줄과 원인을 보고, 틀렸으면 바꾸고 맞으면 확인을 누릅니다. 확인 대기 <b class="num">${pending}건</b>.</p></div>
        <div class="chips"><button class="chip" aria-pressed="${!ui.showAll}" data-filter="pending">확인 대기만</button><button class="chip" aria-pressed="${ui.showAll}" data-filter="all">전체 ${S.recs.length}건</button></div>
      </div>
      <div style="display:flex;flex-direction:column;gap:10px">${items || "<p class='muted'>확인할 진단서가 없습니다.</p>"}</div>
    </div>`;
}

// ---------- 공통 ----------
function updateCounts() {
  const pending = S.recs.filter(r => r.conf < LOW && !r.confirmed).length;
  $('t-chk').innerHTML = '진단서 확인' + (pending ? `<span class="cnt">${pending}</span>` : '');
  $('classPill').textContent = `${D.exam.cls} · ${D.exam.title} · ${N()}명 · ${PQ()}문항`;
}
function show(tab) {
  ui.tab = tab;
  for (const t of ['dx', 'brief', 'stu', 'chk']) {
    $('p-' + t).hidden = t !== tab; $('t-' + t).setAttribute('aria-selected', String(t === tab));
  }
  render();
  try { localStorage.setItem(STORE + '.tab', tab); } catch (e) { /* 무시 */ }
  window.scrollTo({ top: 0 });
}
function render() {
  updateCounts();
  if (ui.tab === 'dx') renderDx(); else if (ui.tab === 'brief') renderBrief(); else if (ui.tab === 'stu') renderStu(); else renderChk();
}
let toastTimer = null;
function toast(msg, actions) {
  let el = document.querySelector('.toast'); if (el) el.remove();
  el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role', 'status');
  el.innerHTML = `<span>${esc(msg)}</span>` + (actions || []).map((a, i) => `<button data-t="${i}">${esc(a[0])}</button>`).join('');
  (actions || []).forEach((a, i) => el.querySelector(`[data-t="${i}"]`).addEventListener('click', () => { el.remove(); a[1](); }));
  document.body.appendChild(el);
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.remove(), 5000);
}
function zoom(src) { const d = $('zoom'); d.querySelector('img').src = src; d.showModal(); }

document.addEventListener('click', e => {
  if (e.target.closest('#zoom')) { $('zoom').close(); return; }
  const pb = e.target.closest('#photoBox'); if (pb) { zoom(ui.current.photo); return; }
  const zr = e.target.closest('[data-zoom]'); if (zr) { const r = recById(zr.dataset.zoom); if (r && r.photo) zoom(r.photo); return; }
  const ln = e.target.closest('[data-line]');
  if (ln && ui.current && ui.pickLine) { ui.current.rec.err = +ln.dataset.line; ui.current.rec.fix = ''; ui.pickLine = false; renderDxOut(); return; }
  const t = e.target.closest('button'); if (!t) return;
  if (t.id === 'go') { diagnose(); return; }
  if (t.id === 'resetBtn') { if (confirm('새로 진단한 기록을 지우고 샘플 반으로 되돌릴까요?')) { S = freshState(); ui.current = null; ui.dx.photo = null; save(); render(); toast('샘플 반으로 초기화했어요'); } return; }
  if (t.id && t.id.startsWith('t-')) { show(t.id.slice(2)); return; }
  if (t.dataset.go) { show(t.dataset.go); return; }
  if (t.dataset.goStu) { ui.stu = t.dataset.goStu; show('stu'); return; }
  if (t.dataset.stu) { ui.stu = t.dataset.stu; render(); return; }
  if (t.dataset.filter) { ui.showAll = t.dataset.filter === 'all'; render(); return; }
  if (t.dataset.ok !== undefined) { const r = recById(t.dataset.ok); if (r) { r.confirmed = true; save(); render(); } return; }
  if (t.dataset.act === 'confirm') { confirmCurrent(); return; }
  if (t.dataset.act === 'pick') { ui.pickLine = !ui.pickLine; renderDxOut(); return; }
  if (t.dataset.act === 'again') { diagnose(); return; }
  if (t.dataset.act === 'print') { window.print(); return; }
  if (t.dataset.rec !== undefined) {
    const r = recById(t.dataset.rec);
    if (r && !ui.showAll && !(r.conf < LOW && !r.confirmed)) { ui.showAll = true; render(); }
    const el = $('rec-' + t.dataset.rec); if (el) { el.scrollIntoView({ block: 'center' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1400); }
  }
});
document.addEventListener('keydown', e => {
  const ln = e.target.closest && e.target.closest('[data-line]');
  if (ln && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); ln.click(); }
});
document.addEventListener('change', e => {
  if (e.target.id === 'qsel') { ui.dx.qid = e.target.value === 'new' ? 'new' : (isNaN(+e.target.value) ? e.target.value : +e.target.value); ui.current = null; renderDx(); return; }
  if (e.target.id === 'ssel') { ui.dx.s = e.target.value; renderDxForm(); return; }
  if (e.target.id === 'file') { takeFile(e.target.files[0]); return; }
  if (e.target.dataset.act === 'cause' && ui.current) { ui.current.rec.cause = e.target.value; renderDxOut(); return; }
  const s = e.target.closest('select[data-sel]');
  if (s) { const r = recById(s.dataset.sel); if (r) { if (s.value !== r.cause) { r.cause = s.value; r.byTeacher = true; } r.confirmed = true; save(); render(); } }
});
document.addEventListener('input', e => {
  if (e.target.id === 'ctext') ui.dx.custom.text = e.target.value;
  if (e.target.id === 'cans') ui.dx.custom.ans = e.target.value;
  if (e.target.id === 'sname') ui.dx.newName = e.target.value;
});
// 끌어다 놓기 · 붙여 넣기
document.addEventListener('dragover', e => { const d = e.target.closest && e.target.closest('#drop'); if (d) { e.preventDefault(); d.classList.add('over'); } });
document.addEventListener('dragleave', e => { const d = e.target.closest && e.target.closest('#drop'); if (d) d.classList.remove('over'); });
document.addEventListener('drop', e => { const d = e.target.closest && e.target.closest('#drop'); if (d) { e.preventDefault(); d.classList.remove('over'); takeFile(e.dataTransfer.files[0]); } });
document.addEventListener('paste', e => {
  if (ui.tab !== 'dx') return;
  const f = [...(e.clipboardData && e.clipboardData.files || [])].find(x => /^image\//.test(x.type));
  if (f) takeFile(f);
});

try { const t = localStorage.getItem(STORE + '.tab'); if (t && ['dx', 'brief', 'stu', 'chk'].includes(t)) ui.tab = t; } catch (e) { /* 무시 */ }
show(ui.tab);
checkAI();
})();
