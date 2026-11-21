// Claude as one of your models, using your own Claude Pro (or Max) plan.
// The app doesn't talk to claude.ai itself. It uses the official Claude Code app on this computer,
// signed in with your Claude account, in its "print" mode (claude -p). So Claude here shares your
// plan's usage limit with claude.ai and the Claude app, and stops when the limit is reached.
import { spawn, execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const CLAUDE_FILE = "@claude";
// "" lets Claude Code pick your plan's default model.
export const CLAUDE_MODELS = [
  { id: "", name: "Your plan's default", blurb: "Whatever Claude Code normally uses on your plan. Recommended." },
  { id: "sonnet", name: "Sonnet", blurb: "Fast and very capable. Uses up your plan more slowly than Opus." },
  { id: "opus", name: "Opus", blurb: "The smartest, if your plan includes it. Uses up your limit fastest." },
  { id: "haiku", name: "Haiku", blurb: "The quickest, and the lightest on your plan. Good for voice mode." },
];
export const DEFAULT_CLAUDE_MODEL = "";
const CHAT_PROMPT = "You are Claude, chatting with the user inside a desktop app called Open Model Desktop. Answer conversationally and helpfully. Keep answers reasonably short unless asked for detail. You have no tools in this chat.";

// ---------- Finding Claude Code ----------
const home = os.homedir();
const isWin = process.platform === "win32";
function candidates() {
  const list = [];
  for (const dir of (process.env.PATH || "").split(path.delimiter)) if (dir) list.push(path.join(dir, isWin ? "claude.exe" : "claude"));
  if (isWin) {
    list.push(path.join(home, ".local", "bin", "claude.exe"));
    list.push(path.join(process.env.LOCALAPPDATA || path.join(home, "AppData", "Local"), "Programs", "claude", "claude.exe"));
  } else {
    list.push(path.join(home, ".local", "bin", "claude"), path.join(home, ".claude", "local", "claude"), "/opt/homebrew/bin/claude", "/usr/local/bin/claude", "/usr/bin/claude");
  }
  return list;
}
// npm installs (npm i -g @anthropic-ai/claude-code) are a .cmd on Windows; run their script with the Node.js inside this app instead.
function npmScript() {
  const roots = isWin ? [path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), "npm", "node_modules")]
    : ["/usr/local/lib/node_modules", "/opt/homebrew/lib/node_modules", path.join(home, ".npm-global", "lib", "node_modules")];
  for (const r of roots) { const f = path.join(r, "@anthropic-ai", "claude-code", "cli.js"); if (fs.existsSync(f)) return f; }
  return null;
}
function findClaude() {
  for (const f of candidates()) { try { if (fs.statSync(f).isFile()) return { command: f, pre: [], env: {} }; } catch {} }
  const js = npmScript();
  if (js) return { command: process.execPath, pre: [js], env: { ELECTRON_RUN_AS_NODE: "1" } };
  return null;
}
// Never let an API key in the environment turn this into pay-per-use billing: always use the signed-in plan.
function childEnv(extra) {
  const env = { ...process.env, ...extra };
  delete env.ANTHROPIC_API_KEY; delete env.ANTHROPIC_AUTH_TOKEN; delete env.ANTHROPIC_BASE_URL;
  return env;
}
function run(bin, args, timeoutMs = 20000) {
  return new Promise((resolve) => {
    execFile(bin.command, [...bin.pre, ...args], { env: childEnv(bin.env), timeout: timeoutMs, windowsHide: true }, (err, stdout, stderr) =>
      resolve({ ok: !err, stdout: String(stdout || ""), stderr: String(stderr || ""), err }));
  });
}

// ---------- Plain-English errors ----------
const LIMIT_RE = /usage limit|limit reached|hit your (usage |weekly |session )?limit|reached your (usage |weekly )?limit|out of (extra )?usage/i;
const LOGIN_RE = /not logged in|please run \/login|\/login|log ?in again|invalid (api key|bearer|token)|oauth token|authentication|401/i;
export function limitMessage(text) {
  const epoch = /\|(\d{9,13})\b/.exec(text);
  let when = "";
  if (epoch) {
    const d = new Date(+epoch[1] * (epoch[1].length > 10 ? 1 : 1000));
    when = d.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
  } else {
    const m = /resets?\s+(?:at\s+|on\s+)?([^\n·|]+?)(?:\s*[·|.]|\s*$)/im.exec(text);
    if (m) when = m[1].trim();
  }
  return { limit: true, resets: when, message: `You've used up your Claude plan for now${when ? `. It resets ${/^\d|^[a-z]{3} /i.test(when) ? "at " : ""}${when}` : ""}. Your downloaded models still work.` };
}
function friendly(text) {
  const t = String(text || "").trim();
  if (LIMIT_RE.test(t)) { const l = limitMessage(t); return Object.assign(new Error(l.message), l); }
  if (LOGIN_RE.test(t)) return Object.assign(new Error("Claude Code isn't signed in to your Claude account. Open Settings → Claude to sign in."), { login: true });
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|network|fetch failed|connection/i.test(t)) return new Error("Couldn't reach Claude. Claude needs the internet (your downloaded models don't).");
  return new Error("Claude couldn't answer: " + (t.split("\n").find((l) => l.trim()) || "unknown problem").slice(0, 300));
}

