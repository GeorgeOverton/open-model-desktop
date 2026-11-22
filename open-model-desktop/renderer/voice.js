// Voice mode: offline wake phrases ("Hey Jarvis") that each wake a chosen model.
// Speech recognition runs on this computer using Vosk (a small English speech pack, about 40 MB).
(() => {
  "use strict";
  const { $, esc, toast, bus } = window.OMD;
  const D = window.desktop;

  let settings = null;
  let pack = { installed: false, url: "" };
  let vosk = null, recognizer = null, audio = null;
  let mode = "off";          // off | wake | command | thinking | speaking | test
  let active = null;         // the wake phrase that woke us
  let commandTimer = null, followTimer = null, lastTurnAt = 0;
  let testingId = null;
  let generating = false;

  // ---------- Matching what was heard to a wake phrase ----------
  const GREETINGS = new Set(["hey", "hi", "hay", "a", "ok", "okay", "hello", "yo", "the"]);
  const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim();
  // Rough "sounds alike" key so small mis-hearings still match (jarvis / jarvas / jervis).
  const sound = (w) => w.replace(/ph/g, "f").replace(/ck|q/g, "k").replace(/c(?=[eiy])/g, "s").replace(/c/g, "k")
    .replace(/z/g, "s").replace(/[aeiouy]+/g, "a").replace(/(.)\1+/g, "$1").replace(/h(?!$)/g, "").replace(/a$/, "");
  function lev(a, b) {
    const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[n];
  }
  const sim = (a, b) => 1 - lev(a, b) / Math.max(a.length, b.length, 1);
  // Returns { entry, rest } where rest is anything said after the phrase ("Hey Jarvis, what time is it").
  function matchWake(heard, entries) {
    const words = norm(heard).split(" ").filter(Boolean);
    let best = null;
    for (const entry of entries) {
      for (const variant of [entry.phrase, ...(entry.aliases || [])]) {
        const pw = norm(variant).split(" ").filter(Boolean);
        // The name part matters most; a missing "hey" is fine.
        const core = pw.filter((w, i) => !(i === 0 && GREETINGS.has(w) && pw.length > 1));
        if (!core.length) continue;
        for (let i = 0; i + core.length <= words.length; i++) {
          const win = words.slice(i, i + core.length);
          const s = sim(sound(core.join(" ")), sound(win.join(" "))) * 0.6 + sim(core.join(" "), win.join(" ")) * 0.4;
          if (s >= 0.72 && (!best || s > best.score)) best = { entry, score: s, rest: words.slice(i + core.length).join(" ") };
        }
      }
    }
    return best;
  }
  window.__voice = { matchWake, sound, handle: (entry, text) => handleCommand(entry, text) };

  // ---------- Speaking replies ----------
  // Speaking goes through the shared Speaker (natural voices, or the built-in voice as a fallback).
  function speak(text, voiceId) {
    if (!settings.speakReplies || !text.trim()) return;
    window.Speaker.say(text, voiceId);
    setMode("speaking");
  }
  window.Speaker.onIdle(() => { if (mode !== "speaking") return; if (generating) setMode("thinking"); else afterReply(); });
  const voiceFor = (entry) => window.Speaker.byId(entry.voice) || window.Speaker.defaultVoice;
  bus.addEventListener("settings", (e) => { Object.assign(settings, e.detail); renderPhrases(); });

  // A short beep so you know it heard the wake phrase.
  function chime(up = true) {
    try {
      const ctx = audio?.ctx || new AudioContext();
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.setValueAtTime(up ? 660 : 520, ctx.currentTime);
      o.frequency.linearRampToValueAtTime(up ? 990 : 390, ctx.currentTime + 0.12);
      g.gain.setValueAtTime(0.0001, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.2);
      o.connect(g).connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.22);
    } catch {}
  }

  // ---------- UI ----------
  const LABELS = {
    off: ["Not listening", "Press the microphone to start. Say one of your wake phrases, then ask your question."],
    wake: ["Listening for your wake phrase", ""],
    command: ["I'm listening…", "Ask your question."],
    thinking: ["Thinking…", ""],
    speaking: ["Speaking", "Press Esc or the microphone to stop."],
    test: ["Testing", "Say the wake phrase now."],
  };
  function setMode(m) {
    mode = m;
    const orb = $("#orb");
    orb.dataset.mode = m;
    orb.setAttribute("aria-pressed", m !== "off");
    orb.setAttribute("aria-label", m === "off" ? "Start listening" : "Stop listening");
    $("#orbState").textContent = m === "command" && active ? `${active.phrase}: I'm listening…` : LABELS[m][0];
    $("#orbHint").textContent = m === "wake" ? `Say ${settings.wakePhrases.filter((p) => p.model).map((p) => `"${p.phrase}"`).join(" or ") || "a wake phrase"}.` : LABELS[m][1];
  }
  const modelName = (file) => window.OMD.chatChoices.find((m) => m.file === file)?.name || "";

  function renderPack() {
    const box = $("#voicePackBox");
    if (pack.installed) {
      box.innerHTML = `<h3>✓ Listening pack installed</h3><p class="small muted">Listening works offline. English only for now.</p>`;
      box.classList.add("ok-box");
    } else {
      box.classList.remove("ok-box");
      box.innerHTML = `<h3>Listening pack (for wake phrases)</h3>
        <p>Voice mode needs a small offline speech recogniser (about 40 MB, English). You only download it once.</p>
        <button class="btn primary" id="getPack">Download speech pack</button>
        <div class="bar" id="packBar" hidden><span></span></div>`;
      $("#getPack").addEventListener("click", async (e) => {
        e.target.disabled = true; e.target.textContent = "Downloading…"; $("#packBar").hidden = false;
        try { pack = await D.voice.download(); renderPack(); toast("Speech pack ready. Press the microphone to start."); }
        catch (err) { toast("Couldn't download the speech pack: " + err.message, 6000); e.target.disabled = false; e.target.textContent = "Try again"; }
      });
    }
  }
  D.voice.onProgress((p) => { const s = $("#packBar span"); if (s && p.total) s.style.width = (100 * p.got / p.total).toFixed(1) + "%"; });

  function renderPhrases() {
    const mine = window.OMD.chatChoices;
    const opts = (sel) => `<option value="">Choose a model…</option>` + mine.map((m) =>
      `<option value="${esc(m.file)}" ${m.file === sel ? "selected" : ""}>${esc(m.name)}</option>`).join("");
    const voiceOpts = (sel) => `<option value="">Default voice (${esc(window.Speaker.defaultVoice.name)})</option>` + window.Speaker.VOICES.map((v) =>
      `<option value="${v.id}" ${v.id === sel ? "selected" : ""}>${esc(v.name)} · ${v.accent} ${v.gender.toLowerCase()}</option>`).join("");
    $("#phrases").innerHTML = settings.wakePhrases.map((p) => `
      <div class="phrase" data-id="${esc(p.id)}">
        <div class="pgrid">
          <label class="small">Wake phrase<input data-k="phrase" value="${esc(p.phrase)}" placeholder="Hey Jarvis"></label>
          <label class="small">Wakes this model<select data-k="model">${opts(p.model)}</select></label>
          <label class="small">Answers with this voice<select data-k="voice">${voiceOpts(p.voice)}</select></label>
          <label class="small wide"><span>Personality <span class="muted">(optional)</span></span><input data-k="personality" value="${esc(p.personality || "")}" placeholder="e.g. You are Jarvis, a calm British butler. Keep answers short."></label>
        </div>
        <div class="prow">
          <button class="btn sm" data-act="test">${testingId === p.id ? "Listening… say it now" : "🎤 Test"}</button>
          ${(p.aliases || []).length ? `<span class="small muted">Also accepts: ${p.aliases.map((a) => `<span class="tag">${esc(a)} <button class="x" data-act="unalias" data-alias="${esc(a)}" aria-label="Remove">×</button></span>`).join(" ")}</span>` : ""}
          <span class="small test-out" id="test-${esc(p.id)}"></span>
          <button class="btn sm ghost" data-act="remove" ${settings.wakePhrases.length < 2 ? "hidden" : ""}>Remove</button>
        </div>
      </div>`).join("");
    $("#phraseCount").textContent = `(${settings.wakePhrases.length})`;
    $("#phraseSummary").innerHTML = settings.wakePhrases.map((p) => { const v = voiceFor(p); const m = window.OMD.chatChoices.find((x) => x.file === p.model);
      return `<div class="pline">${window.OMD.modelIcon(p.model, true)}<div><strong>"${esc(p.phrase)}"</strong><div class="small muted">${m ? `Wakes ${esc(m.name)}` : "No model picked yet"} · answers as ${esc(v.name)} (${v.accent} ${v.gender.toLowerCase()})</div></div></div>`; }).join("");
    if (!mine.length) $("#phrases").insertAdjacentHTML("afterbegin", `<p class="small warn">Download a model first in <button class="linkish" data-goto="find">Find models</button>, then pick it here.</p>`);
  }
  const save = () => D.settings.set({ wakePhrases: settings.wakePhrases });
  const entryOf = (el) => settings.wakePhrases.find((p) => p.id === el.closest(".phrase")?.dataset.id);

  $("#phrases").addEventListener("change", (e) => {
    const k = e.target.dataset.k; const p = entryOf(e.target); if (!k || !p) return;
    p[k] = e.target.value.trim(); if (k === "phrase") p.aliases = [];
    save(); if (k !== "personality") renderPhrases();
  });
  $("#phrases").addEventListener("click", async (e) => {
    const g = e.target.closest("[data-goto]"); if (g) return window.OMD.show(g.dataset.goto);
    const b = e.target.closest("[data-act]"); if (!b) return;
    const p = entryOf(b); if (!p) return;
    if (b.dataset.act === "remove") { settings.wakePhrases = settings.wakePhrases.filter((x) => x !== p); save(); renderPhrases(); }
    if (b.dataset.act === "unalias") { p.aliases = p.aliases.filter((a) => a !== b.dataset.alias); save(); renderPhrases(); }
    if (b.dataset.act === "accept") { p.aliases = [...new Set([...(p.aliases || []), b.dataset.heard])]; save(); renderPhrases(); toast(`Got it. "${b.dataset.heard}" now wakes ${p.phrase}.`); }
    if (b.dataset.act === "test") {
      if (!pack.installed) return toast("Download the speech pack first, in Settings → Voice mode.");
      testingId = p.id; renderPhrases();
      const wasOff = mode === "off";
      if (wasOff) { const ok = await startListening(); if (!ok) { testingId = null; renderPhrases(); return; } }
      setMode("test");
      clearTimeout(commandTimer);
      commandTimer = setTimeout(() => finishTest(null, wasOff), 6000);
      testWasOff = wasOff;
    }
  });
  let testWasOff = false;
  function finishTest(heard, wasOff = testWasOff) {
    clearTimeout(commandTimer);
    const p = settings.wakePhrases.find((x) => x.id === testingId);
    testingId = null;
    renderPhrases();
    if (p) {
      const out = $("#test-" + CSS.escape(p.id));
      if (!heard) out.innerHTML = `<span class="warn">I didn't hear anything. Check your microphone and try again.</span>`;
      else if (matchWake(heard, [p])) out.innerHTML = `<span class="ok">✓ Heard "${esc(heard)}". That works.</span>`;
      else {
        out.innerHTML = `<span class="warn">I heard "${esc(heard)}".</span> <button class="btn sm" data-act="accept" data-heard="${esc(heard)}">Use that for ${esc(p.phrase)}</button>`;
      }
    }
    if (wasOff) stopListening(); else setMode("wake");
  }
  $("#addPhrase").addEventListener("click", () => {
    const names = ["Hey Friday", "Hey Nova", "Hey Coder", "Hey Atlas", "Hey Echo"];
    const used = new Set(settings.wakePhrases.map((p) => p.phrase));
    settings.wakePhrases.push({ id: Math.random().toString(36).slice(2, 8), phrase: names.find((n) => !used.has(n)) || "Hey Computer", aliases: [], model: "", personality: "" });
    save(); renderPhrases();
  });

  function log(who, text, cls = "", voice = null, icon = "") {
    const el = document.createElement("div");
    el.className = "vline " + (who === "you" ? "you" : "") + " " + cls;
    el.innerHTML = (icon ? `<span class="wicon">${icon}</span>` : voice ? window.OMD.avatar(voice) : "") + `<b class="wname">${esc(who === "you" ? "You" : who)}</b> <span class="say"></span>`;
    $("#voiceLogBar").hidden = false;
    el.querySelector(".say").textContent = text;
    $("#voiceLog").prepend(el);
    return el.querySelector(".say");
  }

  // ---------- Asking before using the microphone ----------
  function askDialog({ title, text, yes, no }) {
    return new Promise((resolve) => {
      const d = document.createElement("dialog");
      d.className = "ask";
      d.innerHTML = `<h2>${esc(title)}</h2><p>${text}</p><div class="row"><button class="btn" data-a="no" type="button">${esc(no)}</button><button class="btn primary" data-a="yes" type="button">${esc(yes)}</button></div>`;
      document.body.appendChild(d);
      const done = (v) => { d.close(); d.remove(); resolve(v); };
      d.addEventListener("click", (e) => { const b = e.target.closest("[data-a]"); if (b) done(b.dataset.a === "yes"); });
      d.addEventListener("cancel", (e) => { e.preventDefault(); done(false); });
      d.showModal(); d.querySelector("[data-a=yes]").focus();
    });
  }
  async function allowMic() {
    const s = window.OMDSettings?.get() || settings;
    if (!s.micAllowed) {
      const ok = await askDialog({ title: "Use your microphone?",
        text: "Open Model Desktop would like to use your microphone so you can talk to your models. It only listens while Voice mode or the 🎤 button in Chat is on. " +
          "Your speech is turned into text on this computer: nothing is recorded or uploaded.<br><br><span class=\"small muted\">You can turn this off any time in Settings → Voice mode.</span>",
        yes: "Allow microphone", no: "Not now" });
      if (!ok) { toast("OK, the microphone stays off."); return false; }
      await window.OMDSettings.save({ micAllowed: true });
    }
    if (!(await D.sys.askMic())) { toast("Your computer blocked the microphone. Allow it for Open Model Desktop in your system's privacy settings, then try again.", 7000); return false; }
    return true;
  }
  async function voskModel(hint) {
    if (!pack.installed) pack = await D.voice.status();
    if (!pack.installed) throw Object.assign(new Error("Download the speech pack first, in Settings → Voice mode."), { needPack: true });
    if (!vosk) { hint?.("Loading the speech pack (a few seconds the first time)…"); vosk = await window.Vosk.createModel(pack.url); }
    return vosk;
  }
  async function openMic() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
    const ctx = new AudioContext();
    const src = ctx.createMediaStreamSource(stream);
    const proc = ctx.createScriptProcessor(4096, 1, 1);
    src.connect(proc); proc.connect(ctx.destination);
    return { ctx, stream, src, proc, close() { try { proc.disconnect(); src.disconnect(); stream.getTracks().forEach((t) => t.stop()); ctx.close(); } catch {} } };
  }

  // ---------- Talking in Chat (the 🎤 button): turns speech into a message ----------
  let chatMic = null;
  async function listen({ onPartial, onFinal, paused, hint }) {
    if (mode !== "off") stopListening();          // Voice mode's microphone and Chat's can't both listen
    if (!(await allowMic())) return null;
    const model = await voskModel(hint);
    const mic = await openMic();
    const rec = new model.KaldiRecognizer(mic.ctx.sampleRate);
    rec.on("partialresult", (m) => { if (!paused?.() && m.result.partial) onPartial?.(m.result.partial); });
    rec.on("result", (m) => { const t = (m.result.text || "").trim(); if (t && !paused?.()) onFinal?.(t); });
    mic.proc.onaudioprocess = (ev) => { if (!paused?.()) { try { rec.acceptWaveform(ev.inputBuffer); } catch {} } };
    chatMic = { stop() { mic.close(); try { rec.remove(); } catch {} if (chatMic === this) chatMic = null; } };
    return chatMic;
  }
  bus.addEventListener("micOff", () => { if (mode !== "off") stopListening(); });
  // Clear: wipe the screen and start a fresh conversation (the last one stays in Saved chats).
  $("#voiceClear").addEventListener("click", () => {
    if (mode === "speaking" || mode === "thinking") interrupt();
    $("#voiceLog").innerHTML = ""; $("#voiceLogBar").hidden = true; $("#heard").textContent = "";
    vconv = null; lastTurnAt = 0; active = null;
    toast(window.OMDSettings?.get().saveChats === false ? "Cleared. The next question starts a fresh conversation." : "Cleared. The next question starts a fresh conversation (the last one is still in Saved chats).", 4000);
  });
  // Collapse the wake phrases (remembered).
  const setPhrasesOpen = (open) => { $("#phrasesToggle").setAttribute("aria-expanded", open); $("#phraseSummary").hidden = !open; window.OMD.store.set("phrasesOpen", open); };
  $("#phrasesToggle").addEventListener("click", () => setPhrasesOpen($("#phrasesToggle").getAttribute("aria-expanded") !== "true"));
  setPhrasesOpen(window.OMD.store.get("phrasesOpen", true));
  window.OMDVoice = { listen, allowMic, get packInstalled() { return pack.installed; } };

  // ---------- Listening ----------
  async function startListening() {
    if (!pack.installed) { toast("Download the speech pack first, in Settings → Voice mode."); return false; }
    if (!settings.wakePhrases.some((p) => p.model) && !testingId) { toast("Pick a model for at least one wake phrase below."); return false; }
    try {
      chatMic?.stop(); bus.dispatchEvent(new CustomEvent("micTaken"));
      if (!(await allowMic())) { setMode("off"); return false; }
      $("#orbState").textContent = "Starting…";
      await voskModel((h) => { $("#orbHint").textContent = h; });
      const mic = await openMic();
      recognizer = new vosk.KaldiRecognizer(mic.ctx.sampleRate);
      recognizer.on("partialresult", (m) => onPartial(m.result.partial));
      recognizer.on("result", (m) => onResult(m.result.text));
      mic.proc.onaudioprocess = (ev) => {
        // Don't listen to ourselves while thinking or talking.
        if (mode === "wake" || mode === "command" || mode === "test") { try { recognizer.acceptWaveform(ev.inputBuffer); } catch {} }
      };
      audio = mic;
      setMode("wake");
      warm(settings.wakePhrases.find((p) => p.model));   // get the first wake phrase's model ready
      return true;
    } catch (err) {
      toast(/Permission|NotAllowed/i.test(err.name + err.message) ? "The app needs microphone permission. Allow it in your system settings, then try again."
        : "Couldn't start listening: " + (err.message || err), 6000);
      stopListening();
      return false;
    }
  }
  function stopListening() {
    clearTimeout(commandTimer); clearTimeout(followTimer);
    window.Speaker.stop();
    if (mode === "thinking") window.OMDChat.stop();
    audio?.close();
    try { recognizer?.remove(); } catch {}
    audio = null; recognizer = null; active = null;
    setMode("off"); $("#heard").textContent = "";
  }
  $("#orb").addEventListener("click", () => {
    if (mode === "speaking" || mode === "thinking") { interrupt(); return; }
    mode === "off" ? startListening() : stopListening();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && (mode === "speaking" || mode === "thinking")) interrupt(); });
  function interrupt() { window.Speaker.stop(); window.OMDChat.stop(); setTimeout(() => { if (audio) setMode("wake"); }, 50); }

  function onPartial(text) {
    if (!text) return;
    $("#heard").textContent = "Hearing: " + text;
    if (mode === "wake" && !active) {
      const m = matchWake(text, settings.wakePhrases.filter((p) => p.model));
      if (m) { active = m.entry; chime(true); setMode("command"); warm(m.entry); }
    }
  }
  function onResult(text) {
    text = norm(text);
    if (mode === "test") { if (text) finishTest(text); return; }
    if (!text) return;
    $("#heard").textContent = "Heard: " + text;
    const entries = settings.wakePhrases.filter((p) => p.model);
    if (mode === "wake" || (mode === "command" && active)) {
      const m = matchWake(text, entries);
      if (m) {
        if (!active) chime(true);
        active = m.entry; warm(m.entry);
        if (m.rest.split(" ").filter(Boolean).length >= 2) return handleCommand(active, m.rest);
        setMode("command");
        clearTimeout(commandTimer);
        commandTimer = setTimeout(() => { if (mode === "command") { chime(false); active = null; setMode("wake"); } }, 8000);
        return;
      }
      if (mode === "command" && active) return handleCommand(active, text);
      active = null; // heard something else; keep waiting
    }
  }

  // Start loading the model the moment its wake phrase is heard, while you're still asking, so the answer comes sooner.
  function warm(entry) {
    if (!entry?.model || entry.model.startsWith("@") || window.OMDChat.busy) return;
    D.chat.load(entry.model).catch(() => {});
  }
  // Voice conversations are saved like chats (Saved chats in Chat), unless saving is turned off.
  let vconv = null;
  const titleFrom = (t) => { t = t.replace(/\s+/g, " ").trim(); t = t.charAt(0).toUpperCase() + t.slice(1); return "🎙️ " + (t.length > 56 ? t.slice(0, 53).replace(/\s+\S*$/, "") + "…" : t); };
  async function saveConv() {
    if (!vconv || window.OMDSettings?.get().saveChats === false) return;
    try { await D.chats.save({ id: vconv.id, title: vconv.title, model: vconv.model, modelName: vconv.modelName, messages: vconv.messages.map(({ pending, ...m }) => m) }); bus.dispatchEvent(new CustomEvent("chatsChanged")); }
    catch (err) { console.warn("Couldn't save voice chat:", err); }
  }
  async function handleCommand(entry, text) {
    clearTimeout(commandTimer); clearTimeout(followTimer);
    setMode("thinking");
    log("you", text);
    const name = modelName(entry.model) || entry.phrase;
    const voice = voiceFor(entry);
    const out = log(name, "…", "bot", voice, window.OMD.modelIcon(entry.model));
    const line = out.parentElement;
    // New conversation if it's been a while, or a different wake phrase.
    if (!vconv || Date.now() - lastTurnAt > 120000 || vconv.entry !== entry.id) {
      vconv = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8), entry: entry.id, title: titleFrom(text), created: Date.now(), messages: [] };
    }
    const conv = vconv;
    const history = conv.messages.filter((m) => m.text && !m.error).map((m) => ({ role: m.role === "user" ? "user" : "bot", text: m.text }));
    const earlier = window.OMDChat.files.earlierNames(conv);
    conv.model = entry.model; conv.modelName = name;
    const um = { role: "user", text, at: Date.now(), voice: true }, bm = { role: "bot", text: "", who: "🎙️ voice · " + voice.name, voice: voice.id, model: entry.model, pending: true };
    conv.messages.push(um, bm);
    const files = window.OMDChat.files.filesOn();
    const system = [entry.personality || `You are ${entry.phrase.replace(/^(hey|ok|hi)\s+/i, "")}, a helpful voice assistant.`,
      "You are talking out loud, so answer in a few short spoken sentences. No lists, tables or markdown unless asked.",
      files ? "If the user asks you to make a file, still make it as a code block (the app saves it and won't read it out), and say in one short sentence what it is." : "No code blocks unless asked."].join(" ");
    const speech = settings.speakReplies ? window.Speaker.stream(voice.id, { onSay: () => setMode("speaking") }) : null;
    const show = (final) => window.OMDChat.files.showIn(line, out, bm.text, { request: text, final, earlier, bm, conv, onChange: saveConv });
    generating = true;
    try {
      if (window.OMD.chatChoices.find((m) => m.file === entry.model) == null) throw new Error(`The model for "${entry.phrase}" isn't downloaded any more. Pick another one below.`);
      $("#orbHint").textContent = `Using ${name}`;
      await window.OMDChat.ask({
        file: entry.model, text, systemPrompt: system, fast: true, files, convId: conv.id, history,
        onRoute: (r) => { $("#orbHint").textContent = `Optimal picked ${r.name} for ${r.taskLabel}`; bm.model = r.file;
          line.querySelector(".wicon").innerHTML = window.OMD.modelIcon(r.file); line.querySelector(".wname").textContent = window.OMD.nameOf(r.file) || r.name; },
        onText: (t) => { bm.text += t; show(false); if (mode === "thinking" || mode === "speaking") speech?.push(bm.text); },
      });
      speech?.end(bm.text);
      lastTurnAt = Date.now();
      if (!bm.text) { out.textContent = "(stopped)"; bm.stopped = true; }
      else {
        show(true);
        const made = await window.OMDChat.files.finishFiles(line);
        if (made.length && settings.speakReplies) {
          const names = made.map((b) => b.name.replace(/\./g, " dot ")).join(" and ");
          window.Speaker.say(made.every((b) => b.path) ? `I've saved ${names} in your Documents folder.` : `I've made ${names}. Press Save on the screen if you want to keep it.`, voice.id);
          setMode("speaking");
        }
      }
    } catch (err) {
      bm.error = String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
      out.textContent = bm.error; line.classList.add("err");
    }
    delete bm.pending;
    saveConv();
    generating = false;
    if (!window.Speaker.speaking) afterReply();
  }
  function afterReply() {
    if (!audio) return;
    if (settings.followUpSeconds > 0 && active) {
      setMode("command");
      $("#orbHint").textContent = `Ask a follow-up, or wait ${settings.followUpSeconds} seconds.`;
      clearTimeout(followTimer);
      followTimer = setTimeout(() => { if (mode === "command") { active = null; setMode("wake"); } }, settings.followUpSeconds * 1000);
    } else { active = null; setMode("wake"); }
  }

  // ---------- Start ----------
  (async () => {
    settings = await D.settings.get();
    pack = await D.voice.status();
    renderPack(); setMode("off");
    const onModels = () => {
      // First model downloaded? Give it to "Hey Jarvis" automatically.
      const first = window.OMD.mine.find((m) => !(m.tags || []).includes("embeddings"));
      const jar = settings.wakePhrases[0];
      if (first && jar && !jar.model) { jar.model = first.file; save(); }
      renderPhrases();
    };
    bus.addEventListener("models", onModels);
    onModels();
  })();
})();
