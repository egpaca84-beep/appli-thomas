/* =====================================================================
   Chef d'équipe — EG PACA
   Appli perso de Thomas. Tout est stocké sur le téléphone (localStorage),
   avec sauvegarde manuelle sur Google Drive.
   Services externes :
     - Claude (API Anthropic) : brief, débrief, incident, révision, élocution
     - Open-Meteo (modèle Météo-France) : météo par commune de chantier
     - Google (Gmail lecture seule + Drive fichier de sauvegarde)
   ===================================================================== */
"use strict";

/* ---------------------------------------------------------------------
   1. Stockage
   --------------------------------------------------------------------- */
const STORE_KEY = "egpaca_app_v1";
const MAIL_KEY = "egpaca_mails_v1";
const MAIL_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAIL_MAX = 20;
const INTERVALS = [1, 3, 7, 14, 30]; // révision espacée, en jours

function defaults() {
  return {
    settings: {
      projectUrl: "",
      rootFolderId: "",
      boxFolderId: "",
      briefTime: "5h45",
      googleClientId: "",
      nacelleModel: "",
      nacelleLimit: "",
      urgenceExploitant: "",
      driveFileId: "",
      lastBackup: ""
    },
    plans: {},        // "AAAA-MM-JJ" -> { lieux:[{name,label,lat,lon}], situation, effectif, horaires, sensibles }
    orders: {},       // "AAAA-MM-JJ" -> [{id, who, text, done}]
    debriefs: [],     // [{date, answers:[{q,a}], recap}]
    briefs: {},       // "AAAA-MM-JJ" -> {text, at}
    incidents: [],    // [{id, at, text, response, outcome}]
    agenda: [],       // [{id, date, time, title, type:"pro"|"perso", auto}]
    revision: {
      elec: { items: [], sessions: [] },
      management: { items: [], sessions: [] },
      marketing: { items: [], sessions: [] }
    },
    elocution: { level: 1, levelChangedAt: 0, history: [], retry: [] },
    stock: {
      items: [],        // [{id, cat:"outil"|"materiel", name, qty, min, unit, state:"ok"|"remplacer"|"manquant", ordered}]
      orders: [],       // [{id, cat, name, qty, itemId, status:"a_commander"|"commande", createdAt, orderedAt, source}]
      lastInventory: "",
      invEvery: 15
    },
    base: {
      sections: { arbre: "", croisement: "", habitudes: "", connaissances: "", infos: "" },
      journal: []      // [{at, text}]
    }
  };
}

function merge(target, src) {
  for (const k in src) {
    const s = src[k], t = target[k];
    if (s && typeof s === "object" && !Array.isArray(s) && t && typeof t === "object" && !Array.isArray(t)) merge(t, s);
    else target[k] = s;
  }
  return target;
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? merge(defaults(), JSON.parse(raw)) : defaults();
  } catch (e) {
    return defaults();
  }
}
let S = loadState();

function save(fromSync) {
  if (!fromSync) { S.rev = (S.rev || 0) + 1; if (typeof scheduleSync === "function") scheduleSync(); }
  try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); }
  catch (e) { toast("Stockage du téléphone plein ou bloqué.", true); }
}

/* État d'écran, non sauvegardé */
const U = {
  wx: {},
  geo: {},          // contexte -> {results, lieux, sit, loading}
  deb: null,
  revTab: "elec",
  rev: null,
  eloTab: "directives",
  elo: null,
  agWeekStart: null,
  agDay: null,
  agType: "pro",
  meteoIdx: 0,
  meteoDay: "today",
  stockTab: "commander",
  inv: false,
  busy: {},
  lastRoute: null
};

/* ---------------------------------------------------------------------
   2. Outils
   --------------------------------------------------------------------- */
const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const val = (id) => { const el = document.getElementById(id); return el ? el.value.trim() : ""; };
const clearInput = (...ids) => ids.forEach((id) => { const el = document.getElementById(id); if (el) el.value = ""; });

function pad(n) { return String(n).padStart(2, "0"); }
function dateStr(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
function todayStr() { return dateStr(new Date()); }
function addDays(str, n) { const d = parseDate(str); d.setDate(d.getDate() + n); return dateStr(d); }
function parseDate(str) { const [y, m, d] = str.split("-").map(Number); return new Date(y, m - 1, d); }
function longDate(str) { return parseDate(str).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }); }
function shortDate(str) { return parseDate(str).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" }); }
function fmtDateTime(ts) { return new Date(ts).toLocaleString("fr-FR", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); }
function mondayOf(str) { const d = parseDate(str); const dow = (d.getDay() + 6) % 7; d.setDate(d.getDate() - dow); return dateStr(d); }

let toastTimer = null;
function toast(msg, isErr) {
  const t = $("#toast");
  t.textContent = msg;
  t.className = "show" + (isErr ? " err" : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = ""; }, isErr ? 6000 : 3000);
}

const SITUATIONS = [["seul", "Seul"], ["manage", "Managé"], ["chef", "Chef d'équipe"]];
const sitLabel = (k) => (SITUATIONS.find((s) => s[0] === k) || [null, "non précisée"])[1];

/* ---------------------------------------------------------------------
   3. Icônes
   --------------------------------------------------------------------- */
