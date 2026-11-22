// Swing-Depot Rechen-Kern: Indikatoren, Regelwerke, Depot, Papier-Modus. Läuft im Browser und in Node (täglicher Lauf).

// ---------- Hilfsfunktionen ----------
const r2 = x => Math.round(x * 100) / 100;
function sma(vals, n) { const out = new Array(vals.length).fill(null); let s = 0; for (let i = 0; i < vals.length; i++) { s += vals[i]; if (i >= n) s -= vals[i - n]; if (i >= n - 1) out[i] = s / n; } return out; }
function rsi(closes, n = 14) {
  const out = new Array(closes.length).fill(null); if (closes.length <= n) return out;
  let g = 0, l = 0;
  for (let i = 1; i <= n; i++) { const d = closes[i] - closes[i - 1]; if (d > 0) g += d; else l -= d; }
  g /= n; l /= n; out[n] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  for (let i = n + 1; i < closes.length; i++) { const d = closes[i] - closes[i - 1]; g = (g * (n - 1) + Math.max(d, 0)) / n; l = (l * (n - 1) + Math.max(-d, 0)) / n; out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); }
  return out;
}
function atr(h, l, c, n = 14) {
  const out = new Array(c.length).fill(null); if (c.length <= n) return out;
  const tr = c.map((_, i) => i === 0 ? h[0] - l[0] : Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1])));
  let a = 0; for (let i = 1; i <= n; i++) a += tr[i]; a /= n; out[n] = a;
  for (let i = n + 1; i < c.length; i++) { a = (a * (n - 1) + tr[i]) / n; out[i] = a; }
  return out;
}
function indicators(H) {
  const c = H.c;
  return { sma20: sma(c, 20), sma50: sma(c, 50), sma200: sma(c, 200), rsi14: rsi(c, 14), atr14: atr(H.h, H.l, c, 14) };
}

// Positionsgröße und Chance-Risiko nach Gebühren (gilt für alle Regelwerke)
function sizePlan(entry, stop, target, S) {
  const riskPS = entry - stop;
  let shares = S.stake / entry;
  const riskBudget = S.maxLoss - 2 * S.fee;
  if (riskPS > 0 && riskBudget > 0) shares = Math.min(shares, riskBudget / riskPS);
  if (riskBudget <= 0) shares = 0;
  if (!S.fractional) shares = Math.floor(shares);
  else shares = Math.floor(shares * 1e6) / 1e6;
  const invest = shares * entry;
  const gainGross = shares * (target - entry), lossGross = shares * riskPS;
  const gainNet = gainGross - 2 * S.fee, lossNet = lossGross + 2 * S.fee;
  return {
    entry: r2(entry), stop: r2(stop), target: r2(target), shares, invest: r2(invest),
    crvGross: riskPS > 0 ? (target - entry) / riskPS : 0,
    crvNet: lossNet > 0 ? gainNet / lossNet : 0,
    gainNet: r2(gainNet), lossNet: r2(lossNet),
    breakEven: shares > 0 ? r2(entry + 2 * S.fee / shares) : null,
    stopPct: (stop / entry - 1) * 100, targetPct: (target / entry - 1) * 100,
  };
}

