import { api, isLoggedIn, onAuthChange, login, logout } from './api.js';
import {
  PARTS, SLOTS, DOW, pad, key, parseKey, addDays, startOfToday, monthKey, fmtMD, num, avg, esc,
  setVol, vol, tot, hm, hmText, chart, downscale,
} from './util.js';

const $ = s => document.querySelector(s);
const APP_VERSION = '1.2.0';

/* ================= アイコン ================= */
const IC = {
  sleep: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  weight: '<rect x="3.5" y="4" width="17" height="16" rx="4"/><path d="M8.5 10a3.5 3.5 0 0 1 7 0M12 10l1.6-1.8"/>',
  food: '<path d="M7 3v7a2 2 0 0 0 4 0V3M9 12v9M17 21V3c-2 1.2-3 4-3 8h3"/>',
  train: '<path d="M6.5 7v10M3.5 9.5v5M17.5 7v10M20.5 9.5v5M6.5 12h11"/>',
  golf: '<path d="M7 21V3.5l10 4-10 4"/><path d="M4 21h9"/>',
};
const icon = (k, color) => `<svg class="ic" viewBox="0 0 24 24" fill="none" style="stroke:${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${IC[k]}</svg>`;
const bodyPhPlaceholder = `<div class="ph body" aria-label="身体写真"><svg viewBox="0 0 24 24"><circle cx="12" cy="6" r="3"/><path d="M6.5 21v-6.5a5.5 5.5 0 0 1 11 0V21"/></svg></div>`;
const bodyPh = bp => bp.img ? `<img class="ph body" src="${esc(bp.img)}" alt="身体写真" data-edit="bp:${bp.id}">` : bodyPhPlaceholder;
const MEAL_EMOJI = { 朝食: '🍳', 昼食: '🍱', 夕食: '🍽', 間食: '🥤' };
const foodPh = m => m.img ? `<img class="ph" src="${esc(m.img)}" alt="">` : `<div class="ph food">${MEAL_EMOJI[m.slot] || '🍽'}</div>`;

/* ================= 状態 ================= */
let today = startOfToday();
const state = { sel: new Date(today), view: new Date(today.getFullYear(), today.getMonth(), 1), range: 7, part: '胸', tab: 'home' };
const store = {};                 // 'YYYY-MM-DD' → { sleep, weight, golf, meals[], training[], bodyPhotos[] }
const loaded = new Map();         // 'YYYY-MM' → Promise（読み込み済み / 読み込み中）
let golf = [];                    // 全期間のゴルフ [{date, score, prev_night_sleep}]
let loadError = null;

const recOf = d => store[key(d)];
const EMPTY = { meals: [], training: [], bodyPhotos: [] };

/* ================= データ読み込み ================= */
async function loadMonth(mk, withGolf) {
  const [y, m] = mk.split('-').map(Number);
  const from = `${mk}-01`, to = `${mk}-${pad(new Date(y, m, 0).getDate())}`;
  const data = await api(`/api/logs?from=${from}&to=${to}${withGolf ? '&golf=1' : ''}`);
  for (const k of Object.keys(store)) if (k.startsWith(mk)) delete store[k];
  Object.assign(store, data.days);
  if (data.golf) golf = data.golf;
}

/** 画面に要る月（カレンダーの月 + 選択日から 30 日分）を読み込む */
async function ensureLoaded({ withGolf = false } = {}) {
  const months = new Set([monthKey(state.view)]);
  for (let i = 0; i < 30; i++) months.add(monthKey(addDays(state.sel, -i)));
  let first = withGolf;
  const jobs = [...months].filter(mk => !loaded.has(mk)).map(mk => {
    const p = loadMonth(mk, first).catch(e => { loaded.delete(mk); throw e; });
    first = false;
    loaded.set(mk, p);
    return p;
  });
  if (withGolf && !jobs.length) jobs.push(api(`/api/logs?from=${key(today)}&to=${key(today)}&golf=1`).then(d => { golf = d.golf || []; }));
  await Promise.all([...months].map(mk => loaded.get(mk)).concat(jobs));
}

async function refreshData(opts) {
  try {
    await ensureLoaded(opts);
    loadError = null;
  } catch (e) {
    loadError = e;
    if (e.status === 401 || e.status === 403) return; // ログイン画面へ
  }
  renderHome();
}

/** 指定した日付を含む月を読み直す */
async function invalidate(dates, { golfChanged = true } = {}) {
  for (const d of dates) loaded.delete(d.slice(0, 7));
  await refreshData({ withGolf: golfChanged });
}