const svg = (p, c = "currentColor", s = 24) =>
  `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
const I = {
  back: (c) => svg('<path d="M15 5l-7 7 7 7"/>', c, 22),
  home: (c) => svg('<path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>', c, 22),
  sun: (c, s) => svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>', c, s),
  list: (c, s) => svg('<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2"/>', c, s),
  moon: (c, s) => svg('<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>', c, s),
  book: (c, s) => svg('<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 21V5"/><path d="M8 7h7"/>', c, s),
  wind: (c, s) => svg('<path d="M3 8h11a3 3 0 1 0-3-3"/><path d="M3 12h15a3 3 0 1 1-3 3"/><path d="M3 16h7"/>', c, s),
  db: (c, s) => svg('<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>', c, s),
  cal: (c, s) => svg('<rect x="3" y="5" width="18" height="16" rx="1"/><path d="M3 10h18"/><path d="M8 3v4M16 3v4"/>', c, s),
  chat: (c, s) => svg('<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h8M8 12h5"/>', c, s),
  mail: (c, s) => svg('<rect x="3" y="5" width="18" height="14" rx="1"/><path d="M3 7l9 6 9-6"/>', c, s),
  alert: (c, s) => svg('<path d="M12 3l10 18H2z"/><path d="M12 10v5"/><path d="M12 18v.5"/>', c, s),
  mic: (c, s) => svg('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/>', c, s),
  gear: (c) => svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>', c, 22),
  tool: (c, s) => svg('<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z"/>', c, s),
  box: (c, s) => svg('<path d="M21 8l-9-5-9 5v8l9 5 9-5z"/><path d="M3 8l9 5 9-5"/><path d="M12 13v8"/>', c, s),
  pin: (c, s) => svg('<path d="M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12z"/><circle cx="12" cy="9" r="2.5"/>', c, s)
};

/* ---------------------------------------------------------------------
   4. Composants communs
   --------------------------------------------------------------------- */
function head(title) {
  return `<div class="head"><button class="iconbtn" data-action="go" data-to="home" aria-label="Retour">${I.back()}</button><h1>${esc(title)}</h1></div>`;
}
function micBtn(target, xl) {
  return `<button class="mic${xl ? " xl" : ""}" data-action="dictate" data-target="${target}" aria-label="Dicter">${I.mic("currentColor", xl ? 36 : 24)}</button>`;
}
function seg(items, current, action, deep) {
  return `<div class="seg${deep ? " deep" : ""}">` +
    items.map(([k, l]) => `<button class="${k === current ? "on" : ""}" data-action="${action}" data-val="${esc(k)}">${esc(l)}</button>`).join("") +
    `</div>`;
}
function busyBtn(key, label, action, cls = "primary full", extra = "") {
  const b = U.busy[key];
  return `<button class="btn ${cls}" data-action="${action}" ${extra} ${b ? "disabled" : ""}>${b ? '<span class="loading"></span> Patiente…' : esc(label)}</button>`;
}
/* Sélecteur de lieux (commune -> coordonnées), utilisé le matin et au débrief */
function placePicker(ctx, title) {
  const g = U.geo[ctx] || (U.geo[ctx] = { results: [], lieux: [], sit: null, loading: false });
  const lieux = g.lieux.map((l, i) =>
    `<div class="item">${I.pin("#2ED063", 20)}<span class="grow"><b>${esc(l.name)}</b><br><span class="muted">${esc(l.label)}</span></span><button class="del" data-action="geoRemove" data-ctx="${ctx}" data-i="${i}" aria-label="Retirer">×</button></div>`).join("");
  const results = g.results.map((r, i) =>
    `<button class="btn ghost" style="justify-content:flex-start" data-action="geoPick" data-ctx="${ctx}" data-i="${i}">${esc(r.name)} <span class="muted">· ${esc(r.label)}</span></button>`).join("");
  return `
    <span style="font-size:20px;font-weight:700">${esc(title)}</span>
    ${lieux || '<span class="muted">Aucun lieu noté.</span>'}
    <div class="row">
      <label class="sr" for="place-${ctx}">Commune du chantier</label>
      <input class="input grow" id="place-${ctx}" placeholder="Commune du chantier" autocomplete="off">
      ${micBtn("place-" + ctx)}
    </div>
    <button class="btn ghost" data-action="geoSearch" data-ctx="${ctx}" ${g.loading ? "disabled" : ""}>${g.loading ? '<span class="loading"></span>' : "Chercher la commune"}</button>
    ${results ? `<div class="stack">${results}</div>` : ""}
    <span style="font-weight:600">${ctx === "tomorrow" ? "Demain tu es :" : "Aujourd'hui tu es :"}</span>
    ${seg(SITUATIONS, g.sit, "pickSit", ctx === "tomorrow").replace(/data-action="pickSit"/g, `data-action="pickSit" data-ctx="${ctx}"`)}
  `;
}

/* ---------------------------------------------------------------------
   5. Météo (Open-Meteo, modèle Météo-France)
   --------------------------------------------------------------------- */
async function geocode(q) {
  const url = "https://geocoding-api.open-meteo.com/v1/search?count=6&language=fr&format=json&countryCode=FR&name=" + encodeURIComponent(q);
  const r = await fetch(url);
  if (!r.ok) throw new Error("Recherche de commune impossible (" + r.status + ").");
  const j = await r.json();
  return (j.results || []).map((x) => ({
    name: x.name,
    label: [x.postcodes && x.postcodes[0], x.admin2 || x.admin1].filter(Boolean).join(" · "),
    lat: x.latitude,
    lon: x.longitude
  }));
}

async function getWx(l) {
  const key = l.lat.toFixed(3) + "," + l.lon.toFixed(3);
  const c = U.wx[key];
  if (c && c.data && Date.now() - c.at < 30 * 60 * 1000) return c;
  if (c && c.loading) return c;
  U.wx[key] = { loading: true };
  try {
    const url = "https://api.open-meteo.com/v1/meteofrance?latitude=" + l.lat + "&longitude=" + l.lon +
      "&hourly=temperature_2m,precipitation,wind_speed_10m,wind_gusts_10m&timezone=Europe%2FParis&forecast_days=3";
    const r = await fetch(url);
    if (!r.ok) throw new Error("Météo indisponible (" + r.status + ").");
    U.wx[key] = { at: Date.now(), data: await r.json() };
  } catch (e) {
    U.wx[key] = { at: Date.now(), error: e.message };
  }
  return U.wx[key];
}
function wxOf(l) { return l.lat == null ? null : U.wx[l.lat.toFixed(3) + "," + l.lon.toFixed(3)]; }
const geoPending = {};
async function ensureCoords(l) {
  if (l.lat != null || geoPending[l.name]) return;
  geoPending[l.name] = true;
  try {
    const r = await geocode(l.name);
    if (r.length) { l.lat = r[0].lat; l.lon = r[0].lon; if (!l.label) l.label = r[0].label; save(); }
    else l.geoError = "Commune « " + l.name + " » introuvable.";
  } catch (e) { l.geoError = e.message; }
  geoPending[l.name] = false;
  rerender();
}

function dayHours(data, date) {
  const h = data.hourly, out = [];
  h.time.forEach((t, i) => {
    if (!t.startsWith(date)) return;
    const hr = Number(t.slice(11, 13));
    if (hr < 6 || hr > 19) return;
    out.push({ hr, temp: h.temperature_2m[i], rain: h.precipitation[i], wind: h.wind_speed_10m[i], gust: h.wind_gusts_10m[i] });
  });
  return out;
}

function nacelleDecision(hours) {
  const lim = parseFloat(String(S.settings.nacelleLimit).replace(",", "."));
  if (!lim) return { cls: "neutral", text: "Limite nacelle non renseignée" };
  const work = hours.filter((h) => h.hr >= 7 && h.hr <= 17 && h.gust != null);
  if (!work.length) return { cls: "neutral", text: "Pas de prévision de rafales" };
  const isOk = (h) => h.gust <= lim;
  if (work.every(isOk)) return { cls: "ok", text: "Nacelle OUI toute la journée" };
  if (!work.some(isOk)) return { cls: "no", text: "Nacelle NON" };
  const win = [];
  let start = null;
  work.forEach((h, i) => {
    if (isOk(h) && start === null) start = h.hr;
    const last = i === work.length - 1;
    if (start !== null && (!isOk(h) || last)) {
      win.push(start + "h–" + (isOk(h) ? h.hr + 1 : h.hr) + "h");
      start = null;
    }
  });
  return { cls: "warn", text: "Nacelle OUI " + win.join(", ") };
}

function wxSummary(l, date) {
  if (l.lat == null) return l.geoError ? { error: l.geoError } : { loading: true };
  const w = wxOf(l);
  if (!w || w.loading) return { loading: true };
  if (w.error) return { error: w.error };
  const hours = dayHours(w.data, date);
  if (!hours.length) return { error: "Pas de données pour ce jour." };
  const gusts = hours.filter((h) => h.gust != null);
  const nowHr = new Date().getHours();
  const cur = hours.find((h) => h.hr === nowHr) || hours[0];
  return {
    hours,
    temp: cur.temp != null ? Math.round(cur.temp) + "°" : "—",
    tmin: Math.round(Math.min(...hours.map((h) => h.temp ?? 99))),
    tmax: Math.round(Math.max(...hours.map((h) => h.temp ?? -99))),
    wind: Math.round(Math.max(...hours.map((h) => h.wind ?? 0))),
    gustMax: gusts.length ? Math.round(Math.max(...gusts.map((h) => h.gust))) : null,
    rain: Math.round(hours.reduce((a, h) => a + (h.rain || 0), 0) * 10) / 10,
    decision: nacelleDecision(hours)
  };
}

function loadWxFor(lieux) {
  lieux.forEach((l) => {
    if (l.lat == null) { if (!l.geoError) ensureCoords(l); return; }
    const w = wxOf(l);
    if (!w || (!w.loading && Date.now() - w.at > 30 * 60 * 1000)) getWx(l).then(rerender);
  });
}


/* ---------------------------------------------------------------------
   6. Claude, sans API
   L'appli ne parle pas à Claude directement. Claude travaille dans l'appli
   Claude (abonnement), dans le projet « Assistant de chef d'équipe », et
   dépose ses réponses en fichiers JSON dans le dossier Drive « boite-claude ».
   L'appli les récupère à chaque synchronisation.
   --------------------------------------------------------------------- */
const PROJECT_URL_DEFAULT = "https://claude.ai/project/01a1a12f-fd7b-7674-b13e-efd5911bac61";
const ROOT_FOLDER_DEFAULT = "12drsNMfwPmie1n2CzXBtfhmI6TpRXkhy";   // Drive EG.PACA : Appli Thomas
const BOX_FOLDER_DEFAULT = "1pGTiJ4Nqmq684Of0gwvnPELXMhViD-uP";    // Drive EG.PACA : Appli Thomas/boite-claude
// ID client OAuth public (projet Google Cloud « Appli Thomas », compte EG.PACA). Ce n'est pas un secret.
const GOOGLE_CLIENT_DEFAULT = "631336527654-kiovoa5bh95l6873n9j5pe8hlvqeds4s.apps.googleusercontent.com";
const googleClientId = () => S.settings.googleClientId || GOOGLE_CLIENT_DEFAULT;

/* Ouvre le projet dans l'appli Claude. Le texte éventuel est copié pour être collé. */
function openClaude(text) {
  if (text && navigator.clipboard) {
    navigator.clipboard.writeText(text)
      .then(() => toast("Message copié : colle-le dans Claude ou dis-le à voix haute."))
      .catch(() => { /* presse-papiers refusé : on ouvre quand même */ });
  }
  window.open(S.settings.projectUrl || PROJECT_URL_DEFAULT, "_blank");
}

/* Applique un fichier déposé par Claude. Retourne la liste de ce qui a changé. */
function applyBoxMessage(msg) {
  const done = [];
  if (!msg || typeof msg !== "object") return done;
  const type = msg.type;
  if (type === "brief" && msg.text) {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(msg.date || "") ? msg.date : todayStr();
    S.briefs[date] = { text: String(msg.text), at: Date.now(), by: "claude" };
    done.push("brief du " + shortDate(date));
  } else if (type === "revision" && S.revision[msg.tab] && Array.isArray(msg.questions)) {
    const R = S.revision[msg.tab];
    const known = new Set(R.items.map((i) => i.q));
    let n = 0;
    msg.questions.forEach((q) => {
      if (!q || !q.q || known.has(q.q) || !Array.isArray(q.options) || q.options.length < 2) return;
      R.items.push({ id: uid(), q: q.q, options: q.options, correct: Number(q.correct) || 0, expl: q.expl || "", source: q.source || "", box: 0, due: todayStr(), lastOk: null, created: todayStr() });
      n++;
    });
    R.pack = { date: msg.date || todayStr(), domaine: msg.domaine || "", situation: msg.situation || null, terme: msg.terme || null };
    done.push(n + " question(s) de révision");
  } else if (type === "elocution" && msg.exercice && msg.exercice.consigne) {
    const tab = msg.tab === "compterendu" ? "compterendu" : "directives";
    S.elocution.next = S.elocution.next || {};
    S.elocution.next[tab] = msg.exercice;
    done.push("exercice d'élocution");
  } else if (type === "elocution-note" && msg.total != null) {
    applyEloScore(msg);
    done.push("note d'élocution " + msg.total + "/10");
  } else if (type === "actions" && Array.isArray(msg.items)) {
    msg.items.forEach((a) => applyAction(a, done));
  }
  return done;
}

function applyAction(a, done) {
  if (!a || !a.kind) return;
  const t = todayStr();
  if (a.kind === "agenda" && /^\d{4}-\d{2}-\d{2}$/.test(a.date || "") && a.title) {
    S.agenda.push({ id: uid(), date: a.date, time: /^\d{1,2}:\d{2}$/.test(a.time || "") ? a.time : "", title: a.title, type: a.cat === "perso" ? "perso" : "pro" });
    done.push("agenda : " + a.title);
  } else if (a.kind === "ordre" && a.text) {
    const d = /^\d{4}-\d{2}-\d{2}$/.test(a.date || "") ? a.date : t;
    (S.orders[d] = S.orders[d] || []).push({ id: uid(), who: a.who || "", text: a.text, done: false });
    done.push("ordre : " + a.text);
  } else if (a.kind === "commande" && a.name) {
    const it = findItem(a.name);
    S.stock.orders.push({ id: uid(), cat: a.cat === "outil" ? "outil" : "materiel", name: a.name, qty: a.qty || "", itemId: it ? it.id : "", status: "a_commander", createdAt: t, source: "par Claude" });
    done.push("à commander : " + a.name);
  } else if (a.kind === "journal" && a.text) {
    S.base.journal.push({ at: Date.now(), text: a.text });
    done.push("journal");
  } else if (a.kind === "base" && a.text && a.section in S.base.sections) {
    S.base.sections[a.section] = (S.base.sections[a.section] ? S.base.sections[a.section].trimEnd() + "\n\n" : "") + a.text;
    done.push("base : " + a.section);
  } else if (a.kind === "plan" && /^\d{4}-\d{2}-\d{2}$/.test(a.date || "")) {
    const p = S.plans[a.date] || {};
    if (Array.isArray(a.lieux) && a.lieux.length) p.lieux = a.lieux.map((l) => (typeof l === "string" ? { name: l, label: "" } : l));
    ["situation", "effectif", "horaires", "sensibles"].forEach((k) => { if (a[k]) p[k] = a[k]; });
    S.plans[a.date] = p;
    done.push("préparation du " + shortDate(a.date));
  }
}

/* ---------------------------------------------------------------------
   7. Google (Gmail lecture seule + Drive)
   --------------------------------------------------------------------- */
let gToken = null, gExp = 0;
// drive (et pas drive.file) : il faut lire le dossier partagé où Claude dépose ses fichiers
const G_SCOPES = "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/drive";

function googleToken(interactive = true) {
  return new Promise((resolve, reject) => {
    if (gToken && Date.now() < gExp - 60000) return resolve(gToken);
    if (!interactive) return reject(new Error("Pas connecté à Google."));
    if (!googleClientId()) return reject(new Error("ID client Google à renseigner dans les réglages."));
    if (!window.google || !google.accounts || !google.accounts.oauth2) return reject(new Error("Google n'est pas encore chargé, réessaie dans une seconde."));
    const tc = google.accounts.oauth2.initTokenClient({
      client_id: googleClientId(),
      scope: G_SCOPES,
      callback: (r) => {
        if (r.error) return reject(new Error("Connexion Google refusée."));
        gToken = r.access_token;
        gExp = Date.now() + (Number(r.expires_in) || 3600) * 1000;
        resolve(gToken);
      },
      error_callback: () => reject(new Error("Connexion Google annulée."))
    });
    tc.requestAccessToken({ prompt: "" });
  });
}

function loadMails() {
  try {
    const raw = localStorage.getItem(MAIL_KEY);
    if (!raw) return null;
    const m = JSON.parse(raw);
    if (!m.fetchedAt || Date.now() - m.fetchedAt >= MAIL_WINDOW_MS) { localStorage.removeItem(MAIL_KEY); return null; }
    return m;
  } catch (e) { return null; }
}
function saveMails(m) {
  try { localStorage.setItem(MAIL_KEY, JSON.stringify(m)); } catch (e) { toast("Stockage des mails impossible.", true); }
}

function b64urlDecode(data) {
  try {
    const bin = atob(data.replace(/-/g, "+").replace(/_/g, "/"));
    return new TextDecoder("utf-8").decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  } catch (e) { return ""; }
}
function htmlToText(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return ((doc.body && doc.body.textContent) || "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
function mailBody(payload) {
  let plain = "", html = "";
  (function walk(p) {
    if (!p) return;
    if (p.mimeType === "text/plain" && p.body && p.body.data && !plain) plain = b64urlDecode(p.body.data);
    else if (p.mimeType === "text/html" && p.body && p.body.data && !html) html = b64urlDecode(p.body.data);
    (p.parts || []).forEach(walk);
  })(payload);
  const t = plain || (html ? htmlToText(html) : "");
  return t.length > 3000 ? t.slice(0, 3000) + "\n[…]" : t;
}
function mailHeader(payload, name) {
  const h = (payload.headers || []).find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : "";
}
function decodeEntities(s) { const t = document.createElement("textarea"); t.innerHTML = s; return t.value; }

async function fetchMails(token) {
  const call = async (path) => {
    const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/" + path, { headers: { Authorization: "Bearer " + token } });
    if (r.status === 401) { gToken = null; throw new Error("Connexion Google expirée, réessaie."); }
    if (!r.ok) throw new Error("Gmail a répondu " + r.status + ".");
    return r.json();
  };
  const profile = await call("profile");
  const list = await call("messages?maxResults=" + MAIL_MAX + "&labelIds=INBOX");
  const mails = await Promise.all((list.messages || []).map(async (m) => {
    const msg = await call("messages/" + m.id + "?format=full");
    return {
      id: msg.id,
      from: mailHeader(msg.payload, "From"),
      subject: mailHeader(msg.payload, "Subject"),
      date: Number(msg.internalDate) || null,
      snippet: decodeEntities(msg.snippet || ""),
      body: mailBody(msg.payload)
    };
  }));
  mails.sort((a, b) => (b.date || 0) - (a.date || 0));
  // Nouvelle tranche de 24 h : l'ancien stock est remplacé entièrement.
  const store = { account: profile.emailAddress, fetchedAt: Date.now(), mails, summary: "" };
  saveMails(store);
  return store;
}

function exportData() {
  const copy = JSON.parse(JSON.stringify(S));
  const m = loadMails();
  return {
    app: "egpaca-chef-equipe",
    version: 2,
    exportedAt: new Date().toISOString(),
    lisezmoi: "État de l'appli de Thomas, écrit par l'appli. Claude le lit mais ne le modifie jamais : pour agir, il dépose un fichier JSON dans le dossier boite-claude (voir le mode d'emploi dans le projet).",
    data: copy,
    mails: m ? { compte: m.account, recuperesLe: new Date(m.fetchedAt).toISOString(), liste: m.mails.map((x) => ({ de: x.from, objet: x.subject, date: x.date ? new Date(x.date).toISOString() : "", texte: (x.body || x.snippet || "").slice(0, 1500) })) } : null
  };
}

/* ---------- Synchronisation avec le Drive ----------
   etat-appli.json : écrit seulement par l'appli, lu par Claude.
   boite-claude/*.json : écrits seulement par Claude, lus par l'appli.
   Chaque fichier n'a qu'un seul auteur, donc pas de conflit d'écriture. */
const DRIVE = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UP = "https://www.googleapis.com/upload/drive/v3/files";
const STATE_NAME = "etat-appli.json";

async function gfetch(token, url, opts = {}) {
  const r = await fetch(url, Object.assign({}, opts, { headers: Object.assign({ Authorization: "Bearer " + token }, opts.headers || {}) }));
  if (r.status === 401) { gToken = null; throw new Error("Connexion Google expirée : appuie sur Synchroniser."); }
  if (r.status === 404) throw new Error("Dossier Drive introuvable : vérifie qu'il est bien partagé avec ton compte Google.");
  if (!r.ok) throw new Error("Google Drive a répondu " + r.status + ".");
  return r;
}
async function listFolder(token, folderId, extra) {
  const q = encodeURIComponent("'" + folderId + "' in parents and trashed = false" + (extra ? " and " + extra : ""));
  const r = await gfetch(token, DRIVE + "?q=" + q + "&fields=files(id,name,createdTime)&orderBy=createdTime&pageSize=200&supportsAllDrives=true&includeItemsFromAllDrives=true");
  return (await r.json()).files || [];
}
async function readJson(token, id) {
  const r = await gfetch(token, DRIVE + "/" + id + "?alt=media&supportsAllDrives=true");
  return JSON.parse(await r.text());
}
async function writeState(token) {
  const st = S.settings;
  const body = JSON.stringify(exportData());
  const boundary = "egpaca" + Date.now();
  const meta = st.driveFileId ? { name: STATE_NAME } : { name: STATE_NAME, mimeType: "application/json", parents: [st.rootFolderId || ROOT_FOLDER_DEFAULT] };
  const multipart = "--" + boundary + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" + JSON.stringify(meta) +
    "\r\n--" + boundary + "\r\nContent-Type: application/json\r\n\r\n" + body + "\r\n--" + boundary + "--";
  const url = st.driveFileId
    ? DRIVE_UP + "/" + st.driveFileId + "?uploadType=multipart&supportsAllDrives=true"
    : DRIVE_UP + "?uploadType=multipart&supportsAllDrives=true";
  const r = await gfetch(token, url, { method: st.driveFileId ? "PATCH" : "POST", headers: { "Content-Type": "multipart/related; boundary=" + boundary }, body: multipart });
  const j = await r.json();
  st.driveFileId = j.id;
}

let syncing = false, syncTimer = null;
async function syncNow(interactive) {
  if (syncing) return;
  let token;
  try { token = await googleToken(interactive); }
  catch (e) { if (interactive) toast(e.message, true); return; }
  syncing = true; U.busy.sync = true; rerender();
  try {
    const st = S.settings;
    const root = st.rootFolderId || ROOT_FOLDER_DEFAULT;
    const box = st.boxFolderId || BOX_FOLDER_DEFAULT;
    // 1. Retrouver l'état sur le Drive. Un téléphone neuf (rien enregistré) reprend celui du Drive.
    if (!st.driveFileId) {
      const f = await listFolder(token, root, "name = '" + STATE_NAME + "'");
      if (f.length) {
        st.driveFileId = f[0].id;
        if (!S.rev) {
          const remote = await readJson(token, f[0].id);
          if (remote && remote.data) {
            const mine = S.settings;
            S = merge(defaults(), remote.data);
            S.settings = Object.assign({}, S.settings, mine);
            toast("Données récupérées depuis le Drive.");
          }
        }
      }
    }
    // 2. Ce que Claude a déposé
    S.processed = S.processed || [];
    const seen = new Set(S.processed);
    const got = [];
    for (const f of await listFolder(token, box)) {
      if (seen.has(f.id) || !/\.json$/i.test(f.name)) continue;
      try { applyBoxMessage(await readJson(token, f.id)).forEach((x) => got.push(x)); }
      catch (e) { got.push("fichier illisible : " + f.name); }
      S.processed.push(f.id);
    }
    S.processed = S.processed.slice(-500);
    // 3. Envoyer l'état pour Claude
    S.lastSync = Date.now();
    save(true);
    await writeState(token);
    save(true);
    if (got.length) toast("Reçu de Claude : " + got.slice(0, 3).join(" · ") + (got.length > 3 ? " …" : ""));
    else if (interactive) toast("Synchronisé.");
  } catch (e) {
    toast(e.message, true);
  }
  syncing = false; U.busy.sync = false; rerender();
}
/* Après une modification, synchronise tout seul si Google est déjà connecté */
function scheduleSync() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => { if (gToken && Date.now() < gExp - 60000) syncNow(false); }, 4000);
}
function syncLine() {
  return `<div class="row" style="justify-content:space-between">
    <span class="muted">${S.lastSync ? "Synchro : " + esc(fmtDateTime(S.lastSync)) : "Jamais synchronisé"}</span>
    <button class="btn ghost" style="min-height:40px;padding:0 12px;font-size:14px" data-action="sync" ${U.busy.sync ? "disabled" : ""}>${U.busy.sync ? '<span class="loading"></span>' : "Synchroniser"}</button></div>`;
}

/* ---------------------------------------------------------------------
   8. Dictée vocale (reconnaissance du téléphone)
   --------------------------------------------------------------------- */
let recog = null, recogBtn = null;
function dictate(targetId, btn) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { toast("Dictée non disponible ici : utilise le micro du clavier.", true); return; }
  if (recog) { recog.stop(); return; }
  const el = document.getElementById(targetId);
  if (!el) return;
  recog = new SR();
  recog.lang = "fr-FR";
  recog.interimResults = false;
  const isChat = targetId === "chatInput";
  // En conversation : la dictée s'arrête au premier silence et la phrase part toute seule
  recog.continuous = !isChat;
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  recogBtn = btn;
  btn.classList.add("on");
  const startText = el.value;
  let finals = "";
  recog.onresult = (e) => {
    for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) finals += e.results[i][0].transcript + " ";
    el.value = (startText ? startText.trimEnd() + " " : "") + finals.trim();
  };
  recog.onerror = (e) => { if (e.error !== "no-speech" && e.error !== "aborted") toast("Dictée : " + e.error, true); };
  recog.onend = () => {
    if (recogBtn) recogBtn.classList.remove("on");
    recog = null; recogBtn = null;
    if (U.elo && targetId === "eloAnswer" && !U.elo.endAt) U.elo.endAt = Date.now();
  };
  if (U.elo && targetId === "eloAnswer" && !U.elo.startAt) U.elo.startAt = Date.now();
  recog.start();
}

/* ---------------------------------------------------------------------
   9. Écrans
   --------------------------------------------------------------------- */

/* ---------- Accueil ---------- */
function vHome() {
  const t = todayStr();
  const plan = S.plans[t];
  const hasPlan = plan && plan.lieux && plan.lieux.length;
  if (!U.geo.setup) U.geo.setup = { results: [], lieux: [], sit: plan ? plan.situation : null, loading: false };
  let html = `
    <div class="top">
      <div><div class="over">${esc(longDate(t))}</div><h1>Bonjour Thomas</h1><div class="filet"></div></div>
      <button class="iconbtn" data-action="go" data-to="reglages" aria-label="Réglages">${I.gear()}</button>
    </div>` + syncLine();

  if (!hasPlan) {
    html += `<div class="card green">
      <span class="over" style="color:#fff">Rien de noté hier soir</span>
      ${placePicker("setup", "On va où aujourd'hui ?")}
      <button class="btn primary" data-action="setupValidate">Valider et charger la météo</button>
    </div>`;
  } else {
    loadWxFor(plan.lieux);
    plan.lieux.forEach((l, i) => {
      const s = wxSummary(l, t);
      html += `<button class="card" style="border:0;text-align:left;cursor:pointer;color:#fff" data-action="openMeteo" data-i="${i}">
        <span class="muted">Météo · ${esc(l.name)} · ${esc(sitLabel(plan.situation))}</span>
        ${s.loading ? '<span><span class="loading"></span></span>'
          : s.error ? `<span class="soft">${esc(s.error)}</span>`
          : `<span class="row" style="gap:16px"><span style="font-family:'Playfair Display',Georgia,serif;font-size:46px;font-weight:700;line-height:1">${esc(s.temp)}</span>
             <span class="soft" style="font-size:14px">Vent moyen jusqu'à ${s.wind} km/h<br>Rafales max ${s.gustMax ?? "—"} km/h<br>Pluie ${s.rain} mm</span></span>
             <span class="decision ${s.decision.cls}">${esc(s.decision.text)}</span>`}
      </button>`;
    });
  }

  // Prévu aujourd'hui
  const ev = S.agenda.filter((e) => e.date === t).sort((a, b) => (a.time || "").localeCompare(b.time || ""));
  const ord = S.orders[t] || [];
  let prevu = "";
  if (hasPlan) prevu += plan.lieux.map((l) => `<div class="item">${I.pin("#2ED063", 18)}<span>${esc(l.name)}</span></div>`).join("");
  prevu += ev.map((e) => `<div class="item"><span class="sw ${e.type}"></span><span>${esc(e.time || "")} ${esc(e.title)}</span></div>`).join("");
  if (ord.length) prevu += `<div class="muted">${ord.filter((o) => o.done).length} ordre(s) fait(s) sur ${ord.length}</div>`;
  html += `<div class="card"><span class="over">Prévu aujourd'hui</span>${prevu || '<span class="soft">Rien de prévu. Ton débrief de ce soir remplira cette carte.</span>'}</div>`;

  // Matériel : commandes du jour et rappel d'inventaire
  const need = needList();
  if (need.length) {
    html += `<button class="card" style="border:1px solid #E08A1E;text-align:left;cursor:pointer;color:#fff" data-action="openStock" data-tab="commander">
      <span class="over" style="color:#E08A1E">À commander aujourd'hui · ${need.length}</span>
      ${need.slice(0, 5).map((n) => `<span class="row" style="gap:8px">${n.cat === "outil" ? I.tool("#C9CED6", 16) : I.box("#C9CED6", 16)}<span>${esc(n.name)}${n.detail ? ' <span class="muted">· ' + esc(n.detail) + "</span>" : ""}</span></span>`).join("")}
      ${need.length > 5 ? `<span class="muted">et ${need.length - 5} autre(s)</span>` : ""}
    </button>`;
  }
  if (invDue()) {
    const empty = !S.stock.items.length;
    html += `<div class="card" style="border:1px solid #E08A1E"><b>${empty ? "Crée ton inventaire" : "Inventaire à refaire"}</b>
      <span class="soft">${empty ? "Liste tes outils et ton matériel une fois. Ensuite l'appli te dira quoi commander." : S.stock.lastInventory ? "Dernier inventaire : " + esc(longDate(S.stock.lastInventory)) + "." : "Aucun inventaire validé pour l'instant."} Rappel tous les ${S.stock.invEvery} jours.</span>
      <button class="btn primary" data-action="openStock" data-tab="${empty ? "outil" : "inventaire"}">${empty ? "Commencer par l'outillage" : "Faire l'inventaire"}</button></div>`;
  }

  html += `<button class="btn primary big" data-action="go" data-to="parler">${I.mic("currentColor", 26)} Parler à Claude</button>
    <button class="btn danger big" data-action="go" data-to="incident">${I.alert("currentColor", 26)} Incident / urgence</button>
    <div class="grid2">
      <button class="tile main" data-action="go" data-to="brief">${I.sun("currentColor", 28)}<b>Brief du matin</b></button>
      <button class="tile" data-action="go" data-to="ordres">${I.list("#2ED063", 28)}<b>Ordres du jour</b></button>
      <button class="tile" data-action="go" data-to="stock">${I.tool("#E08A1E", 28)}<b>Matériel &amp; outillage<small>${need.length ? need.length + " à commander" : "Inventaire et commandes"}</small></b></button>
      <button class="tile" data-action="go" data-to="debrief">${I.moon("#9DB8F7", 28)}<b>Débrief du soir</b></button>
      <button class="tile" data-action="go" data-to="revision">${I.book("#2ED063", 28)}<b>Révision<small>${dueCountAll()} à revoir aujourd'hui</small></b></button>
      <button class="tile" data-action="go" data-to="elocution">${I.chat("#C792EA", 28)}<b>Élocution<small>Niveau ${S.elocution.level} sur 5</small></b></button>
      <button class="tile" data-action="go" data-to="agenda">${I.cal("#2ED063", 28)}<b>Agenda<small>Pro et perso</small></b></button>
      <button class="tile" data-action="go" data-to="mails">${I.mail("#C9CED6", 28)}<b>Mails<small>${mailsLabel()}</small></b></button>
      <button class="tile" data-action="go" data-to="meteo">${I.wind("#E08A1E", 28)}<b>Météo &amp; nacelle</b></button>
      <button class="tile" data-action="go" data-to="base">${I.db("#C9CED6", 28)}<b>Base &amp; journal</b></button>
    </div>`;
  return html;
}
function mailsLabel() { const m = loadMails(); return m ? m.mails.length + " mail(s) récupéré(s)" : "Pas encore récupérés"; }