// ---------- Regelwerke (austauschbar) ----------
// Jedes Regelwerk: { id, name, text: [..], evaluate(H, S) -> Ergebnis }
// Ergebnis: { signal: 'kaufen'|'abwarten'|'nicht', reason, condition, checks:[{label, ok:true|false|null, value}], plan|null, ind }
const RULESETS = {};
RULESETS.A = {
  id: 'A', name: 'A: Rücksetzer im Aufwärtstrend (Platzhalter)',
  short: 'Kauft Aktien, die langfristig steigen, wenn sie kurz zurückgefallen sind und wieder nach oben drehen.',
  text: [
    'Nicht kaufen, wenn die Aktie langfristig fällt (Kurs unter seinem 200-Tage-Durchschnitt).',
    'Abwarten, wenn die Aktie zu schnell gestiegen ist (mehr als 3 % über ihrem 20-Tage-Durchschnitt). Nicht hinterherkaufen.',
    'Kaufen, wenn die Einstiegs-Bedingungen passen: kurz auf den Durchschnitt zurückgefallen, nicht überhitzt (Schwung-Wert RSI 40 bis 55), heute wieder gestiegen. Ob alle 3 oder 2 von 3 nötig sind, stellst du unten ein.',
    'Kaufkurs: knapp über dem heutigen Tageshoch. Gekauft wird erst, wenn der Kurs dort ankommt.',
    'Notbremse (Stop-Loss): unter dem tiefsten Kurs der letzten 10 Tage, mindestens zwei übliche Tagesschwankungen entfernt.',
    'Ziel: das Hoch der letzten 60 Tage, mindestens doppelt so weit weg wie die Notbremse.',
    'Marktfilter: Fällt der Gesamtmarkt (DAX unter seinem 200-Tage-Durchschnitt), gibt die Regel keine Kaufsignale. Abschaltbar unter Einstellungen.',
    'Gebühren-Check: Der mögliche Gewinn nach Gebühren muss mindestens so viel größer sein wie eingestellt, sonst nur „abwarten“.',
  ],
  evaluate(H, S) {
    const n = H.c.length, i = n - 1;
    const ind = indicators(H);
    const base = { ind, checks: [], plan: null };
    if (n < 201) return { ...base, signal: 'abwarten', reason: `Zu wenig Kursdaten: ${n} von mindestens 201 Handelstagen.`, condition: 'Kurse für mindestens ein Jahr laden.' };
    const c = H.c[i], pc = H.c[i - 1];
    const s20 = ind.sma20[i], s50 = ind.sma50[i], s200 = ind.sma200[i], R = ind.rsi14[i], A = ind.atr14[i];
    const trend = c > s200 && s50 > s200;
    const dist20 = (c / s20 - 1) * 100;
    const notExt = dist20 <= 3;
    let touched = false;
    for (let k = i - 2; k <= i; k++) if (H.l[k] <= ind.sma20[k] * 1.005 || H.l[k] <= ind.sma50[k] * 1.005) touched = true;
    const rsiOk = R >= 40 && R <= 55;
    const upDay = c > pc;
    const checks = [
      { label: 'Die Aktie steigt langfristig', ok: trend, value: `Kurs ${fmt(c)}, 200-Tage-Durchschnitt ${fmt(s200)}`, term: 'gd' },
      { label: 'Nicht zu schnell gestiegen', ok: notExt, value: `${fmtPct(dist20)} über dem 20-Tage-Durchschnitt (erlaubt: bis +3 %)`, term: 'gd' },
      { label: 'Kürzlich auf den Durchschnitt zurückgefallen', ok: touched, value: `20-Tage-Durchschnitt ${fmt(s20)}`, term: 'gd' },
      { label: 'Weder überhitzt noch im freien Fall', ok: rsiOk, value: `Schwung-Wert ${R.toFixed(0)} (gut: 40 bis 55)`, term: 'rsi' },
      { label: 'Heute wieder gestiegen', ok: upDay, value: `${fmt(pc)} → ${fmt(c)}` },
      { label: 'Gesamtmarkt (DAX) steigt', ok: S.marketFilter === false ? null : (S.marketUp ?? null), term: 'markt', value: S.marketFilter === false ? 'Marktfilter ist ausgeschaltet' : S.marketUp == null ? 'keine DAX-Kurse' : S.marketUp ? 'DAX über seinem 200-Tage-Durchschnitt' : 'DAX unter seinem 200-Tage-Durchschnitt' },
    ];
    base.checks = checks;
    if (!trend) return { ...base, signal: 'nicht', reason: c <= s200 ? 'Die Aktie fällt langfristig. Die Regel kauft nur Aktien, die steigen.' : 'Der langfristige Trend kippt gerade nach unten.', condition: `Neu prüfen, wenn der Kurs wieder deutlich über ${fmt(s200)} liegt.` };
    if (!notExt) return { ...base, signal: 'abwarten', reason: `Die Aktie ist zuletzt schnell gestiegen (${fmtPct(dist20)} über ihrem Durchschnitt). Nicht hinterherkaufen.`, condition: `Kaufgelegenheit, wenn sie auf etwa ${fmt(s20)} zurückfällt.` };
    const entry = H.h[i] * 1.002 + 0.01;
    let swingLow = Infinity; for (let k = i - 9; k <= i; k++) swingLow = Math.min(swingLow, H.l[k]);
    const stop = Math.min(swingLow - 0.01, entry - 2 * A);
    let hi60 = 0; for (let k = i - 59; k <= i; k++) hi60 = Math.max(hi60, H.h[k]);
    const target = Math.max(hi60, entry + 2 * (entry - stop));
    const plan = sizePlan(entry, stop, target, S);
    base.plan = plan;
    checks.push({ label: `Lohnt sich nach Gebühren (Gewinn mindestens ${fmtNum(S.minCrv, 1)}-mal so groß wie Verlust)`, ok: plan.crvNet >= S.minCrv && plan.shares > 0, value: `${fmtNum(plan.crvNet, 1)}-mal (ohne Gebühren ${fmtNum(plan.crvGross, 1)}-mal)`, term: 'crv' });
    const missing = [];
    if (!touched) missing.push(`der Kurs auf etwa ${fmt(s20)} zurückfällt`);
    if (!rsiOk) missing.push(R > 55 ? 'die Aktie etwas abkühlt' : 'der Kurs sich fängt');
    if (!upDay) missing.push('ein Tag wieder im Plus schließt');
    const timingOk = [touched, rsiOk, upDay].filter(Boolean).length;
    const need = S.timingMin === 2 ? 2 : 3;
    if (timingOk < need) { base.plan = { ...plan, preview: true }; return { ...base, signal: 'abwarten', reason: 'Die Aktie steigt, aber der günstige Moment zum Einstieg fehlt noch.', condition: 'Kaufsignal, wenn ' + missing.join(need === 3 ? ' und ' : ' oder ') + '.' }; }
    if (plan.shares <= 0) return { ...base, signal: 'abwarten', reason: 'Kaufsignal da, aber der erlaubte Verlust reicht nicht einmal für die Gebühren.', condition: 'Unter „Regeln“ den erlaubten Verlust pro Trade erhöhen.' };
    if (plan.crvNet < S.minCrv) return { ...base, signal: 'abwarten', reason: `Kaufsignal da, aber nach Gebühren lohnt es sich nicht: Der mögliche Gewinn ist nur ${fmtNum(plan.crvNet, 1)}-mal so groß wie der mögliche Verlust.`, condition: `Lohnt sich erst mit größerem Einsatz oder höherem erlaubten Verlust (unter „Regeln“, nötig: ${fmtNum(S.minCrv, 1)}-mal).` };
    if (S.marketFilter !== false && S.marketUp === false) return { ...base, signal: 'abwarten', reason: 'Die Aktie passt, aber der Gesamtmarkt (DAX) fällt gerade. In solchen Phasen kauft die Regel nicht.', condition: 'Kaufsignal, sobald der DAX wieder über seinem 200-Tage-Durchschnitt liegt.' };
    return { ...base, signal: 'kaufen', reason: timingOk === 3 ? 'Die Aktie steigt langfristig, ist kurz zurückgefallen und dreht jetzt wieder nach oben.' : `Die Aktie steigt langfristig, ${timingOk} von 3 Einstiegs-Bedingungen sind erfüllt.`, condition: `Kaufen, sobald der Kurs ${fmt(plan.entry)} erreicht (morgen, bei Trade Republic als Stop-Order).` };
  },
};