/* ================= カレンダー ================= */
function renderCal() {
  const y = state.view.getFullYear(), m = state.view.getMonth();
  $('#monthLabel').textContent = `${y}年${m + 1}月`;
  const first = new Date(y, m, 1).getDay(), days = new Date(y, m + 1, 0).getDate();
  let h = '<div></div>'.repeat(first);
  for (let d = 1; d <= days; d++) {
    const dt = new Date(y, m, d), r = recOf(dt);
    const cls = ['day']; if (+dt === +today) cls.push('today'); if (+dt === +state.sel) cls.push('sel'); if (dt > today) cls.push('future');
    let dots = '';
    if (r && vol(r) > 0) dots += '<i class="dot" style="background:var(--train)"></i>';
    if (r && r.bodyPhotos.length) dots += '<i class="dot" style="background:var(--weight)"></i>';
    if (r && r.golf != null) dots += '<i class="dot" style="background:var(--golf)"></i>';
    h += `<button class="${cls.join(' ')}" data-d="${d}" ${dt > today ? 'disabled' : ''} aria-label="${m + 1}月${d}日"><span class="n">${d}</span><span class="dots">${dots}</span></button>`;
  }
  $('#calGrid').innerHTML = h;
}

/* ================= 選択日のカード ================= */
function card(k, title, color, body, sub = '', edit = '') {
  return `<div class="card${edit ? ' tappable' : ''}"${edit ? ` data-edit="${edit}"` : ''}><div class="m-head" style="color:${color}">${icon(k, color)}${title}${sub ? `<span class="sub">${esc(sub)}</span>` : ''}</div>${body}</div>`;
}
const emptyBody = hint => `<div class="empty">記録なし</div><button class="add" data-go="chat">${hint}</button>`;

function renderDay() {
  const s = state.sel, r = recOf(s) || EMPTY;
  $('#selLabel').textContent = +s === +today ? '今日の記録' : `${fmtMD(s)}（${DOW[s.getDay()]}）の記録`;
  if (!loaded.has(monthKey(s)) && !loadError) { $('#dayCards').innerHTML = '<div class="loading-row">読み込み中…</div>'; return; }

  let h = '<div class="grid2">';
  h += card('sleep', '睡眠', 'var(--sleep)', r.sleep != null ? `<div class="m-val">${hm(r.sleep)}</div>` : emptyBody('チャットで追加'), '', 'day:sleep');
  const bp = r.bodyPhotos.length ? bodyPh(r.bodyPhotos.at(-1)) : '';
  h += card('weight', '体重', 'var(--weight)', r.weight != null
    ? `<div class="w-wrap"><div class="m-val">${r.weight.toFixed(1)}<small>kg</small></div>${bp}</div>`
    : (bp ? `<div class="w-wrap"><div class="empty">体重未入力</div>${bp}</div>` : emptyBody('チャットで追加')), '', 'day:weight');
  h += '</div>';

  if (r.meals.length) {
    const t = tot(r);
    h += card('food', '食事', 'var(--food)', `
      <div class="m-val">${num(t.kcal)}<small>kcal</small></div>
      <div class="pfc-bar"><i style="flex:${t.p * 4};background:var(--p)"></i><i style="flex:${t.f * 9};background:var(--f)"></i><i style="flex:${t.c * 4};background:var(--c)"></i></div>
      <div class="pfc-leg">
        <div>タンパク質<b>${t.p}<small>g</small></b></div><div>脂質<b>${t.f}<small>g</small></b></div><div>炭水化物<b>${t.c}<small>g</small></b></div>
      </div>
      <div class="list">${r.meals.map(m => `<div class="row tappable" data-edit="meal:${m.id}">${foodPh(m)}<div class="rt"><div class="rn">${esc(m.name)}</div><div class="rs">${esc(m.slot)}　P${m.p} F${m.f} C${m.c}</div></div><div class="rv">${num(m.kcal)}<small>kcal</small></div></div>`).join('')}</div>`,
      `${r.meals.length}食`);
  } else h += card('food', '食事', 'var(--food)', emptyBody('写真を送って記録'));

  if (r.training.length) {
    h += card('train', 'トレーニング', 'var(--train)', `
      <div class="m-val">${num(vol(r))}<small>kg 総重量</small></div>
      <div class="list">${r.training.map(x => {
        const same = x.sets.every(st => st.w === x.sets[0].w && st.r === x.sets[0].r);
        const desc = same ? `${x.sets[0].w}kg × ${x.sets[0].r}回 × ${x.sets.length}セット` : x.sets.map(st => `${st.w}×${st.r}`).join(' / ');
        return `<div class="row tappable" data-edit="workout:${x.id}"><div class="rt"><div class="rn">${esc(x.name)}<span class="tag">${esc(x.part)}</span></div><div class="rs">${esc(desc)}</div></div><div class="rv">${num(setVol(x.sets))}<small>kg</small></div></div>`;
      }).join('')}</div>`, [...new Set(r.training.map(x => x.part))].join('・'));
  } else h += card('train', 'トレーニング', 'var(--train)', `<div class="empty">休養日</div><button class="add" data-go="chat">メニューを追加</button>`);

  if (r.golf != null) {
    const pa = avg(golf.filter(g => g.date < key(s)).map(g => g.score));
    h += card('golf', 'ゴルフ', 'var(--golf)', `<div class="m-val">${r.golf}<small>ストローク</small></div>${pa ? `<div class="m-note">これまでの平均 ${pa.toFixed(1)}（${r.golf <= pa ? '平均より良い' : '平均より悪い'}）</div>` : ''}`, '', 'day:golf');
  } else h += card('golf', 'ゴルフ', 'var(--golf)', emptyBody('スコアを追加'), '', 'day:golf');
  $('#dayCards').innerHTML = h;
}