/* ---------- Brief ---------- */
function vBrief() {
  const t = todayStr();
  const plan = S.plans[t];
  const brief = S.briefs[t];
  let html = head("Brief du matin") + syncLine();
  if (!plan || !plan.lieux || !plan.lieux.length) {
    if (!U.geo.setup) U.geo.setup = { results: [], lieux: [], sit: null, loading: false };
    html += `<div class="card green"><span class="over" style="color:#fff">Rien de noté hier soir</span>${placePicker("setup", "On va où aujourd'hui ?")}
      <button class="btn primary" data-action="setupValidate">Valider</button></div>`;
  } else {
    loadWxFor(plan.lieux);
    html += `<div class="muted">${esc(plan.lieux.map((l) => l.name).join(", "))} · ${esc(sitLabel(plan.situation))}</div>`;
  }
  if (brief) {
    html += `<div class="card"><span class="muted">Préparé par Claude · ${esc(fmtDateTime(brief.at))}</span><div class="pre">${esc(brief.text)}</div></div>
      <div class="row"><button class="btn primary grow" data-action="speak">Lire à voix haute</button>
      <button class="btn ghost grow" data-action="claudeAsk" data-text="Refais le brief du jour.">Refaire avec Claude</button></div>`;
  } else {
    html += `<div class="card"><b>Le brief n'est pas encore arrivé</b>
      <span class="soft">Claude le prépare chaque matin vers ${esc(S.settings.briefTime || "5h45")}, à partir du débrief d'hier, de la météo des chantiers, de l'agenda, du matériel et de tes derniers mails. Appuie sur Synchroniser pour le récupérer.</span></div>
      <button class="btn ghost" data-action="claudeAsk" data-text="Fais-moi le brief du jour.">Le demander à Claude maintenant</button>`;
  }
  if (plan && plan.lieux && plan.lieux.length) {
    html += `<div class="card"><span class="over">Météo des chantiers</span>${plan.lieux.map((l) => {
      const s = wxSummary(l, t);
      return `<div class="item"><span class="grow"><b>${esc(l.name)}</b><br><span class="muted">${s.loading ? "chargement…" : s.error ? esc(s.error) : s.tmin + "° à " + s.tmax + "° · rafales max " + (s.gustMax ?? "—") + " km/h · pluie " + s.rain + " mm"}</span></span>
        ${s.decision ? `<span class="decision ${s.decision.cls}" style="font-size:13px">${esc(s.decision.text)}</span>` : ""}</div>`;
    }).join("")}</div>`;
  }
  return html;
}