// Bewertung einer gehaltenen Position
function rateHolding(pos, H, S) {
  const last = pos.price ?? H.c[H.c.length - 1];
  const ind = indicators(H); const A = ind.atr14[ind.atr14.length - 1] || last * 0.02;
  const entry = pos.avgPrice;
  const stop = pos.stop || r2(entry - 2 * A);
  const target = pos.target || r2(entry + 4 * A);
  if (last <= stop) return { signal: 'nicht', label: 'Verkaufen', reason: `Notbremse ${fmt(stop)} erreicht. Verkaufen, um größere Verluste zu vermeiden.`, stop, target };
  if (last >= target) return { signal: 'kaufen', label: 'Ziel erreicht', reason: `Ziel ${fmt(target)} erreicht. Gewinn mitnehmen oder die Notbremse dicht nachziehen.`, stop, target };
  if (last >= entry + (entry - stop) && stop < entry) return { signal: 'abwarten', label: 'Notbremse hochziehen', reason: `Gut im Plus. Notbremse auf deinen Kaufkurs ${fmt(entry)} hochsetzen, dann kannst du nichts mehr verlieren.`, stop, target };
  return { signal: 'none', label: 'Halten', reason: `Notbremse bei ${fmt(stop)}, Ziel bei ${fmt(target)}.`, stop, target, hold: true };
}

