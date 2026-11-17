import {
  rates, aggregate, votesPerSeat, baseParams, simulate, project, scenarios,
  priorityGroup, potentialGain, rate,
} from './model.js';

/* ================= helpers ================= */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const fmt = (n) => Math.round(n).toLocaleString('en-US');
const pct = (x, d = 1) => `${(x * 100).toFixed(d)}%`;
const pp = (x, d = 1) => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(d)}`;
const signed = (n) => `${n >= 0 ? '+' : '−'}${fmt(Math.abs(n))}`;
const seatsTxt = (s) => s.toFixed(1);
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const deltaSpan = (d, txt) => `<span class="delta ${d > 0.0000001 ? 'up' : d < -0.0000001 ? 'down' : ''}">${txt}</span>`;

const TYPE_AR = { town: 'مدينة / مجلس محلي', village: 'قرية معترف بها', tribe: 'قرية غير معترف بها' };
const TYPE_SHORT = { town: 'مدن', village: 'قرى معترف بها', tribe: 'غير معترف بها' };
const GROUP = {
  mobilize: { icon: '🎯', ar: 'تجنيد' },
  stronghold: { icon: '🏰', ar: 'معقل' },
  persuade: { icon: '💬', ar: 'إقناع' },
  challenge: { icon: '⚠️', ar: 'تحدٍّ مزدوج' },
};
const YEAR = (d) => { const t = new Date(d); return t.getFullYear() + (t.getMonth() + t.getDate() / 31) / 12; };

/* ================= state ================= */
let DATA, LAST, SOLO, SCN;
const charts = {};
const state = {
  tab: 'summary', election: null, type: 'all', target: null,
  simBase: null, sim: {}, scn: 'realistic', proj: {},
};

const SIM_SLIDERS = [
  { k: 'turnout', label: 'نسبة التصويت في النقب', min: 20, max: 95, step: 0.5 },
  { k: 'raamShare', label: 'نسبة التصويت للموحدة في النقب', help: 'من الأصوات الصحيحة', min: 30, max: 100, step: 0.5 },
  { k: 'invalidRate', label: 'الأصوات الباطلة في النقب', min: 0, max: 5, step: 0.1 },
  { k: 'natTurnout', label: 'نسبة التصويت القطرية (خارج النقب)', help: 'كلما ارتفعت ارتفع "ثمن" المقعد', min: 55, max: 90, step: 0.5 },
];
const PROJ_SLIDERS = [
  { k: 'growth', label: 'النمو السنوي في عدد أصحاب حق الاقتراع', min: 0, max: 7, step: 0.1, d: 1 },
  { k: 'turnout', label: 'نسبة التصويت في النقب', min: 20, max: 95, step: 0.5 },
  { k: 'raamShare', label: 'نسبة التصويت للموحدة', help: 'من الأصوات الصحيحة', min: 30, max: 100, step: 0.5 },
  { k: 'invalidRate', label: 'الأصوات الباطلة', min: 0, max: 5, step: 0.1 },
];
const PROJ_ADV = [
  { k: 'natGrowth', label: 'النمو السنوي في عدد أصحاب حق الاقتراع قطريًا', min: 0, max: 4, step: 0.1, d: 1 },
  { k: 'natTurnout', label: 'نسبة التصويت القطرية', min: 55, max: 90, step: 0.5 },
  { k: 'outsideGrowth', label: 'النمو السنوي لأصوات الموحدة خارج النقب', min: -3, max: 6, step: 0.1, d: 1 },
];
const TARGET_YEARS = [2030, 2034];

/* ================= URL state ================= */
const r1 = (x) => Math.round(x * 1000) / 10; // fraction -> percent with 1 decimal
function writeHash() {
  const p = new URLSearchParams({ tab: state.tab });
  if (state.tab === 'summary' || state.tab === 'localities') p.set('e', state.election);
  if (state.tab === 'localities') { p.set('type', state.type); p.set('target', state.target); }
  if (state.tab === 'sim') {
    p.set('b', state.simBase);
    for (const s of SIM_SLIDERS) p.set(s.k, r1(state.sim[s.k]));
  }
  if (state.tab === 'proj') {
    p.set('scn', state.scn);
    if (state.scn === 'custom') for (const s of [...PROJ_SLIDERS, ...PROJ_ADV]) p.set(s.k, Math.round(state.proj[s.k] * 10000) / 100);
  }
  history.replaceState(null, '', `#${p}`);
}
function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  const num = (k) => (p.has(k) && !isNaN(+p.get(k)) ? +p.get(k) : null);
  if (['summary', 'localities', 'sim', 'proj', 'method'].includes(p.get('tab'))) state.tab = p.get('tab');
  const e = num('e'); if (e && DATA.elections.some((x) => x.id === e)) state.election = e;
  if (['all', 'town', 'village', 'tribe'].includes(p.get('type'))) state.type = p.get('type');
  if (num('target')) state.target = num('target');
  const b = num('b'); if (b && SOLO.some((x) => x.id === b)) { state.simBase = b; state.sim = baseParams(byId(b)); }
  for (const s of SIM_SLIDERS) if (num(s.k) !== null && state.tab === 'sim') state.sim[s.k] = num(s.k) / 100;
  if (['conservative', 'realistic', 'optimistic'].includes(p.get('scn'))) { state.scn = p.get('scn'); state.proj = { ...SCN[state.scn] }; }
  if (p.get('scn') === 'custom') {
    state.scn = 'custom';
    for (const s of [...PROJ_SLIDERS, ...PROJ_ADV]) if (num(s.k) !== null) state.proj[s.k] = num(s.k) / 100;
  }
}
const byId = (id) => DATA.elections.find((e) => e.id === +id);