/* ---------- Ordres ---------- */
function vOrdres() {
  const t = todayStr();
  const list = S.orders[t] || [];
  const names = [...new Set(Object.values(S.orders).flat().map((o) => o.who).filter(Boolean))];
  let html = head("Ordres du jour");
  if (!list.length) {
    html += `<div class="card"><b>Aucun ordre pour l'instant</b><span class="soft">Écris ou dicte un ordre. Commence par le nom pour le ranger : « Karim : poser les goulottes ».</span></div>`;
  } else {
    const groups = {};
    list.forEach((o) => { (groups[o.who || "Sans nom"] = groups[o.who || "Sans nom"] || []).push(o); });
    html += `<div class="muted">${list.filter((o) => o.done).length} sur ${list.length} fait(s)</div>`;
    Object.keys(groups).forEach((who) => {
      html += `<div class="card"><h2>${esc(who)}</h2>` + groups[who].map((o) => `
        <div class="item">
          <button class="check ${o.done ? "done" : ""}" data-action="toggleOrder" data-id="${o.id}" aria-label="${o.done ? "Marquer à faire" : "Marquer fait"}">${o.done ? "✓" : ""}</button>
          <span class="grow ${o.done ? "done-text" : ""}">${esc(o.text)}</span>
          <button class="del" data-action="delOrder" data-id="${o.id}" aria-label="Supprimer">×</button>
        </div>`).join("") + `</div>`;
    });
  }
  html += `
    <label class="lbl" for="orderText">Nouvel ordre</label>
    <div class="row"><input class="input grow" id="orderText" placeholder="Nom : tâche" list="whoList">${micBtn("orderText")}</div>
    <datalist id="whoList">${names.map((n) => `<option value="${esc(n)} : ">`).join("")}</datalist>
    <button class="btn primary" data-action="addOrder">Ajouter l'ordre</button>`;
  return html;
}

/* ---------- Incident ---------- */
function vIncident() {
  const exploit = S.settings.urgenceExploitant;
  return head("Incident") + `<div class="card red">
      <b>Blessé, électrisation, gaz, câble arraché, incendie : appelle d'abord.</b>
      <div class="grid3">
        <a class="btn danger" style="flex-direction:column;gap:0;min-height:58px" href="tel:15">15<small style="font-weight:500;font-size:12px">SAMU</small></a>
        <a class="btn danger" style="flex-direction:column;gap:0;min-height:58px" href="tel:18">18<small style="font-weight:500;font-size:12px">Pompiers</small></a>
        <a class="btn danger" style="flex-direction:column;gap:0;min-height:58px" href="tel:112">112<small style="font-weight:500;font-size:12px">Europe</small></a>
      </div>
      ${exploit ? `<a class="btn ghost" href="tel:${esc(exploit.replace(/[^\d+]/g, ""))}">Urgence exploitant : ${esc(exploit)}</a>` : '<span class="muted" style="color:#E8C5C6">Urgence exploitant (électricité, gaz) : à renseigner dans les réglages.</span>'}
    </div>
    <button class="btn primary big" data-action="claudeAsk" data-text="INCIDENT EN COURS : ">${I.mic("currentColor", 26)} Décrire à Claude à la voix</button>
    <div class="card"><label class="lbl" for="incText">Ou écris le problème ici, il sera copié pour Claude</label>
      <textarea class="input" id="incText" placeholder="Ce qui se passe, où, qui est là…"></textarea>
      <div class="row">${micBtn("incText")}<button class="btn ghost grow" data-action="incSend">Copier et ouvrir Claude</button></div></div>
    <span class="muted">Claude répond avec les ordres dans l'appli Claude, et note dans le journal comment ça s'est terminé.</span>`;
}

/* ---------- Débrief ---------- */
const DEBRIEF_Q = [
  "Avancement par chantier ?",
  "Problèmes rencontrés, et comment vous les avez réglés ?",
  "Ce qui a bien marché ?",
  "Matériel consommé ou à commander ?",
  "Effectif de demain et noms ?",
  "Horaires de demain ?",
  "Matériel à récupérer ?",
  "Points sensibles pour demain (client, accès, coupure, livraison) ?"
];

function vDebrief() {
  const t = todayStr();
  const done = S.debriefs.find((d) => d.date === t);
  let html = head("Débrief du soir");
  if (!U.deb) {
    if (done) {
      html += `<div class="card"><span class="over">Débrief de ce soir enregistré</span>${done.answers.filter((a) => a.a).map((a) => `<span><span class="muted">${esc(a.q)}</span><br>${esc(a.a)}</span>`).join("") || '<span class="soft">Aucune réponse notée.</span>'}</div>
        <span class="muted">Claude s'en sert pour le brief de demain matin et range le matériel à commander.</span>
        <button class="btn ghost" data-action="claudeAsk" data-text="On complète le débrief du soir.">Compléter à la voix avec Claude</button>
        <button class="btn ghost" data-action="startDebrief">Refaire le débrief</button>`;
    } else {
      html += `<div class="card"><b>${DEBRIEF_Q.length + 1} étapes</b><span class="soft">Une question à la fois, à la voix ou à l'écrit. On termine par le lieu et ta situation de demain.</span></div>
        <button class="btn primary big" data-action="startDebrief">Commencer le débrief</button>`;
    }
    return html;
  }
  const d = U.deb;
  const total = DEBRIEF_Q.length + 1;
  html += `<div class="stack" style="gap:6px"><div class="muted">Étape ${Math.min(d.step + 1, total)} sur ${total}</div>
    <div class="progress"><div style="width:${Math.round((Math.min(d.step + 1, total) / total) * 100)}%"></div></div></div>`;
  d.answers.forEach((a) => {
    html += `<div class="bubble q">${esc(a.q)}</div><div class="bubble a">${esc(a.a || "(passé)")}</div>`;
  });
  if (d.step < DEBRIEF_Q.length) {
    html += `<div class="bubble q cur">${esc(DEBRIEF_Q[d.step])}</div>
      <label class="sr" for="debAnswer">Ta réponse</label>
      <textarea class="input" id="debAnswer" placeholder="Ta réponse"></textarea>
      <div class="row" style="justify-content:center">${micBtn("debAnswer", true)}</div>
      <div class="row"><button class="btn ghost grow" data-action="debSkip">Passer</button><button class="btn primary grow" data-action="debNext">Suivant</button></div>`;
  } else {
    const tm = addDays(t, 1);
    if (!U.geo.tomorrow) {
      const p = S.plans[tm];
      U.geo.tomorrow = { results: [], lieux: p ? [...p.lieux] : [], sit: p ? p.situation : null, loading: false };
    }
    html += `<div class="card outline"><span class="over" style="color:#fff">Préparer demain · ${esc(longDate(tm))}</span>
      ${placePicker("tomorrow", "On va où ?")}
      <span class="muted">Demain matin, la météo, la décision nacelle et le brief seront faits pour ces lieux.</span></div>
      ${busyBtn("deb", "Terminer le débrief", "debFinish")}`;
  }
  return html;
}

function debFinish() {
  const t = todayStr(), tm = addDays(t, 1);
  const g = U.geo.tomorrow;
  const ans = U.deb.answers;
  const get = (i) => (ans[i] && ans[i].a) || "";
  S.plans[tm] = { lieux: g.lieux, situation: g.sit, effectif: get(4), horaires: get(5), sensibles: get(7) };
  // Chantiers de demain dans l'agenda (pro), sans doublon
  S.agenda = S.agenda.filter((e) => !(e.auto === true && e.date === tm));
  g.lieux.forEach((l) => S.agenda.push({ id: uid(), date: tm, time: (get(5).match(/\d{1,2}h\d{0,2}/) || [""])[0], title: "Chantier · " + l.name, type: "pro", auto: true }));
  S.debriefs = S.debriefs.filter((d) => d.date !== t);
  S.debriefs.push({ date: t, answers: ans, recap: "" });
  save();
  U.deb = null; U.geo.tomorrow = null;
  toast("Débrief enregistré. Claude s'en servira pour le brief de demain matin.");
  rerender();
}

/* ---------- Révision espacée ---------- */
const REV_TABS = [["elec", "Électricité"], ["management", "Management"], ["marketing", "Marketing"]];
function dueItems(tab) { const t = todayStr(); return S.revision[tab].items.filter((i) => i.due <= t); }
function dueCountAll() { return REV_TABS.reduce((n, [k]) => n + dueItems(k).length, 0); }

function vRevision() {
  let html = head("Révision") + seg(REV_TABS, U.revTab, "revTab");
  const tab = U.revTab;
  const label = REV_TABS.find((x) => x[0] === tab)[1];
  const R = S.revision[tab];
  if (U.rev && U.rev.tab === tab) return html + revSession();
  const due = dueItems(tab).length;
  const mastered = R.items.filter((i) => i.box >= 3).length;
  const toReview = R.items.filter((i) => i.lastOk === false).length;
  const lastS = R.sessions.slice(-1)[0];
  html += `<div class="card"><b>${R.sessions.length ? R.sessions.length + " session(s) en " + esc(label.toLowerCase()) : "Aucune session en " + esc(label.toLowerCase())}</b>
      ${lastS ? `<span class="muted">Dernière : ${esc(shortDate(lastS.date))} · ${esc(lastS.domain || "")} · ${lastS.ok}/${lastS.ok + lastS.ko}</span>` : ""}</div>`;
  if (due) html += `<button class="btn primary big" data-action="startRevision">Commencer (${due} question${due > 1 ? "s" : ""})</button>`;
  else html += `<div class="card"><b>Pas de question prévue aujourd'hui</b><span class="soft">Claude prépare les questions du jour avec le brief du matin. Appuie sur Synchroniser pour les récupérer.</span></div>`;
  html += `<button class="btn ghost" data-action="claudeAsk" data-text="On révise 10 minutes : ${esc(label.toLowerCase())}.">Réviser à la voix avec Claude</button>
    <div class="grid2">
      <div class="card"><span class="muted">Points maîtrisés</span><b>${mastered}</b></div>
      <div class="card"><span class="muted">Points à revoir</span><b>${toReview}</b></div></div>
    <div class="card"><span class="over">Révision espacée</span>
      <div class="row wrap">${INTERVALS.map((d) => `<span class="chip">J+${d}</span>`).join("")}</div>
      <span class="soft" style="font-size:14px">Une question réussie revient de plus en plus tard. Une question ratée revient le lendemain.</span></div>`;
  return html;
}