export function createClaude({ getModel, onChunk, workDir }) {
  let sessionId = null, systemPrompt = null, child = null, stopped = false;

  return {
    reset(sp = null) { sessionId = null; systemPrompt = sp; },
    stop() { stopped = true; try { child?.kill(); } catch {} },

    // Is Claude Code installed, and signed in with a Claude plan (not an API key)?
    async status() {
      const bin = findClaude();
      if (!bin) return { installed: false };
      const v = await run(bin, ["--version"]);
      const version = (v.stdout.match(/\d+\.\d+\.\d+/) || [""])[0];
      const a = await run(bin, ["auth", "status", "--json"]);
      let auth = {};
      try { auth = JSON.parse(a.stdout); } catch {}
      const method = String(auth.authMethod || "");
      return {
        installed: true, version, path: bin.pre[0] || bin.command,
        loggedIn: !!auth.loggedIn,
        usesPlan: !!auth.loggedIn && !/api[_ ]?key|console/i.test(method),
        method, account: auth.email || auth.account?.email || "", plan: auth.subscriptionType || auth.plan || "",
      };
    },

    // Opens a sign-in window for your Claude account (runs "claude auth login").
    async login() {
      const bin = findClaude();
      if (!bin) throw new Error("Install Claude Code first (see the steps in Settings → Claude).");
      const r = await run(bin, ["auth", "login"], 5 * 60 * 1000);
      if (!r.ok) throw new Error("Sign-in didn't finish. You can also open a terminal, type claude, then /login.");
      return this.status();
    },

    async send({ text, systemPrompt: sp = null, turnId }) {
      if ((sp ?? null) !== systemPrompt) this.reset(sp);
      const bin = findClaude();
      if (!bin) throw Object.assign(new Error("Claude Code isn't installed on this computer. Open Settings → Claude for the one-line install."), { install: true });
      fs.mkdirSync(workDir, { recursive: true });
      const model = await getModel();
      const args = [...bin.pre, "-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages",
        "--tools", "", "--strict-mcp-config", "--system-prompt", systemPrompt || CHAT_PROMPT,
        ...(model ? ["--model", model] : []), ...(sessionId ? ["--resume", sessionId] : [])];
      stopped = false;
      const proc = spawn(bin.command, args, { cwd: workDir, env: childEnv(bin.env), windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
      child = proc;
      proc.stdin.end(text);

      let buf = "", errText = "", streamed = "", result = null, newSession = null, modelUsed = "";
      const handle = (m) => {
        if (m.session_id) newSession = m.session_id;
        if (m.type === "system" && m.subtype === "init") modelUsed = m.model || "";
        if (m.type === "stream_event" && m.event?.type === "content_block_delta") {
          const d = m.event.delta;
          if (d.type === "text_delta") { streamed += d.text; onChunk({ turnId, kind: "text", text: d.text }); }
          else if (d.type === "thinking_delta" && d.thinking) onChunk({ turnId, kind: "thought", text: d.thinking });
        }
        // Older Claude Code without partial messages: send whole text blocks as they arrive.
        if (m.type === "assistant" && !streamed) {
          const t = (m.message?.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
          if (t && !LIMIT_RE.test(t)) { streamed += t; onChunk({ turnId, kind: "text", text: t }); }
          else if (t) errText += t;
        }
        if (m.type === "result") result = m;
      };
      proc.stdout.setEncoding("utf8");
      proc.stdout.on("data", (c) => {
        buf += c; let i;
        while ((i = buf.indexOf("\n")) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (!line) continue; try { handle(JSON.parse(line)); } catch {} }
      });
      proc.stderr.setEncoding("utf8");
      proc.stderr.on("data", (c) => { errText += c; });
      const code = await new Promise((resolve) => { proc.on("error", (e) => { errText += e.message; resolve(-1); }); proc.on("close", resolve); });
      if (child === proc) child = null;
      if (stopped) { if (newSession) sessionId = newSession; return { text: streamed, stopped: true, model: "Claude" }; }

      const answer = result?.result ?? streamed;
      if (!result || result.is_error || code !== 0) throw friendly([result?.result, errText, result?.subtype].filter(Boolean).join("\n") || `Claude Code stopped (code ${code}).`);
      if (LIMIT_RE.test(answer) && answer.length < 300 && !streamed.trim()) throw friendly(answer);
      if (newSession) sessionId = newSession;
      const nice = /opus/i.test(modelUsed) ? "Claude Opus" : /haiku/i.test(modelUsed) ? "Claude Haiku" : /sonnet/i.test(modelUsed) ? "Claude Sonnet" : "Claude";
      return { text: answer, model: nice, plan: true };
    },
  };
}
