import { createBrain } from './scene.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pad = (n) => String(n).padStart(2, '0');

const LS_KEY = 'mind.inbox.v1';
const TYPE_LABEL = { learning: 'Learned', observation: 'Noticed', question: 'Wonder', digest: 'Digest' };
const MOBILE = () => window.matchMedia('(max-width: 820px)').matches;

const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const daysAgo = (iso) => Math.max(0, Math.round((startOfToday() - new Date(iso + 'T00:00:00')) / 864e5));
const niceDate = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const cVars = (c) => `--c:hsl(${c.h} ${c.s}% ${c.l}%);--cl:hsl(${c.h} ${Math.max(c.s - 8, 0)}% ${Math.min(c.l + 12, 90)}%)`;
const setVars = (el, c) => { el.style.cssText += ';' + cVars(c); };
const dLabel = (d) => (d >= 365 ? Math.round(d / 365) + 'y' : d + 'd');
const daysWord = (d) => (d >= 365 ? Math.round(d / 365) + ' year' + (d >= 730 ? 's' : '') : d + ' day' + (d === 1 ? '' : 's'));
const warmWord = (v) => (v > 0.78 ? 'Hot' : v > 0.55 ? 'Warm' : v > 0.38 ? 'Cooling' : 'Cold');

/* ---------- state ---------- */
let vault = { interests: [], entries: [] };
let local = [];
let interests = [];
let entries = [];
let active = -1;
let hover = -1;
let panelFilter = 'all';
let brain = null;
let curV = [];
let tgtV = [];

try { local = JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch (e) { local = []; }
const saveLocal = () => { try { localStorage.setItem(LS_KEY, JSON.stringify(local)); } catch (e) { /* private mode */ } };

/* ---------- storage + spaced review state ---------- */
const load = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? d : v; } catch (e) { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } };
const SRS_KEY = 'mind.srs.v1', LEVEL_KEY = 'mind.levels.v1', KEPT_KEY = 'mind.kept.v1', HOLE_KEY = 'mind.hole.v1';
let srs = load(SRS_KEY, {}), levels = load(LEVEL_KEY, {}), kept = load(KEPT_KEY, {}), holeSeen = load(HOLE_KEY, {});
const holeOpen = {};
const LADDER = [1, 3, 7, 14, 30, 60, 120];
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return isoOf(d); };
const levelOf = (it) => levels[it.id] || it.level || 'intermediate';

function mergeEntries() {
  const key = (e) => `${e.interest}|${e.date}|${(e.body || e.title || '').slice(0, 40)}`;
  const have = new Set(vault.entries.map(key));
  const keep = local.filter((e) => !(e.exported && have.has(key(e))));
  entries = vault.entries.concat(keep).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

function recompute() {
  mergeEntries();
  interests = vault.interests.map((it, idx) => {
    const list = entries.filter((e) => e.interest === it.id);
    const mine = list.filter((e) => e.type !== 'digest');
    const last = mine.reduce((m, e) => (e.date > m ? e.date : m), it.touched || '');
    const days = last ? daysAgo(last) : 9999;
    const act = new Array(30).fill(0);
    mine.forEach((e) => { const d = daysAgo(e.date); if (d < 30) act[29 - d]++; });
    const count = (t) => mine.filter((e) => e.type === t).length;
    const digest = list.find((e) => e.type === 'digest') || null;
    return { ...it, idx, list, digest, last, days, vigor: 0.22 + 0.78 * Math.exp(-days / 18), act, counts: { learning: count('learning'), question: count('question'), observation: count('observation') } };
  });
  tgtV = interests.map((i) => i.vigor);
}

/* ---------- password gate (hosted site only serves encrypted data) ---------- */
const b64d = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function deriveKey(pw, env) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: b64d(env.salt), iterations: env.iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, true, ['decrypt']);
}
async function decryptWith(key, env) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64d(env.iv) }, key, b64d(env.ct));
  return JSON.parse(new TextDecoder().decode(pt));
}
async function loadData() {
  try { const r = await fetch('data/brain.json', { cache: 'no-store' }); if (r.ok) return await r.json(); } catch (e) { /* hosted: encrypted only */ }
  const env = await (await fetch('data/brain.enc.json', { cache: 'no-store' })).json();
  let cached = null;
  try { cached = localStorage.getItem('mind.key.v1'); } catch (e) { /* ignore */ }
  if (cached) {
    try { return await decryptWith(await crypto.subtle.importKey('raw', b64d(cached), 'AES-GCM', false, ['decrypt']), env); }
    catch (e) { try { localStorage.removeItem('mind.key.v1'); } catch (e2) { /* ignore */ } }
  }
  const gate = $('#gate');
  gate.hidden = false; $('#boot').classList.add('gone');
  return new Promise((resolve) => {
    const form = $('#gateForm'), input = $('#gatePw'), err = $('#gateErr');
    setTimeout(() => input.focus(), 50);
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault(); err.textContent = '';
      const btn = form.querySelector('button'); btn.disabled = true;
      try {
        const key = await deriveKey(input.value, env);
        const data = await decryptWith(key, env);
        if ($('#gateKeep').checked) {
          try { localStorage.setItem('mind.key.v1', btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.exportKey('raw', key))))); } catch (e) { /* ignore */ }
        }
        input.value = ''; gate.hidden = true;
        resolve(data);
      } catch (e) { err.textContent = 'That is not the password.'; btn.disabled = false; input.select(); }
    });
  });
}

/* ---------- boot ---------- */
async function boot() {
  try {
    vault = await loadData();
  } catch (e) {
    $('#boot').classList.remove('gone');
    $('#boot').innerHTML = '<span class="mono">Could not load the data. Run scripts/build.py or publish.py</span>';
    console.error(e);
    return;
  }
  recompute();
  try {
    brain = createBrain($('#brain'), { onMove, onTap });
  } catch (e) {
    $('#boot').innerHTML = '<span class="mono">This browser could not start WebGL.</span>';
    console.error(e);
    return;
  }
  brain.setInterests(interests.map((i) => ({ id: i.id, color: i.color, connects: i.connects })));
  curV = interests.map(() => 0.12);
  brain.setVigor(curV);
  brain.setNodes(nodeInputs());
  buildLabels();
  buildWarmth();
  refreshChrome();

  brain.onFrame.push(() => {
    let moving = false;
    for (let i = 0; i < curV.length; i++) {
      const d = tgtV[i] - curV[i];
      if (Math.abs(d) > 0.002) { curV[i] += d * 0.04; moving = true; }
    }
    if (moving) brain.setVigor(curV);
    placeLabels();
  });

  setTimeout(() => { $('#boot').classList.add('gone'); brain.scan(); }, 650);
  setInterval(clock, 15000); clock();
  applyOffsets();
}

const nodeInputs = () => entries.map((e) => ({ id: e.id, type: e.type, region: interests.findIndex((i) => i.id === e.interest) })).filter((n) => n.region >= 0);

