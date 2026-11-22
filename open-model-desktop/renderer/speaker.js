// Voices and speaking. Natural voices (Kokoro) run on this computer; the built-in system voice is the fallback.
(() => {
  "use strict";
  const D = window.desktop;

  // Friendly English names for each natural voice. "id" is the voice file that ships with the app.
  const VOICES = [
    { id: "af_heart",    name: "Hannah",   accent: "American", flag: "🇺🇸", gender: "Female", tone: "Warm and friendly. Sounds the most natural of all, a great default.", stars: 5 },
    { id: "af_bella",    name: "Bella",    accent: "American", flag: "🇺🇸", gender: "Female", tone: "Bright and lively, with lots of expression.", stars: 4.5 },
    { id: "bf_emma",     name: "Emma",     accent: "British",  flag: "🇬🇧", gender: "Female", tone: "Clear and polished, like a newsreader.", stars: 4 },
    { id: "af_nicole",   name: "Nicole",   accent: "American", flag: "🇺🇸", gender: "Female", tone: "Soft and calm, almost a whisper. Relaxing for long answers.", stars: 4 },
    { id: "am_michael",  name: "Michael",  accent: "American", flag: "🇺🇸", gender: "Male",   tone: "Calm, steady and easy to listen to.", stars: 3.5 },
    { id: "am_fenrir",   name: "Ryan",     accent: "American", flag: "🇺🇸", gender: "Male",   tone: "Deeper and confident.", stars: 3.5 },
    { id: "am_puck",     name: "Jack",     accent: "American", flag: "🇺🇸", gender: "Male",   tone: "Upbeat and playful.", stars: 3.5 },
    { id: "af_sarah",    name: "Sarah",    accent: "American", flag: "🇺🇸", gender: "Female", tone: "Neutral and professional.", stars: 3.5 },
    { id: "bm_george",   name: "George",   accent: "British",  flag: "🇬🇧", gender: "Male",   tone: "Mature and measured, a natural fit for a butler like Jarvis.", stars: 3 },
    { id: "bf_isabella", name: "Isabella", accent: "British",  flag: "🇬🇧", gender: "Female", tone: "Gentle and friendly.", stars: 3 },
    { id: "bm_fable",    name: "Oliver",   accent: "British",  flag: "🇬🇧", gender: "Male",   tone: "A storyteller's voice, great for reading things aloud.", stars: 3 },
  ];
  const SYSTEM = { id: "system", name: "Computer", accent: "", flag: "💻", gender: "", tone: "Your computer's built-in voice." };
  const byId = (id) => VOICES.find((v) => v.id === id) || (id === "system" ? SYSTEM : null);

  let settings = { voice: "af_heart", voiceSpeed: 1, voiceName: "" };
  let installed = false;
  let ctx = null, current = null, queue = [], playing = false, gen = 0;
  const idle = new EventTarget();

  const audioCtx = () => (ctx ??= new AudioContext());
  async function synth(text, voiceId) {
    const v = byId(voiceId);
    if (installed && v && v.id !== "system") {
      const r = await D.tts.speak({ text, voice: v.id, speed: settings.voiceSpeed || 1 });
      return { kind: "pcm", ...r };
    }
    return { kind: "system", text };
  }
  function playSystem(text) {
    return new Promise((resolve) => {
      const s = window.speechSynthesis; if (!s) return resolve();
      const u = new SpeechSynthesisUtterance(text);
      const sv = s.getVoices().find((x) => x.name === settings.voiceName);
      if (sv) u.voice = sv;
      u.rate = settings.voiceSpeed || 1;
      u.onend = u.onerror = () => resolve();
      s.speak(u);
    });
  }
  function playPcm({ samples, rate }) {
    return new Promise((resolve) => {
      const c = audioCtx();
      const buf = c.createBuffer(1, samples.length, rate);
      buf.copyToChannel(samples instanceof Float32Array ? samples : new Float32Array(samples), 0);
      const src = c.createBufferSource();
      src.buffer = buf; src.connect(c.destination);
      src.onended = () => { current = null; resolve(); };
      current = src; src.start();
    });
  }
  // Sentences are made in order while earlier ones play, so speech starts quickly.
  async function pump(myGen) {
    if (playing) return;
    playing = true;
    while (queue.length && myGen === gen) {
      const item = queue.shift();
      let out;
      try { out = await item.audio; } catch (err) { console.warn(err); if (!item.fellBack) { out = { kind: "system", text: item.text }; } }
      if (myGen !== gen) break;
      if (out?.kind === "pcm") await playPcm(out); else if (out) await playSystem(out.text);
    }
    playing = false;
    if (myGen === gen) idle.dispatchEvent(new Event("idle"));
  }
  const clean = (t) => String(t).replace(/```[\s\S]*?```/g, " ").replace(/[*_#`>|]+/g, "").replace(/\s+/g, " ").trim();

  window.Speaker = {
    VOICES, SYSTEM, byId,
    get installed() { return installed; },
    get speaking() { return playing || queue.length > 0; },
    get defaultVoice() { return byId(settings.voice) || VOICES[0]; },
    configure(s) { settings = { ...settings, ...s }; },
    async refresh() { installed = (await D.tts.status()).installed; if (installed) D.tts.warmup().catch(() => {}); return installed; },
    say(text, voiceId) {
      const t = clean(text); if (!t) return;
      const v = voiceId || settings.voice;
      queue.push({ text: t, audio: synth(t, v) });
      pump(gen);
    },
    stop() {
      gen++; queue = []; playing = false;
      try { current?.stop(); } catch {}
      current = null;
      window.speechSynthesis?.cancel();
    },
    onIdle(cb, once = false) { idle.addEventListener("idle", cb, { once }); },
    // Speak a reply while the model is still writing it. push() gets the whole answer so far; end() when it's finished.
    // The first few words are spoken as soon as they arrive, then sentence by sentence (long ones are cut at a comma).
    // Code and file contents are never read out: it says it's making the file instead.
    stream(voiceId, { onSay } = {}) {
      let fed = 0, pending = "", first = true, announced = false;
      const words = (x) => x.trim().split(/\s+/).filter(Boolean).length;
      const HEADER = /^[ \t]*[*_#>`-]*[ \t]*(file(?:name)?|save (?:this |it )?as)\b[^\n]*(\n|$)/gim;
      // The answer as it should be spoken: \u0001 where a finished code block was, \u0002 at the end while one is being written.
      const prose = (full, final) => {
        let t = String(full), writing = false;
        t = t.replace(/(```|~~~)[\s\S]*?\1/g, "\u0001");
        const k = t.search(/```|~~~/);
        if (k >= 0) { t = t.slice(0, k); writing = true; }
        else if (!final) {
          t = t.replace(/`{1,2}$/, "");
          // Hold back a half-written line that may turn out to be "File: name.ext".
          const nl = t.lastIndexOf("\n"), tail = t.slice(nl + 1);
          if (/^[ \t]*[*_#>`-]*[ \t]*(f|fi|fil|file|filen|filena|filenam|filename|s|sa|sav|save)\b/i.test(tail) || (tail.length < 8 && !/[.!?,]\s*$/.test(tail))) t = t.slice(0, nl + 1);
        }
        t = t.replace(HEADER, "");
        return { t, writing };
      };
      const out = (x) => { x = x.replace(/\u0001/g, " "); if (x.trim()) { this.say(x, voiceId); onSay?.(x); } };
      const flush = (force) => {
        for (;;) {
          if (first) {
            let cut = null;
            for (const b of pending.matchAll(/[,;:.!?]\s/g)) { const head = pending.slice(0, b.index + 2); if (words(head) >= 3) { cut = head; break; } }
            if (!cut && words(pending) >= 8 && /\s$/.test(pending) && !/\b(a|an|the|for|to|of|and|or|in|on|at|with|my|your|is|are|was)\s+$/i.test(pending)) cut = pending;
            if (cut) { first = false; out(cut); pending = pending.slice(cut.length); continue; }
          }
          const m = pending.match(/^[\s\S]*?[.!?](\s|$)/);
          if (m && (m[1] || force)) { first = false; out(m[0]); pending = pending.slice(m[0].length); continue; }
          if (words(pending) > 22) { const c = pending.match(/^([\s\S]{20,}?[,;:])\s/) || pending.match(/^((?:\S+\s+){18})/); if (c) { out(c[1]); pending = pending.slice(c[0].length); continue; } }
          break;
        }
        if (force && pending.trim()) { out(pending); pending = ""; }
      };
      const push = (full, final = false) => {
        const { t, writing } = prose(full, final);
        const add = t.slice(fed); fed = Math.max(fed, t.length);
        for (const part of add.split(/(\u0001)/)) { if (part === "\u0001") flush(true); else pending += part; }
        if (writing && !announced) { flush(true); announced = true; out("I'm making the file now."); }
        flush(final);
      };
      return { push: (full) => push(full), end: (full) => push(full, true) };
    },
    // Speak a whole reply, sentence by sentence.
    sayAll(text, voiceId) { for (const s of clean(text).match(/[^.!?]+[.!?]*\s*/g) || []) this.say(s, voiceId); },
  };
})();