function startRevision() {
  const tab = U.revTab, R = S.revision[tab];
  const qs = dueItems(tab).slice(0, 5);
  if (!qs.length) { toast("Rien à réviser pour l'instant."); return; }
  const pack = R.pack && R.pack.date === todayStr() ? R.pack : {};
  U.rev = { tab, qs, i: 0, picked: null, ok: 0, ko: 0, okList: [], koList: [], domain: pack.domaine || "Révision", situation: pack.situation || null, terme: pack.terme || null, phase: "q" };
  rerender();
}

function revSession() {
  const r = U.rev;
  if (r.phase === "q") {
    const q = r.qs[r.i];
    let html = `<div class="row"><span class="chip">${esc(r.domain)}</span><span class="muted">Question ${r.i + 1} sur ${r.qs.length}</span></div>
      <div style="font-size:20px;font-weight:600;line-height:1.35">${esc(q.q)}</div><div class="stack">`;
    q.options.forEach((o, k) => {
      let cls = "answer";
      if (r.picked !== null) cls += k === q.correct ? " good" : k === r.picked ? " bad" : " dim";
      html += `<button class="${cls}" data-action="revPick" data-k="${k}" ${r.picked !== null ? "disabled" : ""}>${esc(o)}</button>`;
    });
    html += `</div>`;
    if (r.picked !== null) {
      const good = r.picked === q.correct;
      html += `<div class="card ${good ? "green" : "red"}"><b>${good ? "Correct." : "Pas tout à fait."}</b><span>${esc(q.expl)}</span>${q.source ? `<span class="muted">Source : ${esc(q.source)}</span>` : ""}</div>
        <button class="btn primary" data-action="revNext">${r.i + 1 < r.qs.length ? "Question suivante" : "Suite"}</button>`;
    }
    return html;
  }
  // Mise en situation + terme du jour + fin
  let html = `<div class="card"><b>${r.ok} bonne(s) réponse(s) sur ${r.qs.length}</b></div>`;
  if (r.situation) {
    html += `<div class="card outline"><span class="over" style="color:#fff">Mise en situation</span><span>${esc(r.situation.q)}</span>
      <textarea class="input" id="sitAnswer" placeholder="Ta réponse (à la voix ou à l'écrit)"></textarea>
      <div class="row">${micBtn("sitAnswer")}<button class="btn ghost grow" data-action="revShowSit">Voir la réponse attendue</button></div>
      ${r.showSit ? `<div class="pre soft">${esc(r.situation.attendu)}</div>` : ""}</div>`;
  }
  if (r.terme) html += `<div class="card"><span class="over">Terme du jour</span><b>${esc(r.terme.mot)}</b><span class="soft">${esc(r.terme.def)}</span></div>`;
  html += `<button class="btn primary" data-action="revFinish">Terminer la session</button>`;
  return html;
}

function revPick(k) {
  const r = U.rev, q = r.qs[r.i];
  if (r.picked !== null) return;
  r.picked = k;
  const ok = k === q.correct;
  const item = S.revision[r.tab].items.find((x) => x.id === q.id);
  if (item) {
    item.lastOk = ok;
    item.box = ok ? Math.min((item.box || 0) + 1, INTERVALS.length - 1) : 0;
    item.due = addDays(todayStr(), ok ? INTERVALS[item.box] : 1);
  }
  if (ok) { r.ok++; r.okList.push(q.q); } else { r.ko++; r.koList.push(q.q); }
  save();
  rerender();
}

function revFinish() {
  const r = U.rev;
  S.revision[r.tab].sessions.push({ date: todayStr(), domain: r.domain, ok: r.ok, ko: r.ko, maitrise: r.okList, aRevoir: r.koList });
  save();
  U.rev = null;
  toast("Session enregistrée dans le suivi.");
  rerender();
}

/* ---------- Élocution ---------- */
const ELO_TABS = [["directives", "Directives"], ["compterendu", "Compte rendu"]];
const ELO_DESC = {
  directives: "donner des directives claires à une équipe ou un ouvrier",
  compterendu: "faire un compte rendu clair à un responsable ou un client"
};
const ELO_LEVELS = ["", "situation simple, 1 personne, 1 tâche", "2 personnes, 2 chantiers, une contrainte", "imprévu à intégrer, réorganisation", "interlocuteur tendu ou pressé, informations incomplètes", "situation de crise, plusieurs contraintes, arbitrage à justifier"];

function vElocution() {
  const E = S.elocution;
  let html = head("Élocution");
  const last3 = E.history.slice(-3);
  const avg = last3.length ? Math.round((last3.reduce((a, h) => a + h.total, 0) / last3.length) * 10) / 10 : null;
  html += `<div class="card"><div class="row" style="justify-content:space-between"><b>Niveau ${E.level} sur 5</b><span class="muted">${avg != null ? "Moyenne récente " + avg + "/10" : "Pas encore de note"}</span></div>
    <div class="progress"><div style="width:${E.level * 20}%;background:#2ED063"></div></div>
    <span class="muted">${esc(ELO_LEVELS[E.level])}. Moyenne de 8/10 sur 3 exercices pour monter.</span></div>`;
  html += seg(ELO_TABS, U.eloTab, "eloTab");
  const ex = (E.next || {})[U.eloTab];
  if (ex) {
    html += `<div class="card perso"><span class="over">Exercice du jour</span><span style="font-size:17px;font-weight:600">${esc(ex.consigne)}</span>
      ${ex.contexte ? `<span class="soft">${esc(ex.contexte)}</span>` : ""}
      ${ex.temps ? `<span class="muted">Objectif : moins de ${esc(ex.temps)} secondes.</span>` : ""}</div>`;
  } else {
    html += `<div class="card"><b>Pas encore d'exercice</b><span class="soft">Claude en prépare un chaque matin avec le brief. Tu peux aussi lui en demander un tout de suite.</span></div>`;
  }
  html += `<button class="btn primary big" data-action="eloGo">${I.mic("currentColor", 26)} Faire l'exercice avec Claude</button>
    <span class="muted">Tu parles dans Claude, il te note sur 10 (clarté, concision, structure, assurance) et la note arrive ici à la prochaine synchro.</span>`;
  const hist = E.history.filter((h) => h.type === U.eloTab).slice(-5).reverse();
  if (hist.length) {
    html += `<div class="card"><span class="over">Dernières notes</span>` + hist.map((h) => `
      <div class="stack" style="gap:2px;border-top:1px solid #2C4166;padding-top:8px"><div class="row" style="justify-content:space-between"><span class="muted">${esc(fmtDateTime(h.at))}</span><b>${esc(h.total)}/10</b></div>
      ${h.ex && h.ex.consigne ? `<span class="soft" style="font-size:14px">${esc(h.ex.consigne)}</span>` : ""}
      ${h.ameliorer ? `<span style="font-size:14px">À améliorer : ${esc(h.ameliorer)}</span>` : ""}</div>`).join("") + `</div>`;
  }
  return html;
}

/* Note déposée par Claude : historique, reprise des exercices ratés et niveau */
function applyEloScore(m) {
  const E = S.elocution;
  const type = m.tab === "compterendu" ? "compterendu" : "directives";
  const total = Math.max(0, Math.min(10, Number(m.total) || 0));
  const ex = { consigne: m.consigne || "", contexte: m.contexte || "" };
  E.history.push({ at: Date.now(), type, level: E.level, ex, total, clarte: m.clarte, concision: m.concision, structure: m.structure, assurance: m.assurance, forts: m.forts || "", ameliorer: m.ameliorer || "", version: m.version || "" });
  if (E.next && E.next[type] && (!m.consigne || E.next[type].consigne === m.consigne)) delete E.next[type];
  if (total < 6 && ex.consigne) E.retry.push({ id: uid(), type, ex, box: 0, due: addDays(todayStr(), 1) });
  const since = E.history.filter((h) => h.at > (E.levelChangedAt || 0)).slice(-3);
  if (since.length === 3) {
    const avg = since.reduce((a, h) => a + h.total, 0) / 3;
    if (avg >= 8 && E.level < 5) { E.level++; E.levelChangedAt = Date.now(); }
    else if (avg < 4 && E.level > 1) { E.level--; E.levelChangedAt = Date.now(); }
  }
}

/* ---------- Agenda ---------- */
function vAgenda() {
  const t = todayStr();
  if (!U.agWeekStart) U.agWeekStart = mondayOf(t);
  if (!U.agDay) U.agDay = t;
  const days = [...Array(7)].map((_, i) => addDays(U.agWeekStart, i));
  const end = days[6];
  let html = head("Agenda");
  html += `<div class="row" style="justify-content:space-between">
      <button class="iconbtn" data-action="agWeek" data-n="-7" aria-label="Semaine précédente">${I.back()}</button>
      <span class="muted">Du ${esc(shortDate(days[0]))} au ${esc(shortDate(end))}</span>
      <button class="iconbtn" data-action="agWeek" data-n="7" aria-label="Semaine suivante" style="transform:scaleX(-1)">${I.back()}</button></div>
    <div class="week">` + days.map((d) => {
      const evs = S.agenda.filter((e) => e.date === d);
      const dots = ["pro", "perso"].filter((ty) => evs.some((e) => e.type === ty)).map((ty) => `<span class="dot ${ty}"></span>`).join("");
      const dt = parseDate(d);
      return `<button class="day ${d === U.agDay ? "on" : ""} ${d === t ? "today" : ""}" data-action="agDay" data-d="${d}"><small>${dt.toLocaleDateString("fr-FR", { weekday: "short" }).replace(".", "")}</small><b>${dt.getDate()}</b><span class="dots">${dots}</span></button>`;
    }).join("") + `</div>
    <div class="row wrap" style="gap:16px;font-size:14px"><span class="row" style="gap:6px"><span class="sw pro"></span>Pro</span><span class="row" style="gap:6px"><span class="sw perso"></span>Perso</span></div>`;
  const evs = S.agenda.filter((e) => e.date === U.agDay).sort((a, b) => (a.time || "99").localeCompare(b.time || "99"));
  html += `<div class="card"><b>${esc(longDate(U.agDay))}</b>` +
    (evs.length ? evs.map((e) => `<div class="ev"><span class="bar ${e.type}"></span><span class="grow"><b>${esc(e.time || "Journée")}</b> ${esc(e.title)}</span><button class="del" data-action="delEvent" data-id="${e.id}" aria-label="Supprimer">×</button></div>`).join("")
      : '<span class="soft">Aucun rendez-vous ni chantier.</span>') + `</div>`;
  html += `<div class="card"><span class="over">Ajouter</span>
      ${seg([["pro", "Pro"], ["perso", "Perso"]], U.agType, "agType", true)}
      <div class="row"><label class="sr" for="agTitle">Titre</label><input class="input grow" id="agTitle" placeholder="Titre">${micBtn("agTitle")}</div>
      <div class="row"><label class="sr" for="agDate">Date</label><input class="input grow" id="agDate" type="date" value="${U.agDay}">
      <label class="sr" for="agTime">Heure</label><input class="input" style="width:120px" id="agTime" type="time"></div>
      <button class="btn primary" data-action="addEvent">Ajouter</button></div>`;
  html += `<span class="muted">Pour ajouter à la voix, dis-le à Claude avec le bouton Parler.</span>`;
  return html;
}

