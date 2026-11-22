// Swing-Depot: Oberfläche. Rechenregeln stehen in engine.js (gleiche Datei wie im Abendlauf).
// Daten liegen im Speicher des Handys (localStorage). Kurse kommen aus data/ (vom GitHub-Abendlauf geschrieben).
'use strict';

// ---------- Begriffe (Erklärungen hinter den ?-Knöpfen) ----------
const TERMS = {
  gd: ['Durchschnittslinie', 'Der durchschnittliche Kurs der letzten 20, 50 oder 200 Handelstage. Liegt der Kurs über seiner 200-Tage-Linie, steigt die Aktie langfristig. Fällt der Kurs kurz auf die 20- oder 50-Tage-Linie zurück, ist das oft ein günstiger Moment.'],
  rsi: ['Schwung-Wert (RSI)', 'Eine Zahl von 0 bis 100, die zeigt, wie stark eine Aktie zuletzt gestiegen oder gefallen ist. Über 70: sehr schnell gestiegen. Unter 30: stark gefallen. 40 bis 55: ruhig, gut zum Einsteigen.'],
  markt: ['Gesamtmarkt (DAX)', 'Der DAX enthält die 40 größten deutschen Aktien. Liegt er über seinem 200-Tage-Durchschnitt, steigt der Markt insgesamt. Fällt er darunter, gibt die Regel keine Kaufsignale, weil dann auch gute Aktien oft mitfallen.'],
  entry: ['Kaufen ab', 'Gekauft wird erst, wenn der Kurs diesen Wert erreicht. So kaufst du nur, wenn die Aktie wirklich wieder steigt. Bei Trade Republic legst du dafür eine Stop-Order (Kauf) an. Wird der Kurs in 3 Tagen nicht erreicht, verfällt das Signal.'],
  stop: ['Notbremse (Stop-Loss)', 'Fällt der Kurs auf diesen Wert, wird verkauft. So bleibt ein Verlust klein und geplant. Bei Trade Republic legst du dafür direkt nach dem Kauf eine Stop-Order (Verkauf) an.'],
  ziel: ['Ziel', 'Bei diesem Kurs nimmst du den Gewinn mit. Bei Trade Republic als Limit-Order (Verkauf) anlegen.'],
  crv: ['Gewinn zu Verlust', 'Wie viel du am Ziel gewinnen kannst, verglichen mit dem, was du an der Notbremse verlierst, jeweils nach Gebühren. „1,5-mal“ heißt: 1,50 € möglicher Gewinn für jeden 1 € möglichen Verlust. Bei kleinen Beträgen drücken die Gebühren diesen Wert stark.'],
  atr: ['Übliche Tagesschwankung', 'Um wie viel der Kurs an einem normalen Tag hin und her geht. Die Notbremse liegt mindestens zwei solche Schwankungen entfernt, damit normales Zappeln sie nicht auslöst.'],
  einstand: ['Einstand', 'Was du für deine Stücke insgesamt bezahlt hast, inklusive Gebühren. Gewinn und Verlust werden davon aus gerechnet.'],
  breakeven: ['Ab hier im Plus', 'Ab diesem Kurs deckt ein Verkauf auch die Kauf- und Verkaufsgebühr.'],
  abgleich: ['Abgleich mit Trade Republic', 'Trade Republic handelt über eine eigene Börse, deshalb weichen Kurse leicht ab. Beim Abgleich übernimmst du Stückzahl, Durchschnittskurs und auf Wunsch den aktuellen Kurs aus der Trade-Republic-App. Die Kopie rechnet ab dann mit diesen Werten.'],
  papier: ['Papier-Modus', 'Die App tut so, als hätte sie jedes Kaufsignal der Regel gekauft und an Notbremse oder Ziel wieder verkauft, inklusive Gebühren. Kein echtes Geld. So siehst du nach einigen Wochen, ob die Regel etwas taugt.'],
  isin: ['ISIN', 'Die weltweit eindeutige Nummer einer Aktie, 12 Zeichen, z. B. DE0007164600 für SAP. In Trade Republic: Aktie öffnen und ganz nach unten scrollen. Dort steht sie bei den Infos zur Aktie.'],
};
const info = k => `<button type="button" class="info" data-term="${k}" aria-label="Erklärung: ${esc(TERMS[k][0])}">?</button>`;

// ---------- Zustand ----------
const DEFAULT_SETTINGS = { stake: 50, maxLoss: 5, fee: 1, minCrv: 1.5, fractional: true, ruleset: 'A', timingMin: 3, marketFilter: true, paperStart: '2026-11-23' };
const state = { stocks: {}, trades: {}, prices: {}, resolved: {}, market: null, meta: null, sync: null, syncAt: null, syncError: '', settings: { ...DEFAULT_SETTINGS }, filter: 'alle', tab: 'today', loaded: false, showAvg: false, paperRange: 'start', paperFee: 'on' };
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const safeId = s => String(s).toUpperCase().replace(/[^A-Z0-9_-]/g, '_').slice(0, 60);
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } };
const num = v => { const x = parseFloat(String(v ?? '').replace(',', '.')); return isFinite(x) ? x : null; };
const SIGNAL_LABEL = { kaufen: 'Kaufen', abwarten: 'Abwarten', nicht: 'Nicht kaufen' };
const ISIN_RE = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;
const SYMBOL_RE = /^[A-Z0-9^][A-Z0-9-]{0,9}\.[A-Z]{1,3}$/;

function toast(msg) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => t.hidden = true, 2800); }
const isPending = st => !st.symbol;
function priceFile(st) { return st && st.symbol ? state.prices[safeId(st.symbol)] : null; }
function historyOf(st) {
  if (!st) return null;
  if (st.hist && st.hist.c && st.hist.c.length) return st.hist;
  const p = priceFile(st);
  return p && p.hist && p.hist.c.length ? p.hist : null;
}
const currencyOf = st => (st && !st.hist && priceFile(st)?.currency) || 'EUR';
const inCur = (st, fn) => withCurrency(currencyOf(st), fn);
// Gesamtmarkt: Funktion Datum -> steigt der DAX? (null, wenn keine Daten)
let marketFn = () => null;
function settingsFor(H) {
  const S = { ...state.settings };
  if (H && S.marketFilter !== false) { const up = marketFn(H.d[H.d.length - 1]); if (up != null) S.marketUp = up; }
  return S;
}
function evaluateStock(st) {
  const H = historyOf(st); if (!H || H.c.length < 2) return null;
  const rs = RULESETS[state.settings.ruleset] || RULESETS.A;
  return inCur(st, () => rs.evaluate(H, settingsFor(H)));
}
// Aktueller Kurs in Euro: Kurs laut Trade Republic aus dem Abgleich, solange er nicht älter ist als der letzte Tageskurs
function priceInfo(symbol) {
  const st = state.stocks[safeId(symbol)]; const H = historyOf(st);
  const last = H ? H.c[H.c.length - 1] : null, lastD = H ? H.d[H.d.length - 1] : '';
  if (st?.trPrice && st.trPrice.date >= lastD) return { price: st.trPrice.price, source: 'tr', date: st.trPrice.date };
  if (last == null || currencyOf(st) !== 'EUR') return null;
  return { price: last, source: 'kurs', date: lastD };
}
function tradeList() { return Object.entries(state.trades).map(([id, t]) => ({ id, ...t })); }
const depot = () => computeDepot(tradeList(), priceInfo, state.settings.fee);
function holdingRating(p) { const st = state.stocks[safeId(p.symbol)]; const H = historyOf(st); return H ? rateHolding(p, H, state.settings) : null; }

// ---------- Speicher auf dem Handy ----------
const LS_KEY = 'swing-depot-app-v1';
const store = {
  async init() {
    const saved = lsGet(LS_KEY, null);
    if (saved) { state.stocks = saved.stocks || {}; state.trades = saved.trades || {}; state.settings = { ...DEFAULT_SETTINGS, ...(saved.settings || {}) }; }
    else {
      // Erster Start: Beobachtungsliste aus dem Repository übernehmen
      try { const cfg = await (await fetch('config/watch.json', { cache: 'no-cache' })).json(); (cfg.stocks || []).forEach(s => { if (s.symbol) state.stocks[safeId(s.symbol)] = { symbol: s.symbol, name: s.name, addedAt: isoDate(new Date()) }; else if (s.query) state.stocks['Q_' + safeId(s.query)] = { query: s.query, name: s.name || '', addedAt: isoDate(new Date()) }; }); state.settings = { ...DEFAULT_SETTINGS, ...(cfg.settings || {}) }; } catch (e) { }
      this.save(false);
    }
    state.loaded = true; render();
    await loadPrices();
  },
  save(sync = true) { lsSet(LS_KEY, { stocks: state.stocks, trades: state.trades, settings: state.settings }); if (sync) scheduleSync(); },
  setStock(id, data) { state.stocks[id] = data; this.save(); render(); },
  updateStock(id, patch) { state.stocks[id] = { ...state.stocks[id], ...patch }; this.save(!('hist' in patch) && !('trPrice' in patch)); render(); },
  delStock(id) { delete state.stocks[id]; this.save(); render(); },
  setTrade(id, t) { id = id || ('t' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36)); state.trades[id] = t; this.save(); render(); },
  delTrade(id) { delete state.trades[id]; this.save(); render(); },
  saveSettings(s) { state.settings = s; this.save(); render(); },
};

