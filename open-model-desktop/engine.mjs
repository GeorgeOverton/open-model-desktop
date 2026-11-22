// Model runtime. Runs in its own background process so a crash can't take the app down.
// Uses node-llama-cpp, which bundles llama.cpp and picks Metal, CUDA, Vulkan or CPU automatically.
import { getLlama, LlamaChatSession } from "node-llama-cpp";

const port = process.parentPort;
const post = (m) => port.postMessage(m);
const status = (data) => post({ event: "status", data });

let llama = null, model = null, context = null, seq = null, chat = null;
let file = null, systemPrompt = null, abort = null;
let chatConv = null;   // which saved chat the current session holds, so a reopened chat (or a new model) gets its history back

async function unload() {
  abort?.abort();
  try { chat?.dispose({ disposeSequence: false }); } catch {}
  try { await context?.dispose(); } catch {}
  try { await model?.dispose(); } catch {}
  chat = context = model = seq = null; file = null;
  status({ state: "idle" });
}

async function newChat(sp) {
  if (chat) chat.dispose({ disposeSequence: false });
  seq ??= context.getSequence();
  await seq.clearHistory();
  systemPrompt = sp ?? null;
  chatConv = null;
  chat = new LlamaChatSession({ contextSequence: seq, ...(systemPrompt ? { systemPrompt } : {}) });
}

async function load({ file: f, path }) {
  if (file === f && model) return { file };
  await unload();
  status({ state: "loading", file: f });
  try {
    llama ??= await getLlama();
    model = await llama.loadModel({ modelPath: path, onLoadProgress: (p) => status({ state: "loading", file: f, progress: p }) });
    context = await model.createContext({ contextSize: { max: 8192 } });
    file = f;
    await newChat(null);
  } catch (err) {
    await unload();
    throw new Error(/memory|alloc|VRAM/i.test(err.message)
      ? "Your computer ran out of memory loading this model. Try a smaller model or a smaller version (for example Q4 or Q3)."
      : /architecture|unknown model/i.test(err.message)
        ? "This model's type isn't supported yet. Try a different model."
        : "Couldn't load this model: " + err.message);
  }
  status({ state: "ready", file, gpu: llama.gpu || false });
  return { file, gpu: llama.gpu || false };
}

async function send({ text, file: f, path, systemPrompt: sp, turnId, convId = null, history = null, fast = false }) {
  if (f && f !== file) await load({ file: f, path });
  if (!chat) throw new Error("Pick a model first.");
  if ((sp ?? null) !== systemPrompt) await newChat(sp);
  if (!convId) { if (chatConv) await newChat(sp); }
  else if (chatConv !== convId) {
    // A different conversation (or a fresh model): start clean, then put the earlier messages back.
    await newChat(sp);
    if (history?.length) chat.setChatHistory([...chat.getChatHistory().filter((h) => h.type === "system"),
      ...history.map((m) => (m.role === "user" ? { type: "user", text: m.text } : { type: "model", response: [m.text] }))]);
    chatConv = convId;
  }
  abort = new AbortController();
  try {
    const answer = await chat.prompt(text, {
      signal: abort.signal, stopOnAbortSignal: true, maxTokens: 4096,
      ...(fast ? { budgets: { thoughtTokens: 0 } } : {}),   // Voice mode: skip "thinking" so it starts talking straight away
      onResponseChunk: (c) => post({ event: "chunk", data: { turnId, kind: c.type === "segment" && c.segmentType === "thought" ? "thought" : "text", text: c.text } }),
    });
    return { text: answer };
  } finally { abort = null; }
}

// One-off question from another app (the Claude app). Uses a fresh conversation and then puts
// the chat you have open in this app back exactly as it was.
async function ask({ text, file: f, path, systemPrompt: sp, maxTokens = 2048 }) {
  if (f && f !== file) await load({ file: f, path });
  if (!context) throw new Error("No model is running.");
  const keep = chat?.getChatHistory(), keepSp = systemPrompt;
  try { chat?.dispose({ disposeSequence: false }); } catch {}
  chat = null;
  seq ??= context.getSequence();
  await seq.clearHistory();
  const once = new LlamaChatSession({ contextSequence: seq, ...(sp ? { systemPrompt: sp } : {}) });
  abort = new AbortController();
  try {
    const answer = await once.prompt(text, { signal: abort.signal, stopOnAbortSignal: true, maxTokens });
    return { text: answer, file };
  } finally {
    abort = null;
    try { once.dispose({ disposeSequence: false }); } catch {}
    await seq.clearHistory();
    systemPrompt = keepSp;
    chat = new LlamaChatSession({ contextSequence: seq, ...(keepSp ? { systemPrompt: keepSp } : {}) });
    if (keep) chat.setChatHistory(keep);
  }
}

// One thing at a time: a question from the Claude app waits for the answer you're getting here, and the other way round.
let queue = Promise.resolve();
const serial = (fn) => (args) => { const run = queue.then(() => fn(args)); queue = run.catch(() => {}); return run; };
const ops = {
  load: serial(load), send: serial(send), ask: serial(ask),
  unload: (a) => { abort?.abort(); return serial(unload)(a); },
  reset: serial(async ({ systemPrompt: sp }) => { if (context) await newChat(sp); }),
};

port.on("message", async ({ data }) => {
  if (data.op === "stop") { abort?.abort(); return; }
  try { post({ id: data.id, result: await ops[data.op](data.args || {}) }); }
  catch (err) { post({ id: data.id, error: err.message || String(err) }); }
});
