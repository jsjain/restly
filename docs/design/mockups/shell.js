// Shared mockup chrome. Works from file:// (no fetch, no external <use>).
// In a page:  <i data-i="search"></i>                          icon
//             <div data-sidebar='{"active":"List users"}'></div> sidebar
//             <div data-tabbar='{"tabs":[...]}'></div>           tab strip
//             <div data-statusbar='{}'></div>                    status bar
//             <body data-screen="01-request.html">               deck header + nav

const ICONS = {
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  "chevron-right": '<path d="m9 18 6-6-6-6"/>',
  "chevron-down": '<path d="m6 9 6 6 6-6"/>',
  "chevrons-up-down": '<path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/>',
  folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  layers: '<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>',
  settings: '<path d="M20 7h-9"/><path d="M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>',
  cookie: '<path d="M12 2a10 10 0 1 0 10 10 4 4 0 0 1-5-5 4 4 0 0 1-5-5"/><path d="M8.5 8.5v.01"/><path d="M16 15.5v.01"/><path d="M12 12v.01"/><path d="M11 17v.01"/><path d="M7 14v.01"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  "x-circle": '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
  "check-circle": '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  "minus-circle": '<circle cx="12" cy="12" r="10"/><path d="M8 12h8"/>',
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  stop: '<rect width="14" height="14" x="5" y="5" rx="2"/>',
  code: '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
  import: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
  export: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
  eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  "eye-off": '<path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.53 13.53 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/>',
  save: '<path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"/><path d="M7 3v4a1 1 0 0 0 1 1h7"/>',
  filter: '<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>',
  format: '<path d="M15 12H3"/><path d="M17 18H3"/><path d="M21 6H3"/>',
  sidebar: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/>',
  terminal: '<polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/>',
  zap: '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
  keyboard: '<path d="M10 8h.01"/><path d="M12 12h.01"/><path d="M14 8h.01"/><path d="M16 12h.01"/><path d="M18 8h.01"/><path d="M6 8h.01"/><path d="M7 16h10"/><path d="M8 12h.01"/><rect width="20" height="16" x="2" y="4" rx="2"/>',
  plug: '<path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/>',
  "arrow-up": '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
  "arrow-down": '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>',
  lock: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
  palette: '<circle cx="13.5" cy="6.5" r=".5"/><circle cx="17.5" cy="10.5" r=".5"/><circle cx="8.5" cy="7.5" r=".5"/><circle cx="6.5" cy="12.5" r=".5"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  enter: '<polyline points="9 10 4 15 9 20"/><path d="M20 4v7a4 4 0 0 1-4 4H4"/>',
  send: '<path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  list: '<path d="M3 12h.01"/><path d="M3 18h.01"/><path d="M3 6h.01"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M8 6h13"/>',
  command: '<path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3"/>',
  calendar: '<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/>',
  "grip": '<circle cx="9" cy="12" r="1"/><circle cx="9" cy="5" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="19" r="1"/>',
};

const SCREENS = [
  ["index.html", "Overview"],
  ["01-request.html", "Request and response"],
  ["02-welcome.html", "First run and empty states"],
  ["03-palette.html", "Command palette"],
  ["04-collection.html", "Collection overview"],
  ["05-environment.html", "Environment editor"],
  ["06-runner.html", "Collection runner"],
  ["07-websocket.html", "WebSocket"],
  ["08-settings.html", "Settings"],
  ["09-history-cookies.html", "History and cookies"],
  ["10-dialogs.html", "Menus, dialogs and toasts"],
  ["flows.html", "Flows"],
];

const icon = (n, cls = "") => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-${n}"/></svg>`;
const kbd = (...keys) => keys.map((k) => `<span class="kbd">${k}</span>`).join("");
const M = (method) => `<span class="m ${method.toLowerCase()}">${method === "DELETE" ? "DEL" : method === "OPTIONS" ? "OPT" : method}</span>`;