/* ---------- chrome: labels, warmth, hero ---------- */
function clock() {
  const d = new Date();
  $('#clock').textContent = `${d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })} · ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function buildLabels() {
  const box = $('#labels');
  box.innerHTML = '';
  interests.forEach((it, i) => {
    const el = document.createElement('div');
    el.className = 'label';
    el.dataset.i = i;
    setVars(el, it.color);
    el.innerHTML = `<span class="n">${pad(i + 1)}</span><span class="ln"></span><span class="nm">${esc(it.name)}</span><span class="d"></span>`;
    el.addEventListener('pointerenter', () => setHover(i));
    el.addEventListener('pointerleave', () => setHover(-1));
    el.addEventListener('click', () => select(i));
    box.appendChild(el);
  });
}

function placeLabels() {
  const s = brain.screen;
  const els = $$('.label');
  const centre = s.w / 2 + (active >= 0 && !MOBILE() ? -((440 + 24) / 2) : 0);
  els.forEach((el, i) => {
    const a = s.anchors[i];
    if (!a) return;
    const w = el.offsetWidth + 40;
    let left = a.x < centre;
    if (!left && a.x + w > s.w - 12) left = true;
    if (left && a.x - w < 12) left = false;
    el.classList.toggle('left', left);
    el.classList.toggle('back', !a.front);
    el.classList.toggle('act', i === active);
    el.classList.toggle('hov', i === hover);
    el.classList.toggle('dimmed', active >= 0 && i !== active);
    const x = a.x + (left ? -14 : 14);
    el.style.transform = `translate(${x.toFixed(1)}px, ${a.y.toFixed(1)}px) translate(${left ? '-100%' : '0'}, -50%)`;
  });
}

function buildWarmth() {
  const ol = $('#warmList');
  ol.innerHTML = interests.map((it, i) => `
    <li data-i="${i}" style="${cVars(it.color)}"><span class="n">${pad(i + 1)}</span>
      <span><span class="nm">${esc(it.name)}</span><span class="bar"><i style="width:${Math.round(it.vigor * 100)}%"></i></span></span>
      <span class="d">${it.last ? dLabel(it.days) : '--'}</span></li>`).join('');
  $$('li', ol).forEach((li) => {
    const i = +li.dataset.i;
    li.addEventListener('pointerenter', () => setHover(i));
    li.addEventListener('pointerleave', () => setHover(-1));
    li.addEventListener('click', () => select(i));
  });
}

function refreshChrome() {
  $$('.label').forEach((el, i) => { $('.d', el).textContent = interests[i].last ? dLabel(interests[i].days) : ''; });
  $$('#warmList li').forEach((li, i) => {
    $('.bar i', li).style.width = Math.round(interests[i].vigor * 100) + '%';
    $('.d', li).textContent = interests[i].last ? dLabel(interests[i].days) : '--';
  });
  const warm = interests.filter((i) => i.days <= 14).length;
  $('#heroStat').textContent = `${warm} of ${interests.length} regions warm · ${entries.length} neurons`;
  const un = local.filter((e) => !e.exported).length;
  $('#inboxN').textContent = un;
  const cold = [...interests].sort((a, b) => b.days - a.days)[0];
  const pull = $('#pull');
  if (cold) {
    pull.hidden = false;
    setVars(pull, cold.color);
    pull.innerHTML = `<div class="k mono"><span>TODAY'S PULL</span><span>${cold.last ? daysWord(cold.days).toUpperCase() + ' COLD' : 'UNTOUCHED'}</span></div>
      <h3>${esc(cold.name)}</h3><p>${esc(cold.rabbit || cold.summary)}</p><button id="pullGo">Pick it back up →</button>`;
    $('#pullGo').addEventListener('click', () => select(cold.idx, null, true));
  }
}

function setHover(i) {
  hover = i;
  brain.setHover(i);
  $$('#warmList li').forEach((li, k) => li.classList.toggle('hov', k === i));
}

/* ---------- pointer hit testing ---------- */
const tip = $('#tip');
function hitTest(x, y) {
  const s = brain.screen;
  let best = null, bd = 1e9;
  s.anchors.forEach((a, i) => { if (!a.front) return; const d = Math.hypot(a.x - x, a.y - y); if (d < 34 && d < bd) { bd = d; best = { kind: 'region', i }; } });
  if (best) return best;
  s.nodes.forEach((a, k) => { if (!a.front) return; const d = Math.hypot(a.x - x, a.y - y); if (d < 11 && d < bd) { bd = d; best = { kind: 'node', k }; } });
  return best;
}

function onMove(x, y, dragging) {
  if (x < 0 || dragging) { tip.classList.remove('on'); if (hover >= 0) setHover(-1); return; }
  const h = hitTest(x, y);
  $('#brain').classList.toggle('hot', !!h);
  if (!h) { tip.classList.remove('on'); if (hover >= 0) setHover(-1); return; }
  if (h.kind === 'region') { tip.classList.remove('on'); setHover(h.i); return; }
  const rec = brain.nodeList[h.k];
  const e = entries.find((en) => en.id === rec.id);
  if (!e) return;
  const it = interests[rec.region];
  setHover(rec.region);
  setVars(tip, it.color);
  tip.innerHTML = `<b>${TYPE_LABEL[e.type] || e.type} · ${niceDate(e.date)}</b>${esc(e.title || e.body.slice(0, 80))}`;
  tip.style.transform = `translate(${Math.min(x + 14, innerWidth - 270)}px, ${y + 16}px)`;
  tip.classList.add('on');
}

function onTap(x, y) {
  const h = hitTest(x, y);
  if (h && h.kind === 'region') return select(h.i);
  if (h && h.kind === 'node') { const rec = brain.nodeList[h.k]; return select(rec.region, rec.id); }
  brain.pulseAtMouse();
  if (active >= 0) deselect();
}

/* ---------- selection + panel ---------- */
const panel = $('#panel');
function applyOffsets() {
  if (active < 0) return brain.setPanelOffset(MOBILE() ? 0 : -Math.min(360, innerWidth * 0.16), MOBILE() ? -innerHeight * 0.12 : 0);
  if (MOBILE()) brain.setPanelOffset(0, (innerHeight * 0.64) / 2);
  else brain.setPanelOffset((440 + 24) / 2, 0);
}

function select(i, entryId, pulse) {
  if (i == null || i < 0 || !interests[i]) return;
  active = i;
  panelFilter = 'all';
  brain.setActive(i);
  brain.flyTo(i);
  renderPanel(entryId, pulse);
  panel.classList.add('open');
  panel.setAttribute('aria-hidden', 'false');
  $('#hero').classList.add('away'); $('#pull').classList.add('away'); $('#warmth').classList.add('away');
  applyOffsets();
  panel.scrollTop = 0;
}

function deselect() {
  active = -1;
  brain.setActive(-1);
  brain.flyTo(null);
  panel.classList.remove('open');
  panel.setAttribute('aria-hidden', 'true');
  $('#hero').classList.remove('away'); $('#pull').classList.remove('away'); $('#warmth').classList.remove('away');
  applyOffsets();
}

function sparkSvg(arr, color) {
  const w = 396, h = 44, bw = 10, gap = (w - bw * 30) / 29;
  const mx = Math.max(1, ...arr);
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="Activity over the last 30 days">` +
    arr.map((v, i) => {
      const bh = v ? 6 + (v / mx) * (h - 8) : 2;
      return `<rect x="${(i * (bw + gap)).toFixed(1)}" y="${h - bh}" width="${bw}" height="${bh}" rx="2" fill="hsl(${color.h} ${color.s}% ${color.l}%)" opacity="${v ? 1 : 0.18}"/>`;
    }).join('') + '</svg>';
}