/* ---------- Météo ---------- */
function vMeteo() {
  const t = todayStr(), tm = addDays(t, 1);
  const date = U.meteoDay === "today" ? t : tm;
  const plan = S.plans[date];
  let html = head("Météo & nacelle") + seg([["today", "Aujourd'hui"], ["tomorrow", "Demain"]], U.meteoDay, "meteoDay");
  if (!plan || !plan.lieux || !plan.lieux.length) {
    html += `<div class="card"><b>Aucun lieu de chantier</b><span class="soft">La météo suit les lieux notés au débrief du soir, ou le lieu donné le matin. Jamais ta position actuelle.</span></div>`;
    return html;
  }
  loadWxFor(plan.lieux);
  if (U.meteoIdx >= plan.lieux.length) U.meteoIdx = 0;
  if (plan.lieux.length > 1) html += seg(plan.lieux.map((l, i) => [String(i), l.name]), String(U.meteoIdx), "meteoIdx");
  const l = plan.lieux[U.meteoIdx];
  const s = wxSummary(l, date);
  html += `<div class="row">${I.pin("#2ED063", 18)}<span class="soft">${esc(l.name)} · ${esc(l.label)}</span></div>`;
  if (s.loading) return html + '<div class="card"><span class="loading"></span></div>';
  if (s.error) return html + `<div class="card red">${esc(s.error)}</div>`;
  const lim = parseFloat(String(S.settings.nacelleLimit).replace(",", "."));
  html += `<div class="card"><span class="over">Décision nacelle</span><span class="decision ${s.decision.cls}" style="font-size:20px">${esc(s.decision.text)}</span>
    <span class="muted">${lim ? "Limite : " + lim + " km/h" + (S.settings.nacelleModel ? " (" + esc(S.settings.nacelleModel) + ")" : "") : "Renseigne le modèle et la limite de vent de ta nacelle dans les réglages."}</span></div>`;
  const hrs = s.hours.filter((h) => h.hr >= 6 && h.hr <= 19);
  const maxG = Math.max(lim || 0, ...hrs.map((h) => h.gust || 0), 10);
  const scale = 120 / maxG;
  html += `<div class="card"><div class="row" style="justify-content:space-between"><b>Rafales heure par heure</b><span class="muted">km/h</span></div>
    <div class="chart">${lim ? `<div class="limit" style="bottom:${Math.round(lim * scale)}px"></div>` : ""}
    ${hrs.map((h) => `<div class="col"><span class="val">${h.gust != null ? Math.round(h.gust) : "—"}</span><div class="bar ${lim && h.gust > lim ? "over" : ""}" style="height:${Math.round((h.gust || 0) * scale)}px"></div></div>`).join("")}</div>
    <div class="hours">${hrs.map((h) => `<span>${h.hr}h</span>`).join("")}</div></div>
    <div class="card"><table class="wx"><thead><tr><th>Heure</th><th>Temp.</th><th>Pluie</th><th>Vent</th><th>Rafales</th></tr></thead><tbody>
    ${hrs.map((h) => `<tr><td>${h.hr}h</td><td>${h.temp != null ? Math.round(h.temp) + "°" : "—"}</td><td>${h.rain != null ? h.rain + " mm" : "—"}</td><td>${h.wind != null ? Math.round(h.wind) : "—"}</td><td class="${lim && h.gust > lim ? "over" : ""}">${h.gust != null ? Math.round(h.gust) : "—"}</td></tr>`).join("")}
    </tbody></table></div>
    <span class="muted">Source : Météo-France (modèles AROME/ARPEGE) via Open-Meteo. Vérifie aussi la notice de ta nacelle.</span>`;
  return html;
}

/* ---------- Mails ---------- */
function vMails() {
  const m = loadMails();
  let html = head("Mails");
  html += `<div class="card"><span class="soft" style="font-size:14px">
    Compte : <b>${esc(m ? m.account : "non connecté")}</b><br>
    Dernière récupération : <b>${m ? esc(fmtDateTime(m.fetchedAt)) : "jamais"}</b><br>
    Effacement et nouvelle récupération : <b>${m ? esc(fmtDateTime(m.fetchedAt + MAIL_WINDOW_MS)) : "—"}</b></span></div>`;
  if (!googleClientId()) {
    html += `<div class="card"><b>Gmail pas encore branché</b><span class="muted">Ajoute l'ID client Google dans les réglages.</span><button class="btn ghost" data-action="go" data-to="reglages">Ouvrir les réglages</button></div>`;
    return html;
  }
  if (!m) html += busyBtn("mail", "Se connecter et récupérer les 20 derniers", "getMails");
  else {
    html += `<span class="muted">Claude résume ces mails dans le brief du matin. Ils sont envoyés sur le Drive à chaque synchro.</span>
      <button class="btn ghost" data-action="clearMails">Tout effacer</button>`;
    html += m.mails.map((x) => `<button class="mail" data-action="toggleMail">
      <b>${esc(x.from || "(expéditeur inconnu)")}</b><span class="muted">${x.date ? esc(fmtDateTime(x.date)) : ""}</span>
      <span>${esc(x.subject || "(sans objet)")}</span><span class="soft" style="font-size:14px">${esc(x.snippet)}</span>
      <span class="b">${esc(x.body || "(pas de texte lisible)")}</span></button>`).join("");
  }
  return html;
}

/* ---------- Base & journal ---------- */
const BASE_SECTIONS = [
  ["arbre", "Arbre d'incidents", "Fiches par famille, ordres par défaut"],
  ["croisement", "Règles de croisement", "Plusieurs incidents en même temps"],
  ["habitudes", "Habitudes d'équipe", "Habilitations, binômes, responsable"],
  ["connaissances", "Base de connaissances", "Normes, contacts, fournisseurs, nacelles"],
  ["infos", "Infos à compléter", "Ce qu'il manque encore"]
];
function vBase() {
  const q = (U.baseQ || "").toLowerCase();
  const tm = addDays(todayStr(), 1);
  const p = S.plans[tm];
  let html = head("Base & journal") + `<label class="sr" for="baseSearch">Rechercher</label>
    <input class="input" id="baseSearch" placeholder="Chercher une fiche, un contact, une norme…" value="${esc(U.baseQ || "")}" data-input="baseSearch">`;
  BASE_SECTIONS.forEach(([k, title, sub]) => {
    const txt = S.base.sections[k] || "";
    if (q && !txt.toLowerCase().includes(q) && !title.toLowerCase().includes(q)) return;
    html += `<details class="sec" ${q ? "open" : ""}><summary><span><b>${esc(title)}</b><br><span class="muted">${txt.trim() ? txt.trim().split("\n").length + " ligne(s)" : "Vide"} · ${esc(sub)}</span></span>${I.back("#A3ABB8")}</summary>
      <div><label class="sr" for="sec-${k}">${esc(title)}</label><textarea class="input" id="sec-${k}" style="min-height:200px">${esc(txt)}</textarea>
      <button class="btn primary" data-action="saveSection" data-k="${k}">Enregistrer</button></div></details>`;
  });
  if (!q) {
    html += `<details class="sec"><summary><span><b>Prévu pour demain</b><br><span class="muted">${p ? esc(p.lieux.map((l) => l.name).join(", ") || "lieu non précisé") + " · " + esc(sitLabel(p.situation)) : "Vide"}</span></span>${I.back("#A3ABB8")}</summary>
      <div>${p ? `<span>Effectif : ${esc(p.effectif || "—")}</span><span>Horaires : ${esc(p.horaires || "—")}</span><span>Points sensibles : ${esc(p.sensibles || "—")}</span>` : '<span class="soft">Rempli au débrief du soir.</span>'}</div></details>`;
    html += `<details class="sec"><summary><span><b>Journal de retour d'expérience</b><br><span class="muted">${S.base.journal.length ? S.base.journal.length + " entrée(s)" : "Vide"}</span></span>${I.back("#A3ABB8")}</summary>
      <div>${S.base.journal.slice().reverse().map((j) => `<span><span class="muted">${esc(new Date(j.at).toLocaleDateString("fr-FR"))}</span> ${esc(j.text)}</span>`).join("") || '<span class="soft">Chaque débrief et chaque fin d\'incident s\'y ajoute, daté.</span>'}
      <div class="row"><label class="sr" for="journalAdd">Ajouter une entrée</label><input class="input grow" id="journalAdd" placeholder="Ajouter une entrée">${micBtn("journalAdd")}</div>
      <button class="btn ghost" data-action="addJournal">Ajouter au journal</button></div></details>`;
    html += `<details class="sec"><summary><span><b>Suivi de révision</b><br><span class="muted">${REV_TABS.map(([k, l]) => l + " " + S.revision[k].sessions.length).join(" · ")}</span></span>${I.back("#A3ABB8")}</summary>
      <div>${REV_TABS.map(([k, l]) => { const ss = S.revision[k].sessions.slice(-5).reverse(); return `<b>${esc(l)}</b>` + (ss.length ? ss.map((s) => `<span class="soft" style="font-size:14px">${esc(shortDate(s.date))} · ${esc(s.domain)} · ${s.ok}/${s.ok + s.ko}${s.aRevoir && s.aRevoir.length ? " · à revoir : " + esc(s.aRevoir.join(" ; ")) : ""}</span>`).join("") : '<span class="muted">Aucune session.</span>'); }).join("")}</div></details>`;
  }
  return html;
}

/* ---------- Parler à Claude ---------- */
const CLAUDE_PHRASES = [
  ["Brief", "Fais-moi le brief du jour."],
  ["Débrief", "On fait le débrief du soir."],
  ["Incident", "INCIDENT EN COURS : "],
  ["Révision", "On révise 10 minutes."],
  ["Élocution", "Donne-moi un exercice d'élocution et note-moi."],
  ["Agenda", "Ajoute à mon agenda : "],
  ["Commande", "Ajoute à la liste à commander : "],
  ["Compte rendu", "Aide-moi à faire le compte rendu de ma journée pour mon responsable."]
];

function vParler() {
  return head("Parler à Claude") + `
    <div class="card"><b>Claude répond dans l'appli Claude</b>
      <span class="soft">Le bouton ouvre ton projet « Assistant de chef d'équipe ». Touche l'icône vocale pour parler. Quand tu as fini, reviens ici et synchronise : ce que Claude a noté apparaît (agenda, ordres, commandes, débrief, notes).</span></div>
    <button class="btn primary big" data-action="claudeAsk" data-text="">${I.mic("currentColor", 26)} Ouvrir Claude</button>
    <span class="over">Ou commence par une phrase toute faite (elle est copiée)</span>
    <div class="grid2">${CLAUDE_PHRASES.map(([l, txt]) => `<button class="btn ghost" style="min-height:52px" data-action="claudeAsk" data-text="${esc(txt)}">${esc(l)}</button>`).join("")}</div>
    ${syncLine()}
    <span class="muted">La conversation reste dans l'historique Claude du compte partagé avec Benjamin.</span>`;
}

/* ---------- Matériel & outillage ---------- */
const CAT_LABEL = { outil: "Outillage", materiel: "Matériel & consommables" };
const STATES = [["ok", "OK"], ["remplacer", "À remplacer"], ["manquant", "Manquant"]];
const stateLabel = (k) => (STATES.find((s) => s[0] === k) || STATES[0])[1];
const num = (v) => { const n = parseFloat(String(v == null ? "" : v).replace(",", ".")); return isFinite(n) ? n : 0; };

function daysSince(str) { return Math.floor((parseDate(todayStr()) - parseDate(str)) / 86400000); }
function invDue() { const st = S.stock; return !st.lastInventory || daysSince(st.lastInventory) >= (st.invEvery || 15); }

/* Ce qu'il faut commander : stock sous le minimum, outils à remplacer ou manquants, et ajouts manuels */
function needList() {
  const out = [];
  S.stock.items.forEach((it) => {
    if (it.ordered) return;
    if (it.cat === "materiel" && num(it.min) > 0 && num(it.qty) <= num(it.min)) {
      out.push({ key: "i:" + it.id, itemId: it.id, cat: it.cat, name: it.name, detail: "reste " + num(it.qty) + (it.unit ? " " + it.unit : "") + ", mini " + num(it.min), suggest: Math.max(num(it.min) * 2 - num(it.qty), 1) });
    } else if (it.cat === "outil" && it.state && it.state !== "ok") {
      out.push({ key: "i:" + it.id, itemId: it.id, cat: it.cat, name: it.name, detail: stateLabel(it.state).toLowerCase(), suggest: 1 });
    }
  });
  S.stock.orders.filter((o) => o.status === "a_commander").forEach((o) => {
    out.push({ key: "o:" + o.id, orderId: o.id, itemId: o.itemId, cat: o.cat, name: o.name, detail: [o.qty ? "qté " + o.qty : "", o.source ? "noté " + o.source : ""].filter(Boolean).join(" · "), manual: true });
  });
  return out;
}
function findItem(name) { const n = name.trim().toLowerCase(); return S.stock.items.find((i) => i.name.trim().toLowerCase() === n); }