/* ================= chart defaults ================= */
function chartTheme() {
  const C = window.Chart;
  C.defaults.font.family = css('--font');
  C.defaults.font.size = 12;
  C.defaults.color = css('--ink-2');
  C.defaults.borderColor = css('--grid');
  C.defaults.maintainAspectRatio = false;
  C.defaults.animation.duration = 350;
  Object.assign(C.defaults.plugins.tooltip, {
    rtl: true, textDirection: 'rtl', backgroundColor: css('--ink'), titleColor: css('--surface'),
    bodyColor: css('--surface'), padding: 10, cornerRadius: 8, boxPadding: 4, usePointStyle: true,
  });
  Object.assign(C.defaults.plugins.legend, { rtl: true, textDirection: 'rtl' });
  C.defaults.plugins.legend.labels.usePointStyle = true;
  C.defaults.plugins.legend.labels.boxWidth = 8;
  C.defaults.plugins.legend.labels.boxHeight = 8;
}
function mkChart(id, cfg) {
  if (charts[id]) { charts[id].destroy(); }
  charts[id] = new window.Chart(document.getElementById(id), cfg);
  return charts[id];
}
const pctAxis = (min, max) => ({ min, max, ticks: { callback: (v) => `${v}%` }, grid: { color: css('--grid') }, border: { display: false } });
const yearAxis = () => ({ type: 'linear', ticks: { stepSize: 1, callback: (v) => String(v) }, grid: { display: false }, border: { color: css('--axis') } });

/* ================= common UI ================= */
function electionPickers() {
  for (const el of $$('[data-election-picker]')) {
    const solo = el.dataset.electionPicker === 'solo';
    const key = el.dataset.key || 'election';
    const list = [...(solo ? SOLO : DATA.elections)].reverse();
    el.innerHTML = list.map((e) => `<button data-id="${e.id}" title="الكنيست ${e.id}">${e.label}${e.raamAlone ? '' : ' <span class="star">*</span>'}</button>`).join('');
    el.addEventListener('click', (ev) => {
      const b = ev.target.closest('button'); if (!b) return;
      state[key] = +b.dataset.id;
      if (key === 'simBase') state.sim = baseParams(byId(state.simBase));
      render();
    });
  }
}
function syncPickers() {
  for (const el of $$('[data-election-picker]')) {
    const key = el.dataset.key || 'election';
    for (const b of $$('button', el)) b.setAttribute('aria-pressed', String(+b.dataset.id === state[key]));
  }
  for (const b of $$('#type-filter button')) b.setAttribute('aria-pressed', String(b.dataset.type === state.type));
  for (const b of $$('#scenario-picker button')) b.setAttribute('aria-pressed', String(b.dataset.scn === state.scn));
  for (const b of $$('.tabs button')) b.setAttribute('aria-selected', String(b.dataset.tab === state.tab));
  for (const s of $$('.tab')) s.hidden = s.id !== `tab-${state.tab}`;
}
function kpi(label, value, note = '', cls = '') {
  return `<div class="kpi ${cls}"><div class="k-label">${label}</div><div class="k-value">${value}</div>${note ? `<div class="k-note">${note}</div>` : ''}</div>`;
}
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, 2200);
}

/* ================= sliders ================= */
function buildSliders(container, defs, getObj, getBase, onChange) {
  container.innerHTML = defs.map((s) => `
    <div class="slider-row">
      <label for="s-${container.id}-${s.k}"><span>${s.label}</span><output></output></label>
      <div class="range-wrap"><span class="base-mark" title="القيمة الحقيقية">▼</span>
        <input type="range" id="s-${container.id}-${s.k}" data-k="${s.k}" min="${s.min}" max="${s.max}" step="${s.step}">
      </div>
      ${s.help ? `<div class="s-help">${s.help}</div>` : ''}
    </div>`).join('');
  container.addEventListener('input', (ev) => {
    const k = ev.target.dataset.k; if (!k) return;
    getObj()[k] = +ev.target.value / 100;
    onChange(k);
  });
  container._sync = () => {
    const obj = getObj(), base = getBase();
    for (const s of defs) {
      const inp = $(`input[data-k="${s.k}"]`, container);
      const v = obj[s.k] * 100;
      if (document.activeElement !== inp) inp.value = v;
      $(`label[for="${inp.id}"] output`, container).textContent = `${v.toFixed(s.d ?? 1)}%`;
      const mark = $('.base-mark', inp.parentElement);
      if (base && base[s.k] !== undefined) {
        const f = (base[s.k] * 100 - s.min) / (s.max - s.min);
        mark.hidden = false;
        // range input is LTR: position from the left; thumb width compensation
        mark.style.left = `calc(${f * 100}% + ${(0.5 - f) * 16}px - 0.5em)`;
        mark.style.transform = 'none';
      } else mark.hidden = true;
    }
  };
}

