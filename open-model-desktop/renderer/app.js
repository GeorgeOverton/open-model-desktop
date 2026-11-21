// Find models + My models + shared helpers. Based on the Open Model Finder web page.
(() => {
  "use strict";
  const HF = "https://huggingface.co";
  const TAGS = window.TAGS;
  const D = window.desktop;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const RAM_OPTIONS = [8, 16, 32, 64, 128];
  const store = {
    get(k, d) { try { const v = localStorage.getItem("omd." + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem("omd." + k, JSON.stringify(v)); } catch {} },
  };

  const state = {
    ram: store.get("ram", 16),
    tags: new Set(store.get("tags", [])),
    hideTooBig: store.get("hideTooBig", false),
    sort: { starter: store.get("sort.starter", "fit"), search: store.get("sort.search", "downloads") },
    tab: "starter",
    results: [],
    query: "",
    mine: [],            // downloaded models
    dl: new Map(),       // active downloads: id -> {name, quant, got, total}
    engine: { state: "idle", file: null }, // which model is running
  };

  // ---------- Shared helpers for chat.js and voice.js ----------
  const bus = new EventTarget();
  let tt;
  function toast(t, ms = 2600) { const el = $("#toast"); el.textContent = t; el.classList.add("show"); clearTimeout(tt); tt = setTimeout(() => el.classList.remove("show"), ms); }
  function show(view) {
    document.querySelectorAll(".nav [data-view]").forEach((b) => b.setAttribute("aria-selected", b.dataset.view === view));
    document.querySelectorAll(".view").forEach((v) => { v.hidden = v.id !== "view-" + view; });
    store.set("view", view);
    bus.dispatchEvent(new CustomEvent("view", { detail: view }));
  }
  // A round badge with the voice's initial, coloured by accent (used in chat, voice mode and settings).
  const avatar = (v, big) => `<span class="avatar ${big ? "big" : ""} ${v.accent === "British" ? "uk" : v.accent === "American" ? "us" : "sys"} ${v.gender === "Male" ? "m" : "f"}" aria-hidden="true">${esc(v.name[0])}<i>${v.flag || ""}</i></span>`;
  // "Optimal" choices: the app picks the best downloaded model for each question, within a memory size.
  const AUTO = [
    { file: "@auto", name: "✨ Optimal for this computer", quant: "picks the best model for each question", auto: true },
    { file: "@auto:8", name: "✨ Optimal 8 GB", quant: "best model that runs in 8 GB", auto: true },
    { file: "@auto:16", name: "✨ Optimal 16 GB", quant: "best model that runs in 16 GB", auto: true },
    { file: "@auto:32", name: "✨ Optimal 32 GB", quant: "best model that runs in 32 GB", auto: true },
  ];
  const chatChoices = () => {
    const models = state.mine.filter((m) => !(m.tags || []).includes("embeddings"));
    return models.some((m) => !m.online) ? [...AUTO, ...models] : models;
  };
  window.OMD = { $, esc, toast, show, bus, store, avatar, get mine() { return state.mine; }, get chatChoices() { return chatChoices(); }, fmtGB: (gb) => fmtGB(gb), refreshMine: () => refreshMine() };

  document.querySelector(".nav").addEventListener("click", (e) => { const b = e.target.closest("[data-view]"); if (b) show(b.dataset.view); });
  // External links always open in your normal browser.
  document.addEventListener("click", (e) => {
    const a = e.target.closest("a[href^='https://']"); if (!a) return;
    e.preventDefault(); D.sys.openExternal(a.href);
  });

  // ---------- Fit estimates ----------
  const usable = (ram) => ram * 0.75;
  function fitFor(needGB) {
    if (!needGB) return { cls: "unknown", label: "Size unknown", why: "We couldn't work out the size of this model." };
    const u = usable(state.ram);
    if (needGB <= u * 0.7) return { cls: "great", label: "Runs great", why: `Needs about ${fmtGB(needGB)} of memory. Your ${state.ram} GB computer has plenty of room.` };
    if (needGB <= u) return { cls: "ok", label: "Tight fit", why: `Needs about ${fmtGB(needGB)}. It should run on ${state.ram} GB, but close other big apps first.` };
    return { cls: "bad", label: "Too big", why: `Needs about ${fmtGB(needGB)}, which is more than a ${state.ram} GB computer can spare. Try a smaller model or a smaller file.` };
  }
  const ramFromFile = (gb) => gb * 1.2 + 0.8;
  const fmtGB = (gb) => (gb < 1 ? `${Math.round(gb * 1024)} MB` : `${gb < 10 ? gb.toFixed(1) : Math.round(gb)} GB`);
  const fmtWhen = (t) => new Date(t).toLocaleDateString(undefined, { month: "short", year: "numeric" });
  const fmtNum = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? Math.round(n / 1e3) + "K" : String(n ?? 0));

  // ---------- Hugging Face search results ----------
  function inferParams(id) {
    const name = id.split("/").pop();
    const moe = name.match(/(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)B/i);
    if (moe) return parseFloat(moe[1]) * parseFloat(moe[2]);
    const m = name.match(/(?:^|[-_.])(\d+(?:\.\d+)?)\s*([BM])(?=$|[-_.])/i);
    if (!m) return null;
    return m[2].toUpperCase() === "M" ? parseFloat(m[1]) / 1000 : parseFloat(m[1]);
  }
  function inferTags(m, params) {
    const s = (m.id + " " + (m.tags || []).join(" ")).toLowerCase();
    const t = new Set();
    if (/coder|code|starcoder|devstral|codestral/.test(s)) t.add("coding");
    if (/vl\b|-vl|vision|llava|image-text|minicpm-v|pixtral|gemma-3(?!n)|moondream/.test(s) || m.pipeline_tag === "image-text-to-text") t.add("vision");
    if (/r1|reason|think|qwq|phi-4|gpt-oss|magistral/.test(s)) t.add("reasoning");
    if (/embed|bge|e5-|gte-/.test(s) || m.pipeline_tag === "feature-extraction" || m.pipeline_tag === "sentence-similarity") t.add("embeddings");
    if (/aya|multilingual|qwen|gemma|mistral-nemo/.test(s)) t.add("multilingual");
    if (/story|writer|creative|roleplay|rp\b/.test(s)) t.add("writing");
    if (!t.has("embeddings") && (/instruct|chat|-it\b|-it-|conversational|text-generation/.test(s) || m.pipeline_tag === "text-generation")) t.add("chat");
    if (params && params <= 4.5) t.add("tiny");
    return [...t];
  }
  // Normalised name, so the many re-uploads of one model (bartowski, unsloth, lmstudio...) collapse into one card.
  const baseKey = (id) => id.split("/").pop().toLowerCase().replace(/[-_.]?(gguf|i1|imatrix|ggml|quantized|quants?)\b/g, "").replace(/[^a-z0-9]+/g, "");
  // Repos that aren't a model you can chat with (adapters, vision helper files, tests).
  const JUNK = /(^|[-_])(lora|mmproj|adapter|draft|test|tiny-random|dummy)([-_]|$)/i;
  function fromSearch(m) {
    const params = inferParams(m.id);
    const sizeGB = params ? params * 0.6 : null;
    const [owner, repo] = m.id.split("/");
    return {
      id: m.id, name: repo.replace(/[-_]GGUF$/i, "").replace(/[-_]/g, " "), maker: owner, params,
      sizeGB, ramGB: sizeGB ? ramFromFile(sizeGB) : null, tags: inferTags(m, params),
      downloads: m.downloads, likes: m.likes, created: m.createdAt ? Date.parse(m.createdAt) : null, trend: m.trendingScore || 0, live: true,
      blurb: m.pipeline_tag ? `Community model (${m.pipeline_tag.replace(/-/g, " ")}). Open it to see the real file sizes.` : "Community model. Open it to see the real file sizes.",
    };
  }

  // ---------- Controls ----------
  function renderControls() {
    $("#ram").innerHTML = RAM_OPTIONS.map((r) =>
      `<button role="radio" aria-checked="${r === state.ram}" data-ram="${r}">${r === 128 ? "128 GB+" : r + " GB"}</button>`).join("");
    $("#tagFilters").innerHTML = Object.entries(TAGS).map(([k, t]) =>
      `<button class="chip" aria-pressed="${state.tags.has(k)}" data-tag="${k}" title="${esc(t.hint)}">${t.emoji} ${esc(t.label)}</button>`).join("");
    $("#hideTooBig").checked = state.hideTooBig;
    const opts = SORTS.filter((o) => o.tabs.includes(state.tab));
    if (!opts.some((o) => o.id === state.sort[state.tab])) state.sort[state.tab] = opts[0].id;
    $("#sortBy").innerHTML = opts.map((o) => `<option value="${o.id}" ${o.id === state.sort[state.tab] ? "selected" : ""}>${esc(o.label)}</option>`).join("");
    $("#tabStarter").setAttribute("aria-selected", state.tab === "starter");
    $("#tabSearch").setAttribute("aria-selected", state.tab === "search");
  }
  $("#ram").addEventListener("click", (e) => {
    const b = e.target.closest("[data-ram]"); if (!b) return;
    state.ram = +b.dataset.ram; store.set("ram", state.ram); store.set("ramChosen", true); renderControls(); renderGrid();
  });
  $("#tagFilters").addEventListener("click", (e) => {
    const b = e.target.closest("[data-tag]"); if (!b) return;
    const k = b.dataset.tag; state.tags.has(k) ? state.tags.delete(k) : state.tags.add(k);
    store.set("tags", [...state.tags]); renderControls();
    // With nothing typed, the search asks Hugging Face for models of the picked kinds.
    if (state.tab === "search" && !state.query) search(""); else renderGrid();
  });
  $("#clearFilters").addEventListener("click", () => { state.tags.clear(); store.set("tags", []); renderControls(); if (state.tab === "search" && !state.query) search(""); else renderGrid(); });
  $("#sortBy").addEventListener("change", (e) => {
    const v = e.target.value; state.sort[state.tab] = v; store.set("sort." + state.tab, v);
    // Popularity, trending and newest come from Hugging Face, so fetch again in that order.
    if (state.tab === "search" && SORTS.find((o) => o.id === v).server) search(state.query); else renderGrid();
  });
  let typing;
  $("#q").addEventListener("input", (e) => {
    clearTimeout(typing);
    const q = e.target.value.trim();
    if (q.length === 1) return;
    typing = setTimeout(() => { state.tab = "search"; renderControls(); search(q); }, 450);
  });
  $("#hideTooBig").addEventListener("change", (e) => { state.hideTooBig = e.target.checked; store.set("hideTooBig", state.hideTooBig); renderGrid(); });
  $("#tabStarter").addEventListener("click", () => { state.tab = "starter"; renderControls(); renderGrid(); });
  $("#tabSearch").addEventListener("click", () => { state.tab = "search"; renderControls(); if (!state.results.length) search(""); else renderGrid(); });
  $("#searchForm").addEventListener("submit", (e) => { e.preventDefault(); clearTimeout(typing); state.tab = "search"; renderControls(); search($("#q").value.trim()); });

  // ---------- Grid ----------
  // "Sort by" choices. server: Hugging Face sorts the search for us (so we get the best of all models, not just the first page).
  const SORTS = [
    { id: "fit", label: "Best fit for my computer", tabs: ["starter", "search"] },
    { id: "downloads", label: "Most downloaded", tabs: ["search"], server: "downloads" },
    { id: "trending", label: "Trending now", tabs: ["search"], server: "trendingScore" },
    { id: "likes", label: "Most liked", tabs: ["search"], server: "likes" },
    { id: "newest", label: "Newest", tabs: ["search"], server: "createdAt" },
    { id: "small", label: "Smallest first", tabs: ["starter", "search"] },
    { id: "large", label: "Biggest (smartest) first", tabs: ["starter", "search"] },
    { id: "name", label: "Name A to Z", tabs: ["starter", "search"] },
  ];
  const FIT_ORDER = { great: 0, ok: 1, unknown: 2, bad: 3 };
  const matches = (m) => [...state.tags].filter((t) => m.tags.includes(t)).length;
  function visibleModels() {
    let list = state.tab === "starter" ? window.STARTER_MODELS : state.results;
    // Pick any: a model shows if it does at least one of the things you picked, and models that do more of them come first.
    if (state.tags.size) list = list.filter((m) => matches(m) > 0);
    if (state.hideTooBig) list = list.filter((m) => fitFor(m.ramGB).cls !== "bad");
    const fit = (m) => FIT_ORDER[fitFor(m.ramGB).cls];
    const size = (m) => m.sizeGB ?? Infinity;
    const by = {
      fit: (a, b) => fit(a) - fit(b) || (fit(a) < 2 ? (b.params || 0) - (a.params || 0) : size(a) - size(b)),
      small: (a, b) => size(a) - size(b),
      large: (a, b) => (b.sizeGB ?? -1) - (a.sizeGB ?? -1),
      name: (a, b) => a.name.localeCompare(b.name),
    }[state.sort[state.tab]];
    const tagRank = (a, b) => (state.tags.size > 1 ? matches(b) - matches(a) : 0);
    // Server sorts keep Hugging Face's order (only tag matches move a model up).
    list = [...list].sort((a, b) => tagRank(a, b) || (by ? by(a, b) : 0));
    return list;
  }
  const tagHtml = (tags) => (tags || []).map((t) => TAGS[t] ? `<span class="tag" title="${esc(TAGS[t].hint)}">${TAGS[t].emoji} ${esc(TAGS[t].label)}</span>` : "").join("");
  const haveRepo = (id) => state.mine.some((m) => m.repo === id);

  // ---------- Logo tiles and "how demanding" pills (same design as the web showcase) ----------
  const MAKERS = window.MAKERS, LOGOS = window.LOGOS, LEVELS = window.LEVELS;
  const GUESS = [[/llama|meta/i, "Meta"], [/qwen|qwq/i, "Alibaba Qwen"], [/gemma/i, "Google"], [/phi-?\d/i, "Microsoft"], [/deepseek/i, "DeepSeek"],
    [/mistral|mixtral|codestral|devstral|magistral|pixtral/i, "Mistral AI"], [/aya|command-r|cohere/i, "Cohere"], [/gpt-oss/i, "OpenAI"], [/nomic/i, "Nomic AI"]];
  // Which company made it (for the logo), even for community uploads like "bartowski/...Llama...".
  const makerOf = (m) => MAKERS[m.maker] ? m.maker : (GUESS.find(([re]) => re.test(m.repo || m.id || m.name)) || [])[1] || null;
  const logoImg = (maker, fallback) => {
    const k = MAKERS[maker] || {};
    return LOGOS[k.logo] ? `<img src="${LOGOS[k.logo]}" alt="${esc(maker)} logo">` : `<span class="mono">${esc(k.mono || (fallback || maker || "?")[0].toUpperCase())}</span>`;
  };
  const paramLabel = (m) => m.paramsLabel || (m.params ? (m.params < 1 ? Math.round(m.params * 1000) + "M" : +(+m.params).toFixed(1) + "B") : "");
  function tile(m) {
    const maker = makerOf(m);
    const { hue = 230, sat = 55 } = MAKERS[maker] || {};
    return `<div class="tile" style="background:linear-gradient(140deg,hsl(${hue} ${sat}% 46%),hsl(${hue + 18} ${sat}% 24%))">
      <span class="maker">${esc(maker || m.maker || "")}</span><div class="logo">${logoImg(maker, m.maker || m.name)}</div>${paramLabel(m) ? `<span class="size">${esc(paramLabel(m))}</span>` : ""}</div>`;
  }
  const memNeed = (sizeGB, m = {}) => sizeGB * 1.2 + 0.8 + (m.extra || 0);
  const levelOf = (sizeGB, m) => { if (!sizeGB) return 0; const r = memNeed(sizeGB, m); return r <= 4 ? 1 : r <= 8 ? 2 : r <= 12.5 ? 3 : 4; };
  const pill = (lv) => lv ? `<span class="demand lv${lv}" title="${esc(LEVELS[lv].hw[0])}"><b>${[1, 2, 3, 4].map((i) => `<i class="${i <= lv ? "on" : ""}"></i>`).join("")}</b>${LEVELS[lv].name}</span>`
    : `<span class="demand lv0">Size unknown</span>`;
  const roundMem = (g) => (g < 2 ? Math.ceil(g * 2) / 2 : Math.ceil(g));
  const fitDot = (m) => { const f = fitFor(m.ramGB); return `<span class="fitnote ${f.cls}" title="${esc(f.why)}">${f.cls === "great" ? "✓ Fits your computer" : f.cls === "ok" ? "Tight fit" : f.cls === "bad" ? "Too big for you" : ""}</span>`; };

  function card(m) {
    const embed = m.tags.includes("embeddings");
    const btn = haveRepo(m.id) ? `<span class="got">✓ Downloaded</span>`
      : `<button class="btn primary sm" data-open="${esc(m.id)}">${embed ? "Details" : "Download"}</button>`;
    const big = fitFor(m.ramGB).cls === "bad";
    return `<article class="card mcard ${big ? "toobig" : ""}" tabindex="0" data-open="${esc(m.id)}" aria-label="${esc(m.name)}${big ? " (too big for your computer)" : ""}">
      ${tile(m)}
      <div class="info">
        <h3>${esc(m.name)}</h3>
        <div class="use">${esc(m.use || m.blurb)}</div>
        ${m.downloads != null ? `<div class="small muted stats">⬇ ${fmtNum(m.downloads)} downloads${m.likes ? ` · ♥ ${fmtNum(m.likes)}` : ""}${m.created ? ` · added ${fmtWhen(m.created)}` : ""}${m.dupes ? ` · <span title="Other people have uploaded copies of this model too. We show the most popular one.">+${m.dupes} copies</span>` : ""}</div>` : ""}
        ${fitDot(m)}
        <div class="foot">${pill(levelOf(m.sizeGB, m))}${btn}</div>
      </div>
    </article>`;
  }

  function renderGrid() {
    const list = visibleModels();
    const g = $("#grid");
    if (state.tab === "search" && state.loading) { g.innerHTML = ""; return; }
    if (!list.length) g.innerHTML = `<div class="empty">No models match those choices. Try removing a filter${state.hideTooBig ? " or showing models that are too big" : ""}.</div>`;
    else g.innerHTML = list.map(card).join("");
    const sortLabel = SORTS.find((o) => o.id === state.sort[state.tab])?.label.toLowerCase() || "";
    const big = list.filter((m) => fitFor(m.ramGB).cls === "bad").length;
    const bigNote = big && !state.hideTooBig ? ` ${big} greyed out ${big === 1 ? "is" : "are"} too big for ${state.ram === 8 ? "an" : "a"} ${state.ram} GB computer.` : "";
    if (state.tab === "starter") setStatus(`${list.length} hand-picked models, sorted by ${sortLabel}.${bigNote}`);
    else if (!state.error) setStatus(`${list.length} models${state.query ? ` for "${state.query}"` : state.tags.size ? " of the kinds you picked" : ""}, sorted by ${sortLabel}.${bigNote} Sizes are estimates until you open a model.`);
    $("#clearFilters").hidden = !state.tags.size;
  }
  const setStatus = (t) => { $("#status").textContent = t; };

  $("#grid").addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.dataset.open) e.target.click(); });
  $("#grid").addEventListener("click", (e) => {
    if (e.target.closest("a")) return;
    const b = e.target.closest("[data-open]"); if (!b) return;
    const m = window.STARTER_MODELS.find((x) => x.id === b.dataset.open) || state.results.find((x) => x.id === b.dataset.open);
    if (m) openDetail(m);
  });

  // What to ask Hugging Face for when you pick a kind of model but don't type anything.
  const TAG_SEARCH = {
    coding: [{ search: "coder" }], vision: [{ pipeline_tag: "image-text-to-text" }], reasoning: [{ search: "reasoning" }, { search: "r1" }, { search: "thinking" }],
    embeddings: [{ search: "embed" }], writing: [{ search: "writer" }, { search: "story" }], multilingual: [{ search: "multilingual" }, { search: "aya" }],
    tiny: [{ search: "1b" }, { search: "3b" }, { search: "mini" }], chat: [{ pipeline_tag: "text-generation" }],
  };
  let searchSeq = 0;
  async function search(q) {
    const my = ++searchSeq;
    state.query = q; state.loading = true; state.error = null; renderGrid();
    setStatus(q ? `Searching Hugging Face for "${q}"…` : "Searching Hugging Face…");
    const sort = SORTS.find((o) => o.id === state.sort.search)?.server || "downloads";
    // With kinds picked, also include the overall most popular models (their kind is worked out from their name and tags).
    const asks = q ? [{ search: q }] : state.tags.size ? [{}, ...[...state.tags].flatMap((t) => TAG_SEARCH[t] || [])] : [{}];
    const url = (p) => `${HF}/api/models?` + new URLSearchParams({ filter: "gguf", sort, direction: "-1", limit: q ? "100" : "60", ...p });
    try {
      const pages = await Promise.all(asks.map(async (p) => { const r = await fetch(url(p)); if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); }));
      if (my !== searchSeq) return;
      // Merge, drop non-chat helper repos, and collapse re-uploads of the same model into its most downloaded copy.
      const seen = new Map();
      for (const raw of pages.flat()) {
        if (JUNK.test(raw.id) || seen.has(raw.id)) continue;
        seen.set(raw.id, raw);
      }
      const byBase = new Map();
      for (const raw of seen.values()) {
        const k = baseKey(raw.id), cur = byBase.get(k);
        if (!cur) byBase.set(k, { ...raw, dupes: 0 });
        else if ((raw.downloads || 0) > (cur.downloads || 0)) byBase.set(k, { ...raw, dupes: cur.dupes + 1 });
        else cur.dupes++;
      }
      let list = [...byBase.values()];
      if (asks.length > 1) {
        const key = { downloads: "downloads", likes: "likes", trendingScore: "trendingScore", createdAt: "createdAt" }[sort];
        list.sort((a, b) => (key === "createdAt" ? Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0) : (b[key] || 0) - (a[key] || 0)));
      }
      state.results = list.map((raw) => ({ ...fromSearch(raw), dupes: raw.dupes }));
    } catch (err) {
      if (my !== searchSeq) return;
      state.results = []; state.error = err;
      setStatus("Couldn't reach Hugging Face. Check your internet connection. Your downloaded models still work offline.");
    }
    state.loading = false; renderGrid();
  }

  // ---------- Detail: choose a file and download it into the app ----------
  const QUANT_RE = /(IQ\d_[A-Z]+|Q\d_K_[SMLXL]+|Q\d_K|Q\d_\d|Q\d_[A-Z0-9]+|Q\d|BF16|F16|F32|MXFP4)/i;
  const QUANT_NOTES = {
    Q2: "Smallest, noticeably lower quality", Q3: "Small, some quality loss", Q4_K_M: "Recommended for most people",
    Q4: "Good balance of size and quality", Q5: "Slightly better quality, a bit bigger", Q6: "Very close to the original",
    Q8: "Almost identical to the original, twice the size of Q4", F16: "Full size, only for experts", BF16: "Full size, only for experts",
    F32: "Full size, only for experts", MXFP4: "The format this model was released in", IQ: "Extra-compressed, good when memory is tight",
  };
  function quantNote(q) {
    if (!q) return "";
    const u = q.toUpperCase();
    return QUANT_NOTES[u] || QUANT_NOTES[u.slice(0, 2) === "IQ" ? "IQ" : u.slice(0, 2)] || QUANT_NOTES[u.split("_")[0]] || "";
  }
  async function listGGUF(id) {
    const r = await fetch(`${HF}/api/models/${id}/tree/main?recursive=true`);
    if (!r.ok) throw new Error("HTTP " + r.status);
    const items = await r.json();
    const groups = new Map();
    for (const f of items) {
      if (f.type !== "file" || !/\.gguf$/i.test(f.path) || /mmproj/i.test(f.path)) continue;
      const split = f.path.match(/^(.*)-(\d{5})-of-(\d{5})\.gguf$/i);
      const key = split ? split[1] : f.path;
      const g = groups.get(key) || { size: 0, parts: [], first: f.path };
      g.size += f.size || 0; g.parts.push({ path: f.path, size: f.size || 0 });
      if (split && split[2] === "00001") g.first = f.path;
      groups.set(key, g);
    }
    return [...groups.values()].map((g) => {
      const q = (g.first.split("/").pop().match(QUANT_RE) || [])[1] || null;
      const parts = g.parts.sort((a, b) => a.path.localeCompare(b.path));
      return { path: g.first, size: g.size, parts, quant: q ? q.toUpperCase() : null };
    }).sort((a, b) => a.size - b.size);
  }
  function pickRecommended(files) {
    const fits = (f) => fitFor(ramFromFile(f.size / 1e9)).cls !== "bad";
    return files.find((f) => f.quant === "Q4_K_M" && fits(f))
      || files.find((f) => /^Q4/.test(f.quant || "") && fits(f))
      || [...files].reverse().find((f) => fits(f) && !/^(F16|BF16|F32)$/.test(f.quant || ""))
      || files.find((f) => f.quant === "Q4_K_M") || files[0];
  }

  let current = null, currentFiles = [];
  const fmtDate = (d) => new Date(d + "T00:00:00").toLocaleDateString(undefined, { month: "short", year: "numeric" });
  const age = (d) => { const mo = Math.max(0, Math.round((Date.now() - new Date(d)) / (30.44 * 864e5))); return mo < 12 ? `${mo} month${mo === 1 ? "" : "s"}` : `${(mo / 12).toFixed(1).replace(/\.0$/, "")} years`; };
  // Speed ≈ memory bandwidth ÷ bytes read per word (laptop CPU 60 GB/s, Apple M-series 120 GB/s, gaming GPU 450 GB/s).
  const speed = (m, bw, vram) => (vram && memNeed(m.sizeGB, m) > vram ? null : Math.max(1, Math.round(0.55 * bw / (m.active || m.sizeGB) * 0.75)));
  const speedLabel = (w) => w == null ? "Doesn't fit" : w >= 40 ? `~${Math.min(w, 99)}${w > 99 ? "+" : ""} words/s · instant` : w >= 12 ? `~${w} words/s · fast` : w >= 5 ? `~${w} words/s · readable` : `~${w} words/s · slow`;

  function openDetail(m) {
    current = m;
    const lv = levelOf(m.sizeGB, m), L = LEVELS[lv] || null, need = m.sizeGB ? roundMem(memNeed(m.sizeGB, m)) : null;
    const fit = fitFor(m.ramGB);
    const embed = m.tags.includes("embeddings");
    $("#dTitle").textContent = m.name; $("#dSub").textContent = "";
    const speeds = !m.sizeGB ? `<p class="note">Open a version below to see its size.</p>` : embed
      ? `<p class="note">Embedding models don't chat, so speed is measured differently: this one processes thousands of words a second on any computer.</p>`
      : `<table class="speeds"><tbody>
          <tr><td>Laptop processor only (8 to 16 GB)</td><td>${speedLabel(speed(m, 60))}</td></tr>
          <tr><td>Apple M-series Mac</td><td>${speedLabel(speed(m, 120))}</td></tr>
          <tr><td>Graphics card, 8 GB</td><td>${speedLabel(speed(m, 450, 8))}</td></tr>
          <tr><td>Graphics card, 16 GB+</td><td>${speedLabel(speed(m, 700, 16))}</td></tr></tbody></table>
        <p class="note">People read about 4 words a second, so anything above that feels smooth.${m.thinks ? " This model thinks out loud first, so expect a pause before the real answer." : ""}</p>`;
    $("#dBody").innerHTML = `
      <div class="detail">
      <div class="dtop">
        ${tile(m)}
        <div>
          <div class="eyebrow">${esc(makerOf(m) || m.maker)}</div>
          <h2>${esc(m.name)}</h2>
          <div class="sub">${esc(m.use || "")}</div>
          <div class="tags">${tagHtml(m.tags)}</div>
        </div>
        <div class="dactions">
          <button class="btn primary" id="dlBest" disabled>Download best version</button>
          <a class="btn" href="${HF}/${esc(m.id)}">Model page ↗</a>
        </div>
      </div>
      <div class="dgrid">
        <div class="panel">
          <h3>About this model</h3>
          <p>${esc(m.about || m.blurb)}</p>
          ${embed ? `<p class="small"><strong>Heads up:</strong> this is a search model, not a chatbot, so it won't chat in this app.</p>` : ""}
          ${m.tags.includes("vision") ? `<p class="small muted">This model can see images, but this app only chats with text for now.</p>` : ""}
          <dl class="facts">
            <div><dt>Released</dt><dd>${m.released ? fmtDate(m.released) : "Not listed"}</dd></div>
            <div><dt>Age</dt><dd>${m.released ? age(m.released) : "Not listed"}</dd></div>
            <div><dt>Parameters</dt><dd>${esc(paramLabel(m) || "Not listed")}</dd></div>
            <div><dt>Download</dt><dd>${m.sizeGB ? fmtGB(m.sizeGB) : "See below"}</dd></div>
            <div><dt>Reads at once</dt><dd>${m.context ? esc(m.context) + " tokens" : "Not listed"}</dd></div>
            <div><dt>Made by</dt><dd>${esc(makerOf(m) || m.maker)}</dd></div>
          </dl>
        </div>
        <div class="panel">
          <h3>What it takes to run</h3>
          <div class="verdict">${pill(lv)}<span class="muted">${esc(L ? L.heat : "")}</span></div>
          <p class="small"><span class="fit ${fit.cls}">${fit.label}</span> ${esc(fit.why)}</p>
          ${need ? `<div class="meters">
            <div class="meter"><span>Memory needed</span><div class="track"><div class="fill" style="width:${Math.min(100, need / 32 * 100)}%"></div></div><span class="val">${need} GB</span></div>
            <div class="meter"><span>Disk space</span><div class="track"><div class="fill" style="width:${Math.min(100, m.sizeGB / 20 * 100)}%"></div></div><span class="val">${fmtGB(m.sizeGB)}</span></div>
          </div>` : ""}
          ${L ? `<div><div class="eyebrow" style="margin-bottom:6px">Recommended computer</div><ul class="hw">${L.hw.map((h) => `<li>${esc(h)}</li>`).join("")}</ul></div>` : ""}
          <div><div class="eyebrow" style="margin-bottom:2px">Expected speed</div>${speeds}</div>
        </div>
      </div>
      <div class="panel versions">
        <h3>Choose a version to download</h3>
        <p class="small muted">We've highlighted the best one for your computer; you only need one.</p>
        <div id="files"><p class="muted small">Loading files from Hugging Face…</p></div>
      </div>
      </div>`;
    const dlg = $("#detail");
    if (!dlg.open) dlg.showModal();
    loadFiles(m);
  }
  async function loadFiles(m) {
    const box = $("#files");
    try {
      const files = await listGGUF(m.id);
      if (current !== m) return;
      currentFiles = files;
      if (!files.length) { box.innerHTML = `<p class="small">No GGUF files found here. See the <a href="${HF}/${esc(m.id)}/tree/main">file list</a>.</p>`; return; }
      const rec = pickRecommended(files);
      box.innerHTML = `<table class="files"><thead><tr><th>Version</th><th>Size</th><th class="hide-sm">What it means</th><th></th></tr></thead><tbody>${
        files.map((f, i) => {
          const gb = f.size / 1e9; const ft = fitFor(ramFromFile(gb));
          return `<tr class="${f === rec ? "rec" : ""}">
            <td><strong>${esc(f.quant || f.path.split("/").pop())}</strong>${f === rec ? '<span class="pill">Best for you</span>' : ""}<br><span class="fit ${ft.cls}">${ft.label}</span></td>
            <td>${fmtGB(gb)}${f.parts.length > 1 ? `<br><span class="small muted">${f.parts.length} parts</span>` : ""}</td>
            <td class="hide-sm small">${esc(quantNote(f.quant))}</td>
            <td><button class="btn sm${f === rec ? " primary" : ""}" data-dl="${i}">Download</button></td></tr>`;
        }).join("")}</tbody></table>
        <p class="small muted">Some models ask you to log in to Hugging Face and accept a licence first. If a download says so, open the model page.</p>`;
      const best = $("#dlBest");
      if (best) { best.disabled = false; best.dataset.dl = String(files.indexOf(rec)); best.textContent = `Download ${rec.quant || "best version"} (${fmtGB(rec.size / 1e9)})`; }
      if (m.live) { m.sizeGB = rec.size / 1e9; m.ramGB = ramFromFile(m.sizeGB); renderGrid(); }
    } catch {
      box.innerHTML = `<p class="small">Couldn't load the file list (are you offline?). Try again when you're connected.</p>`;
    }
  }
  $("#dClose").addEventListener("click", () => $("#detail").close());
  $("#detail").addEventListener("click", async (e) => {
    if (e.target === e.currentTarget) e.currentTarget.close();
    const b = e.target.closest("[data-dl]"); if (!b || !current) return;
    const f = currentFiles[+b.dataset.dl];
    await D.downloads.start({ repo: current.id, name: current.name, maker: current.maker, tags: current.tags, quant: f.quant,
      blurb: current.blurb, parts: f.parts });
    $("#detail").close();
    toast(`Downloading ${current.name}. You can keep browsing; see progress in My models.`, 3500);
    state.dl.set(current.id + "::" + f.parts[0].path, { name: current.name, quant: f.quant, got: 0, total: f.size });
    renderDownloads(); show("mine");
  });

  // ---------- Downloads + My models ----------
  function renderDownloads() {
    const items = [...state.dl.entries()];
    $("#dlList").innerHTML = items.map(([id, d]) => {
      const pct = d.total ? Math.min(100, (d.got / d.total) * 100) : 0;
      return `<div class="dl"><div class="row"><strong>${esc(d.name)} <span class="muted small">${esc(d.quant || "")}</span></strong>
        <span class="small muted">${fmtGB(d.got / 1e9)} of ${fmtGB(d.total / 1e9)}</span>
        <button class="btn sm" data-cancel="${esc(id)}">Cancel</button></div>
        <div class="bar"><span style="width:${pct.toFixed(1)}%"></span></div></div>`;
    }).join("");
  }
  $("#dlList").addEventListener("click", (e) => { const b = e.target.closest("[data-cancel]"); if (b) D.downloads.cancel(b.dataset.cancel); });
  D.downloads.onProgress((p) => { state.dl.set(p.id, { ...state.dl.get(p.id), name: p.name, quant: p.quant, got: p.got, total: p.total }); renderDownloads(); });
  D.downloads.onDone(async (p) => { state.dl.delete(p.id); renderDownloads(); toast(`${p.name} is ready. Open Chat to talk to it.`, 3500); await refreshMine(); });
  D.downloads.onError((p) => {
    state.dl.delete(p.id); renderDownloads();
    if (!p.cancelled) toast(`${p.name}: ${p.message}`, 7000);
  });

  // ---------- Favourites (pinned to the top) and "recently used" ----------
  const favs = new Set(store.get("favs", []));
  const isFav = (id) => favs.has(id);
  function toggleFav(id) { favs.has(id) ? favs.delete(id) : favs.add(id); store.set("favs", [...favs]); refreshMine(); renderOnline(); }
  const star = (id, name) => `<button class="star ${isFav(id) ? "on" : ""}" data-fav="${esc(id)}" aria-pressed="${isFav(id)}"
    title="${isFav(id) ? "Unpin from the top" : "Pin to the top as a favourite"}" aria-label="${isFav(id) ? "Remove" : "Add"} ${esc(name)} ${isFav(id) ? "from" : "to"} favourites">${isFav(id) ? "★" : "☆"}</button>`;
  const lastUsed = store.get("lastUsed", {});
  function markUsed(id) { if (!id) return; lastUsed[id] = Date.now(); store.set("lastUsed", lastUsed); }

  // ---------- Claude, using your Claude Pro plan through Claude Code ----------
  async function claudeEntry() {
    const [s, models] = await Promise.all([D.settings.get(), D.claude.models()]);
    const cm = models.find((x) => x.id === (s.claudeModel ?? "")) || models[0];
    return { file: "@claude", name: "Claude", maker: "Anthropic", online: true, ready: !!s.claudeEnabled, quant: (cm.id ? cm.name : "Pro plan") + " · online",
      modelName: cm.id ? "Claude " + cm.name : "Claude", blurb: cm.blurb, tags: ["chat", "reasoning", "coding", "writing", "multilingual"] };
  }
  let claude = null;

  // ---------- My models (downloaded only) ----------
  const MINE_SORTS = [
    { id: "recent", label: "Recently used" }, { id: "name", label: "Name A to Z" }, { id: "small", label: "Smallest first" },
    { id: "large", label: "Biggest first" }, { id: "added", label: "Newest download" },
  ];
  let mineSort = store.get("mineSort", "recent");
  $("#mineSort").innerHTML = MINE_SORTS.map((o) => `<option value="${o.id}" ${o.id === mineSort ? "selected" : ""}>${o.label}</option>`).join("");
  $("#mineSort").addEventListener("change", (e) => { mineSort = e.target.value; store.set("mineSort", mineSort); refreshMine(); });
  function sortMine(list) {
    const by = {
      recent: (a, b) => (lastUsed[b.file] || 0) - (lastUsed[a.file] || 0) || a.name.localeCompare(b.name),
      name: (a, b) => a.name.localeCompare(b.name),
      small: (a, b) => a.size - b.size,
      large: (a, b) => b.size - a.size,
      added: (a, b) => (b.added || 0) - (a.added || 0),
    }[mineSort];
    // Favourites always come first, then the chosen order.
    return [...list].sort((a, b) => (isFav(b.file) - isFav(a.file)) || by(a, b));
  }
  async function refreshMine() {
    const local = await D.models.list();
    claude = await claudeEntry().catch(() => null);
    state.local = local;
    state.mine = claude?.ready ? [...local, claude] : local;   // Chat and wake phrases can use Claude too
    $("#mineCount").textContent = local.length || "";
    $("#mineGrid").innerHTML = local.length ? sortMine(local).map((m) => { const f = factsFor(m.repo); const mm = { ...f, ...m, id: m.repo, use: f.use || m.blurb, sizeGB: m.size / 1e9 }; return `<article class="card mcard mine ${isFav(m.file) ? "fav" : ""}">
        ${tile(mm)}${star(m.file, m.name)}
        <div class="info">
        <h3>${esc(m.name)}</h3>
        <div class="use">${esc(mm.use || "")}</div>
        <div class="foot">${pill(levelOf(mm.sizeGB, mm))}<span class="small muted" title="${esc(m.quant || "")}">${fmtGB(mm.sizeGB)} on disk</span></div>
        <div class="runrow" data-run-for="${esc(m.file)}">${runControls(m.file)}</div>
        <div class="row"><button class="btn sm ghost" data-del="${esc(m.file)}">Delete</button>
          <button class="btn sm" data-chat="${esc(m.file)}">Chat</button></div>
        </div>
      </article>`; }).join("")
      : `<div class="empty">No models yet. Go to <button class="linkish" data-goto="find">Find models</button> and press Download on one that says <span class="fitnote great">✓ Fits your computer</span>.<br>
         <span class="small">Not sure? <strong>Llama 3.2 3B</strong> or <strong>Qwen3 4B</strong> are great first picks. Or try a free <button class="linkish" data-goto="online">online model</button> straight away.</span></div>`;
    $("#mineSortWrap").hidden = local.length < 2;
    renderGrid();
    renderOnline();
    bus.dispatchEvent(new CustomEvent("models"));
  }

  // ---------- Online models (free plans, you sign in on each company's own website) ----------
  const ONLINE = [
    { id: "claude", name: "Claude", maker: "Anthropic", hue: 18, sat: 62, mono: "A", use: "Thoughtful writing, coding and long documents.", free: "Free plan with daily limits. Use your Pro plan in this app too." },
    { id: "chatgpt", name: "ChatGPT", maker: "OpenAI", logo: "openai", use: "All-round assistant, images and web search.", free: "Free plan with limits on the newest model." },
    { id: "gemini", name: "Gemini", maker: "Google", logo: "gemma", use: "Google's assistant, good with Google apps and search.", free: "Free with a Google account." },
    { id: "copilot", name: "Copilot", maker: "Microsoft", logo: "microsoft", use: "Microsoft's assistant, with web answers and image making.", free: "Free with a Microsoft account (or none)." },
    { id: "lechat", name: "Le Chat", maker: "Mistral AI", logo: "mistral", use: "Fast answers from Mistral, a European AI company.", free: "Free plan with daily limits." },
    { id: "deepseek", name: "DeepSeek", maker: "DeepSeek", logo: "deepseek", use: "Strong at maths, reasoning and code.", free: "Free to use." },
  ];
  function onlineTile(o) {
    const k = window.MAKERS[o.maker] || {};
    const hue = o.hue ?? k.hue ?? 230, sat = o.sat ?? k.sat ?? 55;
    const logo = o.logo && window.LOGOS[o.logo] ? `<img src="${window.LOGOS[o.logo]}" alt="${esc(o.maker)} logo">` : `<span class="mono">${esc(o.mono || o.name[0])}</span>`;
    return `<div class="tile" style="background:linear-gradient(140deg,hsl(${hue} ${sat}% 46%),hsl(${hue + 18} ${sat}% 24%))"><span class="maker">${esc(o.maker)}</span><div class="logo">${logo}</div><span class="size">Online</span></div>`;
  }
  function renderOnline() {
    const grid = $("#onlineGrid"); if (!grid) return;
    const list = [...ONLINE].sort((a, b) => isFav("web:" + b.id) - isFav("web:" + a.id));
    grid.innerHTML = list.map((o) => {
      const fid = "web:" + o.id;
      const inApp = o.id === "claude" && claude?.ready;
      return `<article class="card mcard online ${isFav(fid) ? "fav" : ""}">
        ${onlineTile(o)}${star(fid, o.name)}
        <div class="info">
          <h3>${esc(o.name)}</h3>
          <div class="use">${esc(o.use)}</div>
          <div class="foot"><span class="demand lvon">☁ ${inApp ? "Your Pro plan" : "Free plan"}</span><span class="small muted">${esc(o.free)}</span></div>
          ${inApp ? `<div class="runrow" data-run-for="@claude">${runControls("@claude")}</div>
            <div class="row"><button class="btn sm ghost" data-web="claude">Open claude.ai</button><button class="btn sm" data-chat="@claude">Chat here</button></div>`
          : `<div class="row"><button class="btn primary sm" data-web="${o.id}">Open ${esc(o.name)}</button>
              <button class="btn sm ghost" data-web-ext="${o.id}" title="Open in your normal web browser instead">In my browser</button></div>
             ${o.id === "claude" ? `<p class="small"><button class="linkish" data-goto="settings" data-claude-settings>Have Claude Pro? Use it right here in Chat and Voice</button></p>` : ""}`}
        </div>
      </article>`;
    }).join("");
  }
  async function onCardClick(e) {
    const f = e.target.closest("[data-fav]"); if (f) { e.stopPropagation(); return toggleFav(f.dataset.fav); }
    const w = e.target.closest("[data-web]"); if (w) { markUsed("web:" + w.dataset.web); return D.web.open(w.dataset.web); }
    const x = e.target.closest("[data-web-ext]"); if (x) return D.web.external(x.dataset.webExt);
    return onMineClick(e);
  }
  $("#onlineGrid").addEventListener("click", onCardClick);

  // Run / Running / Cancel for each downloaded model. One model runs at a time.
  function runControls(file) {
    const st = state.engine;
    if (file === "@claude" && st.file === file) {
      return st.state === "loading" ? `<span class="run loading"><span class="spinner"></span> Connecting…</span>`
        : st.limit ? `<span class="run limit">⛔ Plan limit reached${st.limit !== "later" ? ` · resets ${esc(st.limit)}` : ""}</span><button class="btn sm" data-stop>Cancel</button>`
        : `<span class="run on"><span class="live"></span> Running <span class="muted small">(online)</span></span><button class="btn sm" data-stop>Cancel</button>`;
    }
    if (file === "@claude") return `<button class="btn primary sm" data-run="@claude">▶ Run</button>
      <span class="small muted">${st.state !== "idle" && st.file ? "Stops the local model and uses Claude" : "Checks Claude Code is signed in"}</span>`;
    if (st.file === file && st.state === "loading") {
      const pct = st.progress ? Math.round(st.progress * 100) : 0;
      return `<span class="run loading"><span class="spinner"></span> Starting… ${pct ? pct + "%" : ""}</span>
        <button class="btn sm" data-stop>Cancel</button>`;
    }
    if (st.file === file && st.state === "ready") {
      return `<span class="run on"><span class="live"></span> Running${st.gpu ? ` <span class="muted small">(${esc(String(st.gpu).toUpperCase())} graphics)</span>` : ""}</span>
        <button class="btn sm" data-stop>Cancel</button>`;
    }
    return `<button class="btn primary sm" data-run="${esc(file)}">▶ Run</button>
      <span class="small muted">${st.state !== "idle" && st.file ? "Switches from the running model" : "Loads it ready to chat"}</span>`;
  }
  function renderRun() {
    document.querySelectorAll("[data-run-for]").forEach((el) => { el.innerHTML = runControls(el.dataset.runFor); });
  }
  $("#mineGrid").addEventListener("click", (e) => onCardClick(e));
  async function onMineClick(e) {
    const go = e.target.closest("[data-goto]");
    if (go) { show(go.dataset.goto); if (go.hasAttribute("data-claude-settings")) setTimeout(() => $("#claudeApiBox")?.scrollIntoView({ block: "start" }), 50); return; }
    const run = e.target.closest("[data-run]");
    if (run) {
      state.engine = { state: "loading", file: run.dataset.run }; renderRun();
      try { await D.chat.load(run.dataset.run); }
      catch (err) { const msg = String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""); if (!/Cancelled/.test(msg)) toast(msg, 7000); }
      return;
    }
    if (e.target.closest("[data-stop]")) { await D.chat.unload(); return; }
    const c = e.target.closest("[data-chat]");
    if (c) { bus.dispatchEvent(new CustomEvent("chatWith", { detail: c.dataset.chat })); return show("chat"); }
    const d = e.target.closest("[data-del]");
    if (d) {
      const m = state.mine.find((x) => x.file === d.dataset.del);
      if (d.dataset.confirm !== "1") { d.dataset.confirm = "1"; d.textContent = "Click again to delete"; d.classList.add("danger"); return; }
      await D.models.remove(m.file); toast(`Deleted ${m.name}.`); refreshMine();
    }
  }
  $("#openFolder").addEventListener("click", () => D.sys.openModelsFolder());

  // Engine status in the sidebar.
  D.chat.onStatus((s) => {
    state.engine = { state: s.state, file: s.file || null, progress: s.progress, gpu: s.gpu ?? state.engine.gpu, limit: s.limit || "" };
    if (s.state === "ready" && s.file && s.file !== state.lastReady) { state.lastReady = s.file; markUsed(s.file); }
    renderRun();
    const m = state.mine.find((x) => x.file === s.file);
    $("#engineStatus").innerHTML = s.online ? (s.state === "loading" ? "⏳ Connecting to Claude…" : s.limit ? "⛔ Claude plan limit reached" : `☁ Claude ready <span class="muted">(online)</span>`)
      : s.state === "loading" ? `⏳ Loading ${esc(m?.name || "model")}${s.progress ? ` ${Math.round(s.progress * 100)}%` : "…"}`
      : s.state === "ready" ? `🟢 ${esc(m?.name || "Model")} ready` : "No model loaded";
  });

  // ---------- Start ----------
  const factsFor = (id) => { const f = (window.MODEL_FACTS || []).find((x) => x.id === id); if (!f) return {};
    return { use: f.use, about: f.about, released: f.released, paramsLabel: f.params, active: f.active, thinks: f.thinks, extra: f.extra }; };
  for (const m of window.STARTER_MODELS) { Object.assign(m, factsFor(m.id)); m.ramGB = ramFromFile(m.sizeGB); }
  window.__omd = { inferParams, inferTags, fitFor, state };

  (async () => {
    const info = await D.sys.info();
    if (!store.get("ramChosen", false)) {
      state.ram = RAM_OPTIONS.reduce((best, r) => (r <= info.totalRamGB + 1 ? r : best), 8);
    }
    $("#ramGuess").textContent = `(this computer has about ${info.totalRamGB} GB)`;
    renderControls();
    for (const id of await D.downloads.active()) state.dl.set(id, { name: id.split("::")[0], got: 0, total: 0 });
    renderDownloads();
    const cur = await D.chat.current();
    if (cur.state) state.engine = { state: cur.state, file: cur.file, gpu: cur.gpu, limit: cur.limit || "" };
    await refreshMine();
    show(store.get("view", state.mine.length ? "chat" : "find"));
  })();
  renderControls();
  renderGrid();
})();