// ---------- Depot-Rechnung ----------
// Trade-Arten: buy, sell, adjust (Abgleich mit dem echten Depot: setzt Stückzahl und Einstand auf die Werte von Trade Republic)
function computeDepot(trades, priceOf, sellFee = 1) {
  const sorted = [...trades].sort((a, b) => (a.date + (a.created || '')).localeCompare(b.date + (b.created || '')));
  const pos = {}; let realized = 0, fees = 0;
  for (const t of sorted) {
    const p = pos[t.symbol] || (pos[t.symbol] = { symbol: t.symbol, name: t.name, qty: 0, cost: 0, realized: 0, stop: null, target: null, first: t.date, adjusted: null });
    if (t.side === 'adjust') {
      p.qty = t.qty; p.cost = t.qty * t.price; p.adjusted = t.date;
      if (t.stop) p.stop = t.stop; if (t.target) p.target = t.target;
      if (t.realizedFix) { p.realized += t.realizedFix; realized += t.realizedFix; }
      continue;
    }
    fees += t.fee || 0;
    if (t.side === 'buy') { p.qty += t.qty; p.cost += t.qty * t.price + (t.fee || 0); if (t.stop) p.stop = t.stop; if (t.target) p.target = t.target; }
    else { const avg = p.qty > 0 ? p.cost / p.qty : 0; const q = Math.min(t.qty, p.qty); const pl = q * t.price - (t.fee || 0) - avg * q; p.realized += pl; realized += pl; p.cost -= avg * q; p.qty -= q; if (p.qty < 1e-9) { p.qty = 0; p.cost = 0; p.stop = null; p.target = null; } }
  }
  const open = Object.values(pos).filter(p => p.qty > 0).map(p => {
    const pr = priceOf(p.symbol);
    const price = pr && typeof pr === 'object' ? pr.price : pr;
    const value = price != null ? p.qty * price : null;
    const avgPrice = p.cost / p.qty;
    const unreal = value != null ? value - p.cost - sellFee : null;
    return { ...p, price, priceSource: pr && typeof pr === 'object' ? pr.source : null, value, avgPrice, unreal };
  });
  const value = open.reduce((s, p) => s + (p.value || 0), 0);
  const cost = open.reduce((s, p) => s + p.cost, 0);
  const unreal = open.reduce((s, p) => s + (p.unreal || 0), 0);
  return { open, value, cost, unreal, realized, fees, closed: Object.values(pos).filter(p => p.qty === 0) };
}

// Gesamtmarkt: steigt der Index (Kurs über 200-Tage-Durchschnitt)? Liefert eine Funktion Datum -> true/false/null
function marketTrend(M) {
  if (!M || !M.c || M.c.length < 200) return () => null;
  const s200 = sma(M.c, 200); const map = {};
  M.d.forEach((d, i) => { if (s200[i] != null) map[d] = M.c[i] > s200[i]; });
  const dates = M.d;
  return d => { if (d in map) return map[d]; let lo = 0, hi = dates.length - 1, best = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (dates[m] <= d) { best = m; lo = m + 1; } else hi = m - 1; } return best >= 0 && dates[best] in map ? map[dates[best]] : null; };
}