const KIND = { read: 'Read', watch: 'Watch', listen: 'Listen', paper: 'Paper', do: 'Do' };
function holeHtml(it) {
  const h = it.hole, seen = holeSeen[it.id] || {};
  const done = h.resources.filter((r) => seen[r.url]).length;
  const mins = h.resources.reduce((a, r) => a + r.min, 0);
  return `<div class="hole">
    ${h.context ? `<p class="hctx">${esc(h.context)}</p>` : ''}
    <div class="k mono"><span>Start here, in this order</span><span>${done}/${h.resources.length} opened · ${mins} min</span></div>
    <ol class="hres">${h.resources.map((r, i) => `<li class="${seen[r.url] ? 'seen' : ''}"><a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer" data-res="${esc(r.url)}"><span class="hk mono">${KIND[r.kind] || esc(r.kind)} · ${r.min} min</span><b>${esc(r.title)}</b><span class="hw">${esc(r.why)}</span></a></li>`).join('')}</ol>
    ${h.questions.length ? `<div class="k mono"><span>Close the tab, then answer from memory</span></div><ul class="hq">${h.questions.map((q) => `<li>${esc(q)}</li>`).join('')}</ul><button class="chip solid" data-act="holelog">Log what stuck</button>` : ''}
  </div>`;
}

function renderPanel(flashId, pulse) {
  const it = interests[active];
  if (!it) return;
  const list = it.list.filter((e) => panelFilter === 'all' || e.type === panelFilter);
  const connects = (it.connects || []).map((id) => interests.find((x) => x.id === id)).filter(Boolean);
  const when = it.last ? (it.days === 0 ? 'touched today' : `last touched ${daysWord(it.days)} ago`) : 'not touched yet';
  const tab = (t, l) => `<button data-f="${t}" class="${panelFilter === t ? 'on' : ''}">${l}</button>`;
  setVars(panel, it.color);
  panel.innerHTML = `
    <button class="x" data-act="close" aria-label="Close panel">esc</button>
    <div class="p-eyebrow mono">Region ${pad(active + 1)}</div>
    <h2>${esc(it.name)}</h2>
    <div class="meter"><div class="row mono"><span>${warmWord(it.vigor)} · ${Math.round(it.vigor * 100)}%</span><span>${when}</span></div><div class="track"><i style="width:${Math.round(it.vigor * 100)}%"></i></div></div>
    <p class="p-sum">${esc(it.summary)}</p>
    <div class="rabbit ${pulse ? 'pulse' : ''}"><div class="k mono">Next rabbit hole</div><p>${esc(it.rabbit || 'Add a rabbit_hole line to this interest in your vault.')}</p>
      <div class="acts">${it.hole ? `<button class="chip solid" data-act="hole">${holeOpen[it.id] ? 'Close the rabbit hole' : 'Go down the rabbit hole ↓'}</button>` : ''}<button class="chip ${it.hole ? '' : 'solid'}" data-act="log">Log what I find</button><button class="chip" data-act="prompt">Copy a prompt for the professor</button></div>
      ${it.hole && holeOpen[it.id] ? holeHtml(it) : ''}</div>
    <div class="how"><div class="k mono"><span>How to learn this</span><select data-level aria-label="Your level in this area">${['novice', 'intermediate', 'expert'].map((l) => `<option value="${l}" ${l === levelOf(it) ? 'selected' : ''}>${l}</option>`).join('')}</select></div><p>${esc(it.method || 'Set a method line in this interest note.')}</p><button class="linkbtn" data-act="methods">Why this works</button></div>
    <div class="sec mono"><span>Last 30 days</span><span>${it.counts.learning} learned · ${it.counts.question} wonder · ${it.counts.observation} noticed</span></div>
    ${sparkSvg(it.act, it.color)}
    ${connects.length ? `<div class="sec mono"><span>Wired to</span></div><div class="chips">${connects.map((c) => `<button class="chip" style="${cVars(c.color)}" data-go="${c.idx}"><i></i>${esc(c.name)}</button>`).join('')}</div>` : ''}
    <div class="sec mono"><span>Neurons</span><div class="tabs">${tab('all', 'All')}${tab('learning', 'Learned')}${tab('question', 'Wonder')}${tab('observation', 'Noticed')}</div></div>
    <ul class="feed">${list.length ? list.map((e) => `
      <li class="entry" data-id="${esc(e.id)}"><div class="m mono"><span class="tag ${e.type}">${TYPE_LABEL[e.type] || e.type}</span><span>${niceDate(e.date)}</span>${e.local && !e.exported ? '<span class="loc">unsynced</span>' : ''}</div>
      ${e.title ? `<h4>${esc(e.title)}</h4>` : ''}${e.body ? (e.type === 'digest' ? `<div class="md">${mdLite(splitDigest(e.body).md)}</div>` : `<p>${esc(e.body)}</p>`) : ''}</li>`).join('') : '<li class="empty">Nothing here yet. Log the first one.</li>'}</ul>`;
  if (flashId) {
    const el = $(`.entry[data-id="${CSS.escape(flashId)}"]`, panel);
    if (el) { el.classList.add('flash'); setTimeout(() => el.scrollIntoView({ block: 'center', behavior: 'smooth' }), 350); }
  }
}

panel.addEventListener('click', (ev) => {
  const a = ev.target.closest('[data-res]');
  if (a && active >= 0) { const id = interests[active].id; (holeSeen[id] = holeSeen[id] || {})[a.dataset.res] = Date.now(); save(HOLE_KEY, holeSeen); a.closest('li').classList.add('seen'); return; }
  const t = ev.target.closest('[data-act],[data-go],[data-f]');
  if (!t) return;
  if (t.dataset.act === 'close') return deselect();
  if (t.dataset.act === 'log') return openCapture({ interest: interests[active].id, type: 'learning' });
  if (t.dataset.act === 'hole') { const id = interests[active].id; holeOpen[id] = !holeOpen[id]; return renderPanel(); }
  if (t.dataset.act === 'holelog') { const it = interests[active]; return openCapture({ interest: it.id, type: 'learning', title: '', body: '' }); }
  if (t.dataset.act === 'prompt') return copyPrompt(interests[active]);
  if (t.dataset.act === 'methods') return openToday('methods');
  if (t.dataset.go != null) return select(+t.dataset.go);
  if (t.dataset.f) { panelFilter = t.dataset.f; renderPanel(); }
});

panel.addEventListener('change', (ev) => {
  const s = ev.target.closest('[data-level]');
  if (!s || active < 0) return;
  levels[interests[active].id] = s.value; save(LEVEL_KEY, levels);
  toast('Level saved. The professor prompt will adapt to it.');
});

const MODES = {
  novice: 'I am new to this. Teach with a fully worked example first, step by step, with the reasoning shown. Then give me a similar problem with one step missing, then two missing (fading), so I do more each time.',
  intermediate: 'I know the basics, so skip them. Give me a mix of problem or question types in one sitting (interleaving) and ask me to explain why each answer is right.',
  expert: 'I am an expert returning after a gap. No beginner explanations. Start with problems and give minimal hints; give feedback after I answer.',
};
function copyPrompt(it) {
  const recent = it.list.slice(0, 4).map((e) => `- ${e.title || e.body.slice(0, 90)}`).join('\n') || '- (nothing logged yet)';
  const wired = (it.connects || []).map((id) => interests.find((x) => x.id === id)).filter(Boolean).map((c) => c.name).join(', ');
  const text = `Act as my cracked generalist professor. I am picking up "${it.name}" again (${it.last ? daysWord(it.days) + ' since I last touched it' : 'new to me'}).\n\nHow to teach me: ${MODES[levelOf(it)]}\n\nRules:\n- Before explaining anything, ask me what I remember about these things I logged, and wait for my answer (retrieval first):\n${recent}\n- Use concrete examples, not abstractions.\n- After each of my answers, give feedback and correct what I got wrong.\n\nThen:\n1. Give me the most interesting recent developments in this area, two sentences each.\n2. Take me down this rabbit hole: ${it.rabbit || it.summary}\n3. Connect it to one of my other interests${wired ? ` (${wired})` : ''} in a way I would not have spotted.\n4. Finish with 3 questions I should answer tomorrow and 1 for next week, and tell me what to log.\n\nBe sharp and direct. Correct me if I am wrong.`;
  const done = () => toast('Prompt copied. Paste it into Claude.');
  if (navigator.clipboard && window.isSecureContext !== false) navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
  else fallbackCopy(text, done);
}
function fallbackCopy(text, done) {
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); done(); } catch (e) { toast('Could not copy. Select the text manually.'); }
  ta.remove();
}

/* ---------- capture ---------- */
const capture = $('#capture');
let capType = 'learning';
function setCapType(t) {
  capType = t;
  $$('#capType button').forEach((b) => { const on = b.dataset.v === t; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); });
  const ph = { learning: 'What did you learn?', observation: 'What did you notice?', question: 'What do you want to know?' };
  $('#capBody').placeholder = ph[t];
}
function openCapture(pre = {}) {
  const sel = $('#capInterest');
  sel.innerHTML = interests.map((i) => `<option value="${esc(i.id)}">${pad(i.idx + 1)}  ${esc(i.name)}</option>`).join('');
  sel.value = pre.interest || (active >= 0 ? interests[active].id : interests[0].id);
  setCapType(pre.type || 'learning');
  $('#capTitle').value = pre.title || '';
  $('#capBody').value = pre.body || '';
  capture.hidden = false;
  setTimeout(() => $('#capBody').focus(), 30);
}
function closeModals() { capture.hidden = true; $('#palette').hidden = true; $('#today').hidden = true; }
const anyModal = () => !capture.hidden || !pal.hidden || !$('#today').hidden;
$$('#capType button').forEach((b) => b.addEventListener('click', () => setCapType(b.dataset.v)));
$$('[data-close]').forEach((b) => b.addEventListener('click', closeModals));
capture.addEventListener('pointerdown', (e) => { if (e.target === capture) closeModals(); });
$('#capSubmit').addEventListener('click', submitCapture);

function logLocal(e0) {
  const region = interests.findIndex((i) => i.id === e0.interest);
  const e = { id: 'local-' + Date.now().toString(36), date: isoOf(new Date()), local: true, exported: false, ...e0 };
  local.push(e); saveLocal(); recompute();
  brain.addNodeAnimated({ id: e.id, region, type: e.type }, () => { refreshChrome(); if (active >= 0) renderPanel(); });
  return e;
}

function submitCapture() {
  const body = $('#capBody').value.trim();
  let title = $('#capTitle').value.trim().replace(/\s+/g, ' ');
  if (!body && !title) { $('#capBody').focus(); return; }
  if (!title) title = body.split(/[.\n]/)[0].slice(0, 70);
  const id = $('#capInterest').value;
  const region = interests.findIndex((i) => i.id === id);
  const e = { id: 'local-' + Date.now().toString(36), type: capType, date: isoOf(new Date()), interest: id, title, body, local: true, exported: false };
  local.push(e); saveLocal();
  closeModals();
  recompute();
  brain.addNodeAnimated({ id: e.id, region, type: e.type }, () => {
    refreshChrome();
    if (active >= 0) renderPanel(e.interest === interests[active].id ? e.id : null);
    toast(`Logged to ${interests[region].name}. Export your inbox to keep it in the vault.`);
  });
}

/* ---------- inbox export ---------- */
$('#btnInbox').addEventListener('click', () => {
  const pending = local.filter((e) => !e.exported);
  if (!pending.length) return toast('Inbox is empty. Log something first.');
  const text = pending.map((e) => `---\ntype: ${e.type}\ndate: ${e.date}\ninterest: ${e.interest}\ntitle: ${e.title.replace(/\n/g, ' ')}\n---\n${e.body}\n`).join('\n=== ENTRY ===\n');
  const d = new Date();
  const name = `inbox-${isoOf(d)}-${pad(d.getHours())}${pad(d.getMinutes())}.md`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/markdown' }));
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
  pending.forEach((e) => { e.exported = true; }); saveLocal();
  refreshChrome(); if (active >= 0) renderPanel();
  toast(`Saved ${name}. Drop it in Brain-Mind/Inbox, then run build.py`);
});

/* ---------- palette ---------- */
const pal = $('#palette'), palInput = $('#palInput'), palList = $('#palList');
let palItems = [], palSel = 0;
function openPalette() { pal.hidden = false; palInput.value = ''; renderPal(); setTimeout(() => palInput.focus(), 30); }
function renderPal() {
  const q = palInput.value.trim().toLowerCase();
  const items = [];
  interests.forEach((i) => { if (!q || i.name.toLowerCase().includes(q) || (i.summary || '').toLowerCase().includes(q)) items.push({ k: 'Region', t: i.name, s: '', i: i.idx, color: i.color }); });
  entries.forEach((e) => {
    const idx = interests.findIndex((i) => i.id === e.interest);
    if (idx < 0) return;
    if (q ? (e.title + ' ' + e.body).toLowerCase().includes(q) : items.length < 12) items.push({ k: TYPE_LABEL[e.type] || e.type, t: e.title || e.body.slice(0, 70), s: niceDate(e.date), i: idx, id: e.id, color: interests[idx].color });
  });
  palItems = items.slice(0, 40); palSel = 0;
  palList.innerHTML = palItems.length ? palItems.map((it, n) => `<li role="option" data-n="${n}" class="${n === 0 ? 'sel' : ''}" style="${cVars(it.color)}"><span class="k">${esc(it.k)}</span><span class="t">${esc(it.t)}<small>${esc(it.s)}</small></span></li>`).join('') : '<li class="none">No match. Try a different word.</li>';
}
function movePal(d) {
  if (!palItems.length) return;
  palSel = (palSel + d + palItems.length) % palItems.length;
  $$('li', palList).forEach((li, n) => li.classList.toggle('sel', n === palSel));
  $$('li', palList)[palSel].scrollIntoView({ block: 'nearest' });
}
function choosePal(n) {
  const it = palItems[n]; if (!it) return;
  closeModals(); select(it.i, it.id || null);
}
palInput.addEventListener('input', renderPal);
palInput.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') { e.preventDefault(); movePal(1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); movePal(-1); }
  else if (e.key === 'Enter') { e.preventDefault(); choosePal(palSel); }
});
palList.addEventListener('click', (e) => { const li = e.target.closest('li[data-n]'); if (li) choosePal(+li.dataset.n); });
pal.addEventListener('pointerdown', (e) => { if (e.target === pal) closeModals(); });
$('#btnSearch').addEventListener('click', openPalette);

/* ---------- misc controls ---------- */
$('#btnLog').addEventListener('click', () => openCapture());
$('#btnPick').addEventListener('click', () => {
  const coldest = [...interests].sort((a, b) => b.days - a.days).slice(0, 3);
  select(coldest[Math.floor(Math.random() * coldest.length)].idx, null, true);
});
$('#brand').addEventListener('click', (e) => { e.preventDefault(); if (active >= 0) deselect(); brain.scan(); });

$$('.toggles button').forEach((b) => b.addEventListener('click', () => toggle(b.dataset.t)));
function toggle(t) {
  if (t === 'scan') return brain.scan();
  brain.opts[t] = !brain.opts[t];
  const b = $(`.toggles [data-t="${t}"]`); if (b) b.classList.toggle('on', brain.opts[t]);
}

let toastT;
function toast(msg) {
  const el = $('#toast'); el.textContent = msg; el.classList.add('on');
  clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('on'), 3400);
}

window.addEventListener('resize', () => brain && applyOffsets());

window.addEventListener('keydown', (e) => {
  if (!brain) return;
  const mod = e.metaKey || e.ctrlKey;
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName);
  if (e.key === 'Escape') {
    if (anyModal()) closeModals(); else if (active >= 0) deselect();
    return;
  }
  if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); return; }
  if (mod && e.key === 'Enter' && !capture.hidden) { e.preventDefault(); submitCapture(); return; }
  if (typing || mod || e.altKey) return;
  if (anyModal()) return;
  const k = e.key.toLowerCase();
  if (k === 'n' || k === '/') { e.preventDefault(); openCapture(); }
  else if (k === 't') openToday('glance');
  else if (k === 'c') openToday('connections');
  else if (/^[1-9]$/.test(k)) select(+k - 1);
  else if (k === 'g') toggle('glyph');
  else if (k === 'f') toggle('fibres');
  else if (k === 'r') toggle('rotate');
  else if (k === 's') toggle('scan');
});

/* ---------- markdown-lite for digests ---------- */
function mdLite(text, opts = {}) {
  const inline = (s) => esc(s).replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (m, t, u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${t}</a>`);
  let html = '', open = false, gal = [];
  const flushGal = () => {
    if (!gal.length) return;
    html += `<div class="gallery g${Math.min(gal.length, 4)}">${gal.map((g) => `<figure><img src="${g.u}" alt="${g.a}" loading="lazy" decoding="async" referrerpolicy="no-referrer">${g.a ? `<figcaption class="mono">${g.a}</figcaption>` : ''}</figure>`).join('')}</div>`;
    gal = [];
  };
  String(text).split('\n').forEach((ln) => {
    if (ln.trim() === '[[lichess-daily]]') {
      flushGal(); if (open) { html += '</ul>'; open = false; }
      html += opts.embed ? '<div class="embed"><iframe src="https://lichess.org/training/frame?theme=brown&bg=dark" title="Lichess puzzle of the day" loading="lazy" allowtransparency="true"></iframe><a class="mono" href="https://lichess.org/training/daily" target="_blank" rel="noopener noreferrer">open on Lichess</a></div>' : '<p><a href="https://lichess.org/training/daily" target="_blank" rel="noopener noreferrer">Daily puzzle on Lichess</a></p>';
      return;
    }
    const im = /^!\[([^\]]*)\]\((https:\/\/[^)\s]+)\)\s*$/.exec(ln);
    if (im) { if (open) { html += '</ul>'; open = false; } gal.push({ a: esc(im[1]), u: esc(im[2]) }); return; }
    flushGal();
    if (/^- /.test(ln)) { if (!open) { html += '<ul>'; open = true; } html += `<li>${inline(ln.slice(2))}</li>`; }
    else if (ln.trim()) { if (open) { html += '</ul>'; open = false; } html += `<p>${inline(ln)}</p>`; }
  });
  flushGal();
  return html + (open ? '</ul>' : '');
}
document.addEventListener('error', (e) => { const t = e.target; if (t && t.tagName === 'IMG' && t.closest('.gallery')) { const f = t.closest('figure'); if (f) f.remove(); } }, true);