const getJson = async (url) => { const r = await fetch(url, { cache: 'no-cache' }); if (!r.ok) throw new Error(r.status); return r.json(); };
// Kurse aus dem Repository laden (vom Abendlauf geschrieben)
async function loadPrices() {
  const [meta, resolved, dax] = await Promise.all([getJson('data/meta.json').catch(() => null), getJson('data/resolved.json').catch(() => ({})), getJson('data/prices/_GDAXI.json').catch(() => null)]);
  state.meta = meta; state.resolved = resolved || {}; state.market = dax;
  marketFn = dax ? marketTrend(dax.hist) : () => null;
  migrateResolved();
  const ids = Object.entries(state.stocks).filter(([, st]) => st.symbol).map(([, st]) => safeId(st.symbol));
  await Promise.all(ids.map(async id => { try { state.prices[id] = await getJson(`data/prices/${id}.json`); } catch (e) { } }));
  Object.keys(paperCache).forEach(k => delete paperCache[k]);
  render();
}
// Per ISIN oder Name eingetragene Aktien: sobald der Abendlauf das Kürzel gefunden hat, wird der Eintrag umgestellt
function migrateResolved() {
  let changed = false;
  for (const [id, st] of Object.entries(state.stocks)) {
    if (st.symbol || !st.query) continue;
    const r = state.resolved[st.query]; if (!r || !r.symbol) continue;
    const nid = safeId(r.symbol);
    if (!state.stocks[nid]) state.stocks[nid] = { symbol: r.symbol, name: st.name || r.name || r.symbol, isin: ISIN_RE.test(st.query) ? st.query : undefined, addedAt: st.addedAt };
    delete state.stocks[id]; changed = true;
  }
  if (changed) store.save();
}

