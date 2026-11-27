/* 한 줄 진단: 선생님 화면
   - 새 진단: 풀이 사진(한 장 또는 여러 장) → /api/diagnose (Claude) → 진단서 → 선생님 확인 → 기록 반영
   - 진찰 기록 / 오답 처방전 / 진단서 확인: 선생님이 만든 반의 기록 (반은 여러 개, 반마다 따로 저장)
   - 처음에는 반이 없고, 반 이름·학생 수를 정해 만든 뒤 시작한다 */
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

// ---------- 상태: 반(그룹) ----------
// 기록은 반마다 따로 둔다. 처음에는 반이 없고, 선생님이 반 이름과 학생 수를 정해 만든다.
const DBKEY = 'handline.groups';
const letter = i => i < 26 ? String.fromCharCode(65 + i) : String.fromCharCode(65 + Math.floor(i / 26) - 1) + String.fromCharCode(65 + i % 26);
const autoName = i => '학생 ' + letter(i);
function emptyGroup(name, students) {
  const graded = {}; students.forEach(x => { graded[x] = []; });
  return { id: 'g' + Date.now().toString(36), name, students: students.slice(), recs: [], custom: [], graded, session: [] };
}
function sampleGroup() {
  // 둘러보기용 샘플 반 (가상의 학생 8명, 16문항 숙제)
  const graded = {};
  const nm = x => '학생 ' + x;
  D.students.forEach(x => { graded[nm(x)] = D.questions.map(q => String(q.id)); });
  return { id: 'g' + Date.now().toString(36), name: `샘플 반 (${D.exam.cls})`, sample: true, students: D.students.map(nm),
    recs: D.records.map((r, i) => ({ ...r, s: nm(r.s), id: 's' + i, confirmed: false, byTeacher: false, src: 'sample' })), custom: [], graded, session: [] };
}
function loadDB() {
  try {
    const j = JSON.parse(lsGet(DBKEY) || 'null');
    if (j && Array.isArray(j.groups)) {
      // 이전에 만든 반: 알파벳만 있는 이름은 '학생 A'로 바꿔 둔다
      j.groups.forEach(g => { (g.custom || []).forEach(q => { q.topic = clip(q.topic, 40) || q.topic; if (q.unitName) q.unitName = clip(q.unitName, 30); }); });
      j.groups.forEach(g => {
        const map = {}; g.students.forEach(x => { if (/^[A-Z]{1,2}$/.test(x)) map[x] = '학생 ' + x; });
        if (!Object.keys(map).length) return;
        const ren = x => map[x] || x;
        g.students = g.students.map(ren);
        g.recs.forEach(r => { r.s = ren(r.s); }); g.session.forEach(x => { x.s = ren(x.s); });
        const gr = {}; Object.keys(g.graded || {}).forEach(k => { gr[ren(k)] = g.graded[k]; }); g.graded = gr;
      });
      return j;
    }
  } catch (e) { }
  return { cur: null, groups: [] };
}
let DB = loadDB();
let S = DB.groups.find(g => g.id === DB.cur) || DB.groups[0] || null;
try { localStorage.removeItem(STORE); } catch (e) { }   // 예전 버전(샘플 반 기본) 저장분은 쓰지 않는다
function save() {
  if (S) DB.cur = S.id;
  if (lsSet(DBKEY, JSON.stringify(DB))) return;
  // 저장 공간이 부족하면 사진 미리보기를 빼고 다시 시도
  lsSet(DBKEY, JSON.stringify({ ...DB, groups: DB.groups.map(g => ({ ...g, recs: g.recs.map(r => ({ ...r, photo: null })), session: g.session.map(x => ({ ...x, thumb: null })) })) }));
}
function useGroup(g) {
  S = g; DB.cur = g.id; save();
  ui.queue = []; ui.sel = null; ui.onboard = false;
  ui.stu = g.students[0]; ui.dx.s = g.students[0];
  show(ui.tab === 'new' ? 'dx' : ui.tab);
}

const ui = {
  tab: 'dx', stu: 'A', showAll: false, onboard: false,
  newG: { name: '', count: 8, names: [], custom: false },     // 새 반 만들기 입력
  ai: null, needCode: false, codeOk: false, code: lsGet(STORE + '.code') || '',
  dx: { qid: 'sheet', s: 'A', custom: { text: '', ans: '' }, sheet: { exam: '', nos: '', ans: '' }, newName: '' },
  queue: [], sel: null, pickLine: false, running: false,
  redact: lsGet(STORE + '.redact') !== '0',   // 개인정보 자동 가리기 (기본 켬)
  edit: null                                   // 가림 편집 중인 사진
};

