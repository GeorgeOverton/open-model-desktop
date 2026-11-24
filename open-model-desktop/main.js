// Open Model Desktop: main process.
// Owns the window, file downloads, the local model runtime (node-llama-cpp) and settings.
import { app, BrowserWindow, ipcMain, protocol, shell, session, net, utilityProcess, systemPreferences, Tray, Menu, Notification, nativeImage, clipboard, dialog } from "electron";
import path from "node:path";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import http from "node:http";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createClaude, CLAUDE_FILE, CLAUDE_MODELS, DEFAULT_CLAUDE_MODEL, CHAT_PROMPT } from "./claude.mjs";
import { TASKS, TIERS, guessTask, parseTask, ROUTER_PROMPT, pickRouter, pickModel as pickBest } from "./router.mjs";
import electronUpdater from "electron-updater";
import { extract as extractFile } from "./attach.mjs";
import { createCast } from "./cast.mjs";
import { createAlexa, interactionModel, ALEXA_PORT } from "./alexa.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
// OMD_HF_MIRROR lets people (or tests) download from a Hugging Face mirror instead.
const HF = process.env.OMD_HF_MIRROR || "https://huggingface.co";
// Offline speech pack used for wake phrases and voice commands (about 40 MB, English).
const VOICE_PACK = {
  url: "https://ccoreilly.github.io/vosk-browser/models/vosk-model-small-en-us-0.15.tar.gz",
  file: "vosk-model-small-en-us-0.15.tar.gz",
};

// ---------- Where things live ----------
const dataDir = () => app.getPath("userData");
const modelsDir = () => path.join(dataDir(), "models");
const voiceDir = () => path.join(dataDir(), "voice");
const settingsFile = () => path.join(dataDir(), "settings.json");
const manifestFile = () => path.join(modelsDir(), "models.json");
const chatsDir = () => path.join(dataDir(), "chats");
const filesDir = () => path.join(dataDir(), "files");

async function readJSON(file, fallback) {
  try { return JSON.parse(await fsp.readFile(file, "utf8")); } catch { return fallback; }
}
async function writeJSON(file, value) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = file + ".tmp";
  await fsp.writeFile(tmp, JSON.stringify(value, null, 2));
  await fsp.rename(tmp, file);
}

const DEFAULT_SETTINGS = {
  ram: null,
  hfToken: "",
  speakReplies: true,
  speakChat: false,
  voice: "af_heart",      // natural voice used to read answers (see renderer/speaker.js)
  voiceSpeed: 1,
  voiceName: "",          // built-in system voice, used if natural voices aren't downloaded
  followUpSeconds: 8,
  claudeModel: DEFAULT_CLAUDE_MODEL,
  saveChats: true,
  multiModels: true,       // keep several models running at once when there's enough memory (Settings → Running models)
  modelNames: {},          // your own names for models
  modelPerms: {},          // per model: { "<file>": { upload, save, run, mic } } (false = not allowed; My models → ⚙️)
  fileAccess: "ask",       // reading files you add to a chat: "ask" | "always" | "never"
  castOn: false,           // "Use on your phone": a web page on the home network (cast.mjs)
  castToken: "",           // the code in the QR; "New code" changes it
  castDevices: [],         // phones you allowed: { id, name, key (hash), added, seen }
  alexaOn: false,          // Amazon Alexa (alexa.mjs): your own skill, reaching this PC through an ngrok tunnel
  alexaSkillId: "",        // amzn1.ask.skill.…: requests from any other skill are refused
  alexaModel: "@auto",
  alexaInvocation: "my computer",
  alexaNgrokToken: "",     // kept in main, never sent to the window
  alexaDomain: "",         // your free static ngrok domain, e.g. something.ngrok-free.app
  alexaNgrokPath: "",
  makeFiles: true,         // models can make files in Chat and Voice mode (Settings → Saved chats)
  filesAutoSave: false,    // false: ask before saving each file the model makes
  filesAutoRun: false,     // false: ask before opening a file that runs code (.py, .bat, .ps1 …)
  micAllowed: false,       // the app asks before it first uses the microphone (Settings → Voice mode)
  cameraAccess: "ask",     // taking a photo in Chat (📎 → Take a photo): "ask" | "always" | "never"
  updateRepo: "",          // GitHub repository with releases, as "owner/name" (see Settings → Updates)
  wakePhrases: [
    { id: "jarvis", phrase: "Hey Jarvis", aliases: [], model: "", personality: "" },
  ],
};
async function getSettings() {
  const s = { ...DEFAULT_SETTINGS, ...(await readJSON(settingsFile(), {})) };
  multiOn = s.multiModels !== false;
  return s;
}

// Model files are stored as models/<owner>__<repo>/<file>.gguf, and models.json remembers
// the friendly name and tags so "My models" can show them without the internet.
// Models you've renamed show your name everywhere (defaultName keeps the original).
async function listModels() {
  const manifest = await readJSON(manifestFile(), []);
  const names = (await getSettings()).modelNames || {};
  const out = [];
  for (const m of manifest) {
    try { const st = await fsp.stat(path.join(modelsDir(), m.file)); out.push({ ...m, defaultName: m.name, name: names[m.file] || m.name, size: m.size || st.size, added: m.added || st.mtimeMs }); } catch {}
  }
  return out;
}
const safe = (s) => s.replace(/[^A-Za-z0-9._-]+/g, "_");

// ---------- Window ----------
let win;
// Answers for a phone (cast.mjs) go to that phone instead of the window.
const castTaps = new Map();
const send = (channel, payload) => {
  if ((channel === "chat:chunk" || channel === "chat:route") && castTaps.has(payload?.turnId)) return castTaps.get(payload.turnId)(channel, payload);
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
};

// Opening the app again (e.g. from the desktop shortcut) brings back the existing window.
if (!app.requestSingleInstanceLock()) app.exit(0);
// Started by the Claude app with --background: run in the tray without popping up a window.
const startHidden = process.argv.includes("--background");
app.on("second-instance", (_e, argv) => { if (!argv.includes("--background")) showWindow(); });
app.setAppUserModelId("app.openmodel.desktop"); // needed for Windows pop-up notifications

protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

