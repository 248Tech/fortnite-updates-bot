/* Fortnite Updates Bot demo: a Discord-style chat that runs the bot's command logic in the browser.
   Sample news data is fictional. Nothing is sent anywhere. */
(function () {
  'use strict';
  const $ = (s, r) => (r || document).querySelector(s), $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ENV_LANG = 'en', MODES = { br: 'Battle Royale', stw: 'Save the World', cre: 'Creative' };
  const cfg = { command_prefix: '!', language: null, default_mode: 'br', slash_ephemeral: false };
  const env = { manage: true, fail: false, slow: false };
  const reqLog = [];

  /* ---------- fictional sample news (per language / mode) ---------- */
  const G = (a, b) => `linear-gradient(135deg,${a},${b})`;
  const NEWS = {
    en: {
      br: [
        { title: 'Season Launch: Neon Frontier', category: 'Season', body: 'A new season arrives with a rebuilt desert region, fresh movement options and a 100-tier reward track. Update size is about 18 GB on PC.', image: G('#7c3aed', '#06b6d4') },
        { title: 'Item Shop Rotation', category: 'Shop', body: 'Daily Item Shop refreshes at 00:00 UTC. This week features three themed bundles and returning emotes.', image: G('#f97316', '#ec4899') },
        { title: 'Balance Changes v1.04', category: 'Patch notes', body: 'Assault rifle spread reduced slightly. Shotgun pellet damage normalised across rarities. Fixed a bug where vehicles could clip through bridges.' },
        { title: 'Weekend Event: Double XP', category: 'Event', body: 'Squad up for 2x XP from Friday 18:00 UTC until Monday 06:00 UTC. Includes bonus quests with exclusive spray rewards.' },
        { title: 'Server Maintenance Window', category: 'Status', body: 'Matchmaking will be briefly unavailable on Tuesday for backend upgrades. Expect roughly 30 minutes of downtime.' },
      ],
      stw: [
        { title: 'Storm Shield Defense Rotation', category: 'Missions', body: 'New Storm Shield Defense missions are live with boosted rewards for completing all three objectives.', image: G('#2563eb', '#22c55e') },
        { title: 'Hero Loadout Rebalance', category: 'Patch notes', body: 'Outlander and Constructor perks adjusted for better late-game scaling. Trap damage tooltips corrected.' },
        { title: 'Llama Sale', category: 'Shop', body: 'Limited-time Llama bundle discounts available until the next reset.' },
      ],
      cre: [
        { title: 'Featured Island: Skyline Sprint', category: 'Creative', body: 'A community parkour island with 40 checkpoints and a weekly leaderboard takes the spotlight this week.', image: G('#14b8a6', '#6366f1') },
        { title: 'Creator Tools Update', category: 'Tools', body: 'New prop galleries, improved snapping and faster publishing validation for island creators.' },
        { title: 'Build Contest', category: 'Event', body: 'Submit your island by Sunday for a chance to be featured on the discovery page.' },
      ],
    },
    fr: { br: [{ title: 'Lancement de saison : Neon Frontier', category: 'Saison', body: 'Une nouvelle saison arrive avec une région désertique reconstruite et une piste de récompenses de 100 paliers.', image: G('#7c3aed', '#06b6d4') }, { title: 'Rotation de la boutique', category: 'Boutique', body: 'La boutique se rafraîchit chaque jour à 00h00 UTC avec trois lots thématiques.' }] },
    es: { br: [{ title: 'Lanzamiento de temporada: Neon Frontier', category: 'Temporada', body: 'Llega una nueva temporada con una región desértica reconstruida y un pase de 100 niveles.', image: G('#7c3aed', '#06b6d4') }, { title: 'Rotación de la tienda', category: 'Tienda', body: 'La tienda se actualiza a diario a las 00:00 UTC con tres lotes temáticos.' }] },
    de: { br: [{ title: 'Saisonstart: Neon Frontier', category: 'Saison', body: 'Eine neue Saison startet mit einer neu gebauten Wüstenregion und 100 Belohnungsstufen.', image: G('#7c3aed', '#06b6d4') }] },
  };

  /* ---------- port of embeds.py ---------- */
  function shorten(text, max) {
    text = String(text || '').trim().split(/\s+/).join(' '); if (text.length <= max) return text;
    const ph = '…', words = text.split(' '); let out = '';
    for (const w of words) { const next = out ? out + ' ' + w : w; if (next.length + ph.length > max) break; out = next; }
    return (out || '') + ph;
  }
  function buildNewsEmbed(mode, lang, items) {
    const title = `Fortnite ${MODES[mode] || 'Battle Royale'} Updates`, description = `Source: FortniteAPI.io • Language: ${lang}`;
    const e = { title, description, color: '', fields: [], image: null }; let total = title.length + description.length;
    items.slice(0, 25).forEach((it, i) => {
      const t = shorten(it.title || 'Untitled', 256); let v = (it.body || '').trim(); if (it.category) v = v ? `[${it.category}] ${v}` : `[${it.category}]`; v = shorten(v, 1024);
      const projected = total + t.length + v.length; if (projected > 6000 - 100) return;
      e.fields.push({ name: `${i + 1}. ${t}`, value: v || '—' }); total = projected; if (!e.image && it.image) e.image = it.image;
    });
    return e;
  }

  /* ---------- simulated FortniteAPI.io client ---------- */
  function fetchNews(mode, lang) {
    const t0 = performance.now(), ms = env.slow ? 12000 : 140 + Math.round(Math.random() * 160);
    return new Promise((res, rej) => setTimeout(() => {
      const url = `GET https://fortniteapi.io/v2/news?lang=${lang}`;
      if (env.fail) { reqLog.unshift({ url, st: 'HTTP 503', ok: false, ms: Math.round(ms) }); return rej(new Error('HTTP 503: {"result":false,"error":"Service Unavailable"}')); }
      if (env.slow) { reqLog.unshift({ url, st: 'timeout', ok: false, ms: 10000 }); return rej(new Error('Request timed out')); }
      reqLog.unshift({ url, st: '200 OK', ok: true, ms: Math.round(ms) }); res(((NEWS[lang] || {})[mode]) || []);
    }, env.slow ? 900 : Math.min(ms, 700)));
  }

  /* ---------- chat model ---------- */
  const msgs = []; let nid = 1;
  const nowT = () => new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const add = (m) => { m.id = nid++; m.time = nowT(); msgs.push(m); paint(); return m; };
  const BOT = { name: 'Fortnite Updates', color: '#5865f2', bot: true }, ME = { name: 'DemoAdmin', color: '#ed4245', bot: false };
  const embedHTML = (e) => `<div class="embed ${e.cls || ''}" ${e.hex ? `style="border-color:${e.hex}"` : ''}><div class="t">${esc(e.title)}</div>${e.description ? `<div class="d">${esc(e.description)}</div>` : ''}${(e.fields || []).map((f) => `<div class="f"><b>${esc(f.name)}</b><span>${esc(f.value)}</span></div>`).join('')}${e.image ? `<div class="img" style="background:${e.image}">sample image from the first news item</div>` : ''}</div>`;
  function paint() {
    const box = $('#msgs'); if (!box) return;
    box.innerHTML = msgs.map((m) => `<div class="msg ${m.eph ? 'ephm' : ''}"><div class="av" style="background:${m.who.color}">${esc(m.who.name[0])}</div><div>${m.used ? `<div class="used"><b>${esc(ME.name)}</b> used <i>${esc(m.used)}</i></div>` : ''}<div class="h"><b>${esc(m.who.name)}${m.who.bot ? '<span class="tag">APP</span>' : ''}</b><small>${m.time}</small></div>${m.text ? `<div>${m.html ? m.text : esc(m.text)}</div>` : ''}${m.embed ? embedHTML(m.embed) : ''}${m.eph ? '<div class="eph">👁 Only you can see this</div>' : ''}</div></div>`).join('');
    box.scrollTop = box.scrollHeight; side();
  }

  /* ---------- command handling (mirrors bot.py) ---------- */
  const lang = () => ((cfg.language || ENV_LANG).trim() || 'en');
  const code = (s) => `<code class="mono" style="background:#1e1f22;padding:0 4px;border-radius:3px">${esc(s)}</code>`;
  async function handleUpdates(mode, via, usedLabel) {
    const typing = $('#typing'); typing.textContent = 'Fortnite Updates is thinking…';
    let embed;
    try {
      const items = await fetchNews(mode, lang());
      embed = items.length ? buildNewsEmbed(mode, lang(), items) : { title: 'Fortnite Updates', description: `No news found for type '${mode.toUpperCase()}' (language: ${lang()}).`, hex: '#e67e22' };
    } catch (err) { embed = { title: 'Fortnite Updates - Error', description: `Failed to fetch news: ${err.message}`, hex: '#e74c3c' }; }
    typing.textContent = '';
    add({ who: BOT, embed, used: via === 'slash' ? usedLabel : null, eph: via === 'slash' && cfg.slash_ephemeral });
  }
  const reply = (text, via, label, html) => add({ who: BOT, text, html: !!html, used: via === 'slash' ? label : null, eph: via === 'slash' });
  const needAdmin = (via, label) => { if (env.manage) return true; if (via === 'slash') add({ who: { name: 'Discord', color: '#4e5058', bot: true }, text: 'The application did not respond', used: label, eph: true }); else logLine('MissingPermissions: setup command ignored (no reply sent)', false); return false; };
  const cmdLog = [];
  function logLine(t, ok) { cmdLog.unshift({ t, ok }); side(); }

  async function run(raw) {
    const input = raw.trim(); if (!input) return;
    add({ who: ME, text: input });
    const slash = input.startsWith('/'), p = cfg.command_prefix;
    if (!slash && !input.startsWith(p)) { logLine('(ignored: not a command)', true); return; }
    const tokens = (slash ? input.slice(1) : input.slice(p.length)).split(/\s+/).filter(Boolean), name = (tokens.shift() || '').toLowerCase();
    const arg = (tokens.join(' ') || '').replace(/^\w+:/, '');
    if (name === 'fortnite_updates') {
      let mode = 'br'; const a = (tokens[0] || '').replace(/^type:/, '').toLowerCase();
      if (a) { if (['br', 'stw', 'cre'].includes(a)) mode = a; }
      logLine(`${slash ? '/' : p}fortnite_updates → mode=${mode}`, true); return handleUpdates(mode, slash ? 'slash' : 'legacy', '/fortnite_updates');
    }
    if (slash && name === 'config') {
      const sub = (tokens.shift() || '').toLowerCase(), v = tokens.join(' ').replace(/^\w+:/, '').trim(), label = '/config ' + sub;
      if (!needAdmin('slash', label)) return;
      if (sub === 'show') { logLine('/config show', true); return add({ who: BOT, used: label, eph: true, embed: { title: 'Bot Configuration', description: `Prefix: \`${cfg.command_prefix}\`\nLanguage: \`${cfg.language || ENV_LANG}\` (None means .env default)\nDefault mode: \`${cfg.default_mode}\`\nSlash ephemeral: \`${cfg.slash_ephemeral}\``, hex: '#2ecc71' } }); }
      if (sub === 'set_language') { cfg.language = v || null; logLine('/config set_language', true); return reply(`Language set to: \`${cfg.language || ENV_LANG}\``, 'slash', label); }
      if (sub === 'set_default_mode') { if (!['br', 'stw', 'cre'].includes(v.toLowerCase())) return reply('Choose one of: br, stw, cre.', 'slash', label); cfg.default_mode = v.toLowerCase(); logLine('/config set_default_mode', true); return reply(`Default mode set to: \`${cfg.default_mode}\``, 'slash', label); }
      if (sub === 'set_ephemeral') { if (!['true', 'false'].includes(v.toLowerCase())) return reply('Enter true or false.', 'slash', label); cfg.slash_ephemeral = v.toLowerCase() === 'true'; logLine('/config set_ephemeral', true); return reply(`Slash ephemeral set to: \`${cfg.slash_ephemeral}\``, 'slash', label); }
      if (sub === 'set_prefix') { if (!v) return reply('Prefix cannot be empty.', 'slash', label); cfg.command_prefix = v; logLine('/config set_prefix', true); return reply(`Prefix set to: \`${cfg.command_prefix}\``, 'slash', label); }
      return reply('Unknown /config subcommand. Try show, set_language, set_default_mode, set_ephemeral or set_prefix.', 'slash', label);
    }
    if (!slash) {
      const legacy = { setprefix: () => { if (!arg) return reply('Prefix cannot be empty.'); cfg.command_prefix = arg; return reply(`Prefix set to \`${cfg.command_prefix}\``); }, setlang: () => { cfg.language = arg.trim() || null; return reply(`Language set to \`${cfg.language || ENV_LANG}\``); }, setmode: () => { const m = arg.toLowerCase().trim(); if (!['br', 'stw', 'cre'].includes(m)) return reply('Invalid mode. Use br, stw, or cre.'); cfg.default_mode = m; return reply(`Default mode set to \`${cfg.default_mode}\``); }, setephemeral: () => { const v = arg.toLowerCase().trim(); if (!['true', 'false'].includes(v)) return reply(`Usage: ${cfg.command_prefix}setephemeral true|false`); cfg.slash_ephemeral = v === 'true'; return reply(`Slash ephemeral set to \`${cfg.slash_ephemeral}\``); } }[name];
      if (legacy) { if (!needAdmin('legacy')) return; logLine(p + name, true); return legacy(); }
    }
    logLine('(ignored: unknown command)', true);
  }

  /* ---------- slash autocomplete ---------- */
  const SLASH = [
    ['/fortnite_updates', 'type: br | stw | cre', 'Show Fortnite updates (news) for BR, STW, or Creative.'],
    ['/fortnite_updates type:br', '', 'Battle Royale'], ['/fortnite_updates type:stw', '', 'Save the World'], ['/fortnite_updates type:cre', '', 'Creative'],
    ['/config show', '', 'Show current bot configuration'], ['/config set_language', 'lang', 'Set preferred language code'], ['/config set_default_mode', 'mode', 'Set default news mode'],
    ['/config set_ephemeral', 'enabled', 'Set whether slash responses are ephemeral'], ['/config set_prefix', 'prefix', 'Set command prefix for legacy commands'],
  ];
  let sel = 0, shown = [];
  function menu() {
    const inp = $('#in'), m = $('#menu'), v = inp.value; if (!v.startsWith('/')) { m.hidden = true; return; }
    shown = SLASH.filter((s) => s[0].startsWith(v.toLowerCase().split(' ').slice(0, 2).join(' ')) || s[0].startsWith(v.toLowerCase())).slice(0, 8); if (!shown.length) { m.hidden = true; return; }
    sel = Math.min(sel, shown.length - 1); m.hidden = false;
    m.innerHTML = '<div class="hd">Commands</div>' + shown.map((s, i) => `<div class="it ${i === sel ? 'sel' : ''}" data-i="${i}"><b>${esc(s[0])}</b><small>${esc(s[1])}</small><small>${esc(s[2])}</small></div>`).join('');
    $$('.it', m).forEach((el) => el.addEventListener('mousedown', (e) => { e.preventDefault(); pickMenu(+el.dataset.i); }));
  }
  function pickMenu(i) { const s = shown[i]; if (!s) return; const inp = $('#in'); inp.value = s[0] + (/set_|type:/.test(s[0]) && !s[0].endsWith('type:br') && !/type:(stw|cre)$/.test(s[0]) ? ' ' : ''); $('#menu').hidden = true; inp.focus(); }

  /* ---------- side panel ---------- */
  function side() {
    const p = $('#panel'); if (!p) return;
    p.innerHTML = `<h3>bot_config.json</h3><pre>${esc(JSON.stringify(cfg, null, 2))}</pre>
    <p style="font-size:.74rem;color:var(--muted);margin:.4rem 0 0">Saved on every change. The current command handlers fall back to <b>br</b> when no type is given.</p>
    <h3>Simulate</h3>
    <div class="row"><span>Manage Server permission</span><button class="sw ${env.manage ? 'on' : ''}" data-t="manage" aria-label="Manage Server permission"></button></div>
    <div class="row"><span>FortniteAPI.io returns 503</span><button class="sw ${env.fail ? 'on' : ''}" data-t="fail" aria-label="Simulate API error"></button></div>
    <div class="row"><span>API timeout (10 s)</span><button class="sw ${env.slow ? 'on' : ''}" data-t="slow" aria-label="Simulate timeout"></button></div>
    <h3>Request pipeline</h3><div class="flow"><div class="${cmdLog[0] ? 'hit' : ''}"><span>bot.py</span><small>command → handler</small></div><div class="${reqLog[0] ? 'hit' : ''}"><span>fortnite_api.py</span><small>aiohttp · 10 s timeout</small></div><div class="${msgs.some((m) => m.embed) ? 'hit' : ''}"><span>embeds.py</span><small>≤ 25 fields · ≤ 6000 chars</small></div><div><span>config_manager.py</span><small>bot_config.json</small></div></div>
    <h3>API log</h3><div class="log">${reqLog.slice(0, 5).map((r) => `<div class="${r.ok ? 'ok' : 'er'}">${esc(r.url)} → ${r.st} (${r.ms} ms)</div>`).join('') || '<div>No requests yet.</div>'}</div>
    <h3>Command log</h3><div class="log">${cmdLog.slice(0, 6).map((r) => `<div class="${r.ok ? 'ok' : 'er'}">${esc(r.t)}</div>`).join('') || '<div>—</div>'}</div>`;
    $$('[data-t]', p).forEach((b) => b.addEventListener('click', () => { env[b.dataset.t] = !env[b.dataset.t]; side(); }));
  }

  /* ---------- boot ---------- */
  const root = $('#app');
  root.innerHTML = `<div class="app"><nav class="rail" aria-label="Servers"><div class="s on"><img src="../assets/favicon.png" alt="Demo server"></div><div class="s">+</div></nav>
  <aside class="side"><h2>Demo Server ▾</h2><div class="chan"><div class="cat">Text channels</div><a class="on" href="#"># fortnite-news</a><a href="#" tabindex="-1"># general</a><a href="#" tabindex="-1"># squad-finder</a></div><div class="me"><div class="av" style="background:#ed4245">D</div><div><b>DemoAdmin</b><small>Manage Server ✔</small></div></div></aside>
  <section class="main"><div class="bar"><b># fortnite-news</b><span>Slash and prefix commands for the Fortnite Updates bot</span><span class="sp"></span><span class="demo-b">Interactive demo · fictional sample news · nothing is sent</span><a href="https://github.com/248Tech/fortnite-updates-bot" target="_blank" rel="noopener">Source ↗</a><a href="../">← Overview</a></div>
  <div class="msgs" id="msgs" role="log" aria-live="polite"></div><div class="typing" id="typing" aria-live="polite"></div>
  <div class="chips" id="chips"></div>
  <form class="composer" id="form" autocomplete="off"><div class="menu" id="menu" hidden></div><div class="cbox"><input id="in" aria-label="Message #fortnite-news" placeholder="Message #fortnite-news — try /fortnite_updates" autocomplete="off"><button type="submit">Send</button></div></form></section>
  <aside class="panel" id="panel" aria-label="Bot internals"></aside></div>`;
  const chips = [['/fortnite_updates', '/fortnite_updates'], ['/fortnite_updates type:stw', 'Save the World'], ['!fortnite_updates cre', '!fortnite_updates cre'], ['/config set_language fr', 'Language: fr'], ['/config set_language de', 'Language: de (no sample)'], ['/config show', '/config show'], ['/config set_ephemeral true', 'Ephemeral on'], ['/config set_prefix ?', 'Prefix ?']];
  $('#chips').innerHTML = chips.map(([c, l]) => `<button type="button" data-c="${esc(c)}">${esc(l)}</button>`).join('');
  $$('#chips button').forEach((b) => b.addEventListener('click', () => run(b.dataset.c)));
  const inp = $('#in');
  inp.addEventListener('input', () => { sel = 0; menu(); });
  inp.addEventListener('keydown', (e) => { const m = $('#menu'); if (m.hidden) return; if (e.key === 'ArrowDown') { e.preventDefault(); sel = (sel + 1) % shown.length; menu(); } else if (e.key === 'ArrowUp') { e.preventDefault(); sel = (sel - 1 + shown.length) % shown.length; menu(); } else if (e.key === 'Tab' || (e.key === 'Enter' && shown[sel] && inp.value.trim() !== shown[sel][0] && !/ \S/.test(inp.value))) { e.preventDefault(); pickMenu(sel); } else if (e.key === 'Escape') m.hidden = true; });
  $('#form').addEventListener('submit', (e) => { e.preventDefault(); const v = inp.value; if (!v.trim()) return; inp.value = ''; $('#menu').hidden = true; run(v); });
  add({ who: BOT, html: true, text: `👋 Hi! I post Fortnite news from FortniteAPI.io. Try ${code('/fortnite_updates')} (add <b>type</b>: br, stw or cre) or the legacy ${code('!fortnite_updates stw')}. Admins can use ${code('/config show')}.` });
  side();
})();