const allQs = () => (S && S.sample ? D.questions : []).concat(S ? S.custom : []);
const qOf = id => allQs().find(q => String(q.id) === String(id));
const N = () => S.students.length;
const unitLabel = q => q.unit ? `${q.unit}단원 ${D.units[q.unit]}` : q.sheet ? [q.unitName, q.exam].filter(Boolean).join(' · ') : '직접 입력한 문항';
const qNo = q => q.unit ? q.id + '번' : q.sheet ? (q.no === '전체' ? '문항 찾기' : q.no + '번') : '직접 입력';     // 짧은 문항 표시
const qPre = q => q.unit ? q.id + '번 · ' : q.sheet ? q.no + '번 · ' : '';
const qHead = q => q.unit ? q.id : q.sheet ? q.no : '직';                         // 채점표 머리
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
  el.title = on ? 'Claude가 실제로 시험지를 읽고 진단합니다' : ui.ai ? '체험 코드를 넣으면 실제 AI 진단을 쓸 수 있습니다' : 'AI 키가 설정되지 않아 진단할 수 없습니다';
  if (S && !ui.onboard && ui.tab === 'dx') renderDx();
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
function baseStudent() { return ui.dx.s === '__new' ? (ui.dx.newName.trim() || S.students[0]) : ui.dx.s; }
async function takeFiles(files) {
  const imgs = [...(files || [])].filter(f => /^image\//.test(f.type)).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  if (!imgs.length) { toast('이미지 파일을 올려 주세요'); return; }
  if (ui.queue.length + imgs.length > 40) { toast('한 번에 40장까지 올릴 수 있어요'); return; }
  const qid = ui.dx.qid;
  if (qid === 'new' && !ui.dx.custom.text.trim()) { toast('먼저 문제를 입력해 주세요'); return; }
  let sheet = null;
  if (qid === 'sheet') {
    sheet = sheetSpec();
    if (ui.queue.length + imgs.length * Math.max(1, sheet.nos.length) > 60) { toast('한 번에 60문항까지 진단할 수 있어요'); return; }
  }
  for (const f of imgs) {
    try {
      const img = await readImage(f);
      // 원본(img)은 이 화면의 메모리에만 두고, 서버·저장소에는 가린 사진만 쓴다
      const a = ui.redact && window.Redact ? Redact.analyze(img) : { rot: 0, masks: [] };
      const it = { id: 'p' + (++seq), name: f.name, img, rot: a.rot, masks: a.masks, auto: a.masks.length,
        qid, q: qid === 'new' ? { text: ui.dx.custom.text.trim(), ans: ui.dx.custom.ans.trim() } : null,
        reviewed: false, s: baseStudent(), status: 'wait', cur: null, saved: false };
      paint(it);
      if (sheet && !sheet.nos.length) {
        it.grp = it.id; it.scan = true; it.qid = 'scan:' + sheet.exam; it.q = null;
        it.sheet = { exam: sheet.exam, no: '전체', key: sheet.key, keyText: sheet.keyText, text: '' };
        ui.queue.push(it);
        if (!ui.sel) ui.sel = it.id;
        continue;
      }
      if (sheet) {
        // 같은 사진을 문항 번호마다 나눠 진단한다 (가림·학생은 사진 단위로 함께 바뀜)
        it.grp = it.id;
        sheet.nos.forEach((no, k) => {
          const x = k ? { ...it, id: 'p' + (++seq) } : it;
          x.qid = sheetQid(sheet.exam, no); x.q = null;
          x.sheet = { exam: sheet.exam, no, ans: sheet.key[no] || '', text: '' };
          ui.queue.push(x);
          if (!ui.sel) ui.sel = x.id;
        });
        continue;
      }
      ui.queue.push(it);
      if (!ui.sel) ui.sel = it.id;
    } catch (e) { toast('사진을 읽지 못했습니다: ' + f.name); }
  }
  renderDx();
  openReview();
}
function sheetSpec() {
  const d = new Date();
  const exam = (ui.dx.sheet.exam || '').trim() || `${d.getMonth() + 1}/${d.getDate()} 시험`;
  const nos = [...new Set((ui.dx.sheet.nos.match(/\d+/g) || []).map(n => String(+n)).filter(n => +n > 0 && +n < 200))];
  const raw = (ui.dx.sheet.ans || '').trim();
  const parts = raw ? raw.split(/[,，\/]|\s{2,}/).map(x => x.trim()).filter(Boolean) : [];
  const key = {};
  parts.forEach((x, k) => { const m = /^(\d+)\s*[:：=)]\s*(.+)$/.exec(x); if (m) key[String(+m[1])] = m[2].trim(); else if (nos[k]) key[nos[k]] = x; });
  return { exam, nos, key, keyText: Object.entries(key).map(([n, a]) => n + ':' + a).join(', ') };
}
function clip(v, n) { return String(v || '').split(/<\/?(?:parameter|invoke)\b|<\/[a-z_]+>/i)[0].replace(/<\/?[a-zA-Z_][\w-]*(?:\s+[\w-]+="[^"]*")*\s*\/?>/g, '').trim().slice(0, n); }  // AI 답에 섞인 태그 조각 잘라 내기
function padBox(g, p) {
  const x = Math.max(0, g.x - p), y = Math.max(0, g.y - p);
  return { x, y, w: Math.min(1 - x, g.w + 2 * p), h: Math.min(1 - y, g.h + 2 * p) };
}
// 문항 영역만 잘라 낸 사진 (처방전·기록용). 영역을 모르면 사진 전체
const cropShot = it => it.region && window.Redact ? Redact.render(it.img, it.rot, it.masks, 900, 0.8, it.region) : it.thumb;
const sheetQid = (exam, no) => 's:' + exam + ':' + no;
const group = it => it.grp ? ui.queue.filter(x => x.grp === it.grp) : [it];
function paint(it) {
  if (window.Redact) { it.photo = Redact.render(it.img, it.rot, it.masks, 1600, 0.86); it.thumb = Redact.render(it.img, it.rot, it.masks, 360, 0.7); }
  else { it.photo = resize(it.img, 1600, 0.86); it.thumb = resize(it.img, 360, 0.7); }
}
const selItem = () => ui.queue.find(it => it.id === ui.sel) || null;

// ---------- 진단 요청 ----------
async function postDiagnose(body) {
  const send = async () => {
    const t0 = Date.now();
    const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 75000);
    try {
      const r = await fetch('api/diagnose', { method: 'POST', signal: ctrl.signal,
        headers: { 'content-type': 'application/json', 'x-access-code': ui.code || '' }, body: JSON.stringify(body) });
      const text = await r.text();
      let j = {}; try { j = JSON.parse(text); } catch (e) { j = { error: 'bad_json', message: (text || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) }; }
      j.__sec = Math.round((Date.now() - t0) / 1000);
      return { r, j };
    } catch (e) {
      const sec = Math.round((Date.now() - t0) / 1000);
      const err = new Error(e.name === 'AbortError' ? `응답이 ${sec}초 넘게 오지 않았습니다` : `서버 연결이 끊겼습니다 (${sec}초 후, ${e.message})`);
      err.sec = sec; err.net = true; err.kind = e.name === 'AbortError' ? 'timeout' : 'net'; throw err;
    } finally { clearTimeout(timer); }
  };
  // 연결이 끊기거나(휴대폰 네트워크) 서버가 일시적으로 실패하면 최대 두 번 더 시도한다
  let last;
  for (let k = 0; k < 3; k++) {
    if (k) await new Promise(res => setTimeout(res, 1500 * k));
    try {
      const out = await send();
      if ([502, 503, 504].includes(out.r.status) && out.j.error !== 'no_api_key' && k < 2) { last = Object.assign(new Error(httpMsg(out.r, out.j)), { kind: errKind(out.r, out.j) }); continue; }
      return out;
    } catch (e) { last = e; if (!e.net) throw e; }
  }
  throw last;
}
// 화면에 보일 오류 문구: 원인 종류만 쉽게 알려 주고, 자세한 내용(상태 코드 등)은 개발자 도구 콘솔에만 남긴다
function friendly(kind, detail) {
  if (detail) console.warn('[한 줄 진단]', detail);
  return kind === 'net' ? '인터넷 연결이 불안정해 진단하지 못했습니다.'
    : kind === 'timeout' ? 'AI 응답이 늦어져 진단하지 못했습니다.'
    : kind === 'busy' ? '짧은 시간에 진단을 많이 해서 잠시 멈췄습니다. 몇 분 뒤 다시 시도해 주세요.'
    : 'AI가 이 사진을 제대로 읽지 못했습니다.';
}
const errKind = (r, j) => r.status === 429 ? 'busy' : r.status === 504 || j.error === 'timeout' ? 'timeout' : j.error === 'network' ? 'net' : 'read';
const httpMsg = (r, j) => j.message || j.error ? `${j.message || j.error} (HTTP ${r.status}, ${j.__sec}초)` : `HTTP ${r.status} (${j.__sec}초)`;

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
        group(it2).forEach(x => { if (x !== it2) { x.rot = it2.rot; x.masks = it2.masks; x.photo = it2.photo; x.thumb = it2.thumb; } });
        ui.edit = null; dlg.close(); renderDx(); drawReview();
      }
    });
  }
  ui.edit = { it, rot: it.rot, masks: it.masks.map(m => ({ ...m })) };
  dlg.showModal(); prepEditor();
}
// ---------- 가림 확인 (진단 전에 한 번) ----------
// 올린 사진을 가린 모습으로 보여 주고, 선생님이 "이대로 진단 시작"을 눌러야 AI로 보낸다
function reviewPhotos() {
  const seen = new Set();
  return ui.queue.filter(it => !it.reviewed && !seen.has(it.grp || it.id) && seen.add(it.grp || it.id));
}
function openReview() {
  if (!reviewPhotos().length) return;
  let dlg = $('reviewDlg');
  if (!dlg) {
    dlg = document.createElement('dialog'); dlg.id = 'reviewDlg'; dlg.className = 'redact review';
    document.body.appendChild(dlg);
    dlg.addEventListener('click', e => {
      const b = e.target.closest('[data-rv],[data-rv-edit],[data-rv-del]'); if (!b) return;
      if (b.dataset.rvEdit) { openEditor(ui.queue.find(x => x.id === b.dataset.rvEdit)); return; }
      if (b.dataset.rvDel) {
        const it = ui.queue.find(x => x.id === b.dataset.rvDel); const g = it.grp || it.id;
        ui.queue = ui.queue.filter(x => (x.grp || x.id) !== g);
        if (!ui.queue.some(x => x.id === ui.sel)) ui.sel = ui.queue.length ? ui.queue[0].id : null;
        renderDx(); drawReview(); return;
      }
      if (b.dataset.rv === 'later') { dlg.close(); return; }
      if (b.dataset.rv === 'start') {
        ui.queue.forEach(x => { x.reviewed = true; });
        dlg.close(); dlg.innerHTML = ''; runAll(ui.queue);
      }
    });
  }
  drawReview();
  if (!dlg.open) dlg.showModal();
}
function drawReview() {
  const dlg = $('reviewDlg'); if (!dlg) return;
  const ph = reviewPhotos();
  if (!ph.length) { if (dlg.open) dlg.close(); return; }
  dlg.innerHTML = `<div class="rhead"><h2>가림 확인</h2>
      <p class="small muted">AI로 보내기 전에 가려진 모습을 확인해 주세요. 학원 이름·로고·학생 이름이 보이면 "직접 편집"으로 더 가리면 됩니다. 확인을 누른 뒤에 진단을 시작합니다.</p></div>
    <div class="rgrid">${ph.map(it => `<figure>
      <div class="rimg"><img src="${it.photo}" alt="가린 시험지 사진"></div>
      <figcaption><span><b>${esc(it.s)}</b>${it.masks.length ? '' : ' · <span class="low">가린 곳 없음</span>'}</span>
        <span class="rbtns"><button class="btn ghost" data-rv-edit="${it.id}" type="button">직접 편집</button><button class="linkbtn" data-rv-del="${it.id}" type="button">빼기</button></span></figcaption></figure>`).join('')}</div>
    <div class="actions"><button class="btn ghost" data-rv="later" type="button">나중에</button><span style="flex:1"></span>
      <button class="btn ok" data-rv="start" type="button">이대로 진단 시작 (${ph.length}장)</button></div>`;
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
  if (it.scan) return { id: it.qid, sheet: true, exam: it.sheet.exam, no: '전체', text: '', ans: '', topic: `${it.sheet.exam} 전체`, unit: 0 };
  if (it.sheet) {
    const saved = qOf(it.qid);
    return { id: it.qid, sheet: true, exam: it.sheet.exam, no: it.sheet.no,
      text: it.sheet.text ? esc(it.sheet.text) : saved ? saved.text : '', ans: it.sheet.ans || (saved && saved.ans !== '-' ? saved.ans : ''),
      topic: it.sheet.topic || (saved && saved.topic) || '유형 판단 전', unitName: it.sheet.unitName || (saved && saved.unitName) || '', unit: 0, sim: saved && saved.sim };
  }
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
  it.status = 'run'; it.cur = null; it.saved = false; it.errMsg = ''; it.region = null; it.regionShot = null; it.quick = false;
  let result = null, mode = 'ai', note = '';
  try {
    if (!aiOn()) throw Object.assign(new Error('demo'), { demo: true });
    const { r, j } = await postDiagnose(it.sheet
        ? { image: it.photo, question_no: it.sheet.no, answer: q.ans, topic: q.topic, region: it.hint || null }
        : { image: it.photo, problem: plain(q.text), answer: q.ans, topic: q.topic });
    if (r.status === 503 && j.error === 'no_api_key') throw Object.assign(new Error('demo'), { demo: true });
    if (r.status === 401) { ui.codeOk = false; throw Object.assign(new Error('체험 코드가 맞지 않음'), { demo: true }); }
    if (r.status === 422) { it.status = 'err'; it.errMsg = j.message || '문항을 찾지 못했습니다'; return; }
    if (!r.ok || !j.result) throw Object.assign(new Error(httpMsg(r, j)), { kind: errKind(r, j) });
    result = j.result;
  } catch (e) {
    // 시험지 문항은 예시 결과로 대신하지 않고 실패로 남겨 다시 진단하게 한다
    if (it.sheet && !e.demo) { it.status = 'err'; it.errMsg = friendly(e.kind || 'read', e.message); return; }
    if (!e.demo) note = 'AI 진단에 실패해 예시 결과를 보여 줍니다 (' + e.message + ').';
    await new Promise(res => setTimeout(res, 900 + Math.random() * 700));
    result = demoResult(q, it.s); mode = 'demo';
  }
  if (it.sheet && mode === 'ai') {
    if (result.problem_text) it.sheet.text = String(result.problem_text);
    if (result.topic) it.sheet.topic = clip(result.topic, 40);
    if (result.unit) it.sheet.unitName = clip(result.unit, 30);
    if (!it.sheet.ans && result.correct_answer) { it.sheet.aiAns = String(result.correct_answer); }
    const g = result.question_region, ok = v => typeof v === 'number' && isFinite(v);
    it.region = g && ok(g.x) && ok(g.y) && ok(g.w) && ok(g.h) && g.w > 0.05 && g.h > 0.03 && g.w <= 1.01 && g.h <= 1.01
      ? padBox(g, 0.04) : (it.hint || null);
  }
  it.cur = toCurrent(result, problemOf(it), it, mode, note);
  it.status = 'done';
}