/* ================= トレンド ================= */
function renderTrends() {
  const n = state.range, ds = [...Array(n)].map((_, i) => addDays(state.sel, i - n + 1));
  const recs = ds.map(recOf), sel = n - 1;
  const labels = ds.map((d, i) => n <= 7 ? DOW[d.getDay()] : ((n - 1 - i) % 5 === 0 ? String(d.getDate()) : ''));
  const range = `${fmtMD(ds[0])}〜${fmtMD(ds[n - 1])}`;
  const head = (lab, val) => `<div class="t-head"><div class="t-lab">${lab}</div><div class="m-val">${val}</div></div>`;
  let h = '';

  const sl = recs.map(r => r?.sleep ?? null), slA = avg(sl);
  h += card('sleep', '睡眠', 'var(--sleep)', head('平均', slA != null ? hm(slA) : '—') + chart({ vals: sl, labels, sel, color: 'var(--sleep)', fmt: t => t + 'h', label: '睡眠時間の推移' }), range);

  const wt = recs.map(r => r?.weight ?? null), wp = wt.filter(v => v != null);
  const diff = wp.length > 1 ? wp.at(-1) - wp[0] : 0;
  h += card('weight', '体重', 'var(--weight)',
    head('最新', wp.length ? `${wp.at(-1).toFixed(1)}<small>kg</small><small>期間内 ${diff > 0 ? '+' : diff < 0 ? '−' : '±'}${Math.abs(diff).toFixed(1)}kg</small>` : '—') +
    chart({ vals: wt, labels, sel, color: 'var(--weight)', line: true, label: '体重の推移' }), range);

  const has = r => r && r.meals.length;
  const fd = recs.map(r => { if (!has(r)) return null; const t = tot(r); return [t.p * 4, t.f * 9, t.c * 4]; });
  const A = k => avg(recs.map(r => has(r) ? tot(r)[k] : null));
  const kA = A('kcal'), pA = A('p'), fA = A('f'), cA = A('c');
  h += card('food', '食事', 'var(--food)', head('1日平均', kA ? `${num(kA)}<small>kcal</small>` : '—') +
    chart({ vals: fd, labels, sel, colors: ['var(--p)', 'var(--f)', 'var(--c)'], fmt: t => t >= 1000 ? (t / 1000) + 'k' : t, label: '摂取カロリーの推移' }) +
    `<div class="leg-inline"><span><i class="dot" style="background:var(--p)"></i>P ${pA ? Math.round(pA) : 0}g</span><span><i class="dot" style="background:var(--f)"></i>F ${fA ? Math.round(fA) : 0}g</span><span><i class="dot" style="background:var(--c)"></i>C ${cA ? Math.round(cA) : 0}g</span></div>`, range);

  const pv = recs.map(r => vol(r, state.part) || null);
  const sum = pv.reduce((a, b) => a + (b || 0), 0);
  const byPart = PARTS.map(p => [p, recs.reduce((a, r) => a + vol(r, p), 0)]), mx = Math.max(1, ...byPart.map(x => x[1]));
  h += card('train', '筋トレ総重量', 'var(--train)',
    `<div class="chips" id="partChips">${PARTS.map(p => `<button class="chip${p === state.part ? ' on' : ''}" data-part="${p}">${p}</button>`).join('')}</div>` +
    head(`${state.part}の合計`, `${num(sum)}<small>kg</small>`) +
    chart({ vals: pv, labels, sel, color: 'var(--train)', fmt: t => t >= 1000 ? (t / 1000) + 'k' : t, label: `${state.part}の総重量の推移` }) +
    `<div class="bd">${byPart.map(([p, v]) => `<div class="bd-row"><span>${p}</span><div class="bd-track"><i style="width:${v / mx * 100}%;opacity:${p === state.part ? 1 : .45}"></i></div><span>${num(v)} kg</span></div>`).join('')}</div>`, range);

  $('#trendCards').innerHTML = h;
}