// ---------- Verbindung zu GitHub ----------
// Schreibt config/watch.json (nur Aktien, Notbremse und Ziel offener Positionen, Regel-Einstellungen; keine Beträge)
const GH_KEY = 'swing-depot-github';
function ghConf() {
  const c = lsGet(GH_KEY, {});
  const m = location.hostname.match(/^([^.]+)\.github\.io$/);
  return { owner: c.owner || (m ? m[1] : ''), repo: c.repo || (m ? location.pathname.split('/').filter(Boolean)[0] || '' : 'Trading'), token: c.token || '' };
}
function watchConfig() {
  const alerts = depot().open.map(p => { const st = state.stocks[safeId(p.symbol)]; const r = holdingRating(p) || { stop: p.stop, target: p.target }; return { symbol: p.symbol, name: st?.name || p.name || p.symbol, stop: r.stop ?? null, target: r.target ?? null }; });
  const { stake, maxLoss, fee, minCrv, fractional, ruleset, timingMin, marketFilter } = state.settings;
  const stocks = Object.values(state.stocks).map(s => s.symbol ? { symbol: s.symbol, name: s.name } : { query: s.query, ...(s.name ? { name: s.name } : {}) });
  return { stocks, alerts, settings: { stake, maxLoss, fee, minCrv, fractional, ruleset, timingMin, marketFilter } };
}
let syncTimer = null;
function scheduleSync() { clearTimeout(syncTimer); if (!ghConf().token) { state.sync = 'off'; renderSync(); return; } state.sync = 'pending'; renderSync(); syncTimer = setTimeout(syncNow, 1500); }
const b64 = s => btoa(unescape(encodeURIComponent(s)));
async function syncNow() {
  const { owner, repo, token } = ghConf(); if (!token || !owner || !repo) { state.sync = 'off'; renderSync(); return; }
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/config/watch.json`;
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' };
  const body = JSON.stringify(watchConfig(), null, 2) + '\n';
  try {
    state.sync = 'running'; renderSync();
    let sha; const cur = await fetch(url, { headers, cache: 'no-store' });
    if (cur.ok) { const j = await cur.json(); sha = j.sha; if (decodeURIComponent(escape(atob(j.content.replace(/\n/g, '')))) === body) { state.sync = 'ok'; state.syncAt = new Date(); state.syncError = ''; renderSync(); return; } }
    else if (cur.status !== 404) throw new Error(cur.status === 401 ? 'Schlüssel ungültig oder abgelaufen.' : cur.status === 403 ? 'Schlüssel hat keinen Zugriff auf das Repository.' : 'GitHub antwortet mit Fehler ' + cur.status + '.');
    const put = await fetch(url, { method: 'PUT', headers, body: JSON.stringify({ message: 'Beobachtungsliste aus der App', content: b64(body), sha }) });
    if (!put.ok) throw new Error(put.status === 403 || put.status === 404 ? 'Schlüssel darf nicht schreiben („Contents: Read and write“ fehlt).' : 'GitHub antwortet mit Fehler ' + put.status + '.');
    state.sync = 'ok'; state.syncAt = new Date(); state.syncError = ''; renderSync();
    pollAfterSync();
  } catch (e) { state.sync = 'error'; state.syncError = e.message === 'Failed to fetch' ? 'Keine Internetverbindung.' : e.message; renderSync(); }
}
// Nach einer Änderung läuft der Kursabruf auf GitHub an. Neue Kurse sind nach 1 bis 3 Minuten da.
let pollTimer = null;
function pollAfterSync() { clearTimeout(pollTimer); let n = 0; const before = state.meta?.ranAt; const tick = async () => { n++; await loadPrices(); if (state.meta?.ranAt && state.meta.ranAt !== before) { toast('Neue Kurse geladen'); return; } if (n < 8) pollTimer = setTimeout(tick, 30000); }; pollTimer = setTimeout(tick, 45000); }
function syncText() {
  const s = state.sync || (ghConf().token ? 'ok' : 'off');
  return { s, t: { off: 'Nicht verbunden', pending: 'Änderung wird gleich übertragen…', running: 'Übertrage…', ok: 'Verbunden' + (state.syncAt ? `, übertragen ${state.syncAt.toLocaleTimeString('de-AT', { timeStyle: 'short' })}` : ''), error: 'Fehler: ' + (state.syncError || '') }[s] };
}
function renderSync() { const el = $('syncState'); if (el) { const { s, t } = syncText(); el.textContent = t; el.className = 'small ' + (s === 'error' ? 'down' : s === 'ok' ? 'up' : 'muted'); } renderHeader(); }

// ---------- Sicherung ----------
function exportBackup() {
  const data = JSON.stringify({ app: 'swing-depot', version: 1, exportedAt: new Date().toISOString(), stocks: state.stocks, trades: state.trades, settings: state.settings }, null, 2);
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' })); a.download = `swing-depot-sicherung-${isoDate(new Date())}.json`; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  lsSet('swing-depot-lastbackup', isoDate(new Date())); render();
}
async function importBackup(file) {
  const j = JSON.parse(await file.text());
  if (j.app !== 'swing-depot' || !j.trades) throw new Error('Das ist keine Swing-Depot-Sicherung.');
  state.stocks = j.stocks || {}; state.trades = j.trades || {}; state.settings = { ...DEFAULT_SETTINGS, ...(j.settings || {}) };
  store.save(); render(); await loadPrices();
}
const daysSince = d => d ? Math.floor((Date.now() - new Date(d + 'T12:00:00Z').getTime()) / 864e5) : Infinity;

// ---------- Bausteine ----------
function sparkline(H, n = 60) {
  const c = H.c.slice(-n); const min = Math.min(...c), max = Math.max(...c); const w = 72, h = 24;
  const pts = c.map((v, i) => `${(i / (c.length - 1) * (w - 4) + 2).toFixed(1)},${(h - 3 - (v - min) / (max - min || 1) * (h - 6)).toFixed(1)}`).join(' ');
  const col = c[c.length - 1] >= c[0] ? '--buy' : '--no';
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="var(${col})" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
}
function lineChart(series, opts = {}) {
  const W = 600, Hh = opts.height || 180, padL = 54, padR = 10, padT = 10, padB = 24;
  const all = series.flatMap(s => s.values.filter(v => v != null)).concat((opts.hlines || []).map(h => h.y));
  let min = Math.min(...all), max = Math.max(...all); if (min === max) { min -= 1; max += 1; } const span = max - min; min -= span * 0.06; max += span * 0.06;
  const n = Math.max(...series.map(s => s.values.length));
  const X = i => padL + i / Math.max(1, n - 1) * (W - padL - padR), Y = v => padT + (1 - (v - min) / (max - min)) * (Hh - padT - padB);
  let grid = '';
  for (let k = 0; k <= 4; k++) { const v = min + (max - min) * k / 4; grid += `<line x1="${padL}" x2="${W - padR}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)" stroke-width="1"/><text x="${padL - 6}" y="${Y(v) + 4}" text-anchor="end" font-size="12" fill="var(--muted)" font-family="IBM Plex Mono, monospace">${fmtNum(v, v >= 1000 ? 0 : 2)}</text>`; }
  const labels = opts.dates ? [0, Math.floor((n - 1) / 2), n - 1].map(i => `<text x="${X(i)}" y="${Hh - 6}" text-anchor="${i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}" font-size="12" fill="var(--muted)">${fmtDate(opts.dates[i])}</text>`).join('') : '';
  const lines = series.map(s => { let d = ''; s.values.forEach((v, i) => { if (v == null) return; d += (d ? 'L' : 'M') + X(i).toFixed(1) + ',' + Y(v).toFixed(1); }); return `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.width || 1.5}" stroke-linejoin="round" ${s.dash ? `stroke-dasharray="${s.dash}"` : ''}/>`; }).join('');
  let area = '';
  if (opts.area && series[0]) { const s = series[0]; const pts = s.values.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`); area = `<path d="M${X(0)},${Y(min)}L${pts.join('L')}L${X(s.values.length - 1)},${Y(min)}Z" fill="${s.color}" opacity="0.08"/>`; }
  const hl = (opts.hlines || []).map(h => `<line x1="${padL}" x2="${W - padR}" y1="${Y(h.y)}" y2="${Y(h.y)}" stroke="${h.color}" stroke-width="1.4" stroke-dasharray="6 4"/><text x="${padL + 4}" y="${Y(h.y) - 5}" font-size="12" fill="${h.color}" font-weight="600">${esc(h.label)}</text>`).join('');
  const s0 = series[0]; const lastI = s0.values.length - 1;
  return `<svg viewBox="0 0 ${W} ${Hh}" role="img" aria-label="${esc(opts.label || 'Kursverlauf')}">${grid}${area}${lines}${hl}<circle cx="${X(lastI)}" cy="${Y(s0.values[lastI])}" r="4" fill="${s0.color}"/>${labels}</svg>`;
}
const pill = (signal, label) => `<span class="pill ${signal}">${esc(label || SIGNAL_LABEL[signal] || '')}</span>`;
const empty = (text, btn) => `<div class="empty"><p>${text}</p>${btn || ''}</div>`;
function stockRow(id, st) {
  if (isPending(st)) {
    const r = state.resolved[st.query];
    const sub = r?.error ? '<span class="down">Nicht gefunden. Antippen zum Prüfen.</span>' : ghConf().token ? '<span>Wird gesucht, Kurse folgen in ein paar Minuten</span>' : '<span>Wird beim nächsten Abendlauf gesucht</span>';
    return `<button type="button" class="card tap" data-open="${id}"><div class="stock"><div style="min-width:0"><div class="name">${esc(st.name || st.query)}</div><div class="sub">${sub}</div></div><div class="right"><span class="pill none">${r?.error ? 'Fehler' : 'Neu'}</span></div></div></button>`;
  }
  const H = historyOf(st);
  if (!H) {
    const err = state.meta?.errors?.some(x => x.startsWith((st.name || st.symbol) + ':'));
    return `<button type="button" class="card tap" data-open="${id}"><div class="stock"><div style="min-width:0"><div class="name">${esc(st.name)}</div><div class="sub">${err ? '<span class="down">Kurse konnten nicht geladen werden</span>' : '<span>Kurse folgen in ein paar Minuten</span>'}</div></div><div class="right"><span class="pill none">Kurse folgen</span></div></div></button>`;
  }
  const ev = evaluateStock(st);
  const c = H.c[H.c.length - 1], pc = H.c[H.c.length - 2]; const ch = (c / pc - 1) * 100;
  const why = inCur(st, () => ev.signal === 'kaufen' && ev.plan ? `Kaufen ab ${fmt(ev.plan.entry)}, Notbremse ${fmt(ev.plan.stop)}` : ev.reason);
  return `<button type="button" class="card tap ${ev.signal}" data-open="${id}"><div class="stock"><div style="min-width:0"><div class="name">${esc(st.name)}</div><div class="sub"><span class="num">${inCur(st, () => fmt(c))}</span><span class="num ${ch >= 0 ? 'up' : 'down'}">${fmtPct(ch)}</span></div></div><div class="right">${pill(ev.signal)}${sparkline(H)}</div><div class="why">${esc(why)}</div></div></button>`;
}

// ---------- Kopfzeile ----------
function renderHeader() {
  const d = state.meta;
  $('headerMeta').innerHTML = !state.loaded ? 'Lade…' : d?.date ? `Kurse vom ${fmtDate(d.date)}${state.sync === 'running' || state.sync === 'pending' ? '<br>überträgt…' : state.sync === 'error' ? '<br><span class="down">Übertragung fehlgeschlagen</span>' : ''}` : 'Noch keine Kurse';
}

// ---------- Heute ----------
function todoItems() {
  const items = [];
  const D = depot();
  for (const p of D.open) {
    const r = holdingRating(p); if (!r || r.hold) continue;
    items.push({ kind: r.signal, title: `${state.stocks[safeId(p.symbol)]?.name || p.name || p.symbol}: ${r.label}`, text: r.reason, act: `data-pos="${esc(p.symbol)}"` });
  }
  for (const [id, st] of Object.entries(state.stocks)) {
    if (isPending(st)) { if (state.resolved[st.query]?.error) items.push({ kind: 'nicht', title: `„${st.name || st.query}“ nicht gefunden`, text: 'Prüf die ISIN und trag die Aktie neu ein.', act: `data-open="${id}"` }); continue; }
    const ev = historyOf(st) ? evaluateStock(st) : null;
    if (ev?.signal === 'kaufen' && ev.plan) items.push({ kind: 'kaufen', title: `${st.name}: Kaufsignal`, text: inCur(st, () => `Kaufen ab ${fmt(ev.plan.entry)}, Notbremse ${fmt(ev.plan.stop)}, Ziel ${fmt(ev.plan.target)}.`), act: `data-open="${id}"` });
  }
  return { items, D };
}
function renderToday() {
  const v = $('view-today');
  if (!state.loaded) { v.innerHTML = empty('Lade…'); return; }
  const { items, D } = todoItems();
  $('todayDot').hidden = !items.length;
  const S = state.settings;
  const mUp = state.market ? marketFn(state.market.hist.d[state.market.hist.d.length - 1]) : null;
  const dax = state.market?.hist; const daxLast = dax ? dax.c[dax.c.length - 1] : null; const daxCh = dax ? (daxLast / dax.c[dax.c.length - 2] - 1) * 100 : null;
  const marketCard = `<div class="card ${mUp === false ? 'abwarten' : mUp ? 'kaufen' : ''}"><h3>Gesamtmarkt ${info('markt')}</h3>
    <p>${mUp == null ? 'Noch keine DAX-Kurse.' : mUp ? 'Der DAX steigt. Die Regel darf Kaufsignale geben.' : S.marketFilter === false ? 'Der DAX fällt. Der Marktfilter ist aus, die Regel gibt trotzdem Kaufsignale.' : 'Der DAX fällt. Die Regel gibt deshalb gerade keine Kaufsignale. Das schützt dein Geld.'}</p>
    ${dax ? `<p class="small muted">DAX ${fmtNum(daxLast, 0)} Punkte, <span class="${daxCh >= 0 ? 'up' : 'down'}">${fmtPct(daxCh)}</span> am ${fmtDate(dax.d[dax.d.length - 1])}</p>` : ''}</div>`;
  const todo = items.length
    ? `<div class="list">${items.map(it => `<button type="button" class="card tap ${it.kind === 'none' ? '' : it.kind}" ${it.act}><h3>${esc(it.title)}</h3><p class="small muted">${esc(it.text)}</p></button>`).join('')}</div>`
    : empty(Object.keys(state.stocks).length ? 'Heute ist nichts zu tun. Die Regel wartet auf einen guten Moment. Das ist normal, gute Gelegenheiten sind selten.' : 'Noch keine Aktien in deiner Liste.', Object.keys(state.stocks).length ? '' : '<button class="btn primary" type="button" data-act="add">Erste Aktie hinzufügen</button>');
  const hints = [];
  const lb = lsGet('swing-depot-lastbackup', null);
  if (Object.keys(state.trades).length && daysSince(lb) > 14) hints.push(`<div class="card accent"><h3>Sicherung machen</h3><p class="small">${lb ? `Letzte Sicherung vor ${daysSince(lb)} Tagen.` : 'Noch keine Sicherung.'} Deine Einträge liegen nur auf diesem Handy.</p><div class="row-btns"><button class="btn primary small" type="button" data-act="backup">Jetzt sichern</button></div></div>`);
  if (!ghConf().token) hints.push(`<div class="card accent"><h3>Mit GitHub verbinden</h3><p class="small">Damit neue Aktien automatisch Kurse bekommen und du Push-Nachrichten zu deinem Depot erhältst.</p><div class="row-btns"><button class="btn primary small" type="button" data-act="github">Einrichten</button></div></div>`);
  const pl = D.unreal + D.realized;
  const depotCard = D.open.length || Object.keys(state.trades).length ? `<button type="button" class="card tap" data-tab="depot"><h3>Dein Depot</h3><div class="stats"><div><span class="k">Wert</span><span class="v">${fmt(D.value)}</span></div><div><span class="k">Gewinn/Verlust gesamt</span><span class="v ${pl >= 0 ? 'up' : 'down'}">${fmtSigned(pl)}</span></div></div><p class="small muted">${D.open.length} offene Position${D.open.length === 1 ? '' : 'en'}</p></button>` : '';
  const ran = state.meta?.ranAt ? new Date(state.meta.ranAt).toLocaleString('de-AT', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : null;
  v.innerHTML = `
    <div class="section-head"><h2>Zu tun</h2></div>
    ${todo}
    ${marketCard}
    ${depotCard}
    ${hints.join('')}
    <p class="small muted" style="text-align:center">${ran ? `Zuletzt aktualisiert: ${ran}. ` : ''}Neue Kurse kommen werktags gegen 18:10 Uhr.</p>`;
}

// ---------- Liste ----------
function renderList() {
  const v = $('view-list');
  const items = Object.entries(state.stocks).map(([id, st]) => ({ id, st, ev: !isPending(st) && historyOf(st) ? evaluateStock(st) : null }));
  const order = { kaufen: 0, abwarten: 1, nicht: 2 };
  items.sort((a, b) => (order[a.ev?.signal] ?? -1) - (order[b.ev?.signal] ?? -1) || (a.st.name || a.st.query || '').localeCompare(b.st.name || b.st.query || ''));
  const counts = { alle: items.length, kaufen: 0, abwarten: 0, nicht: 0 }; items.forEach(x => x.ev && counts[x.ev.signal]++);
  const shown = items.filter(x => state.filter === 'alle' || x.ev?.signal === state.filter);
  v.innerHTML = `
    <div class="section-head"><h2>Beobachtungsliste</h2><button class="btn primary small" type="button" data-act="add">+ Aktie</button></div>
    ${items.length ? `<div class="chips" role="group" aria-label="Filter">${['alle', 'kaufen', 'abwarten', 'nicht'].map(f => `<button type="button" class="chip" data-filter="${f}" aria-pressed="${state.filter === f}">${f === 'alle' ? 'Alle' : SIGNAL_LABEL[f]} ${counts[f]}</button>`).join('')}</div>` : ''}
    <div class="list">${!items.length ? empty('Deine Liste ist leer. Füge Aktien hinzu, die du beobachten willst. Die App sagt dir dann jeden Abend: kaufen, abwarten oder nicht kaufen.', '<button class="btn primary" type="button" data-act="add">Aktie hinzufügen</button>') : shown.map(x => stockRow(x.id, x.st)).join('') || `<p class="muted small">Keine Aktie mit dieser Bewertung.</p>`}</div>`;
}

// ---------- Depot ----------
function depotHistory(trades, days = 120) {
  const syms = [...new Set(trades.map(t => t.symbol))];
  const hists = {}; syms.forEach(s => { const st = state.stocks[safeId(s)]; hists[s] = currencyOf(st) === 'EUR' ? historyOf(st) : null; });
  const ref = Object.values(hists).find(h => h); if (!ref) return [];
  const dates = ref.d.slice(-days);
  const sortedT = [...trades].sort((a, b) => (a.date + (a.created || '')).localeCompare(b.date + (b.created || '')));
  return dates.map(d => {
    let val = 0;
    for (const s of syms) {
      const H = hists[s]; if (!H) continue;
      let q = 0; sortedT.filter(t => t.symbol === s && t.date <= d).forEach(t => { q = t.side === 'adjust' ? t.qty : q + (t.side === 'buy' ? t.qty : -t.qty); });
      if (q <= 0) continue;
      let idx = H.d.length - 1; while (idx > 0 && H.d[idx] > d) idx--;
      val += q * H.c[idx];
    }
    return { d, v: val };
  });
}
function renderDepot() {
  const v = $('view-depot');
  const trades = tradeList(); const D = depot();
  let hist = depotHistory(trades);
  const firstNz = hist.findIndex(h => h.v > 0); if (firstNz > 0) hist = hist.slice(firstNz - 1);
  const chart = hist.length > 1 && hist.some(h => h.v > 0) ? `<div class="card"><h3>Depotwert, letzte Monate</h3><div class="chart-wrap">${lineChart([{ values: hist.map(h => h.v), color: 'var(--accent)', width: 2 }], { dates: hist.map(h => h.d), area: true, height: 170, label: 'Depotwert' })}</div></div>` : '';
  const positions = D.open.map(p => {
    const st = state.stocks[safeId(p.symbol)]; const rate = holdingRating(p);
    const pct = p.unreal != null ? p.unreal / p.cost * 100 : null;
    const kind = rate ? (rate.signal === 'none' ? '' : rate.signal) : '';
    return `<button type="button" class="card tap ${kind}" data-pos="${esc(p.symbol)}"><div class="stock"><div style="min-width:0"><div class="name">${esc(st?.name || p.name || p.symbol)}</div><div class="sub"><span class="num">${fmtQty(p.qty)} Stk.</span><span class="num">jetzt ${p.price != null ? fmt(p.price) : '–'}${p.priceSource === 'tr' ? ' (TR)' : ''}</span></div></div><div class="right"><span class="num ${p.unreal >= 0 ? 'up' : 'down'}">${fmtSigned(p.unreal)}</span><span class="num small ${p.unreal >= 0 ? 'up' : 'down'}">${fmtPct(pct)}</span></div><div class="why">${rate ? `<b>${esc(rate.label)}.</b> ${esc(rate.reason)}` : p.price == null ? 'Kein Euro-Kurs. Tippen und den Kurs aus Trade Republic abgleichen.' : ''}</div></div></button>`;
  }).join('');
  const sorted = trades.sort((a, b) => (b.date + (b.created || '')).localeCompare(a.date + (a.created || '')));
  const kind = t => t.side === 'buy' ? 'Kauf' : t.side === 'sell' ? 'Verkauf' : 'Abgleich';
  v.innerHTML = `
    <div class="section-head"><h2>Depot</h2><button class="btn primary small" type="button" data-act="trade">+ Kauf/Verkauf</button></div>
    <div class="stats">
      <div class="big"><span class="k">Depotwert</span><span class="v">${fmt(D.value)}</span></div>
      <div><span class="k">Gewinn/Verlust offen</span><span class="v ${D.unreal >= 0 ? 'up' : 'down'}">${fmtSigned(D.unreal)}</span></div>
      <div><span class="k">Gewinn/Verlust verkauft</span><span class="v ${D.realized >= 0 ? 'up' : 'down'}">${fmtSigned(D.realized)}</span></div>
      <div><span class="k">Einstand ${info('einstand')}</span><span class="v">${fmt(D.cost)}</span></div>
      <div><span class="k">Gebühren bisher</span><span class="v">${fmt(D.fees)}</span></div>
    </div>
    ${chart}
    <div class="section-head"><h2>Offene Positionen</h2></div>
    <div class="list">${positions || empty('Keine offenen Positionen. Trag deinen ersten Kauf ein, sobald du bei Trade Republic gekauft hast.', '<button class="btn primary" type="button" data-act="trade">Kauf eintragen</button>')}</div>
    ${sorted.length ? `<details class="card"><summary>Alle Einträge (${sorted.length})</summary><div class="scroll"><table class="t"><thead><tr><th>Datum</th><th>Aktie</th><th class="r">Stück</th><th class="r">Kurs</th><th></th></tr></thead><tbody>${sorted.map(t => `<tr><td class="num">${fmtDate(t.date)}<br><span class="small muted">${kind(t)}</span></td><td>${esc(t.name || t.symbol)}${t.note ? `<br><span class="small muted">${esc(t.note)}</span>` : ''}</td><td class="r num">${fmtQty(t.qty)}</td><td class="r num">${fmt(t.price)}</td><td class="r"><button class="btn small" type="button" data-edittrade="${t.id}">Ändern</button></td></tr>`).join('')}</tbody></table></div></details>` : ''}
    <p class="small muted">Gewinn/Verlust ist schon nach der Verkaufsgebühr gerechnet. Weichen die Werte von Trade Republic ab: Position antippen und abgleichen.</p>`;
}

// ---------- Papier-Modus ----------
const paperCache = {};
function paperStartDate() {
  if (state.paperRange === 'start') return state.settings.paperStart || DEFAULT_SETTINGS.paperStart;
  const d = new Date(); d.setMonth(d.getMonth() - parseInt(state.paperRange, 10)); return isoDate(d);
}
function renderPaper() {
  const v = $('view-paper');
  const start = paperStartDate(); const S = state.settings;
  const all = [];
  for (const st of Object.values(state.stocks)) {
    const H = historyOf(st); if (!H || H.c.length < 202 || currencyOf(st) !== 'EUR') continue;
    const key = [st.symbol, H.d[H.d.length - 1], H.c.length, start, state.paperFee, JSON.stringify(S), state.market?.hist?.d?.length].join('|');
    if (!paperCache[key]) paperCache[key] = simulatePaper(H, S, start, { ignoreFeeFilter: state.paperFee === 'off', market: S.marketFilter !== false && state.market ? marketFn : undefined });
    paperCache[key].forEach(t => all.push({ ...t, symbol: st.symbol, name: st.name }));
  }
  const sum = paperSummary(all);
  all.sort((a, b) => (b.entryDate || b.signalDate).localeCompare(a.entryDate || a.signalDate));
  const stLabel = { gewonnen: pill('kaufen', 'Gewinn'), verloren: pill('nicht', 'Verlust'), offen: pill('abwarten', 'offen'), wartet: pill('none', 'wartet') };
  const ranges = [['start', 'Ab Start'], ['3', '3 Monate'], ['6', '6 Monate'], ['12', '12 Monate']];
  v.innerHTML = `
    <div class="section-head"><h2>Papier-Modus ${info('papier')}</h2></div>
    <p class="small muted">Spielgeld-Test: Was wäre, wenn du jedes Kaufsignal der Regel gekauft hättest? So siehst du, ob die Regel etwas taugt, bevor du echtes Geld einsetzt.</p>
    <div class="chips" role="group" aria-label="Zeitraum">${ranges.map(([k, l]) => `<button type="button" class="chip" data-range="${k}" aria-pressed="${state.paperRange === k}">${l}</button>`).join('')}</div>
    <div class="stats">
      <div class="big"><span class="k">Ergebnis nach Gebühren (abgeschlossen)</span><span class="v ${sum.sum >= 0 ? 'up' : 'down'}">${fmtSigned(sum.sum)}</span></div>
      <div><span class="k">Schein-Trades</span><span class="v">${sum.closed}</span></div>
      <div><span class="k">Treffer</span><span class="v">${sum.hitRate == null ? '–' : fmtNum(sum.hitRate, 0) + ' %'}</span></div>
      <div><span class="k">Gewonnen / verloren</span><span class="v">${sum.won} / ${sum.lost}</span></div>
      <div><span class="k">Gerade offen</span><span class="v ${sum.openPl >= 0 ? 'up' : 'down'}">${sum.open ? fmtSigned(sum.openPl) : '–'}</span></div>
    </div>
    <label class="field check"><input type="checkbox" id="paperFeeOff" ${state.paperFee === 'off' ? 'checked' : ''}> Gebühren-Check ignorieren (zeigt alle Signale)</label>
    <div class="list">${all.length ? all.map(t => `<div class="card"><div class="stock"><div style="min-width:0"><div class="name">${esc(t.name)}</div><div class="sub"><span>${t.entryDate ? `gekauft ${fmtDate(t.entryDate)} zu ${fmt(t.entryFill)}` : `wartet auf ${fmt(t.entry)}`}</span>${t.exitDate ? `<span>verkauft ${fmtDate(t.exitDate)} zu ${fmt(t.exit)}</span>` : ''}</div></div><div class="right">${stLabel[t.status]}${t.pl != null ? `<span class="num ${t.pl >= 0 ? 'up' : 'down'}">${fmtSigned(t.pl)}</span>` : ''}</div>${t.why ? `<div class="why">${esc(t.why)}</div>` : ''}</div></div>`).join('') : empty(state.paperRange === 'start' ? `Noch keine Schein-Trades seit ${fmtDate(start)}. Sobald die Regel „kaufen“ sagt, kauft der Papier-Modus mit. Schau dir solange einen Rückblick an (3, 6 oder 12 Monate).` : 'Die Regel hätte in diesem Zeitraum nichts gekauft. Mit „Gebühren-Check ignorieren“ siehst du alle Signale.')}</div>
    <p class="small muted">Ab ${fmtDate(start)}. Ändern sich die Regeln, wird neu gerechnet.</p>`;
}

// ---------- Mehr ----------
function renderMore() {
  const v = $('view-more');
  if (document.activeElement && v.contains(document.activeElement) && document.activeElement.matches('input,select')) return; // nicht beim Tippen neu zeichnen
  const S = state.settings; const rs = RULESETS[S.ruleset] || RULESETS.A;
  const g = ghConf(); const lb = lsGet('swing-depot-lastbackup', null);
  const tokenSteps = `<ol class="steps small">
      <li>Tippe auf <a href="https://github.com/settings/personal-access-tokens/new?name=Swing-Depot&amp;description=Beobachtungsliste%20aus%20der%20App&amp;expires_in=365&amp;contents=write" target="_blank" rel="noopener">Schlüssel bei GitHub anlegen</a> und melde dich an, falls GitHub fragt.</li>
      <li>Bei <b>Repository access</b>: „Only select repositories“ und <b>Trading</b> wählen.</li>
      <li>Bei <b>Permissions</b> muss „Contents“ auf „Read and write“ stehen.</li>
      <li>Ganz unten <b>Generate token</b> tippen, dann den Schlüssel (beginnt mit github_pat_) kopieren.</li>
      <li>Hier einfügen und „Speichern“ tippen.</li></ol>`;
  v.innerHTML = `
    <div class="section-head"><h2>Regel</h2></div>
    <div class="card"><h3>${esc(rs.name.replace(' (Platzhalter)', ''))}</h3><p>${esc(rs.short)}</p>
      <details><summary class="small">Alle Schritte der Regel</summary><ul class="steps small">${rs.text.map(t => `<li>${esc(t)}</li>`).join('')}</ul></details>
      <p class="small muted">Noch eine vorläufige Regel. Im Rückblick hat sie bei 50 € Einsatz kaum Gewinn gebracht. Nutze den Papier-Modus, bevor du echtes Geld einsetzt.</p></div>

    <div class="section-head"><h2>Einstellungen</h2></div>
    <form class="card f" id="settingsForm">
      <label><span class="lab">Einsatz pro Trade (€)</span><input id="setStake" type="number" step="1" min="1" inputmode="decimal" value="${S.stake}"></label>
      <label><span class="lab">Höchstens verlieren (€)</span><input id="setMaxLoss" type="number" step="0.5" min="0" inputmode="decimal" value="${S.maxLoss}"></label>
      <label><span class="lab">Gebühr pro Order (€)</span><input id="setFee" type="number" step="0.01" min="0" inputmode="decimal" value="${S.fee}"></label>
      <label><span class="lab">Gewinn mind. × Verlust ${info('crv')}</span><input id="setMinCrv" type="number" step="0.1" min="0.5" inputmode="decimal" value="${S.minCrv}"></label>
      <label class="full">Einstieg<select id="setTiming"><option value="3" ${S.timingMin !== 2 ? 'selected' : ''}>Streng: alle 3 Einstiegs-Bedingungen</option><option value="2" ${S.timingMin === 2 ? 'selected' : ''}>Locker: 2 von 3 reichen</option></select></label>
      <label class="full check"><input type="checkbox" id="setMarket" ${S.marketFilter !== false ? 'checked' : ''}> Marktfilter: keine Kaufsignale, wenn der DAX fällt</label>
      <label class="full check"><input type="checkbox" id="setFrac" ${S.fractional ? 'checked' : ''}> Bruchstücke kaufen (z. B. 0,25 Aktien)</label>
      <div class="full"><button class="btn primary block" type="submit">Einstellungen speichern</button></div>
    </form>

    <div class="section-head"><h2>Daten</h2></div>
    <div class="card"><h3>Sicherung</h3>
      <p class="small">Depot und Liste liegen nur auf diesem Handy. Speichere ab und zu eine Sicherungsdatei, z. B. nach jedem Trade. ${lb ? `Letzte Sicherung: ${fmtDate(lb)}.` : 'Noch keine Sicherung.'}</p>
      <div class="row-btns"><button class="btn primary" type="button" data-act="backup">Sicherung speichern</button><button class="btn" type="button" data-act="restore">Sicherung laden</button></div>
      <input type="file" id="restoreFile" accept="application/json,.json" hidden></div>
    <div class="card" id="ghCard"><h3>Verbindung zu GitHub</h3>
      <p class="small">Damit neue Aktien automatisch Kurse bekommen und Alarme zu deinem Depot per Push kommen.</p>
      <p id="syncState" class="small"></p>
      <form class="f" id="ghForm">
        <label class="full">Zugangsschlüssel<input id="ghToken" type="password" autocomplete="off" placeholder="github_pat_…" value="${g.token ? '••••••••' + esc(g.token.slice(-4)) : ''}"></label>
        <div class="full row-btns"><button class="btn primary" type="submit">Speichern</button>${g.token ? '<button class="btn danger" type="button" data-act="ghremove">Schlüssel entfernen</button>' : ''}</div>
        <details class="full"><summary class="small">Name und Repository ändern</summary>
          <div class="f" style="margin-top:10px"><label>GitHub-Name<input id="ghOwner" autocapitalize="off" autocomplete="off" spellcheck="false" value="${esc(g.owner)}"></label><label>Repository<input id="ghRepo" autocapitalize="off" autocomplete="off" spellcheck="false" value="${esc(g.repo)}"></label></div></details>
      </form>
      <details ${g.token ? '' : 'open'}><summary class="small">So bekommst du den Schlüssel</summary>${tokenSteps}</details></div>
    <div class="card"><h3>Kurse und Push-Nachrichten</h3>
      <p class="small">Jeden Werktag gegen 18:10 Uhr holt GitHub die Schlusskurse (Quelle: Yahoo Finance), rechnet die Regel und schickt über die App „ntfy“ eine Nachricht bei einem neuen Kaufsignal oder wenn eine Position Notbremse oder Ziel erreicht.</p>
      <p class="small muted">${state.meta?.ranAt ? `Letzter Lauf: ${new Date(state.meta.ranAt).toLocaleString('de-AT', { dateStyle: 'short', timeStyle: 'short' })}.` : 'Noch kein Lauf.'}${state.meta?.errors?.length ? ` Probleme: ${esc(state.meta.errors.join('; '))}` : ''}</p>
      <div class="row-btns"><button class="btn" type="button" data-act="reload">Kurse neu laden</button></div></div>

    <div class="section-head"><h2>Hilfe</h2></div>
    <div class="card"><details><summary>Begriffe einfach erklärt</summary><div class="list small" style="margin-top:10px">${Object.values(TERMS).map(([t, d]) => `<p><b>${esc(t)}:</b> ${esc(d)}</p>`).join('')}</div></details></div>
    <div class="row-btns"><button class="btn" type="button" data-act="intro">Einführung nochmal zeigen</button></div>
    <p class="small muted">Swing-Depot ist eine Rechenhilfe, keine Anlageberatung. Kaufen und verkaufen musst du selbst bei Trade Republic.</p>`;
  renderSync();
}

function render() {
  renderHeader();
  if (!state.loaded) { renderToday(); return; }
  renderToday(); renderList(); renderDepot(); renderMore();
  if (state.tab === 'paper') renderPaper();
  if (sheetMode === 'stock' && openId && !$('sheet').hidden) renderStockSheet(openId, true);
}

// ---------- Vollbild-Seiten ----------
let openId = null, sheetMode = null;
function openSheet(title, html, mode) { sheetMode = mode; $('sheetTitle').textContent = title; $('sheetBody').innerHTML = html; if ($('sheet').hidden) { $('sheet').hidden = false; document.body.style.overflow = 'hidden'; history.pushState({ sheet: 1 }, ''); } }
function closeSheet(fromHistory) { if ($('sheet').hidden) return; $('sheet').hidden = true; openId = null; sheetMode = null; document.body.style.overflow = ''; if (!fromHistory && history.state?.sheet) history.back(); }
window.addEventListener('popstate', () => { if (!$('overlay').hidden) closeOverlay(); if (!$('sheet').hidden) closeSheet(true); });

function renderStockSheet(id, keepScroll) {
  const st = state.stocks[id]; if (!st) { closeSheet(); return; }
  openId = id; const scroll = $('sheet').scrollTop;
  if (isPending(st)) {
    const r = state.resolved[st.query];
    openSheet(st.name || st.query, `
      <div class="verdict ${r?.error ? 'nicht' : 'none'}"><span class="head">${r?.error ? 'Nicht gefunden' : 'Wird gesucht'}</span><span>${r?.error ? `Zu „${esc(st.query)}“ wurde keine Aktie gefunden. Prüf die ISIN in Trade Republic und trag sie neu ein.` : `Gesucht wird nach „${esc(st.query)}“. ${ghConf().token ? 'In ein paar Minuten sind Name und Kurse da.' : 'Das passiert beim nächsten Abendlauf, oder sofort, wenn du unter „Mehr“ GitHub verbindest.'}`}</span></div>
      ${removeBtn(id)}`, 'stock');
    return;
  }
  const H = historyOf(st);
  if (!H) { openSheet(st.name, `<p class="small muted num">${esc(st.symbol)}</p>${empty(ghConf().token ? 'Die Kurse kommen in ein paar Minuten.' : 'Die Kurse kommen mit dem nächsten Abendlauf.')}${priceSourceCard(id)}${removeBtn(id)}`, 'stock'); return; }
  const ev = evaluateStock(st);
  const cur = currencyOf(st);
  const html = inCur(st, () => {
    const n = Math.min(120, H.c.length); const sl = a => a.slice(-n);
    const ind = ev.ind; const i = H.c.length - 1; const p = ev.plan;
    const hl = p && !p.preview ? [{ y: p.target, color: 'var(--buy)', label: 'Ziel' }, { y: p.entry, color: 'var(--accent)', label: 'Kaufen ab' }, { y: p.stop, color: 'var(--no)', label: 'Notbremse' }] : [];
    const series = [{ values: sl(H.c), color: 'var(--chart-close)', width: 1.8 }];
    if (state.showAvg) series.push({ values: sl(ind.sma20), color: 'var(--chart-20)', width: 1.2 }, { values: sl(ind.sma50), color: 'var(--chart-50)', width: 1.2 }, { values: sl(ind.sma200), color: 'var(--chart-200)', width: 1.2, dash: '4 3' });
    const chart = lineChart(series, { dates: sl(H.d), hlines: hl, height: 220, label: `Kursverlauf ${st.name}` });
    const planHtml = p ? `<div class="card"><h3>${p.preview ? 'So sähe der Plan aus' : 'Dein Plan'}</h3>
      ${p.preview ? '<p class="small muted">Noch kein Kaufsignal. Die Zahlen zeigen nur, wie es aussehen würde.</p>' : ''}
      <div class="plan">
        <div><span class="k">Kaufen ab ${info('entry')}</span><span class="v">${fmt(p.entry)}</span></div>
        <div><span class="k">Notbremse ${info('stop')}</span><span class="v">${fmt(p.stop)}</span><span class="s">${fmtPct(p.stopPct)}</span></div>
        <div><span class="k">Ziel ${info('ziel')}</span><span class="v">${fmt(p.target)}</span><span class="s">${fmtPct(p.targetPct)}</span></div>
      </div>
      <p class="small">${fmtQty(p.shares)} Stück für ${fmt(p.invest)}. Am Ziel <b class="up">${fmtSigned(p.gainNet)}</b>, an der Notbremse <b class="down">${fmtSigned(-p.lossNet)}</b>, beides nach Gebühren.</p>
      <details><summary class="small">Mehr Zahlen</summary><div class="plan" style="margin-top:8px">
        <div><span class="k">Gewinn : Verlust ${info('crv')}</span><span class="v">${fmtNum(p.crvNet, 1)}×</span><span class="s">ohne Gebühren ${fmtNum(p.crvGross, 1)}×</span></div>
        <div><span class="k">Im Plus ab ${info('breakeven')}</span><span class="v">${fmt(p.breakEven)}</span></div>
        <div><span class="k">Tagesschwankung ${info('atr')}</span><span class="v">${fmt(ind.atr14[i])}</span></div></div></details>
      ${!p.preview ? `<details><summary class="small">So kaufst du bei Trade Republic</summary><ol class="steps small"><li>Aktie öffnen, „Kaufen“, dann Ordertyp <b>Stop</b> wählen.</li><li>Stop-Kurs ${fmt(p.entry)}, Betrag ${fmt(p.invest)} (oder ${fmtQty(p.shares)} Stück).</li><li>Wird gekauft: sofort eine Stop-Order <b>Verkauf</b> bei ${fmt(p.stop)} anlegen (Notbremse).</li><li>Hier „Kauf eintragen“ tippen.</li></ol></details>
        <button class="btn primary block" type="button" data-buyplan="${id}">Kauf eintragen</button>` : ''}</div>` : '';
    return `
      <p class="small muted"><span class="num">${esc(st.symbol)}</span>${st.isin ? ` · ISIN ${esc(st.isin)}` : ''} · Schluss ${fmtDate(H.d[i])}: <span class="num">${fmt(H.c[i])}</span>${cur !== 'EUR' ? ` · Kurse in ${esc(cur)}, Trade Republic zeigt Euro` : ''}</p>
      <div class="verdict ${ev.signal}"><span class="head">${SIGNAL_LABEL[ev.signal]}</span><span>${esc(ev.reason)}</span>${ev.condition ? `<span class="small">${esc(ev.condition)}</span>` : ''}</div>
      ${planHtml}
      <div class="card"><h3>Kurs, letzte ${n} Handelstage</h3><div class="chart-wrap">${chart}</div>
        <label class="field check small"><input type="checkbox" id="avgToggle" ${state.showAvg ? 'checked' : ''}> Durchschnittslinien zeigen ${info('gd')}</label>
        ${state.showAvg ? `<div class="legend"><span><i style="background:var(--chart-close)"></i>Kurs</span><span><i style="background:var(--chart-20)"></i>20 Tage</span><span><i style="background:var(--chart-50)"></i>50 Tage</span><span><i style="background:var(--chart-200)"></i>200 Tage</span></div>` : ''}</div>
      ${ev.checks.length ? `<div class="card"><h3>Warum?</h3><ul class="checks">${ev.checks.map(c => `<li><span class="${c.ok === true ? 'ok' : c.ok === false ? 'bad' : 'na'}">${c.ok === true ? '✓' : c.ok === false ? '✗' : '–'}</span><span>${esc(c.label)} ${c.term ? info(c.term) : ''}<br><span class="small muted">${esc(c.value)}</span></span></li>`).join('')}</ul></div>` : ''}`;
  });
  openSheet(st.name, html + priceSourceCard(id) + removeBtn(id), 'stock');
  $('sheet').scrollTop = keepScroll ? scroll : 0;
}
function priceSourceCard(id) {
  return `<details class="card"><summary>Kurse von Hand eintragen</summary>
    <p class="small muted">Normalerweise nicht nötig. Für Aktien, die Yahoo Finance nicht kennt: CSV-Datei laden (Spalten Date, Open, High, Low, Close) oder einen Tageskurs eintragen.</p>
    <input type="file" accept=".csv,text/csv,text/plain" data-csv="${id}" aria-label="CSV-Datei wählen">
    <form class="f" data-manual="${id}">
      <label>Datum<input name="d" type="date" value="${isoDate(lastTradingDay(new Date()))}"></label>
      <label>Schlusskurs<input name="c" type="text" inputmode="decimal" required></label>
      <label>Tageshoch<input name="h" type="text" inputmode="decimal" placeholder="optional"></label>
      <label>Tagestief<input name="l" type="text" inputmode="decimal" placeholder="optional"></label>
      <div class="full"><button class="btn" type="submit">Tageskurs speichern</button></div>
    </form></details>`;
}
const removeBtn = id => `<button class="btn danger block" type="button" data-remove="${id}">Aus der Liste entfernen</button>`;

function positionSheet(symbol) {
  const p = depot().open.find(x => x.symbol === symbol); if (!p) { closeSheet(); return; }
  const st = state.stocks[safeId(symbol)]; const rate = holdingRating(p);
  openSheet(st?.name || p.name || symbol, `
    ${rate ? `<div class="verdict ${rate.signal}"><span class="head">${esc(rate.label)}</span><span>${esc(rate.reason)}</span></div>` : ''}
    <div class="stats">
      <div><span class="k">Stück</span><span class="v">${fmtQty(p.qty)}</span></div>
      <div><span class="k">Gekauft im Schnitt</span><span class="v">${fmt(p.avgPrice)}</span></div>
      <div><span class="k">Kurs ${p.priceSource === 'tr' ? 'laut TR' : 'Xetra'}</span><span class="v">${p.price != null ? fmt(p.price) : '–'}</span></div>
      <div><span class="k">Wert</span><span class="v">${p.value != null ? fmt(p.value) : '–'}</span></div>
      <div><span class="k">Einstand ${info('einstand')}</span><span class="v">${fmt(p.cost)}</span></div>
      <div><span class="k">Gewinn/Verlust</span><span class="v ${p.unreal >= 0 ? 'up' : 'down'}">${fmtSigned(p.unreal)}</span></div>
    </div>
    <div class="row-btns"><button class="btn primary" type="button" data-sell="${esc(symbol)}">Verkauf eintragen</button>${st ? `<button class="btn" type="button" data-open="${safeId(symbol)}">Chart und Bewertung</button>` : ''}</div>
    <div class="card"><h3>Mit Trade Republic abgleichen ${info('abgleich')}</h3>
      <p class="small muted">Trag die Werte aus deiner Trade-Republic-App ein. Leere Felder bleiben, wie sie sind.</p>
      <form class="f" id="adjustForm" data-symbol="${esc(symbol)}">
        <label>Stückzahl<input id="adjQty" type="text" inputmode="decimal" placeholder="${fmtQty(p.qty)}"></label>
        <label>Durchschnittskurs (€)<input id="adjAvg" type="text" inputmode="decimal" placeholder="${fmtNum(p.avgPrice, 2)}"></label>
        <label>Kurs jetzt (€)<input id="adjPrice" type="text" inputmode="decimal" placeholder="${p.price != null ? fmtNum(p.price, 2) : ''}"></label>
        <label>Notbremse (€)<input id="adjStop" type="text" inputmode="decimal" placeholder="${rate ? fmtNum(rate.stop, 2) : ''}"></label>
        <label class="full check small"><input id="adjFeeIncl" type="checkbox"> Kaufgebühr zum Durchschnittskurs dazurechnen (nur wenn TR ihn ohne Gebühr zeigt)</label>
        <div class="full"><button class="btn primary block" type="submit">Abgleich speichern</button></div>
      </form></div>`, 'position');
  $('sheet').scrollTop = 0;
}

function addStockSheet() {
  openSheet('Aktie hinzufügen', `
    <form class="card f" id="addForm">
      <label class="full">ISIN, Name oder Kürzel<input id="addQuery" required autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="z. B. DE0007164600 oder SAP"></label>
      <label class="full">Anzeigename (optional)<input id="addName" autocomplete="off" placeholder="z. B. SAP"></label>
      <div class="full"><button class="btn primary block" type="submit">Hinzufügen</button></div>
      <p class="full small muted" id="addHint">Am sichersten ist die ISIN ${info('isin')}. Die App sucht damit automatisch die passende Aktie an der deutschen Börse.</p>
    </form>
    <div class="card"><h3>Wo finde ich die ISIN?</h3>
      <ol class="steps small"><li>In Trade Republic die Aktie öffnen.</li><li>Ganz nach unten scrollen. Bei den Infos zur Aktie steht die ISIN (12 Zeichen, z. B. DE0007164600).</li><li>Abschreiben oder kopieren und oben einfügen.</li></ol>
      <a class="btn" id="addSearchLink" href="https://finance.yahoo.com/lookup" target="_blank" rel="noopener">Im Internet suchen ↗</a>
      <p class="small muted">Der Link öffnet die Suche von Yahoo Finance. Dort stehen auch die Kürzel (z. B. SAP.DE für Xetra).</p></div>`, 'add');
  $('sheet').scrollTop = 0;
  setTimeout(() => $('addQuery')?.focus(), 50);
}
function tradeSheet(prefill = {}, editId = null) {
  const stocks = Object.values(state.stocks).filter(s => s.symbol).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  if (!stocks.length) { toast('Zuerst eine Aktie zur Liste hinzufügen.'); return; }
  const opts = stocks.map(s => `<option value="${esc(s.symbol)}" ${s.symbol === prefill.symbol ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
  const isAdj = prefill.side === 'adjust'; const v = x => x == null ? '' : String(x).replace('.', ',');
  openSheet(editId ? 'Eintrag ändern' : prefill.side === 'sell' ? 'Verkauf eintragen' : 'Kauf eintragen', `<form class="card f" id="tradeForm" data-edit="${editId || ''}">
    <label class="full">Aktie<select id="trSym">${opts}</select></label>
    <label>Art<select id="trSide"><option value="buy" ${prefill.side === 'buy' || !prefill.side ? 'selected' : ''}>Kauf</option><option value="sell" ${prefill.side === 'sell' ? 'selected' : ''}>Verkauf</option>${isAdj ? '<option value="adjust" selected>Abgleich</option>' : ''}</select></label>
    <label>Datum<input id="trDate" type="date" required value="${prefill.date || isoDate(new Date())}"></label>
    <label>Kurs pro Stück (€)<input id="trPrice" type="text" inputmode="decimal" required value="${v(prefill.price)}"></label>
    <label>Betrag (€)<input id="trAmount" type="text" inputmode="decimal" placeholder="z. B. 50"></label>
    <label>Stückzahl<input id="trQty" type="text" inputmode="decimal" required value="${v(prefill.qty)}"></label>
    <label>Gebühr (€)<input id="trFee" type="text" inputmode="decimal" value="${v(prefill.fee ?? (isAdj ? 0 : state.settings.fee))}"></label>
    <p class="full small muted" style="margin-top:-4px">Bruchstücke sind erlaubt. Tipp: Kurs und Betrag eintragen, die Stückzahl rechnet die App aus. Am genauesten sind die Werte aus der Trade-Republic-Abrechnung.</p>
    <details class="full"><summary class="small">Notbremse, Ziel, Notiz</summary><div class="f" style="margin-top:10px">
      <label>Notbremse (€)<input id="trStop" type="text" inputmode="decimal" value="${v(prefill.stop)}"></label>
      <label>Ziel (€)<input id="trTarget" type="text" inputmode="decimal" value="${v(prefill.target)}"></label>
      <label class="full">Notiz<input id="trNote" placeholder="z. B. nach Regel A" value="${esc(prefill.note || '')}"></label></div></details>
    <div class="full"><button class="btn primary block" type="submit">Speichern</button></div>
    ${editId ? `<div class="full"><button class="btn danger block" type="button" data-deltrade="${editId}">Eintrag löschen</button></div>` : ''}</form>`, 'trade');
  $('sheet').scrollTop = 0;
}

// ---------- Hinweisfenster und Einführung ----------
function openOverlay(html) { $('overlayBox').innerHTML = html; if ($('overlay').hidden) { $('overlay').hidden = false; history.pushState({ overlay: 1 }, ''); } $('overlayBox').querySelector('button')?.focus(); }
function closeOverlay(fromUser) { if ($('overlay').hidden) return; $('overlay').hidden = true; if (fromUser && history.state?.overlay) history.back(); }
function showInfo(k) { const [t, d] = TERMS[k]; openOverlay(`<h3>${esc(t)}</h3><p>${esc(d)}</p><button class="btn primary block" type="button" data-act="closeoverlay">Verstanden</button>`); }
const INTRO = [
  ['Willkommen bei Swing-Depot', 'Deine Rechenhilfe für Swingtrading mit kleinen Beträgen bei Trade Republic. Gekauft und verkauft wird weiter bei Trade Republic, die App sagt dir, wann und zu welchem Preis.'],
  ['Jeden Abend neu bewertet', 'Werktags gegen 18:10 Uhr holt die App die Schlusskurse und bewertet jede Aktie deiner Liste: <b class="up">kaufen</b>, <b style="color:var(--wait)">abwarten</b> oder <b class="down">nicht kaufen</b>. Bei „kaufen“ bekommst du Kaufkurs, Notbremse und Ziel.'],
  ['Unter „Heute“ steht, was zu tun ist', 'Kaufsignale und Alarme zu deinem Depot. Steht dort nichts, wartest du einfach. Das ist der Normalfall.'],
  ['Erst üben, dann echtes Geld', 'Der Papier-Modus spielt jedes Signal mit Spielgeld durch. Trag echte Käufe unter „Depot“ ein, damit die App deine Notbremse überwacht. Und mach ab und zu eine Sicherung unter „Mehr“.'],
];
function showIntro(i = 0) {
  const [t, d] = INTRO[i]; const last = i === INTRO.length - 1;
  openOverlay(`<div class="dots">${INTRO.map((_, k) => `<i class="${k === i ? 'on' : ''}"></i>`).join('')}</div><h3>${t}</h3><p>${d}</p>
    <div class="row-btns" style="justify-content:space-between">${last ? '<span></span>' : '<button class="btn" type="button" data-intro="done">Überspringen</button>'}<button class="btn primary" type="button" data-intro="${last ? 'done' : i + 1}">${last ? 'Los geht’s' : 'Weiter'}</button></div>`);
}

// ---------- Reiter ----------
const TABS = ['today', 'list', 'depot', 'paper', 'more'];
function setTab(t, scroll = true) {
  if (!TABS.includes(t)) t = 'today';
  state.tab = t;
  TABS.forEach(k => { $('view-' + k).hidden = k !== t; $('tab-' + k).setAttribute('aria-selected', String(k === t)); });
  lsSet('swing-depot-tab', t);
  if (t === 'paper' && state.loaded) renderPaper();
  if (scroll) window.scrollTo(0, 0);
}
TABS.forEach(k => $('tab-' + k).addEventListener('click', () => setTab(k)));
$('sheetBack').addEventListener('click', () => closeSheet());
$('overlay').addEventListener('click', e => { if (e.target.id === 'overlay') closeOverlay(true); });

// ---------- Ereignisse ----------
document.addEventListener('input', e => {
  const id = e.target.id;
  if (id === 'trAmount' || id === 'trPrice') { const amt = num($('trAmount')?.value), pr = num($('trPrice')?.value); if (amt > 0 && pr > 0) $('trQty').value = String(Math.floor(amt / pr * 1e6) / 1e6).replace('.', ','); }
  if (id === 'addQuery') {
    const q = e.target.value.trim().toUpperCase();
    $('addSearchLink').href = q ? `https://finance.yahoo.com/lookup?s=${encodeURIComponent(e.target.value.trim())}` : 'https://finance.yahoo.com/lookup';
    $('addHint').innerHTML = !q ? `Am sichersten ist die ISIN ${info('isin')}. Die App sucht damit automatisch die passende Aktie an der deutschen Börse.` : ISIN_RE.test(q) ? '<span class="up">✓ Das ist eine ISIN.</span> Die App sucht die Aktie automatisch.' : SYMBOL_RE.test(q) ? '<span class="up">✓ Das ist ein Kürzel.</span> Kurse kommen direkt.' : q.length === 12 ? '<span class="down">Fast: Eine ISIN hat 2 Buchstaben und 10 Zeichen, z. B. DE0007164600.</span>' : 'Die App sucht nach diesem Namen. Mit der ISIN ist es sicherer.';
  }
});
document.addEventListener('change', async e => {
  const t = e.target;
  if (t.id === 'avgToggle') { state.showAvg = t.checked; lsSet('swing-depot-avg', state.showAvg); if (openId) renderStockSheet(openId, true); return; }
  if (t.id === 'paperFeeOff') { state.paperFee = t.checked ? 'off' : 'on'; lsSet('swing-depot-paper', { range: state.paperRange, fee: state.paperFee }); renderPaper(); return; }
  if (t.id === 'restoreFile') { const f = t.files?.[0]; if (!f) return; try { await importBackup(f); toast('Sicherung geladen'); } catch (err) { toast('Laden fehlgeschlagen: ' + err.message); } t.value = ''; return; }
  if (t.dataset?.csv && t.files?.[0]) {
    try { const H = parseCsv(await t.files[0].text()); ['d', 'o', 'h', 'l', 'c', 'v'].forEach(k => H[k] = H[k].slice(-520)); store.updateStock(t.dataset.csv, { hist: H, source: 'manual' }); toast(`${H.c.length} Tageskurse geladen`); }
    catch (err) { toast('CSV-Import fehlgeschlagen: ' + err.message); }
  }
});
document.addEventListener('click', async e => {
  const t = e.target.closest('[data-term],[data-open],[data-pos],[data-filter],[data-range],[data-remove],[data-buyplan],[data-deltrade],[data-edittrade],[data-sell],[data-act],[data-tab],[data-intro]'); if (!t) return;
  const d = t.dataset;
  if (d.term) { e.preventDefault(); e.stopPropagation(); showInfo(d.term); return; }
  if (d.intro) { if (d.intro === 'done') { lsSet('swing-depot-intro', 1); closeOverlay(true); } else showIntro(+d.intro); return; }
  if (d.open) { renderStockSheet(d.open); return; }
  if (d.pos) { positionSheet(d.pos); return; }
  if (d.tab) { setTab(d.tab); return; }
  if (d.filter) { state.filter = d.filter; renderList(); return; }
  if (d.range) { state.paperRange = d.range; lsSet('swing-depot-paper', { range: state.paperRange, fee: state.paperFee }); renderPaper(); return; }
  if (d.remove) {
    if (d.confirm !== '1') { d.confirm = '1'; t.textContent = 'Nochmal tippen zum Entfernen'; return; }
    closeSheet(); store.delStock(d.remove); toast('Entfernt'); return;
  }
  if (d.buyplan) {
    const st = state.stocks[d.buyplan]; const ev = evaluateStock(st); const p = ev.plan;
    tradeSheet({ symbol: st.symbol, side: 'buy', qty: p.shares, price: p.entry, stop: p.stop, target: p.target, note: `Regel ${state.settings.ruleset}`, date: isoDate(new Date()) });
    return;
  }
  if (d.sell) { const p = depot().open.find(x => x.symbol === d.sell); tradeSheet({ symbol: d.sell, side: 'sell', qty: p?.qty, price: p?.price != null ? Math.round(p.price * 100) / 100 : null }); return; }
  if (d.edittrade) { tradeSheet(state.trades[d.edittrade], d.edittrade); return; }
  if (d.deltrade) {
    if (d.confirm !== '1') { d.confirm = '1'; t.textContent = 'Nochmal tippen zum Löschen'; return; }
    store.delTrade(d.deltrade); closeSheet(); toast('Eintrag gelöscht'); return;
  }
  switch (d.act) {
    case 'add': addStockSheet(); break;
    case 'trade': tradeSheet(); break;
    case 'backup': exportBackup(); toast('Sicherung gespeichert (im Download-Ordner)'); break;
    case 'restore': $('restoreFile').click(); break;
    case 'reload': await loadPrices(); toast(state.meta?.date ? `Kurse vom ${fmtDate(state.meta.date)}` : 'Keine Kurse gefunden'); break;
    case 'github': setTab('more', false); setTimeout(() => $('ghCard')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30); break;
    case 'ghremove': lsSet(GH_KEY, { ...lsGet(GH_KEY, {}), token: '' }); state.sync = 'off'; renderMore(); toast('Schlüssel entfernt'); break;
    case 'intro': showIntro(0); break;
    case 'closeoverlay': closeOverlay(true); break;
  }
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') { if (!$('overlay').hidden) closeOverlay(true); else if (!$('sheet').hidden) closeSheet(); } });
document.addEventListener('submit', e => {
  const f = e.target; e.preventDefault();
  if (f.id === 'addForm') {
    const raw = $('addQuery').value.trim(), q = raw.toUpperCase().replace(/\s+/g, ''), name = $('addName').value.trim();
    if (!raw) return;
    let id, doc;
    if (ISIN_RE.test(q)) { id = 'Q_' + safeId(q); doc = { query: q, name, addedAt: isoDate(new Date()) }; }
    else if (SYMBOL_RE.test(q)) { id = safeId(q); doc = { symbol: q, name: name || q.split('.')[0], addedAt: isoDate(new Date()) }; }
    else { id = 'Q_' + safeId(raw); doc = { query: raw, name: name || raw, addedAt: isoDate(new Date()) }; }
    const known = state.resolved[doc.query]?.symbol;
    if (known) { id = safeId(known); doc = { symbol: known, name: name || state.resolved[doc.query].name, isin: ISIN_RE.test(q) ? q : undefined, addedAt: doc.addedAt }; }
    if (state.stocks[id] || Object.values(state.stocks).some(s => s.isin && s.isin === q)) { toast('Diese Aktie ist schon in der Liste.'); return; }
    store.setStock(id, doc); closeSheet(); setTab('list');
    toast(doc.symbol ? `${doc.name} hinzugefügt. Kurse folgen in ein paar Minuten.` : ghConf().token ? 'Hinzugefügt. Die App sucht die Aktie, das dauert ein paar Minuten.' : 'Hinzugefügt. Gesucht wird beim nächsten Abendlauf.');
    if (doc.symbol && ghConf().token) pollAfterSync();
    return;
  }
  if (f.id === 'tradeForm') {
    const sym = $('trSym').value; const st = Object.values(state.stocks).find(s => s.symbol === sym);
    const t = { symbol: sym, name: st?.name || sym, side: $('trSide').value, date: $('trDate').value, qty: num($('trQty').value), price: num($('trPrice').value), fee: num($('trFee').value) ?? 0, stop: num($('trStop').value), target: num($('trTarget').value), note: $('trNote').value.trim(), created: state.trades[f.dataset.edit]?.created || new Date().toISOString() };
    if (!t.qty || t.qty <= 0 || !t.price || !t.date) { toast('Bitte Kurs, Stückzahl und Datum ausfüllen.'); return; }
    if (t.side === 'sell' && !f.dataset.edit) { const p = depot().open.find(x => x.symbol === sym); if (!p || p.qty + 1e-9 < t.qty) { toast(`Du hältst nur ${fmtQty(p?.qty || 0)} Stück.`); return; } }
    store.setTrade(f.dataset.edit || null, t); closeSheet(); setTab('depot');
    toast(t.side === 'buy' && !t.stop ? 'Gespeichert. Tipp: Notbremse bei Trade Republic setzen.' : 'Gespeichert');
    return;
  }
  if (f.id === 'adjustForm') {
    const symbol = f.dataset.symbol; const p = depot().open.find(x => x.symbol === symbol); if (!p) return;
    const qty = num($('adjQty').value), avg = num($('adjAvg').value), price = num($('adjPrice').value), stop = num($('adjStop').value);
    if (qty == null && avg == null && price == null && stop == null) { toast('Bitte mindestens ein Feld ausfüllen.'); return; }
    const today = isoDate(new Date());
    if (qty != null || avg != null || stop != null) {
      const newQty = qty ?? p.qty;
      let newAvg = avg != null ? avg : p.avgPrice;
      if (avg != null && $('adjFeeIncl').checked && newQty > 0) newAvg = avg + state.settings.fee / newQty;
      store.setTrade(null, { symbol, name: p.name || symbol, side: 'adjust', date: today, qty: newQty, price: Math.round(newAvg * 10000) / 10000, fee: 0, stop: stop ?? p.stop ?? null, target: p.target ?? null, note: 'Abgleich mit Trade Republic', created: new Date().toISOString() });
    }
    if (price != null && state.stocks[safeId(symbol)]) store.updateStock(safeId(symbol), { trPrice: { price, date: today } });
    toast('Abgleich gespeichert'); positionSheet(symbol);
    return;
  }
  if (f.id === 'settingsForm') {
    const s = { ...state.settings, stake: num($('setStake').value) || 50, maxLoss: num($('setMaxLoss').value) ?? 5, fee: num($('setFee').value) ?? 1, minCrv: num($('setMinCrv').value) || 1.5, fractional: $('setFrac').checked, marketFilter: $('setMarket').checked, timingMin: parseInt($('setTiming').value, 10) };
    document.activeElement?.blur?.(); store.saveSettings(s); toast('Einstellungen gespeichert');
    return;
  }
  if (f.id === 'ghForm') {
    const c = lsGet(GH_KEY, {}); const tok = $('ghToken').value.trim();
    const next = { owner: $('ghOwner').value.trim() || ghConf().owner, repo: $('ghRepo').value.trim() || ghConf().repo, token: tok.startsWith('••') ? c.token : tok };
    if (next.token && !/^(github_pat_|ghp_)/.test(next.token)) { toast('Der Schlüssel muss mit github_pat_ beginnen.'); return; }
    lsSet(GH_KEY, next); document.activeElement?.blur?.(); toast(next.token ? 'Gespeichert, übertrage…' : 'Gespeichert'); renderMore(); syncNow();
    return;
  }
  if (f.dataset.manual) {
    const id = f.dataset.manual; const st = state.stocks[id]; const fd = new FormData(f);
    const dd = fd.get('d'); const c = num(fd.get('c')); if (!dd || c == null) return;
    const h = num(fd.get('h')), l = num(fd.get('l'));
    const H = st.hist ? JSON.parse(JSON.stringify(st.hist)) : { d: [], o: [], h: [], l: [], c: [], v: [] };
    const k = H.d.indexOf(dd); const row = [dd, c, h != null ? Math.max(h, c) : c, l != null ? Math.min(l, c) : c, c, 0];
    if (k >= 0) { H.o[k] = row[1]; H.h[k] = row[2]; H.l[k] = row[3]; H.c[k] = row[4]; }
    else { const all = H.d.map((x, j) => [x, H.o[j], H.h[j], H.l[j], H.c[j], H.v[j]]).concat([row]).sort((a, b) => a[0].localeCompare(b[0])); ['d', 'o', 'h', 'l', 'c', 'v'].forEach((key, j) => H[key] = all.map(r => r[j])); }
    store.updateStock(id, { hist: H, source: 'manual' }); toast(`Kurs vom ${fmtDate(dd)} gespeichert`);
  }
});

// ---------- Start ----------
state.showAvg = !!lsGet('swing-depot-avg', false);
{ const pp = lsGet('swing-depot-paper', null); if (pp) { state.paperRange = pp.range || 'start'; state.paperFee = pp.fee || 'on'; } }
setTab(lsGet('swing-depot-tab', 'today'), false);
render();
store.init().then(() => { if (!lsGet('swing-depot-intro', 0)) showIntro(0); });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && state.loaded) loadPrices(); });