function serveFile(file) {
  return net.fetch(pathToFileURL(file).toString());
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 860, minWidth: 380, minHeight: 560,
    title: "Open Model Desktop",
    backgroundColor: "#121218",
    icon: path.join(here, "assets", "icon.png"),
    show: !startHidden,
    webPreferences: { preload: path.join(here, "preload.cjs"), contextIsolation: true, sandbox: true },
  });
  win.setMenuBarVisibility(false);
  // Links to websites open in the normal browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: "deny" }; });
  win.webContents.on("will-navigate", (e, url) => { if (!url.startsWith("app://")) { e.preventDefault(); if (/^https:\/\//.test(url)) shell.openExternal(url); } });
  win.loadURL("app://ui/index.html");
  // Closing the window keeps the app running in the system tray (bottom right on Windows),
  // so a running model stays loaded. Quit from the tray menu.
  win.on("close", (e) => {
    if (quitting || !tray) return;
    e.preventDefault();
    win.hide();
    if (!hiddenOnce) { hiddenOnce = true; notify("Still running", "Open Model Desktop is in the tray. Right-click the icon to quit."); }
  });
}
function showWindow() {
  if (!win || win.isDestroyed()) createWindow();
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
}

// ---------- Tray icon and pop-up notifications ----------
let tray = null, quitting = false, hiddenOnce = false;
const iconPath = () => path.join(here, "assets", "icon.png");
function notify(title, body) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, icon: iconPath(), silent: true });
  n.on("click", showWindow);
  n.show();
}
async function modelName(file) {
  if (!file) return "";
  const own = ((await getSettings()).modelNames || {})[file];
  if (own) return own;
  if (file === "@claude") return "Claude";
  const m = (await readJSON(manifestFile(), [])).find((x) => x.file === file);
  return m?.name || path.basename(file, ".gguf");
}
let traySt = { state: "idle", name: "" };
function updateTray() {
  if (!tray) return;
  const { state, name } = traySt;
  const label = state === "ready" ? `● Running: ${name.length > 60 ? name.slice(0, 57) + "…" : name}` : state === "loading" ? `Starting ${name}…` : "No model running";
  tray.setToolTip(`Open Model Desktop\n${label}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Open Open Model Desktop", click: showWindow },
    { type: "separator" },
    { label, enabled: false },
    { label: state === "loading" ? "Cancel" : pool.length > 1 ? "Stop all models" : "Stop model", enabled: state !== "idle", click: () => stopAllModels() },
    { type: "separator" },
    { label: "Quit", click: () => { quitting = true; app.quit(); } },
  ]));
}
function createTray() {
  const img = nativeImage.createFromPath(iconPath()).resize({ width: process.platform === "darwin" ? 18 : 16, height: process.platform === "darwin" ? 18 : 16 });
  tray = new Tray(img);
  tray.on("click", showWindow);
  tray.on("double-click", showWindow);
  updateTray();
}
async function onEngineStatus(d) {
  const run = runningList();
  traySt = { state: run.some((r) => r.state === "loading") ? "loading" : run.length ? "ready" : "idle", name: (await Promise.all(run.map((r) => modelName(r.file)))).join(", ") };
  updateTray();
  if (d.state === "ready" && d.file && !d.online) notify("Model running", `${await modelName(d.file)} is running and ready to chat.`);
}

app.whenReady().then(() => {
  const uiDir = path.join(here, "renderer");
  const voskJs = path.join(path.dirname(fileURLToPath(import.meta.resolve("vosk-browser"))), "vosk.js");
  protocol.handle("app", (req) => {
    const u = new URL(req.url);
    const p = decodeURIComponent(u.pathname);
    if (p === "/vendor/vosk.js") return serveFile(voskJs);
    if (p.startsWith("/data/voice/")) return serveFile(path.join(voiceDir(), path.basename(p)));
    const file = path.normalize(path.join(uiDir, p));
    if (!file.startsWith(uiDir)) return new Response("Not found", { status: 404 });
    return serveFile(file);
  });
  // The microphone is only used after you say yes to the app's question (Settings → Voice mode turns it off again).
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb, details) => {
    // Camera: only after you said yes to the app's question this time, or chose "always".
    if (permission === "media") return getSettings().then((s) => {
      const types = details?.mediaTypes || [];
      if (types.includes("video") && !(cameraOkNow || s.cameraAccess === "always")) return cb(false);
      if (types.includes("audio") && !s.micAllowed) return cb(false);
      cb(types.length > 0 || !!s.micAllowed);
    }).catch(() => cb(false));
    cb(permission === "clipboard-sanitized-write");
  });
  createWindow();
  try { createTray(); } catch (err) { console.error("Tray unavailable:", err.message); }
  startBridge().catch((err) => console.error("Claude app link unavailable:", err.message));
  getSettings().then((s) => s.castOn && cast.start()).catch((err) => console.error("Phone link unavailable:", err.message));
  getSettings().then((s) => s.alexaOn && alexa.start()).catch((err) => console.error("Alexa link unavailable:", err.message));
  app.on("activate", showWindow);
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("before-quit", () => { quitting = true; for (const d of downloads.values()) d.abort.abort(); });

// ---------- Settings / system ----------
// (claudeKey is from a test version that used an API key; it is no longer used or shown.)
const forWindow = ({ claudeKey, alexaNgrokToken, ...s }) => ({ ...s, alexaNgrokSet: !!alexaNgrokToken });
ipcMain.handle("settings:get", async () => forWindow(await getSettings()));
ipcMain.handle("settings:set", async (_e, { claudeKey, alexaNgrokSet, ...patch }) => {
  const next = { ...(await getSettings()), ...patch };
  await writeJSON(settingsFile(), next);
  multiOn = next.multiModels !== false;
  // Back to one model at a time: keep only the one used most recently.
  if (patch.multiModels === false) { const keep = latestEngine(); for (const e of [...pool]) if (e !== keep) await e.cancel(); if (keep && claudeOn) claudeStatus(false); }
  if (patch.modelNames) onEngineStatus({});
  if (next.alexaOn && ("alexaNgrokToken" in patch || "alexaDomain" in patch || "alexaNgrokPath" in patch)) alexa.restartTunnel();
  if ("alexaSkillId" in patch) alexa.clearError();
  return forWindow(next);
});
// You said yes to using the camera (this time, or always). On a Mac the system asks too.
let cameraOkNow = false;
ipcMain.handle("camera:allow", async (_e, yes) => {
  cameraOkNow = !!yes;
  if (yes && process.platform === "darwin" && systemPreferences.getMediaAccessStatus("camera") !== "granted") return systemPreferences.askForMediaAccess("camera");
  return !!yes;
});
ipcMain.handle("sys:info", () => ({
  totalRamGB: Math.round(os.totalmem() / 1024 ** 3),
  platform: process.platform,
  arch: process.arch,
  dataDir: dataDir(),
}));
// ---------- Saved chats: one JSON file per conversation, only on this computer ----------
const chatFile = (id) => { if (!/^[a-z0-9]{6,40}$/.test(String(id))) throw new Error("Bad chat id"); return path.join(chatsDir(), id + ".json"); };
const chatSummary = (c) => ({ id: c.id, title: c.title, model: c.model, modelName: c.modelName, created: c.created, updated: c.updated, count: (c.messages || []).length,
  preview: String([...(c.messages || [])].reverse().find((m) => m.role === "bot" && m.text)?.text || "").slice(0, 140),
  body: (c.messages || []).map((m) => m.text || "").join(" ").slice(0, 4000) });   // for searching
let chatQueue = Promise.resolve();   // one write at a time, so two saves of the same chat can't trip over each other
const queued = (fn) => (...args) => { const run = chatQueue.then(() => fn(...args)); chatQueue = run.catch(() => {}); return run; };
ipcMain.handle("chats:list", async () => {
  let names = [];
  try { names = (await fsp.readdir(chatsDir())).filter((n) => n.endsWith(".json")); } catch { return []; }
  const out = [];
  for (const n of names) { const c = await readJSON(path.join(chatsDir(), n), null); if (c?.id) out.push(chatSummary(c)); }
  return out.sort((a, b) => b.updated - a.updated);
});
ipcMain.handle("chats:get", (_e, id) => readJSON(chatFile(id), null));
ipcMain.handle("chats:save", queued(async (_e, chat) => {
  if (!(await getSettings()).saveChats) return null;
  const file = chatFile(chat.id);
  const old = await readJSON(file, {});
  const c = { ...old, ...chat, title: String(chat.title ?? old.title ?? "New chat").slice(0, 120), updated: Date.now(), created: old.created || chat.created || Date.now() };
  await writeJSON(file, c);
  return chatSummary(c);
}));
ipcMain.handle("chats:rename", queued(async (_e, id, title) => {
  const c = await readJSON(chatFile(id), null); if (!c) return null;
  c.title = String(title).trim().slice(0, 120) || c.title;
  await writeJSON(chatFile(id), c);
  return chatSummary(c);
}));
// Deleting a chat keeps the files it made (they're your files in Documents). Files from older versions, kept inside the app's data, go with it.
ipcMain.handle("chats:delete", queued(async (_e, id) => { await fsp.rm(chatFile(id), { force: true }); await fsp.rm(path.join(filesDir(), path.basename(chatFile(id), ".json")), { recursive: true, force: true }); }));
ipcMain.handle("chats:deleteAll", queued(async () => { await fsp.rm(chatsDir(), { recursive: true, force: true }); await fsp.rm(filesDir(), { recursive: true, force: true }); }));

// ---------- Files that models make in Chat: real files in Documents\Open Model Desktop\<date> <chat title>\ ----------
const outRoot = () => { let d; try { d = app.getPath("documents"); } catch { d = app.getPath("home"); } return path.join(d, "Open Model Desktop"); };
const folderIndex = () => path.join(dataDir(), "file-folders.json");
const safeFileName = (n) => (String(n).split(/[\\/]/).pop().replace(/[<>:"|?*\x00-\x1f]/g, "_").replace(/^[.\s]+|[.\s]+$/g, "").slice(0, 120)) || "file.txt";
const insideFiles = (p) => {
  const r = path.resolve(p);
  if (![outRoot(), filesDir()].some((d) => r.startsWith(path.resolve(d) + path.sep))) throw new Error("Not one of the app's files");
  return r;
};
// One folder per chat, named when the chat makes its first file, and kept even if the chat is renamed later.
const chatFolder = queued(async (chatId, title) => {
  const idx = await readJSON(folderIndex(), {});
  const id = /^[a-z0-9]{6,40}$/.test(String(chatId)) ? String(chatId) : "unsaved";
  if (idx[id]) return path.join(outRoot(), idx[id]);
  const day = new Date(); const date = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
  const t = String(title || "").replace(/[<>:"/\\|?*\x00-\x1f…]/g, " ").replace(/\s+/g, " ").trim().slice(0, 50).replace(/[.\s]+$/, "");
  const nameBase = id === "unsaved" ? "Unsaved chats" : `${date} ${t || "Chat"}`;
  let name = nameBase;
  for (let n = 2; id !== "unsaved" && (Object.values(idx).includes(name) || fs.existsSync(path.join(outRoot(), name))); n++) name = `${nameBase} (${n})`;
  idx[id] = name; await writeJSON(folderIndex(), idx);
  return path.join(outRoot(), name);
});
ipcMain.handle("files:write", async (_e, { chatId, title, name, content }) => {
  const dir = await chatFolder(chatId, title);
  await fsp.mkdir(dir, { recursive: true });
  const file = path.join(dir, safeFileName(name));
  const text = String(content);
  await fsp.writeFile(file, text && !text.endsWith("\n") ? text + "\n" : text);
  return file;
});
ipcMain.handle("files:openFolder", async () => { await fsp.mkdir(outRoot(), { recursive: true }); shell.openPath(outRoot()); });
ipcMain.handle("files:where", () => outRoot());
ipcMain.handle("files:open", async (_e, p) => { const err = await shell.openPath(insideFiles(p)); if (err) throw new Error(err); });
ipcMain.handle("files:reveal", (_e, p) => shell.showItemInFolder(insideFiles(p)));
ipcMain.handle("files:saveAs", async (_e, { name, content }) => {
  const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath("documents"), safeFileName(name)) });
  if (r.canceled || !r.filePath) return null;
  await fsp.writeFile(r.filePath, String(content));
  return r.filePath;
});
ipcMain.handle("chats:openFolder", async () => { await fsp.mkdir(chatsDir(), { recursive: true }); shell.openPath(chatsDir()); });

ipcMain.handle("sys:openModelsFolder", async () => { await fsp.mkdir(modelsDir(), { recursive: true }); shell.openPath(modelsDir()); });
// macOS asks once for microphone access; elsewhere this is always allowed.
ipcMain.handle("sys:askMic", async () => (process.platform === "darwin" ? systemPreferences.askForMediaAccess("microphone") : true));
ipcMain.handle("sys:openExternal", (_e, url) => { if (/^https:\/\//.test(url)) shell.openExternal(url); });

// ---------- Downloads ----------
// Downloads resume if interrupted: data goes to <file>.part and is renamed when complete.
const downloads = new Map();

async function downloadTo(url, dest, { onProgress, signal, token, expectedSize }) {
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  const part = dest + ".part";
  let have = 0;
  try { have = (await fsp.stat(part)).size; } catch {}
  const headers = { "User-Agent": "OpenModelDesktop/0.1" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (have > 0) headers.Range = `bytes=${have}-`;
  const res = await fetch(url, { headers, signal, redirect: "follow" });
  if (res.status === 401 || res.status === 403) {
    const err = new Error("This model needs you to log in to Hugging Face and accept its licence first. Open the model page, accept the licence, then add your Hugging Face token in Settings.");
    err.code = "GATED"; throw err;
  }
  if (res.status === 416 && expectedSize && have >= expectedSize) { await fsp.rename(part, dest); return; }
  if (!res.ok) throw new Error(`Download failed (HTTP ${res.status}).`);
  if (res.status !== 206) have = 0; // server ignored the resume request; start over
  const total = Number(res.headers.get("content-length") || 0) + have;
  let got = have, last = 0;
  const counter = new TransformStream({
    transform(chunk, ctrl) {
      got += chunk.byteLength;
      const now = Date.now();
      if (now - last > 250) { last = now; onProgress?.(got, total || expectedSize || 0); }
      ctrl.enqueue(chunk);
    },
  });
  await pipeline(Readable.fromWeb(res.body.pipeThrough(counter)), fs.createWriteStream(part, { flags: have ? "a" : "w" }), { signal });
  onProgress?.(got, total || got);
  await fsp.rename(part, dest);
}

const dlUrl = (repo, file) => `${HF}/${repo}/resolve/main/${file.split("/").map(encodeURIComponent).join("/")}?download=true`;

// job: { repo, name, maker, tags, quant, parts: [{ path, size }], blurb }
ipcMain.handle("dl:start", async (_e, job) => {
  const id = job.repo + "::" + job.parts[0].path;
  if (downloads.has(id)) return id;
  const abort = new AbortController();
  downloads.set(id, { abort });
  const folder = safe(job.repo.replace("/", "__"));
  const total = job.parts.reduce((s, p) => s + (p.size || 0), 0);
  const { hfToken } = await getSettings();
  (async () => {
    let doneBytes = 0;
    try {
      for (const p of job.parts) {
        const dest = path.join(modelsDir(), folder, path.basename(p.path));
        if (fs.existsSync(dest)) { doneBytes += p.size || 0; continue; }
        await downloadTo(dlUrl(job.repo, p.path), dest, {
          signal: abort.signal, token: hfToken, expectedSize: p.size,
          onProgress: (got) => send("dl:progress", { id, name: job.name, quant: job.quant, got: doneBytes + got, total }),
        });
        doneBytes += p.size || 0;
      }
      const file = path.join(folder, path.basename(job.parts[0].path)).split(path.sep).join("/");
      const manifest = (await readJSON(manifestFile(), [])).filter((m) => m.file !== file);
      manifest.push({ file, repo: job.repo, name: job.name, maker: job.maker, tags: job.tags || [], quant: job.quant,
        size: total, parts: job.parts.map((p) => path.basename(p.path)), blurb: job.blurb || "", addedAt: new Date().toISOString() });
      await writeJSON(manifestFile(), manifest);
      send("dl:done", { id, name: job.name, file });
      notify("Download finished", `${job.name} is ready. Press Run to start it.`);
    } catch (err) {
      send("dl:error", { id, name: job.name, cancelled: abort.signal.aborted, message: abort.signal.aborted ? "Cancelled" : err.message, gated: err.code === "GATED" });
    } finally {
      downloads.delete(id);
    }
  })();
  return id;
});
ipcMain.handle("dl:cancel", (_e, id) => { downloads.get(id)?.abort.abort(); });
ipcMain.handle("dl:active", () => [...downloads.keys()]);

ipcMain.handle("models:list", () => listModels());
ipcMain.handle("models:delete", async (_e, file) => {
  await engineOf(file)?.cancel();
  const manifest = await readJSON(manifestFile(), []);
  const m = manifest.find((x) => x.file === file);
  if (!m) return;
  const folder = path.join(modelsDir(), path.dirname(file));
  for (const p of m.parts || [path.basename(file)]) await fsp.rm(path.join(folder, p), { force: true });
  await writeJSON(manifestFile(), manifest.filter((x) => x.file !== file));
  try { if (!(await fsp.readdir(folder)).length) await fsp.rmdir(folder); } catch {}
});

// ---------- Voice pack ----------
ipcMain.handle("voice:status", async () => {
  const file = path.join(voiceDir(), VOICE_PACK.file);
  return { installed: fs.existsSync(file), url: `app://ui/data/voice/${VOICE_PACK.file}` };
});
ipcMain.handle("voice:download", async () => {
  const dest = path.join(voiceDir(), VOICE_PACK.file);
  await downloadTo(VOICE_PACK.url, dest, { onProgress: (got, total) => send("voice:progress", { got, total }) });
  return { installed: true, url: `app://ui/data/voice/${VOICE_PACK.file}` };
});

