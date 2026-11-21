// Chat with a downloaded model, fully offline.
(() => {
  "use strict";
  const { $, esc, toast, bus, store } = window.OMD;
  const D = window.desktop;
  const handlers = new Map(); // turnId -> { onText, onThought }
  let busy = false;
  let chatFile = store.get("chatModel", "");

  D.chat.onRoute((r) => handlers.get(r.turnId)?.onRoute?.(r));
  D.chat.onChunk((c) => {
    const h = handlers.get(c.turnId); if (!h) return;
    (c.kind === "thought" ? h.onThought : h.onText)?.(c.text);
  });

  // Shared by the Chat screen and Voice mode.
  async function ask({ file, text, systemPrompt, onText, onThought, onRoute }) {
    const turnId = Math.random().toString(36).slice(2);
    handlers.set(turnId, { onText, onThought, onRoute });
    try { return await D.chat.send({ text, file, systemPrompt: systemPrompt || null, turnId }); }
    finally { handlers.delete(turnId); }
  }
  window.OMDChat = { ask, stop: () => D.chat.stop(), get busy() { return busy; }, set busy(v) { busy = v; setBusy(v); } };

  // Very small, safe Markdown: code blocks, inline code, bold, line breaks.
  function md(s) {
    const parts = String(s).split(/```/);
    return parts.map((p, i) => {
      if (i % 2) return `<pre><code>${esc(p.replace(/^[\w+-]*\n/, ""))}</code></pre>`;
      return esc(p).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/\n/g, "<br>");
    }).join("");
  }

  function fillModels() {
    const sel = $("#chatModel");
    const mine = window.OMD.chatChoices;
    if (chatFile && !mine.some((m) => m.file === chatFile)) chatFile = "";
    if (!chatFile && mine[0]) chatFile = (mine.find((m) => !m.auto) || mine[0]).file;
    const opt = (m) => `<option value="${esc(m.file)}" ${m.file === chatFile ? "selected" : ""}>${esc(m.name)} (${esc(m.quant || "")})</option>`;
    const autos = mine.filter((m) => m.auto), rest = mine.filter((m) => !m.auto);
    sel.innerHTML = mine.length ? (autos.length ? `<optgroup label="Let the app choose">${autos.map(opt).join("")}</optgroup><optgroup label="Your models">${rest.map(opt).join("")}</optgroup>` : rest.map(opt).join(""))
      : `<option value="">No models downloaded yet</option>`;
    if (!mine.length && !$("#messages").children.length) {
      $("#messages").innerHTML = `<div class="empty">Download a model first from <button class="linkish" data-goto="find">Find models</button>. Then come back here to chat. No internet needed after that.</div>`;
    } else if (mine.length && $("#messages .empty")) $("#messages").innerHTML = "";
  }
  bus.addEventListener("models", fillModels);
  fillModels();
  bus.addEventListener("chatWith", (e) => { chatFile = e.detail; store.set("chatModel", chatFile); fillModels(); $("#messages").innerHTML = ""; D.chat.reset(null); setTimeout(() => $("#prompt").focus(), 50); });
  $("#messages").addEventListener("click", (e) => { const g = e.target.closest("[data-goto]"); if (g) window.OMD.show(g.dataset.goto); });
  $("#chatModel").addEventListener("change", (e) => { chatFile = e.target.value; store.set("chatModel", chatFile); $("#messages").innerHTML = ""; });
  $("#newChat").addEventListener("click", () => { $("#messages").innerHTML = ""; D.chat.reset(null); $("#prompt").focus(); });

  function addMsg(role, html) {
    const el = document.createElement("div");
    el.className = "msg " + role;
    el.innerHTML = html;
    $("#messages").appendChild(el);
    el.scrollIntoView({ block: "end" });
    return el;
  }
  function setBusy(v) {
    busy = v;
    $("#sendBtn").hidden = v; $("#stopBtn").hidden = !v;
  }

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
    addMsg("user", esc(text).replace(/\n/g, "<br>"));
    const v = window.Speaker.defaultVoice;
    const mm = window.OMD.chatChoices.find((m) => m.file === chatFile) || {};
    const modelName = (mm.modelName || mm.name || "") + (mm.online ? " · online" : "");
    const bot = addMsg("bot", `<div class="who">${window.OMD.avatar(v)}<b>${esc(v.name)}</b><span class="small muted mname">${esc(modelName)}</span>
      <button class="spk" type="button" title="Read this answer out loud in ${esc(v.name)}'s voice" aria-label="Read aloud" hidden>🔊</button></div><details class="thinking" hidden><summary>Thinking…</summary><div class="tbody"></div></details><div class="answer"><span class="dots">●●●</span></div>`);
    let answer = "", thought = "";
    const ans = bot.querySelector(".answer"), th = bot.querySelector(".thinking");
    setBusy(true);
    try {
      const r = await ask({
        file: chatFile, text,
        onText: (t) => { answer += t; ans.innerHTML = md(answer); bot.scrollIntoView({ block: "end" }); },
        onRoute: (r) => { bot.querySelector(".mname").textContent = `✨ Optimal picked ${r.name} · for ${r.taskLabel}${r.fits ? "" : ` (nothing fits ${r.tierGB} GB, so the smallest)`}`; },
        onThought: (t) => { thought += t; th.hidden = false; th.querySelector(".tbody").innerHTML = md(thought); },
      });
      if (thought) th.querySelector("summary").textContent = "Show its thinking";
      if (r && r.plan && !r.stopped) bot.querySelector(".mname").textContent = `${r.model} · your Pro plan`;
      // Claude may send its whole answer only at the end (older Claude Code).
      if (r && r.text && !answer) { answer = r.text; ans.innerHTML = md(answer); }
      if (answer) {
        const spk = bot.querySelector(".spk"); spk.hidden = false;
        spk.addEventListener("click", () => { window.Speaker.stop(); window.Speaker.sayAll(answer, v.id); });
        if (window.OMDSettings?.get().speakChat) window.Speaker.sayAll(answer, v.id);
      }
      if (!answer) ans.innerHTML = `<span class="muted">(stopped)</span>`;
    } catch (err) {
      ans.innerHTML = `<span class="err">${esc(String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""))}</span>`;
    } finally { setBusy(false); }
  });
})();
