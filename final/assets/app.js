/* 한 줄 진단: 선생님 화면
   - 새 진단: 풀이 사진(한 장 또는 여러 장) → /api/diagnose (Claude) → 진단서 → 선생님 확인 → 기록 반영
   - 진찰 기록 / 오답 처방전 / 진단서 확인: 반 전체 기록 (샘플 반 + 새로 진단한 풀이)
   - AI 키·체험 코드가 없거나 서버가 없으면 데모 모드(샘플 반의 예시 결과)로 동작한다 */
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
const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } };

// ---------- 상태 ----------
function freshState() {
  const graded = {};
  D.students.forEach(s => { graded[s] = D.questions.map(q => String(q.id)); });
  return {
    recs: D.records.map((r, i) => ({ ...r, id: 's' + i, confirmed: false, byTeacher: false, src: 'sample' })),
    custom: [],                 // 직접 입력한 문항
    students: D.students.slice(),
    graded,                     // 학생별로 채점·진단한 문항 (점수 계산의 분모)
    session: []                 // 이번에 진단해 반영한 풀이 (최근 순)
  };
}
function load() {
  try {
    const j = JSON.parse(lsGet(STORE) || 'null');
    if (!j || !j.recs) return null;
    if (!j.graded) {            // 이전 버전 저장분: 채점 문항 목록을 기록에서 다시 만든다
      j.graded = {};
      j.students.forEach(s => { j.graded[s] = D.students.includes(s) ? D.questions.map(q => String(q.id)) : []; });
      j.recs.forEach(r => { const g = j.graded[r.s] || (j.graded[r.s] = []); if (!g.includes(String(r.q))) g.push(String(r.q)); });
    }
    return j;
  } catch (e) { return null; }
}
let S = load() || freshState();
function save() {
  if (lsSet(STORE, JSON.stringify(S))) return;
  // 저장 공간이 부족하면 사진 미리보기를 빼고 다시 시도
  lsSet(STORE, JSON.stringify({ ...S, recs: S.recs.map(r => ({ ...r, photo: null })), session: S.session.map(x => ({ ...x, thumb: null })) }));
}

const ui = {
  tab: 'dx', stu: 'A', showAll: false,
  ai: null, needCode: false, codeOk: false, code: lsGet(STORE + '.code') || '',
  dx: { qid: 12, s: 'A', custom: { text: '', ans: '' }, newName: '' },
  queue: [], sel: null, pickLine: false, running: false,
  redact: lsGet(STORE + '.redact') !== '0',   // 개인정보 자동 가리기 (기본 켬)
  edit: null                                   // 가림 편집 중인 사진
};

const allQs = () => D.questions.concat(S.custom);
const qOf = id => allQs().find(q => String(q.id) === String(id));
const N = () => S.students.length;
const unitLabel = q => q.unit ? `${q.unit}단원 ${D.units[q.unit]}` : '직접 입력한 문항';
const causeTag = k => k && D.causes[k] ? `<span class="tag ${k}">${D.causes[k].short}</span>` : '';
const topNames = a => a.map(k => D.causes[k].name).join(' · ');
const recById = id => S.recs.find(r => r.id === id);
const gradedOf = s => S.graded[s] || [];
const takers = q => S.students.filter(s => gradedOf(s).includes(String(q.id)));