function renderBanner() {
  const el = $('#homeBanner');
  if (!loadError) { el.innerHTML = ''; return; }
  el.innerHTML = `<div class="banner" role="alert">${esc(loadError.message)}<button id="retryLoad">再読み込み</button></div>`;
}

function renderHome() {
  $('#todayLabel').textContent = `${today.getMonth() + 1}月${today.getDate()}日 ${DOW[today.getDay()]}曜日`;
  renderBanner(); renderCal(); renderDay(); renderTrends();
}

function selectDate(d) {
  state.sel = d;
  state.view = new Date(d.getFullYear(), d.getMonth(), 1);
  renderHome();
  refreshData();
}

/* ================= ホームのイベント ================= */
$('#calGrid').addEventListener('click', e => {
  const b = e.target.closest('.day'); if (!b || b.disabled) return;
  selectDate(new Date(state.view.getFullYear(), state.view.getMonth(), +b.dataset.d));
});
$('#prevM').onclick = () => { state.view = new Date(state.view.getFullYear(), state.view.getMonth() - 1, 1); renderCal(); refreshData(); };
$('#nextM').onclick = () => { state.view = new Date(state.view.getFullYear(), state.view.getMonth() + 1, 1); renderCal(); refreshData(); };
$('#goToday').onclick = () => selectDate(new Date(today));
$('#homeBanner').addEventListener('click', e => { if (e.target.closest('#retryLoad')) { loadError = null; renderBanner(); refreshData({ withGolf: true }); } });
$('#rangeSeg').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  state.range = +b.dataset.r; document.querySelectorAll('#rangeSeg button').forEach(x => x.classList.toggle('on', x === b)); renderTrends();
});
$('#trendCards').addEventListener('click', e => { const c = e.target.closest('[data-part]'); if (c) { state.part = c.dataset.part; renderTrends(); } });
$('#dayCards').addEventListener('click', e => {
  if (e.target.closest('[data-go]')) { switchTab('chat'); return; }
  const el = e.target.closest('[data-edit]'); if (!el) return;
  e.stopPropagation();
  const [type, id] = el.dataset.edit.split(':');
  const r = recOf(state.sel) || EMPTY;
  if (type === 'day') openDaySheet(id, r);
  else if (type === 'meal') { const m = r.meals.find(x => x.id === id); if (m) openMealSheet(m); }
  else if (type === 'workout') { const w = r.training.find(x => x.id === id); if (w) openWorkoutSheet(w); }
  else if (type === 'bp') { const p = r.bodyPhotos.find(x => x.id === id); if (p) openBodyPhotoSheet(p); }
});
window.addEventListener('scroll', () => $('#compactNav').classList.toggle('show', state.tab === 'home' && scrollY > 48), { passive: true });

/* ================= タブ ================= */
function switchTab(t) {
  state.tab = t;
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === t));
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  $('#tabbar').hidden = t === 'login';
  $('#compactNav').classList.toggle('show', t === 'home' && scrollY > 48);
  if (t === 'chat') { const m = $('#msgs'); m.scrollTop = m.scrollHeight; }
}
$('#tabbar').addEventListener('click', e => { const b = e.target.closest('.tab'); if (b) switchTab(b.dataset.tab); });