// 시험지 한 장 훑기: 문항을 찾아 정답은 바로 표시하고, 오답·애매한 문항은 진단 대기열에 넣는다
async function scanItem(it, todo) {
  it.status = 'run'; it.errMsg = '';
  if (!aiOn()) { it.status = 'err'; it.errMsg = '시험지 전체에서 문항을 찾는 기능은 실제 AI가 연결되어 있을 때만 됩니다 (체험 코드 필요).'; return; }
  let j = {}, r;
  try { ({ r, j } = await postDiagnose({ image: it.photo, scan: true, answer: it.sheet.keyText || '' })); }
  catch (e) { it.status = 'err'; it.errMsg = friendly(e.kind, e.message); return; }
  if (r.status === 401) ui.codeOk = false;
  const qs = r.ok && j.result && Array.isArray(j.result.questions) ? j.result.questions : null;
  if (!qs || !qs.length) { it.status = 'err'; it.errMsg = qs ? '이 사진에서 문항을 찾지 못했습니다.' : friendly(errKind(r, j), httpMsg(r, j)); return; }
  const ok = v => typeof v === 'number' && isFinite(v);
  const seen = new Set();
  const made = qs.map(q => ({ ...q, no: String(q.no || '').replace(/[^0-9]/g, '') }))
    .filter(q => q.no && !seen.has(q.no) && seen.add(q.no))
    .sort((a, b) => a.no - b.no)
    .map(q => {
      const g = q.region || (ok(q.x) ? { x: q.x, y: q.y, w: q.w, h: q.h } : null);
      const hint = g && ok(g.x) && ok(g.y) && ok(g.w) && ok(g.h) && g.w > 0.05 && g.h > 0.03 ? padBox(g, 0.03) : null;
      const x = { id: 'p' + (++seq), reviewed: true, name: it.name, img: it.img, rot: it.rot, masks: it.masks, photo: it.photo, thumb: it.thumb, grp: it.grp,
        s: it.s, qid: sheetQid(it.sheet.exam, q.no), q: null, hint, region: hint, saved: false, cur: null,
        sheet: { exam: it.sheet.exam, no: q.no, ans: (it.sheet.key || {})[q.no] || '', aiAns: q.correct_answer || '', text: '',
          topic: clip(q.topic, 40), unitName: clip(q.unit, 30) } };
      if (q.verdict === 'correct') {
        // 빠른 판정: 자세한 진단 없이 정답으로 표시 (선생님이 '다시 진단'으로 자세히 볼 수 있음)
        x.status = 'done'; x.quick = true;
        x.cur = toCurrent({ transcribed_lines: [], student_answer: q.student_answer || '', is_correct: true, first_error_line: -1, cause: 'none',
          evidence: q.note || '', confidence: 0.9, legibility: 'good', teacher_note: '', similar_problem: null }, problemOf(x), x, 'ai', '');
      } else { x.status = 'wait'; x.scanNote = q.note || ''; todo.push(x); }
      return x;
    });
  const at = ui.queue.indexOf(it);
  ui.queue.splice(at, 1, ...made);
  if (ui.sel === it.id) ui.sel = (made.find(x => x.status === 'wait') || made[0]).id;
}