function qStat(q) {
  const rs = S.recs.filter(r => String(r.q) === String(q.id));
  const by = emptyBy(); rs.forEach(r => by[r.cause]++);
  const mx = Math.max(...CK.map(k => by[k]));
  const top = mx > 0 ? CK.filter(k => by[k] === mx) : [];
  const n = takers(q).length;
  return { q, rs, n: rs.length, takers: n, rate: n ? rs.length / n : 0, by, top, kinds: CK.filter(k => by[k] > 0).length };
}
function sStat(s) {
  const rs = S.recs.filter(r => r.s === s);
  const by = emptyBy(); rs.forEach(r => by[r.cause]++);
  const mx = Math.max(...CK.map(k => by[k]));
  const g = gradedOf(s).length;
  return { s, rs, graded: g, score: g ? Math.round((g - rs.length) / g * 100) : null, by, top: CK.filter(k => by[k] === mx && mx > 0) };
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
const aiOn = () => ui.ai && (!ui.needCode || ui.codeOk);

// ---------- AI 연결 상태 · 체험 코드 ----------
async function checkAI() {
  try {
    const r = await fetch('api/diagnose', { method: 'GET', headers: ui.code ? { 'x-access-code': ui.code } : {} });
    const j = await r.json();
    ui.ai = !!j.ready; ui.needCode = !!j.needCode; ui.codeOk = !!j.codeOk;
  } catch (e) { ui.ai = false; }
  const el = $('aiStatus');
  const on = aiOn();
  el.className = 'status ' + (on ? 'on' : 'demo');
  el.textContent = on ? 'AI 연결됨' : (ui.ai && ui.needCode ? '체험 코드 필요' : '데모 모드');
  el.title = on ? 'Claude가 실제로 풀이 사진을 읽고 진단합니다' : ui.ai ? '체험 코드를 넣으면 실제 AI 진단을 쓸 수 있습니다' : 'AI 키가 설정되지 않아 샘플 반의 예시 결과를 보여 줍니다';
  if (ui.tab === 'dx') renderDx();
}
async function submitCode(v) {
  ui.code = v.trim(); lsSet(STORE + '.code', ui.code);
  await checkAI();
  toast(aiOn() ? '체험 코드가 확인되었어요. 실제 AI 진단을 쓸 수 있습니다.' : '체험 코드가 맞지 않아요.');
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
let seq = 0;
function nextStudent(qid) {
  // 기본 학생에서 시작해, 같은 문항에 아직 배정되지 않은 다음 학생을 고른다
  const base = ui.dx.s === '__new' ? (ui.dx.newName.trim() || S.students[0]) : ui.dx.s;
  const list = S.students.includes(base) ? S.students : [base].concat(S.students);
  const start = Math.max(0, list.indexOf(base));
  const used = ui.queue.filter(it => String(it.qid) === String(qid) && !it.saved).map(it => it.s);
  for (let i = 0; i < list.length; i++) { const s = list[(start + i) % list.length]; if (!used.includes(s)) return s; }
  return base;
}
async function takeFiles(files) {
  const imgs = [...(files || [])].filter(f => /^image\//.test(f.type)).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  if (!imgs.length) { toast('이미지 파일을 올려 주세요'); return; }
  if (ui.queue.length + imgs.length > 40) { toast('한 번에 40장까지 올릴 수 있어요'); return; }
  const qid = ui.dx.qid;
  if (qid === 'new' && !ui.dx.custom.text.trim()) { toast('먼저 문제를 입력해 주세요'); return; }
  for (const f of imgs) {
    try {
      const img = await readImage(f);
      // 원본(img)은 이 화면의 메모리에만 두고, 서버·저장소에는 가린 사진만 쓴다
      const a = ui.redact && window.Redact ? Redact.analyze(img) : { rot: 0, masks: [] };
      const it = { id: 'p' + (++seq), name: f.name, img, rot: a.rot, masks: a.masks, auto: a.masks.length,
        qid, q: qid === 'new' ? { text: ui.dx.custom.text.trim(), ans: ui.dx.custom.ans.trim() } : null,
        s: nextStudent(qid), status: 'wait', cur: null, saved: false };
      paint(it);
      ui.queue.push(it);
      if (!ui.sel) ui.sel = it.id;
    } catch (e) { toast('사진을 읽지 못했습니다: ' + f.name); }
  }
  renderDx();
}
function paint(it) {
  if (window.Redact) { it.photo = Redact.render(it.img, it.rot, it.masks, 1600, 0.86); it.thumb = Redact.render(it.img, it.rot, it.masks, 360, 0.7); }
  else { it.photo = resize(it.img, 1600, 0.86); it.thumb = resize(it.img, 360, 0.7); }
}
const selItem = () => ui.queue.find(it => it.id === ui.sel) || null;

// ---------- 가림 편집 ----------
// 사진 위를 끌어 가릴 곳을 더하고, 가린 칸을 누르면 지운다. 적용하면 다시 진단한다.
function openEditor(it) {
  if (!it || !window.Redact) return;
  let dlg = $('redactDlg');
  if (!dlg) {
    dlg = document.createElement('dialog'); dlg.id = 'redactDlg'; dlg.className = 'redact';
    dlg.innerHTML = `<div class="rhead"><div><h2>개인정보 가림 편집</h2><p class="small muted">사진 위를 끌어서 가릴 곳을 더하고, 가린 칸을 누르면 지웁니다. 원본 사진은 이 기기 밖으로 나가지 않습니다.</p></div></div>
      <div class="rwrap"><canvas id="rc"></canvas></div>
      <div class="actions"><button class="btn ghost" data-r="rot">↻ 90° 돌리기</button><button class="btn ghost" data-r="auto">자동으로 다시 찾기</button><button class="btn ghost" data-r="clear">가림 모두 지우기</button>
        <span style="flex:1"></span><button class="btn ghost" data-r="cancel">취소</button><button class="btn ok" data-r="ok">적용</button></div>`;
    document.body.appendChild(dlg);
    const cv = dlg.querySelector('#rc');
    let start = null, temp = null;
    const pos = e => { const r = cv.getBoundingClientRect(); return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) }; };
    cv.addEventListener('pointerdown', e => { start = pos(e); temp = null; cv.setPointerCapture(e.pointerId); });
    cv.addEventListener('pointermove', e => { if (!start) return; const p = pos(e); temp = { x: Math.min(start.x, p.x), y: Math.min(start.y, p.y), w: Math.abs(p.x - start.x), h: Math.abs(p.y - start.y) }; drawEditor(temp); });
    cv.addEventListener('pointerup', e => {
      const ed = ui.edit; if (!ed || !start) return;
      const p = pos(e);
      if (temp && temp.w > 0.01 && temp.h > 0.005) ed.masks.push(temp);
      else { const i = ed.masks.findIndex(m => p.x >= m.x && p.x <= m.x + m.w && p.y >= m.y && p.y <= m.y + m.h); if (i >= 0) ed.masks.splice(i, 1); }
      start = null; temp = null; drawEditor();
    });
    dlg.addEventListener('click', e => {
      const b = e.target.closest('[data-r]'); if (!b) return;
      const ed = ui.edit; if (!ed) return;
      const k = b.dataset.r;
      if (k === 'rot') { ed.rot = (ed.rot + 90) % 360; ed.masks = []; prepEditor(); }
      if (k === 'auto') { const a = Redact.analyze(ed.it.img); ed.rot = a.rot; ed.masks = a.masks; prepEditor(); }
      if (k === 'clear') { ed.masks = []; drawEditor(); }
      if (k === 'cancel') { ui.edit = null; dlg.close(); }
      if (k === 'ok') {
        const it2 = ed.it; it2.rot = ed.rot; it2.masks = ed.masks; paint(it2);
        const had = it2.status === 'done' || it2.status === 'err';
        if (had) { it2.status = 'wait'; it2.cur = null; }
        ui.edit = null; dlg.close(); ui.sel = it2.id; renderDx();
        toast(had ? '가림을 바꿨어요. 이 사진을 다시 진단해 주세요.' : `가림 ${it2.masks.length}곳을 적용했어요`);
      }
    });
  }
  ui.edit = { it, rot: it.rot, masks: it.masks.map(m => ({ ...m })) };
  dlg.showModal(); prepEditor();
}
function prepEditor() {
  const ed = ui.edit; const cv = $('rc');
  ed.base = Redact.canvasOf(ed.it.img, ed.rot, 1100);
  cv.width = ed.base.width; cv.height = ed.base.height;
  drawEditor();
}
function drawEditor(temp) {
  const ed = ui.edit; const cv = $('rc'); if (!ed || !ed.base) return;
  const g = cv.getContext('2d'); g.drawImage(ed.base, 0, 0);
  const W = cv.width, H = cv.height;
  for (const m of ed.masks.concat(temp ? [temp] : [])) {
    g.fillStyle = m === temp ? 'rgba(42,74,134,.35)' : 'rgba(43,47,54,.82)';
    g.fillRect(m.x * W, m.y * H, m.w * W, m.h * H);
    g.strokeStyle = '#7ea3e8'; g.lineWidth = Math.max(2, W / 400); g.setLineDash([8, 6]); g.strokeRect(m.x * W, m.y * H, m.w * W, m.h * H); g.setLineDash([]);
  }
}

// ---------- 진단 ----------
function problemOf(it) {
  if (it.qid === 'new' || String(it.qid).startsWith('c') && it.q) return { id: it.qid, text: esc(it.q.text), ans: it.q.ans, topic: '직접 입력', unit: 0 };
  return qOf(it.qid);
}
function plain(html) { const d = document.createElement('div'); d.innerHTML = html; return d.textContent; }

function demoResult(q, s) {
  // 샘플 반에서 같은 문항·같은 학생의 기록을 예시 결과로 돌려준다 (없으면 같은 문항의 다른 학생, 그것도 없으면 정답)
  const pool = D.records.filter(r => q && String(r.q) === String(q.id) && r.work.length);
  const pick = pool.find(r => r.s === s) || (D.students.includes(s) && q && q.unit ? null : pool[0]);
  if (!pick) {
    if (q && q.unit) {
      return { transcribed_lines: ['(예시) 바르게 푼 풀이'], student_answer: q.ans, is_correct: true, first_error_line: -1, stopped_midway: false, cause: 'none', evidence: '샘플 반에서 이 학생은 이 문항을 맞혔습니다.', correct_line: '', confidence: 0.95, legibility: 'good', teacher_note: '', similar_problem: { text: plain(q.sim.text), answer: q.sim.ans } };
    }
    return { transcribed_lines: ['(데모 모드에서는 샘플 문항만 예시 결과가 나옵니다)'], student_answer: '-', is_correct: false, first_error_line: 0, stopped_midway: false, cause: 'S', evidence: 'AI 진단을 연결하면 이 사진을 실제로 읽어 진단합니다.', correct_line: '', confidence: 0.5, legibility: 'good', teacher_note: '', similar_problem: { text: '-', answer: '-' } };
  }
  return {
    transcribed_lines: pick.work.slice(), student_answer: pick.given, is_correct: false,
    first_error_line: pick.err == null ? -1 : pick.err, stopped_midway: !!pick.stop, cause: pick.cause,
    evidence: pick.why, correct_line: '', confidence: pick.conf, legibility: 'good',
    teacher_note: D.causes[pick.cause].tip, similar_problem: { text: plain(q.sim.text), answer: q.sim.ans }
  };
}

async function diagnoseItem(it) {
  const q = problemOf(it);
  it.status = 'run'; it.cur = null; it.saved = false;
  let result = null, mode = 'ai', note = '';
  try {
    if (!aiOn()) throw Object.assign(new Error('demo'), { demo: true });
    const r = await fetch('api/diagnose', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-access-code': ui.code || '' },
      body: JSON.stringify({ image: it.photo, problem: plain(q.text), answer: q.ans, topic: q.topic })
    });
    const j = await r.json().catch(() => ({}));
    if (r.status === 503 && j.error === 'no_api_key') throw Object.assign(new Error('demo'), { demo: true });
    if (r.status === 401) { ui.codeOk = false; throw Object.assign(new Error('체험 코드가 맞지 않음'), { demo: true }); }
    if (!r.ok || !j.result) throw new Error(j.message || j.error || ('HTTP ' + r.status));
    result = j.result;
  } catch (e) {
    if (!e.demo) note = 'AI 진단에 실패해 예시 결과를 보여 줍니다 (' + e.message + ').';
    await new Promise(res => setTimeout(res, 900 + Math.random() * 700));
    result = demoResult(q, it.s); mode = 'demo';
  }
  it.cur = toCurrent(result, q, it, mode, note);
  it.status = 'done';
}