// ---------- Natural voices (Kokoro) ----------
// About 92 MB, downloaded once into the app's data folder. The 11 voices themselves ship with the app.
const ttsDir = () => path.join(dataDir(), "tts");
const TTS_REPO = "onnx-community/Kokoro-82M-v1.0-ONNX";
const TTS_FILES = [
  { path: "config.json", size: 50 }, { path: "tokenizer_config.json", size: 120 }, { path: "tokenizer.json", size: 3500 },
  { path: "onnx/model_quantized.onnx", size: 92361116 },
];
const ttsInstalled = () => TTS_FILES.every((f) => fs.existsSync(path.join(ttsDir(), TTS_REPO, f.path)));
let ttsDownloading = null;
ipcMain.handle("tts:status", () => ({ installed: ttsInstalled(), downloading: !!ttsDownloading }));
ipcMain.handle("tts:download", async () => {
  if (ttsInstalled()) return { installed: true };
  ttsDownloading ??= (async () => {
    const total = TTS_FILES.reduce((a, f) => a + f.size, 0);
    let done = 0;
    for (const f of TTS_FILES) {
      const dest = path.join(ttsDir(), TTS_REPO, f.path);
      if (!fs.existsSync(dest)) {
        await downloadTo(dlUrl(TTS_REPO, f.path), dest, { expectedSize: f.size, onProgress: (got) => send("tts:progress", { got: done + got, total }) });
      }
      done += f.size;
    }
    send("tts:progress", { got: total, total });
  })();
  try { await ttsDownloading; } finally { ttsDownloading = null; }
  return { installed: true };
});
const tts = {
  proc: null, seq: 0, pending: new Map(),
  call(op, args) {
    if (!this.proc) {
      const proc = utilityProcess.fork(path.join(here, "tts.mjs"), [], { serviceName: "Voice", stdio: "inherit" });
      proc.on("message", (m) => { const p = this.pending.get(m.id); if (!p) return; this.pending.delete(m.id); m.error ? p.reject(new Error(m.error)) : p.resolve(m.result); });
      proc.on("exit", () => {
        if (this.proc !== proc) return;
        this.proc = null;
        for (const p of this.pending.values()) p.reject(new Error("The voice stopped unexpectedly. Try again, or pick your computer's built-in voice in Settings."));
        this.pending.clear();
      });
      this.proc = proc;
    }
    const id = ++this.seq;
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.proc.postMessage({ id, op, args: { ...args, dir: ttsDir() } }); });
  },
};
ipcMain.handle("tts:speak", (_e, { text, voice, speed }) => {
  if (!ttsInstalled()) throw new Error("Download the natural voices in Settings first.");
  return tts.call("speak", { text: String(text).slice(0, 1000), voice, speed });
});
ipcMain.handle("tts:warmup", () => (ttsInstalled() ? tts.call("load", {}) : null));
app.on("will-quit", () => { tts.proc?.kill(); });