/* ================= SUMMARY ================= */
function renderSummary() {
  const e = byId(state.election);
  const n = e.negev, nat = e.national;
  const r = rates(n), rn = rates(nat);
  const vps = votesPerSeat(e);
  const prev = DATA.elections[DATA.elections.indexOf(e) - 1];
  const rp = prev ? rates(prev.negev) : null;

  const notice = $('#sum-notice');
  notice.hidden = e.raamAlone;
  notice.innerHTML = `⚠️ في هذه الجولة خاضت الموحدة الانتخابات ضمن <strong>${e.raamListAr}</strong>، لذا الأرقام هي أصوات القائمة كلها ولا يمكن فصل أصوات الموحدة.`;

  const listName = e.raamAlone ? 'الموحدة' : e.raamListAr;
  $('#sum-kpis').innerHTML = [
    kpi('نسبة التصويت في النقب', pct(r.turnout),
      `القطرية: ${pct(rn.turnout)}${rp ? ` · ${deltaSpan(r.turnout - rp.turnout, pp(r.turnout - rp.turnout))} نقطة عن الجولة السابقة` : ''}`, 'hero'),
    kpi('أصحاب حق الاقتراع', fmt(n.eligible), prev ? `${deltaSpan(n.eligible - prev.negev.eligible, signed(n.eligible - prev.negev.eligible))} عن الجولة السابقة` : ''),
    kpi('المصوتون', fmt(n.voters), `لم يصوّت: ${fmt(n.eligible - n.voters)}`),
    kpi(`أصوات ${listName} في النقب`, fmt(n.raam), `${pct(r.raamShare)} من الأصوات الصحيحة`),
    kpi('حصة النقب من أصواتها قطريًا', pct(rate(n.raam, nat.raam)), `من أصل ${fmt(nat.raam)} صوتًا`),
    kpi('مقاعد مصدرها النقب (تقريبًا)', seatsTxt(n.raam / vps), `من أصل ${nat.raamSeats} مقاعد · ثمن المقعد ≈ ${fmt(vps)}`),
    kpi('الأصوات الباطلة', fmt(n.invalid), `${pct(r.invalidRate, 2)} من المصوتين`),
  ].join('');

  // insights
  const first = DATA.elections[0];
  const nonVoters = n.eligible - n.voters;
  const tenPct = nonVoters * 0.1 * (1 - r.invalidRate) * r.raamShare;
  const types = ['town', 'village', 'tribe'].map((t) => ({ t, r: rates(aggregate(DATA.localities, String(e.id), (l) => l.type === t)) }));
  const lowT = types.reduce((a, b) => (a.r.turnout < b.r.turnout ? a : b));
  const highT = types.reduce((a, b) => (a.r.turnout > b.r.turnout ? a : b));
  const gap = r.turnout - rn.turnout;
  const ins = [
    gap < 0
      ? `نسبة التصويت في النقب أقل من القطرية بـ <b>${Math.abs(gap * 100).toFixed(1)} نقطة</b>. لو وصل النقب إلى المعدل القطري لأضاف ذلك نحو <b>${fmt(-gap * n.eligible * (1 - r.invalidRate) * r.raamShare)}</b> صوتًا لـ${listName} (≈ ${seatsTxt(-gap * n.eligible * (1 - r.invalidRate) * r.raamShare / vps)} مقعد).`
      : `نسبة التصويت في النقب <b>أعلى من القطرية</b> بـ ${(gap * 100).toFixed(1)} نقطة، وهذا إنجاز يجب الحفاظ عليه.`,
    `<b>${fmt(nonVoters)}</b> من أصحاب حق الاقتراع لم يصوّتوا. لو صوّت 10% منهم فقط بنفس نسبة الدعم، لأضاف ذلك <b>${fmt(tenPct)}</b> صوتًا (≈ ${seatsTxt(tenPct / vps)} مقعد).`,
    e.raamAlone ? `النقب أعطى <b>${pct(rate(n.raam, nat.raam))}</b> من كل أصوات الموحدة في البلاد، بينما يشكّل ${pct(rate(n.eligible, nat.eligible))} فقط من أصحاب حق الاقتراع.` : null,
    `أدنى نسبة تصويت كانت في <b>${TYPE_SHORT[lowT.t]}</b> (${pct(lowT.r.turnout)}) مقابل ${pct(highT.r.turnout)} في ${TYPE_SHORT[highT.t]}.`,
    `عدد أصحاب حق الاقتراع العرب في النقب ارتفع من ${fmt(first.negev.eligible)} (نيسان 2019) إلى <b>${fmt(LAST.negev.eligible)}</b> (2026): نمو ${pct(rate(LAST.negev.eligible, first.negev.eligible) - 1, 0)}، أي <b>${pct(DATA.growth.negevEligibleCagr)}</b> سنويًا، مقابل ${pct(DATA.growth.nationalEligibleCagr)} قطريًا.`,
    e.otherArabAr ? `${e.otherArabAr} حصلت في النقب على <b>${fmt(n.otherArab)}</b> صوتًا (${pct(rate(n.otherArab, n.valid))})، مقابل ${fmt(n.raam)} لـ${listName}.` : null,
    r.invalidRate > rn.invalidRate ? `نسبة الأصوات الباطلة في النقب (${pct(r.invalidRate, 2)}) أعلى من القطرية (${pct(rn.invalidRate, 2)})، وحملة توعية بسيطة قد تستعيد جزءًا منها.` : null,
  ].filter(Boolean);
  $('#sum-insights').innerHTML = ins.map((x) => `<li>${x}</li>`).join('');

  // charts
  const labels = DATA.elections.map((x) => x.label);
  const sel = DATA.elections.indexOf(e);
  const pr = (i) => DATA.elections.map((_, j) => (j === i ? 6 : 3));
  mkChart('ch-turnout', {
    type: 'line',
    data: { labels, datasets: [
      { label: 'النقب', data: DATA.elections.map((x) => rates(x.negev).turnout * 100), borderColor: css('--s1'), backgroundColor: css('--s1'), borderWidth: 2, pointRadius: pr(sel), cubicInterpolationMode: 'monotone' },
      { label: 'قطريًا', data: DATA.elections.map((x) => rates(x.national).turnout * 100), borderColor: css('--s2'), backgroundColor: css('--s2'), borderWidth: 2, pointRadius: pr(sel), cubicInterpolationMode: 'monotone' },
    ] },
    options: {
      interaction: { mode: 'index', intersect: false },
      scales: { y: pctAxis(0, 100), x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true } } },
      plugins: { tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${c.parsed.y.toFixed(1)}%` } } },
    },
  });
  mkChart('ch-raam', {
    type: 'bar',
    data: { labels, datasets: [{
      label: 'أصوات القائمة في النقب',
      data: DATA.elections.map((x) => x.negev.raam),
      backgroundColor: DATA.elections.map((x, i) => (x.raamAlone ? css('--s1') : css('--s1-soft'))),
      borderColor: DATA.elections.map((x, i) => (i === sel ? css('--ink') : 'transparent')),
      borderWidth: 2, borderRadius: 4, maxBarThickness: 48,
    }] },
    options: {
      scales: { y: { grid: { color: css('--grid') }, border: { display: false }, ticks: { callback: (v) => fmt(v) } }, x: { grid: { display: false }, ticks: { maxRotation: 0 } } },
      plugins: { legend: { display: false }, tooltip: { callbacks: {
        title: (c) => `${c[0].label} – ${DATA.elections[c[0].dataIndex].raamListAr}`,
        label: (c) => { const x = DATA.elections[c.dataIndex]; return [` ${fmt(x.negev.raam)} صوتًا`, ` ${pct(rates(x.negev).raamShare)} من الأصوات الصحيحة في النقب`, ` ${pct(rate(x.negev.raam, x.national.raam))} من أصوات القائمة قطريًا`]; },
      } } },
    },
  });
  const tcol = { town: css('--s1'), village: css('--s2'), tribe: css('--s3') };
  mkChart('ch-eligible', {
    type: 'bar',
    data: { labels, datasets: ['town', 'village', 'tribe'].map((t) => ({
      label: TYPE_AR[t], data: DATA.elections.map((x) => aggregate(DATA.localities, String(x.id), (l) => l.type === t).eligible),
      backgroundColor: tcol[t], borderColor: css('--surface'), borderWidth: { top: 2 }, borderSkipped: false, maxBarThickness: 56,
    })) },
    options: {
      interaction: { mode: 'index', intersect: false },
      scales: { x: { stacked: true, grid: { display: false }, ticks: { maxRotation: 0 } }, y: { stacked: true, grid: { color: css('--grid') }, border: { display: false }, ticks: { callback: (v) => fmt(v) } } },
      plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: {
        label: (c) => ` ${c.dataset.label}: ${fmt(c.parsed.y)}`,
        footer: (items) => `المجموع: ${fmt(items.reduce((s, i) => s + i.parsed.y, 0))}`,
      } } },
    },
  });
}

/* ================= LOCALITIES ================= */
let sortKey = 'eligible', sortDir = -1;
function renderLocalities() {
  const e = byId(state.election), id = String(e.id);
  const prev = DATA.elections[DATA.elections.indexOf(e) - 1];
  const avg = rates(e.negev);
  const target = state.target / 100;
  const vps = votesPerSeat(e);
  const listName = e.raamAlone ? 'الموحدة' : 'القائمة*';

  // by type table
  const rows = ['town', 'village', 'tribe'].map((t) => ({ t, a: aggregate(DATA.localities, id, (l) => l.type === t) }));
  rows.push({ t: 'all', a: e.negev });
  $('#type-table').innerHTML = `<thead><tr><th>النوع</th><th>أصحاب حق الاقتراع</th><th>نسبة التصويت</th><th>نسبة ${listName}</th><th>أصوات ${listName}</th></tr></thead><tbody>${
    rows.map(({ t, a }) => { const r = rates(a); return `<tr ${t === 'all' ? 'style="font-weight:700"' : ''}><td>${t === 'all' ? 'كل النقب' : TYPE_AR[t]}</td><td class="n">${fmt(a.eligible)}</td><td class="n">${pct(r.turnout)}</td><td class="n">${pct(r.raamShare)}</td><td class="n">${fmt(a.raam)}</td></tr>`; }).join('')
  }</tbody>`;

  // list
  const q = $('#loc-search').value.trim();
  const list = DATA.localities
    .filter((l) => l.results[id] && (state.type === 'all' || l.type === state.type))
    .filter((l) => !q || l.ar.includes(q) || l.he.includes(q))
    .map((l) => {
      const r = l.results[id], rr = rates(r), pr = prev && l.results[prev.id] ? rates(l.results[prev.id]) : null;
      return { l, r, name: l.ar, turnout: rr.turnout, share: rr.raamShare, dT: pr ? rr.turnout - pr.turnout : null,
        eligible: r.eligible, raam: r.raam, group: priorityGroup(r, avg), gain: potentialGain(r, target) };
    });

  // scatter: one dataset per type (identity = type)
  const tcol = { town: css('--s1'), village: css('--s2'), tribe: css('--s3') };
  const ds = ['town', 'village', 'tribe'].filter((t) => state.type === 'all' || state.type === t).map((t) => ({
    label: TYPE_AR[t],
    data: list.filter((x) => x.l.type === t && x.r.eligible > 0).map((x) => ({ x: x.turnout * 100, y: x.share * 100, r: 4 + Math.sqrt(x.eligible) / 11, item: x })),
    backgroundColor: tcol[t] + 'b3', borderColor: css('--surface'), borderWidth: 2, hoverBorderColor: css('--ink'),
  }));
  mkChart('ch-priority', {
    type: 'bubble',
    data: { datasets: ds },
    options: {
      scales: {
        x: { ...pctAxis(), title: { display: true, text: 'نسبة التصويت ←', color: css('--muted') }, suggestedMin: 10, suggestedMax: 100 },
        y: { ...pctAxis(), title: { display: true, text: `نسبة ${listName} ←`, color: css('--muted') }, suggestedMin: 30, suggestedMax: 100 },
      },
      plugins: {
        legend: { position: 'bottom' },
        tooltip: { callbacks: {
          title: (c) => c[0].raw.item.l.ar,
          label: (c) => { const x = c.raw.item; return [` ${GROUP[x.group].icon} ${GROUP[x.group].ar}`, ` أصحاب حق الاقتراع: ${fmt(x.eligible)}`, ` نسبة التصويت: ${pct(x.turnout)}`, ` نسبة ${listName}: ${pct(x.share)}`]; },
        } },
        quadrants: { avgX: avg.turnout * 100, avgY: avg.raamShare * 100 },
      },
      onClick: (_, els) => { if (els[0]) openLocality(charts['ch-priority'].data.datasets[els[0].datasetIndex].data[els[0].index].item.l); },
    },
    plugins: [quadrantPlugin],
  });

  // table
  list.sort((a, b) => {
    const va = a[sortKey], vb = b[sortKey];
    if (typeof va === 'string') return sortDir * va.localeCompare(vb, 'ar');
    return sortDir * ((va ?? -Infinity) - (vb ?? -Infinity));
  });
  const cols = [
    ['name', 'البلدة'], ['eligible', 'أصحاب الحق'], ['turnout', 'التصويت'], ['dT', prev ? `تغيّر عن ${prev.label}` : 'تغيّر'],
    ['share', `نسبة ${listName}`], ['raam', `أصوات ${listName}`], ['group', 'المجموعة'], ['gain', 'ربح محتمل'],
  ];
  const tot = list.reduce((s, x) => ({ eligible: s.eligible + x.r.eligible, voters: s.voters + x.r.voters, valid: s.valid + x.r.valid, raam: s.raam + x.r.raam, gain: s.gain + x.gain }), { eligible: 0, voters: 0, valid: 0, raam: 0, gain: 0 });
  $('#loc-table').innerHTML = `
    <thead><tr>${cols.map(([k, t]) => `<th data-k="${k}" ${sortKey === k ? `aria-sort="${sortDir > 0 ? 'ascending' : 'descending'}"` : ''}>${t}</th>`).join('')}</tr></thead>
    <tbody>${list.map((x) => `<tr data-code="${x.l.code}">
      <td class="name">${x.l.ar}<small>${x.l.he}</small></td>
      <td class="n">${fmt(x.eligible)}</td>
      <td class="n">${pct(x.turnout)}</td>
      <td class="n">${x.dT === null ? '—' : deltaSpan(x.dT, pp(x.dT))}</td>
      <td class="n">${pct(x.share)}</td>
      <td class="n">${fmt(x.raam)}</td>
      <td><span class="badge">${GROUP[x.group].icon} ${GROUP[x.group].ar}</span></td>
      <td class="n">${x.gain > 0 ? `+${fmt(x.gain)}` : '—'}</td></tr>`).join('')}</tbody>
    <tfoot><tr><td>المجموع (${list.length})</td><td class="n">${fmt(tot.eligible)}</td><td class="n">${pct(rate(tot.voters, tot.eligible))}</td><td></td><td class="n">${pct(rate(tot.raam, tot.valid))}</td><td class="n">${fmt(tot.raam)}</td><td></td><td class="n">+${fmt(tot.gain)}</td></tr></tfoot>`;

  $('#target-turnout').value = state.target;
  $('#target-turnout-out').textContent = `${state.target}%`;
  $('#potential-total').innerHTML = `الربح المحتمل في البلدات المعروضة: <strong>+${fmt(tot.gain)}</strong> صوتًا ≈ <strong>${seatsTxt(tot.gain / vps)}</strong> مقعد (البلدات التي تجاوزت ${state.target}% لا تُحسب). القيمة الافتراضية = نسبة التصويت القطرية في هذه الجولة.`;
}

// draws average lines + quadrant names on the priority chart
const quadrantPlugin = {
  id: 'quadrants',
  afterDraw(chart, _, opts) {
    const { ctx, chartArea: a, scales: { x, y } } = chart;
    const px = x.getPixelForValue(opts.avgX), py = y.getPixelForValue(opts.avgY);
    ctx.save();
    ctx.strokeStyle = css('--muted'); ctx.setLineDash([5, 4]); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(px, a.top); ctx.lineTo(px, a.bottom); ctx.moveTo(a.left, py); ctx.lineTo(a.right, py); ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = `600 12px ${css('--font')}`; ctx.fillStyle = css('--muted');
    const pad = 8;
    ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText('🎯 تجنيد', a.left + pad, a.top + pad);
    ctx.textAlign = 'right'; ctx.fillText('🏰 معقل', a.right - pad, a.top + pad);
    ctx.textBaseline = 'bottom'; ctx.fillText('💬 إقناع', a.right - pad, a.bottom - pad);
    ctx.textAlign = 'left'; ctx.fillText('⚠️ تحدٍّ', a.left + pad, a.bottom - pad);
    ctx.restore();
  },
};

function openLocality(l) {
  const m = $('#loc-modal');
  $('#loc-modal-title').textContent = l.ar;
  $('#loc-modal-sub').textContent = `${l.he} · ${TYPE_AR[l.type]}${l.council ? ` · المجلس الإقليمي ${l.council}` : ''}${l.pop2023 ? ` · السكان 2023: ${fmt(l.pop2023)}` : ''}`;
  const es = DATA.elections.filter((e) => l.results[e.id]);
  $('#loc-modal-table').innerHTML = `<thead><tr><th>الجولة</th><th>أصحاب الحق</th><th>المصوتون</th><th>التصويت</th><th>القائمة</th><th>نسبتها</th><th>باطلة</th></tr></thead><tbody>${
    es.map((e) => { const r = l.results[e.id], rr = rates(r); return `<tr><td>${e.label}${e.raamAlone ? '' : '*'}</td><td class="n">${fmt(r.eligible)}</td><td class="n">${fmt(r.voters)}</td><td class="n">${pct(rr.turnout)}</td><td class="n">${fmt(r.raam)}</td><td class="n">${pct(rr.raamShare)}</td><td class="n">${fmt(r.invalid)}</td></tr>`; }).join('')
  }</tbody>`;
  m.hidden = false;
  mkChart('ch-loc', {
    type: 'line',
    data: { labels: es.map((e) => e.label), datasets: [
      { label: 'نسبة التصويت', data: es.map((e) => rates(l.results[e.id]).turnout * 100), borderColor: css('--s2'), backgroundColor: css('--s2'), borderWidth: 2, cubicInterpolationMode: 'monotone' },
      { label: 'نسبة القائمة (الموحدة / المشتركة*)', data: es.map((e) => rates(l.results[e.id]).raamShare * 100), borderColor: css('--s1'), backgroundColor: css('--s1'), borderWidth: 2, cubicInterpolationMode: 'monotone' },
    ] },
    options: { interaction: { mode: 'index', intersect: false }, scales: { y: pctAxis(0, 100), x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true } } },
      plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${c.parsed.y.toFixed(1)}%` } } } },
  });
}