async function runAll(items) {
  if (ui.running) return;
  const todo = items.filter(it => it.status === 'wait' || it.status === 'err');
  if (!todo.length) return;
  for (const it of todo) {
    if (it.qid === 'new' || !qOf(it.qid) && !(it.q && it.q.text)) {
      if (!it.q || !it.q.text) { toast('문제를 입력해 주세요'); return; }
    }
    if (!String(it.s || '').trim()) { toast('학생을 모두 정해 주세요'); return; }
  }
  ui.running = true; ui.pickLine = false; renderDx();
  let i = 0;
  const worker = async () => {
    while (i < todo.length) {
      const it = todo[i++];
      renderDx();
      try { await diagnoseItem(it); } catch (e) { it.status = 'err'; }
      if (!ui.sel || !selItem() || selItem().status !== 'done') ui.sel = it.id;
      renderDx();
    }
  };
  await Promise.all([worker(), worker()]);   // 동시에 두 장씩
  ui.running = false;
  const first = ui.queue.find(it => it.status === 'done' && !it.saved && it.cur && !it.cur.correct && it.cur.rec.conf < LOW) || ui.queue.find(it => it.status === 'done' && !it.saved);
  if (first) ui.sel = first.id;
  renderDx();
}

function toCurrent(R, q, it, mode, note) {
  const lines = Array.isArray(R.transcribed_lines) ? R.transcribed_lines.map(String) : [];
  const err = Number.isInteger(R.first_error_line) && R.first_error_line >= 0 && R.first_error_line < lines.length ? R.first_error_line : null;
  const cause = CK.includes(R.cause) ? R.cause : (R.is_correct ? null : 'S');
  return {
    mode, note, correct: !!R.is_correct,
    rec: {
      s: it.s, q: it.qid, given: R.student_answer || '무응답', work: lines, err, stop: !!R.stopped_midway,
      cause, conf: typeof R.confidence === 'number' ? Math.max(0, Math.min(1, R.confidence)) : 0.5,
      why: R.evidence || '', fix: R.correct_line || '', tip: R.teacher_note || '',
      sim: R.similar_problem && R.similar_problem.text ? { text: esc(R.similar_problem.text), ans: R.similar_problem.answer || '' } : null,
      legibility: R.legibility || 'good', src: mode, confirmed: false, byTeacher: false
    },
    aiCause: cause, aiErr: err
  };
}