/* ---------- Today dashboard, Review, Connections, Methods ---------- */
const todayEl = $('#today');
let todayTab = 'glance';
const recall = {};
let rv = { queue: [], i: 0, shown: false, typed: '', done: 0 };

function splitDigest(body) {
  let q = '', ans = [], inAns = false;
  const rest = [];
  String(body).split('\n').forEach((l) => {
    let m;
    if ((m = /^Question:\s*(.+)$/.exec(l))) { q = m[1]; inAns = false; return; }
    if ((m = /^Answer:\s*(.*)$/.exec(l))) { ans.push(m[1]); inAns = true; return; }
    if (inAns && !/^Sources:/.test(l)) { ans.push(l); return; }
    inAns = false; rest.push(l);
  });
  return { md: rest.join('\n'), question: q, answer: ans.join('\n').trim() };
}
const readMin = (d) => { const t = splitDigest(d.body); return Math.max(1, Math.round(((t.md + ' ' + t.answer).replace(/!\[[^\]]*\]\([^)]*\)|\[\[[^\]]*\]\]|https?:\/\/\S+/g, ' ').split(/\s+/).filter(Boolean).length) / 200)); };
const gistOf = (d) => d.gist || (splitDigest(d.body).md.replace(/!\[[^\]]*\]\([^)]*\)|\[\[[^\]]*\]\]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^- /, '').split(/(?<=[.!?])\s/)[0] || d.title).slice(0, 140);