// ---------- Papier-Modus: Regel ohne dich mittraden lassen ----------
// Spielt die Regel Tag für Tag ab startDate durch. Bei "kaufen" wird am nächsten Tag gekauft, wenn der Kurs den Kaufkurs erreicht
// (sonst verfällt das Signal nach 3 Tagen). Verkauft wird an Notbremse oder Ziel, spätestens nach 20 Handelstagen.
// Fällt Notbremse und Ziel auf denselben Tag, wird vorsichtig die Notbremse angenommen. Gebühren werden abgezogen.
function simulatePaper(H, S, startDate, opts = {}) {
  const rs = RULESETS[S.ruleset] || RULESETS.A;
  const trades = []; let pending = null, open = null;
  const S2 = opts.ignoreFeeFilter ? { ...S, minCrv: -99 } : S;
  for (let i = 201; i < H.c.length; i++) {
    const d = H.d[i];
    if (open) {
      open.days++;
      const o = H.o[i], lo = H.l[i], hi = H.h[i];
      let exit = null, why = null;
      if (lo <= open.stop) { exit = Math.min(open.stop, o); why = 'Notbremse'; }
      else if (hi >= open.target) { exit = Math.max(open.target, o); why = 'Ziel'; }
      else if (open.days >= 20) { exit = H.c[i]; why = 'Zeit abgelaufen'; }
      if (exit != null) {
        const pl = open.shares * (exit - open.entryFill) - 2 * S.fee;
        trades.push({ ...open, exitDate: d, exit: r2(exit), why, pl: r2(pl), status: pl >= 0 ? 'gewonnen' : 'verloren' });
        open = null;
      }
    }
    if (pending && !open) {
      if (H.h[i] >= pending.entry) {
        const fill = Math.max(pending.entry, H.o[i]);
        open = { ...pending, entryDate: d, entryFill: r2(fill), days: 0 };
        pending = null;
        if (H.l[i] <= open.stop) { const pl = open.shares * (open.stop - fill) - 2 * S.fee; trades.push({ ...open, exitDate: d, exit: open.stop, why: 'Notbremse', pl: r2(pl), status: 'verloren' }); open = null; }
      } else if (++pending.waited >= 3) { pending = null; }
    }
    if (d < startDate || open || pending) continue;
    const slice = { d: H.d.slice(0, i + 1), o: H.o.slice(0, i + 1), h: H.h.slice(0, i + 1), l: H.l.slice(0, i + 1), c: H.c.slice(0, i + 1), v: H.v.slice(0, i + 1) };
    const mUp = opts.market ? opts.market(d) : undefined;
    const ev = rs.evaluate(slice, mUp === undefined ? S2 : { ...S2, marketUp: mUp });
    if (ev.signal === 'kaufen' && ev.plan && ev.plan.shares > 0) pending = { signalDate: d, entry: ev.plan.entry, stop: ev.plan.stop, target: ev.plan.target, shares: ev.plan.shares, waited: 0 };
  }
  const last = H.c[H.c.length - 1];
  if (open) trades.push({ ...open, status: 'offen', pl: r2(open.shares * (last - open.entryFill) - 2 * S.fee), exit: last });
  if (pending) trades.push({ ...pending, status: 'wartet' });
  return trades;
}
function paperSummary(all) {
  const closed = all.filter(t => t.status === 'gewonnen' || t.status === 'verloren');
  const won = closed.filter(t => t.status === 'gewonnen').length;
  const sum = closed.reduce((s, t) => s + t.pl, 0);
  const openPl = all.filter(t => t.status === 'offen').reduce((s, t) => s + t.pl, 0);
  return { closed: closed.length, won, lost: closed.length - won, hitRate: closed.length ? won / closed.length * 100 : null, sum: r2(sum), openPl: r2(openPl), open: all.filter(t => t.status === 'offen').length, waiting: all.filter(t => t.status === 'wartet').length };
}

// ---------- Datum ----------
function isoDate(d) { return d.toISOString().slice(0, 10); }
// Letzter Handelstag, dessen Schlusskurs vorliegt (Daten eines Tages gelten ab 18 Uhr Berliner Zeit)
function lastTradingDay(now) {
  const berlin = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Berlin' }));
  const d = new Date(Date.UTC(berlin.getFullYear(), berlin.getMonth(), berlin.getDate()));
  if (berlin.getHours() < 18) d.setUTCDate(d.getUTCDate() - 1);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() - 1);
  return d;
}