// ---------- Local model runtime ----------
// Models run in a separate background process (engine.mjs). If a model file is broken or
// unsupported and the runtime crashes, only that process dies and the app keeps working.
// Several models can run at once (each in its own process) when there's enough memory: Settings → Running models.
const MAX_MODELS = 4;
const pool = [];                 // running engines, one per model file
let multiOn = true;              // settings.multiModels, kept here so status updates can read it straight away
function makeEngine(file) {
  const e = {
    proc: null, file: null, want: file, seq: 0, pending: new Map(), used: Date.now(), busy: 0, status: { state: "idle" },
    start() {
      if (this.proc) return this.proc;
      const proc = utilityProcess.fork(path.join(here, "engine.mjs"), [], { serviceName: "Model runtime", stdio: "inherit" });
      proc.on("message", (m) => {
        if (m.event === "chunk") return send("chat:chunk", m.data);
        if (m.event === "status") {
          this.file = m.data.state === "ready" ? m.data.file : m.data.state === "idle" ? null : this.file;
          this.status = m.data;
          if (m.data.state === "idle" && !this.pending.size) drop(this);   // (loading starts with an "idle" while it clears the old model)
          return pushStatus(m.data);
        }
        const p = this.pending.get(m.id); if (!p) return;
        this.pending.delete(m.id);
        m.error ? p.reject(new Error(m.error)) : p.resolve(m.result);
      });
      proc.on("exit", () => {
        if (this.proc !== proc) return;
        this.proc = null; this.file = null;
        for (const p of this.pending.values()) p.reject(new Error("The model stopped unexpectedly. This file may be broken or not supported yet. Try a different model or version."));
        this.pending.clear();
        drop(this);
        this.status = { state: "idle", file: this.want }; pushStatus(this.status);
      });
      this.proc = proc;
      return proc;
    },
    call(op, args) {
      const proc = this.start();
      const id = ++this.seq;
      this.used = Date.now();
      return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); proc.postMessage({ id, op, args }); });
    },
    async unload() { if (this.proc) { await this.call("unload"); this.proc?.kill(); this.proc = null; } drop(this); this.status = { state: "idle", file: this.want }; pushStatus(this.status); },
    // Stop the running model, or cancel one that's still starting up.
    async cancel() {
      if (!this.proc) return drop(this);
      if (this.status.state === "loading") {
        const proc = this.proc; this.proc = null; this.file = null;
        for (const p of this.pending.values()) p.reject(new Error("Cancelled."));
        this.pending.clear();
        proc.kill();
        drop(this);
        this.status = { state: "idle", file: this.want }; pushStatus(this.status);
      } else await this.unload();
    },
  };
  return e;
}
function drop(e) { const k = pool.indexOf(e); if (k >= 0) pool.splice(k, 1); }
const engineOf = (file) => pool.find((e) => e.want === file);
const latestEngine = () => [...pool].sort((a, b) => b.used - a.used)[0] || null;
async function stopAllModels() { for (const e of [...pool]) await e.cancel(); }
async function modelSizeGB(file) {
  try { return (await fsp.stat(path.join(modelsDir(), file))).size / 1e9; } catch { return 0; }
}
// The engine for a model: the one already running it, or a new one. Makes room first by stopping the
// models you used longest ago (never one that's answering), and says so.
async function engineFor(file) {
  let e = engineOf(file);
  if (e) { e.used = Date.now(); return e; }
  multiOn = (await getSettings()).multiModels !== false;
  const others = pool.filter((x) => x.proc).sort((a, b) => a.used - b.used);
  if (!multiOn) for (const x of others) await x.cancel();
  else if (others.length) {
    const need = (await modelSizeGB(file)) * 1.2 + 0.8;
    let free = os.freemem() / 1e9;
    for (const x of others) {
      if (free >= need && pool.length < MAX_MODELS) break;
      if (x.busy) continue;
      const gone = x.want, size = await modelSizeGB(gone);
      await x.cancel();
      free += size * 1.1;
      send("chat:notice", { text: `Stopped ${await modelName(gone)} to make room for ${await modelName(file)}, because there isn't enough memory to run both.` });
    }
  }
  e = makeEngine(file);
  pool.push(e);
  return e;
}
// Run something on a model's engine. If loading ran out of memory while other models were running, stop them and try once more.
async function onModel(file, op, args) {
  const e = await engineFor(file);
  e.busy++;
  try { return await e.call(op, args); }
  catch (err) {
    if (/ran out of memory/i.test(err.message) && pool.some((x) => x !== e && x.proc && !x.busy)) {
      for (const x of pool.filter((x) => x !== e && !x.busy)) await x.cancel();
      send("chat:notice", { text: `Stopped the other models to make room for ${await modelName(file)}.` });
      return (await engineFor(file)).call(op, args);
    }
    throw err;
  } finally { e.busy--; }
}
const runningList = () => {
  const l = pool.filter((e) => e.status.state !== "idle").map((e) => ({ file: e.status.file || e.want, state: e.status.state, progress: e.status.progress, gpu: e.status.gpu || false }));
  if (claudeOn) l.push(claudeReady());
  return l;
};
const modelPath = (file) => {
  const full = path.join(modelsDir(), file);
  if (!full.startsWith(modelsDir() + path.sep) || !fs.existsSync(full)) throw new Error("That model file is missing. Try downloading it again.");
  return full;
};