/* ================= SIMULATOR ================= */
function renderSim() {
  const e = byId(state.simBase), base = baseParams(e);
  $('#sim-sliders')._sync();
  const real = simulate(e, base), s = simulate(e, state.sim);
  const dV = s.raamNegev - real.raamNegev, dS = s.seatsTotal - real.seatsTotal;
  const under = s.thresholdMargin < 0;
  $('#sim-headline').innerHTML = `بهذه الافتراضات تحصل الموحدة على <strong>${fmt(s.raamNegev)}</strong> صوتًا من النقب
    (${deltaSpan(dV, signed(dV))} مقارنة بما حدث في ${e.label})، أي نحو <strong>${seatsTxt(s.seatsTotal)}</strong> مقعد إجمالًا.
    ${under ? '<br>⚠️ <strong>تحت نسبة الحسم!</strong>' : ''}`;
  $('#sim-kpis').innerHTML = [
    kpi('أصوات الموحدة من النقب', fmt(s.raamNegev), `${deltaSpan(dV, signed(dV))} عن الواقع · ${fmt(s.voters)} مصوّتًا من ${fmt(s.eligible)}`, 'hero'),
    kpi('مقاعد الموحدة (تقريبًا)', seatsTxt(s.seatsTotal), `${deltaSpan(dS, `${dS >= 0 ? '+' : '−'}${Math.abs(dS).toFixed(1)}`)} · رسميًا في ${e.label}: ${e.national.raamSeats}`),
    kpi('مجموع أصوات الموحدة قطريًا', fmt(s.raamTotal), `خارج النقب (ثابت): ${fmt(s.raamOutside)}`),
    kpi('حصة النقب من أصوات الموحدة', pct(s.negevShareOfRaam), `في الواقع: ${pct(real.negevShareOfRaam)}`),
    kpi('المسافة عن نسبة الحسم', `${s.thresholdMargin >= 0 ? '+' : '−'}${fmt(Math.abs(s.thresholdMargin))}`, `نسبة الحسم 3.25% = ${fmt(s.thresholdVotes)} صوتًا`),
  ].join('');

  const p = state.sim;
  const perTurnout = s.eligible * 0.01 * (1 - p.invalidRate) * p.raamShare;
  const perShare = s.valid * 0.01;
  const invalidVotes = s.voters * p.invalidRate * p.raamShare;
  $('#sim-rules').innerHTML = [
    `كل <b>نقطة مئوية</b> إضافية في نسبة التصويت في النقب = <b>+${fmt(perTurnout)}</b> صوتًا للموحدة (≈ ${(perTurnout / s.votesPerSeat).toFixed(2)} مقعد).`,
    `كل <b>نقطة مئوية</b> إضافية في نسبة دعم الموحدة في النقب = <b>+${fmt(perShare)}</b> صوتًا.`,
    `ثمن المقعد الواحد في هذا السيناريو ≈ <b>${fmt(s.votesPerSeat)}</b> صوتًا. لكسب مقعد إضافي من النقب وحده يجب رفع نسبة التصويت بنحو <b>${(s.votesPerSeat / perTurnout).toFixed(1)}</b> نقاط.`,
    `لو لم تكن هناك أصوات باطلة على الإطلاق لربحت الموحدة نحو <b>${fmt(invalidVotes)}</b> صوتًا إضافيًا.`,
  ].map((x) => `<li>${x}</li>`).join('');
}