/* ================= トースト ================= */
let toastTimer = null;
function toast(text) {
  const el = $('#toast'); el.textContent = text; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

/* ================= 編集シート ================= */
let sheetReturnFocus = null;
function openSheet(title, bodyHtml, { onSave, onDelete, saveLabel = '保存' } = {}) {
  const sh = $('#sheet'), back = $('#sheetBack');
  sheetReturnFocus = document.activeElement;
  sh.innerHTML = `<div class="grabber"></div>
    <div class="sheet-head"><button type="button" data-act="cancel">キャンセル</button><b id="sheetTitle">${esc(title)}</b>
      ${onSave ? `<button type="button" class="done" data-act="save">${esc(saveLabel)}</button>` : '<span style="min-width:64px"></span>'}</div>
    <form id="sheetForm" novalidate>${bodyHtml}<div class="form-err" id="sheetErr" role="alert"></div></form>
    ${onDelete ? '<button type="button" class="btn danger" data-act="delete">削除</button>' : ''}`;
  sh.hidden = back.hidden = false;
  requestAnimationFrame(() => { sh.classList.add('show'); back.classList.add('show'); });
  let busy = false;
  const run = async fn => {
    if (busy) return; busy = true; $('#sheetErr').textContent = '';
    sh.querySelectorAll('button').forEach(b => { b.disabled = true; });
    try { await fn(); closeSheet(); } catch (e) { $('#sheetErr').textContent = e.message || '保存できませんでした'; }
    finally { busy = false; sh.querySelectorAll('button').forEach(b => { b.disabled = false; }); }
  };
  sh.onclick = e => {
    const a = e.target.closest('[data-act]')?.dataset.act;
    if (a === 'cancel') closeSheet();
    else if (a === 'save') run(onSave);
    else if (a === 'delete' && confirm('この記録を削除しますか？')) run(onDelete);
  };
  $('#sheetForm').onsubmit = e => { e.preventDefault(); if (onSave) run(onSave); };
  sh.querySelector('input,select')?.focus({ preventScroll: true });
}
function closeSheet() {
  const sh = $('#sheet'), back = $('#sheetBack');
  sh.classList.remove('show'); back.classList.remove('show');
  setTimeout(() => { sh.hidden = back.hidden = true; sh.innerHTML = ''; }, 280);
  sheetReturnFocus?.focus?.({ preventScroll: true });
}
$('#sheetBack').onclick = closeSheet;
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#sheet').hidden) closeSheet(); });

const val = id => $('#' + id).value.trim();
const numOrNull = (id, label) => {
  const v = val(id); if (v === '') return null;
  const n = Number(v); if (!Number.isFinite(n)) throw new Error(`${label}は数字で入力してください`);
  return n;
};
const selDate = () => key(state.sel);

async function saveDay(patch) {
  await api('/api/records', { method: 'PATCH', body: { type: 'day', date: selDate(), ...patch } });
  await invalidate([selDate()], { golfChanged: 'golf_score' in patch });
  toast('保存しました');
}

function openDaySheet(field, r) {
  if (field === 'sleep') {
    const H = r.sleep != null ? Math.floor(r.sleep) : '', M = r.sleep != null ? Math.round((r.sleep - Math.floor(r.sleep)) * 60) : '';
    openSheet('睡眠', `<div class="group">
        <label><span>時間</span><input id="fH" type="number" inputmode="numeric" min="0" max="24" value="${H}"></label>
        <label><span>分</span><input id="fM" type="number" inputmode="numeric" min="0" max="59" value="${M}"></label></div>`, {
      onSave: () => {
        const h = numOrNull('fH', '時間') ?? 0, m = numOrNull('fM', '分') ?? 0;
        if (h < 0 || m < 0 || m > 59 || h + m / 60 > 24) throw new Error('0〜24時間の範囲で入力してください');
        if (val('fH') === '' && val('fM') === '') throw new Error('時間を入力してください');
        return saveDay({ sleep_hours: +(h + m / 60).toFixed(2) });
      },
      onDelete: r.sleep != null ? () => saveDay({ sleep_hours: null }) : null,
    });
  } else if (field === 'weight') {
    openSheet('体重', `<div class="group"><label><span>体重（kg）</span><input id="fW" type="number" inputmode="decimal" step="0.1" min="20" max="300" value="${r.weight ?? ''}"></label></div>`, {
      onSave: () => {
        const w = numOrNull('fW', '体重'); if (w == null || w < 20 || w > 300) throw new Error('20〜300kg の範囲で入力してください');
        return saveDay({ weight_kg: w });
      },
      onDelete: r.weight != null ? () => saveDay({ weight_kg: null }) : null,
    });
  } else if (field === 'golf') {
    openSheet('ゴルフ', `<div class="group"><label><span>スコア</span><input id="fG" type="number" inputmode="numeric" min="18" max="200" value="${r.golf ?? ''}"></label></div>`, {
      onSave: () => {
        const g = numOrNull('fG', 'スコア'); if (g == null || g < 18 || g > 200 || !Number.isInteger(g)) throw new Error('18〜200 の整数で入力してください');
        return saveDay({ golf_score: g });
      },
      onDelete: r.golf != null ? () => saveDay({ golf_score: null }) : null,
    });
  }
}

async function mutate(method, body) {
  await api('/api/records', { method, body });
  await invalidate([selDate()], { golfChanged: false });
  toast(method === 'DELETE' ? '削除しました' : '保存しました');
}

function openMealSheet(m) {
  openSheet('食事', `${m.img ? `<img class="full" src="${esc(m.img)}" alt="食事の写真">` : ''}
    <div class="group">
      <label><span>区分</span><select id="fSlot">${SLOTS.map(s => `<option${s === m.slot ? ' selected' : ''}>${s}</option>`).join('')}</select></label>
      <label><span>メニュー</span><input id="fName" maxlength="80" value="${esc(m.name)}"></label>
      <label><span>kcal</span><input id="fK" type="number" inputmode="numeric" min="0" max="5000" value="${m.kcal}"></label>
      <label><span>P（g）</span><input id="fP" type="number" inputmode="numeric" min="0" max="500" value="${m.p}"></label>
      <label><span>F（g）</span><input id="fF" type="number" inputmode="numeric" min="0" max="500" value="${m.f}"></label>
      <label><span>C（g）</span><input id="fC" type="number" inputmode="numeric" min="0" max="1000" value="${m.c}"></label>
    </div><p class="hint">kcal を空にすると PFC から計算します。</p>`, {
    onSave: () => mutate('PATCH', {
      type: 'meal', id: m.id, slot: val('fSlot'), name: val('fName') || '食事',
      kcal: numOrNull('fK', 'kcal'), p: numOrNull('fP', 'P') ?? 0, f: numOrNull('fF', 'F') ?? 0, c: numOrNull('fC', 'C') ?? 0,
    }),
    onDelete: () => mutate('DELETE', { type: 'meal', id: m.id }),
  });
}

function openWorkoutSheet(w) {
  let sets = w.sets.map(s => ({ ...s }));
  const setsHtml = () => sets.map((s, i) => `<div class="set-row">
      <span class="n">${i + 1}</span>
      <input type="number" inputmode="decimal" step="0.5" min="0" max="1000" data-i="${i}" data-k="w" value="${s.w}" aria-label="${i + 1}セット目の重量（kg）">
      <input type="number" inputmode="numeric" min="1" max="200" data-i="${i}" data-k="r" value="${s.r}" aria-label="${i + 1}セット目の回数">
      <button type="button" class="x" data-rm="${i}" aria-label="${i + 1}セット目を削除">×</button></div>`).join('');
  openSheet('トレーニング', `<div class="group">
      <label><span>部位</span><select id="fPart">${PARTS.map(p => `<option${p === w.part ? ' selected' : ''}>${p}</option>`).join('')}</select></label>
      <label><span>種目</span><input id="fName" maxlength="80" value="${esc(w.name)}"></label></div>
    <div class="hint" style="margin-bottom:6px">セット（kg × 回）</div>
    <div class="group"><div id="setRows">${setsHtml()}</div><button type="button" class="add-set" id="addSet">＋ セットを追加</button></div>`, {
    onSave: () => {
      if (!sets.length) throw new Error('セットを 1 つ以上入れてください');
      if (sets.some(s => !(s.w >= 0) || !(s.r >= 1))) throw new Error('重量と回数を入力してください');
      return mutate('PATCH', { type: 'workout', id: w.id, part: val('fPart'), name: val('fName') || val('fPart'), sets });
    },
    onDelete: () => mutate('DELETE', { type: 'workout', id: w.id }),
  });
  const rows = $('#setRows');
  rows.addEventListener('input', e => { const i = e.target.dataset.i; if (i != null) sets[i][e.target.dataset.k] = e.target.value === '' ? NaN : Number(e.target.value); });
  rows.addEventListener('click', e => { const i = e.target.closest('[data-rm]')?.dataset.rm; if (i != null) { sets.splice(+i, 1); rows.innerHTML = setsHtml(); } });
  $('#addSet').onclick = () => { if (sets.length >= 30) return; sets.push({ ...(sets.at(-1) || { w: 0, r: 10 }) }); rows.innerHTML = setsHtml(); };
}

function openBodyPhotoSheet(p) {
  openSheet(`${fmtMD(state.sel)}の身体写真`, p.img ? `<img class="full" src="${esc(p.img)}" alt="身体写真">` : '<div class="empty">写真を読み込めませんでした</div>', {
    onDelete: () => mutate('DELETE', { type: 'body_photo', id: p.id }),
  });
}

function openSettings() {
  openSheet('設定', `<div class="group">
      <label><span>バージョン</span><span style="width:auto;color:var(--l2)">${APP_VERSION}</span></label></div>
    <button type="button" class="btn plain" id="clearChat">会話履歴を消す</button>
    <button type="button" class="btn danger" id="doLogout">ログアウト</button>
    <p class="hint" style="margin-top:12px">会話履歴を消しても、カレンダーの記録は残ります。</p>`);
  $('#clearChat').onclick = async () => {
    if (!confirm('会話履歴をすべて消しますか？（記録は消えません）')) return;
    try { await api('/api/chat', { method: 'DELETE' }); msgs.length = 0; pushWelcome(); renderMsgs(); closeSheet(); toast('会話履歴を消しました'); }
    catch (e) { $('#sheetErr').textContent = e.message; }
  };
  $('#doLogout').onclick = async () => { if (confirm('ログアウトしますか？')) { closeSheet(); await logout(); } };
}
$('#openSettings').onclick = openSettings;

/* ================= チャット ================= */
const msgs = [];
const DEFAULT_CHIPS = ['今週の振り返り', '体重 72.4', '睡眠 7時間30分', 'ベンチ 80kg 8回 3セット', 'ゴルフ 92'];
const REC_COLOR = { sleep: 'var(--sleep)', weight: 'var(--weight)', food: 'var(--food)', train: 'var(--train)', golf: 'var(--golf)' };
const savedBlock = lines => `<span class="saved-t">記録に保存しました</span>` +
  lines.map(([k, t]) => `<span class="rec"><i class="dot" style="background:${REC_COLOR[k] || 'var(--l2)'}"></i>${esc(t)}</span>`).join('');
const WELCOME = '睡眠・体重・食事・筋トレ・ゴルフのスコアを送ってくれれば、カレンダーに保存します。食事や身体の写真は左の＋から。ひとこと添えると推定が正確になります（例：「ご飯は半分」）。\n過去の記録をもとにしたアドバイスは「今週の振り返り」と送ってください。\n記録の修正・削除は、ホームで記録をタップするとできます。';
const pushWelcome = () => msgs.push({ from: 'ai', text: WELCOME, at: new Date() });

function stampLabel(d) {
  const t = startOfToday(), day = new Date(d); day.setHours(0, 0, 0, 0);
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (+day === +t) return `今日 ${time}`;
  if (+day === +addDays(t, -1)) return `昨日 ${time}`;
  return `${fmtMD(d)}（${DOW[d.getDay()]}） ${time}`;
}

function renderMsgs() {
  const el = $('#msgs');
  let h = '', lastAt = null;
  msgs.forEach((m, i) => {
    if (m.at && (!lastAt || m.at - lastAt > 60 * 60 * 1000)) h += `<div class="stamp">${stampLabel(m.at)}</div>`;
    if (m.at) lastAt = m.at;
    const gap = i > 0 && msgs[i - 1].from !== m.from ? ' gap' : '';
    if (m.typing) { h += `<div class="b ai typing${gap}" aria-label="入力中"><i></i><i></i><i></i></div>`; return; }
    if (m.img) h += `<div class="b me imgb${gap}"><img src="${esc(m.img)}" alt="送信した写真"></div>`;
    if (m.from === 'me' && m.text) h += `<div class="b me${m.img ? '' : gap}">${esc(m.text)}</div>`;
    if (m.from === 'ai') h += `<div class="b ai${gap}">${m.saved?.length ? savedBlock(m.saved) + '\n' : ''}${esc(m.text)}</div>`;
    if (m.failed) h += `<div class="b err">送信できませんでした：${esc(m.failed)}<button data-retry="${i}">再送</button></div>`;
  });
  el.innerHTML = h;
  el.scrollTop = el.scrollHeight;
  const last = [...msgs].reverse().find(m => m.from === 'ai' && !m.typing);
  const chips = last?.chips?.length ? last.chips : DEFAULT_CHIPS;
  $('#quick').innerHTML = chips.map(c => `<button class="qchip">${esc(c)}</button>`).join('');
}

async function loadChat() {
  try {
    const { messages } = await api('/api/chat');
    msgs.length = 0;
    if (!messages.length) pushWelcome();
    for (const m of messages) {
      msgs.push({ from: m.role === 'user' ? 'me' : 'ai', text: m.content, img: m.img, saved: m.saved, at: new Date(m.created_at) });
    }
  } catch (e) {
    if (e.status === 401 || e.status === 403) return;
    msgs.length = 0; pushWelcome();
  }
  renderMsgs();
}

let attach = null, sending = false;
async function send(text, img = attach) {
  text = (text || '').trim();
  if ((!text && !img) || sending) return;
  sending = true;
  const mine = { from: 'me', text, img, at: new Date() };
  msgs.push(mine);
  setAttach(null); txt.value = ''; autosize();
  msgs.push({ from: 'ai', typing: true }); renderMsgs();
  try {
    const message = img ? [{ type: 'text', text: text || '（写真のみ）' }, { type: 'image_url', image_url: { url: img } }] : text;
    const data = await api('/api/chat', { method: 'POST', body: { message } });
    msgs.pop();
    msgs.push({ from: 'ai', text: data.reply, saved: data.saved, chips: data.suggestions, at: new Date() });
    renderMsgs();
    if (data.dates?.length) {
      const last = data.dates.slice().sort().at(-1);
      state.sel = parseKey(last); state.view = new Date(state.sel.getFullYear(), state.sel.getMonth(), 1);
      await invalidate(data.dates, { golfChanged: data.saved.some(s => s[0] === 'golf') });
    }
  } catch (e) {
    msgs.pop();
    mine.failed = e.message || '通信エラー';
    renderMsgs();
  } finally { sending = false; }
}

/* --- 入力欄 --- */
const txt = $('#txt');
function autosize() { txt.style.height = 'auto'; txt.style.height = Math.min(txt.scrollHeight, 110) + 'px'; $('#send').classList.toggle('ready', !!txt.value.trim() || !!attach); }
txt.addEventListener('input', autosize);
txt.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(txt.value); } });
$('#send').onclick = () => send(txt.value);
$('#quick').addEventListener('click', e => { const c = e.target.closest('.qchip'); if (c) send(c.textContent); });
$('#msgs').addEventListener('click', e => {
  const i = e.target.closest('[data-retry]')?.dataset.retry; if (i == null) return;
  const m = msgs[+i]; msgs.splice(+i, 1); renderMsgs(); send(m.text, m.img);
});
function setAttach(img) { attach = img; $('#attachBar').hidden = !img; if (img) $('#attachImg').src = img; autosize(); }
$('#fileIn').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try { setAttach(await downscale(f)); txt.focus(); } catch { toast('この画像は読み込めませんでした。JPEG か PNG で送ってください。'); }
});
$('#attachX').onclick = () => setAttach(null);