// ---------- Claude (uses your Claude Pro plan through Claude Code) ----------
// Claude shows up as one more model. Only one model is "running" at a time, so running Claude stops a local model.
let claudeOn = false, claudeLimit = "";
const claudeReady = () => ({ state: "ready", file: CLAUDE_FILE, online: true, ...(claudeLimit ? { limit: claudeLimit } : {}) });
function pushStatus(d) {
  if (d.state !== "idle" && !multiOn) claudeOn = false;   // one model at a time: a local model starting replaces Claude
  onEngineStatus(d); send("chat:status", { ...d, running: runningList() });
}
function claudeStatus(on) {
  claudeOn = on;
  const d = on ? claudeReady() : { state: "idle", file: CLAUDE_FILE, online: true };
  onEngineStatus(d); send("chat:status", { ...d, running: runningList() });
}
const claude = createClaude({
  getModel: async () => (await getSettings()).claudeModel ?? DEFAULT_CLAUDE_MODEL,
  onChunk: (c) => send("chat:chunk", c),
  workDir: path.join(app.getPath("userData"), "claude-chat"),
});
async function useClaude() {
  if (claudeOn) return;
  if (!multiOn) await stopAllModels();             // one model at a time: free the memory a local model was using
  claudeStatus(true);
}
async function claudeSend(args) {
  try {
    const r = await claude.send(args);
    if (claudeLimit && !r.stopped) { claudeLimit = ""; if (claudeOn) claudeStatus(true); }
    return r;
  } catch (err) {
    if (err.limit) {
      claudeLimit = err.resets || "later";
      if (claudeOn) claudeStatus(true);
      notify("Claude plan limit reached", err.message);
    }
    throw err;
  }
}
const FALLBACK_MSG = "Claude Code isn't set up with a Claude plan on this computer, so I opened the free Claude website instead. To use your Pro plan here, see Settings → Claude.";
async function requireClaude({ fallback = false } = {}) {
  const st = await claude.status();
  if (fallback && !(st.installed && st.loggedIn && st.usesPlan)) { openWeb("claude"); throw new Error(FALLBACK_MSG); }
  if (!st.installed) throw new Error("Claude Code isn't installed on this computer yet. Open Settings → Claude for the one-line install.");
  if (!st.loggedIn) throw new Error("Claude Code isn't signed in. Open Settings → Claude and press Sign in.");
  if (!st.usesPlan) throw new Error("Claude Code is signed in with an API key, which would be billed per use. Open Settings → Claude and sign in with your Claude Pro account instead.");
  return st;
}
// ---------- Online models: each company's own website in its own window ----------
// You sign in there yourself; the app never reads those pages or their sign-ins.
const ONLINE_SITES = {
  claude: { name: "Claude", url: "https://claude.ai/new" },
  chatgpt: { name: "ChatGPT", url: "https://chatgpt.com/" },
  gemini: { name: "Gemini", url: "https://gemini.google.com/app" },
  copilot: { name: "Copilot", url: "https://copilot.microsoft.com/" },
  lechat: { name: "Le Chat", url: "https://chat.mistral.ai/chat" },
  deepseek: { name: "DeepSeek", url: "https://chat.deepseek.com/" },
};
const webWins = new Map();
// A normal Chrome user agent, so sign-in pages (Google, Microsoft) treat the window like a regular browser.
const browserUA = () => {
  const os_ = process.platform === "win32" ? "Windows NT 10.0; Win64; x64" : process.platform === "darwin" ? "Macintosh; Intel Mac OS X 10_15_7" : "X11; Linux x86_64";
  return `Mozilla/5.0 (${os_}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`;
};
function openWeb(id) {
  const site = ONLINE_SITES[id]; if (!site) throw new Error("Unknown site.");
  const existing = webWins.get(id);
  if (existing && !existing.isDestroyed()) { if (existing.isMinimized()) existing.restore(); existing.show(); existing.focus(); return; }
  const partition = "persist:web-" + id;   // each service keeps its own sign-in, apart from the app and the others
  const webPreferences = { partition, contextIsolation: true, sandbox: true, nodeIntegration: false };
  const w = new BrowserWindow({ width: 1100, height: 820, title: site.name + " (online)", icon: iconPath(), backgroundColor: "#ffffff", autoHideMenuBar: true, webPreferences });
  w.webContents.setUserAgent(browserUA());
  // Sign-in pop-ups (e.g. "Continue with Google") open as small windows that share the same sign-in.
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (!/^https:\/\//.test(url)) return { action: "deny" };
    return { action: "allow", overrideBrowserWindowOptions: { width: 520, height: 700, autoHideMenuBar: true, webPreferences } };
  });
  w.webContents.on("did-create-window", (child) => child.webContents.setUserAgent(browserUA()));
  w.on("closed", () => webWins.delete(id));
  w.loadURL(site.url);
  webWins.set(id, w);
}
ipcMain.handle("web:open", (_e, id) => openWeb(id));
ipcMain.handle("web:external", (_e, id) => { const site = ONLINE_SITES[id]; if (site) shell.openExternal(site.url); });

ipcMain.handle("claude:models", () => CLAUDE_MODELS);
ipcMain.handle("claude:plan", async () => ({ ...(await claude.status()), limit: claudeLimit }));
ipcMain.handle("claude:login", () => claude.login());

// ---------- Optimal mode: pick the best model for each question ----------
// A tiny model runs in its own background process (so the main model can stay loaded) and reads the question.
const router = {
  proc: null, seq: 0, pending: new Map(), file: null, timer: null,
  start() {
    if (this.proc) return this.proc;
    const proc = utilityProcess.fork(path.join(here, "engine.mjs"), [], { serviceName: "Model picker", stdio: "inherit" });
    proc.on("message", (m) => { const p = this.pending.get(m.id); if (!p) return; this.pending.delete(m.id); m.error ? p.reject(new Error(m.error)) : p.resolve(m.result); });
    proc.on("exit", () => { if (this.proc === proc) { this.proc = null; this.file = null; for (const p of this.pending.values()) p.reject(new Error("stopped")); this.pending.clear(); } });
    return (this.proc = proc);
  },
  call(op, args, timeoutMs = 25000) {
    const proc = this.start(); const id = ++this.seq;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.proc?.kill(); }, 10 * 60 * 1000);   // free its memory after 10 quiet minutes
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.pending.delete(id); reject(new Error("timeout")); }, timeoutMs);
      this.pending.set(id, { resolve: (v) => { clearTimeout(t); resolve(v); }, reject: (e) => { clearTimeout(t); reject(e); } });
      proc.postMessage({ id, op, args });
    });
  },
};
const tierGB = (id) => { const t = TIERS.find((x) => x.id === id); return t?.gb || Math.round(os.totalmem() / 1024 ** 3 * 0.8); };   // "for this computer": most of its memory
async function routeQuestion(text, tierId) {
  const models = await listModels();
  const guess = guessTask(text);
  let task = guess.task, how = "words";
  // Not obvious from the words? Ask the tiny model.
  if (guess.sure < 2) {
    const r = pickRouter(models);
    if (r) {
      try {
        const out = await router.call("ask", { text: "Question: " + text.slice(0, 800), file: r.file, path: modelPath(r.file), systemPrompt: ROUTER_PROMPT, maxTokens: 48 });
        const t = parseTask(out.text);
        if (t) { task = t; how = r.name; }
      } catch (err) { console.warn("Model picker:", err.message); }
    }
  }
  const gb = tierGB(tierId);
  const pick = pickBest(models, task, gb);
  if (!pick.model) throw new Error("Download a model first: Optimal mode picks from the models in My models.");
  return { file: pick.model.file, name: pick.model.name, task, taskLabel: TASKS[task].label, tierGB: gb, fits: pick.fits, matched: pick.matched, how };
}
ipcMain.handle("auto:tiers", () => TIERS);
ipcMain.handle("auto:preview", async (_e, tierId) => {
  const models = await listModels(); const gb = tierGB(tierId);
  return { gb, router: pickRouter(models)?.name || "", picks: Object.keys(TASKS).map((t) => ({ task: TASKS[t].label, ...(() => { const p = pickBest(models, t, gb); return { name: p.model?.name || "", fits: p.fits, matched: p.matched }; })() })) };
});

ipcMain.handle("chat:load", async (_e, file) => {
  if (file === CLAUDE_FILE) {
    send("chat:status", { state: "loading", file: CLAUDE_FILE, online: true });
    try { await requireClaude({ fallback: true }); } catch (err) { send("chat:status", { ...(claudeOn ? claudeReady() : { state: "idle", file: CLAUDE_FILE, online: true }), running: runningList() }); throw err; }
    await useClaude();
    return { file };
  }
  if (claudeOn && !multiOn) claudeStatus(false);
  return onModel(file, "load", { file, path: modelPath(file) });
});
ipcMain.handle("chat:current", () => { const e = latestEngine(); return { ...(e ? { ...e.status, file: e.status.file || e.want } : claudeOn ? claudeReady() : { state: "idle" }), running: runningList() }; });
// Stop one model (file), or every model.
ipcMain.handle("chat:unload", async (_e, file) => {
  if (file === CLAUDE_FILE || (!file && claudeOn)) { claude.stop(); claudeStatus(false); if (file) return; }
  if (file) return engineOf(file)?.cancel();
  return stopAllModels();
});
ipcMain.handle("chat:reset", (_e, systemPrompt) => { claude.reset(systemPrompt ?? null); return Promise.all(pool.filter((e) => e.proc).map((e) => e.call("reset", { systemPrompt: systemPrompt ?? null }))); });
ipcMain.handle("chat:stop", () => { claude.stop(); for (const e of pool) e.proc?.postMessage({ op: "stop" }); });
// Added to the instructions in Chat, so models put files they make where the app can find them.
// Small models follow an example better than a rule, so there is one. The app is forgiving when they don't (see renderer/files.js).
const FILES_PROMPT = "When the user asks you to create, write or make a file (code, a script, a document, a list, a letter, a web page, a spreadsheet as CSV and so on), " +
  "the app saves it as a real file for them. Write a line 'File: name.ext' with a short sensible file name, then put the whole file in a code block straight after it, " +
  "with nothing left out. Use one code block per file. For example:\nFile: hello.py\n```python\nprint(\"Hello\")\n```\n" +
  "Start code files with a short comment saying what the file does and how to run it. After the code block, say in one or two sentences what the file is and how to use or run it. " +
  "Don't tell the user to copy and paste it, because the app saves it for them. For everything else, answer normally.";