// The sample workspace every screen shows.
const TREE = [
  { coll: "Northwind API", open: true, items: [
    { folder: "Auth", open: true, items: [["POST", "Login"], ["POST", "Refresh token"]] },
    { folder: "Users", open: true, items: [["GET", "List users"], ["GET", "Get user"], ["POST", "Create user"], ["PATCH", "Update role"], ["DELETE", "Delete user"]] },
    { folder: "Orders", open: false, items: [] },
    ["GET", "Health"],
    ["WS", "Order events"],
  ] },
  { coll: "Stripe sandbox", open: false, items: [] },
  { coll: "Internal tools", open: false, items: [] },
];

function treeRows(items, depth, opt) {
  let out = "";
  const pad = (d) => `style="padding-left:${4 + d * 14}px"`;
  for (const it of items) {
    if (Array.isArray(it)) {
      const [m, name] = it;
      const on = opt.active === name ? " on" : "";
      const dirty = (opt.dirty || []).includes(name) ? '<span class="dirty"></span>' : "";
      out += `<div class="row${on}" ${pad(depth)}><span class="chev"></span>${M(m)}<span class="name">${name}</span>${dirty}<span class="act">${icon("more", "sm")}</span></div>`;
    } else if (it.folder) {
      out += `<div class="row" ${pad(depth)}><span class="chev">${icon(it.open ? "chevron-down" : "chevron-right", "sm")}</span>${icon("folder", "sm")}<span class="name">${it.folder}</span><span class="act">${icon("more", "sm")}</span></div>`;
      if (it.open) out += treeRows(it.items, depth + 1, opt);
    }
  }
  return out;
}

function renderSidebar(opt) {
  const view = opt.view || "collections";
  let body = "";
  if (view === "collections") {
    for (const c of TREE) {
      const on = opt.active === c.coll ? " on" : "";
      body += `<div class="row coll${on}" style="padding-left:4px"><span class="chev">${icon(c.open ? "chevron-down" : "chevron-right", "sm")}</span><span class="name">${c.coll}</span><span class="act">${icon("more", "sm")}</span></div>`;
      if (c.open) body += treeRows(c.items, 1, opt);
    }
  } else {
    body = opt.historyHtml || "";
  }
  const envs = [["Globals", false], ["Local", opt.env !== "Staging" && opt.env !== "none"], ["Staging", opt.env === "Staging"]];
  const envRows = envs.map(([n, on]) => `<div class="row${opt.active === n ? " on" : ""}" style="padding-left:4px">${n === "Globals" ? `<span class="chev">${icon("globe", "sm")}</span>` : `<span class="chev"><span class="env-dot${on ? " on" : ""}" style="margin:0"></span></span>`}<span class="name">${n}</span>${on ? '<span class="count">active</span>' : ""}</div>`).join("");
  return `<aside class="sidebar">
    <div class="sb-head"><span class="ws">Restly ${icon("chevrons-up-down", "sm")}</span>
      <span class="btn icon sm" title="New">${icon("plus")}</span><span class="btn icon sm" title="Import">${icon("import")}</span></div>
    <div class="sb-views"><a class="${view === "collections" ? "on" : ""}">Collections</a><a class="${view === "history" ? "on" : ""}">History</a></div>
    <div class="sb-search">${icon("search", "sm")}<input placeholder="${view === "history" ? "Search history" : "Search requests"}" value="${opt.search || ""}">${kbd("⌘⇧F")}</div>
    <div class="tree">${body}</div>
    ${view === "collections" ? `<div class="sb-env"><div class="sb-section">${icon("chevron-down", "sm")}Environments<span class="grow"></span>${icon("plus", "sm")}</div>${envRows}</div>` : ""}
  </aside>`;
}

