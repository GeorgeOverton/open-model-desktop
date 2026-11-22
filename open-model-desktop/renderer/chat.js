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
  async function ask({ file, text, systemPrompt, onText, onThought, onRoute, convId, history, claudeSession, fast, files }) {
    const turnId = Math.random().toString(36).slice(2);
    handlers.set(turnId, { onText, onThought, onRoute });
    try { return await D.chat.send({ text, file, systemPrompt: systemPrompt || null, turnId, convId: convId || null, history: history || null, claudeSession: claudeSession || null, fast: !!fast, files: !!files }); }
    finally { handlers.delete(turnId); }
  }
  window.OMDChat = { ask, md: (t) => md(t), stop: () => D.chat.stop(), get busy() { return busy; }, set busy(v) { busy = v; setBusy(v); } };

  // Very small, safe Markdown: code blocks, inline code, bold, line breaks.
  const inline = (p) => esc(p).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/\n/g, "<br>");
  function md(s) { return renderAnswer(s, { files: false, final: true }).html; }

  // ---------- Files the model makes ----------
  // renderer/files.js finds them (forgiving, for small models). Each one is saved as a real file in Documents\Open Model Desktop.
  const F = window.OMDFiles;
  const ICON = (ext) => (ext === "html" ? "🌐" : ext === "csv" || ext === "tsv" ? "📊" : ext === "md" || ext === "txt" ? "📝" : "📄");
  function renderAnswer(text, opts = {}) {
    const { parts, blocks } = F.parse(text, opts);
    let html = "";
    parts.forEach((p, k) => {
      if (p.t === "text") {
        let s = p.s;
        if (k > 0) s = s.replace(/^\s*\n/, "");
        if (k < parts.length - 1) s = s.replace(/\n\s*$/, "");
        if (s.trim()) html += inline(s);
        return;
      }
      const b = p.b, i = b.i;
      if (b.name) {
        const ext = (b.name.split(".").pop() || "").toLowerCase();
        const lines = b.content.split("\n").filter((l, n, a) => l || n < a.length - 1).length;
        html += `<div class="filecard" data-b="${i}"><div class="fhead"><span class="ficon" aria-hidden="true">${ICON(ext)}</span>
          <div class="fname"><b>${esc(b.name)}</b><span class="small muted">${esc(F.KIND[ext] || ext.toUpperCase() + " file")} · ${lines} ${lines === 1 ? "line" : "lines"}${b.done ? (b.path ? ` · <span class="fsaved" title="${esc(b.path)}">saved ✓</span>` : "") : " · writing…"}</span></div>
          <span class="factions">${b.done ? `<button class="btn sm primary" data-f="open" type="button">Open</button><button class="btn sm" data-f="reveal" type="button" title="Show the file in its folder">Show in folder</button><button class="btn sm" data-f="saveas" type="button">Save as…</button><button class="btn sm" data-f="copy" type="button">Copy</button>` : ""}</span></div>
          <details class="fprev" ${b.done ? "" : "open"}><summary>${b.done ? "Show what's inside" : "Writing the file…"}</summary><pre><code>${esc(b.content)}</code></pre></details></div>`;
      } else {
        html += `<div class="codeblock" data-b="${i}"><pre><code>${esc(b.content)}</code></pre>${b.done ? `<span class="cbar"><button class="cbtn2" data-f="copy" type="button">Copy</button><button class="cbtn2" data-f="saveas" type="button">Save as file</button></span>` : ""}</div>`;
      }
    });
    return { html, blocks };
  }
  const filesOn = () => window.OMDSettings?.get().makeFiles !== false;
  const showAnswer = (el, text, opts) => { const r = renderAnswer(text, { files: filesOn(), ...opts }); el.innerHTML = r.html; el.closest(".msg")._blocks = r.blocks; el.closest(".msg")._conv = cur; return r.blocks; };
  // Names of the files made earlier in a conversation (before message index `upto`).
  const earlierNames = (conv, upto = Infinity) => (conv?.messages || []).slice(0, upto).flatMap((m) => (m.files || []).map((f) => f.name));
  // Save the files from a finished answer as real files, so Open works straight away and after a restart.
  async function writeFiles(conv, bm, el) {
    const named = (el.closest(".msg")._blocks || []).filter((b) => b.name && b.done);
    if (!named.length) return;
    bm.files = [];
    for (const b of named) {
      try {
        const path = await D.files.write({ chatId: conv.id, title: conv.title, name: b.name, content: b.content });
        bm.files.push({ name: b.name, path, b: b.i, ...(b.whole ? { whole: true } : {}) });
      } catch (err) { console.warn("Couldn't save file:", err); toast("Couldn't save " + b.name + ": " + String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""), 5000); }
    }
  }
  $("#messages").addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-f]"); if (!btn) return;
    const msg = btn.closest(".msg"), holder = btn.closest("[data-b]");
    const b = msg?._blocks?.[+holder.dataset.b]; if (!b) return;
    const name = b.name || `snippet.${F.extOf(b.lang, b.content, "")}`;
    try {
      if (btn.dataset.f === "copy") { await D.sys.copy(b.content); toast("Copied."); }
      else if (btn.dataset.f === "saveas") { const p = await D.files.saveAs({ name, content: b.content }); if (p) toast("Saved to " + p, 4000); }
      else if (btn.dataset.f === "open" || btn.dataset.f === "reveal") {
        if (!b.path) { const c = msg._conv || cur; b.path = await D.files.write({ chatId: c?.id || "unsaved", title: c?.title || "", name, content: b.content }); }
        if (btn.dataset.f === "open") await D.files.open(b.path); else await D.files.reveal(b.path);
      }
    } catch (err) { toast("Couldn't do that: " + String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""), 5000); }
  });

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
  const userEl = (text) => addEl("user", esc(text).replace(/\n/g, "<br>"));
  const voiceById = (id) => window.Speaker.VOICES?.find((v) => v.id === id) || window.Speaker.defaultVoice;
  function botEl(m, ctx = {}) {
    const v = voiceById(m.voice);
    const el = addEl("bot", `<div class="who">${window.OMD.avatar(v)}<b>${esc(v.name)}</b><span class="small muted mname">${esc(m.who || "")}</span>
      <button class="spk" type="button" title="Read this answer out loud in ${esc(v.name)}'s voice" aria-label="Read aloud" hidden>🔊</button></div><details class="thinking" ${m.thought ? "" : "hidden"}><summary>${m.thought ? "Show its thinking" : "Thinking…"}</summary><div class="tbody">${m.thought ? md(m.thought) : ""}</div></details><div class="answer">${
        m.error ? `<span class="err">${esc(m.error)}</span>` : m.pending ? `<span class="dots">●●●</span>` : m.text ? "" : `<span class="muted">(stopped)</span>`}</div>`);
    if (m.text && !m.error) showAnswer(el.querySelector(".answer"), m.text, { request: ctx.request || "", final: true, saved: m.files || [], earlier: ctx.earlier || [] });
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
  const historyOf = (msgs) => msgs.filter((m) => !m.error && !m.pending && m.text).map((m) => ({ role: m.role === "user" ? "user" : "bot", text: m.text }));

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
    cur.messages.forEach((m, k) => { if (m.role === "user") { request = m.text; userEl(m.text); } else botEl(m, { request, earlier: earlierNames(cur, k) }); });
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
  $("#stopBtn").addEventListener("click", () => D.chat.stop());

  $("#composer").addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = prompt.value.trim();
    if (!text || busy) return;
    if (!chatFile) { toast("Download a model first, then pick it at the top."); return; }
    prompt.value = ""; prompt.style.height = "auto";
    if ($("#messages .empty")) $("#messages").innerHTML = "";
    const mm = window.OMD.chatChoices.find((m) => m.file === chatFile) || {};
    const modelName = (mm.modelName || mm.name || "") + (mm.online ? " · online" : "");
    if (!cur) cur = { id: newId(), title: titleFrom(text), created: Date.now(), messages: [] };
    const conv = cur;   // keep hold of it, in case "New chat" is pressed while this answer is coming in
    const history = historyOf(cur.messages), earlier = earlierNames(cur);
    cur.model = chatFile; cur.modelName = mm.name || modelName;
    const v = window.Speaker.defaultVoice;
    const um = { role: "user", text, at: Date.now() };
    const bm = { role: "bot", text: "", thought: "", who: modelName, voice: v.id, pending: true };
    cur.messages.push(um, bm);
    userEl(text);
    const bot = botEl(bm);
    persist();
    const ans = bot.querySelector(".answer"), th = bot.querySelector(".thinking"), who = bot.querySelector(".mname");
    setBusy(true);
    try {
      const r = await ask({
        file: chatFile, text, convId: conv.id, history, claudeSession: conv.claudeSession, files: filesOn(),
        onText: (t) => { bm.text += t; showAnswer(ans, bm.text, { request: text, earlier }); bot.scrollIntoView({ block: "end" }); },
        onRoute: (r) => { bm.who = `✨ Optimal picked ${r.name} · for ${r.taskLabel}${r.fits ? "" : ` (nothing fits ${r.tierGB} GB, so the smallest)`}`; who.textContent = bm.who; },
        onThought: (t) => { bm.thought += t; th.hidden = false; th.querySelector(".tbody").innerHTML = md(bm.thought); },
      });
      if (bm.thought) th.querySelector("summary").textContent = "Show its thinking";
      if (r && r.plan && !r.stopped) { bm.who = `${r.model} · your Pro plan`; who.textContent = bm.who; }
      if (r && r.session) conv.claudeSession = r.session;
      // Claude may send its whole answer only at the end (older Claude Code).
      if (r && r.text && !bm.text) bm.text = r.text;
      if (bm.text) {
        // Finished: an unclosed last code block counts as done, and a file asked for in plain text becomes a file.
        showAnswer(ans, bm.text, { request: text, final: true, earlier });
        await writeFiles(conv, bm, ans);
        if (bm.files?.length) showAnswer(ans, bm.text, { request: text, final: true, earlier, saved: bm.files });
      }
      if (bm.text) {
        bot._text = bm.text; bot.querySelector(".spk").hidden = false;
        if (window.OMDSettings?.get().speakChat) window.Speaker.sayAll(bm.text, v.id);
      } else { bm.stopped = true; ans.innerHTML = `<span class="muted">(stopped)</span>`; }
    } catch (err) {
      bm.error = String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
      ans.innerHTML = `<span class="err">${esc(bm.error)}</span>`;
    } finally {
      delete bm.pending;
      setBusy(false);
      persist(conv);
    }
  });
})();