/* ================= PROJECTIONS ================= */
const SCN_AR = { conservative: 'متحفّظ', realistic: 'واقعي', optimistic: 'متفائل', custom: 'مخصّص' };
function renderProj() {
  $('#proj-sliders')._sync(); $('#proj-sliders-adv')._sync();
  const p = state.proj;
  const baseY = new Date(LAST.date).getFullYear();
  const explain = {
    conservative: 'أدنى نسبة تصويت ونسبة دعم سُجّلت منذ أن خاضت الموحدة الانتخابات وحدها، ونمو بحسب نمو السكان (دائرة الإحصاء).',
    realistic: 'متوسط نسبة التصويت ونسبة الدعم في جولات 2021 و2022 و2026، ونمو أصحاب حق الاقتراع كما كان فعليًا 2019–2026. انتبه: 2026 كانت جولة قياسية، وهذا السيناريو يفترض العودة إلى المتوسط، لذا قد يُظهر أصواتًا أقل من 2026.',
    optimistic: 'أعلى نسبة تصويت ونسبة دعم سُجّلت (2026)، ونمو أصحاب حق الاقتراع كما كان فعليًا 2019–2026.',
    custom: 'افتراضاتك الخاصة. اضغط على سيناريو جاهز للعودة إليه.',
  };
  $('#scn-explain').innerHTML = `<strong>${SCN_AR[state.scn]}:</strong> ${explain[state.scn]} نقطة الانطلاق: نتائج ${LAST.label}.`;

  $('#proj-cards').innerHTML = TARGET_YEARS.map((Y) => {
    const yrs = Y - baseY;
    const r = project(LAST, p, yrs);
    const lo = project(LAST, SCN.conservative, yrs), hi = project(LAST, SCN.optimistic, yrs);
    return `<div class="pcard"><h3>${Y}</h3><dl>
      <dt>أصحاب حق الاقتراع</dt><dd>${fmt(r.eligible)}</dd>
      <dt>المصوتون المتوقعون</dt><dd>${fmt(r.voters)}</dd>
      <dt>أصوات الموحدة من النقب</dt><dd class="big">${fmt(r.raamNegev)}</dd>
      <div class="range">بين ${fmt(lo.raamNegev)} (متحفّظ) و-${fmt(hi.raamNegev)} (متفائل)</div>
      <dt>مقاعد مصدرها النقب</dt><dd>${seatsTxt(r.seatsNegev)}</dd>
      <dt>مقاعد الموحدة إجمالًا</dt><dd>${seatsTxt(r.seatsTotal)}</dd>
      <dt>حصة النقب من أصواتها</dt><dd>${pct(r.negevShareOfRaam, 0)}</dd>
      <dt>ثمن المقعد</dt><dd>${fmt(r.votesPerSeat)}</dd>
    </dl></div>`;
  }).join('');

  const hist = DATA.elections.map((e) => ({ x: YEAR(e.date), y: e.negev.eligible }));
  const lastX = YEAR(LAST.date);
  // dashed line starts at the actual last result; target years plotted at the year itself
  const fut = (P, f, actual) => [{ x: lastX, y: actual }, ...TARGET_YEARS.map((Y) => ({ x: Y, y: f(project(LAST, P, Y - baseY)) }))];
  const lbl = (v) => { const e = DATA.elections.find((x) => Math.abs(YEAR(x.date) - v) < 0.01); return e ? e.label : String(Math.round(v)); };
  const common = (fmtY) => ({
    interaction: { mode: 'nearest', intersect: false },
    scales: { x: { ...yearAxis(), min: 2019, max: 2035 }, y: { beginAtZero: true, grid: { color: css('--grid') }, border: { display: false }, ticks: { callback: (v) => fmt(v) } } },
    plugins: { legend: { position: 'bottom', labels: { filter: (i) => !i.text.startsWith('_') } }, tooltip: { filter: (i) => !i.dataset.label.startsWith('_'), callbacks: { title: (c) => lbl(c[0].parsed.x), label: (c) => ` ${c.dataset.label}: ${fmtY(c.parsed.y)}` } } },
  });
  mkChart('ch-proj-eligible', {
    type: 'line',
    data: { datasets: [
      { label: 'فعلي', data: hist, borderColor: css('--s1'), backgroundColor: css('--s1'), borderWidth: 2, pointRadius: 4 },
      { label: 'متوقع', data: fut(p, (r) => r.eligible, LAST.negev.eligible), borderColor: css('--s1'), backgroundColor: css('--surface'), borderDash: [6, 4], borderWidth: 2, pointRadius: 5, pointBorderWidth: 2 },
    ] },
    options: common(fmt),
  });

  const histR = SOLO.map((e) => ({ x: YEAR(e.date), y: e.negev.raam }));
  mkChart('ch-proj-raam', {
    type: 'line',
    data: { datasets: [
      { label: '_hi', data: fut(SCN.optimistic, (r) => r.raamNegev, LAST.negev.raam), borderWidth: 0, pointRadius: 0, fill: '+1', backgroundColor: css('--s1') + '22' },
      { label: '_lo', data: fut(SCN.conservative, (r) => r.raamNegev, LAST.negev.raam), borderWidth: 0, pointRadius: 0 },
      { label: 'فعلي (الموحدة وحدها)', data: histR, borderColor: css('--s1'), backgroundColor: css('--s1'), borderWidth: 2, pointRadius: 4 },
      { label: 'متوقع', data: fut(p, (r) => r.raamNegev, LAST.negev.raam), borderColor: css('--s1'), backgroundColor: css('--surface'), borderDash: [6, 4], borderWidth: 2, pointRadius: 5, pointBorderWidth: 2 },
    ] },
    options: common(fmt),
  });
}