// What a model is allowed to do (My models → ⚙️). Everything is allowed unless you untick it.
async function allowed(file, what) { const p = ((await getSettings()).modelPerms || {})[file] || {}; return p[what] !== false; }
// Files you add to a chat: the text is read here, on this computer.
ipcMain.handle("attach:read", async (_e, { name, bytes }) => {
  const buf = Buffer.from(bytes);
  if (buf.length > 40e6) throw new Error("That file is too big (over 40 MB).");
  return extractFile(String(name), buf);
});
ipcMain.handle("chat:send", (_e, a) => chatSend(a));
async function chatSend({ text, file, systemPrompt, turnId, convId = null, history = null, claudeSession = null, fast = false, files = false, images = [], via = "" }) {
  const phoneOk = async (f) => { if ((via === "phone" || via === "alexa") && !(await allowed(f, "cast"))) throw new Error(`That model can't be used from your ${via === "alexa" ? "Alexa" : "phone"}. You can change that on the PC in My models (⚙️ on its card).`); };
  await phoneOk(file);
  const addFiles = (f) => { if (files) systemPrompt = (systemPrompt || (f === CLAUDE_FILE ? CHAT_PROMPT : "")) + (systemPrompt || f === CLAUDE_FILE ? " " : "") + FILES_PROMPT; };
  if (file && !file.startsWith("@auto")) {
    if (files && !(await allowed(file, "save"))) files = false;
    if (images.length && !(await allowed(file, "upload"))) throw new Error("This model isn't allowed to read files you add. You can change that in My models (⚙️ on its card).");
    addFiles(file);
  }
  if (file === CLAUDE_FILE) {
    if (!claudeOn) await requireClaude({ fallback: true });
    await useClaude();
    try { return await claudeSend({ text, systemPrompt: systemPrompt ?? null, turnId, convId, history, resume: claudeSession, images: images.slice(0, 10) }); }
    catch (err) { if (err.login || err.install) { openWeb("claude"); throw new Error(FALLBACK_MSG); } throw err; }
  }
  let routed = null;
  if (file && file.startsWith("@auto")) {
    routed = await routeQuestion(text, file);
    send("chat:route", { turnId, ...routed });
    file = routed.file;
    await phoneOk(file);
    if (files && !(await allowed(file, "save"))) files = false;
    addFiles(file);
  }
  if (claudeOn && !multiOn) claudeStatus(false);
  file ||= latestEngine()?.want;
  if (!file) throw new Error("Pick a model first.");
  const r = await onModel(file, "send", { text, file, path: modelPath(file), systemPrompt: systemPrompt ?? null, turnId, convId, history, fast });
  return routed ? { ...r, routed } : r;
}