function ensureQuestion(it) {
  if (it.qid !== 'new') return it.qid;
  // 같은 문제를 이미 저장했으면 그 문항을 쓴다
  const same = S.custom.find(c => plain(c.text) === it.q.text);
  let id;
  if (same) id = same.id;
  else {
    id = 'c' + (S.custom.length + 1);
    const text = it.q.text;
    S.custom.push({ id, unit: 0, topic: text.length > 14 ? text.slice(0, 14) + '…' : text, text: esc(text), ans: it.q.ans || '-',
      sim: (it.cur && it.cur.rec.sim) || { text: '-', ans: '-' }, hint: (it.cur && it.cur.rec.tip) || '' });
  }
  ui.queue.forEach(x => { if (x.qid === 'new' && x.q && x.q.text === it.q.text) { x.qid = id; if (x.cur) x.cur.rec.q = id; } });
  return id;
}
function confirmItem(it, quiet) {
  if (!it || !it.cur || it.saved) return false;
  const cur = it.cur;
  if (!S.students.includes(it.s)) { S.students.push(it.s); S.graded[it.s] = []; }
  const qid = ensureQuestion(it);
  const g = S.graded[it.s] || (S.graded[it.s] = []);
  if (!g.includes(String(qid))) g.push(String(qid));
  S.recs = S.recs.filter(r => !(r.s === it.s && String(r.q) === String(qid)));
  if (!cur.correct) {
    S.recs.push({ ...cur.rec, s: it.s, id: 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), q: qid, photo: it.thumb, confirmed: true,
      byTeacher: cur.rec.cause !== cur.aiCause || cur.rec.err !== cur.aiErr });
  }
  S.session.unshift({ s: it.s, q: qid, cause: cur.correct ? null : cur.rec.cause, correct: cur.correct, thumb: it.thumb, mode: cur.mode, t: Date.now() });
  S.session = S.session.slice(0, 40);
  it.saved = true; ui.stu = it.s;
  if (!quiet) {
    save(); renderDx(); updateCounts();
    const next = ui.queue.find(x => x.status === 'done' && !x.saved);
    toast(cur.correct ? `학생 ${it.s}의 풀이를 정답으로 기록했어요` : `학생 ${it.s}의 진단을 반영했어요`,
      next ? [['다음 진단서 보기', () => { ui.sel = next.id; ui.pickLine = false; renderDx(); }]] : [['진찰 기록 보기', () => show('brief')], ['처방전 보기', () => show('stu')]]);
  }
  return true;
}
function confirmConfident() {
  const list = ui.queue.filter(it => it.status === 'done' && !it.saved && it.cur && (it.cur.correct || it.cur.rec.conf >= LOW));
  list.forEach(it => confirmItem(it, true));
  save(); updateCounts();
  const left = ui.queue.filter(it => it.status === 'done' && !it.saved);
  if (left.length) ui.sel = left[0].id;
  renderDx();
  toast(`${list.length}건을 반영했어요` + (left.length ? `. 신뢰도가 낮은 ${left.length}건은 직접 확인해 주세요` : ''),
    left.length ? [] : [['진찰 기록 보기', () => show('brief')]]);
}