// ---------- CSV-Import (Yahoo, Stooq, Onvista-ähnlich) ----------
function parseNum(s, deComma) { if (s == null) return NaN; s = String(s).trim().replace(/"/g, ''); if (deComma) return parseFloat(s.replace(/\./g, '').replace(',', '.')); if (/^-?\d{1,3}(\.\d{3})*,\d+$/.test(s)) s = s.replace(/\./g, '').replace(',', '.'); else if (/^-?\d+,\d+$/.test(s)) s = s.replace(',', '.'); return parseFloat(s); }
function parseDate(s) { s = String(s).trim().replace(/"/g, ''); let m; if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) return `${m[1]}-${m[2]}-${m[3]}`; if ((m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/))) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/))) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`; return null; }
function parseCsv(text) {
  const lines = text.replace(/\r/g, '').split('\n').filter(x => x.trim());
  if (lines.length < 2) throw new Error('Die Datei enthält keine Kurszeilen.');
  const sep = (lines[0].match(/;/g) || []).length > (lines[0].match(/,/g) || []).length ? ';' : ',';
  const head = lines[0].split(sep).map(x => x.trim().toLowerCase().replace(/"/g, ''));
  const find = (...names) => head.findIndex(h => names.some(n => h === n || h.startsWith(n)));
  const iD = find('date', 'datum'), iO = find('open', 'eröffnung', 'erster'), iH = find('high', 'hoch'), iL = find('low', 'tief'), iC = find('close', 'schluss', 'schlusskurs', 'letzter'), iV = find('volume', 'volumen', 'stücke');
  if (iD < 0 || iC < 0) throw new Error('Spalten „Date“ und „Close“ wurden nicht gefunden.');
  const rows = [];
  for (const line of lines.slice(1)) {
    const de = sep === ';'; const f = line.split(sep); const d = parseDate(f[iD]); const c = parseNum(f[iC], de);
    if (!d || !isFinite(c)) continue;
    const o = iO >= 0 ? parseNum(f[iO], de) : c, h = iH >= 0 ? parseNum(f[iH], de) : c, l = iL >= 0 ? parseNum(f[iL], de) : c, v = iV >= 0 ? parseNum(f[iV], de) : 0;
    rows.push([d, isFinite(o) ? o : c, isFinite(h) ? h : c, isFinite(l) ? l : c, c, isFinite(v) ? v : 0]);
  }
  rows.sort((a, b) => a[0].localeCompare(b[0]));
  const H = { d: [], o: [], h: [], l: [], c: [], v: [] };
  for (const r of rows) { if (H.d.length && H.d[H.d.length - 1] === r[0]) continue; H.d.push(r[0]); H.o.push(r2(r[1])); H.h.push(r2(Math.max(r[2], r[4]))); H.l.push(r2(Math.min(r[3], r[4]))); H.c.push(r2(r[4])); H.v.push(Math.round(r[5])); }
  if (H.d.length < 2) throw new Error('Keine gültigen Kurszeilen gefunden.');
  return H;
}

// ---------- Formatierung ----------
const nf2 = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// Währung für die Anzeige (Trade Republic handelt in Euro; bei anderen Börsen wird die Währung angezeigt)
let CUR_SYMBOL = '€';
const CURRENCY_SIGNS = { EUR: '€', USD: '$', GBP: '£', CHF: 'CHF', GBp: 'GBp' };
function withCurrency(cur, fn) { const old = CUR_SYMBOL; CUR_SYMBOL = CURRENCY_SIGNS[cur] || cur || '€'; try { return fn(); } finally { CUR_SYMBOL = old; } }
function fmt(x) { return x == null || !isFinite(x) ? '–' : nf2.format(x) + ' ' + CUR_SYMBOL; }
function fmtNum(x, d = 2) { return x == null || !isFinite(x) ? '–' : new Intl.NumberFormat('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d }).format(x); }
function fmtPct(x) { return x == null || !isFinite(x) ? '–' : (x > 0 ? '+' : '') + fmtNum(x, 1) + ' %'; }
function fmtSigned(x) { return x == null || !isFinite(x) ? '–' : (x > 0 ? '+' : '') + fmt(x); }
function fmtQty(x) { return x == null || !isFinite(x) ? '–' : new Intl.NumberFormat('de-DE', { maximumFractionDigits: 6 }).format(x); }
function fmtDate(s) { if (!s) return '–'; const [y, m, d] = s.split('-'); return `${d}.${m}.${y}`; }

if (typeof module !== 'undefined' && module.exports) module.exports = { r2, sma, rsi, atr, indicators, sizePlan, RULESETS, rateHolding, computeDepot, simulatePaper, paperSummary, parseCsv, lastTradingDay, isoDate, marketTrend, withCurrency, fmt, fmtNum, fmtPct, fmtSigned, fmtQty, fmtDate };