// ---------- Use on your phone (cast.mjs) ----------
// What a phone may pick: your models (not ones you've unticked "Be used from your phone" for), Optimal, and Claude if it's turned on.
async function phoneChoices() {
  const s = await getSettings(), perms = s.modelPerms || {};
  const ok = (f) => (perms[f] || {}).cast !== false;
  const local = (await listModels()).filter((m) => !(m.tags || []).includes("embeddings") && ok(m.file))
    .map((m) => ({ file: m.file, name: m.name, quant: m.quant || "", running: !!engineOf(m.file)?.file }));
  const out = [];
  if (local.length) out.push({ file: "@auto", name: "✨ Optimal", quant: "the app picks the best model for each question", auto: true });
  out.push(...local);
  if (s.claudeEnabled && ok(CLAUDE_FILE)) out.push({ file: CLAUDE_FILE, name: (s.modelNames || {})[CLAUDE_FILE] || "Claude", quant: "online, your Pro plan", online: true });
  return out;
}
// A phone or Alexa chat is saved like any chat (it starts with 📱 or 🔊).
const saveRemoteChat = queued(async ({ id, title, messages, claudeSession = null, model, text, answer, device, mark = "📱" }) => {
  if (!(await getSettings()).saveChats) return;
  const file = chatFile(id), old = await readJSON(file, {});
  const clean = (Array.isArray(messages) ? messages : []).slice(-200).map((m) => ({ role: m.role === "user" ? "user" : "bot", text: String(m.text || "").slice(0, 50000), at: +m.at || Date.now(), ...(m.role !== "user" ? { model: String(m.model || model) } : {}) }));
  const c = { ...old, id, title: old.title || (mark + " " + String(title || text).replace(/^(📱|🔊)\s*/u, "").slice(0, 110)), model, modelName: await modelName(model), claudeSession,
    messages: [...clean, { role: "user", text, at: Date.now(), from: device }, { role: "bot", text: answer, model, who: `${mark} on ${device}` }],
    updated: Date.now(), created: old.created || Date.now() };
  await writeJSON(file, c);
  send("cast:changed", { chats: true });
});
const castAsks = new Map();
const cast = createCast({
  page: path.join(here, "renderer", "phone.html"),
  getSettings,
  saveSettings: async (patch) => { const next = { ...(await getSettings()), ...patch }; await writeJSON(settingsFile(), next); send("settings:changed", forWindow(next)); },
  choices: phoneChoices,
  chatSend,
  stop: () => { claude.stop(); for (const e of pool) e.proc?.postMessage({ op: "stop" }); },
  taps: castTaps,
  saveChat: saveRemoteChat,
  // A new phone: ask on the PC (bring the window up), and wait up to 2 minutes.
  askApprove: ({ name, ip }) => new Promise((resolve) => {
    const id = crypto.randomBytes(6).toString("hex");
    const t = setTimeout(() => { castAsks.delete(id); send("cast:askDone", { id }); resolve(false); }, 120000);
    castAsks.set(id, (yes) => { clearTimeout(t); castAsks.delete(id); resolve(!!yes); });
    showWindow();
    notify("A phone wants to use your models", `${name} (${ip}) scanned your code. Press Allow on the PC to let it in.`);
    send("cast:ask", { id, name, ip });
  }),
  onChange: () => send("cast:changed", {}),
});
ipcMain.handle("cast:info", () => cast.info());
// ---------- Amazon Alexa (alexa.mjs) ----------
const alexa = createAlexa({ getSettings, chatSend, modelName, saveChat: saveRemoteChat, onStatus: (st) => send("alexa:status", st) });
ipcMain.handle("alexa:status", async () => ({ ...alexa.status, ngrok: await alexa.findNgrok((await getSettings()).alexaNgrokPath), port: ALEXA_PORT }));
ipcMain.handle("alexa:set", async (_e, on) => {
  await writeJSON(settingsFile(), { ...(await getSettings()), alexaOn: !!on });
  if (on) await alexa.start().catch(() => {}); else await alexa.stop();
  return alexa.status;
});
ipcMain.handle("alexa:model", async () => JSON.stringify(interactionModel((await getSettings()).alexaInvocation), null, 2));
ipcMain.handle("alexa:restart", () => alexa.restartTunnel());
ipcMain.handle("cast:set", async (_e, on) => {
  const s = await getSettings();
  await writeJSON(settingsFile(), { ...s, castOn: !!on });
  if (on) await cast.start(); else await cast.stop();
  return cast.info();
});
ipcMain.handle("cast:answer", (_e, id, yes) => castAsks.get(id)?.(yes));
ipcMain.handle("cast:newCode", async () => { await writeJSON(settingsFile(), { ...(await getSettings()), castToken: crypto.randomBytes(16).toString("hex") }); return cast.info(); });
ipcMain.handle("cast:remove", async (_e, id) => { const s = await getSettings(); await writeJSON(settingsFile(), { ...s, castDevices: (s.castDevices || []).filter((d) => d.id !== id) }); return cast.info(); });
// ---------- Updates from GitHub releases ----------
// Releases are published by .github/workflows/release.yml (Windows installer + Linux AppImage, with latest.yml / latest-linux.yml).
// - Installed on Windows, or the Linux AppImage: downloads in the background and installs on restart (electron-updater).
// - Anything else (running from the source folder, or a Linux copy that isn't the AppImage): finds the newest release on GitHub
//   and downloads the right file for this system into Downloads, so you can switch to it.
const DEFAULT_UPDATE_REPO = "GeorgeOverton/open-model-desktop";
const { autoUpdater } = electronUpdater;
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;
let updateState = { state: "idle" };
let manualRelease = null;      // { version, asset: { name, url, size }, page }
const setUpdate = (st) => { updateState = { ...updateState, ...st }; send("update:status", updateState); };
autoUpdater.on("download-progress", (p) => setUpdate({ state: "downloading", percent: Math.round(p.percent || 0) }));
autoUpdater.on("update-downloaded", (info) => { setUpdate({ state: "ready", latest: info.version }); notify("Update ready", `Version ${info.version} is downloaded. Restart Open Model Desktop to finish.`); });
autoUpdater.on("error", (err) => setUpdate({ state: "error", message: friendlyUpdateError(err) }));
function friendlyUpdateError(err) {
  const m = String(err?.message || err);
  if (/latest-linux\.yml/i.test(m)) return "The newest release doesn't have the Linux update file (latest-linux.yml). Publish releases with the Release workflow on GitHub (see below).";
  if (/latest\.yml/i.test(m)) return "The newest release doesn't have the Windows update file (latest.yml). Publish releases with the Release workflow on GitHub (see below).";
  if (/404|Unable to find latest version|No published versions|Cannot find latest/i.test(m)) return "No releases found in that GitHub repository yet. Publish one with the Release workflow (see below).";
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|net::/i.test(m)) return "Couldn't reach GitHub. Check your internet connection.";
  if (/rate limit/i.test(m)) return "GitHub says too many checks from this network. Try again in an hour.";
  return "Couldn't update: " + m.split("\n")[0].slice(0, 200);
}
// A copy built by the GitHub release workflow carries its repository in resources/app-update.yml.
function builtInRepo() {
  try {
    const y = fs.readFileSync(path.join(process.resourcesPath, "app-update.yml"), "utf8");
    const owner = y.match(/^owner:\s*['"]?([\w.-]+)/m)?.[1], repo = y.match(/^repo:\s*['"]?([\w.-]+)/m)?.[1];
    return owner && repo ? `${owner}/${repo}` : "";
  } catch { return ""; }
}
async function updateRepo() {
  const r = ((await getSettings()).updateRepo || builtInRepo() || DEFAULT_UPDATE_REPO).trim().replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/, "").replace(/\/+$/, "");
  return /^[\w.-]+\/[\w.-]+$/.test(r) ? r : "";
}
// How this copy can update itself.
function updateMode() {
  if (!app.isPackaged) return "manual";                                   // running from the source folder
  if (process.platform === "linux") return process.env.APPIMAGE ? "auto" : "manual";
  if (process.platform === "win32") return "auto";
  return "manual";
}
const newer = (a, b) => { const x = String(a).replace(/^v/, "").split(/[.-]/).map((n) => parseInt(n, 10) || 0), y = String(b).replace(/^v/, "").split(/[.-]/).map((n) => parseInt(n, 10) || 0); for (let k = 0; k < 3; k++) if ((x[k] || 0) !== (y[k] || 0)) return (x[k] || 0) > (y[k] || 0); return false; };
const assetFor = (assets) => process.platform === "linux" ? assets.find((a) => /\.AppImage$/i.test(a.name)) : process.platform === "win32" ? assets.find((a) => /Setup.*\.exe$/i.test(a.name)) : null;
async function checkForUpdates() {
  const repo = await updateRepo();
  if (!repo && !process.env.OMD_UPDATE_URL) throw new Error("Add the GitHub repository that publishes updates first (below).");
  const mode = updateMode();
  setUpdate({ state: "checking", repo, mode, message: "" });
  try {
    if (mode === "auto") {
      if (process.env.OMD_UPDATE_URL) autoUpdater.setFeedURL({ provider: "generic", url: process.env.OMD_UPDATE_URL });   // tests only
      else { const [owner, name] = repo.split("/"); autoUpdater.setFeedURL({ provider: "github", owner, repo: name }); }
      const r = await autoUpdater.checkForUpdates();
      const latest = r?.updateInfo?.version || app.getVersion();
      const available = r?.isUpdateAvailable ?? newer(latest, app.getVersion());
      setUpdate({ state: available ? "available" : "current", latest, current: app.getVersion(), notes: String(r?.updateInfo?.releaseNotes || "").replace(/<[^>]+>/g, "").slice(0, 600) });
      return updateState;
    }
    // Manual: ask GitHub for the newest release and pick this system's file.
    const api = process.env.OMD_UPDATE_API || `https://api.github.com/repos/${repo}/releases/latest`;
    const res = await net.fetch(api, { headers: { accept: "application/vnd.github+json", "user-agent": "OpenModelDesktop" } });
    if (res.status === 404) throw new Error("No published versions");
    if (res.status === 403) throw new Error("rate limit");
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
    const rel = await res.json();
    const latest = String(rel.tag_name || "").replace(/^[^\d]*/, "");
    const a = assetFor(rel.assets || []);
    manualRelease = { version: latest, page: rel.html_url, asset: a ? { name: a.name, url: a.browser_download_url, size: a.size } : null };
    const available = newer(latest, app.getVersion());
    setUpdate({ state: available ? "available" : "current", latest, current: app.getVersion(), page: rel.html_url, file: a?.name || "", notes: String(rel.body || "").slice(0, 600) });
    return updateState;
  } catch (err) { setUpdate({ state: "error", message: friendlyUpdateError(err) }); throw new Error(friendlyUpdateError(err)); }
}
async function downloadUpdate() {
  if (updateState.mode === "auto") { setUpdate({ state: "downloading", percent: 0 }); await autoUpdater.downloadUpdate(); return updateState; }
  if (!manualRelease?.asset) { if (manualRelease?.page) shell.openExternal(manualRelease.page); throw new Error("There's no file for this system in the newest release, so its page is open in your browser."); }
  const { name, url, size } = manualRelease.asset;
  const dest = path.join(app.getPath("downloads"), name);
  setUpdate({ state: "downloading", percent: 0 });
  const res = await net.fetch(url);
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}).`);
  const total = +res.headers.get("content-length") || size || 0;
  let got = 0, last = 0;
  const part = dest + ".part";
  const out = fs.createWriteStream(part);
  for await (const chunk of Readable.fromWeb(res.body)) {
    got += chunk.length;
    if (!out.write(chunk)) await new Promise((r) => out.once("drain", r));
    const pc = total ? Math.round((got / total) * 100) : 0;
    if (pc !== last) { last = pc; setUpdate({ state: "downloading", percent: pc }); }
  }
  await new Promise((r, j) => out.end((e) => (e ? j(e) : r())));
  await fsp.rename(part, dest);
  if (process.platform === "linux") await fsp.chmod(dest, 0o755);
  setUpdate({ state: "saved", path: dest, latest: manualRelease.version });
  return updateState;
}
ipcMain.handle("update:status", async () => ({ ...updateState, current: app.getVersion(), packaged: app.isPackaged, repo: await updateRepo(), mode: updateMode(), platform: process.platform, appImage: !!process.env.APPIMAGE }));
ipcMain.handle("update:check", () => checkForUpdates());
ipcMain.handle("update:download", async () => { try { return await downloadUpdate(); } catch (err) { setUpdate({ state: "error", message: friendlyUpdateError(err) }); throw new Error(friendlyUpdateError(err)); } });
ipcMain.handle("update:install", () => { quitting = true; autoUpdater.quitAndInstall(false, true); });
// The file the manual update downloaded: show it, or (Linux AppImage) start it and close this copy.
ipcMain.handle("update:openSaved", async (_e, how) => {
  const p = updateState.path; if (!p) return;
  if (how === "run" && process.platform === "linux") { spawn(p, [], { detached: true, stdio: "ignore" }).unref(); quitting = true; setTimeout(() => app.quit(), 800); return; }
  shell.showItemInFolder(p);
});
// Check quietly a little after start-up, and tell you if there's a new version.
app.whenReady().then(() => setTimeout(async () => {
  if (!(await updateRepo())) return;
  try { const st = await checkForUpdates(); if (st.state === "available") notify("Update available", `Version ${st.latest} of Open Model Desktop is ready to download. Open Settings → Updates.`); } catch {}
}, 15000));

app.on("will-quit", () => { cast.stop(); alexa.stop(); for (const e of pool) e.proc?.kill(); router.proc?.kill(); try { fs.unlinkSync(bridgeFile()); } catch {} });

// ---------- Use your models from the Claude app ----------
// The Claude app (Claude Desktop) starts mcp-server.mjs, which talks to this small server. It only
// listens on this computer (127.0.0.1) and needs a secret that is kept in the app's own folder.
const bridgeFile = () => path.join(dataDir(), "claude-bridge.json");
const mcpScript = () => path.join(here.replace(/app\.asar(?=$|[\\/])/, "app.asar.unpacked"), "mcp-server.mjs");
const SERVER_NAME = "open-model-desktop";
let bridgeServer = null;

async function chatModels() { return (await listModels()).filter((m) => !(m.tags || []).includes("embeddings")); }
async function pickModel(want) {
  const all = await chatModels();
  if (!all.length) throw Object.assign(new Error("No models are downloaded in Open Model Desktop yet. Download one under Find models first."), { status: 409 });
  if (want) {
    const w = want.toLowerCase().replace(/[^a-z0-9]+/g, "");
    const norm = (x) => String(x || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
    const hit = all.find((m) => m.file === want) || all.find((m) => norm(m.name) === w) || all.find((m) => norm(m.name).includes(w) || norm(m.file).includes(w));
    if (!hit) throw Object.assign(new Error(`No downloaded model matches "${want}". Downloaded: ${all.map((m) => m.name).join(", ")}.`), { status: 404 });
    return hit;
  }
  return all.find((m) => m.file === latestEngine()?.file) || all[0];
}
const readBody = (req) => new Promise((resolve, reject) => {
  let b = ""; req.setEncoding("utf8");
  req.on("data", (c) => { b += c; if (b.length > 2e6) req.destroy(); });
  req.on("end", () => { try { resolve(b ? JSON.parse(b) : {}); } catch (e) { reject(e); } });
  req.on("error", reject);
});
async function startBridge() {
  const token = crypto.randomBytes(24).toString("hex");
  bridgeServer = http.createServer(async (req, res) => {
    const out = (code, j) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(j)); };
    const auth = String(req.headers.authorization || "");
    const ok = auth.length === 7 + token.length && crypto.timingSafeEqual(Buffer.from(auth), Buffer.from("Bearer " + token));
    if (!ok || req.headers.origin) return out(403, { error: "Not allowed." });
    try {
      const route = new URL(req.url, "http://x").pathname;
      if (req.method === "GET" && route === "/ping") return out(200, { ok: true });
      if (req.method === "GET" && route === "/models") {
        const models = (await listModels()).map((m) => ({ name: m.name, file: m.file, quant: m.quant || "", sizeGB: +((m.size || 0) / 1024 ** 3).toFixed(1),
          running: !!engineOf(m.file)?.file, chat: !(m.tags || []).includes("embeddings") }));
        return out(200, { models });
      }
      if (req.method === "POST" && route === "/ask") {
        const b = await readBody(req);
        if (!b.prompt) return out(400, { error: "Please give a prompt." });
        const m = await pickModel(b.model);
        send("claude:activity", { kind: "ask", model: m.name, prompt: String(b.prompt).slice(0, 200) });
        const r = await onModel(m.file, "ask", { text: String(b.prompt), file: m.file, path: modelPath(m.file), systemPrompt: b.system || null,
          maxTokens: Math.min(4096, Math.max(16, +b.maxTokens || 2048)) });
        send("claude:activity", { kind: "done", model: m.name });
        return out(200, { text: r.text, model: m.name });
      }
      if (req.method === "POST" && route === "/say") {
        const b = await readBody(req);
        send("claude:say", { text: String(b.text || "").slice(0, 20000), voice: String(b.voice || "") });
        return out(200, { ok: true });
      }
      out(404, { error: "Not found." });
    } catch (err) { out(err.status || 500, { error: err.message || String(err) }); }
  });
  bridgeServer.requestTimeout = 0;
  await new Promise((resolve, reject) => { bridgeServer.once("error", reject); bridgeServer.listen(0, "127.0.0.1", resolve); });
  await fsp.mkdir(dataDir(), { recursive: true });
  await fsp.writeFile(bridgeFile(), JSON.stringify({ port: bridgeServer.address().port, token, pid: process.pid }), { mode: 0o600 });
}

// Where the Claude app keeps its list of tools (connectors). The Microsoft Store version of Claude keeps it in its own folder.
function claudeConfigFiles() {
  const home = os.homedir();
  if (process.platform === "darwin") return [path.join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json")];
  if (process.platform === "win32") {
    const list = [path.join(app.getPath("appData"), "Claude", "claude_desktop_config.json")];
    const pkgs = path.join(process.env.LOCALAPPDATA || path.join(home, "AppData", "Local"), "Packages");
    try { for (const d of fs.readdirSync(pkgs)) if (/^Claude_/i.test(d)) list.push(path.join(pkgs, d, "LocalCache", "Roaming", "Claude", "claude_desktop_config.json")); } catch {}
    return list;
  }
  return [path.join(process.env.XDG_CONFIG_HOME || path.join(home, ".config"), "Claude", "claude_desktop_config.json")];
}
function serverEntry() {
  const launch = app.isPackaged ? { command: process.execPath, args: [] } : { command: process.execPath, args: [app.getAppPath()] };
  return {
    command: process.execPath,
    args: [mcpScript()],
    env: { ELECTRON_RUN_AS_NODE: "1", OMD_BRIDGE: bridgeFile(), OMD_LAUNCH: JSON.stringify(launch), OMD_VERSION: app.getVersion() },
  };
}
async function claudeAppStatus() {
  const files = claudeConfigFiles();
  const found = files.filter((f) => fs.existsSync(path.dirname(f)));
  let connected = false;
  for (const f of found) { const c = await readJSON(f, {}); if (c?.mcpServers?.[SERVER_NAME]) connected = true; }
  return {
    claudeFound: found.length > 0, connected, configFile: found[0] || files[0],
    manual: JSON.stringify({ mcpServers: { [SERVER_NAME]: serverEntry() } }, null, 2),
    cli: `claude mcp add ${SERVER_NAME} --env ELECTRON_RUN_AS_NODE=1 --env OMD_BRIDGE="${bridgeFile()}" -- "${process.execPath}" "${mcpScript()}"`,
  };
}
async function editClaudeConfigs(fn) {
  const files = claudeConfigFiles();
  const targets = files.filter((f) => fs.existsSync(path.dirname(f)));
  if (!targets.length) throw new Error("The Claude app doesn't seem to be installed on this computer. Install it from claude.ai/download, open it once, then try again.");
  for (const f of targets) {
    let raw = null;
    try { raw = await fsp.readFile(f, "utf8"); } catch {}
    let cfg = {};
    if (raw && raw.trim()) {
      try { cfg = JSON.parse(raw); } catch { throw new Error("The Claude app's settings file couldn't be read, so it was left alone: " + f); }
      await fsp.writeFile(f + ".bak", raw); // keep a copy of what was there before
    }
    fn(cfg);
    await writeJSON(f, cfg);
  }
}
ipcMain.handle("claude:status", () => claudeAppStatus());
ipcMain.handle("claude:connect", async () => {
  await editClaudeConfigs((cfg) => { cfg.mcpServers = { ...(cfg.mcpServers || {}), [SERVER_NAME]: serverEntry() }; });
  return claudeAppStatus();
});
ipcMain.handle("claude:disconnect", async () => {
  await editClaudeConfigs((cfg) => { if (cfg.mcpServers) delete cfg.mcpServers[SERVER_NAME]; });
  return claudeAppStatus();
});
ipcMain.handle("sys:copy", (_e, text) => { clipboard.writeText(String(text)); });