// ---------- 새 진단 화면 ----------
function renderDx() {
  if (!$('dxForm')) {
    $('p-dx').innerHTML = `<div class="dx"><div class="card" id="dxForm"></div><div id="dxOut" style="display:flex;flex-direction:column;gap:16px;min-width:0"></div></div><div class="card" id="dxSession"></div>`;
  }
  renderDxForm(); renderDxOut(); renderSession();
}
function codeBox() {
  if (!(ui.ai && ui.needCode && !ui.codeOk)) return '';
  return `<div class="field codebox"><label for="code">체험 코드</label>
    <div style="display:flex;gap:6px"><input type="text" id="code" placeholder="실제 AI 진단용 코드" value="${esc(ui.code)}" autocomplete="off"><button class="btn ghost" data-act="code" type="button">확인</button></div>
    <span class="privacy">코드가 없으면 샘플 반의 예시 결과로 체험할 수 있습니다.</span></div>`;
}
function renderDxForm() {
  const q = ui.dx.qid === 'new' ? null : qOf(ui.dx.qid);
  const qOpts = D.questions.map(x => `<option value="${x.id}"${String(x.id) === String(ui.dx.qid) ? ' selected' : ''}>${x.id}번 · ${esc(x.topic)}</option>`).join('') +
    `<option value="new"${ui.dx.qid === 'new' ? ' selected' : ''}>+ 다른 문제 직접 입력</option>`;
  const sOpts = S.students.map(x => `<option value="${esc(x)}"${x === ui.dx.s ? ' selected' : ''}>학생 ${esc(x)}</option>`).join('') +
    `<option value="__new"${ui.dx.s === '__new' ? ' selected' : ''}>+ 새 학생</option>`;
  const waiting = ui.queue.filter(it => it.status === 'wait' || it.status === 'err').length;
  const qn = ui.queue.length;
  $('dxForm').innerHTML = `
    <div><h2>풀이 사진 진단</h2><p class="muted small">한 문항의 풀이가 보이게 찍은 사진을 올립니다. 반 전체 사진을 한꺼번에 올려도 됩니다.</p></div>
    ${codeBox()}
    <div class="field"><label for="qsel"><span class="stepno">1</span>문항</label>
      <select id="qsel"${ui.running ? ' disabled' : ''}>${qOpts}</select>
      ${q ? `<div class="probbox">${q.text}<div class="a">정답 ${esc(q.ans)} · ${unitLabel(q)}</div></div>` :
        `<textarea id="ctext" placeholder="문제를 입력하세요">${esc(ui.dx.custom.text)}</textarea>
         <input type="text" id="cans" placeholder="정답 (모르면 비워 두세요)" value="${esc(ui.dx.custom.ans)}">`}
    </div>
    <div class="field"><label for="ssel"><span class="stepno">2</span>학생 <span class="muted" style="font-weight:400">(여러 장이면 이 학생부터 차례로)</span></label>
      <select id="ssel">${sOpts}</select>
      ${ui.dx.s === '__new' ? `<input type="text" id="sname" placeholder="학생 이름 또는 번호" value="${esc(ui.dx.newName)}">` : ''}
    </div>
    <div class="field"><span class="lab"><span class="stepno">3</span>풀이 사진</span>
      <label class="drop" id="drop">
        <input type="file" id="file" accept="image/*" multiple aria-label="풀이 사진 선택 (여러 장 가능)">
        <span class="big">📷</span><b>${qn ? '사진 더 추가하기' : '사진 찍기 또는 파일 선택'}</b><span class="small">여러 장을 한꺼번에 고르거나 끌어다 놓아도 됩니다</span>
      </label>
      <label class="toggle"><input type="checkbox" id="redact"${ui.redact ? ' checked' : ''}> 학원 이름·로고·학생 이름 자동으로 가리기</label>
    </div>
    ${qn ? queueHtml() : ''}
    <button class="btn wide" id="go" ${waiting && !ui.running ? '' : 'disabled'}>${ui.running ? '진단 중…' : waiting > 1 ? `${waiting}장 모두 진단하기` : '진단하기'}</button>
    <p class="privacy">${ui.redact ? '시험지 머리글(학원 로고·시험 이름·학생 이름)과 바닥글은 이 기기에서 먼저 가린 뒤 전송합니다. ' : ''}사진은 진단에만 쓰이고 서버에 저장되지 않습니다.</p>`;
}
function queueHtml() {
  const stOpts = cur => S.students.map(x => `<option value="${esc(x)}"${x === cur ? ' selected' : ''}>${esc(x)}</option>`).join('') + (S.students.includes(cur) ? '' : `<option selected>${esc(cur)}</option>`);
  const rows = ui.queue.map(it => {
    const q = problemOf(it);
    let st;
    if (it.status === 'wait') st = '<span class="qst">대기</span>';
    else if (it.status === 'run') st = '<span class="qst run">진단 중</span>';
    else if (it.status === 'err') st = '<span class="qst bad">실패</span>';
    else if (it.saved) st = '<span class="qst ok">✓ 반영</span>';
    else if (it.cur.correct) st = '<span class="qst ok">정답</span>';
    else st = `${causeTag(it.cur.rec.cause)}${it.cur.rec.conf < LOW ? '<span class="qst bad">확인</span>' : ''}`;
    return `<div class="qrow2${it.id === ui.sel ? ' on' : ''}" data-sel-item="${it.id}">
      <img src="${it.thumb}" alt="">
      <div class="qmeta"><select data-item-s="${it.id}" aria-label="학생"${it.status === 'run' || it.saved ? ' disabled' : ''}>${stOpts(it.s)}</select>
        <span class="small muted">${q && q.unit ? q.id + '번' : '직접 입력'}${it.masks.length ? ` · <span class="hid">가림 ${it.masks.length}곳</span>` : ''}</span>
        ${it.saved || it.status === 'run' ? '' : `<button class="linkbtn" data-edit-item="${it.id}" type="button">가림 편집</button>`}</div>
      <div class="qstate">${st}</div>
      <button class="x" data-del-item="${it.id}" aria-label="이 사진 빼기" ${it.status === 'run' ? 'disabled' : ''}>×</button></div>`;
  }).join('');
  return `<div class="queue"><div class="qhead"><b>올린 사진 ${ui.queue.length}장</b><button class="linkbtn" data-act="clearq" type="button" ${ui.running ? 'disabled' : ''}>모두 비우기</button></div>${rows}</div>`;
}
function renderDxOut() {
  const out = $('dxOut'); if (!out) return;
  const done = ui.queue.filter(it => it.status === 'done');
  const pend = done.filter(it => !it.saved);
  const running = ui.queue.filter(it => it.status === 'run').length;
  const total = ui.queue.filter(it => it.status !== 'wait' || ui.running).length;
  let top = '';
  if (ui.running) {
    const fin = ui.queue.filter(it => it.status === 'done' || it.status === 'err').length;
    const all = ui.queue.filter(it => it.status !== 'wait' || true).length;
    top = `<div class="card"><div class="res-head"><div><h2>진단 중 ${fin} / ${all}</h2><p class="muted small">사진마다 풀이를 읽고, 처음 틀린 줄과 원인을 찾고 있습니다. 한 장에 보통 5~15초 걸립니다.</p></div></div>
      <div class="bar"><div style="width:${all ? fin / all * 100 : 0}%"></div></div></div>`;
  } else if (done.length > 1 && pend.length) {
    const sure = pend.filter(it => it.cur.correct || it.cur.rec.conf >= LOW).length;
    const low = pend.length - sure;
    top = `<div class="card summary"><div class="res-head"><div><h2>진단 결과 ${done.length}건</h2>
      <p class="muted small">반영 대기 ${pend.length}건 · 신뢰도 높음 ${sure}건 · 확인 필요 ${low}건</p></div>
      ${sure ? `<button class="btn ok" data-act="confirmall">신뢰도 높은 ${sure}건 모두 반영</button>` : ''}</div>
      ${low ? `<p class="small">신뢰도가 ${LOW * 100}% 미만인 진단은 한 장씩 열어 확인한 뒤 반영해 주세요.</p>` : ''}</div>`;
  }
  const it = selItem();
  let card = '';
  if (it && it.status === 'done' && it.cur) card = resultCard(it);
  else if (it && it.status === 'run') card = `<div class="card"><div class="loading"><div class="st now"><i></i>이 사진을 진단하는 중</div></div></div>`;
  else if (!ui.queue.length || (it && it.status === 'wait' && !ui.running)) {
    card = `<div class="card empty">
      <div><h2>진단서</h2><p class="muted small">진단하면 여기에 결과가 나옵니다.</p></div>
      <ol><li>학생이 쓴 풀이를 한 줄씩 옮겨 적고</li><li>처음 틀린 줄에 빨간 물결을 긋고</li><li>원인을 개념 부족 · 계산 실수 · 문제 오독 · 풀이 전략 오류 중 하나로 진단합니다.</li></ol>
      <p class="small muted">${aiOn() ? 'AI가 내린 진단은 제안이고, 선생님이 확인해야 기록에 반영됩니다.' : '지금은 <b>데모 모드</b>입니다. 사진을 올리면 샘플 반의 예시 결과를 보여 줍니다.'}</p></div>`;
  }
  out.innerHTML = top + card;
}
function resultCard(it) {
  const cur = it.cur; const r = cur.rec; const q = problemOf(it);
  const head = `<div class="res-head"><div><h2>학생 ${esc(it.s)} · ${q.topic ? esc(q.topic) : ''}</h2>
      <p class="muted small">${q.unit ? q.id + '번 · ' + unitLabel(q) : '직접 입력한 문항'}${ui.queue.length > 1 ? ` · ${ui.queue.indexOf(it) + 1}번째 사진` : ''}</p></div>
      <div class="meta">${cur.mode === 'ai' ? '<span class="badge ai">AI 진단</span>' : '<span class="badge demo">데모 모드 · 예시 결과</span>'}
      ${!cur.correct ? `<span class="badge ${r.conf < LOW ? 'low' : 'ai'}">신뢰도 ${pct(r.conf)}%</span>` : ''}</div></div>`;
  const notes = (cur.note ? `<div class="warn">${esc(cur.note)}</div>` : '') +
    (r.legibility !== 'good' ? `<div class="warn">글씨가 ${r.legibility === 'poor' ? '잘 보이지 않아' : '일부 흐려서'} 판독이 틀렸을 수 있습니다. 옮겨 적은 풀이를 사진과 비교해 주세요.</div>` : '') +
    (!cur.correct && r.conf < LOW && !it.saved ? `<div class="warn">신뢰도가 낮은 진단입니다. 틀린 줄과 원인이 맞는지 확인해 주세요.</div>` : '');
  const photo = `<div class="photo" data-zoom-item="${it.id}" title="크게 보기"><img src="${it.photo}" alt="학생 풀이 사진"></div>`;
  const nav = ui.queue.length > 1 ? `<button class="btn ghost" data-act="prev">이전</button><button class="btn ghost" data-act="next">다음</button>` : '';

  if (cur.correct) {
    return `<div class="card">${head}${notes}
      <div class="res-grid">${photo}<div class="side" style="display:flex;flex-direction:column;gap:10px">
        ${workBox({ work: r.work, err: null })}
        <div class="good"><b style="color:var(--ok)">정답 풀이입니다.</b><div class="small">쓴 답 ${esc(r.given)} · 정답 ${esc(q.ans || '-')}</div></div>
      </div></div>
      <div class="actions">${it.saved ? '<span class="done">✓ 정답으로 기록했어요</span>' : '<button class="btn ok" data-act="confirm">정답으로 기록</button>'}
        <button class="btn ghost" data-act="again">다시 진단</button>${nav}</div></div>`;
  }
  const causeSel = `<select data-act="cause" aria-label="원인 바꾸기">${CK.map(k => `<option value="${k}"${k === r.cause ? ' selected' : ''}>${D.causes[k].name}</option>`).join('')}</select>`;
  const sim = r.sim || (q.sim ? { text: q.sim.text, ans: q.sim.ans } : null);
  return `<div class="card">${head}${notes}
    <div class="res-grid">${photo}
      <div class="side" style="display:flex;flex-direction:column;gap:10px;min-width:0">
        ${ui.pickLine && !it.saved ? '<div class="warn" style="border-color:var(--accent);background:var(--soft)">처음 틀린 줄을 눌러 고르세요.</div>' : ''}
        ${workBox(r, { pick: ui.pickLine && !it.saved })}
        <div class="ans"><span>쓴 답 <span class="w">${esc(r.given)}</span></span><span>정답 <b>${esc(q.ans || '-')}</b></span></div>
      </div>
    </div>
    <div class="cols" style="gap:14px">
      <div class="note"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><b>원인</b> ${causeTag(r.cause)} ${it.saved ? '' : causeSel}</div>
        <div class="small" style="margin-top:6px">${esc(r.why)}</div>
        ${r.tip ? `<div class="small" style="margin-top:6px"><b>지도 포인트</b> ${esc(r.tip)}</div>` : ''}</div>
      ${sim ? `<div class="note small"><b>처방 문제</b> <span class="muted">같은 유형의 연습 문제</span><br>${sim.text}<details><summary>정답 보기</summary>${esc(sim.ans)}</details></div>` : ''}
    </div>
    <div class="actions">
      ${it.saved ? '<span class="done">✓ 진찰 기록과 오답 처방전에 반영했어요</span>' :
        `<button class="btn ok" data-act="confirm">진단 확인하고 반영</button>
         <button class="btn ghost" data-act="pick">${ui.pickLine ? '줄 고르기 취소' : '틀린 줄 다시 고르기'}</button>
         <button class="btn ghost" data-act="again">다시 진단</button>
         <button class="btn ghost" data-edit-item="${it.id}">가림 편집</button>`}${nav}
    </div></div>`;
}
function renderSession() {
  const el = $('dxSession'); if (!el) return;
  if (!S.session.length) { el.innerHTML = `<div><h2>반영한 진단</h2><p class="muted small">아직 없습니다. 확인을 누른 진단이 여기에 쌓입니다.</p></div>`; return; }
  el.innerHTML = `<div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:space-between;align-items:center"><div><h2>반영한 진단</h2><p class="muted small">${S.session.length}건 · 최근 순</p></div>
    <div class="actions"><button class="btn ghost" data-go="brief">진찰 기록 보기</button><button class="btn ghost" data-go="stu">처방전 보기</button></div></div>
    <div class="session">${S.session.slice(0, 12).map(x => { const q = qOf(x.q); return `<div class="row">
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
  const qs = allQs().map(qStat).filter(o => o.takers > 0);
  const ss = S.students.map(sStat);
  const scored = ss.filter(x => x.score != null);
  const scores = scored.map(x => x.score);
  const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  const order = [...qs].filter(o => o.n).sort((a, b) => b.rate - a.rate || b.n - a.n || String(a.q.id).localeCompare(String(b.q.id), undefined, { numeric: true })).slice(0, 4);
  const by = emptyBy(); S.recs.forEach(r => by[r.cause]++);
  const total = S.recs.length;
  const gradedTotal = ss.reduce((a, x) => a + x.graded, 0);
  const pending = S.recs.filter(r => r.conf < LOW && !r.confirmed).length;
  const watch = scored.filter(x => x.score <= 50).sort((a, b) => a.score - b.score);
  const orderHtml = order.map(o => {
    const share = o.n ? o.by[o.top[0]] / o.n : 0;
    const mode = share >= 0.6 ? `<b>반 전체 설명</b> 대부분 ${topNames(o.top)}(${o.by[o.top[0]]}/${o.n}명)` : `<b>원인이 갈림</b> ${CK.filter(k => o.by[k] > 0).map(k => D.causes[k].short + ' ' + o.by[k]).join(', ')} → 학생별로 다르게 지도`;
    return `<li><div><b>${o.q.unit ? o.q.id + '번 · ' : ''}${esc(o.q.topic)}</b> <span class="muted num">${o.n}/${o.takers}명 오답 (${pct(o.rate)}%)</span>
      <div class="small muted">${unitLabel(o.q)}</div>
      <div class="small">${mode}</div>
      ${o.q.hint ? `<div class="small"><b>설명 포인트</b> ${esc(o.q.hint)}</div>` : ''}</div></li>`;
  }).join('');
  const causeBar = CK.filter(k => by[k] > 0).map(k => `<div class="${k}" style="flex:${by[k]}" title="${D.causes[k].name} ${by[k]}건">${by[k]}</div>`).join('');
  const legend = CK.map(k => `<span>${causeTag(k)} ${D.causes[k].name} <b class="num">${by[k]}건 (${total ? pct(by[k] / total) : 0}%)</b></span>`).join('');
  const qRows = qs.map(o => `<div class="qrow"><div class="lbl"><b>${o.q.unit ? o.q.id + '번' : '직접'}</b> <span class="muted">${esc(o.q.topic)}</span></div>
    <div class="track" role="img" aria-label="${esc(o.q.topic)} 오답률 ${pct(o.rate)}%">${CK.filter(k => o.by[k] > 0).map(k => `<div class="${k}" style="width:${o.by[k] / o.takers * 100}%" title="${D.causes[k].short} ${o.by[k]}명"></div>`).join('')}</div>
    <div class="num">${o.n}/${o.takers} · ${pct(o.rate)}%</div></div>`).join('');
  const axis = `<div class="axis"><div></div><div class="ticks"><span>0%</span><span>25%</span><span>50%</span><span>75%</span><span>100%</span></div><div></div></div>`;
  const watchHtml = watch.map(x => `<div class="row"><b>학생 ${esc(x.s)}</b><span class="num">${x.score}점</span>
    <span>${CK.filter(k => x.by[k] > 0).map(k => causeTag(k) + ' ' + x.by[k]).join(' &nbsp; ')}</span>
    <button class="btn ghost" data-go-stu="${esc(x.s)}">오답 처방전 보기</button></div>`).join('');
  $('p-brief').innerHTML = `
    ${pending ? `<div class="notice"><span>원인 분류의 신뢰도가 ${LOW * 100}% 미만인 <b class="num">${pending}건</b>이 확인을 기다립니다. 확인하면 아래 통계가 바로 바뀝니다.</span><button class="btn" data-go="chk">진단서 확인하러 가기</button></div>` : `<div class="notice" style="background:var(--soft);border-color:var(--line)"><span>신뢰도가 낮은 진단을 모두 확인했습니다.</span></div>`}
    <div class="kpis">
      <div class="kpi"><b class="num">${avg.toFixed(1)}점</b><span>반 평균 (${scored.length}명)</span></div>
      <div class="kpi"><b class="num">${scores.length ? Math.max(...scores) + ' / ' + Math.min(...scores) : '-'}점</b><span>최고 / 최저</span></div>
      <div class="kpi"><b class="num">${total}건</b><span>오답 (채점 ${gradedTotal}문항 중)</span></div>
      <div class="kpi"><b class="num">${S.recs.filter(r => r.src === 'ai' || r.src === 'demo').length}건</b><span>사진으로 진단한 오답</span></div>
    </div>
    ${renderVersus()}
    <div class="cols">
      <div class="card"><div><h2>다음 수업 설명 순서</h2><p class="muted small">오답률이 높은 문항 순서입니다.</p></div><ol class="order">${orderHtml || '<li><div class="muted">아직 오답이 없습니다.</div></li>'}</ol></div>
      <div class="card"><div><h2>주의가 필요한 학생</h2><p class="muted small">점수가 50점 이하인 학생입니다.</p></div><div class="watch">${watchHtml || "<p class='muted'>해당 학생이 없습니다.</p>"}</div></div>
    </div>
    <div class="card">
      <div><h2>오답 원인 분포</h2><p class="muted small">오답 ${total}건의 원인 비율입니다.</p></div>
      <div class="stack" role="img" aria-label="오답 원인 분포">${causeBar}</div>
      <div class="legend">${legend}</div>
    </div>
    <div class="card">
      <div><h2>문항별 오답률</h2><p class="muted small">막대 전체 길이가 그 문항을 채점한 학생 수입니다. 색은 오답 원인입니다.</p></div>
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
  const scoreTxt = st.score == null ? '채점한 문항 없음' : `${st.score}점 (채점 ${st.graded}문항)`;
  $('p-stu').innerHTML = `
    <div class="chips" role="group" aria-label="학생 선택">${chips}</div>
    <div class="card">
      <div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:space-between;align-items:center">
        <div><h2>학생 ${esc(s)} 오답 처방전</h2><p class="muted small num">${D.exam.title} · ${scoreTxt} · 오답 ${st.rs.length}문항${st.rs.length ? ' · ' + CK.filter(k => st.by[k] > 0).map(k => D.causes[k].short + ' ' + st.by[k]).join(', ') : ''}</p></div>
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
    if (r) return `<td><button class="cell" data-rec="${r.id}" aria-label="학생 ${esc(s)} ${esc(q.topic)} 오답, ${D.causes[r.cause].name}">${D.causes[r.cause].short.slice(0, 1)}</button></td>`;
    return gradedOf(s).includes(String(q.id)) ? `<td><span class="cell ok" aria-label="정답">○</span></td>` : `<td><span class="cell ok" aria-label="채점 안 함" style="opacity:.35">·</span></td>`;
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
      <div><h2>채점표</h2><p class="muted small">○는 정답, 글자는 오답 원인의 첫 글자입니다 (개 개념, 계 계산, 오 오독, 전 전략). 점(·)은 아직 채점하지 않은 문항입니다. 칸을 누르면 아래 목록에서 해당 진단서를 찾습니다.</p></div>
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
  $('classPill').textContent = `${D.exam.cls} · ${D.exam.title} · ${N()}명 · ${allQs().length}문항`;
}
function show(tab) {
  ui.tab = tab;
  for (const t of ['dx', 'brief', 'stu', 'chk']) {
    $('p-' + t).hidden = t !== tab; $('t-' + t).setAttribute('aria-selected', String(t === tab));
  }
  render();
  lsSet(STORE + '.tab', tab);
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
function step(dir) {
  const done = ui.queue.filter(it => it.status === 'done');
  const i = done.findIndex(it => it.id === ui.sel);
  if (!done.length) return;
  ui.sel = done[(i + dir + done.length) % done.length].id; ui.pickLine = false; renderDxOut(); renderDxForm();
}

document.addEventListener('click', e => {
  if (e.target.closest('#zoom')) { $('zoom').close(); return; }
  const zi = e.target.closest('[data-zoom-item]'); if (zi) { const it = ui.queue.find(x => x.id === zi.dataset.zoomItem); if (it) zoom(it.photo); return; }
  const zr = e.target.closest('[data-zoom]'); if (zr) { const r = recById(zr.dataset.zoom); if (r && r.photo) zoom(r.photo); return; }
  const ln = e.target.closest('[data-line]');
  const it0 = selItem();
  if (ln && it0 && it0.cur && ui.pickLine) { it0.cur.rec.err = +ln.dataset.line; it0.cur.rec.fix = ''; ui.pickLine = false; renderDxOut(); return; }
  const ed = e.target.closest('[data-edit-item]');
  if (ed) { openEditor(ui.queue.find(x => x.id === ed.dataset.editItem)); return; }
  const del = e.target.closest('[data-del-item]');
  if (del) { ui.queue = ui.queue.filter(x => x.id !== del.dataset.delItem); if (ui.sel === del.dataset.delItem) ui.sel = ui.queue.length ? ui.queue[0].id : null; renderDx(); return; }
  const row = e.target.closest('[data-sel-item]');
  if (row && !e.target.closest('select')) { ui.sel = row.dataset.selItem; ui.pickLine = false; renderDx(); return; }
  const t = e.target.closest('button'); if (!t) return;
  if (t.id === 'go') { runAll(ui.queue); return; }
  if (t.id === 'resetBtn') { if (confirm('새로 진단한 기록을 지우고 샘플 반으로 되돌릴까요?')) { S = freshState(); ui.queue = []; ui.sel = null; save(); render(); toast('샘플 반으로 초기화했어요'); } return; }
  if (t.id && t.id.startsWith('t-')) { show(t.id.slice(2)); return; }
  if (t.dataset.go) { show(t.dataset.go); return; }
  if (t.dataset.goStu) { ui.stu = t.dataset.goStu; show('stu'); return; }
  if (t.dataset.stu) { ui.stu = t.dataset.stu; render(); return; }
  if (t.dataset.filter) { ui.showAll = t.dataset.filter === 'all'; render(); return; }
  if (t.dataset.ok !== undefined) { const r = recById(t.dataset.ok); if (r) { r.confirmed = true; save(); render(); } return; }
  const act = t.dataset.act;
  if (act === 'confirm') { confirmItem(selItem()); return; }
  if (act === 'confirmall') { confirmConfident(); return; }
  if (act === 'pick') { ui.pickLine = !ui.pickLine; renderDxOut(); return; }
  if (act === 'again') { const it = selItem(); if (it) { it.status = 'wait'; runAll([it]); } return; }
  if (act === 'prev') { step(-1); return; }
  if (act === 'next') { step(1); return; }
  if (act === 'clearq') { ui.queue = []; ui.sel = null; renderDx(); return; }
  if (act === 'code') { submitCode($('code').value); return; }
  if (act === 'print') { window.print(); return; }
  if (t.dataset.rec !== undefined) {
    const r = recById(t.dataset.rec);
    if (r && !ui.showAll && !(r.conf < LOW && !r.confirmed)) { ui.showAll = true; render(); }
    const el = $('rec-' + t.dataset.rec); if (el) { el.scrollIntoView({ block: 'center' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1400); }
  }
});
document.addEventListener('keydown', e => {
  const ln = e.target.closest && e.target.closest('[data-line]');
  if (ln && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); ln.click(); }
  if (e.target.id === 'code' && e.key === 'Enter') { e.preventDefault(); submitCode(e.target.value); }
});
document.addEventListener('change', e => {
  if (e.target.id === 'qsel') { ui.dx.qid = e.target.value === 'new' ? 'new' : +e.target.value; renderDxForm(); return; }
  if (e.target.id === 'ssel') { ui.dx.s = e.target.value; renderDxForm(); return; }
  if (e.target.id === 'file') { takeFiles(e.target.files); e.target.value = ''; return; }
  if (e.target.id === 'redact') { ui.redact = e.target.checked; lsSet(STORE + '.redact', ui.redact ? '1' : '0'); renderDxForm(); return; }
  if (e.target.dataset.itemS) { const it = ui.queue.find(x => x.id === e.target.dataset.itemS); if (it) { it.s = e.target.value; if (it.cur) it.cur.rec.s = it.s; renderDx(); } return; }
  if (e.target.dataset.act === 'cause') { const it = selItem(); if (it && it.cur) { it.cur.rec.cause = e.target.value; renderDxOut(); renderDxForm(); } return; }
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
document.addEventListener('drop', e => { const d = e.target.closest && e.target.closest('#drop'); if (d) { e.preventDefault(); d.classList.remove('over'); takeFiles(e.dataTransfer.files); } });
document.addEventListener('paste', e => {
  if (ui.tab !== 'dx') return;
  const fs = [...(e.clipboardData && e.clipboardData.files || [])].filter(x => /^image\//.test(x.type));
  if (fs.length) takeFiles(fs);
});

const t0 = lsGet(STORE + '.tab'); if (t0 && ['dx', 'brief', 'stu', 'chk'].includes(t0)) ui.tab = t0;
show(ui.tab);
checkAI();
})();