function renderTabbar(opt) {
  const tabs = (opt.tabs || []).map((t) => {
    const lead = t.kind ? `<span class="kind">${t.kind}</span>` : t.m ? M(t.m) : "";
    const trail = t.dirty ? `<span class="dirty"></span>` : `<span class="x">${icon("x", "sm")}</span>`;
    return `<div class="tab${t.on ? " on" : ""}">${lead}<span class="label">${t.label}</span>${trail}</div>`;
  }).join("");
  const env = opt.env === "none" ? "No environment" : opt.env || "Local";
  return `<div class="tabbar"><div class="tabs">${tabs}</div><span class="tab-new">${icon("plus")}</span>
    <div class="right"><span class="envpick"><span class="env-dot${opt.env === "none" ? "" : " on"}"></span>${env}${icon("chevron-down", "sm")}</span>
    <span class="vsep"></span><span class="btn icon" title="Cookies">${icon("cookie")}</span><span class="btn icon" title="Settings">${icon("settings")}</span></div></div>`;
}

function renderStatusbar(opt) {
  return `<footer class="statusbar">
    <span>${icon("layers")}${opt.where || "Northwind API"}</span>
    <span>${opt.saved || "Saved"}</span>
    <span class="grow"></span>
    ${opt.extra || ""}
    <span>${icon("shield")}${opt.proxy || "No proxy"}</span>
    <span>${icon("cookie")}${opt.cookies ?? 3} cookies</span>
    <span>${icon("command")}K Commands</span>
  </footer>`;
}

function renderDeckHead(file) {
  const i = SCREENS.findIndex(([f]) => f === file);
  const [, title] = SCREENS[i];
  const prev = SCREENS[i - 1], next = SCREENS[i + 1];
  return `<div class="deck-head"><h1>${title}</h1><span class="crumb">Restly redesign${i === 0 ? "" : ` · ${i} of ${SCREENS.length - 1}`}</span>
    <nav>${prev ? `<a href="${prev[0]}">← ${prev[1]}</a>` : ""}<a href="index.html">All screens</a>${next ? `<a href="${next[0]}">${next[1]} →</a>` : ""}
    <a href="#" id="theme-toggle">Toggle light/dark</a></nav></div>`;
}

function mount() {
  const sprite = `<svg width="0" height="0" style="position:absolute">${Object.entries(ICONS).map(([n, p]) => `<symbol id="i-${n}" viewBox="0 0 24 24">${p}</symbol>`).join("")}</svg>`;
  document.body.insertAdjacentHTML("afterbegin", sprite);
  const theme = localStorage.getItem("restly-mock-theme") || "dark";
  document.documentElement.dataset.theme = theme;
  document.querySelectorAll(".deck").forEach((d) => (d.dataset.theme = theme));
  const file = document.body.dataset.screen;
  if (file) document.querySelector(".deck")?.insertAdjacentHTML("afterbegin", renderDeckHead(file));
  const swap = (sel, fn) => document.querySelectorAll(`[${sel}]`).forEach((el) => (el.outerHTML = fn(JSON.parse(el.getAttribute(sel) || "{}"))));
  swap("data-sidebar", renderSidebar);
  swap("data-tabbar", renderTabbar);
  swap("data-statusbar", renderStatusbar);
  document.querySelectorAll("i[data-i]").forEach((el) => (el.outerHTML = icon(el.dataset.i, el.className)));
  document.querySelectorAll("[data-m]").forEach((el) => (el.outerHTML = M(el.dataset.m)));
  document.getElementById("theme-toggle")?.addEventListener("click", (e) => {
    e.preventDefault();
    localStorage.setItem("restly-mock-theme", theme === "dark" ? "light" : "dark");
    location.reload();
  });
  // ?theme=light overrides, for screenshots
  const q = new URLSearchParams(location.search).get("theme");
  if (q) { document.documentElement.dataset.theme = q; document.querySelectorAll(".deck").forEach((d) => (d.dataset.theme = q)); }
}
document.addEventListener("DOMContentLoaded", mount);