async function runAll(items) {
  if (ui.running) return;
  const todo = items.filter(it => it.reviewed && (it.status === 'wait' || it.status === 'err'));
  if (!todo.length) return;
  for (const it of todo) {
    if (!it.sheet && (it.qid === 'new' || !qOf(it.qid) && !(it.q && it.q.text))) {
      if (!it.q || !it.q.text) { toast('문제를 입력해 주세요'); return; }
    }
    if (!String(it.s || '').trim()) { toast('학생을 모두 정해 주세요'); return; }
  }
  ui.running = true; ui.pickLine = false; renderDx();
  let i = 0, scanning = 0;
  const worker = async () => {
    while (i < todo.length || scanning) {
      if (i >= todo.length) { await new Promise(res => setTimeout(res, 200)); continue; }
      const it = todo[i++];
      renderDx();
      if (it.scan) { scanning++; try { await scanItem(it, todo); } catch (e) { it.status = 'err'; it.errMsg = String(e.message || e); } scanning--; renderDx(); continue; }
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
  if (it.sheet) {
    const ans = it.sheet.ans || it.sheet.aiAns || '-';
    let q = S.custom.find(c => c.id === it.qid);
    if (!q) {
      q = { id: it.qid, unit: 0, sheet: true, exam: it.sheet.exam, no: it.sheet.no, topic: it.sheet.topic || `${it.sheet.no}번 문항`, unitName: it.sheet.unitName || '',
        text: esc(it.sheet.text || `${it.sheet.no}번 문항`), ans, sim: (it.cur && it.cur.rec.sim) || { text: '-', ans: '-' }, hint: (it.cur && it.cur.rec.tip) || '' };
      S.custom.push(q);
    } else {
      if (it.sheet.text && (!q.text || /번 문항$/.test(q.text))) q.text = esc(it.sheet.text);
      if (q.ans === '-' && ans !== '-') q.ans = ans;
      if (it.sheet.topic && /번 문항$/.test(q.topic)) q.topic = it.sheet.topic;
      if (it.sheet.unitName && !q.unitName) q.unitName = it.sheet.unitName;
    }
    return it.qid;
  }
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
    S.recs.push({ ...cur.rec, s: it.s, id: 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), q: qid, photo: it.sheet ? cropShot(it) : it.thumb, confirmed: true,
      byTeacher: cur.rec.cause !== cur.aiCause || cur.rec.err !== cur.aiErr });
  }
  S.session.unshift({ s: it.s, q: qid, cause: cur.correct ? null : cur.rec.cause, correct: cur.correct, thumb: it.thumb, mode: cur.mode, t: Date.now() });
  S.session = S.session.slice(0, 40);
  it.saved = true; ui.stu = it.s;
  if (!quiet) {
    save(); updateCounts();
    const next = nextPending(it);
    if (next) { ui.sel = next.id; ui.pickLine = false; }
    renderDx();
    const what = `${it.s} · ${qNo(problemOf(it))}`;
    toast(next ? `${what} 반영 · 다음 진단서로 넘어갔어요` : `${what} 반영 · 모두 반영했어요`);
    if (next) toResult();
  }
  return true;
}
// 지금 진단서 다음 차례의 반영 대기 진단서 (없으면 앞쪽에서)
function nextPending(it) {
  const list = ui.queue.filter(x => x.status === 'done' && !x.saved);
  const i = ui.queue.indexOf(it);
  return list.find(x => ui.queue.indexOf(x) > i) || list[0] || null;
}
function toResult() {
  const el = $('resCard'); if (!el) return;
  const top = el.getBoundingClientRect().top;
  if (top < 0 || top > window.innerHeight * 0.6) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function confirmConfident() {
  const list = ui.queue.filter(it => it.status === 'done' && !it.saved && it.cur && (it.cur.correct || it.cur.rec.conf >= LOW));
  list.forEach(it => confirmItem(it, true));
  save(); updateCounts();
  const left = ui.queue.filter(it => it.status === 'done' && !it.saved);
  if (left.length) ui.sel = left[0].id;
  renderDx();
  toast(left.length ? `${list.length}건 반영 · 확인이 필요한 ${left.length}건이 남았어요` : `${list.length}건 모두 반영했어요`);
  if (left.length) toResult();
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
    <span class="privacy">체험 코드는 발표·시연 때 안내합니다.</span></div>`;
}
function renderDxForm() {
  const sh = ui.dx.sheet;
  const sOpts = S.students.map(x => `<option value="${esc(x)}"${x === ui.dx.s ? ' selected' : ''}>${esc(x)}</option>`).join('') +
    `<option value="__new"${ui.dx.s === '__new' ? ' selected' : ''}>+ 새 학생</option>`;
  const waiting = ui.queue.filter(it => it.status === 'wait' || it.status === 'err').length;
  const qn = ui.queue.length;
  const opened = sh.exam || sh.ans || sh.nos;
  $('dxForm').innerHTML = `
    <div><h2>시험지 진단</h2><p class="muted small">채점한 시험지를 쪽마다 찍어 올리면, 문항을 찾아 문제 유형을 판단하고 틀린 문항의 풀이를 진단합니다.</p></div>
    ${codeBox()}
    <div class="field"><label for="ssel"><span class="stepno">1</span>학생</label>
      <select id="ssel">${sOpts}</select>
      ${ui.dx.s === '__new' ? `<input type="text" id="sname" placeholder="학생 이름 (예: 학생 I, 지민)" value="${esc(ui.dx.newName)}">` : ''}
      <span class="privacy">이 학생의 시험지를 올립니다. 다른 학생의 시험지는 학생을 바꾼 뒤 올려 주세요.</span>
    </div>
    <div class="field"><span class="lab"><span class="stepno">2</span>시험지 사진</span>
      <label class="drop" id="drop">
        <input type="file" id="file" accept="image/*" multiple aria-label="시험지 사진 선택 (여러 장 가능)">
        <span class="big">📷</span><b>${qn ? '사진 더 추가하기' : '사진 찍기 또는 파일 선택'}</b><span class="small">여러 장을 한꺼번에 고르거나 끌어다 놓아도 됩니다</span>
      </label>
      <label class="toggle"><input type="checkbox" id="redact"${ui.redact ? ' checked' : ''}> 학원 이름·로고·학생 이름 자동으로 가리기</label>
    </div>
    <details class="opt"${opened ? ' open' : ''}><summary>선택 사항: 시험 이름 · 정답표 · 특정 문항만</summary>
      <input type="text" id="sexam" placeholder="시험 이름 (비우면 오늘 날짜)" value="${esc(sh.exam)}">
      <input type="text" id="sans" placeholder="정답표 (예: 9:③, 12:⑤) · 비우면 AI가 직접 풀어 채점" value="${esc(sh.ans)}">
      <input type="text" id="snos" placeholder="이 번호만 진단 (예: 9, 12) · 비우면 모든 문항" value="${esc(sh.nos)}" inputmode="numeric">
    </details>
    ${qn ? queueHtml() : ''}
    <button class="btn wide" id="go" ${waiting && !ui.running ? '' : 'disabled'}>${ui.running ? '진단 중…' : ui.queue.some(it => !it.reviewed) ? '가림 확인하고 진단하기' : waiting > 1 ? `${waiting}건 모두 진단하기` : '진단하기'}</button>
    <p class="privacy">${ui.redact ? '시험지 머리글(학원 로고·시험 이름·학생 이름)과 바닥글은 이 기기에서 먼저 가린 뒤 전송합니다. ' : ''}사진은 진단에만 쓰이고 서버에 저장되지 않습니다.</p>`;
}
function qHeadline() {
  const photos = new Set(ui.queue.map(it => it.grp || it.id)).size;
  const qs = ui.queue.filter(it => !it.scan).length;
  return `올린 사진 ${photos}장` + (qs && qs !== photos ? ` · 문항 ${qs}개` : '');
}
function queueHtml() {
  const rows = ui.queue.map(it => {
    const q = problemOf(it);
    let st;
    if (it.status === 'wait') st = `<span class="qst">${it.scan ? '문항 찾기 대기' : '대기'}</span>`;
    else if (it.status === 'run') st = `<span class="qst run">${it.scan ? '문항 찾는 중' : '진단 중'}</span>`;
    else if (it.status === 'err') st = `<span class="qst bad" title="${esc(it.errMsg || '')}">다시 시도 필요</span>`;
    else if (it.saved) st = '<span class="qst ok">✓ 반영</span>';
    else if (it.cur.correct) st = `<span class="qst ok">정답${it.quick ? '(빠른)' : ''}</span>`;
    else st = `${causeTag(it.cur.rec.cause)}${it.cur.rec.conf < LOW ? '<span class="qst bad">확인</span>' : ''}`;
    return `<div class="qrow2${it.id === ui.sel ? ' on' : ''}" data-sel-item="${it.id}">
      <img src="${it.thumb}" alt="">
      <div class="qmeta"><b class="qwho">${esc(it.s)}</b>
        <span class="small muted">${q ? qNo(q) : '직접 입력'}</span>
        ${it.reviewed ? '' : '<span class="small low">가림 확인 전</span>'}</div>
      <div class="qstate">${st}</div>
      <button class="x" data-del-item="${it.id}" aria-label="이 사진 빼기" ${it.status === 'run' ? 'disabled' : ''}>×</button></div>`;
  }).join('');
  return `<div class="queue"><div class="qhead"><b>${qHeadline()}</b><button class="linkbtn" data-act="clearq" type="button" ${ui.running ? 'disabled' : ''}>모두 비우기</button></div>${rows}</div>`;
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
  } else if (done.length && !pend.length && done.some(x => x.saved)) {
    const okN = done.filter(x => x.cur && x.cur.correct).length, wrong = done.length - okN;
    const by = emptyBy(); done.forEach(x => { if (x.cur && !x.cur.correct && x.cur.rec.cause) by[x.cur.rec.cause]++; });
    const who = [...new Set(done.map(x => x.s))];
    top = `<div class="card done-card"><div><h2>✓ ${done.length}건 모두 반영했어요</h2>
      <p class="muted small">${who.map(esc).join(', ')} · 정답 ${okN}문항 · 오답 ${wrong}문항${wrong ? ' (' + CK.filter(k => by[k]).map(k => D.causes[k].short + ' ' + by[k]).join(', ') + ')' : ''}</p></div>
      <div class="actions"><button class="btn" data-go="brief">진찰 기록 보기</button>
        <button class="btn ghost" data-go-stu="${esc(who[0])}">${who.length === 1 ? esc(who[0]) + ' ' : ''}오답 처방전 보기</button>
        <button class="btn ghost" data-act="nextsheet">다음 시험지 올리기</button></div></div>`;
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
  else if (it && it.status === 'err') card = `<div class="card"><div class="res-head"><div><h2>${esc(it.s)} · ${esc(problemOf(it).topic || '')}</h2>
      <p class="muted small">${esc(it.errMsg || '진단하지 못했습니다.')}</p></div></div>
      <div class="res-grid"><div class="photo" data-zoom-item="${it.id}"><img src="${it.photo}" alt="학생 풀이 사진"></div>
      <div class="small">"다시 진단"을 누르면 다시 시도합니다.${it.scan ? ' 계속 안 되면 사진이 흐리거나 시험지가 잘려 있지 않은지 확인해 주세요.' : it.sheet ? ' 계속 안 되면 문항 번호가 사진에 잘 보이는지 확인해 주세요.' : ''}</div></div>
      <div class="actions"><button class="btn ghost" data-act="again">다시 진단</button></div></div>`;
  else if (it && it.status === 'run') card = `<div class="card"><div class="loading"><div class="st now"><i></i>이 사진을 진단하는 중</div></div></div>`;
  else if (!ui.queue.length || (it && it.status === 'wait' && !ui.running)) {
    card = `<div class="card empty">
      <div><h2>진단서</h2><p class="muted small">진단하면 여기에 결과가 나옵니다.</p></div>
      <ol><li>학생이 쓴 풀이를 한 줄씩 옮겨 적고</li><li>처음 틀린 줄에 빨간 물결을 긋고</li><li>원인을 개념 부족 · 계산 실수 · 문제 오독 · 풀이 전략 오류 중 하나로 진단합니다.</li></ol>
      <p class="small muted">${aiOn() ? 'AI가 내린 진단은 제안이고, 선생님이 확인해야 기록에 반영됩니다.' : ui.ai && ui.needCode ? '체험 코드를 넣으면 시험지를 실제로 진단할 수 있습니다.' : 'AI가 연결되지 않아 지금은 진단할 수 없습니다.'}</p></div>`;
  }
  out.innerHTML = top + card;
}
function resultCard(it) {
  const cur = it.cur; const r = cur.rec; const q = problemOf(it);
  const head = `<div class="res-head"><div><h2>${esc(it.s)} · ${qPre(q)}${q.topic ? esc(q.topic) : ''}</h2>
      <p class="muted small">${q.unit ? q.id + '번 · ' + unitLabel(q) : unitLabel(q)}${ui.queue.length > 1 ? ` · ${ui.queue.indexOf(it) + 1}번째` : ''}</p></div>
      <div class="meta">${cur.mode === 'ai' ? '<span class="badge ai">AI 진단</span>' : '<span class="badge demo">데모 모드 · 예시 결과</span>'}
      ${!cur.correct ? `<span class="badge ${r.conf < LOW ? 'low' : 'ai'}">신뢰도 ${pct(r.conf)}%</span>` : ''}</div></div>`;
  const notes = (cur.note ? `<div class="warn">${esc(cur.note)}</div>` : '') +
    (r.legibility !== 'good' ? `<div class="warn">글씨가 ${r.legibility === 'poor' ? '잘 보이지 않아' : '일부 흐려서'} 판독이 틀렸을 수 있습니다. 옮겨 적은 풀이를 사진과 비교해 주세요.</div>` : '') +
    (!cur.correct && r.conf < LOW && !it.saved ? `<div class="warn">신뢰도가 낮은 진단입니다. 틀린 줄과 원인이 맞는지 확인해 주세요.</div>` : '');
  if (it.region && !it.regionShot) it.regionShot = cropShot(it);
  const photo = `<div class="photo" data-zoom-item="${it.id}" title="눌러서 사진 전체 보기"><img src="${it.region ? it.regionShot : it.photo}" alt="학생 풀이 사진">${it.region ? '<span class="cropnote">문항 부분 · 눌러서 전체 보기</span>' : ''}</div>`;
  const ansShown = q.ans || (it.sheet && it.sheet.aiAns ? it.sheet.aiAns + ' (AI가 푼 값)' : '-');
  const readProb = it.sheet && !it.quick ? `<div class="probbox small"><b>AI가 사진에서 읽은 ${esc(it.sheet.no)}번 문제</b><br>${q.text || '(읽지 못함)'}<div class="a">다른 문항을 읽었다면 "다시 진단"을 눌러 주세요.</div></div>` : '';
  const doneList = ui.queue.filter(x => x.status === 'done');
  const leftN = doneList.filter(x => !x.saved).length;
  const pager = doneList.length > 1 ? `<div class="pager"><button class="pg" data-act="prev" type="button">‹ 이전</button>
    <span>${doneList.indexOf(it) + 1} / ${doneList.length}${leftN ? ` · 반영 대기 ${leftN}` : ' · 모두 반영'}</span>
    <button class="pg" data-act="next" type="button">다음 ›</button></div>` : '';
  const nav = '';

  if (cur.correct) {
    return `<div class="card" id="resCard">${pager}${head}${notes}${readProb}
      <div class="res-grid">${photo}<div class="side" style="display:flex;flex-direction:column;gap:10px">
        ${it.quick ? '' : workBox({ work: r.work, err: null })}
        <div class="good"><b style="color:var(--ok)">${it.quick ? '정답으로 판정했습니다 (빠른 판정).' : '정답 풀이입니다.'}</b><div class="small">쓴 답 ${esc(r.given)} · 정답 ${esc(ansShown)}</div>
        ${it.quick ? `<div class="small muted" style="margin-top:4px">${esc(r.why)} 풀이를 줄 단위로 보려면 "다시 진단"을 누르세요.</div>` : ''}</div>
      </div></div>
      <div class="actions">${it.saved ? '<span class="done">✓ 정답으로 기록 완료</span>' : '<button class="btn ok" data-act="confirm">정답으로 기록</button>'}
        <button class="btn ghost" data-act="again">다시 진단</button>${nav}</div></div>`;
  }
  const causeSel = `<select data-act="cause" aria-label="원인 바꾸기">${CK.map(k => `<option value="${k}"${k === r.cause ? ' selected' : ''}>${D.causes[k].name}</option>`).join('')}</select>`;
  const sim = r.sim || (q.sim ? { text: q.sim.text, ans: q.sim.ans } : null);
  return `<div class="card" id="resCard">${pager}${head}${notes}
    <div class="res-grid">${photo}
      <div class="side" style="display:flex;flex-direction:column;gap:10px;min-width:0">
        ${ui.pickLine && !it.saved ? '<div class="warn" style="border-color:var(--accent);background:var(--soft)">처음 틀린 줄을 눌러 고르세요.</div>' : ''}
        ${workBox(r, { pick: ui.pickLine && !it.saved })}
        <div class="ans"><span>쓴 답 <span class="w">${esc(r.given)}</span></span><span>정답 <b>${esc(ansShown)}</b></span></div>
      </div>
    </div>
    ${readProb}
    <div class="cols" style="gap:14px">
      <div class="note"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><b>원인</b> ${causeTag(r.cause)} ${it.saved ? '' : causeSel}</div>
        <div class="small" style="margin-top:6px">${esc(r.why)}</div>
        ${r.tip ? `<div class="small" style="margin-top:6px"><b>지도 포인트</b> ${esc(r.tip)}</div>` : ''}</div>
      ${sim ? `<div class="note small"><b>처방 문제</b> <span class="muted">같은 유형의 연습 문제</span><br>${sim.text}<details><summary>정답 보기</summary>${esc(sim.ans)}</details></div>` : ''}
    </div>
    <div class="actions">
      ${it.saved ? '<span class="done">✓ 반영 완료</span>' :
        `<button class="btn ok" data-act="confirm">진단 확인하고 반영</button>
         <button class="btn ghost" data-act="pick">${ui.pickLine ? '줄 고르기 취소' : '틀린 줄 다시 고르기'}</button>
         <button class="btn ghost" data-act="again">다시 진단</button>`}${nav}
    </div></div>`;
}
function renderSession() {
  const el = $('dxSession'); if (!el) return;
  if (!S.session.length) { el.innerHTML = `<div><h2>반영한 진단</h2><p class="muted small">아직 없습니다. 확인을 누른 진단이 여기에 쌓입니다.</p></div>`; return; }
  el.innerHTML = `<div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:space-between;align-items:center"><div><h2>반영한 진단</h2><p class="muted small">${S.session.length}건 · 최근 순</p></div>
    <div class="actions"><button class="btn ghost" data-go="brief">진찰 기록 보기</button><button class="btn ghost" data-go="stu">처방전 보기</button></div></div>
    <div class="session">${S.session.slice(0, 12).map(x => { const q = qOf(x.q); return `<div class="row">
      ${x.thumb ? `<img src="${x.thumb}" alt="">` : '<span></span>'}
      <div><b>${esc(x.s)}</b> · ${q ? qPre(q) + esc(q.topic) : ''} <span class="small muted">${x.mode === 'ai' ? 'AI 진단' : '예시 진단'}</span></div>
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
      return `<div class="mini"><b>${esc(r.s)}</b>${line}</div>`;
    }).join('');
    return `<div class="grp"><div>${causeTag(k)}<div class="small muted num">${rs.length}명</div></div>
      <div class="who">${who}<div class="rx"><b>지도</b> ${D.causes[k].tip}</div></div></div>`;
  }).join('');
  return `<div class="card">
    <div><h2>같은 문항, 다른 원인</h2><p class="muted small">${o.q.unit ? o.q.id + '번(' + unitLabel(o.q) + ')' : esc(o.q.topic)}에서 ${o.n}명이 틀렸습니다. 풀이를 읽으면 원인이 ${o.kinds}가지로 나뉩니다. 빨간 물결은 학생이 처음 틀린 줄입니다.</p></div>
    <div class="versus">
      <div class="old"><span class="small muted">정답·오답만 보는 오답노트</span>
        <span class="big">${qPre(o.q)}${esc(o.q.topic)} · ${o.n}명 오답</span>
        <span class="small">"${o.q.unit ? D.units[o.q.unit] : '이 문항'} 단원이 약함"으로 묶고, 같은 단원 문제를 ${o.n}명 모두에게 더 풀게 합니다.</span></div>
      <div class="new"><span class="small muted">풀이 한 줄을 읽는 한 줄 진단 (원인별 처방)</span>${groups}</div>
    </div></div>`;
}
function renderBrief() {
  if (!S.recs.length && !Object.values(S.graded).some(g => g.length)) {
    $('p-brief').innerHTML = `<div class="card empty"><div><h2>아직 진단한 시험지가 없습니다</h2><p class="muted small">"새 진단"에서 시험지를 올리고 진단을 반영하면, 반 평균·문항별 오답률·오답 원인 분포가 여기에 쌓입니다.</p></div>
      <div class="actions"><button class="btn" data-go="dx">시험지 올리러 가기</button></div></div>`;
    return;
  }
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
    return `<li><div><b>${qPre(o.q)}${esc(o.q.topic)}</b> <span class="muted num">${o.n}/${o.takers}명 오답 (${pct(o.rate)}%)</span>
      <div class="small muted">${unitLabel(o.q)}</div>
      <div class="small">${mode}</div>
      ${o.q.hint ? `<div class="small"><b>설명 포인트</b> ${esc(o.q.hint)}</div>` : ''}</div></li>`;
  }).join('');
  const causeBar = CK.filter(k => by[k] > 0).map(k => `<div class="${k}" style="flex:${by[k]}" title="${D.causes[k].name} ${by[k]}건">${by[k]}</div>`).join('');
  const legend = CK.map(k => `<span>${causeTag(k)} ${D.causes[k].name} <b class="num">${by[k]}건 (${total ? pct(by[k] / total) : 0}%)</b></span>`).join('');
  const qRows = qs.map(o => `<div class="qrow"><div class="lbl"><b>${qNo(o.q)}</b> <span class="muted">${esc(o.q.topic)}</span></div>
    <div class="track" role="img" aria-label="${esc(o.q.topic)} 오답률 ${pct(o.rate)}%">${CK.filter(k => o.by[k] > 0).map(k => `<div class="${k}" style="width:${o.by[k] / o.takers * 100}%" title="${D.causes[k].short} ${o.by[k]}명"></div>`).join('')}</div>
    <div class="num">${o.n}/${o.takers} · ${pct(o.rate)}%</div></div>`).join('');
  const axis = `<div class="axis"><div></div><div class="ticks"><span>0%</span><span>25%</span><span>50%</span><span>75%</span><span>100%</span></div><div></div></div>`;
  const watchHtml = watch.map(x => `<div class="row"><b>${esc(x.s)}</b><span class="num">${x.score}점</span>
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
  const chips = S.students.map(x => `<button class="chip" aria-pressed="${x === s}" data-stu="${esc(x)}">${esc(x)}</button>`).join('');
  const items = [...st.rs].sort((a, b) => String(a.q).localeCompare(String(b.q), undefined, { numeric: true })).map(r => {
    const q = qOf(r.q) || { id: r.q, topic: '', text: '', ans: '-', unit: 0, sim: { text: '-', ans: '-' } };
    const sim = r.sim || q.sim;
    return `<div class="item">
      <div class="side">
        <div><b>${qPre(q)}${esc(q.topic)}</b> <span class="small muted">${unitLabel(q)}</span> ${srcTag(r)}</div>
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
        <div><h2>${esc(s)} 오답 처방전</h2><p class="muted small num">${esc(S.name)} · ${scoreTxt} · 오답 ${st.rs.length}문항${st.rs.length ? ' · ' + CK.filter(k => st.by[k] > 0).map(k => D.causes[k].short + ' ' + st.by[k]).join(', ') : ''}</p></div>
        ${st.rs.length ? '<button class="btn ghost" data-act="print">인쇄하기</button>' : ''}
      </div>
      ${st.rs.length ? `<div class="note"><b>가장 먼저 고칠 것</b><br>${focus}. ${st.top.map(k => D.causes[k].tip).join(' ')}</div>
      <div style="display:flex;flex-direction:column;gap:12px">${items}</div>` : st.graded ? `<p>틀린 문항이 없습니다.</p>` : `<p class="muted">아직 진단한 시험지가 없습니다.</p>`}
    </div>`;
}

// ---------- 진단서 확인 ----------
function renderChk() {
  if (!allQs().length) {
    $('p-chk').innerHTML = `<div class="card empty"><div><h2>채점표가 비어 있습니다</h2><p class="muted small">시험지를 진단해 반영하면 학생 × 문항 채점표와 확인할 진단서가 여기에 나옵니다.</p></div>
      <div class="actions"><button class="btn" data-go="dx">시험지 올리러 가기</button></div></div>`;
    return;
  }
  const recs = [...S.recs].sort((a, b) => a.conf - b.conf);
  const list = recs.filter(r => ui.showAll || (r.conf < LOW && !r.confirmed));
  const qs = allQs();
  const grid = S.students.map(s => `<tr><td><b>${esc(s)}</b></td>${qs.map(q => {
    const r = S.recs.find(x => x.s === s && String(x.q) === String(q.id));
    if (r) return `<td><button class="cell" data-rec="${r.id}" aria-label="${esc(s)} ${esc(q.topic)} 오답, ${D.causes[r.cause].name}">${D.causes[r.cause].short.slice(0, 1)}</button></td>`;
    return gradedOf(s).includes(String(q.id)) ? `<td><span class="cell ok" aria-label="정답">○</span></td>` : `<td><span class="cell ok" aria-label="채점 안 함" style="opacity:.35">·</span></td>`;
  }).join('')}</tr>`).join('');
  const items = list.map(r => {
    const q = qOf(r.q) || { id: r.q, topic: '', ans: '-' };
    return `<div class="rec" id="rec-${r.id}">
      <div class="side" style="display:flex;flex-direction:column;gap:8px;min-width:0"><div><b>${esc(r.s)} · ${qNo(q)}</b> <span class="muted small">${esc(q.topic)}</span> ${srcTag(r)}</div>
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
      <div class="tablewrap"><table class="grid"><thead><tr><th></th>${qs.map(q => `<th title="${esc(unitLabel(q))}">${esc(qHead(q))}</th>`).join('')}</tr></thead><tbody>${grid}</tbody></table></div>
    </div>
    <div class="card">
      <div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:space-between;align-items:center">
        <div><h2>진단서 확인</h2><p class="muted small">AI가 짚은 틀린 줄과 원인을 보고, 틀렸으면 바꾸고 맞으면 확인을 누릅니다. 확인 대기 <b class="num">${pending}건</b>.</p></div>
        <div class="chips"><button class="chip" aria-pressed="${!ui.showAll}" data-filter="pending">확인 대기만</button><button class="chip" aria-pressed="${ui.showAll}" data-filter="all">전체 ${S.recs.length}건</button></div>
      </div>
      <div style="display:flex;flex-direction:column;gap:10px">${items || "<p class='muted'>확인할 진단서가 없습니다.</p>"}</div>
    </div>`;
}

// ---------- 새 반 만들기 ----------
function newNames() {
  const g = ui.newG;
  g.names = Array.from({ length: g.count }, (_, i) => g.names[i] != null ? g.names[i] : autoName(i));
  return g.names;
}
function renderNew() {
  const g = ui.newG; const names = newNames();
  // 1~10명은 바로 고르고, 그보다 많으면 직접 적는다
  const custom = g.custom || g.count > 10;
  const counts = Array.from({ length: 10 }, (_, i) => i + 1).map(n => `<option value="${n}"${!custom && n === g.count ? ' selected' : ''}>${n}명</option>`).join('') +
    `<option value="custom"${custom ? ' selected' : ''}>직접 입력</option>`;
  $('p-new').innerHTML = `<div class="card onboard">
    <div><h2>${DB.groups.length ? '새 반 만들기' : '반을 만들고 시작하세요'}</h2>
      <p class="muted small">반 이름과 학생 수를 정하면 "학생 A", "학생 B"처럼 이름이 자동으로 붙습니다. 이름은 아래에서 바로 고칠 수 있고, 나중에 "반 관리"에서도 바꿀 수 있습니다.</p></div>
    <div class="field"><label for="gName"><span class="stepno">1</span>반 이름</label>
      <input type="text" id="gName" placeholder="예: 중1 A반 (월·수 7시)" value="${esc(g.name)}" maxlength="30"></div>
    <div class="field"><label for="gCount"><span class="stepno">2</span>학생 수</label>
      <div class="countrow"><select id="gCount">${counts}</select>
        ${custom ? `<input type="number" id="gCountIn" min="1" max="60" value="${g.count}" inputmode="numeric" aria-label="학생 수 직접 입력"><span class="muted small">명 (최대 60명)</span>` : ''}</div></div>
    <div class="field"><span class="lab"><span class="stepno">3</span>학생 이름 <button class="linkbtn" id="gAuto" type="button">자동 이름으로 되돌리기</button></span>
      <div class="stugrid" id="gNames">${namesHtml(names)}</div>
      <span class="privacy">실명 대신 이니셜이나 번호를 쓰기를 권합니다. 기록은 이 브라우저에만 저장됩니다.</span></div>
    <div class="actions"><button class="btn ok" id="gCreate" type="button">반 만들기</button>
      ${S ? '<button class="btn ghost" id="gCancel" type="button">취소</button>' : ''}</div>
    ${DB.groups.some(x => x.sample) ? '' : `<p class="small muted">먼저 둘러보고 싶다면 <button class="linkbtn" id="gSample" type="button">샘플 반 열어 보기</button> (가상의 학생 8명 기록)</p>`}
  </div>`;
}
const namesHtml = names => names.map((n, i) => `<input type="text" data-gi="${i}" value="${esc(n)}" maxlength="16" aria-label="${i + 1}번째 학생 이름">`).join('');
function checkNames(list) {
  const t = list.map(x => String(x || '').trim());
  if (t.some(x => !x)) return '비어 있는 학생 이름이 있어요';
  const dup = t.find((x, i) => t.indexOf(x) !== i);
  if (dup) return `학생 이름 "${dup}"이(가) 겹쳐요`;
  return '';
}
function createGroup() {
  const g = ui.newG; const names = newNames().map(x => x.trim());
  const name = g.name.trim();
  if (!name) { toast('반 이름을 적어 주세요'); $('gName').focus(); return; }
  if (DB.groups.some(x => x.name === name)) { toast('같은 이름의 반이 이미 있어요'); return; }
  const bad = checkNames(names); if (bad) { toast(bad); return; }
  const grp = emptyGroup(name, names);
  DB.groups.push(grp); ui.newG = { name: '', count: 8, names: [], custom: false };
  useGroup(grp); show('dx');
  toast(`${name} (${names.length}명)을 만들었어요. 시험지를 올려 보세요.`);
}

// ---------- 반 관리 (이름·학생 고치기, 반 삭제) ----------
function openGroupDlg() {
  if (!S) return;
  let dlg = $('grpDlg');
  if (!dlg) { dlg = document.createElement('dialog'); dlg.id = 'grpDlg'; dlg.className = 'redact'; document.body.appendChild(dlg); }
  ui.gEdit = { name: S.name, rows: S.students.map(x => ({ orig: x, name: x })) };
  drawGroupDlg(); dlg.showModal();
}
function drawGroupDlg() {
  const e = ui.gEdit; const dlg = $('grpDlg');
  const cnt = o => o ? S.recs.filter(r => r.s === o).length : 0;
  dlg.innerHTML = `<div class="rhead"><h2>반 관리</h2><p class="small muted">이름을 바꾸면 그 학생의 기록도 함께 옮겨집니다.</p></div>
    <div class="field"><label for="geName">반 이름</label><input type="text" id="geName" value="${esc(e.name)}" maxlength="30"></div>
    <div class="field"><span class="lab">학생 ${e.rows.length}명</span>
      <div class="stugrid edit">${e.rows.map((r, i) => `<div class="srow"><input type="text" data-ge="${i}" value="${esc(r.name)}" maxlength="16" aria-label="학생 이름">
        <button class="x" data-gdel="${i}" type="button" aria-label="학생 빼기" title="${cnt(r.orig) ? '기록 ' + cnt(r.orig) + '건' : ''}">×</button></div>`).join('')}</div>
      <button class="linkbtn" data-gact="add" type="button">+ 학생 추가</button></div>
    <div class="actions"><button class="btn ghost danger" data-gact="delgroup" type="button">이 반 삭제</button><span style="flex:1"></span>
      <button class="btn ghost" data-gact="cancel" type="button">취소</button><button class="btn ok" data-gact="save" type="button">저장</button></div>`;
}
function saveGroupDlg() {
  const e = ui.gEdit;
  const name = e.name.trim(); if (!name) { toast('반 이름을 적어 주세요'); return; }
  if (DB.groups.some(x => x !== S && x.name === name)) { toast('같은 이름의 반이 이미 있어요'); return; }
  if (!e.rows.length) { toast('학생이 한 명 이상 있어야 해요'); return; }
  const bad = checkNames(e.rows.map(r => r.name)); if (bad) { toast(bad); return; }
  const removed = S.students.filter(x => !e.rows.some(r => r.orig === x));
  const lost = S.recs.filter(r => removed.includes(r.s)).length;
  if (lost && !confirm(`뺀 학생의 진단 기록 ${lost}건도 함께 지워집니다. 저장할까요?`)) return;
  const map = {}; e.rows.forEach(r => { if (r.orig) map[r.orig] = r.name.trim(); });
  const ren = x => map[x] || x;
  S.recs = S.recs.filter(r => !removed.includes(r.s)).map(r => ({ ...r, s: ren(r.s) }));
  S.session = S.session.filter(x => !removed.includes(x.s)).map(x => ({ ...x, s: ren(x.s) }));
  const graded = {}; e.rows.forEach(r => { graded[r.name.trim()] = r.orig ? (S.graded[r.orig] || []) : []; });
  S.graded = graded; S.students = e.rows.map(r => r.name.trim()); S.name = name;
  ui.queue.forEach(it => { if (!it.saved && map[it.s]) it.s = map[it.s]; });
  ui.stu = ren(ui.stu); if (ui.dx.s !== '__new') ui.dx.s = S.students.includes(ren(ui.dx.s)) ? ren(ui.dx.s) : S.students[0];
  save(); $('grpDlg').close(); render(); toast('반 정보를 저장했어요');
}
function deleteGroup() {
  if (!confirm(`"${S.name}" 반과 그 기록을 모두 지울까요? 되돌릴 수 없습니다.`)) return;
  DB.groups = DB.groups.filter(g => g !== S);
  $('grpDlg').close();
  const next = DB.groups[0] || null;
  if (next) useGroup(next); else { S = null; DB.cur = null; save(); ui.queue = []; show('dx'); }
  toast('반을 지웠어요');
}

// ---------- 공통 ----------
function updateCounts() {
  const pending = S ? S.recs.filter(r => r.conf < LOW && !r.confirmed).length : 0;
  $('t-chk').innerHTML = '진단서 확인' + (pending ? `<span class="cnt">${pending}</span>` : '');
  $('grpSel').innerHTML = DB.groups.map(g => `<option value="${g.id}"${S && g.id === S.id ? ' selected' : ''}>${esc(g.name)} · ${g.students.length}명</option>`).join('') +
    `<option value="__new"${!S || ui.onboard ? ' selected' : ''}>+ 새 반 만들기</option>`;
  $('grpEdit').hidden = !S || ui.onboard;
  $('grpSel').parentElement.hidden = !DB.groups.length;
}
function show(tab) {
  const onboard = !S || ui.onboard;
  if (!onboard) ui.tab = tab;
  $('tabs').hidden = onboard; $('p-new').hidden = !onboard;
  for (const t of ['dx', 'brief', 'stu', 'chk']) {
    $('p-' + t).hidden = onboard || t !== ui.tab; $('t-' + t).setAttribute('aria-selected', String(t === ui.tab));
  }
  render();
  lsSet(STORE + '.tab', tab);
  window.scrollTo({ top: 0 });
}
function render() {
  updateCounts();
  if (!S || ui.onboard) { renderNew(); return; }
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
  if (t.id === 'go') { if (ui.queue.some(it => !it.reviewed)) openReview(); else runAll(ui.queue); return; }
  if (t.id === 'resetBtn') { if (confirm('이 기기에 저장된 모든 반과 기록을 지울까요? 되돌릴 수 없습니다.')) { DB = { cur: null, groups: [] }; S = null; ui.queue = []; ui.sel = null; save(); show('dx'); toast('모든 기록을 지웠어요'); } return; }
  if (t.id === 'gCreate') { createGroup(); return; }
  if (t.id === 'gCancel') { ui.onboard = false; show(ui.tab); return; }
  if (t.id === 'gSample') { const g = sampleGroup(); DB.groups.push(g); useGroup(g); toast('샘플 반을 열었어요. 가상의 학생 8명 기록입니다.'); return; }
  if (t.id === 'gAuto') { ui.newG.names = []; renderNew(); return; }
  if (t.id === 'grpEdit') { openGroupDlg(); return; }
  if (t.dataset.gdel !== undefined) { ui.gEdit.rows.splice(+t.dataset.gdel, 1); drawGroupDlg(); return; }
  if (t.dataset.gact) {
    const a = t.dataset.gact;
    if (a === 'add') { const used = ui.gEdit.rows.map(r => r.name); let i = 0; while (used.includes(autoName(i))) i++; ui.gEdit.rows.push({ orig: null, name: autoName(i) }); drawGroupDlg(); }
    if (a === 'cancel') $('grpDlg').close();
    if (a === 'save') saveGroupDlg();
    if (a === 'delgroup') deleteGroup();
    return;
  }
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
  if (act === 'nextsheet') { ui.queue = []; ui.sel = null; renderDx(); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
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
  if (e.target.id === 'grpSel') {
    const v = e.target.value;
    if (v === '__new') { ui.onboard = true; show(ui.tab); return; }
    if (ui.queue.some(it => !it.saved && it.status !== 'wait') && !confirm('반영하지 않은 진단이 있습니다. 다른 반으로 옮기면 사라집니다. 옮길까요?')) { updateCounts(); return; }
    const g = DB.groups.find(x => x.id === v); if (g) useGroup(g); return;
  }
  if (e.target.id === 'gCount') {
    if (e.target.value === 'custom') { ui.newG.custom = true; ui.newG.count = Math.max(ui.newG.count, 11); renderNew(); const f = $('gCountIn'); if (f) { f.focus(); f.select(); } }
    else { ui.newG.custom = false; ui.newG.count = +e.target.value; renderNew(); }
    return;
  }
  if (e.target.id === 'gCountIn') { e.target.value = ui.newG.count; return; }
  if (e.target.id === 'qsel') { ui.dx.qid = ['new', 'sheet'].includes(e.target.value) ? e.target.value : +e.target.value; renderDxForm(); return; }
  if (e.target.id === 'ssel') { ui.dx.s = e.target.value; renderDxForm(); return; }
  if (e.target.id === 'file') { takeFiles(e.target.files); e.target.value = ''; return; }
  if (e.target.id === 'redact') { ui.redact = e.target.checked; lsSet(STORE + '.redact', ui.redact ? '1' : '0'); renderDxForm(); return; }
  if (e.target.dataset.itemS) { const it = ui.queue.find(x => x.id === e.target.dataset.itemS); if (it) { group(it).forEach(x => { if (!x.saved) { x.s = e.target.value; if (x.cur) x.cur.rec.s = x.s; } }); renderDx(); } return; }
  if (e.target.dataset.act === 'cause') { const it = selItem(); if (it && it.cur) { it.cur.rec.cause = e.target.value; renderDxOut(); renderDxForm(); } return; }
  const s = e.target.closest('select[data-sel]');
  if (s) { const r = recById(s.dataset.sel); if (r) { if (s.value !== r.cause) { r.cause = s.value; r.byTeacher = true; } r.confirmed = true; save(); render(); } }
});
document.addEventListener('input', e => {
  if (e.target.id === 'gName') ui.newG.name = e.target.value;
  if (e.target.id === 'gCountIn') {
    // 적는 동안에는 이름 칸만 다시 그린다 (입력 칸 포커스 유지)
    const n = Math.round(+e.target.value);
    if (n >= 1 && n <= 60) { ui.newG.count = n; $('gNames').innerHTML = namesHtml(newNames()); }
  }
  if (e.target.dataset && e.target.dataset.gi !== undefined) ui.newG.names[+e.target.dataset.gi] = e.target.value;
  if (e.target.id === 'geName') ui.gEdit.name = e.target.value;
  if (e.target.dataset && e.target.dataset.ge !== undefined) ui.gEdit.rows[+e.target.dataset.ge].name = e.target.value;
  if (e.target.id === 'ctext') ui.dx.custom.text = e.target.value;
  if (e.target.id === 'cans') ui.dx.custom.ans = e.target.value;
  if (e.target.id === 'sexam') ui.dx.sheet.exam = e.target.value;
  if (e.target.id === 'snos') ui.dx.sheet.nos = e.target.value;
  if (e.target.id === 'sans') ui.dx.sheet.ans = e.target.value;
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
if (S) { ui.stu = S.students[0]; ui.dx.s = S.students[0]; }
show(ui.tab);
checkAI();
})();