function vStock() {
  const tabs = [["commander", "Commander"], ["outil", "Outillage"], ["materiel", "Matériel"], ["inventaire", "Inventaire"]];
  let html = head("Matériel & outillage") + seg(tabs, U.stockTab, "stockTab");
  const tab = U.stockTab;

  if (tab === "commander") {
    const need = needList();
    const pending = S.stock.orders.filter((o) => o.status === "commande");
    if (!need.length) html += `<div class="card"><b>Rien à commander aujourd'hui</b><span class="soft">La liste se remplit toute seule : matériel sous le minimum, outil à remplacer ou manquant, et ce que tu notes au débrief.</span></div>`;
    ["outil", "materiel"].forEach((cat) => {
      const rows = need.filter((n) => n.cat === cat);
      if (!rows.length) return;
      html += `<div class="card"><span class="over">${esc(CAT_LABEL[cat])} · à commander</span>` + rows.map((n) => `
        <div class="item"><span class="grow"><b>${esc(n.name)}</b>${n.detail ? `<br><span class="muted">${esc(n.detail)}</span>` : ""}</span>
          <button class="btn ghost" style="min-height:44px;padding:0 12px" data-action="markOrdered" data-key="${esc(n.key)}">Commandé</button>
          ${n.manual ? `<button class="del" data-action="delOrderLine" data-id="${n.orderId}" aria-label="Retirer">×</button>` : ""}</div>`).join("") + `</div>`;
    });
    if (pending.length) {
      html += `<div class="card"><span class="over">Commandé, en attente</span>` + pending.map((o) => `
        <div class="item"><span class="grow"><b>${esc(o.name)}</b><br><span class="muted">${esc(CAT_LABEL[o.cat])}${o.qty ? " · qté " + esc(o.qty) : ""}${o.orderedAt ? " · le " + esc(shortDate(o.orderedAt)) : ""}</span></span>
          <button class="btn primary" style="min-height:44px;padding:0 12px" data-action="markReceived" data-id="${o.id}">Reçu</button></div>`).join("") + `</div>`;
    }
    html += `<div class="card"><span class="over">Ajouter à la liste</span>
      ${seg([["outil", "Outillage"], ["materiel", "Matériel"]], U.newOrderCat || "materiel", "newOrderCat", true)}
      <div class="row"><label class="sr" for="ordName">Article</label><input class="input grow" id="ordName" placeholder="Article">${micBtn("ordName")}</div>
      <div class="row"><label class="sr" for="ordQty">Quantité</label><input class="input grow" id="ordQty" placeholder="Quantité (facultatif)"></div>
      <button class="btn primary" data-action="addOrderLine">Ajouter</button></div>`;
    return html;
  }

  if (tab === "inventaire") return html + vInventaire();

  // Onglets Outillage / Matériel
  const items = S.stock.items.filter((i) => i.cat === tab).sort((a, b) => a.name.localeCompare(b.name, "fr"));
  if (!items.length) html += `<div class="card"><b>${tab === "outil" ? "Aucun outil" : "Aucun matériel"} pour l'instant</b><span class="soft">${tab === "outil" ? "Ajoute tes outils et leur état. Un outil « à remplacer » ou « manquant » passe tout seul dans la liste à commander." : "Ajoute tes articles avec un stock minimum. Dès que le stock descend au minimum, l'article passe dans la liste à commander."}</span></div>`;
  else html += `<div class="card">` + items.map((it) => {
    const low = tab === "materiel" ? num(it.min) > 0 && num(it.qty) <= num(it.min) : it.state !== "ok";
    return `<div class="item">
      <span class="grow"><b style="${low ? "color:#E08A1E" : ""}">${esc(it.name)}</b><br><span class="muted">${tab === "materiel" ? "Stock " + num(it.qty) + (it.unit ? " " + esc(it.unit) : "") + " · mini " + num(it.min) : "Qté " + num(it.qty)}${it.ordered ? " · commandé" : ""}</span></span>
      ${tab === "materiel"
        ? `<button class="iconbtn" style="background:#2C4166;font-size:20px" data-action="qty" data-id="${it.id}" data-n="-1" aria-label="Retirer un">−</button><button class="iconbtn" style="background:#2C4166;font-size:20px" data-action="qty" data-id="${it.id}" data-n="1" aria-label="Ajouter un">+</button>`
        : `<button class="btn ${it.state === "ok" ? "ghost" : "danger"}" style="min-height:44px;padding:0 10px;font-size:14px" data-action="cycleState" data-id="${it.id}">${esc(stateLabel(it.state))}</button>`}
      <button class="del" data-action="delItem" data-id="${it.id}" aria-label="Supprimer">×</button></div>`;
  }).join("") + `</div>`;
  html += `<div class="card"><span class="over">Ajouter ${tab === "outil" ? "un outil" : "un article"}</span>
    <div class="row"><label class="sr" for="itName">Nom</label><input class="input grow" id="itName" placeholder="${tab === "outil" ? "Ex. perforateur, VAT, pince à dénuder" : "Ex. gaine ICTA 20, chevilles, wago"}">${micBtn("itName")}</div>
    <div class="row">
      <label class="sr" for="itQty">Quantité</label><input class="input grow" id="itQty" inputmode="decimal" placeholder="Quantité">
      ${tab === "materiel"
        ? `<label class="sr" for="itMin">Minimum</label><input class="input grow" id="itMin" inputmode="decimal" placeholder="Minimum">
           <label class="sr" for="itUnit">Unité</label><input class="input" style="width:90px" id="itUnit" placeholder="Unité">`
        : ""}
    </div>
    <button class="btn primary" data-action="addItem" data-cat="${tab}">Ajouter</button></div>`;
  return html;
}

function vInventaire() {
  const st = S.stock;
  let html = `<div class="card"><b>${st.lastInventory ? "Dernier inventaire : " + esc(longDate(st.lastInventory)) : "Aucun inventaire fait"}</b>
    <span class="soft">Rappel tous les ${st.invEvery} jours sur l'accueil, dans le brief et dans l'agenda.${st.lastInventory ? " Prochain : " + esc(longDate(addDays(st.lastInventory, st.invEvery))) + "." : ""}</span></div>`;
  if (!st.items.length) return html + `<div class="card"><span class="soft">Ajoute d'abord tes outils et ton matériel dans les onglets Outillage et Matériel.</span></div>`;
  if (!U.inv) return html + `<button class="btn primary big" data-action="startInv">Commencer l'inventaire</button>`;
  ["outil", "materiel"].forEach((cat) => {
    const items = st.items.filter((i) => i.cat === cat).sort((a, b) => a.name.localeCompare(b.name, "fr"));
    if (!items.length) return;
    html += `<div class="card"><span class="over">${esc(CAT_LABEL[cat])}</span>` + items.map((it) => `
      <div class="item"><label class="grow" for="inv-${it.id}"><b>${esc(it.name)}</b>${cat === "materiel" ? `<br><span class="muted">mini ${num(it.min)}${it.unit ? " " + esc(it.unit) : ""}</span>` : ""}</label>
        <input class="input" style="width:84px;min-height:44px" id="inv-${it.id}" inputmode="decimal" value="${num(it.qty)}" aria-label="Quantité ${esc(it.name)}">
        ${cat === "outil" ? `<select class="input" style="width:130px;min-height:44px;padding:8px" id="invs-${it.id}" aria-label="État ${esc(it.name)}">${STATES.map(([k, l]) => `<option value="${k}" ${it.state === k ? "selected" : ""}>${l}</option>`).join("")}</select>` : ""}
      </div>`).join("") + `</div>`;
  });
  html += `<div class="row"><button class="btn ghost grow" data-action="cancelInv">Annuler</button><button class="btn primary grow" data-action="finishInv">Valider l'inventaire</button></div>`;
  return html;
}

/* Rendez-vous « Inventaire » dans l'agenda, recalé après chaque inventaire */
function planInventoryEvent() {
  const st = S.stock;
  S.agenda = S.agenda.filter((e) => e.auto !== "inv");
  const date = st.lastInventory ? addDays(st.lastInventory, st.invEvery) : todayStr();
  S.agenda.push({ id: uid(), date, time: "", title: "Inventaire matériel et outillage", type: "pro", auto: "inv" });
}

/* ---------- Réglages ---------- */
function vReglages() {
  const st = S.settings;
  return head("Réglages") + `
  <div class="card"><span class="over">Google (Gmail et Drive)</span>
    <label class="lbl" for="setGoogle">ID client OAuth</label>
    <input class="input" id="setGoogle" autocomplete="off" placeholder="….apps.googleusercontent.com" value="${esc(googleClientId())}">
    <span class="muted">Connecte-toi avec le compte Google EG.PACA (propriétaire du dossier « Appli Thomas »).</span></div>
  <div class="card"><span class="over">Claude</span>
    <label class="lbl" for="setProject">Lien du projet Claude</label>
    <input class="input" id="setProject" autocomplete="off" value="${esc(st.projectUrl || PROJECT_URL_DEFAULT)}">
    <label class="lbl" for="setBriefTime">Heure du brief préparé par Claude (affichage)</label>
    <input class="input" id="setBriefTime" value="${esc(st.briefTime || "5h45")}">
    <details class="sec" style="background:#172E3E"><summary><span class="muted">Dossiers Drive (avancé)</span></summary><div>
      <label class="lbl" for="setRoot">ID du dossier Appli Thomas</label>
      <input class="input" id="setRoot" autocomplete="off" value="${esc(st.rootFolderId || ROOT_FOLDER_DEFAULT)}">
      <label class="lbl" for="setBox">ID du dossier boite-claude</label>
      <input class="input" id="setBox" autocomplete="off" value="${esc(st.boxFolderId || BOX_FOLDER_DEFAULT)}">
    </div></details></div>
  <div class="card"><span class="over">Nacelle et urgences</span>
    <label class="lbl" for="setNacModel">Modèle de nacelle</label>
    <input class="input" id="setNacModel" placeholder="Marque et modèle" value="${esc(st.nacelleModel)}">
    <label class="lbl" for="setNacLim">Vent maximal autorisé (km/h, voir la notice)</label>
    <input class="input" id="setNacLim" inputmode="decimal" placeholder="Valeur de la notice" value="${esc(st.nacelleLimit)}">
    <label class="lbl" for="setUrg">Numéro d'urgence exploitant</label>
    <input class="input" id="setUrg" inputmode="tel" placeholder="Numéro" value="${esc(st.urgenceExploitant)}">
    <label class="lbl" for="setInv">Rappel d'inventaire tous les (jours)</label>
    <input class="input" id="setInv" inputmode="numeric" value="${esc(S.stock.invEvery)}"></div>
  <button class="btn primary" data-action="saveSettings">Enregistrer les réglages</button>
  <div class="card"><span class="over">Synchronisation et sauvegarde</span>
    ${syncLine()}
    <span class="muted">Tes données sont copiées dans « etat-appli.json » sur le Drive à chaque synchro : c'est aussi ta sauvegarde. Sur un nouveau téléphone, il suffit de synchroniser pour tout récupérer.</span>
    <button class="btn ghost" data-action="exportFile">Télécharger une sauvegarde</button>
    <label class="btn ghost" for="importFile" style="cursor:pointer">Restaurer une sauvegarde</label>
    <input type="file" id="importFile" accept="application/json,.json" class="sr" data-change="importFile"></div>
  <button class="btn dashed" data-action="resetAll">Tout effacer sur ce téléphone</button>
  <span class="muted">Version 2 · sans API</span>`;
}

/* ---------------------------------------------------------------------
   10. Actions
   --------------------------------------------------------------------- */
