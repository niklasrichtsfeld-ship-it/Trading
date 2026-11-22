// Täglicher Lauf (GitHub Actions): Kurse von Yahoo Finance holen, Regeln rechnen, Meldungen per ntfy schicken.
// Liest config/watch.json, schreibt data/prices/<ID>.json, data/signals.json, data/meta.json.
// Push-Thema kommt aus der Umgebungsvariable NTFY_TOPIC (GitHub-Secret). Ohne Thema wird nichts gesendet.
'use strict';
const fs = require('fs'), path = require('path');
const E = require('../engine.js');
const root = path.join(__dirname, '..');
const rd = (p, d) => { try { return JSON.parse(fs.readFileSync(path.join(root, p), 'utf8')); } catch (e) { return d; } };
const wr = (p, v) => { fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true }); fs.writeFileSync(path.join(root, p), JSON.stringify(v)); };
const safeId = s => String(s).toUpperCase().replace(/[^A-Z0-9_-]/g, '_').slice(0, 60);
const sleep = ms => new Promise(r => setTimeout(r, ms));

const cfg = rd('config/watch.json', { stocks: [], alerts: [], settings: {} });
const S = Object.assign({ stake: 50, maxLoss: 5, fee: 1, minCrv: 1.5, fractional: true, ruleset: 'A', timingMin: 3 }, cfg.settings || {});
const prev = rd('data/signals.json', { signals: {} });

async function fetchYahoo(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=2y&interval=1d`;
  let lastErr;
  for (let a = 0; a < 3; a++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      const j = await res.json();
      const r = j?.chart?.result?.[0];
      if (!r || !r.timestamp) throw new Error(j?.chart?.error?.description || `Kürzel unbekannt (HTTP ${res.status})`);
      const q = r.indicators.quote[0], off = r.meta.gmtoffset || 0, now = Date.now() / 1000;
      const H = { d: [], o: [], h: [], l: [], c: [], v: [] };
      r.timestamp.forEach((t, i) => {
        if (q.close[i] == null) return;
        const d = new Date((t + off) * 1000).toISOString().slice(0, 10);
        if (H.d.length && H.d[H.d.length - 1] === d) return;
        H.d.push(d); H.o.push(+(q.open[i] ?? q.close[i]).toFixed(4)); H.h.push(+(q.high[i] ?? q.close[i]).toFixed(4)); H.l.push(+(q.low[i] ?? q.close[i]).toFixed(4)); H.c.push(+q.close[i].toFixed(4)); H.v.push(q.volume[i] || 0);
      });
      const regEnd = r.meta.currentTradingPeriod?.regular?.end || 0;
      if (regEnd > now && H.d[H.d.length - 1] === new Date((now + off) * 1000).toISOString().slice(0, 10)) ['d', 'o', 'h', 'l', 'c', 'v'].forEach(k => H[k].pop());
      ['d', 'o', 'h', 'l', 'c', 'v'].forEach(k => H[k] = H[k].slice(-520));
      return { H, currency: r.meta.currency || 'EUR', name: r.meta.longName || r.meta.shortName || symbol };
    } catch (e) { lastErr = e; await sleep(2000 * (a + 1)); }
  }
  throw lastErr;
}

// ISIN oder Name -> Yahoo-Kürzel. Bevorzugt Xetra (.DE), dann Frankfurt (.F), weil Trade Republic in Euro handelt.
async function resolve(query, depth = 0) {
  const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=10&newsCount=0&lang=de-DE&region=DE`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const j = await res.json();
  const qs = (j.quotes || []).filter(q => q.symbol && ['EQUITY', 'ETF'].includes(q.quoteType));
  if (!qs.length) throw new Error('nichts gefunden');
  const rank = q => q.symbol.endsWith('.DE') ? 0 : q.symbol.endsWith('.F') ? 1 : /^[A-Z.-]+$/.test(q.symbol) && !q.symbol.includes('.') ? 2 : 3;
  qs.sort((a, b) => rank(a) - rank(b));
  let best = qs[0];
  // ISIN-Suche liefert oft nur die Heimatbörse (z. B. NASDAQ). Dann per Name nach einer Euro-Börse suchen.
  if (rank(best) > 1 && depth === 0) {
    try { const alt = await resolve(best.longname || best.shortname || best.symbol, 1); if (alt.symbol.endsWith('.DE') || alt.symbol.endsWith('.F')) return { ...alt, name: best.shortname || best.longname || alt.name }; } catch (e) { }
  }
  return { symbol: best.symbol, name: best.shortname || best.longname || best.symbol, exchange: best.exchDisp || '' };
}

async function push(title, msg, prio = 'default') {
  const topic = process.env.NTFY_TOPIC; if (!topic) { console.log('(kein NTFY_TOPIC, Push übersprungen)'); return; }
  const res = await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, { method: 'POST', body: msg, headers: { Title: title, Priority: prio, Tags: 'chart_with_upwards_trend', Click: process.env.APP_URL || '' } });
  console.log('Push:', res.status);
}