function allCards() {
  const out = [];
  entries.forEach((e) => {
    const region = interests.findIndex((i) => i.id === e.interest);
    if (region < 0 || !(e.type === 'learning' || (e.type === 'digest' && kept[e.id]))) return;
    const st = srs[e.id] || { step: 0, due: addDays(kept[e.id] || e.date, LADDER[0]) };
    out.push({ id: e.id, region, e, step: st.step || 0, due: st.due, seen: st.seen || 0 });
  });
  return out;
}
const dueCards = () => { const t = isoOf(new Date()); return allCards().filter((c) => c.due <= t); };
function buildSession() {
  const groups = new Map();
  dueCards().sort((a, b) => (a.due < b.due ? -1 : 1)).forEach((c) => { if (!groups.has(c.region)) groups.set(c.region, []); groups.get(c.region).push(c); });
  const lists = [...groups.values()], q = [];
  for (let i = 0; q.length < 8; i++) {
    let any = false;
    lists.forEach((l) => { if (l[i] && q.length < 8) { q.push(l[i]); any = true; } });
    if (!any) break;
  }
  return q;
}
function startReview() { rv = { queue: buildSession(), i: 0, shown: false, typed: '', done: 0 }; }
function rate(r) {
  const c = rv.queue[rv.i];
  if (!c) return;
  const step = Math.min(r === 0 ? 0 : r === 1 ? c.step : c.step + (r === 2 ? 1 : 2), LADDER.length - 1);
  srs[c.id] = { step, due: addDays(isoOf(new Date()), r === 0 ? 1 : LADDER[step]), seen: c.seen + 1, last: isoOf(new Date()) };
  save(SRS_KEY, srs);
  rv.i++; rv.shown = false; rv.typed = ''; rv.done++;
  renderToday();
}