/* ================= ログイン ================= */
const EMAIL_KEY = 'mhl.email';
const FEATS = [['sleep', '睡眠', 'var(--sleep)'], ['weight', '体重', 'var(--weight)'], ['food', '食事', 'var(--food)'], ['train', '筋トレ', 'var(--train)'], ['golf', 'ゴルフ', 'var(--golf)']];
$('#lgFeats').innerHTML = FEATS.map(([k, t, c]) => `<li>${icon(k, c)}${t}</li>`).join('');

const savedEmail = () => { try { return localStorage.getItem(EMAIL_KEY) || ''; } catch { return ''; } };
const rememberEmail = e => { try { localStorage.setItem(EMAIL_KEY, e); } catch { /* 記憶できなくても使える */ } };

function setBusy(on, text) {
  const b = $('#loginBtn'); b.disabled = on; b.classList.toggle('busy', on);
  if (text) $('#loginBtnText').textContent = text;
}
function resetLogin() {
  $('#loginErr').textContent = '';
  setBusy(false, 'ログイン');
  $('#loginEmail').value = savedEmail();
  $('#loginPass').value = '';
}
$('#loginForm').onsubmit = async e => {
  e.preventDefault();
  $('#loginErr').textContent = '';
  const email = val('loginEmail').toLowerCase(), pass = $('#loginPass').value;
  try {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('メールアドレスを確認してください');
    if (!pass) throw new Error('パスワードを入力してください');
    setBusy(true, '確認中…');
    await login(email, pass);
    rememberEmail(email);
  } catch (err) {
    $('#loginErr').textContent = err.message;
    setBusy(false, 'ログイン');
    $('#loginPass').select();
  }
};

/* ================= 起動 ================= */
function resetData() {
  for (const k of Object.keys(store)) delete store[k];
  loaded.clear(); golf = []; loadError = null; msgs.length = 0;
}

function boot() {
  if (!isLoggedIn()) {
    resetData(); resetLogin(); switchTab('login'); return;
  }
  switchTab('home');
  renderHome();
  refreshData({ withGolf: true });
  loadChat();
}
onAuthChange(boot);

// 日付をまたいで開きっぱなしにしていたときは「今日」を更新する
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !isLoggedIn()) return;
  const t = startOfToday();
  if (+t !== +today) {
    const wasToday = +state.sel === +today;
    today = t;
    if (wasToday) { state.sel = new Date(today); state.view = new Date(today.getFullYear(), today.getMonth(), 1); }
    loaded.delete(monthKey(today));
    refreshData();
  }
});

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('/sw.js').catch(err => console.warn('Service Worker を登録できませんでした', err));
}

boot();