const A = {
  go: (d) => { location.hash = "#" + d.to; },
  dictate: (d, el) => dictate(d.target, el),

  async geoSearch(d) {
    const ctx = d.ctx, q = val("place-" + ctx);
    if (!q) { toast("Écris ou dicte le nom de la commune."); return; }
    const g = U.geo[ctx];
    g.loading = true; rerender();
    try {
      g.results = await geocode(q);
      if (!g.results.length) toast("Commune introuvable, vérifie l'orthographe.", true);
    } catch (e) { toast(e.message, true); }
    g.loading = false; rerender();
  },
  geoPick: (d) => { const g = U.geo[d.ctx]; g.lieux.push(g.results[+d.i]); g.results = []; clearInput("place-" + d.ctx); rerender(); },
  geoRemove: (d) => { U.geo[d.ctx].lieux.splice(+d.i, 1); rerender(); },
  pickSit: (d) => { U.geo[d.ctx].sit = d.val; rerender(); },
  setupValidate() {
    const g = U.geo.setup;
    if (!g.lieux.length) { toast("Ajoute au moins une commune."); return; }
    S.plans[todayStr()] = Object.assign({}, S.plans[todayStr()] || {}, { lieux: g.lieux, situation: g.sit });
    save();
    U.geo.setup = null;
    rerender();
  },
  openMeteo: (d) => { U.meteoIdx = +d.i; U.meteoDay = "today"; location.hash = "#meteo"; },

  speak(d) {
    if (!("speechSynthesis" in window)) { toast("Lecture à voix haute non disponible.", true); return; }
    speechSynthesis.cancel();
    const b = S.briefs[todayStr()];
    if (!b) return;
    const u = new SpeechSynthesisUtterance(b.text);
    u.lang = "fr-FR";
    speechSynthesis.speak(u);
  },

  addOrder() {
    const raw = val("orderText");
    if (!raw) return;
    const m = raw.match(/^([^:]{1,40}):\s*(.+)$/);
    const t = todayStr();
    (S.orders[t] = S.orders[t] || []).push({ id: uid(), who: m ? m[1].trim() : "", text: m ? m[2].trim() : raw, done: false });
    clearInput("orderText");
    save(); rerender();
    const el = document.getElementById("orderText"); if (el) el.focus();
  },
  toggleOrder(d) { const o = (S.orders[todayStr()] || []).find((x) => x.id === d.id); if (o) { o.done = !o.done; save(); rerender(); } },
  delOrder(d) { if (!confirm("Supprimer cet ordre ?")) return; S.orders[todayStr()] = (S.orders[todayStr()] || []).filter((x) => x.id !== d.id); save(); rerender(); },

  incSend() { const t = val("incText"); openClaude("INCIDENT EN COURS : " + (t || "")); },

  startDebrief() { U.deb = { step: 0, answers: [] }; U.geo.tomorrow = null; rerender(); },
  debNext() { U.deb.answers.push({ q: DEBRIEF_Q[U.deb.step], a: val("debAnswer") }); U.deb.step++; clearInput("debAnswer"); rerender(); },
  debSkip() { U.deb.answers.push({ q: DEBRIEF_Q[U.deb.step], a: "" }); U.deb.step++; clearInput("debAnswer"); rerender(); },
  debFinish,

  revTab: (d) => { U.revTab = d.val; rerender(); },
  startRevision,
  revPick: (d) => revPick(+d.k),
  revNext() { const r = U.rev; if (r.i + 1 < r.qs.length) { r.i++; r.picked = null; } else r.phase = "end"; rerender(); },
  revShowSit() { U.rev.showSit = true; const keep = val("sitAnswer"); rerender(); const el = document.getElementById("sitAnswer"); if (el) el.value = keep; },
  revFinish,

  eloTab: (d) => { U.eloTab = d.val; rerender(); },
  eloGo() {
    const E = S.elocution, ex = (E.next || {})[U.eloTab];
    const desc = ELO_DESC[U.eloTab];
    openClaude("Exercice d'élocution (" + desc + "), niveau " + E.level + "/5. " + (ex ? "Consigne : " + ex.consigne + (ex.contexte ? " Contexte : " + ex.contexte : "") : "Donne-moi un exercice adapté à mon niveau.") + " Écoute ma réponse, note-moi sur 10 et dépose la note dans l'appli.");
  },

  agWeek: (d) => { U.agWeekStart = addDays(U.agWeekStart, +d.n); U.agDay = U.agWeekStart; rerender(); },
  agDay: (d) => { U.agDay = d.d; rerender(); },
  agType: (d) => { U.agType = d.val; rerender(); },
  addEvent() {
    const title = val("agTitle"), date = val("agDate");
    if (!title || !date) { toast("Titre et date obligatoires."); return; }
    S.agenda.push({ id: uid(), date, time: val("agTime"), title, type: U.agType });
    clearInput("agTitle", "agTime");
    save(); U.agDay = date; U.agWeekStart = mondayOf(date); rerender();
  },
  delEvent(d) { if (!confirm("Supprimer ce rendez-vous ?")) return; S.agenda = S.agenda.filter((e) => e.id !== d.id); save(); rerender(); },

  claudeAsk: (d) => openClaude(d.text || ""),
  sync: () => syncNow(true),

  openStock: (d) => { U.stockTab = d.tab; location.hash = "#stock"; },
  stockTab: (d) => { U.stockTab = d.val; rerender(); },
  newOrderCat: (d) => { U.newOrderCat = d.val; rerender(); },
  addOrderLine() {
    const name = val("ordName");
    if (!name) { toast("Écris ou dicte l'article."); return; }
    const cat = U.newOrderCat || "materiel";
    const it = findItem(name);
    S.stock.orders.push({ id: uid(), cat, name, qty: val("ordQty"), itemId: it ? it.id : "", status: "a_commander", createdAt: todayStr(), source: "" });
    clearInput("ordName", "ordQty");
    save(); rerender();
  },
  delOrderLine(d) { S.stock.orders = S.stock.orders.filter((o) => o.id !== d.id); save(); rerender(); },
  markOrdered(d) {
    const n = needList().find((x) => x.key === d.key);
    if (!n) return;
    if (n.orderId) {
      const o = S.stock.orders.find((x) => x.id === n.orderId);
      o.status = "commande"; o.orderedAt = todayStr();
    } else {
      S.stock.orders.push({ id: uid(), cat: n.cat, name: n.name, qty: String(n.suggest || ""), itemId: n.itemId, status: "commande", createdAt: todayStr(), orderedAt: todayStr(), source: "" });
    }
    const it = S.stock.items.find((i) => i.id === n.itemId);
    if (it) it.ordered = true;
    save(); rerender();
  },
  markReceived(d) {
    const o = S.stock.orders.find((x) => x.id === d.id);
    if (!o) return;
    const it = S.stock.items.find((i) => i.id === o.itemId);
    if (it) {
      it.ordered = false;
      if (it.cat === "materiel") it.qty = num(it.qty) + num(o.qty);
      else { it.state = "ok"; if (!num(it.qty)) it.qty = 1; }
    }
    S.stock.orders = S.stock.orders.filter((x) => x.id !== o.id);
    save(); toast(it ? "Reçu : stock mis à jour." : "Reçu."); rerender();
  },
  addItem(d) {
    const name = val("itName");
    if (!name) { toast("Écris ou dicte le nom."); return; }
    if (findItem(name)) { toast("« " + name + " » existe déjà.", true); return; }
    const cat = d.cat;
    S.stock.items.push({ id: uid(), cat, name, qty: num(val("itQty")) || (cat === "outil" ? 1 : 0), min: cat === "materiel" ? num(val("itMin")) : 0, unit: cat === "materiel" ? val("itUnit") : "", state: "ok", ordered: false });
    if (!S.agenda.some((e) => e.auto === "inv")) planInventoryEvent();
    clearInput("itName", "itQty", "itMin", "itUnit");
    save(); rerender();
  },
  qty(d) { const it = S.stock.items.find((i) => i.id === d.id); if (!it) return; it.qty = Math.max(0, num(it.qty) + num(d.n)); save(); rerender(); },
  cycleState(d) {
    const it = S.stock.items.find((i) => i.id === d.id);
    if (!it) return;
    const k = STATES.map((s) => s[0]);
    it.state = k[(k.indexOf(it.state) + 1) % k.length];
    if (it.state === "ok") it.ordered = false;
    save(); rerender();
  },
  delItem(d) { if (!confirm("Supprimer cet article de l'inventaire ?")) return; S.stock.items = S.stock.items.filter((i) => i.id !== d.id); save(); rerender(); },
  startInv() { U.inv = true; rerender(); },
  cancelInv() { U.inv = false; rerender(); },
  finishInv() {
    S.stock.items.forEach((it) => {
      const q = document.getElementById("inv-" + it.id);
      if (q) it.qty = Math.max(0, num(q.value));
      const s = document.getElementById("invs-" + it.id);
      if (s) { it.state = s.value; if (it.state === "ok") it.ordered = false; }
    });
    S.stock.lastInventory = todayStr();
    planInventoryEvent();
    const n = needList().length;
    S.base.journal.push({ at: Date.now(), text: "Inventaire fait : " + S.stock.items.length + " article(s), " + n + " à commander." });
    U.inv = false; U.stockTab = "commander";
    save(); toast("Inventaire validé. Prochain dans " + S.stock.invEvery + " jours."); rerender();
  },

  meteoDay: (d) => { U.meteoDay = d.val; U.meteoIdx = 0; rerender(); },
  meteoIdx: (d) => { U.meteoIdx = +d.val; rerender(); },

  async getMails() {
    let token;
    try { token = await googleToken(); } catch (e) { toast(e.message, true); return; }
    U.busy.mail = true; rerender();
    try { await fetchMails(token); scheduleSync(); } catch (e) { toast(e.message, true); }
    U.busy.mail = false; rerender();
  },
  clearMails() { if (!confirm("Effacer les mails stockés sur ce téléphone ?")) return; localStorage.removeItem(MAIL_KEY); rerender(); },
  toggleMail: (d, el) => el.classList.toggle("open"),

  saveSection(d) { S.base.sections[d.k] = document.getElementById("sec-" + d.k).value; save(); toast("Enregistré."); },
  addJournal() { const t = val("journalAdd"); if (!t) return; S.base.journal.push({ at: Date.now(), text: t }); clearInput("journalAdd"); save(); rerender(); },

  saveSettings() {
    const st = S.settings;
    st.projectUrl = val("setProject");
    st.briefTime = val("setBriefTime") || "5h45";
    if (val("setRoot") && val("setRoot") !== st.rootFolderId) { st.rootFolderId = val("setRoot"); st.driveFileId = ""; }
    st.boxFolderId = val("setBox");
    st.googleClientId = val("setGoogle");
    st.nacelleModel = val("setNacModel");
    st.nacelleLimit = val("setNacLim");
    st.urgenceExploitant = val("setUrg");
    const ev = Math.round(num(val("setInv")));
    if (ev >= 1 && ev !== S.stock.invEvery) { S.stock.invEvery = ev; if (S.stock.lastInventory) planInventoryEvent(); }
    gToken = null;
    save(); toast("Réglages enregistrés.");
  },
  exportFile() {
    const blob = new Blob([JSON.stringify(exportData(), null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "appli-thomas-sauvegarde-" + todayStr() + ".json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  },
  importText() {
    const k = prompt("Dans quelle section ? Tape : arbre, croisement, habitudes, connaissances ou infos");
    if (!k || !(k.trim() in S.base.sections)) { if (k) toast("Section inconnue.", true); return; }
    const txt = prompt("Colle le texte à ajouter à la fin de cette section :");
    if (!txt) return;
    const key = k.trim();
    S.base.sections[key] = (S.base.sections[key] ? S.base.sections[key].trimEnd() + "\n\n" : "") + txt;
    S.base.journal.push({ at: Date.now(), text: "Import de texte dans « " + key + " »." });
    save(); toast("Ajouté à la base.");
  },
  resetAll() {
    if (!confirm("Tout effacer sur ce téléphone ? Fais d'abord une sauvegarde.")) return;
    if (!confirm("Vraiment tout effacer ? C'est définitif.")) return;
    localStorage.removeItem(STORE_KEY); localStorage.removeItem(MAIL_KEY);
    S = defaults(); location.hash = "#home"; rerender();
  }
};

/* Changements de champs */
const CH = {
  baseSearch(el) { U.baseQ = el.value; const pos = el.selectionStart; rerender(); const n = document.getElementById("baseSearch"); if (n) { n.focus(); n.setSelectionRange(pos, pos); } },
  importFile(el) {
    const f = el.files && el.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const j = JSON.parse(r.result);
        if (j.app !== "egpaca-chef-equipe" || !j.data) throw new Error("Ce fichier n'est pas une sauvegarde de l'appli.");
        if (!confirm("Remplacer les données de ce téléphone par cette sauvegarde ? (tes réglages sont gardés)")) return;
        const mine = S.settings;
        S = merge(defaults(), j.data);
        S.settings = mine;
        save(); toast("Sauvegarde restaurée."); rerender();
      } catch (e) { toast(e.message, true); }
    };
    r.readAsText(f);
  }
};

/* ---------------------------------------------------------------------
   11. Routage et rendu
   --------------------------------------------------------------------- */
const ROUTES = {
  home: vHome, brief: vBrief, ordres: vOrdres, incident: vIncident, debrief: vDebrief, revision: vRevision,
  elocution: vElocution, agenda: vAgenda, stock: vStock, parler: vParler, meteo: vMeteo, mails: vMails, base: vBase, reglages: vReglages
};
const NAV = [["home", "Accueil", I.home], ["agenda", "Agenda", (c) => I.cal(c, 22)], ["parler", "Parler", (c) => I.mic(c, 22)], ["brief", "Brief", (c) => I.sun(c, 22)], ["meteo", "Météo", (c) => I.wind(c, 22)]];

function route() { const r = (location.hash || "").replace(/^#\/?/, ""); return ROUTES[r] ? r : "home"; }

function render() {
  const r = route();
  const changed = r !== U.lastRoute;
  // Garde ce qui est en cours de saisie quand l'écran se redessine
  const keep = {};
  if (!changed) document.querySelectorAll("#view input[id], #view textarea[id]").forEach((el) => { if (el.type !== "file" && el.value) keep[el.id] = el.value; });
  $("#view").innerHTML = ROUTES[r]();
  Object.keys(keep).forEach((id) => { const el = document.getElementById(id); if (el && !el.value) el.value = keep[id]; });
  $("#tabs").innerHTML = NAV.map(([k, l, ic]) => `<button class="${k === r ? "on" : ""}" data-action="go" data-to="${k}">${ic("currentColor")}${l}</button>`).join("");
  if (changed) { window.scrollTo(0, 0); U.lastRoute = r; if (recog) recog.stop(); }
}
function rerender() { render(); }

document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-action]");
  if (!el || el.disabled) return;
  const fn = A[el.dataset.action];
  if (fn) { e.preventDefault(); fn(el.dataset, el, e); }
});
document.addEventListener("input", (e) => { const k = e.target.dataset && e.target.dataset.input; if (k && CH[k]) CH[k](e.target); });
document.addEventListener("change", (e) => { const k = e.target.dataset && e.target.dataset.change; if (k && CH[k]) CH[k](e.target); });
document.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" || e.target.tagName !== "INPUT") return;
  const id = e.target.id;
  if (id === "orderText") A.addOrder();
  else if (id.startsWith("place-")) A.geoSearch({ ctx: id.slice(6) });
});
window.addEventListener("hashchange", render);

if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("sw.js").catch(() => { /* hors ligne non disponible */ });
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") syncNow(false); });
render();
