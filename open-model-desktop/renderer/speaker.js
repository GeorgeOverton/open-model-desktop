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
    // Speak a whole reply, sentence by sentence.
    sayAll(text, voiceId) { for (const s of clean(text).match(/[^.!?]+[.!?]*\s*/g) || []) this.say(s, voiceId); },
  };
})();