(async () => {
  const signals = {}, errors = [], lines = [], hits = [];
  // Neue Einträge per ISIN/Name auflösen
  const resolved = rd('data/resolved.json', {});
  for (const st of cfg.stocks || []) {
    if (st.symbol || !st.query) continue;
    if (resolved[st.query]?.symbol) { st.symbol = resolved[st.query].symbol; continue; }
    try { const r = await resolve(st.query); resolved[st.query] = r; st.symbol = r.symbol; if (!st.name) st.name = r.name; }
    catch (e) { resolved[st.query] = { error: 'Nicht gefunden. Prüfe die ISIN oder den Namen.' }; errors.push(`${st.query}: nicht gefunden`); }
  }
  wr('data/resolved.json', resolved);
  // Gesamtmarkt (DAX) für den Marktfilter
  let marketUp;
  try { const { H } = await fetchYahoo('^GDAXI'); wr('data/prices/_GDAXI.json', { symbol: '^GDAXI', name: 'DAX', currency: 'EUR', updated: new Date().toISOString(), hist: H }); marketUp = E.marketTrend(H)(H.d[H.d.length - 1]); }
  catch (e) { errors.push('DAX: ' + String(e.message || e).slice(0, 80)); }
  S.marketUp = marketUp ?? undefined;
  const histBySym = {};
  let lastDate = '';
  const symbols = [...new Set([...(cfg.stocks || []).map(s => s.symbol), ...(cfg.alerts || []).map(a => a.symbol)].filter(Boolean))];
  for (const symbol of symbols) {
    const meta = (cfg.stocks || []).find(s => s.symbol === symbol) || { symbol, name: symbol };
    try {
      const { H, currency, name } = await fetchYahoo(symbol);
      if (H.c.length < 2) throw new Error('zu wenige Kurse');
      histBySym[symbol] = H; if (H.d[H.d.length - 1] > lastDate) lastDate = H.d[H.d.length - 1];
      wr(`data/prices/${safeId(symbol)}.json`, { symbol, name: meta.name || name, currency, updated: new Date().toISOString(), hist: H });
      const ev = E.withCurrency(currency, () => (E.RULESETS[S.ruleset] || E.RULESETS.A).evaluate(H, S));
      signals[symbol] = { signal: ev.signal, date: H.d[H.d.length - 1], reason: ev.reason, plan: ev.plan && !ev.plan.preview ? { entry: ev.plan.entry, stop: ev.plan.stop, target: ev.plan.target } : null };
      const was = prev.signals?.[symbol]?.signal;
      if ((cfg.stocks || []).some(s => s.symbol === symbol)) {
        if (ev.signal === 'kaufen' && was !== 'kaufen') hits.push(`${meta.name}: kaufen ab ${E.fmtNum(ev.plan.entry)}, Notbremse ${E.fmtNum(ev.plan.stop)}, Ziel ${E.fmtNum(ev.plan.target)}`);
        else if (was && was !== ev.signal) lines.push(`${meta.name}: jetzt ${ev.signal === 'nicht' ? 'nicht kaufen' : ev.signal}`);
      }
    } catch (e) {
      errors.push(`${meta.name || symbol}: ${String(e.message || e).slice(0, 100)}`);
      signals[symbol] = { ...(prev.signals?.[symbol] || {}), error: String(e.message || e).slice(0, 100) };
    }
  }
  // Depot-Alarme: Notbremse oder Ziel erreicht (aus config/watch.json alerts, ohne Beträge)
  for (const a of cfg.alerts || []) {
    const H = histBySym[a.symbol]; if (!H) continue;
    const i = H.c.length - 1, name = a.name || a.symbol;
    if (a.stop && H.l[i] <= a.stop) hits.push(`${name}: Notbremse ${E.fmtNum(a.stop)} erreicht (Tief ${E.fmtNum(H.l[i])})`);
    else if (a.target && H.h[i] >= a.target) hits.push(`${name}: Ziel ${E.fmtNum(a.target)} erreicht (Hoch ${E.fmtNum(H.h[i])})`);
  }
  wr('data/signals.json', { date: lastDate, signals });
  wr('data/meta.json', { date: lastDate, marketUp: marketUp ?? null, ranAt: new Date().toISOString(), symbols: symbols.map(s => ({ symbol: s, id: safeId(s) })), errors, changes: [...hits, ...lines] });
  const body = [...hits, ...lines, ...(errors.length ? ['Fehler: ' + errors.join('; ')] : [])].join('\n');
  console.log(`Kurse vom ${lastDate}, ${symbols.length} Aktien.\n` + (body || 'Keine Änderungen.'));
  if (cfg.testPush) await push('Swing-Depot ist eingerichtet', `Kurse vom ${E.fmtDate(lastDate)} geladen, ${symbols.length} Aktien. Ab jetzt kommen hier Kaufsignale und Alarme.`);
  if (hits.length) await push('Swing-Depot', hits.join('\n'), 'high');
  else if (errors.length && !lastDate) await push('Swing-Depot: Fehler', 'Kurse konnten nicht geladen werden.');
})().catch(e => { console.error(e); process.exit(1); });
