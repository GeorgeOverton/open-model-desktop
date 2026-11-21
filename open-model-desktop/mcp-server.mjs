// Lets the Claude app (Claude Desktop, Claude Code) use the models downloaded in Open Model Desktop.
// Claude starts this small program and talks to it over stdin/stdout using the Model Context Protocol.
// It passes each request on to the running Open Model Desktop app, starting the app if needed.
// No extra packages: it runs on the Node.js that ships inside the app (ELECTRON_RUN_AS_NODE=1).
import fs from "node:fs";
import http from "node:http";
import { spawn } from "node:child_process";
import readline from "node:readline";

const BRIDGE = process.env.OMD_BRIDGE;
const LAUNCH = (() => { try { return JSON.parse(process.env.OMD_LAUNCH || "null"); } catch { return null; } })();
const VERSION = process.env.OMD_VERSION || "0.0.0";
const log = (...a) => process.stderr.write("[open-model-desktop] " + a.join(" ") + "\n");

const TOOLS = [
  {
    name: "list_local_models",
    description: "List the AI models downloaded in Open Model Desktop on this computer, with their size and which one is running now. These models run fully offline on the user's own computer.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "ask_local_model",
    description: "Send a prompt to one of the user's local models in Open Model Desktop and get its full answer back. Runs offline on the user's computer, so it's private and free but slower and less capable than Claude. Each call is a fresh conversation, so include any context the model needs in the prompt. If no model is named, the running model is used (or the first downloaded one).",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "What to ask the local model." },
        model: { type: "string", description: "Optional. Name or file of a downloaded model, as shown by list_local_models (a partial name like 'qwen' is fine)." },
        system_prompt: { type: "string", description: "Optional. Instructions for how the local model should behave." },
        max_tokens: { type: "integer", minimum: 16, maximum: 4096, description: "Optional. Longest answer to allow (default 2048)." },
      },
      required: ["prompt"],
      additionalProperties: false,
    },
  },
  {
    name: "speak_aloud",
    description: "Read some text out loud on the user's computer with Open Model Desktop's natural English voices (for example Hannah, Emma or George).",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "What to say." },
        voice: { type: "string", description: "Optional. A voice name: Hannah, Bella, Emma, Nicole, Michael, Ryan, Jack, Sarah, George, Isabella or Oliver." },
      },
      required: ["text"],
      additionalProperties: false,
    },
  },
];

// ---------- Talking to the app ----------
function readBridge() { try { return JSON.parse(fs.readFileSync(BRIDGE, "utf8")); } catch { return null; } }
function call(b, method, route, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({ host: "127.0.0.1", port: b.port, path: route, method, timeout: timeoutMs,
      headers: { authorization: "Bearer " + b.token, "content-type": "application/json", ...(data ? { "content-length": Buffer.byteLength(data) } : {}) } }, (res) => {
      let out = ""; res.setEncoding("utf8");
      res.on("data", (c) => { out += c; });
      res.on("end", () => {
        let j; try { j = JSON.parse(out); } catch { j = { error: out || "No answer from Open Model Desktop." }; }
        res.statusCode >= 400 ? reject(Object.assign(new Error(j.error || "HTTP " + res.statusCode), { app: true })) : resolve(j);
      });
    });
    req.on("timeout", () => req.destroy(new Error("Open Model Desktop took too long to answer.")));
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let launched = false;
async function bridge() {
  let b = readBridge();
  if (b) { try { await call(b, "GET", "/ping", null, 3000); return b; } catch {} }
  if (!LAUNCH?.command) throw new Error("Open Model Desktop isn't running. Please open it and try again.");
  if (!launched) {
    launched = true;
    log("starting Open Model Desktop");
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    spawn(LAUNCH.command, [...(LAUNCH.args || []), "--background"], { detached: true, stdio: "ignore", env }).unref();
  }
  for (let i = 0; i < 60; i++) {
    await wait(500);
    b = readBridge();
    if (b) { try { await call(b, "GET", "/ping", null, 2000); return b; } catch {} }
  }
  throw new Error("Couldn't start Open Model Desktop. Please open it yourself and try again.");
}

async function runTool(name, args = {}) {
  const b = await bridge();
  if (name === "list_local_models") {
    const r = await call(b, "GET", "/models", null, 10000);
    if (!r.models.length) return "No models are downloaded yet. The user can download one in Open Model Desktop under Find models.";
    return r.models.map((m) => `- ${m.name}${m.quant ? ` (${m.quant})` : ""}, ${m.sizeGB} GB, file "${m.file}"${m.running ? " [running now]" : ""}${m.chat ? "" : " [search model, can't chat]"}`).join("\n");
  }
  if (name === "ask_local_model") {
    if (!args.prompt || typeof args.prompt !== "string") throw new Error("Please give a prompt.");
    const r = await call(b, "POST", "/ask", { prompt: args.prompt, model: args.model || "", system: args.system_prompt || "", maxTokens: args.max_tokens }, 15 * 60 * 1000);
    return `${r.text}\n\n(answered by ${r.model}, running locally in Open Model Desktop)`;
  }
  if (name === "speak_aloud") {
    await call(b, "POST", "/say", { text: String(args.text || ""), voice: args.voice || "" }, 10000);
    return "Speaking it out loud now.";
  }
  throw new Error("Unknown tool: " + name);
}

// ---------- Model Context Protocol over stdio (one JSON message per line) ----------
const write = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");
const reply = (id, result) => write({ jsonrpc: "2.0", id, result });
const fail = (id, code, message) => write({ jsonrpc: "2.0", id, error: { code, message } });

async function handle(msg) {
  const { id, method, params } = msg;
  if (id === undefined || id === null) return; // notifications, e.g. notifications/initialized
  switch (method) {
    case "initialize":
      return reply(id, {
        protocolVersion: params?.protocolVersion || "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "open-model-desktop", title: "Open Model Desktop", version: VERSION },
        instructions: "Use these tools to run the user's own offline AI models from Open Model Desktop, or to read text aloud with its voices.",
      });
    case "ping": return reply(id, {});
    case "tools/list": return reply(id, { tools: TOOLS });
    case "tools/call":
      try {
        const text = await runTool(params?.name, params?.arguments);
        return reply(id, { content: [{ type: "text", text }] });
      } catch (err) {
        return reply(id, { content: [{ type: "text", text: err.message || String(err) }], isError: true });
      }
    case "resources/list": return reply(id, { resources: [] });
    case "prompts/list": return reply(id, { prompts: [] });
    default: return fail(id, -32601, "Method not found: " + method);
  }
}

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (!line.trim()) return;
  let msg; try { msg = JSON.parse(line); } catch { return fail(null, -32700, "Parse error"); }
  handle(msg).catch((err) => { if (msg.id != null) fail(msg.id, -32603, err.message); });
});
rl.on("close", () => process.exit(0));
