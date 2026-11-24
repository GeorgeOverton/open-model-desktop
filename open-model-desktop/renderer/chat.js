// Chat with a downloaded model, fully offline. Conversations are saved on this computer (Saved chats).
(() => {
  "use strict";
  const { $, esc, toast, bus, store } = window.OMD;
  const D = window.desktop;
  const handlers = new Map(); // turnId -> { onText, onThought, onRoute }
  let busy = false;
  let chatFile = store.get("chatModel", "");
  let cur = null;              // the open conversation: { id, title, created, model, modelName, claudeSession, messages: [] }
  let list = [];               // saved chats, newest first
  let filter = "";

  D.chat.onRoute((r) => handlers.get(r.turnId)?.onRoute?.(r));
  D.chat.onChunk((c) => {
    const h = handlers.get(c.turnId); if (!h) return;
    (c.kind === "thought" ? h.onThought : h.onText)?.(c.text);
  });

  // Shared by the Chat screen and Voice mode. convId + history let a saved chat carry on where it left off.
  async function ask({ file, text, systemPrompt, onText, onThought, onRoute, convId, history, claudeSession, fast, files, images }) {
    const turnId = Math.random().toString(36).slice(2);
    handlers.set(turnId, { onText, onThought, onRoute });
    try { return await D.chat.send({ text, file, systemPrompt: systemPrompt || null, turnId, convId: convId || null, history: history || null, claudeSession: claudeSession || null, fast: !!fast, files: !!files, images: images || [] }); }
    finally { handlers.delete(turnId); }
  }
  window.OMDChat = { ask, md: (t) => md(t), stop: () => D.chat.stop(), get busy() { return busy; }, set busy(v) { busy = v; setBusy(v); } };

  // Very small, safe Markdown: code blocks, inline code, bold, line breaks.
  const inline = (p) => esc(p).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/\n/g, "<br>");
  function md(s) { return renderAnswer(s, { files: false, final: true }).html; }

  // ---------- Files the model makes ----------
  // renderer/files.js finds them (forgiving, for small models). The app asks before saving a file on your computer and before
  // opening one that runs code, unless you said "always" (Settings → Saved chats turns that off again).
  // Files go in Documents\Open Model Desktop\<date> <chat title>\.
  // A "host" element (a chat message, or a line in Voice mode) holds: _blocks, _conv, _bm (the saved message), _onChange.
  const F = window.OMDFiles;
  const ICON = (ext) => (ext === "html" ? "🌐" : ext === "csv" || ext === "tsv" ? "📊" : ext === "md" || ext === "txt" ? "📝" : F.runsCode("x." + ext) ? "⚙️" : "📄");
  const errText = (err) => String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
  const setting = (k) => window.OMDSettings?.get()[k];
  function cardHtml(b) {
    const ext = (b.name.split(".").pop() || "").toLowerCase();
    const lines = b.content.split("\n").filter((l, n, a) => l || n < a.length - 1).length;
    const state = !b.done ? " · writing…" : b.path ? ` · <span class="fsaved" title="${esc(b.path)}">saved ✓</span>` : b.declined ? " · not saved" : "";
    const acts = !b.done ? "" : b.path
      ? `<button class="btn sm primary" data-f="open" type="button">Open</button><button class="btn sm" data-f="reveal" type="button" title="Show the file in its folder">Show in folder</button><button class="btn sm" data-f="saveas" type="button">Save as…</button><button class="btn sm" data-f="copy" type="button">Copy</button>`
      : `${b.declined ? `<button class="btn sm" data-f="save" type="button">Save it</button>` : ""}<button class="btn sm" data-f="saveas" type="button">Save as…</button><button class="btn sm" data-f="copy" type="button">Copy</button>`;
    let ask = "";
    if (b.done && b.asking && !b.path) ask = `<div class="fask" role="group" aria-label="Save this file?"><span>💾 Save <b>${esc(b.name)}</b> on this computer? It goes in your Documents folder, in <i>Open Model Desktop</i>.</span>
      <span class="fask-btns"><button class="btn sm primary" data-f="save" type="button">Save</button><button class="btn sm" data-f="always-save" type="button">Always save files</button><button class="btn sm ghost" data-f="decline" type="button">Don't save</button></span></div>`;
    if (b.confirmRun) ask = `<div class="fask warn-box" role="alertdialog" aria-label="Open this program?"><span>⚠️ <b>${esc(b.name)}</b> is a program. Opening it can <b>run it on your computer</b>. Only open it if you trust what it does.</span>
      <span class="fask-btns"><button class="btn sm primary" data-f="run" type="button">Open it</button><button class="btn sm" data-f="always-run" type="button">Always allow</button><button class="btn sm ghost" data-f="norun" type="button">Cancel</button></span></div>`;
    return `<div class="filecard" data-b="${b.i}"><div class="fhead"><span class="ficon" aria-hidden="true">${ICON(ext)}</span>
      <div class="fname"><b>${esc(b.name)}</b><span class="small muted">${esc(F.KIND[ext] || ext.toUpperCase() + " file")} · ${lines} ${lines === 1 ? "line" : "lines"}${state}</span></div>
      <span class="factions">${acts}</span></div>
      ${b.done ? `<div class="fdesc small"><div>${esc(b.desc || "")}</div><div><b>How to use it:</b> ${esc(F.howTo(b.name))}</div></div>` : ""}
      ${ask}
      <details class="fprev" ${b.done ? "" : "open"}><summary>${b.done ? "Show what's inside" : "Writing the file…"}</summary><pre><code>${esc(b.content)}</code></pre></details></div>`;
  }
  function renderAnswer(text, opts = {}) {
    const { parts, blocks } = F.parse(text, opts);
    const declined = opts.declined || [];
    for (const b of blocks) if (b.name && b.done) {
      b.desc = F.describe(b, opts.request);
      b.content = F.withNote(b, opts.request);   // what it is and how to run it, at the top of code files
      if (!b.path) { b.declined = declined.includes(b.i); b.asking = !b.declined && !!opts.final; }
    }
    let html = "";
    parts.forEach((p, k) => {
      if (p.t === "text") {
        let s = p.s;
        if (k > 0) s = s.replace(/^\s*\n/, "");
        if (k < parts.length - 1) s = s.replace(/\n\s*$/, "");
        if (s.trim()) html += inline(s);
        return;
      }
      const b = p.b;
      html += b.name ? cardHtml(b)
        : `<div class="codeblock" data-b="${b.i}"><pre><code>${esc(b.content)}</code></pre>${b.done ? `<span class="cbar"><button class="cbtn2" data-f="copy" type="button">Copy</button><button class="cbtn2" data-f="saveas" type="button">Save as file</button></span>` : ""}</div>`;
    });
    return { html, blocks };
  }
  // Making files can be off for everyone (Settings) or for one model (My models → ⚙️).
  const filesOn = (file) => setting("makeFiles") !== false && (!file || window.OMD.perms(file).save);
  const mayRun = (host) => window.OMD.perms(host._bm?.model || "").run;
  // Show an answer in el; host keeps the blocks so the buttons work.
  function showIn(host, el, text, opts = {}) {
    const bm = opts.bm || host._bm;
    const r = renderAnswer(text, { files: filesOn(bm?.model), saved: bm?.files || [], declined: bm?.declined || [], ...opts });
    el.innerHTML = r.html;
    host.classList.add("fhost");
    host._blocks = r.blocks; host._el = el;
    if (opts.conv) host._conv = opts.conv;
    if (bm) host._bm = bm;
    if (opts.onChange) host._onChange = opts.onChange;
    return r.blocks;
  }
  const showAnswer = (el, text, opts = {}) => showIn(el.closest(".msg"), el, text, { conv: cur, ...opts });
  const redraw = (host, b) => { const card = host._el?.querySelector(`.filecard[data-b="${b.i}"]`); if (card) card.outerHTML = cardHtml(b); };
  // Names of the files made earlier in a conversation (before message index `upto`).
  const earlierNames = (conv, upto = Infinity) => (conv?.messages || []).slice(0, upto).flatMap((m) => (m.files || []).map((f) => f.name));
  async function saveBlock(host, b) {
    const c = host._conv || {};
    b.path = await D.files.write({ chatId: c.id || "unsaved", title: c.title || "", name: b.name, content: b.content });
    b.asking = false; b.declined = false;
    const bm = host._bm;
    if (bm) {
      bm.files = [...(bm.files || []).filter((f) => f.b !== b.i), { name: b.name, path: b.path, b: b.i, ...(b.whole ? { whole: true } : {}) }];
      bm.declined = (bm.declined || []).filter((x) => x !== b.i);
    }
    redraw(host, b);
    return b.path;
  }
  // After an answer finishes: save its files straight away if you said "always", otherwise each card asks.
  // Returns the files, so Voice mode can say what it made.
  async function finishFiles(host) {
    const named = (host._blocks || []).filter((b) => b.name && b.done);
    if (!named.length) return [];
    if (setting("filesAutoSave")) {
      for (const b of named) { try { await saveBlock(host, b); } catch (err) { toast("Couldn't save " + b.name + ": " + errText(err), 5000); } }
      host._onChange?.();
    }
    return named;
  }
  async function openBlock(host, b, how) {
    if (!b.path) await saveBlock(host, b);
    if (how === "open") await D.files.open(b.path); else await D.files.reveal(b.path);
  }
  document.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-f]"); if (!btn) return;
    const host = btn.closest(".fhost"), holder = btn.closest("[data-b]");
    const b = host?._blocks?.[+holder?.dataset.b]; if (!b) return;
    const name = b.name || `snippet.${F.extOf(b.lang, b.content, "")}`;
    const f = btn.dataset.f;
    try {
      if (f === "copy") { await D.sys.copy(b.content); toast("Copied."); }
      else if (f === "saveas") { const p = await D.files.saveAs({ name, content: b.content }); if (p) toast("Saved to " + p, 4000); }
      else if (f === "save" || f === "always-save") {
        if (f === "always-save") { await window.OMDSettings.save({ filesAutoSave: true }); toast("Files will be saved without asking. You can change this in Settings → Saved chats.", 5000); }
        await saveBlock(host, b);
        // "Always" also saves the other files in the same answer that are still waiting.
        if (f === "always-save") for (const x of host._blocks) if (x.name && x.done && !x.path && x.asking) await saveBlock(host, x);
        host._onChange?.();
      } else if (f === "decline") {
        b.asking = false; b.declined = true;
        if (host._bm) host._bm.declined = [...new Set([...(host._bm.declined || []), b.i])];
        redraw(host, b); host._onChange?.();
      } else if ((f === "open" || f === "run" || f === "always-run") && F.runsCode(name) && !mayRun(host)) {
        toast(`${window.OMD.nameOf(host._bm?.model) || "This model"} isn't allowed to open programs, so here's the file in its folder instead. You can change that in My models (⚙️ on its card).`, 6500);
        await openBlock(host, b, "reveal");
      } else if (f === "open") {
        if (F.runsCode(name) && !setting("filesAutoRun")) { b.confirmRun = true; redraw(host, b); host._el.querySelector(`.filecard[data-b="${b.i}"] [data-f=run]`)?.focus(); return; }
        await openBlock(host, b, "open");
      } else if (f === "run" || f === "always-run") {
        if (f === "always-run") { await window.OMDSettings.save({ filesAutoRun: true }); toast("Programs will open without asking. You can change this in Settings → Saved chats.", 5000); }
        b.confirmRun = false; redraw(host, b);
        await openBlock(host, b, "open");
      } else if (f === "norun") { b.confirmRun = false; redraw(host, b); }
      else if (f === "reveal") await openBlock(host, b, "reveal");
    } catch (err) { toast("Couldn't do that: " + errText(err), 5000); }
  });
  window.OMDChat.files = { showIn, finishFiles, earlierNames, filesOn };

  // ---------- Model picker ----------
  function fillModels() {
    const sel = $("#chatModel");
    const mine = window.OMD.chatChoices;
    if (chatFile && !mine.some((m) => m.file === chatFile)) chatFile = "";
    if (!chatFile && mine[0]) chatFile = (mine.find((m) => !m.auto) || mine[0]).file;
    const opt = (m) => `<option value="${esc(m.file)}" ${m.file === chatFile ? "selected" : ""}>${esc(m.name)} (${esc(m.quant || "")})</option>`;
    const autos = mine.filter((m) => m.auto), rest = mine.filter((m) => !m.auto);
    sel.innerHTML = mine.length ? (autos.length ? `<optgroup label="Let the app choose">${autos.map(opt).join("")}</optgroup><optgroup label="Your models">${rest.map(opt).join("")}</optgroup>` : rest.map(opt).join(""))
      : `<option value="">No models downloaded yet</option>`;
    if (!cur) showEmpty();
  }
  function showEmpty() {
    const mine = window.OMD.chatChoices;
    $("#messages").innerHTML = mine.length ? ""
      : `<div class="empty">Download a model first from <button class="linkish" data-goto="find">Find models</button>. Then come back here to chat. No internet needed after that.</div>`;
  }
  bus.addEventListener("models", fillModels);
  fillModels();
  $("#messages").addEventListener("click", (e) => { const g = e.target.closest("[data-goto]"); if (g) window.OMD.show(g.dataset.goto); });
  // Changing the model keeps the conversation: the new model is given the earlier messages.
  $("#chatModel").addEventListener("change", (e) => { chatFile = e.target.value; store.set("chatModel", chatFile); });

  function newChat() {
    if (busy) D.chat.stop();
    cur = null; showEmpty(); D.chat.reset(null); renderList();
    $("#chatList").classList.remove("open");
    $("#prompt").focus();
  }
  $("#newChat").addEventListener("click", newChat);
  $("#newChat2").addEventListener("click", newChat);
  bus.addEventListener("chatWith", (e) => { chatFile = e.detail; store.set("chatModel", chatFile); fillModels(); newChat(); setTimeout(() => $("#prompt").focus(), 50); });

  // ---------- Messages ----------
  function addEl(role, html) {
    const el = document.createElement("div");
    el.className = "msg " + role;
    el.innerHTML = html;
    $("#messages").appendChild(el);
    el.scrollIntoView({ block: "end" });
    return el;
  }
  const userEl = (text, att) => addEl("user", (att?.length ? `<div class="achips">${att.map((a) => chipHtml(a, false)).join("")}</div>` : "") + esc(text).replace(/\n/g, "<br>"));
  const voiceById = (id) => window.Speaker.VOICES?.find((v) => v.id === id) || window.Speaker.defaultVoice;
  function botEl(m, ctx = {}) {
    const v = voiceById(m.voice);
    // The model's own icon and name, so you can see which model answered (several can be running).
    const file = m.model || cur?.model || "";
    const name = window.OMD.nameOf(file) || m.who || v.name;
    const extra = m.who && m.who !== name ? m.who : "";
    const el = addEl("bot", `<div class="who"><span class="wicon">${window.OMD.modelIcon(file)}</span><b class="wname">${esc(name)}</b><span class="small muted mname">${esc(extra)}</span>
      <button class="spk" type="button" title="Read this answer out loud in ${esc(v.name)}'s voice" aria-label="Read aloud" hidden>🔊</button></div><details class="thinking" ${m.thought ? "" : "hidden"}><summary>${m.thought ? "Show its thinking" : "Thinking…"}</summary><div class="tbody">${m.thought ? md(m.thought) : ""}</div></details><div class="answer">${
        m.error ? `<span class="err">${esc(m.error)}</span>` : m.pending ? `<span class="dots">●●●</span>` : m.text ? "" : `<span class="muted">(stopped)</span>`}</div>`);
    if (m.text && !m.error) showAnswer(el.querySelector(".answer"), m.text, { request: ctx.request || "", final: true, bm: m, earlier: ctx.earlier || [], conv: cur, onChange: () => persist(cur) });
    el.querySelector(".spk").addEventListener("click", () => { window.Speaker.stop(); window.Speaker.sayAll(el._text ?? m.text, v.id); });
    if (m.text) el.querySelector(".spk").hidden = false;
    return el;
  }
  function setBusy(v) {
    busy = v;
    $("#sendBtn").hidden = v; $("#stopBtn").hidden = !v;
  }

  // ---------- Saving ----------
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const titleFrom = (text) => { const t = text.replace(/\s+/g, " ").trim(); return t.length > 60 ? t.slice(0, 57).replace(/\s+\S*$/, "") + "…" : t; };
  const saving = () => window.OMDSettings?.get().saveChats !== false;
  async function persist(conv = cur) {
    if (!conv || !saving()) return;
    try {
      const s = await D.chats.save({ id: conv.id, title: conv.title, model: conv.model, modelName: conv.modelName, claudeSession: conv.claudeSession || null,
        messages: conv.messages.map(({ pending, ...m }) => m) });
      if (s) { list = [s, ...list.filter((c) => c.id !== s.id)]; renderList(); }
    } catch (err) { console.warn("Couldn't save chat:", err); }
  }
  // Earlier messages to hand to the model, so a reopened chat (or a different model) knows what was said.
  const historyOf = (msgs) => msgs.filter((m) => !m.error && !m.pending && (m.ctx || m.text)).map((m) => ({ role: m.role === "user" ? "user" : "bot", text: m.ctx || m.text }));

  // ---------- Saved chats list ----------
  const DAY = 86400000;
  function groupOf(t) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    if (t >= +today) return "Today";
    if (t >= +today - DAY) return "Yesterday";
    if (t >= +today - 7 * DAY) return "Previous 7 days";
    if (t >= +today - 30 * DAY) return "Previous 30 days";
    return "Older";
  }
  function renderList() {
    const box = $("#chatItems");
    if (!saving()) { box.innerHTML = `<p class="small muted">Saving chats is off. Turn it on in <button class="linkish" data-goto="settings">Settings</button>.</p>`; return; }
    const q = filter.toLowerCase();
    const shown = q ? list.filter((c) => (c.title + " " + (c.body || "")).toLowerCase().includes(q)) : list;
    if (!list.length) { box.innerHTML = `<p class="small muted">Your chats will appear here.</p>`; return; }
    if (!shown.length) { box.innerHTML = `<p class="small muted">No chats match "${esc(filter)}".</p>`; return; }
    let last = "", html = "";
    for (const c of shown) {
      const g = groupOf(c.updated);
      if (g !== last) { html += `<h3 class="clgroup">${g}</h3>`; last = g; }
      html += `<div class="citem ${cur?.id === c.id ? "on" : ""}" data-id="${esc(c.id)}">
        <button class="copen" type="button" title="${esc(c.title)}"><span class="ctitle">${esc(c.title)}</span><span class="small muted cmeta">${esc(c.modelName || "")}</span></button>
        <span class="cacts"><button class="cbtn" data-act="rename" type="button" title="Rename" aria-label="Rename ${esc(c.title)}">✎</button><button class="cbtn" data-act="delete" type="button" title="Delete" aria-label="Delete ${esc(c.title)}">🗑</button></span></div>`;
    }
    box.innerHTML = html;
  }
  async function loadList() { try { list = await D.chats.list(); } catch { list = []; } renderList(); }

  async function openChat(id) {
    if (busy) { toast("Wait for the answer to finish (or press Stop) first."); return; }
    const c = await D.chats.get(id);
    if (!c) { toast("That chat couldn't be found. It may have been deleted."); return loadList(); }
    cur = { ...c, messages: c.messages || [] };
    $("#messages").innerHTML = "";
    let request = "";
    cur.messages.forEach((m, k) => { if (m.role === "user") { request = m.text; userEl(m.text, m.attach); } else botEl(m, { request, earlier: earlierNames(cur, k) }); });
    const mine = window.OMD.chatChoices;
    if (c.model && mine.some((m) => m.file === c.model)) { chatFile = c.model; store.set("chatModel", chatFile); fillModels(); }
    else if (c.model) toast(`${c.modelName || "The model this chat used"} isn't available now, so it will carry on with the model picked at the top.`, 5000);
    renderList();
    $("#chatList").classList.remove("open");
    $("#messages").lastElementChild?.scrollIntoView({ block: "end" });
    $("#prompt").focus();
  }

  $("#chatItems").addEventListener("click", async (e) => {
    const g = e.target.closest("[data-goto]"); if (g) return window.OMD.show(g.dataset.goto);
    const item = e.target.closest(".citem"); if (!item) return;
    const id = item.dataset.id, c = list.find((x) => x.id === id);
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "rename") return startRename(item, c);
    if (act === "delete") {
      item.classList.add("confirm");
      item.innerHTML = `<span class="small">Delete "${esc(c.title)}"?</span><span class="cacts show"><button class="btn sm danger" data-act="yes" type="button">Delete</button><button class="btn sm" data-act="no" type="button">Keep</button></span>`;
      item.querySelector("[data-act=no]").focus();
      return;
    }
    if (act === "no") return renderList();
    if (act === "yes") {
      await D.chats.remove(id);
      list = list.filter((x) => x.id !== id);
      if (cur?.id === id) newChat(); else renderList();
      return toast("Chat deleted.");
    }
    if (e.target.closest(".copen")) openChat(id);
  });
  $("#chatItems").addEventListener("dblclick", (e) => { const item = e.target.closest(".citem"); if (item && !item.classList.contains("confirm")) startRename(item, list.find((x) => x.id === item.dataset.id)); });
  function startRename(item, c) {
    item.innerHTML = `<input class="crename" value="${esc(c.title)}" aria-label="Chat name" maxlength="120">`;
    const inp = item.querySelector("input"); inp.focus(); inp.select();
    let done = false;
    const finish = async (keep) => {
      if (done) return; done = true;
      const t = inp.value.trim();
      if (keep && t && t !== c.title) {
        const s = await D.chats.rename(c.id, t);
        if (s) { list = list.map((x) => (x.id === s.id ? { ...x, title: s.title } : x)); if (cur?.id === s.id) cur.title = s.title; }
      }
      renderList();
    };
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); finish(true); } if (e.key === "Escape") finish(false); });
    inp.addEventListener("blur", () => finish(true));
  }
  $("#chatSearch").addEventListener("input", (e) => { filter = e.target.value.trim(); renderList(); });
  $("#chatsToggle").addEventListener("click", (e) => { e.stopPropagation(); $("#chatList").classList.toggle("open"); });
  document.querySelector("#view-chat .chatmain").addEventListener("click", () => $("#chatList").classList.remove("open"));   // narrow window: tap the chat to hide the list
  bus.addEventListener("settings", () => { loadList(); });
  bus.addEventListener("chatsChanged", () => { if (cur && !list.length) cur = null; loadList(); });
  loadList();

  // ---------- Sending ----------
  const prompt = $("#prompt");
  prompt.addEventListener("input", () => { prompt.style.height = "auto"; prompt.style.height = Math.min(200, prompt.scrollHeight) + "px"; });
  prompt.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("#composer").requestSubmit(); } });
  $("#stopBtn").addEventListener("click", () => { D.chat.stop(); window.Speaker.stop(); });

  // ---------- Files and pictures you add (📎, drag and drop, or paste) ----------
  // The app asks first (Settings → Saved chats: "Files you add"). Documents are read on this computer and their text is given
  // to the model. Pictures go to models that can see them (Claude); other models are told they can't.
  let attached = [];           // { id, name, kind: "text" | "image", text, mime, data, thumb, size }
  let allowedThisTime = false;
  const MB = 1e6;
  const canSee = (file) => file === "@claude";
  const chatName = () => window.OMD.nameOf(chatFile) || "This model";
  async function mayAddFiles() {
    const a = setting("fileAccess") || "ask";
    if (a === "always" || allowedThisTime) return true;
    if (a === "never") { toast("Adding files is turned off. You can turn it on in Settings → Saved chats.", 5000); return false; }
    const r = await window.OMD.askDialog({
      title: "Let the app read files you add?",
      html: `<p>To use a file in a chat, the app opens it on this computer and gives what's in it to the model you're chatting with.</p>
        <p class="small muted">Local models never send it anywhere. If you're chatting with Claude, the file goes to Claude online with your message.</p>`,
      yes: "Allow", no: "Don't allow", remember: true });
    if (r.remember) await window.OMDSettings.save({ fileAccess: r.yes ? "always" : "never" });
    if (r.yes) allowedThisTime = true;
    if (!r.yes) toast(r.remember ? "Files won't be added. You can change that in Settings → Saved chats." : "The file wasn't added.", 4500);
    return r.yes;
  }
  const readAs = (file, how) => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => rej(fr.error); fr[how](file); });
  const loadImg = (src) => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error("This picture couldn't be opened.")); im.src = src; });
  function shrink(im, max, type = "image/jpeg") {
    const k = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight));
    const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(im.naturalWidth * k)); c.height = Math.max(1, Math.round(im.naturalHeight * k));
    const g = c.getContext("2d"); if (type === "image/jpeg") { g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); }
    g.drawImage(im, 0, 0, c.width, c.height);
    return c.toDataURL(type, 0.88);
  }
  async function readOne(file) {
    if (file.size > 40 * MB) throw new Error("it's bigger than 40 MB");
    const ext = (file.name.split(".").pop() || "").toLowerCase();
    if (/^(png|jpe?g|gif|webp|bmp)$/.test(ext) || /^image\//.test(file.type)) {
      let url = await readAs(file, "readAsDataURL");
      const im = await loadImg(url);
      // Claude takes PNG, JPEG, GIF and WebP up to about 5 MB: make big or unusual pictures smaller.
      if (ext === "bmp" || !/^data:image\/(png|jpeg|gif|webp)/.test(url) || file.size > 3.5 * MB || Math.max(im.naturalWidth, im.naturalHeight) > 2000) url = shrink(im, 1600);
      const [, mime, data] = url.match(/^data:([^;]+);base64,(.*)$/);
      return { kind: "image", mime, data, thumb: shrink(im, 160) };
    }
    const r = await D.files.read({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
    if (r.kind === "image") throw new Error("this picture couldn't be opened");
    if (!r.text.trim()) throw new Error("there's no text in it");
    return { kind: "text", text: r.text };
  }
  async function addFiles(files, { photo = false } = {}) {
    files = [...files].filter((f) => f && f.name !== undefined);
    if (!files.length) return;
    if (busy) { toast("Wait for the answer to finish first."); return; }
    if (!chatFile) { toast("Download a model first, then pick it at the top."); return; }
    if (!window.OMD.perms(chatFile).upload) { toast(`${chatName()} isn't allowed to read files you add. You can change that in My models (⚙️ on its card), or pick another model.`, 6000); return; }
    if (!photo && !(await mayAddFiles())) return;   // a photo you just took was already asked about (camera)
    if (attached.length + files.length > 10) { toast("You can add up to 10 files to one message."); files = files.slice(0, Math.max(0, 10 - attached.length)); }
    const pics = [];
    for (const f of files) {
      const id = Math.random().toString(36).slice(2);
      const item = { id, name: f.name || "picture.png", size: f.size, reading: true };
      attached.push(item); renderChips();
      try { Object.assign(item, await readOne(f)); delete item.reading; if (item.kind === "image") pics.push(item); }
      catch (err) { attached = attached.filter((x) => x.id !== id); toast(`Couldn't add ${item.name}: ${errText(err)}`, 6000); }
      renderChips();
    }
    if (pics.length && !canSee(chatFile)) toast(`${chatName()} can't see pictures, so it will only be told you added ${pics.length === 1 ? "one" : "them"}. Claude can see pictures: pick it at the top.`, 7000);
    prompt.focus();
  }
  function chipHtml(a, removable) {
    const icon = a.kind === "image" ? (a.thumb ? `<img src="${esc(a.thumb)}" alt="">` : "🖼️") : /\.pdf$/i.test(a.name) ? "📕" : /\.(xlsx?|csv|ods)$/i.test(a.name) ? "📊" : /\.(pptx?|odp)$/i.test(a.name) ? "📽️" : "📄";
    const sub = a.reading ? "Reading…" : a.kind === "image" ? "Picture" : `${(a.chars ?? a.text?.length ?? 0).toLocaleString()} characters${a.cut ? " (cut short)" : ""}`;
    return `<span class="achip ${a.kind || ""}" title="${esc(a.name)}"><span class="aic">${icon}</span><span class="atx"><b>${esc(a.name)}</b><span class="small muted">${esc(sub)}</span></span>${
      removable ? `<button type="button" class="ax" data-unattach="${esc(a.id)}" aria-label="Remove ${esc(a.name)}" title="Remove">×</button>` : ""}</span>`;
  }
  function renderChips() {
    const row = $("#attachRow");
    row.hidden = !attached.length;
    row.innerHTML = attached.map((a) => chipHtml(a, true)).join("");
  }
  $("#attachRow").addEventListener("click", (e) => { const x = e.target.closest("[data-unattach]"); if (x) { attached = attached.filter((a) => a.id !== x.dataset.unattach); renderChips(); prompt.focus(); } });
  $("#attachBtn").addEventListener("click", () => {
    const open = amenu.hidden; amenu.hidden = !open; $("#attachBtn").setAttribute("aria-expanded", String(open));
    if (open) amenu.querySelector("button").focus();
  });
  // ---------- Taking a photo (📎 → Take a photo) ----------
  // Asks first (Settings → Saved chats: "Camera"), like adding files. The photo is added like any picture.
  let camAllowedThisTime = false;
  async function mayUseCamera() {
    const a = setting("cameraAccess") || "ask";
    if (a === "never") { toast("Using the camera is turned off. You can turn it on in Settings → Saved chats.", 5000); return false; }
    if (a !== "always" && !camAllowedThisTime) {
      const r = await window.OMD.askDialog({ title: "Let the app use your camera?",
        html: `<p>The app turns on your camera so you can take a photo to show the model. The camera turns off as soon as you take the photo or close the window.</p>
          <p class="small muted">Nothing is recorded. The photo stays on this computer unless you send it to Claude.</p>`, yes: "Allow", no: "Don't allow", remember: true });
      if (r.remember) await window.OMDSettings.save({ cameraAccess: r.yes ? "always" : "never" });
      if (!r.yes) { toast(r.remember ? "The camera won't be used. You can change that in Settings → Saved chats." : "The camera wasn't turned on.", 4500); return false; }
      camAllowedThisTime = true;
    }
    return (await D.sys.allowCamera(true)) !== false || (toast("Your computer didn't allow the camera. Check its privacy settings.", 6000), false);
  }
  const cam = { dlg: $("#camDlg"), stream: null, shot: null };
  function camStop() { cam.stream?.getTracks().forEach((t) => t.stop()); cam.stream = null; }
  async function camStart(deviceId) {
    camStop();
    const v = $("#camVideo"), msg = $("#camMsg");
    msg.textContent = "Starting the camera…"; msg.hidden = false; v.hidden = true;
    try {
      cam.stream = await navigator.mediaDevices.getUserMedia({ video: deviceId ? { deviceId: { exact: deviceId }, width: { ideal: 1600 } } : { width: { ideal: 1600 }, height: { ideal: 1200 } }, audio: false });
      v.srcObject = cam.stream; await v.play().catch(() => {});
      msg.hidden = true; v.hidden = false;
      const cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput");
      const cur = cam.stream.getVideoTracks()[0]?.getSettings().deviceId;
      $("#camPick").hidden = cams.length < 2;
      $("#camPick").innerHTML = cams.map((d, k) => `<option value="${esc(d.deviceId)}" ${d.deviceId === cur ? "selected" : ""}>${esc(d.label || "Camera " + (k + 1))}</option>`).join("");
      $("#camTake").disabled = false;
    } catch (err) {
      $("#camTake").disabled = true;
      msg.textContent = /NotFound|DevicesNotFound|OverconstrainedError/.test(err.name) ? "No camera was found. Plug one in, or check it isn't switched off."
        : /NotAllowed|Permission/.test(err.name) ? "The camera isn't allowed. On Windows: Settings → Privacy & security → Camera, and let desktop apps use it."
        : /NotReadable|TrackStart/.test(err.name) ? "The camera is busy. Close other apps that use it (like Teams or Zoom) and try again."
        : "Couldn't start the camera: " + err.message;
    }
  }
  function camShow(state) {   // "live" or "shot"
    $("#camVideo").hidden = state !== "live" || !cam.stream; $("#camShot").hidden = state !== "shot";
    $("#camTake").hidden = state !== "live"; $("#camRetake").hidden = $("#camUse").hidden = state !== "shot";
  }
  async function takePhoto() {
    if (!chatFile) return toast("Download a model first, then pick it at the top.");
    if (!window.OMD.perms(chatFile).upload) return toast(`${chatName()} isn't allowed to see pictures you add. You can change that in My models (⚙️ on its card), or pick another model.`, 6000);
    if (busy) return toast("Wait for the answer to finish first.");
    if (!(await mayUseCamera())) return;
    cam.shot = null; camShow("live"); cam.dlg.showModal();
    await camStart();
    $("#camTake").focus();
  }
  $("#camPick").addEventListener("change", (e) => camStart(e.target.value));
  $("#camTake").addEventListener("click", () => {
    const v = $("#camVideo"); if (!v.videoWidth) return;
    const c = document.createElement("canvas"); c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext("2d").drawImage(v, 0, 0);
    c.toBlob((b) => { cam.shot = b; $("#camShot").src = URL.createObjectURL(b); camShow("shot"); $("#camUse").focus(); }, "image/jpeg", 0.9);
  });
  $("#camRetake").addEventListener("click", () => { cam.shot = null; camShow("live"); });
  $("#camUse").addEventListener("click", async () => {
    const b = cam.shot; cam.dlg.close();
    if (!b) return;
    const d = new Date(), name = `photo-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}-${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}.jpg`;
    await addFiles([new File([b], name, { type: "image/jpeg" })], { photo: true });
  });
  $("#camCancel").addEventListener("click", () => cam.dlg.close());
  cam.dlg.addEventListener("close", () => { camStop(); D.sys.allowCamera(false); if ($("#camShot").src) URL.revokeObjectURL($("#camShot").src); $("#camShot").removeAttribute("src"); });

  // 📎 opens a small menu: files from this computer, or a photo.
  const amenu = $("#attachMenu");
  const closeMenu = () => { amenu.hidden = true; $("#attachBtn").setAttribute("aria-expanded", "false"); };
  document.addEventListener("click", (e) => { if (!amenu.hidden && !e.target.closest("#attachMenu, #attachBtn")) closeMenu(); });
  amenu.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeMenu(); $("#attachBtn").focus(); } });
  amenu.addEventListener("click", async (e) => {
    const m = e.target.closest("[data-am]")?.dataset.am; if (!m) return;
    closeMenu();
    if (m === "photo") return takePhoto();
    if (!chatFile) return toast("Download a model first, then pick it at the top.");
    if (!window.OMD.perms(chatFile).upload) return toast(`${chatName()} isn't allowed to read files you add. You can change that in My models (⚙️ on its card), or pick another model.`, 6000);
    if (await mayAddFiles()) $("#attachInput").click();
  });

  $("#attachInput").addEventListener("change", (e) => { const f = [...e.target.files]; e.target.value = ""; addFiles(f); });
  const main = document.querySelector("#view-chat .chatmain"), zone = $("#dropZone");
  let dragDepth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes("Files");
  main.addEventListener("dragenter", (e) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; zone.hidden = false; });
  main.addEventListener("dragover", (e) => { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; } });
  main.addEventListener("dragleave", () => { if (--dragDepth <= 0) { dragDepth = 0; zone.hidden = true; } });
  main.addEventListener("drop", (e) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth = 0; zone.hidden = true; addFiles(e.dataTransfer.files); });
  document.addEventListener("dragover", (e) => { if (hasFiles(e)) e.preventDefault(); });   // a file dropped outside the chat mustn't open in the window
  document.addEventListener("drop", (e) => { if (hasFiles(e)) e.preventDefault(); });
  prompt.addEventListener("paste", (e) => { const f = [...(e.clipboardData?.files || [])]; if (f.length) { e.preventDefault(); addFiles(f); } });
  // The message the model gets: what you typed plus the text of each file (kept within what the model can take).
  function compose(text, list, file) {
    const docs = list.filter((a) => a.kind === "text"), pics = list.filter((a) => a.kind === "image");
    let room = canSee(file) ? 100000 : 12000;
    const parts = [];
    for (const a of docs) {
      const share = Math.max(1500, Math.floor(room / Math.max(1, docs.length - parts.length)));
      let t = a.text; a.chars = t.length;
      if (t.length > share) { t = t.slice(0, share); a.cut = true; }
      room -= t.length;
      parts.push(`Attached file "${a.name}"${a.cut ? ` (only the first ${t.length.toLocaleString()} of ${a.chars.toLocaleString()} characters, because it's long)` : ""}:\n"""\n${t}\n"""`);
    }
    if (pics.length && !canSee(file)) parts.push(`[The user also added ${pics.length === 1 ? `a picture (${pics[0].name})` : `${pics.length} pictures (${pics.map((p) => p.name).join(", ")})`}, but you can't see pictures. Say so in one short sentence, and mention that Claude can see pictures.]`);
    const ask = text || (docs.length ? `Please read ${docs.length === 1 ? "this file" : "these files"}, and tell me briefly what ${docs.length === 1 ? "it's" : "they're"} about.` : "What's in this picture?");
    return { ctx: parts.length ? parts.join("\n\n") + "\n\n" + ask : ask, images: canSee(file) ? pics.map((p) => ({ mime: p.mime, data: p.data })) : [] };
  }


  // ---------- Talking in Chat: press 🎤, speak, and it sends what you said; the answer is read out and saved like any chat ----------
  let talk = null;
  const micBtn = $("#micBtn"), micState = (t) => { $("#micState").textContent = t; };
  const LISTENING = "🎤 Listening… just talk, and it sends when you pause. Press 🎤 again (or Esc) to stop.";
  async function startTalk() {
    if (chatFile && !window.OMD.perms(chatFile).mic) { toast(`${chatName()} isn't allowed to be talked to with the microphone. You can change that in My models (⚙️ on its card).`, 6000); return; }
    micBtn.disabled = true;
    try {
      const l = await window.OMDVoice.listen({
        hint: micState,
        paused: () => busy || window.Speaker.speaking,
        onPartial: (t) => { prompt.value = t; micState("Hearing: " + t); },
        onFinal: (t) => { prompt.value = t.charAt(0).toUpperCase() + t.slice(1); micState("Sending…"); $("#composer").requestSubmit(); },
      });
      if (!l) return;
      talk = l; micBtn.setAttribute("aria-pressed", "true"); micBtn.title = "Stop talking"; micState(LISTENING);
    } catch (err) {
      toast(err.needPack ? "To talk in Chat, first download the speech pack (about 40 MB) on the Voice page." : "Couldn't start the microphone: " + errText(err), 6000);
      micState("");
    } finally { micBtn.disabled = false; }
  }
  function stopTalk() { talk?.stop(); talk = null; micBtn.setAttribute("aria-pressed", "false"); micBtn.title = "Talk instead of typing"; micState(""); }
  micBtn.addEventListener("click", () => (talk ? stopTalk() : startTalk()));
  bus.addEventListener("micTaken", stopTalk);
  bus.addEventListener("micOff", stopTalk);
  bus.addEventListener("view", (e) => { if (e.detail !== "chat" && talk) stopTalk(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && talk && !document.querySelector("dialog[open]")) { window.Speaker.stop(); stopTalk(); } });
  window.Speaker.onIdle(() => { if (talk && !busy) micState(LISTENING); });

  $("#composer").addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = prompt.value.trim();
    if ((!text && !attached.length) || busy) return;
    if (!chatFile) { toast("Download a model first, then pick it at the top."); return; }
    if (attached.some((a) => a.reading)) { toast("Still reading your files…"); return; }
    if (attached.length && !window.OMD.perms(chatFile).upload) { toast(`${chatName()} isn't allowed to read files you add. Remove them, or change that in My models (⚙️ on its card).`, 6000); return; }
    const att = attached; attached = []; renderChips();
    const { ctx, images } = compose(text, att, chatFile);
    prompt.value = ""; prompt.style.height = "auto";
    if ($("#messages .empty")) $("#messages").innerHTML = "";
    const mm = window.OMD.chatChoices.find((m) => m.file === chatFile) || {};
    const modelName = (mm.modelName || mm.name || "") + (mm.online ? " · online" : "");
    if (!cur) cur = { id: newId(), title: titleFrom(text || att.map((a) => a.name).join(", ")), created: Date.now(), messages: [] };
    const conv = cur;   // keep hold of it, in case "New chat" is pressed while this answer is coming in
    const history = historyOf(cur.messages), earlier = earlierNames(cur);
    cur.model = chatFile; cur.modelName = mm.name || modelName;
    const v = window.Speaker.defaultVoice;
    const spoken = !!talk;                       // asked out loud with the 🎤 button
    const um = { role: "user", text, at: Date.now(), ...(spoken ? { voice: true } : {}),
      ...(att.length ? { ctx, attach: att.map((a) => ({ name: a.name, kind: a.kind, ...(a.kind === "text" ? { chars: a.chars, ...(a.cut ? { cut: true } : {}) } : { thumb: a.thumb }) })) } : {}) };
    const speech = spoken || window.OMDSettings?.get().speakChat ? window.Speaker.stream(v.id) : null;
    if (spoken) micState("Thinking…");
    const bm = { role: "bot", text: "", thought: "", who: modelName, voice: v.id, model: chatFile, pending: true };
    cur.messages.push(um, bm);
    userEl(text, um.attach);
    const bot = botEl(bm);
    persist();
    const ans = bot.querySelector(".answer"), th = bot.querySelector(".thinking"), who = bot.querySelector(".mname");
    setBusy(true);
    try {
      const r = await ask({
        file: chatFile, text: ctx, images, convId: conv.id, history, claudeSession: conv.claudeSession, files: filesOn(chatFile), fast: spoken,
        onText: (t) => { bm.text += t; showAnswer(ans, bm.text, { request: text, earlier, bm, conv }); bot.scrollIntoView({ block: "end" }); speech?.push(bm.text); if (spoken) micState("Answering…"); },
        onRoute: (r) => { bm.who = `✨ Optimal picked it · for ${r.taskLabel}${r.fits ? "" : ` (nothing fits ${r.tierGB} GB, so the smallest)`}`; who.textContent = bm.who;
          if (r.file) { bm.model = r.file; bot.querySelector(".wicon").innerHTML = window.OMD.modelIcon(r.file); bot.querySelector(".wname").textContent = window.OMD.nameOf(r.file) || r.name; } },
        onThought: (t) => { bm.thought += t; th.hidden = false; th.querySelector(".tbody").innerHTML = md(bm.thought); },
      });
      if (bm.thought) th.querySelector("summary").textContent = "Show its thinking";
      if (r && r.plan && !r.stopped) { bm.who = `${r.model} · your Pro plan`; who.textContent = bm.who; }
      if (r && r.session) conv.claudeSession = r.session;
      // Claude may send its whole answer only at the end (older Claude Code).
      if (r && r.text && !bm.text) bm.text = r.text;
      if (bm.text) {
        // Finished: an unclosed last code block counts as done, and a file asked for in plain text becomes a file.
        speech?.end(bm.text);
        showAnswer(ans, bm.text, { request: text, final: true, earlier, bm, conv, onChange: () => persist(conv) });
        const made = await finishFiles(bot);
        if (speech && made.length) window.Speaker.say(made.every((b) => b.path) ? `I've saved the ${made.length === 1 ? "file" : "files"} in your Documents folder.` : `I've made ${made.length === 1 ? "a file" : "some files"}. Press Save if you want to keep ${made.length === 1 ? "it" : "them"}.`, v.id);
      }
      if (bm.text) {
        bot._text = bm.text; bot.querySelector(".spk").hidden = false;
      } else { bm.stopped = true; ans.innerHTML = `<span class="muted">(stopped)</span>`; }
    } catch (err) {
      bm.error = String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
      ans.innerHTML = `<span class="err">${esc(bm.error)}</span>`;
    } finally {
      delete bm.pending;
      setBusy(false);
      persist(conv);
      if (talk) micState(window.Speaker.speaking ? "🔊 Speaking… (Esc to stop)" : LISTENING);
    }
  });
})();
