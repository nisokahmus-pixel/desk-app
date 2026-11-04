/* Desk · iPhone web app. Plan B: static JSON under ./d/{DATA_PATH}/, polled every 30s.
   Every FOMO link comes from coin_url / profile_url in the JSON; this file never builds one. */
(function () {
  'use strict';
  const LS = 'desk.dp', SEEN = 'desk.seen', POLL = 30000, RETRY = 15;
  // ---- one-time #d= handoff: keep it in localStorage, strip it from the URL
  (function () {
    const m = location.hash.match(/[#&]d=([^&]+)/);
    if (m) { try { localStorage.setItem(LS, decodeURIComponent(m[1])); } catch (e) {} history.replaceState(null, '', location.pathname + location.search); }
  })();
  const DP = (function () { try { return localStorage.getItem(LS); } catch (e) { return null; } })();
  const BASE = DP ? 'd/' + encodeURIComponent(DP) + '/' : null;
  const RM = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------------------------------------------------------------- data
  const cache = {};          // last good JSON per file
  const missing = new Set(); // files that returned 404 (empty, not offline)
  let lastOk = 0, failing = false, retryAt = 0, pollTimer = 0;

  async function get(name) {
    const r = await fetch(BASE + name + '?t=' + Date.now(), { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (r.status === 404) { missing.add(name); const e = new Error('404'); e.notFound = true; throw e; }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json(); cache[name] = j; missing.delete(name); return j;
  }
  function needed() {
    const n = ['state.json', 'activity.json', 'account.json', 'chart/' + ui.range + '.json'];
    const sc = route.screen;
    if (sc && sc.type === 'coin') n.push('coin/' + sc.mint + '.json');
    if (sc && sc.type === 'audit' && sc.mint) n.push('audit/' + sc.mint + '.json');
    if (route.tab === 'agents' && !sc) (cache['state.json'] ? cache['state.json'].agents.map(a => a.name) : ['scanner', 'auditor', 'analyst', 'executor', 'risk']).forEach(a => n.push('agents/' + a + '.json'));
    if (route.tab === 'account' && !sc) n.push('settings.json');
    if (route.tab === 'activity' && !sc) for (let p = 1; p <= ui.pages; p++) n.push('activity/' + p + '.json');
    return n;
  }
  async function refresh() {
    clearTimeout(pollTimer);
    if (!BASE) { render(); return; }
    const names = needed();
    const res = await Promise.allSettled(names.map(get));
    const hard = res.some((r, i) => r.status === 'rejected' && !(r.reason && r.reason.notFound && !/^(state|activity|account)\.json$/.test(names[i])));
    failing = hard; if (!hard) lastOk = Date.now();
    render();
    if (failing) { retryAt = Date.now() + RETRY * 1000; tickOffline(); pollTimer = setTimeout(refresh, RETRY * 1000); }
    else { showOffline(false); pollTimer = setTimeout(refresh, POLL); }
  }
  function tickOffline() {
    if (!failing) return;
    const n = Math.max(0, Math.ceil((retryAt - Date.now()) / 1000));
    const st = cache['state.json'];
    const last = st ? hm(st.ts) : (lastOk ? hm(lastOk / 1000) : 'never');
    showOffline(true, `Desk offline · retrying in ${n}s · last update ${last}`);
    if (n > 0) setTimeout(tickOffline, 1000);
  }
  function showOffline(on, text) { const el = $('#offline'); el.hidden = !on; if (on) el.textContent = text; }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });

  // ---------------------------------------------------------------- format
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safeUrl = u => (typeof u === 'string' && /^https:\/\//.test(u)) ? u : null;
  const hm = t => new Date(t * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const money = v => (v < 0 ? '-' : '') + '$' + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const signed = v => (v >= 0 ? '+' : '-') + '$' + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pct = v => (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
  const compact = v => v == null || v === 'n/a' ? 'n/a' : typeof v !== 'number' ? esc(v) :
    v >= 1e9 ? '$' + (v / 1e9).toFixed(2) + 'B' : v >= 1e6 ? '$' + (v / 1e6).toFixed(2) + 'M' : v >= 1e3 ? '$' + (v / 1e3).toFixed(1) + 'K' : '$' + v.toFixed(0);
  const SUB = '₀₁₂₃₄₅₆₇₈₉';
  function price(p) {
    if (p == null) return '–';
    if (p >= 1) return '$' + p.toLocaleString('en-US', { maximumFractionDigits: 4 });
    if (p >= 0.001) return '$' + p.toPrecision(4);
    const s = p.toFixed(20).slice(2); const z = s.match(/^0*/)[0].length;
    return '$0.0' + String(z).split('').map(d => SUB[+d]).join('') + s.slice(z, z + 4);
  }
  const cls = v => v > 0 ? 'up' : v < 0 ? 'down' : 'flat';
  const AG = { scanner: ['Scanner', 'cyan'], auditor: ['Auditor', ''], analyst: ['Analyst', 'yellow'], executor: ['Executor', 'green'], risk: ['Risk', 'pink'] };
  const CHEV = '<svg class="chev" viewBox="0 0 8 14"><path d="M1 1l6 6-6 6"/></svg>';
  const CHECK = '<svg viewBox="0 0 16 16"><path d="M3.5 8.5l3 3 6-7"/></svg>';
  const CROSS = '<svg viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8"/></svg>';
  const ext = (u, label, cl) => safeUrl(u) ? `<a class="${cl}" href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>` : `<span class="${cl}" aria-disabled="true">${esc(label)}</span>`;

  // ---------------------------------------------------------------- routing
  let route = { tab: 'home', screen: null };
  const ui = { range: 'LIVE', pages: 0, q: '' };
  function go(r, push = true) {
    route = r; if (push) history.pushState({ r }, ''); window.scrollTo(0, 0); syncTabs(); render(); refresh();
  }
  window.addEventListener('popstate', e => { route = (e.state && e.state.r) || { tab: 'home', screen: null }; syncTabs(); render(); refresh(); });
  history.replaceState({ r: route }, '');
  function syncTabs() { document.querySelectorAll('.tab').forEach(b => b.classList.toggle('on', b.dataset.tab === route.tab)); }
  document.getElementById('tabbar').addEventListener('click', e => {
    const b = e.target.closest('.tab'); if (!b) return;
    if (b.dataset.tab === 'activity') markSeen();
    go({ tab: b.dataset.tab, screen: null });
  });
  document.addEventListener('click', e => {
    const a = e.target.closest('[data-go]'); if (!a) return;
    e.preventDefault(); const [type, arg] = a.dataset.go.split(':');
    if (type === 'tab') { if (arg === 'activity') markSeen(); go({ tab: arg, screen: null }); }
    else if (type === 'back') history.back();
    else if (type === 'range') { ui.range = arg; render(); refresh(); }
    else if (type === 'more') { ui.pages++; refresh(); }
    else if (type === 'settings') { go({ tab: 'account', screen: null }); setTimeout(() => { const g = document.getElementById('g-' + arg); if (g) g.scrollIntoView(); }, 60); }
    else go({ tab: route.tab, screen: { type, mint: arg || null } });
  });

  // ---------------------------------------------------------------- pieces
  function markSeen() { const a = cache['activity.json']; if (a && a.rows.length) try { localStorage.setItem(SEEN, String(a.rows[0].id)); } catch (e) {} }
  function unread() {
    const a = cache['activity.json']; if (!a) return false;
    const seen = +(localStorage.getItem(SEEN) || 0);
    return a.rows.some(r => r.id > seen && r.kind !== 'rejected');
  }
  const sk = (h, w = '100%', r = 12, m = '0') => `<div class="sk" style="height:${h}px;width:${w};border-radius:${r}px;margin:${m}"></div>`;

  function offlineGate(name, body, loading) {
    if (cache[name]) return body(cache[name]);
    if (missing.has(name) && !/^(state|activity|account)\.json$/.test(name)) return null;
    return loading();
  }
  function testBanner() { const s = cache['state.json']; return s && s.testData ? '<div class="testdata">Test data · local PAPER fixture, not the live desk</div>' : ''; }

  function navbar() {
    const acc = cache['account.json'];
    const ini = acc && acc.fomoHandle ? esc(acc.fomoHandle[0].toUpperCase()) : '';
    return `<div class="nav">
      <button class="icon-btn" data-go="tab:account" aria-label="Account"><span class="avatar">${ini}</span></button>
      <button class="brand" data-go="tab:agents">Grok Bot<span>›</span></button>
      <div class="grow"></div>
      <button class="icon-btn" data-go="search" aria-label="Search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg></button>
      <button class="icon-btn" data-go="tab:activity" aria-label="Notifications"><svg viewBox="0 0 24 24"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/></svg>${unread() ? '<i class="dot"></i>' : ''}</button>
    </div>`;
  }
  function backbar(label) {
    return `<div class="nav"><button class="back" data-go="back"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>${esc(label)}</button></div>`;
  }
  function activityRow(r) {
    const ic = { bought: '↗', sold: '$', stopped: '↘', rejected: '✕' }[r.kind] || '•';
    const vc = r.kind === 'sold' ? 'up' : r.kind === 'stopped' ? 'down' : r.kind === 'rejected' ? 'sec' : '';
    const target = r.open === 'audit' ? (r.mint ? 'audit:' + r.mint : '') : (r.mint ? 'coin:' + r.mint : '');
    return `<button class="row" ${target ? `data-go="${esc(target)}"` : ''}>
      <span class="ic ${esc(r.kind)}">${ic}</span>
      <span class="mid"><div class="t">${esc(r.title)}</div><div class="s">${esc(r.subtitle)}</div></span>
      <span class="v ${vc}">${valueHtml(r.value)}</span>${CHEV}</button>`;
  }
  function valueHtml(v) { const p = String(v == null ? '' : v).split(' · '); return esc(p[0]) + (p.length > 1 ? `<small>${esc(p.slice(1).join(' · '))}</small>` : ''); }
  const actSkeleton = n => `<div class="list">${Array.from({ length: n }, () => `<div class="row">${sk(40, '40px', 20)}<span class="mid">${sk(16, '60%', 8)}${sk(13, '40%', 7, '8px 0 0')}</span>${sk(16, '56px', 8)}</div>`).join('')}</div>`;

  // ---- odometer
  let shownBalance = null;
  function odometer(el, value) {
    const str = money(value), prev = shownBalance == null ? null : money(shownBalance);
    shownBalance = value;
    const strip = '<span class="strip">' + '0123456789'.split('').map(x => `<span>${x}</span>`).join('') + '</span>';
    el.innerHTML = [...str].map(ch => /\d/.test(ch) ? `<span class="odo-d" data-d="${ch}">${strip}</span>` : `<span class="odo-s">${esc(ch)}</span>`).join('');
    el.setAttribute('aria-label', str);
    const ds = [...el.querySelectorAll('.odo-d')];
    const pd = prev ? [...prev].filter(c => /\d/.test(c)) : [];
    const animate = prev && !RM() && prev.length === str.length;
    let k = 0;
    for (let i = ds.length - 1; i >= 0; i--) {   // right to left
      const s = ds[i].firstChild, to = +ds[i].dataset.d, from = animate ? +pd[pd.length - (ds.length - i)] : to;
      s.style.transition = 'none'; s.style.transform = `translateY(${-from}em)`;
      if (from !== to) { const delay = k++ * 30; requestAnimationFrame(() => requestAnimationFrame(() => { s.style.transition = `transform 600ms cubic-bezier(.16,1,.3,1) ${delay}ms`; s.style.transform = `translateY(${-to}em)`; })); }
    }
  }

  // ---- agent card (carousel + agents tab share it)
  function agentCard(a, full) {
    const [label, color] = AG[a.name] || [a.name, ''];
    let stat = '', big = '', sub = '', body = '';
    if (a.name === 'scanner') {
      big = `${a.pools} pools`;
      const feed = (a.feed || []).slice(0, full ? 3 : 5);
      body = feed.length ? `<div class="feed">${feed.map(f => {
        const st = f.verdict === 'pass' ? 'passed' : f.verdict === 'kill' ? 'killed' : 'wait';
        const r = st === 'passed' ? '→ auditor' : esc(f.reason || f.verdict);
        return `<div class="f ${st}"><b>${esc(f.coin)}</b><span class="r">${r}</span></div>`; }).join('')}</div>`
        : '<div class="sub">Listening for graduations</div>';
    } else if (a.name === 'auditor') {
      big = `${a.takenApart} taken apart`;
      const L = a.last, strips = L ? L.strips : [];
      body = `<div class="strips">${Array.from({ length: 8 }, (_, i) => `<i class="${strips[i] === true || strips[i] === 1 ? 'ok' : strips[i] === false || strips[i] === 0 ? 'no' : ''}"></i>`).join('')}</div>`;
      if (!L) body += '<div class="sub">No coin taken apart yet</div>';
      else if (strips.length < 8 && !strips.some(s => s === false || s === 0)) body += `<div class="result sec">${esc(L.coin)} · taking apart...</div>`;
      else body += `<div class="result ${L.result === '8/8 → Executor' ? 'green' : 'red'}">${esc(L.coin)} · ${esc(L.result)}</div>`;
      body += `<div class="sub">${a.rejected} rejected</div>`;
    } else if (a.name === 'analyst') {
      big = 'Scoring'; sub = `${a.scored} scored`;
      const L = a.last;
      body = `<canvas class="ring" data-score="${L && L.score != null ? L.score : ''}"></canvas>` +
        (L ? `<div class="result ${L.passed ? 'green' : 'sec'}" style="text-align:center">${esc(L.coin)} · ${L.passed ? 'passed' : esc(L.reason || 'below min')}</div>` : '<div class="sub" style="text-align:center">Nothing scored yet</div>');
    } else if (a.name === 'executor') {
      big = `${a.trades} trades`;
      const L = a.last;
      sub = L ? `${money(L.sizeUsd)} · ${L.stackPct}% of stack` : `${a.stackPct}% of stack per trade`;
      if (L) {
        const done = L.status === 'bought', open = L.status === 'sent';
        body = `<div class="result">${esc(L.coin)}</div><div class="bar"><i style="width:${done ? 100 : open ? 50 : 0}%"></i></div>` +
          `<div class="sub ${done ? 'green' : ''}">${done ? '✓ Filled' : open ? 'Executing...' : esc(L.status)}</div>`;
      } else body = '<div class="sub">No trade yet tonight</div>';
    } else if (a.name === 'risk') {
      big = 'Guarding'; sub = `${a.guarding} open position${a.guarding === 1 ? '' : 's'}`;
      const L = a.last;
      body = (L ? `<div class="result">${/trail/i.test(L.reason || '') ? 'Trailed out' : /stop/i.test(L.reason || '') ? 'Stopped' : esc(L.reason)} · ${esc(L.coin)} <span class="${cls(L.pnlUsd)}">${signed(L.pnlUsd || 0)}</span></div>` : '') +
        `<div class="pills"><span class="pill red">stop -${a.stopPct}%</span><span class="pill green">trail ${a.trailPct}%</span></div>`;
    }
    stat = full ? '' : a.status === 'running' ? '' : a.status;
    const go = a.name === 'auditor' && a.last ? `audit:${a.last.mint}` : a.name === 'auditor' ? 'audit' : 'tab:agents';
    return `<${full ? 'div' : 'button'} class="acard${full ? ' full' : ''}" ${full ? '' : `data-go="${esc(go)}"`} style="text-align:left">
      <div class="head"><i class="sdot ${esc(a.status)}"></i><span class="name ${color}">${label}</span><span class="stat">${esc(stat)}</span></div>
      <div class="big">${esc(big)}</div>${sub ? `<div class="sub">${esc(sub)}</div>` : ''}
      <div class="body">${body}</div></${full ? 'div' : 'button'}>`;
  }
  const cardSkeleton = () => `<div class="acard"><div class="sk" style="height:20px;width:40%"></div><div class="sk" style="height:40px;width:70%;margin-top:14px"></div><div style="flex:1"></div><div class="sk" style="height:60px"></div></div>`;

  // ---------------------------------------------------------------- screens
  const line = { chart: null };
  function home() {
    const st = cache['state.json'], ch = cache['chart/' + ui.range + '.json'], act = cache['activity.json'];
    let h = navbar() + testBanner();
    if (st) {
      h += `<div class="balance-wrap"><div class="balance" id="bal"></div>${st.mode === 'PAPER' ? '<span class="paper">PAPER</span>' : ''}</div>
        <div class="today"><span class="${cls(st.todayPct)}">${pct(st.todayPct)}</span><span class="sec">today</span>
        <span class="mult ${st.multiplier < 1 ? 'down' : ''}">${st.multiplier.toFixed(2)}×</span></div>`;
    } else h += `<div class="balance-wrap">${sk(66, '62%', 14)}</div>${sk(22, '40%', 11)}`;
    if (ch) h += `<div class="chart"><canvas id="line"></canvas>${ch.points.length < 2 ? '<div class="empty-msg">Waiting for the first trade</div>' : ''}</div>`;
    else h += `<div class="chart" style="padding:0 16px">${sk(260)}</div>`;
    h += `<div class="ranges">${['LIVE', '1H', '4H', '1D', '1W', 'ALL'].map(r => `<button class="${r === ui.range ? 'on' : ''}" data-go="range:${r}">${r}</button>`).join('')}</div>`;
    h += `<div class="section"><h2>Agents <span>· ${st ? st.running + ' running' : '…'}</span></h2></div>`;
    h += `<div class="carousel" id="car">${st ? st.agents.map(a => agentCard(a)).join('') : cardSkeleton() + cardSkeleton()}</div>`;
    h += `<div class="section"><h2>Activity</h2><button class="link" data-go="tab:activity">See all</button></div>`;
    h += act ? (act.rows.length ? `<div class="list">${act.rows.slice(0, 5).map(activityRow).join('')}</div>` : '<div class="list"><div class="empty">Nothing yet tonight</div></div>') : actSkeleton(3);
    return h;
  }
  function afterHome() {
    const st = cache['state.json'], ch = cache['chart/' + ui.range + '.json'];
    if (st) odometer($('#bal'), st.balance);
    const cv = $('#line');
    if (cv && ch) { if (!line.chart) line.chart = new DeskChart.Line(cv); line.chart.c = cv; line.chart.set(ch); }
  }

  function agentsTab() {
    const st = cache['state.json'];
    let h = `<div class="nav"></div><div class="title">Agents</div>` + testBanner();
    if (!st) return h + Array.from({ length: 3 }, () => `<div class="acard full">${sk(20, '40%')}${sk(40, '60%', 12, '14px 0')}${sk(120)}</div>`).join('');
    for (const a of st.agents) {
      const d = cache['agents/' + a.name + '.json'];
      const today = { scanner: `${a.pools} pools`, auditor: `${a.takenApart} taken apart`, analyst: `${a.scored} scored`, executor: `${a.trades} trades`, risk: `${a.guarding} guarding` }[a.name];
      const paused = d ? d.paused : a.status === 'paused', locked = d && d.locked;
      let dec = '';
      if (!d) dec = sk(16, '80%', 8, '12px 0') + sk(16, '70%', 8, '12px 0');
      else if (!d.decisions.length) dec = `<div class="empty">${a.name === 'scanner' ? 'Listening for graduations' : 'No decisions yet'}</div>`;
      else dec = d.decisions.slice(0, 20).map(x => {
        const vc = /pass|bought|sent/.test(x.verdict) ? 'green' : /kill|reject|missed/.test(x.verdict) ? 'red' : 'sec';
        return `<div class="dec"><span class="tm">${hm(x.ts)}</span><span class="c">${ext(x.coin_url, x.coin, '')}<span class="vd ${vc}">${esc(x.verdict)}</span></span><span class="why">${esc(x.reason || '')}</span></div>`;
      }).join('');
      h += `<div class="acard full" id="a-${a.name}">
        <div class="head"><i class="sdot ${esc(a.status)}"></i><span class="name ${AG[a.name][1]}">${AG[a.name][0]}</span><span class="stat">${esc(a.status)} · ${esc(today)}</span></div>
        <div class="agent-foot"><span class="sec" style="font-size:15px">${locked ? 'Locked while a position is open' : paused ? 'Paused' : 'Running'}</span>
          <span class="tapwrap"><span class="switch ${paused ? '' : 'on'}" role="switch" aria-checked="${!paused}" aria-disabled="true" title="Read-only"></span></span></div>
        <div class="note">Read-only here · use “pause ${AG[a.name][0]}” in Telegram</div>
        <div style="margin-top:10px">${dec}</div>
        <div class="agent-foot"><span></span><button class="btn2" data-go="settings:${a.name}">Settings</button></div></div>`;
    }
    return h;
  }

  function activityTab() {
    const a = cache['activity.json'];
    let h = `<div class="nav"></div><div class="title">Activity</div>` + testBanner();
    if (!a) return h + actSkeleton(6);
    let rows = a.rows.slice(), next = a.next;
    for (let p = 1; p <= ui.pages; p++) { const pg = cache['activity/' + p + '.json']; if (pg) { rows = rows.concat(pg.rows); next = pg.next; } }
    if (!rows.length) return h + '<div class="list"><div class="empty">Nothing yet tonight</div></div>';
    h += `<div class="list">${rows.map(activityRow).join('')}</div>`;
    if (next != null) h += `<div class="more"><button class="btn2" data-go="more">Load more</button></div>`;
    return h;
  }

  const beamDone = {};
  function auditScreen(mint) {
    const name = 'audit/' + mint + '.json';
    let h = backbar('Back');
    const d = mint ? cache[name] : null;
    if (!mint || missing.has(name) || (d && !d.layers.length)) return h + `<div class="title">Auditor</div><div class="list"><div class="empty">No coin taken apart yet</div></div>`;
    if (!d) return h + sk(34, '50%', 10, '6px 0 14px') + `<div style="width:220px;margin:22px auto">${Array.from({ length: 8 }, () => sk(26, '100%', 13, '0 0 4px')).join('')}</div>` + `<div class="list">${Array.from({ length: 8 }, () => `<div class="layer">${sk(16, '100%', 8)}</div>`).join('')}</div>`;
    const N = 8, byN = {}; d.layers.forEach(l => byN[l.n] = l);
    h += `<div class="coin-h"><h1>${esc(d.coin)}</h1></div><div class="meta">Taken apart ${d.ts ? hm(d.ts) : ''}</div>`;
    h += `<div class="discs" id="discs">${Array.from({ length: N }, (_, i) => `<div class="disc" data-i="${i}"></div>`).join('')}<div class="beam" id="beam"></div></div>`;
    h += `<div class="verdict" id="verdict" hidden><div class="h ${d.result === 'cleared' ? 'ok' : 'no'}">${esc(d.headline)}</div><div class="sb">${esc(d.sub)}</div></div>`;
    h += `<div class="list">${Array.from({ length: N }, (_, i) => {
      const l = byN[i + 1];
      return `<div class="layer" data-li="${i}"><span class="k"></span><span class="n">${esc(l ? l.name : 'Layer ' + (i + 1))}</span><span class="val ${l ? '' : 'wait'}">${l ? esc(l.value == null ? 'not checked' : l.value) : 'waiting'}</span></div>`; }).join('')}</div>`;
    h += `<div class="list" style="margin-top:14px"><div class="toggle-row"><span>Take apart before buying</span><span class="tapwrap"><span class="switch ${d.enabled ? 'on' : ''}" role="switch" aria-checked="${!!d.enabled}" aria-disabled="true"></span></span></div></div>
      <div class="note" style="margin:6px 16px 0">Read-only here · change it in Telegram with “set auditor.enabled”, turning it off asks twice</div>`;
    h += ext(d.coin_url, 'Open on FOMO', 'cta');
    return h;
  }
  function afterAudit(mint) {
    const d = cache['audit/' + mint + '.json']; if (!d || !d.layers.length) return;
    const byN = {}; d.layers.forEach(l => byN[l.n] = l);
    const discs = [...document.querySelectorAll('.disc')], rows = [...document.querySelectorAll('.layer')], beam = $('#beam');
    const paint = i => {
      const l = byN[i + 1]; if (!l || l.pass == null) return;
      discs[i].classList.add(l.pass ? 'ok' : 'no'); discs[i].innerHTML = l.pass ? CHECK : CROSS;
      const k = rows[i].querySelector('.k'); k.classList.add(l.pass ? 'ok' : 'no'); k.innerHTML = l.pass ? CHECK : CROSS;
    };
    // how many layers the server has sent, contiguous from the top
    let have = 0; while (byN[have + 1] && byN[have + 1].pass != null) { have++; if (byN[have].pass === false) break; }
    const stopRed = d.layers.some(l => l.pass === false);
    const complete = d.result != null && (have === 8 || stopRed);
    const showVerdict = () => { const v = $('#verdict'); if (complete && v) v.hidden = false; };
    const start = beamDone[mint] || 0;
    for (let i = 0; i < start; i++) paint(i);
    if (RM() || start >= have) { for (let i = start; i < have; i++) paint(i); beamDone[mint] = have; if (have >= start) showVerdict(); waitAt(have); return; }
    function waitAt(i) { if (!complete && i < 8 && !RM()) { beam.classList.add('on'); beam.style.transition = 'none'; beam.style.top = (discs[i].offsetTop + 12) + 'px'; } }
    let i = start;
    beam.style.transition = 'none'; beam.style.top = (discs[i].offsetTop + 2) + 'px'; beam.classList.add('on');
    const stepFn = () => {
      if (i >= have) { beamDone[mint] = have; if (complete) { beam.classList.remove('on'); setTimeout(showVerdict, 150); } else waitAt(have); return; }
      const disc = discs[i];
      beam.style.transition = 'top 350ms linear'; beam.style.top = (disc.offsetTop + disc.offsetHeight - 2) + 'px';
      setTimeout(() => { if (!disc.isConnected) return; paint(i); i++; beamDone[mint] = i; setTimeout(stepFn, 150); }, 350);
    };
    requestAnimationFrame(() => requestAnimationFrame(stepFn));
  }

  function coinScreen(mint) {
    const name = 'coin/' + mint + '.json'; const d = cache[name], st = cache['state.json'];
    let h = backbar('Back');
    if (missing.has(name)) {
      const known = findCoin(mint);
      return h + `<div class="coin-h"><h1>${esc(known ? known.coin : mint.slice(0, 4) + '…' + mint.slice(-4))}</h1></div>
        <div class="list" style="margin-top:14px"><div class="empty">Not on the desk tonight · no price data for this coin</div></div>` + (known ? ext(known.coin_url, 'Buy on FOMO', 'cta') : '');
    }
    if (!d) return h + sk(34, '55%', 10, '6px 0') + sk(16, '40%', 8, '8px 0') + sk(56, '60%', 12, '16px 0') + sk(280, '100%', 12, '16px 0') + `<div class="stats">${'<div>' + sk(40) + '</div>'.repeat(1)}</div>`;
    const age = d.ageH == null ? '' : d.ageH < 1 ? ` · ${Math.round(d.ageH * 60)}m old` : ` · ${Math.round(d.ageH)}h old`;
    h += `<div class="coin-h"><h1>${esc(d.name || d.symbol || mint.slice(0, 4) + '…')}</h1>${st && st.mode === 'PAPER' ? '<span class="paper">PAPER</span>' : ''}
      ${d.shield ? `<span class="chip"><svg viewBox="0 0 16 16"><path d="M8 1l6 2.5v4c0 3.6-2.5 6.3-6 7.5-3.5-1.2-6-3.9-6-7.5v-4z"/></svg>${esc(d.shield)}</span>` : ''}</div>
      <div class="meta">${esc(d.symbol || '')} · ${esc(d.chain)}${age}</div>
      <div class="price">${price(d.price)}</div>`;
    if (d.sinceEntryPct != null) h += `<div class="${cls(d.sinceEntryPct)}" style="font-size:17px;font-weight:500">${d.sinceEntryPct >= 0 ? '▲' : '▼'} ${Math.abs(d.sinceEntryPct).toFixed(2)}% since entry</div>`;
    h += `<div class="candles"><canvas id="cdl"></canvas></div>`;
    const s = d.stats || {};
    h += `<div class="stats"><div><div class="l">Market cap</div><div class="b">${compact(s.marketCap)}</div></div><div><div class="l">Liquidity</div><div class="b">${compact(s.liquidityUsd)}</div></div>
      <div><div class="l">24h volume</div><div class="b">${compact(s.volume24h)}</div></div><div><div class="l">Holders</div><div class="b">${typeof s.holders === 'number' ? s.holders.toLocaleString('en-US') : esc(s.holders || 'n/a')}</div></div></div>`;
    if (d.position) {
      const p = d.position;
      h += `<div class="card"><h3>Your position · ${money(p.sizeUsd)} in · ${esc(p.agent)}</h3>
        <div class="kv"><span>Entry</span><span>${price(p.entryPrice)}</span></div><div class="kv"><span>Opened</span><span>${hm(p.openedAt)}</span></div></div>`;
    }
    if (d.position && d.exit) {
      const x = d.exit, left = Math.max(0, x.timeoutAt - Date.now() / 1000);
      h += `<div class="card"><h3><span class="legend"></span>Exit</h3>
        <div class="kv"><span>Stop line</span><span class="red">${price(x.stopPrice)} · -${x.stopPct}%</span></div>
        <div class="kv"><span>Trail line</span><span class="${x.trailActive ? 'green' : 'sec'}">${x.trailActive ? price(x.trailPrice) + ' · ' + x.trailPct + '% below peak' : 'starts at ' + price(x.trailStartPrice)}</span></div>
        <div class="kv"><span>Time left</span><span>${Math.floor(left / 3600)}h ${String(Math.floor(left % 3600 / 60)).padStart(2, '0')}m</span></div></div>`;
    }
    h += ext(d.coin_url, d.button, 'cta' + (d.position ? ' sell' : ''));
    return h;
  }
  function afterCoin(mint) {
    const d = cache['coin/' + mint + '.json'], cv = $('#cdl');
    if (d && cv) DeskChart.candles(cv, d.candles, d.position && d.exit ? d.exit.exitLine : null, price);
  }

  function knownCoins() {
    const out = new Map(), add = (mint, coin, url) => { if (mint && !out.has(mint)) out.set(mint, { mint, coin, coin_url: url }); };
    const st = cache['state.json'];
    if (st) st.agents.forEach(a => { (a.feed || []).forEach(f => add(f.mint, f.coin, f.coin_url)); if (a.last) add(a.last.mint, a.last.coin, null); });
    Object.keys(cache).forEach(k => {
      const v = cache[k];
      if (/^activity/.test(k)) v.rows.forEach(r => add(r.mint, r.title.replace(/^(Bought|Sold|Stopped|Rejected)\s+/, ''), r.coin_url));
      if (/^agents\//.test(k)) v.decisions.forEach(x => add(x.mint, x.coin, x.coin_url));
      if (/^coin\//.test(k)) add(v.mint, v.symbol || v.name, v.coin_url);
    });
    return [...out.values()];
  }
  const findCoin = m => knownCoins().find(c => c.mint === m);
  function searchScreen() {
    return backbar('Back') + `<label class="search"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(235,235,245,.6)" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>
      <input id="q" placeholder="Name, symbol or mint" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(ui.q)}"></label><div id="res"></div>`;
  }
  function afterSearch() {
    const q = $('#q'), res = $('#res');
    const run = () => {
      ui.q = q.value.trim(); const s = ui.q.toLowerCase();
      if (!s) { res.innerHTML = ''; return; }
      const hits = knownCoins().filter(c => (c.coin || '').toLowerCase().includes(s) || c.mint.toLowerCase().startsWith(s) || c.mint === ui.q);
      let html = hits.slice(0, 20).map(c => `<button class="row" data-go="coin:${esc(c.mint)}"><span class="ic rejected">${esc((c.coin || '?')[0])}</span><span class="mid"><div class="t">${esc(c.coin)}</div><div class="s">${esc(c.mint.slice(0, 6) + '…' + c.mint.slice(-6))}</div></span>${CHEV}</button>`).join('');
      if (!hits.length && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(ui.q)) html = `<button class="row" data-go="coin:${esc(ui.q)}"><span class="mid"><div class="t">Open this mint</div><div class="s">${esc(ui.q.slice(0, 6) + '…' + ui.q.slice(-6))}</div></span>${CHEV}</button>`;
      res.innerHTML = html ? `<div class="list">${html}</div>` : '<div class="empty">No coin tonight matches</div>';
    };
    q.addEventListener('input', run); run(); if (!ui.focused) { q.focus(); ui.focused = true; }
  }

  function accountTab() {
    const a = cache['account.json'], s = cache['settings.json'];
    let h = `<div class="nav"></div><div class="title">Account</div>` + testBanner();
    if (!a) return h + `<div class="list">${Array.from({ length: 4 }, () => `<div class="row">${sk(18, '70%', 9)}</div>`).join('')}</div>`;
    h += `<div class="list plain">
      <div class="toggle-row"><span>Mode</span><span class="seg" style="width:160px"><span class="${a.mode === 'PAPER' ? 'on' : ''}">PAPER</span><span class="${a.mode === 'LIVE' ? 'on' : ''}">LIVE</span></span></div>
      <div class="row"><span class="mid"><div class="t">Stack</div></span><span class="v">${money(a.stack)}</span></div>
      ${safeUrl(a.profile_url) ? `<a class="row" href="${esc(a.profile_url)}" target="_blank" rel="noopener noreferrer"><span class="mid"><div class="t">Your FOMO profile</div><div class="s">@${esc(a.fomoHandle)}</div></span>${CHEV}</a>` : `<div class="row"><span class="mid"><div class="t">Your FOMO profile</div><div class="s">No handle set</div></span></div>`}
    </div>
    <div class="note" style="margin:8px 16px 0">Read-only on this phone. Change anything with a Telegram command: “paper”, “live”, “stack 1240”, “set stop to -8%”.</div>
    <div class="group-t">Notifications</div>
    <div class="list plain">
      <div class="row"><span class="mid"><div class="t">Telegram</div></span><span class="v ${a.telegram && a.telegram.connected ? 'green' : 'sec'}">${a.telegram && a.telegram.connected ? 'Connected' : 'Not connected'}</span></div>
      <div class="row"><span class="mid"><div class="t">Send test push</div><div class="s">Send “status” to the bot in Telegram</div></span></div>
      <div class="row"><span class="mid"><div class="t">Web push</div><div class="s">${esc(a.webPush)}</div></span></div>
    </div>`;
    if (!s) return h + `<div class="group-t">Settings</div><div class="list">${Array.from({ length: 5 }, () => `<div class="setting">${sk(18, '80%', 9)}</div>`).join('')}</div>`;
    const order = ['scanner', 'auditor', 'analyst', 'executor', 'risk', 'desk'];
    for (const g of order.filter(g => s.groups[g]).concat(Object.keys(s.groups).filter(g => !order.includes(g)))) {
      h += `<div class="group-t" id="g-${esc(g)}">${esc(g[0].toUpperCase() + g.slice(1))}</div><div class="list">`;
      for (const e of s.groups[g]) {
        const short = e.key.split('.').slice(1).join('.');
        let ctl;
        if (typeof e.value === 'boolean' || e.value === 'true' || e.value === 'false') {
          const on = e.value === true || e.value === 'true';
          ctl = `<div class="top"><span class="key">${esc(short)}</span><span class="switch ${on ? 'on' : ''}" role="switch" aria-checked="${on}" aria-disabled="true"></span></div>`;
        } else if (e.options) {
          ctl = `<div class="top"><span class="key">${esc(short)}</span><span class="seg">${e.options.map(o => `<span class="${String(o) === String(e.value) ? 'on' : ''}">${esc(o)}</span>`).join('')}</span></div>`;
        } else if (e.min != null) {
          ctl = `<div class="top"><span class="key">${esc(short)}</span><span class="numf">${esc(e.value)}</span></div>
            <input type="range" min="${e.min}" max="${e.max}" step="any" value="${esc(e.value)}" disabled aria-label="${esc(short)}">`;
        } else ctl = `<div class="top"><span class="key">${esc(short)}</span><span class="numf">${esc(e.value == null ? '–' : e.value)}</span></div>`;
        h += `<div class="setting">${ctl}<div class="def">default ${esc(e.default)}${e.min != null ? ` · ${esc(e.min)} to ${esc(e.max)}` : ''}</div></div>`;
      }
      h += '</div>';
    }
    return h;
  }

  function noLink() {
    return `<div class="nav"></div><div class="title">Desk</div><div class="list"><div class="empty">Open your private desk link once on this phone.<br>It ends in #d=… and is only in your Telegram.</div></div>`;
  }

  // ---------------------------------------------------------------- render
  let lastKey = '', lastSnap = '';
  function render() {
    const v = $('#view'), sc = route.screen;
    const key = JSON.stringify(route);
    if (sc && sc.type === 'search' && lastKey === key) return;      // don't clobber typing
    const snap = key + '|' + needed().map(n => n + (cache[n] ? JSON.stringify(cache[n]) : missing.has(n) ? '404' : '-')).join('|') + ui.range + ui.pages;
    if (snap === lastSnap) return;
    lastSnap = snap;
    const car = $('#car'), carX = car ? car.scrollLeft : 0, y = window.scrollY;
    let html;
    if (!BASE) html = noLink();
    else if (sc && sc.type === 'coin') html = coinScreen(sc.mint);
    else if (sc && sc.type === 'audit') html = auditScreen(sc.mint);
    else if (sc && sc.type === 'search') html = searchScreen();
    else html = { home, agents: agentsTab, activity: activityTab, account: accountTab }[route.tab]();
    v.innerHTML = html;
    if (lastKey === key) { window.scrollTo(0, y); const c2 = $('#car'); if (c2) c2.scrollLeft = carX; }
    if (sc && sc.type === 'search') ui.focused = false;
    lastKey = key;
    if (!BASE) return;
    if (!sc && route.tab === 'home') afterHome();
    if (sc && sc.type === 'coin') afterCoin(sc.mint);
    if (sc && sc.type === 'audit' && sc.mint) afterAudit(sc.mint);
    if (sc && sc.type === 'search') afterSearch();
    document.querySelectorAll('canvas.ring').forEach(c => DeskChart.ring(c, c.dataset.score === '' ? null : +c.dataset.score));
  }
  let rz = 0; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (line.chart && line.chart.data) line.chart.draw(); const sc = route.screen; if (sc && sc.type === 'coin') afterCoin(sc.mint); }, 100); });

  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  render(); refresh();
})();
