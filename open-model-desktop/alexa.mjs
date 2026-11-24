// Amazon Alexa: "Alexa, ask my computer ..." answered by a model on this PC.
// Amazon's servers reach the PC through a tunnel (ngrok, started by the app), which forwards to a server that only listens on
// this PC (127.0.0.1). Every request is checked: it must be signed by Amazon (certificate chain + signature), be recent,
// and come from YOUR skill (its skill ID). Anything else is refused.
import http from "node:http";
import tls from "node:tls";
import fs from "node:fs";
import crypto from "node:crypto";
import { spawn, execFile } from "node:child_process";

export const ALEXA_PORT = 8770;
// "Alexa, ask my computer what is ..." — Alexa doesn't pass on the first word, so each opening word has its own intent.
const OPENERS = [["what", "what"], ["whats", "what's"], ["who", "who"], ["how", "how"], ["why", "why"], ["when", "when"], ["where", "where"], ["which", "which"],
  ["is", "is"], ["are", "are"], ["can_you", "can you"], ["could_you", "could you"], ["tell_me", "tell me"], ["write", "write"], ["make", "make"],
  ["explain", "explain"], ["give_me", "give me"], ["help_me", "help me"], ["should_i", "should I"], ["do", "do"], ["does", "does"], ["please", ""], ["about", "tell me about"]];
const spokenOf = (w) => w.replace(/_/g, " ").replace("whats", "what's");

// The skill's "interaction model", to paste into the Alexa developer console (JSON Editor).
export function interactionModel(invocation = "my computer") {
  const intents = OPENERS.map(([id]) => ({ name: "Ask_" + id, slots: [{ name: "question", type: "AMAZON.SearchQuery" }], samples: [`${spokenOf(id)} {question}`] }));
  intents.push(
    { name: "AnswerIntent", slots: [], samples: ["what's the answer", "what is the answer", "are you done", "is it ready", "tell me the answer", "what did you find", "go on", "the answer"] },
    { name: "NewChatIntent", slots: [], samples: ["start over", "new conversation", "new chat", "forget that"] },
    { name: "AMAZON.StopIntent", samples: [] }, { name: "AMAZON.CancelIntent", samples: [] }, { name: "AMAZON.HelpIntent", samples: [] },
    { name: "AMAZON.FallbackIntent", samples: [] }, { name: "AMAZON.NavigateHomeIntent", samples: [] });
  return { interactionModel: { languageModel: { invocationName: invocation.toLowerCase().replace(/[^a-z ]/g, "").trim() || "my computer", intents, types: [] } } };
}

// ---------- Checking a request really comes from Amazon ----------
export function certUrlOk(u) {
  try {
    const x = new URL(u);
    if (x.protocol.toLowerCase() !== "https:" || x.hostname.toLowerCase() !== "s3.amazonaws.com") return false;
    if (x.port && x.port !== "443") return false;
    const p = x.pathname.split("/").reduce((a, s) => (s === ".." ? a.slice(0, -1) : s && s !== "." ? [...a, s] : a), []);
    return p[0] === "echo.api";
  } catch { return false; }
}
const certCache = new Map();
async function fetchChain(url) {
  if (process.env.OMD_ALEXA_TEST_CHAIN) return fs.readFileSync(process.env.OMD_ALEXA_TEST_CHAIN, "utf8");   // tests only
  const hit = certCache.get(url); if (hit && hit.until > Date.now()) return hit.pem;
  const r = await fetch(url); if (!r.ok) throw new Error("Couldn't get Amazon's certificate.");
  const pem = await r.text();
  certCache.set(url, { pem, until: Date.now() + 3600000 });
  return pem;
}
let roots = null;
const trusted = () => roots ||= [...tls.rootCertificates, ...(process.env.OMD_ALEXA_TEST_ROOT ? [fs.readFileSync(process.env.OMD_ALEXA_TEST_ROOT, "utf8")] : [])].map((p) => { try { return new crypto.X509Certificate(p); } catch { return null; } }).filter(Boolean);
export async function verifyAmazon(headers, raw, now = Date.now()) {
  const url = headers["signaturecertchainurl"], sig = headers["signature-256"];
  if (!url || !sig || !certUrlOk(url)) throw new Error("not signed by Amazon");
  const certs = (await fetchChain(url)).match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g)?.map((p) => new crypto.X509Certificate(p)) || [];
  const leaf = certs[0];
  if (!leaf) throw new Error("no certificate");
  if (now < Date.parse(leaf.validFrom) || now > Date.parse(leaf.validTo)) throw new Error("certificate expired");
  if (!/(^|,\s*)DNS:echo-api\.amazon\.com(,|$)/.test(leaf.subjectAltName || "")) throw new Error("wrong certificate");
  for (let i = 0; i < certs.length - 1; i++) if (!certs[i].checkIssued(certs[i + 1]) || !certs[i].verify(certs[i + 1].publicKey)) throw new Error("broken certificate chain");
  const top = certs[certs.length - 1];
  if (!trusted().some((r) => (top.fingerprint256 === r.fingerprint256) || (top.checkIssued(r) && top.verify(r.publicKey)))) throw new Error("untrusted certificate");
  const v = crypto.createVerify("RSA-SHA256"); v.update(raw);
  if (!v.verify(leaf.publicKey, Buffer.from(sig, "base64"))) throw new Error("bad signature");
}

