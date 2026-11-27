/* 개인정보 자동 가리기 (브라우저 안에서만 동작, 원본 사진은 밖으로 나가지 않는다)
   1) 글줄 방향으로 사진이 가로인지 세로인지 판단하고, 머리글·바닥글 위치로 위아래를 정한다
   2) 시험지 머리글(학원 로고·시험 이름·학생 이름 칸)과 바닥글(캠퍼스·쪽 번호) 띠를 찾아 가린다
   3) 가린 결과를 픽셀에 직접 칠해 JPEG로 만든다 (가린 부분은 되돌릴 수 없음) */
(function () {
'use strict';
const S = 480;           // 분석용 축소 크기
function canvasOf(img, rot, max) {
  const w0 = img.naturalWidth || img.width, h0 = img.naturalHeight || img.height;
  const sc = Math.min(1, max / Math.max(w0, h0));
  const w = Math.round(w0 * sc), h = Math.round(h0 * sc);
  const side = rot % 180 !== 0;
  const c = document.createElement('canvas');
  c.width = side ? h : w; c.height = side ? w : h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  g.translate(c.width / 2, c.height / 2); g.rotate(rot * Math.PI / 180);
  g.drawImage(img, -w / 2, -h / 2, w, h);
  g.setTransform(1, 0, 0, 1, 0, 0);
  return c;
}
function pixels(img, rot) {
  const c = canvasOf(img, rot, S);
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  const W = c.width, H = c.height, n = W * H;
  const L = new Float32Array(n), sat = new Float32Array(n), R = new Float32Array(n), B = new Float32Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    const r = d[j], g = d[j + 1], b = d[j + 2];
    L[i] = r * 0.299 + g * 0.587 + b * 0.114;
    sat[i] = Math.max(r, g, b) - Math.min(r, g, b); R[i] = r; B[i] = b;
  }
  return { W, H, L, sat, R, B };
}
const pct = (arr, p) => { const a = Float32Array.from(arr).sort(); return a[Math.min(a.length - 1, Math.floor(p * (a.length - 1)))]; };
function median(a, lo, hi) { const s = Array.from(a.slice(lo, hi)).sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; }

// 글줄이 가로로 놓였는지: 잉크 투영의 줄무늬 세기 비교
function horizontalText(P) {
  const { W, H, L } = P;
  const paper = pct(L, 0.85);
  const rows = new Float32Array(H), cols = new Float32Array(W);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (L[y * W + x] < paper - 45) { rows[y]++; cols[x]++; }
  const stripe = (p, n) => {
    const s = new Float32Array(p.length);
    for (let i = 0; i < p.length; i++) s[i] = (p[Math.max(0, i - 1)] + p[i] + p[Math.min(p.length - 1, i + 1)]) / 3 / n;
    let d = 0, m = 0; for (let i = 0; i < s.length; i++) { m += s[i]; if (i) d += Math.abs(s[i] - s[i - 1]); }
    return (d / (s.length - 1)) / (m / s.length + 1e-6);
  };
  return stripe(rows, W) >= stripe(cols, H);
}

// 위아래가 정해진 사진에서 머리글·바닥글 띠 찾기
function bands(P) {
  const { W, H, L, sat, R, B } = P;
  const x0 = Math.floor(W * 0.2), x1 = Math.floor(W * 0.8), cw = x1 - x0;
  const p90 = new Float32Array(H), med = new Float32Array(H), smed = new Float32Array(H), blue = new Float32Array(H);
  const rowL = new Float32Array(cw), rowS = new Float32Array(cw);
  // 배경(책상) 색: 사진 테두리 픽셀의 평균
  let br = 0, bb = 0, bn = 0;
  for (let y = 0; y < H; y++) for (const x of [0, 1, W - 2, W - 1]) { br += R[y * W + x]; bb += B[y * W + x]; bn++; }
  const deskWarm = (br - bb) / bn;
  for (let y = 0; y < H; y++) {
    let bl = 0;
    for (let x = x0; x < x1; x++) { const i = y * W + x; rowL[x - x0] = L[i]; rowS[x - x0] = sat[i]; bl += (B[i] - R[i]); }
    const sl = Float32Array.from(rowL).sort(), ss = Float32Array.from(rowS).sort();
    p90[y] = sl[Math.floor(0.9 * (cw - 1))]; med[y] = sl[cw >> 1]; smed[y] = ss[cw >> 1]; blue[y] = bl / cw;
  }
  // 머리글: 위쪽 25% 안에서 색이 칠해진 띠(책상 색과 다른 것) 또는 주변보다 확 어두운 띠의 마지막 줄
  const w = Math.max(2, Math.floor(H * 0.05));
  let head = -1, colored = 0;
  for (let y = 0; y < Math.floor(H * 0.25); y++) {
    let ref = 0; for (let k = y; k <= Math.min(H - 1, y + w); k++) ref = Math.max(ref, p90[k]);
    const tinted = smed[y] > 12 && Math.abs(blue[y] + deskWarm) > 10 && !(deskWarm > 15 && -blue[y] > 15);
    if (tinted) colored++;
    if (tinted || (smed[y] > 12 && y < H * 0.03) || p90[y] < ref - 20) head = y;
  }
  // 바닥글: 책상을 건너뛰고 아래에서부터, 위쪽 종이보다 어두운 회색 띠
  const refA = y => median(med, Math.max(0, y - Math.floor(H * 0.10)), Math.max(1, y - Math.floor(H * 0.04)));
  let y = H - 1;
  while (y > H * 0.7 && (smed[y] > 14 || med[y] < refA(y) - 35)) y--;
  const segs = []; let cur = null;
  for (let yy = y; yy > Math.floor(H * 0.80); yy--) {
    if (med[yy] < refA(yy) - 10 && smed[yy] <= 14) {
      if (cur && cur[0] - yy <= 3) cur[0] = yy; else { cur = [yy, yy]; segs.push(cur); }
    }
  }
  const seg = segs.find(g => g[1] - g[0] + 1 >= H * 0.012);
  return {
    head: head >= 0 ? Math.min(0.3, (head + 1) / H + 0.012) : null,
    foot: seg ? Math.max(0.7, seg[0] / H - 0.006) : null,
    colored
  };
}

// 자동 분석: { rot, masks:[{x,y,w,h}] (회전한 사진 기준 0~1 비율), found }
function analyze(img) {
  const w0 = img.naturalWidth || img.width, h0 = img.naturalHeight || img.height;
  const base = horizontalText(pixels(img, 0)) ? [0, 180] : [90, 270];
  let best = null;
  for (const rot of base) {
    const b = bands(pixels(img, rot));
    // 색 띠(머리글)가 위에 있고 바닥글 띠가 아래에 있을수록 바른 방향
    const score = (b.colored > 2 ? 2 : 0) + (b.head != null ? 1 : 0) + (b.foot != null ? 1 : 0) + (rot === base[0] ? 0.1 : 0);
    if (!best || score > best.score) best = { rot, b, score };
  }
  const masks = [];
  if (best.b.head != null) masks.push({ x: 0, y: 0, w: 1, h: best.b.head, auto: 'head' });
  if (best.b.foot != null) masks.push({ x: 0, y: best.b.foot, w: 1, h: 1 - best.b.foot, auto: 'foot' });
  // 띠가 하나도 없으면(직접 찍은 풀이 사진 등) 회전하지 않는다
  return { rot: best.score >= 1 ? best.rot : base[0] === 0 ? 0 : best.rot, masks, w: w0, h: h0 };
}

// 가림을 픽셀에 칠한 JPEG
function render(img, rot, masks, max, q) {
  const c = canvasOf(img, rot, max);
  const g = c.getContext('2d');
  g.fillStyle = '#2b2f36';
  for (const m of masks || []) g.fillRect(Math.floor(m.x * c.width), Math.floor(m.y * c.height), Math.ceil(m.w * c.width), Math.ceil(m.h * c.height));
  if (masks && masks.length && c.width > 200) {
    g.fillStyle = '#9aa3ad'; g.font = `${Math.round(c.width / 40)}px sans-serif`; g.textBaseline = 'middle';
    for (const m of masks) if (m.h * c.height > c.width / 30) g.fillText('개인정보 가림', m.x * c.width + c.width / 60, (m.y + m.h / 2) * c.height);
  }
  return c.toDataURL('image/jpeg', q);
}
window.Redact = { analyze, render, canvasOf };
})();