/* ================= CSV ================= */
function downloadCsv() {
  const head = ['election', 'election_date', 'raam_list', 'locality_code', 'name_ar', 'name_he', 'type', 'eligible', 'voters', 'invalid', 'valid', 'raam_list_votes', 'other_arab_lists_votes'];
  const lines = [head.join(',')];
  for (const e of DATA.elections) for (const l of DATA.localities) {
    const r = l.results[e.id]; if (!r) continue;
    lines.push([e.id, e.date, e.raamListAr, l.code, l.ar, l.he, l.type, r.eligible, r.voters, r.invalid, r.valid, r.raam, r.otherArab].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','));
  }
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'negev-arab-votes-2019-2026.csv'; a.click();
}

/* ================= render & init ================= */
function render() {
  syncPickers();
  if (state.tab === 'summary') renderSummary();
  if (state.tab === 'localities') renderLocalities();
  if (state.tab === 'sim') renderSim();
  if (state.tab === 'proj') renderProj();
  writeHash();
}

async function init() {
  DATA = await (await fetch('data/negev.json')).json();
  LAST = DATA.elections.at(-1);
  SOLO = DATA.elections.filter((e) => e.raamAlone);
  SCN = scenarios(DATA);
  state.election = LAST.id;
  state.simBase = LAST.id;
  state.sim = baseParams(LAST);
  state.proj = { ...SCN.realistic };
  state.target = Math.round(rates(LAST.national).turnout * 100);
  readHash();

  chartTheme();
  electionPickers();
  buildSliders($('#sim-sliders'), SIM_SLIDERS, () => state.sim, () => baseParams(byId(state.simBase)), () => render());
  const onProj = () => { state.scn = 'custom'; render(); };
  buildSliders($('#proj-sliders'), PROJ_SLIDERS, () => state.proj, () => SCN.realistic, onProj);
  buildSliders($('#proj-sliders-adv'), PROJ_ADV, () => state.proj, () => SCN.realistic, onProj);

  $('.tabs').addEventListener('click', (ev) => {
    const b = ev.target.closest('button'); if (!b) return;
    state.tab = b.dataset.tab; render(); window.scrollTo({ top: 0 });
  });
  $('#type-filter').addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) { state.type = b.dataset.type; render(); } });
  $('#scenario-picker').addEventListener('click', (ev) => {
    const b = ev.target.closest('button'); if (!b || b.disabled) return;
    state.scn = b.dataset.scn; state.proj = { ...SCN[state.scn] }; render();
  });
  $('#target-turnout').addEventListener('input', (ev) => { state.target = +ev.target.value; render(); });
  $('#loc-search').addEventListener('input', () => renderLocalities());
  $('#loc-table').addEventListener('click', (ev) => {
    const th = ev.target.closest('th');
    if (th) { const k = th.dataset.k; sortDir = sortKey === k ? -sortDir : (k === 'name' || k === 'group' ? 1 : -1); sortKey = k; render(); return; }
    const tr = ev.target.closest('tbody tr');
    if (tr) openLocality(DATA.localities.find((l) => l.code === +tr.dataset.code));
  });
  $('#sim-reset').addEventListener('click', () => { state.sim = baseParams(byId(state.simBase)); render(); });
  for (const b of $$('[data-share]')) b.addEventListener('click', async () => {
    writeHash();
    try { await navigator.clipboard.writeText(location.href); toast('✓ تم نسخ الرابط – أرسله لمن تريد'); }
    catch { prompt('انسخ الرابط:', location.href); }
  });
  const closeModal = () => { $('#loc-modal').hidden = true; };
  $('#loc-modal').addEventListener('click', (ev) => { if (ev.target.id === 'loc-modal' || ev.target.closest('.modal-x')) closeModal(); });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') closeModal(); });
  $('#download-csv').addEventListener('click', downloadCsv);
  window.addEventListener('hashchange', () => { readHash(); render(); });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { chartTheme(); render(); });

  // static texts
  const upd = `آخر تحديث للمعطيات: ${DATA.generated}`;
  $('#method-updated').textContent = upd; $('#foot-updated').textContent = upd;
  $('#m-growth').textContent = pct(DATA.growth.negevEligibleCagr);
  $('#m-cbs').textContent = pct(DATA.growth.cbsPopCagrRecognized);

  render();
}

init();
