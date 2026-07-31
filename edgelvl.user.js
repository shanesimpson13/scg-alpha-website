// ==UserScript==
// @name         EdgeLvl — Greenlight from GMGN
// @namespace    https://edgelvl.app
// @version      1.0.0
// @description  Greenlight a coin straight from GMGN. Your own bot does the trading — this never touches your wallet.
// @author       EdgeLvl
// @match        https://gmgn.ai/*
// @match        https://www.gmgn.ai/*
// @match        https://gmgn.cc/*
// @match        https://www.gmgn.cc/*
// @icon         https://edgelvl.app/favicon.png
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @connect      api.scgalpha.com
// @downloadURL  https://edgelvl.app/edgelvl.user.js
// @updateURL    https://edgelvl.app/edgelvl.user.js
// ==/UserScript==

/*
 * Same job as the browser extension, with nothing to install from a store.
 *
 * Depends on NOTHING in GMGN's DOM: the mint comes from the URL and the panel is
 * position:fixed, so a GMGN redesign can't break it. Your licence key is stored
 * by your userscript manager (GM_setValue), not in the page — GMGN's own scripts
 * can't read it.
 *
 * It never touches your wallet. It reads which coin you're looking at and hands
 * that one mint to your bot.
 */

(function () {
  'use strict';

  const API = 'https://api.scgalpha.com';
  const SOL_MINT = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;     // base58, no 0/O/I/l
  const POLL_MS = 700;
  const SIGNAL_TTL = 60_000;

  let currentMint = null;
  let panel = null;
  let signalCache = { at: 0, byMint: {} };
  const sentMints = new Set();      // a re-render must never re-arm a used button

  // ── storage ───────────────────────────────────────────────────────────────
  const getKey = () => GM_getValue('key', '');
  const setKey = k => GM_setValue('key', k);

  // ── api ───────────────────────────────────────────────────────────────────
  async function api(path, opts = {}) {
    const key = getKey();
    if (!key) return { error: 'no-key' };
    let r;
    try {
      r = await fetch(API + path, {
        ...opts,
        headers: {
          'Authorization': `Bearer ${key}`,
          'Content-Type': 'application/json',
          ...(opts.headers || {})
        }
      });
    } catch (e) {
      return { error: 'offline' };
    }
    if (r.status === 401 || r.status === 403) return { error: 'bad-key' };
    if (!r.ok) return { error: 'http-' + r.status };
    try { return { data: await r.json() }; } catch (e) { return { error: 'bad-json' }; }
  }

  /* Ordered by alert time, so the newest signals are always in the window. A
     metric-ranked list could sort a fresh signal out and make the panel call a
     real signal "not a signal". */
  async function getSignals(force) {
    if (!force && Date.now() - signalCache.at < SIGNAL_TTL) return { data: signalCache.byMint };
    const since = Math.floor(Date.now() / 1000) - 24 * 3600;
    const res = await api(`/api/journal?since=${since}&limit=500`);
    if (res.error) return res;
    const byMint = {};
    for (const a of res.data.alerts || []) if (a.mint) byMint[a.mint] = a;
    signalCache = { at: Date.now(), byMint };
    return { data: byMint };
  }

  // ── helpers ───────────────────────────────────────────────────────────────
  function mintFromUrl() {
    const url = new URL(location.href);
    if (!/\/sol(\/|$)/.test(url.pathname)) return null;   // the bot is Solana-only
    const c = url.pathname.match(SOL_MINT) || [];
    return c.sort((a, b) => b.length - a.length)[0] || null;
  }

  const money = v => {
    v = Number(v) || 0;
    if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M';
    if (v >= 1e3) return '$' + Math.round(v / 1e3) + 'K';
    return '$' + Math.round(v);
  };
  const ago = m => (m < 60 ? `${Math.round(m)}m` : `${(m / 60).toFixed(1)}h`) + ' ago';
  const ageMins = s => (Date.now() / 1000 - (s.alert_time || 0)) / 60;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ── styles ────────────────────────────────────────────────────────────────
  GM_addStyle(`
    #edgelvl-panel{position:fixed;right:18px;bottom:18px;z-index:2147483647;width:268px;
      display:flex;flex-direction:column;gap:9px;padding:14px;background:#0a0a0a;
      border:1px solid rgba(124,255,160,.22);border-radius:11px;
      box-shadow:0 8px 32px rgba(0,0,0,.6);
      font-family:'SF Mono',SFMono-Regular,ui-monospace,Menlo,Monaco,'Courier New',monospace;
      color:#fff;font-size:12px;line-height:1.5}
    #edgelvl-panel *{box-sizing:border-box}
    #edgelvl-panel .el-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
    #edgelvl-panel .el-brand{font-size:10px;letter-spacing:.16em;color:rgba(255,255,255,.42)}
    #edgelvl-panel .el-state{font-size:9.5px;letter-spacing:.08em;text-transform:uppercase;
      padding:2.5px 7px;border-radius:20px;font-weight:600;white-space:nowrap}
    #edgelvl-panel .el-state.ok{color:#7cffa0;background:rgba(124,255,160,.12)}
    #edgelvl-panel .el-state.warn{color:#ffc46b;background:rgba(255,196,107,.12)}
    #edgelvl-panel .el-state.bad{color:#ff6b6b;background:rgba(255,107,107,.12)}
    #edgelvl-panel .el-state.dim{color:rgba(255,255,255,.4);background:rgba(255,255,255,.06)}
    #edgelvl-panel .el-line{font-size:11.5px}
    #edgelvl-panel .el-dim{color:rgba(255,255,255,.5);font-size:10.5px}
    #edgelvl-panel input{width:100%;background:rgba(255,255,255,.04);
      border:1px solid rgba(255,255,255,.1);color:#fff;padding:9px;font-family:inherit;
      font-size:11px;border-radius:6px;text-align:center}
    #edgelvl-panel input:focus{outline:none;border-color:rgba(124,255,160,.45)}
    #edgelvl-panel .el-btn{width:100%;padding:11px;border:0;border-radius:7px;background:#7cffa0;
      color:#000;font-family:inherit;font-size:12.5px;font-weight:700;letter-spacing:.04em;cursor:pointer}
    #edgelvl-panel .el-btn:hover:not(:disabled){opacity:.88}
    #edgelvl-panel .el-btn:disabled{background:rgba(255,255,255,.07);
      color:rgba(255,255,255,.34);cursor:not-allowed}
    #edgelvl-panel .el-note{font-size:10px;color:rgba(255,255,255,.38);line-height:1.5}
    #edgelvl-panel .el-note.bad{color:#ff6b6b}
    #edgelvl-panel .el-x{background:none;border:0;color:rgba(255,255,255,.3);cursor:pointer;
      font-family:inherit;font-size:10px;padding:0}
    #edgelvl-panel .el-x:hover{color:#fff}
  `);

  // ── panel ─────────────────────────────────────────────────────────────────
  function buildPanel() {
    const el = document.createElement('div');
    el.id = 'edgelvl-panel';
    document.body.appendChild(el);
    return el;
  }

  function paint(html) { if (panel) panel.innerHTML = html; }

  const head = (state, cls) =>
    `<div class="el-head"><span class="el-brand">EDGELVL</span>
     <span class="el-state ${cls}">${state}</span></div>`;

  async function render() {
    const mint = currentMint;
    if (!mint) return;

    if (sentMints.has(mint)) {
      paint(head('queued', 'ok') +
        `<div class="el-line">Handed to your bot.</div>
         <button class="el-btn" disabled>✓ QUEUED</button>
         <div class="el-note">The rest lands in your Telegram.</div>`);
      return;
    }

    if (!getKey()) {
      paint(head('no key', 'warn') +
        `<div class="el-line el-dim">Paste your licence key to start.</div>
         <input id="el-key" type="text" placeholder="S-XXXXXX-XXXXXXXX-XXXXXX" autocomplete="off" spellcheck="false">
         <button class="el-btn" id="el-save">CONNECT</button>
         <div class="el-note" id="el-note">From edgelvl.app/welcome. Stored by your userscript manager, not in this page.</div>`);
      const save = async () => {
        const k = panel.querySelector('#el-key').value.trim();
        const note = panel.querySelector('#el-note');
        if (!k) { note.className = 'el-note bad'; note.textContent = 'Enter your key.'; return; }
        panel.querySelector('#el-save').textContent = 'CHECKING…';
        setKey(k);
        const res = await api('/api/journal?limit=1');
        if (res.error) {
          setKey('');
          note.className = 'el-note bad';
          note.textContent = res.error === 'bad-key'
            ? 'That key isn\'t active.' : 'Couldn\'t reach EdgeLvl — try again.';
          panel.querySelector('#el-save').textContent = 'CONNECT';
          return;
        }
        signalCache = { at: 0, byMint: {} };
        render();
      };
      panel.querySelector('#el-save').onclick = save;
      panel.querySelector('#el-key').onkeydown = e => { if (e.key === 'Enter') save(); };
      return;
    }

    const res = await getSignals();
    if (res.error === 'bad-key') {
      setKey('');
      paint(head('key rejected', 'bad') +
        `<div class="el-line el-dim">That key is no longer active.</div>
         <button class="el-btn" id="el-again">RE-ENTER KEY</button>
         <div class="el-note">Check your subscription.</div>`);
      panel.querySelector('#el-again').onclick = render;
      return;
    }

    let body, note, state, cls;
    if (res.error) {
      // The badge is a nicety; never let it block a trade.
      state = 'offline'; cls = 'warn';
      body = `<div class="el-line el-dim">Can't reach EdgeLvl to check this coin.</div>`;
      note = 'Your bot will still pick it up if it\'s running.';
    } else {
      const sig = res.data[mint];
      if (sig) {
        state = '⚡ edgelvl signal'; cls = 'ok';
        body = `<div class="el-line"><b>${esc((sig.name || '').slice(0, 24))}</b> · alerted ${ago(ageMins(sig))}</div>
                <div class="el-line el-dim">MC ${money(sig.current_mcap)} · at alert ${money(sig.alert_mcap)} · ATH ${money(sig.max_mcap)}</div>`;
        note = 'Your bot waits for a dip and a reclaim, then buys.';
      } else {
        state = 'not a signal'; cls = 'dim';
        body = `<div class="el-line el-dim">This coin didn't come from the vault.</div>`;
        note = 'Outside the signal set — the track record doesn\'t cover this one.';
      }
    }

    paint(head(state, cls) + body +
      `<button class="el-btn" id="el-go">GREENLIGHT</button>
       <div class="el-note" id="el-note">${note}</div>`);
    panel.querySelector('#el-go').onclick = onGreenlight;
  }

  async function onGreenlight() {
    const mint = currentMint;
    if (!mint) return;
    const btn = panel.querySelector('#el-go');
    btn.disabled = true;
    btn.textContent = 'SENDING…';

    const res = await api('/api/greenlight', { method: 'POST', body: JSON.stringify({ mint }) });
    if (res.error) {
      btn.disabled = false;
      btn.textContent = 'GREENLIGHT';
      const note = panel.querySelector('#el-note');
      note.className = 'el-note bad';
      note.textContent = res.error === 'bad-key'
        ? 'Key rejected — check your subscription.'
        : 'Couldn\'t reach EdgeLvl. Try again.';
      return;
    }
    sentMints.add(mint);
    render();
  }

  // ── SPA navigation: the URL changes without a page load ───────────────────
  function tick() {
    const mint = mintFromUrl();
    if (mint === currentMint) return;
    currentMint = mint;
    if (!mint) { if (panel) panel.style.display = 'none'; return; }
    if (!panel) panel = buildPanel();
    panel.style.display = 'flex';
    render();
  }

  tick();
  setInterval(tick, POLL_MS);
})();
