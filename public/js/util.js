// 日付・書式・チャート（DOM に触らない純粋な関数）

export const PARTS = ['胸', '肩', '腹筋', '二頭', '三頭', '背中', '下半身'];
export const SLOTS = ['朝食', '昼食', '夕食', '間食'];
export const DOW = '日月火水木金土';

export const pad = n => String(n).padStart(2, '0');
export const key = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseKey = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
export const startOfToday = () => { const t = new Date(); t.setHours(0, 0, 0, 0); return t; };
export const monthKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
export const fmtMD = d => `${d.getMonth() + 1}月${d.getDate()}日`;
export const num = n => Math.round(n).toLocaleString('ja-JP');
export const avg = a => { const v = a.filter(x => x != null); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const setVol = sets => sets.reduce((a, b) => a + (Number(b.w) || 0) * (Number(b.r) || 0), 0);
export const vol = (r, part) => r ? r.training.filter(x => !part || x.part === part).reduce((s, x) => s + setVol(x.sets), 0) : 0;
export const tot = r => r.meals.reduce((a, m) => ({ p: a.p + m.p, f: a.f + m.f, c: a.c + m.c, kcal: a.kcal + m.kcal }), { p: 0, f: 0, c: 0, kcal: 0 });
const splitHM = h => { let H = Math.floor(h), M = Math.round((h - H) * 60); if (M === 60) { H++; M = 0; } return [H, M]; };
export const hm = h => { const [H, M] = splitHM(h); return `${H}<small>時間</small>${M}<small>分</small>`; };
export const hmText = h => { const [H, M] = splitHM(h); return `${H}時間${M}分`; };

/* ---------- チャート（SVG） ---------- */
let uid = 0;
function nice(lo, hi, line) {
  if (hi <= lo) hi = lo + 1;
  const raw = (hi - lo) / 3, mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map(s => s * mag).find(s => s >= raw);
  const min = line ? Math.floor(lo / step) * step : 0, max = Math.ceil(hi / step) * step;
  const ticks = []; for (let t = min; t <= max + 1e-9; t += step) ticks.push(+t.toFixed(6));
  return { min, max, ticks };
}
export function chart(o) {
  const W = 340, H = 168, R = 36, T = 10, B = 22, cw = W - R, ch = H - T - B, n = o.vals.length;
  const tv = o.vals.map(v => v == null ? null : (Array.isArray(v) ? v.reduce((a, b) => a + b, 0) : v));
  const pres = tv.filter(v => v != null && (o.line || v > 0));
  let lo = 0, hi = pres.length ? Math.max(...pres) : 1;
  if (o.line && pres.length) { lo = Math.min(...pres) - .4; hi = Math.max(...pres) + .4; }
  const { min, max, ticks } = nice(lo, hi, o.line);
  const Y = v => T + ch - (v - min) / (max - min) * ch, slot = cw / n;
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.label || '')}">`;
  ticks.forEach(t => { const y = Y(t);
    s += `<line x1="0" x2="${cw}" y1="${y}" y2="${y}" style="stroke:var(--sep)" stroke-width=".6"/><text x="${cw + 6}" y="${y + 3.5}" class="ax">${o.fmt ? o.fmt(t) : t}</text>`; });
  if (!o.line) {
    const bw = Math.max(3, Math.min(20, slot * .58));
    tv.forEach((v, i) => { if (!v) return;
      const x = i * slot + (slot - bw) / 2, op = i === o.sel ? 1 : .45;
      if (Array.isArray(o.vals[i])) {
        let base = 0;
        o.vals[i].forEach((sv, j) => { if (!sv) return;
          const y1 = Y(base + sv), hgt = Math.max(0, Y(base) - y1 - (j ? 1 : 0));
          s += `<rect x="${x}" y="${y1}" width="${bw}" height="${hgt}" rx="${Math.min(2.5, bw / 3)}" style="fill:${o.colors[j]}" opacity="${op}"/>`;
          base += sv; });
      } else s += `<rect x="${x}" y="${Y(v)}" width="${bw}" height="${Y(0) - Y(v)}" rx="${Math.min(4, bw / 2.5)}" style="fill:${o.color}" opacity="${op}"/>`;
    });
  } else {
    const pts = tv.map((v, i) => v == null ? null : [i * slot + slot / 2, Y(v)]);
    const segs = []; let sg = [];
    pts.forEach(p => { if (p) sg.push(p); else if (sg.length) { segs.push(sg); sg = []; } }); if (sg.length) segs.push(sg);
    const gid = 'g' + (uid++);
    s += `<defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:${o.color};stop-opacity:.28"/><stop offset="1" style="stop-color:${o.color};stop-opacity:0"/></linearGradient></defs>`;
    segs.forEach(sg => {
      const l = sg.map((p, k) => (k ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('');
      s += `<path d="${l}L${sg.at(-1)[0].toFixed(1)} ${Y(min)}L${sg[0][0].toFixed(1)} ${Y(min)}Z" fill="url(#${gid})"/>`;
      s += `<path d="${l}" fill="none" style="stroke:${o.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    });
    pts.forEach((p, i) => { if (!p) return; const on = i === o.sel;
      s += `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="${on ? 5 : (n > 10 ? 1.8 : 3)}" style="fill:${o.color};stroke:var(--card)" stroke-width="${on ? 2.5 : 0}"/>`; });
  }
  o.labels.forEach((l, i) => { if (l) s += `<text x="${i * slot + slot / 2}" y="${H - 5}" text-anchor="middle" class="ax${i === o.sel ? ' axs' : ''}">${l}</text>`; });
  return s + '</svg>';
}

/** 画像を長辺 max px の JPEG に縮小する（送信量と AI の料金を抑える） */
export function downscale(file, max = 1280) {
  return new Promise((res, rej) => {
    const im = new Image(), url = URL.createObjectURL(file);
    im.onload = () => {
      const k = Math.min(1, max / Math.max(im.width, im.height)), c = document.createElement('canvas');
      c.width = Math.round(im.width * k); c.height = Math.round(im.height * k);
      c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      res(c.toDataURL('image/jpeg', .82));
    };
    im.onerror = () => { URL.revokeObjectURL(url); rej(new Error('image')); };
    im.src = url;
  });
}