function openToday(tab) {
  todayTab = tab || todayTab;
  if (todayTab === 'review') startReview();
  if (active >= 0) deselect();
  renderToday();
  todayEl.hidden = false;
  $('#todayBody').scrollTop = 0;
}

const METHODS = [
  { n: 'Spaced repetition', v: 'Strong', c: 'strong',
    e: 'Rated high utility by Dunlosky et al. (2013). Cepeda et al. (2006) pooled 839 assessments from 317 experiments: the best gap between study sessions grows with how long you need to remember. A 2022 meta-analysis of 48 second-language experiments found a medium to large spacing effect, and short gaps matched long ones on an immediate test but lost on a delayed one.',
    w: 'Repetition only helps when it is spaced. Cramming and rereading the same page back to back are the weak kind. Equal and expanding gaps performed similarly in the language meta-analysis, so the ladder here (1, 3, 7, 14, 30, 60, 120 days) is a sensible default, not a proven optimum.',
    s: 'The Review tab schedules every learning you log, and any digest you keep, on that ladder.',
    l: [['Dunlosky et al. 2013 (APS summary)', 'https://www.psychologicalscience.org/news/releases/which-study-strategies-make-the-grade.html'], ['Cepeda et al. 2006', 'https://pubmed.ncbi.nlm.nih.gov/16719566/'], ['Kim and Webb 2022, second language', 'https://www.bohrium.com/en/paper-details/the-effects-of-spaced-practice-on-second-language-learning-a-meta-analysis/813033326355939328-6763']] },
  { n: 'Retrieval practice (testing yourself)', v: 'Strong', c: 'strong',
    e: 'Also rated high utility. Trying to recall beats rereading, feedback after the attempt makes it work better, and even a failed attempt can help later learning.',
    w: 'The format matters: practise the way you will be tested. Pre-testing helps most for concrete facts and concepts. Much of the research comes from a narrow range of countries. The page I could open for this is a secondary summary.',
    s: 'Test me on every digest, and Review asks you to type an answer before it shows the answer.',
    l: [['Testing effect (summary)', 'https://en.wikipedia.org/wiki/Testing_effect']] },
  { n: 'Interleaving (mixing topics)', v: 'Good, mixed record', c: 'mixed',
    e: 'Rated moderate utility. In a preregistered trial of 54 seventh-grade maths classes (787 students), interleaved practice scored 61% against 38% on a test a month later (d = 0.83). A later field experiment in Nigerian primary classrooms found a smaller short-term gain (0.28 SD), no effect on year-end exams, and gains concentrated in lower achievers.',
    w: 'It feels slower and harder, and teachers said it took longer. Strongest evidence is for maths-like categories of problem.',
    s: 'Review sessions go round-robin across your regions, and maths and chess prompts mix problem types. That it helps with boredom is my design hunch, not a finding from these studies.',
    l: [['Rohrer et al. 2019 trial', 'https://Www.Gwern.net/doc/psychology/spaced-repetition/2019-rohrer.pdf'], ['Nigeria field experiment (NBER)', 'https://nber.org/system/files/working_papers/w31853/w31853.pdf']] },
  { n: 'Worked examples, then fading', v: 'Depends on your level', c: 'cond',
    e: 'For novices, studying a worked-out solution beats solving unaided (Sweller and Cooper). Gradually removing steps (fading) moves you from studying to solving (Renkl and Atkinson, 2003). The expertise reversal effect (Kalyuga) shows the same guidance can hurt people who already know the area, and adaptive fading beat fixed fading in one study.',
    w: 'Most of what I could open was secondary summaries, and some supporting studies rely on self-rated difficulty.',
    s: 'Every region has a level. Novice prompts use worked examples with fading. Chess defaults to expert: problems first, minimal hints.',
    l: [['Expertise reversal effect (summary)', 'https://en.wikipedia.org/wiki/Expertise_reversal_effect'], ['Worked-example effect (summary)', 'https://en.wikipedia.org/wiki/Worked-example_effect']] },
  { n: 'Self-explanation and asking why', v: 'Moderate', c: 'mixed',
    e: 'Elaborative interrogation and self-explanation were both rated moderate utility. Fading worked steps also pushes you to self-explain.',
    w: 'Most learners are passive, superficial self-explainers unless they are prompted to do it.',
    s: 'Recall prompts ask why and what would change your mind, not just what.', l: [['Dunlosky et al. 2013 (APS summary)', 'https://www.psychologicalscience.org/news/releases/which-study-strategies-make-the-grade.html']] },
  { n: 'Desirable difficulties', v: 'Principle', c: 'cond',
    e: 'Bjork: conditions that feel harder (spacing, interleaving, testing) can improve long-term retention, while easy practice can inflate short-term performance and mislead you. Rereading feels like learning because it feels fluent.',
    w: 'The task has to be achievable. If it is too hard, you disengage.',
    s: 'Review sessions are capped at 8 cards so they stay doable.', l: [['Desirable difficulty (summary)', 'https://en.wikipedia.org/wiki/Desirable_difficulty']] },
  { n: 'What to skip', v: 'Weak', c: 'weak',
    e: 'Highlighting, rereading, summarisation, the keyword mnemonic and imagery for text were all rated low utility (summarisation and imagery helped some people in limited conditions). Pashler et al. (2008) found no adequate evidence that matching teaching to a visual or auditory "learning style" improves learning, though many versions were never tested.',
    w: 'Absence of evidence is not proof the ideas are wrong, but there is no reason to build around them.',
    s: 'No highlighter and no style toggle here.', l: [['Pashler et al. 2008', 'https://pubmed.ncbi.nlm.nih.gov/26162104/']] },
  { n: 'Chess: what practice predicts', v: 'Domain note', c: 'cond',
    e: 'Charness et al. (2005): accumulated time on solitary study, tournament play and formal instruction each correlated with chess rating. Gobet argues deliberate practice is necessary but not sufficient.',
    w: 'The figures lean on players recalling their old hours, and whether solo or group practice predicts more is unsettled.',
    s: 'The chess region defaults to expert and suggests mixing puzzles, real games and game review.', l: [['Charness et al. 2005', 'https://zendy.io/title/10.1002/acp.1106'], ['BPS Research Digest on Gobet', 'https://www.bps.org.uk/research-digest/exploding-10000-hours-myth-its-no-guarantee-greatness']] },
];
function methodsHtml() {
  return `<p class="t-intro">What the research says, what it does not say, and what this site does about it. Several sources below are summary pages, not the original papers, so effect sizes are as those pages report them.</p>
  <div class="tgrid">${METHODS.map((m) => `<article class="tcard meth"><div class="m mono"><span>${esc(m.n)}</span><span class="pill ${m.c}">${esc(m.v)}</span></div>
    <p><b>Evidence.</b> ${esc(m.e)}</p><p><b>Where it fails.</b> ${esc(m.w)}</p><p class="does"><b>In this site.</b> ${esc(m.s)}</p>
    <div class="srcs mono">${m.l.map(([t, u]) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${esc(t)}</a>`).join(' · ')}</div></article>`).join('')}
    <article class="tcard meth"><div class="m mono"><span>What I could not verify</span></div><p>No source here tells us how to beat boredom or how many interests to rotate. The daily rotation, the 8-card cap and the review ladder are my design choices, informed by the evidence but untested on you.</p></article></div>`;
}

function cardHtml(it, iso) {
  const d = it.digest, r = recall[it.idx];
  const stale = d && d.date !== iso ? `<span class="pill">from ${niceDate(d.date)}</span>` : '';
  const emb = !!(d && d.date === iso);
  const mins = d ? `<span class="pill">${readMin(d)} min</span>` : '';
  let inner;
  if (!d) inner = '<p class="empty">No digest yet.</p>';
  else {
    const sp = splitDigest(d.body);
    if (r && r.stage === 'ask') {
      inner = `<h3>${esc(d.title)}</h3><p class="q">${esc(sp.question || 'What do you remember from this, and why does it matter?')}</p>
        <textarea data-rtext="${it.idx}" rows="4" placeholder="Answer from memory first, then reveal">${esc(r.text || '')}</textarea>
        <div class="acts"><button class="chip solid" data-reveal="${it.idx}">Reveal</button><button class="chip" data-rcancel="${it.idx}">Cancel</button></div>`;
    } else if (r && r.stage === 'shown') {
      inner = `<h3>${esc(d.title)}</h3><div class="md">${mdLite(sp.md, { embed: emb })}</div>${sp.answer ? `<div class="ansblock"><p class="mono dim">ANSWER</p><div class="md">${mdLite(sp.answer)}</div></div>` : ''}${r.text ? `<p class="mono dim">YOUR ANSWER</p><p class="yours">${esc(r.text)}</p>` : ''}
        <div class="acts">${r.text ? `<button class="chip solid" data-saveans="${it.idx}">Save my answer as a learning</button>` : ''}<button class="chip" data-keep="${it.idx}" ${kept[d.id] ? 'disabled' : ''}>${kept[d.id] ? 'Kept for review' : 'Keep for review'}</button><button class="chip" data-rcancel="${it.idx}">Close</button></div>`;
    } else {
      inner = `<h3>${esc(d.title)}</h3><div class="md">${mdLite(sp.md, { embed: emb })}</div>
        <div class="acts"><button class="chip solid" data-recall="${it.idx}">Test me</button><button class="chip" data-go="${it.idx}">Open region</button><button class="chip" data-log="${it.idx}">Log a learning</button></div>`;
    }
  }
  return `<article class="tcard" id="card-${it.idx}" style="${cVars(it.color)}"><div class="m mono"><span class="dot"></span><span>${pad(it.idx + 1)} ${esc(it.name)}</span>${stale}${mins}</div>${inner}</article>`;
}

function renderToday() {
  const now = new Date(), iso = isoOf(now), body = $('#todayBody');
  const keep = body.scrollTop;
  const dueN = dueCards().length;
  $$('#todayTabs button').forEach((b) => { const on = b.dataset.tab === todayTab; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
  $('#todayTabs [data-tab="review"]').textContent = dueN ? `Review · ${dueN}` : 'Review';
  $('#todayDate').textContent = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  if (todayTab === 'methods') { body.innerHTML = methodsHtml(); body.scrollTop = keep; return; }
  if (todayTab === 'review') { renderReview(body, dueN); return; }
  if (todayTab === 'connections') {
    const cs = vault.connections || [];
    body.innerHTML = `<p class="t-intro">Outside the brain on purpose. Each night, two unrelated fields and one link between them. Hypotheses, not facts.</p>` +
      (cs.length ? `<div class="tgrid">${cs.map((c) => `
        <article class="tcard conn"><div class="m mono"><span>${niceDate(c.date)}</span>${c.pattern ? `<span class="pill">${esc(c.pattern)}</span>` : ''}</div>
        <h3>${esc(c.title)}</h3><div class="ab mono"><span>${esc(c.a)}</span><i>×</i><span>${esc(c.b)}</span></div>
        <p>${esc(c.hypothesis)}</p></article>`).join('')}</div>` : '<p class="empty">No Connections editions found yet.</p>');
    body.scrollTop = keep; return;
  }
  if (todayTab === 'glance') {
    const rows = interests.filter((i) => i.digest);
    const total = rows.reduce((a, i) => a + readMin(i.digest), 0);
    body.innerHTML = `<p class="t-intro">Your whole day in about two minutes. Tap any line to read the full piece. Reading everything would take about <b>${total} min</b>, so pick the one or two that pull you.</p>
      <ol class="glance">${rows.map((i) => `<li><button data-jump="${i.idx}" style="${cVars(i.color)}"><span class="gd"></span><span class="gn mono">${esc(i.name)}</span><span class="gg">${esc(gistOf(i.digest))}</span><span class="gm mono">${readMin(i.digest)} min</span></button></li>`).join('')}</ol>
      <div class="tstats mono"><span><b>${dueN}</b> reviews due</span><span><button class="linkbtn" data-tab="review">Do your review</button></span></div>`;
    body.scrollTop = 0; return;
  }
  const fresh = interests.filter((i) => i.digest && i.digest.date === iso).length;
  const mine = entries.filter((e) => e.date === iso && e.type !== 'digest');
  const cold = [...interests].sort((a, b) => b.days - a.days)[0];
  body.innerHTML = `<div class="tstats mono"><span><b>${fresh}</b> of ${interests.length} regions refreshed today</span><span><b>${mine.length}</b> of your own neurons today</span><span><b>${dueN}</b> reviews due</span>${cold ? `<span>coldest: <b>${esc(cold.name)}</b> (${dLabel(cold.days)})</span>` : ''}</div>
    <div class="tgrid">${interests.map((it) => cardHtml(it, iso)).join('')}</div>
    <div class="sec mono"><span>Logged by you today</span></div>
    ${mine.length ? `<ul class="feed">${mine.map((e) => `<li class="entry"><div class="m mono"><span class="tag ${e.type}">${TYPE_LABEL[e.type]}</span></div><h4>${esc(e.title || '')}</h4>${e.body ? `<p>${esc(e.body)}</p>` : ''}</li>`).join('')}</ul>` : '<p class="empty">Nothing yet. Press N to fire one in.</p>'}`;
  body.scrollTop = keep;
}

function renderReview(body, total) {
  if (!rv.queue.length || rv.i >= rv.queue.length) {
    const t = isoOf(new Date());
    const next = allCards().map((c) => c.due).filter((d) => d > t).sort()[0];
    body.innerHTML = `<div class="rv-empty"><h3>${rv.done ? `Session done. ${rv.done} reviewed.` : 'Nothing due right now.'}</h3>
      <p>${next ? `Next review is due ${niceDate(next)}.` : 'Log a learning (press N) and it joins the schedule. It comes back after 1, 3, 7, 14, 30, 60 and 120 days.'}</p>
      <p class="why">Why short and spaced: recalling something just as it starts to fade strengthens it most, and a session you can finish beats one you abandon. Keep a digest from the Learnings tab to add it here.</p></div>`;
    return;
  }
  const c = rv.queue[rv.i], it = interests[c.region];
  const sd = c.e.type === 'digest' ? splitDigest(c.e.body) : null;
  const answer = sd ? mdLite(sd.md) + (sd.answer ? `<p class="mono dim">ANSWER</p>${mdLite(sd.answer)}` : '') : `<p>${esc(c.e.body || '')}</p>`;
  body.innerHTML = `<div class="rv" style="${cVars(it.color)}"><div class="m mono"><span class="dot"></span><span>${pad(it.idx + 1)} ${esc(it.name)}</span><span class="pill">${rv.i + 1} of ${rv.queue.length}${total > rv.queue.length ? ` · ${total - rv.queue.length} more due` : ''}</span></div>
    <h3>${esc(c.e.title || 'Recall this')}</h3>
    ${rv.shown
    ? `<div class="md ans">${answer}</div><p class="mono dim">How did that go?</p><div class="acts rate"><button class="chip" data-rate="0">Forgot</button><button class="chip" data-rate="1">Hard</button><button class="chip solid" data-rate="2">Got it</button><button class="chip" data-rate="3">Easy</button></div>`
    : `<p class="t-intro">Before you look: what do you remember, and why does it matter? Typing it beats just thinking it.</p><textarea id="rvText" rows="4" placeholder="Your answer from memory">${esc(rv.typed)}</textarea><div class="acts"><button class="chip solid" data-rvshow>Show answer</button><button class="chip" data-rvskip>Skip</button></div>`}</div>`;
}

todayEl.addEventListener('input', (e) => {
  const t = e.target;
  if (t.matches('[data-rtext]')) { const r = recall[+t.dataset.rtext]; if (r) r.text = t.value; }
  else if (t.id === 'rvText') rv.typed = t.value;
});
todayEl.addEventListener('click', (e) => {
  if (e.target === todayEl || e.target.closest('[data-close]')) return closeModals();
  const g = (sel) => e.target.closest(sel);
  let x;
  if ((x = g('[data-jump]'))) { todayTab = 'learnings'; renderToday(); const c = document.getElementById('card-' + x.dataset.jump); if (c) c.scrollIntoView({ block: 'start' }); return; }
  if ((x = g('[data-tab]'))) { todayTab = x.dataset.tab; if (todayTab === 'review') startReview(); return renderToday(); }
  if ((x = g('[data-go]'))) { closeModals(); return select(+x.dataset.go); }
  if ((x = g('[data-log]'))) { closeModals(); return openCapture({ interest: interests[+x.dataset.log].id, type: 'learning' }); }
  if ((x = g('[data-recall]'))) { recall[+x.dataset.recall] = { stage: 'ask', text: '' }; return renderToday(); }
  if ((x = g('[data-reveal]'))) { recall[+x.dataset.reveal].stage = 'shown'; return renderToday(); }
  if ((x = g('[data-rcancel]'))) { delete recall[+x.dataset.rcancel]; return renderToday(); }
  if ((x = g('[data-keep]'))) {
    const d = interests[+x.dataset.keep].digest, t = isoOf(new Date());
    kept[d.id] = t; save(KEPT_KEY, kept); srs[d.id] = { step: 0, due: addDays(t, LADDER[0]), seen: 0 }; save(SRS_KEY, srs);
    toast('Kept. It comes back for review tomorrow.'); return renderToday();
  }
  if ((x = g('[data-saveans]'))) {
    const it = interests[+x.dataset.saveans], r = recall[it.idx];
    logLocal({ type: 'learning', interest: it.id, title: 'Recall: ' + it.digest.title, body: r.text });
    delete recall[it.idx]; toast('Saved as a learning. It joins your review schedule.'); return renderToday();
  }
  if (g('[data-rvshow]')) { rv.typed = ($('#rvText') || {}).value || rv.typed; rv.shown = true; return renderToday(); }
  if (g('[data-rvskip]')) { rv.i++; rv.shown = false; rv.typed = ''; return renderToday(); }
  if ((x = g('[data-rate]'))) rate(+x.dataset.rate);
});
$('#btnToday').addEventListener('click', () => openToday('glance'));
$('#btnTodayTop').addEventListener('click', () => openToday('glance'));
$('#btnConn').addEventListener('click', () => openToday('connections'));

boot();