// What Alexa says: plain sentences, no code or markdown, within Alexa's limits.
export function speakable(text) {
  let t = String(text || "").replace(/```[\s\S]*?(```|$)/g, " I've written some code; open the app on your PC to see it. ")
    .replace(/<think>[\s\S]*?<\/think>/g, "").replace(/`([^`]+)`/g, "$1").replace(/\*\*([^*]+)\*\*/g, "$1").replace(/^#+\s*/gm, "").replace(/^\s*[-*]\s+/gm, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/[*_#>|]/g, "").replace(/\s+/g, " ").trim();
  if (t.length > 6000) t = t.slice(0, 6000).replace(/[^.!?]*$/, "") + " That's the first part. The rest is on your PC.";
  return t;
}
const reply = (text, { end = false, reprompt = "", card = "" } = {}) => ({
  version: "1.0",
  response: {
    outputSpeech: { type: "PlainText", text: text.slice(0, 7900) },
    ...(card ? { card: { type: "Simple", title: "Your PC", content: card.slice(0, 7900) } } : {}),
    ...(reprompt && !end ? { reprompt: { outputSpeech: { type: "PlainText", text: reprompt } } } : {}),
    shouldEndSession: end,
  },
});

export function createAlexa({ getSettings, chatSend, modelName, saveChat, onStatus, wait = 6500 }) {
  let server = null, tunnel = null, status = { server: false, tunnel: "off", url: "", error: "", last: 0 };
  const jobs = new Map();       // Alexa user -> { promise, text, done, error, question }
  const convs = new Map();      // Alexa user -> { id, history, at }
  const set = (p) => { status = { ...status, ...p }; onStatus?.(status); };
  const newId = () => Date.now().toString(36) + crypto.randomBytes(4).toString("hex");

  function ask(user, question, s) {
    let c = convs.get(user);
    if (!c || Date.now() - c.at > 30 * 60000) c = { id: newId(), history: [], messages: [], at: Date.now() };
    convs.set(user, c);
    const file = s.alexaModel || "@auto";
    const job = { question, done: false, text: "", error: "" };
    job.promise = chatSend({ text: question, file, turnId: "alexa-" + crypto.randomBytes(5).toString("hex"), convId: c.id, history: c.history.slice(-12), fast: true, files: false, via: "alexa",
      systemPrompt: "You are answering through an Amazon Alexa speaker, so your answer is read out loud. Answer in two to four short, natural spoken sentences. No lists, tables, markdown, emoji or code unless asked." })
      .then(async (r) => {
        job.text = speakable(r?.text || ""); job.done = true; c.at = Date.now();
        c.history.push({ role: "user", text: question }, { role: "bot", text: r?.text || "" });
        saveChat?.({ id: c.id, title: question, messages: c.messages, model: r?.routed?.file || file, text: question, answer: r?.text || "", device: "Alexa", mark: "🔊" }).catch(() => {});
        c.messages.push({ role: "user", text: question, at: Date.now() }, { role: "bot", text: r?.text || "", model: file });
      })
      .catch((err) => { job.error = String(err.message || err).replace(/^Error: /, ""); job.done = true; });
    jobs.set(user, job);
    return job;
  }
  const settle = (job, ms) => Promise.race([job.promise, new Promise((r) => setTimeout(r, ms))]);
  function answerOf(job) {
    if (job.error) return reply(`Sorry, that didn't work. ${speakable(job.error)}`, { reprompt: "Anything else?", end: false });
    const t = job.text || "I don't have an answer for that.";
    return reply(t + " Anything else?", { reprompt: "Ask me something else, or say stop.", card: `${job.question}\n\n${t}` });
  }
  async function handle(body, s) {
    const user = body.session?.user?.userId || body.context?.System?.user?.userId || "x";
    const req = body.request || {};
    const auto = String(s.alexaModel || "@auto").startsWith("@auto");
    const online = s.alexaModel === "@claude";
    const name = auto ? "your computer" : await modelName(s.alexaModel), who = auto ? "your computer" : online ? name : `${name} on your PC`, Who = who.charAt(0).toUpperCase() + who.slice(1);
    if (req.type === "LaunchRequest") return reply(`Hi, it's ${who}. What would you like to know?`, { reprompt: "Ask me anything, for example, what's a good name for a cat?" });
    if (req.type === "SessionEndedRequest") return { version: "1.0", response: {} };
    if (req.type !== "IntentRequest") return reply("Sorry, I can't do that.", { end: true });
    const intent = req.intent?.name || "";
    if (intent === "AMAZON.StopIntent" || intent === "AMAZON.CancelIntent" || intent === "AMAZON.NavigateHomeIntent") return reply("Bye.", { end: true });
    if (intent === "AMAZON.HelpIntent") return reply(`Ask me anything and ${who} answers. Long answers can take a while. If I say I'm still thinking, say: what's the answer. Say start over for a new conversation.`, { reprompt: "What would you like to know?" });
    if (intent === "NewChatIntent") { convs.delete(user); jobs.delete(user); return reply("Okay, starting fresh. What would you like to know?", { reprompt: "What would you like to know?" }); }
    if (intent === "AnswerIntent") {
      const job = jobs.get(user);
      if (!job) return reply("I'm not working on anything. What would you like to know?", { reprompt: "What would you like to know?" });
      if (!job.done) await settle(job, wait);
      if (!job.done) return reply("Still thinking. Ask me again in a few seconds.", { reprompt: "Say what's the answer." });
      jobs.delete(user);
      return answerOf(job);
    }
    const opener = OPENERS.find(([id]) => intent === "Ask_" + id);
    const slot = req.intent?.slots?.question?.value;
    if (intent === "AMAZON.FallbackIntent" || !opener || !slot) return reply("Sorry, I didn't catch a question. Try starting with what, how, or tell me.", { reprompt: "What would you like to know?" });
    const question = (opener[1] ? opener[1] + " " : "") + slot;
    if (/^(what'?s|what is) the answer$|^(are you done|is it ready)$/i.test(question.trim())) return handle({ ...body, request: { ...req, intent: { name: "AnswerIntent" } } }, s);
    const busy = jobs.get(user);
    if (busy && !busy.done) return reply("I'm still working on your last question. Say what's the answer in a few seconds.", { reprompt: "Say what's the answer." });
    const asking = /^(what|whats|who|how|why|when|where|which|is|are|can_you|could_you|should_i|do|does)$/.test(opener[0]);
    const job = ask(user, question.charAt(0).toUpperCase() + question.slice(1) + (/[?.!]$/.test(question) ? "" : asking ? "?" : "."), s);
    await settle(job, wait);
    if (!job.done) return reply(`Good question. ${Who} is still thinking. Say what's the answer in a few seconds.`, { reprompt: "Say what's the answer." });
    jobs.delete(user);
    return answerOf(job);
  }

  async function onRequest(req, res) {
    const no = (code, msg) => { res.writeHead(code, { "content-type": "text/plain" }); res.end(msg); };
    if (req.method !== "POST" || new URL(req.url, "http://x").pathname !== "/alexa") return no(404, "Not found");
    const parts = []; let n = 0;
    for await (const c of req) { n += c.length; if (n > 200000) return no(413, "Too big"); parts.push(c); }
    const raw = Buffer.concat(parts);
    const s = await getSettings();
    try { await verifyAmazon(req.headers, raw); } catch (err) { set({ error: "Refused a request that wasn't from Amazon (" + err.message + ")." }); return no(400, "Bad request"); }
    let body; try { body = JSON.parse(raw.toString("utf8")); } catch { return no(400, "Bad request"); }
    const ts = Date.parse(body.request?.timestamp || "");
    if (!ts || Math.abs(Date.now() - ts) > 150000) return no(400, "Too old");
    const appId = body.session?.application?.applicationId || body.context?.System?.application?.applicationId;
    if (!s.alexaSkillId || appId !== s.alexaSkillId.trim()) { set({ error: "Refused a request from a different Alexa skill. Check the skill ID in Settings → Amazon Alexa." }); return no(400, "Wrong skill"); }
    set({ last: Date.now(), error: "" });
    const out = await handle(body, s);
    res.writeHead(200, { "content-type": "application/json;charset=UTF-8" });
    res.end(JSON.stringify(out));
  }

  // ---------- The tunnel (ngrok, installed separately) ----------
  const findNgrok = (custom) => new Promise((resolve) => {
    if (custom && fs.existsSync(custom)) return resolve(custom);
    execFile(process.platform === "win32" ? "where" : "which", ["ngrok"], (err, out) => resolve(err ? "" : String(out).split(/\r?\n/)[0].trim()));
  });
  async function startTunnel(s) {
    stopTunnel();
    if (!s.alexaNgrokToken || !s.alexaDomain) return set({ tunnel: "needs-setup", url: "" });
    const bin = await findNgrok(s.alexaNgrokPath);
    if (!bin) return set({ tunnel: "no-ngrok", url: "" });
    const domain = s.alexaDomain.replace(/^https?:\/\//, "").replace(/\/.*$/, "").trim();
    const env = { ...process.env, NGROK_AUTHTOKEN: s.alexaNgrokToken.trim() };
    set({ tunnel: "starting", url: "" });
    const p = spawn(bin, ["http", String(ALEXA_PORT), "--url", "https://" + domain, "--log", "stdout", "--log-format", "json"], { env, windowsHide: true });
    tunnel = p;
    let buf = "";
    p.stdout.on("data", (c) => {
      buf += c; let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        try {
          const j = JSON.parse(line);
          if (j.url && /started tunnel/i.test(j.msg || "")) set({ tunnel: "on", url: j.url.replace(/\/$/, "") + "/alexa", error: "" });
          if (j.lvl === "eror" || j.err) set({ error: "ngrok: " + String(j.err || j.msg).replace(/\s+/g, " ").slice(0, 240) });
        } catch {}
      }
    });
    p.stderr.on("data", (c) => set({ error: "ngrok: " + String(c).trim().slice(0, 240) }));
    p.on("exit", (code) => { if (tunnel !== p) return; tunnel = null; set({ tunnel: "off", url: "", ...(code ? { error: status.error || `ngrok stopped (code ${code}). Check the authtoken and domain.` } : {}) }); });
    p.on("error", (err) => set({ tunnel: "off", error: "Couldn't start ngrok: " + err.message }));
  }
  function stopTunnel() { if (tunnel) { const p = tunnel; tunnel = null; p.kill(); } }

  return {
    get status() { return status; },
    async start() {
      const s = await getSettings();
      if (!server) {
        server = http.createServer((req, res) => onRequest(req, res).catch((err) => { try { res.writeHead(500); res.end(String(err.message)); } catch {} }));
        server.requestTimeout = 30000;
        await new Promise((resolve, reject) => { server.once("error", reject); server.listen(ALEXA_PORT, "127.0.0.1", resolve); }).catch((err) => { server = null; set({ error: err.code === "EADDRINUSE" ? `Port ${ALEXA_PORT} is in use by another program.` : err.message }); throw err; });
        set({ server: true });
      }
      if (!process.env.OMD_ALEXA_NO_TUNNEL) await startTunnel(s);
    },
    async stop() {
      stopTunnel();
      if (server) { const sv = server; server = null; sv.closeAllConnections?.(); await new Promise((r) => sv.close(() => r())); }
      set({ server: false, tunnel: "off", url: "" });
    },
    clearError: () => set({ error: "" }),
    restartTunnel: async () => { if (server && !process.env.OMD_ALEXA_NO_TUNNEL) await startTunnel(await getSettings()); },
    findNgrok,
  };
}
