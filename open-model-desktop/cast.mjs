// "Use on your phone": a small web server on this PC, so a phone on the same Wi-Fi can chat with the models running here.
// Locked down: only devices on your home network, only after scanning the QR code shown on the PC, and only once you've
// pressed Allow on the PC for that phone. Nothing goes through the internet (unless you chat with Claude, which is online anyway).
import http from "node:http";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import QRCode from "qrcode";

const sha = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
const same = (a, b) => { const x = Buffer.from(sha(a)), y = Buffer.from(sha(b)); return crypto.timingSafeEqual(x, y); };

// Addresses on a home network (and this PC itself). Anything else is refused.
export function isLocal(addr) {
  const a = String(addr || "").replace(/^::ffff:/, "");
  if (a === "::1" || a === "127.0.0.1") return true;
  if (/^10\./.test(a) || /^192\.168\./.test(a) || /^169\.254\./.test(a)) return true;
  const m = a.match(/^172\.(\d+)\./); if (m && +m[1] >= 16 && +m[1] <= 31) return true;
  if (/^f[cd][0-9a-f]{2}:/i.test(a) || /^fe80:/i.test(a)) return true;
  return false;
}
// The PC's address on the home network (Wi-Fi or cable), best guess first.
export function lanAddresses() {
  if (process.env.OMD_CAST_ADDR) return [{ address: process.env.OMD_CAST_ADDR, name: "set by OMD_CAST_ADDR", score: 9 }];   // for testing
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const n of list || []) {
      if (n.family !== "IPv4" || n.internal || !isLocal(n.address) || /^169\.254\./.test(n.address)) continue;
      const virtual = /vEthernet|VirtualBox|VMware|WSL|Hyper-V|docker|br-|veth|utun|tailscale|zerotier/i.test(name);
      out.push({ address: n.address, name, score: (virtual ? 0 : 2) + (/^192\.168\./.test(n.address) ? 1 : 0) });
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

export function createCast({ page, getSettings, saveSettings, choices, chatSend, stop, saveChat, taps, askApprove, onChange }) {
  let server = null, port = 0;
  const pending = new Set();
  const json = (res, code, body, headers = {}) => { res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store", ...headers }); res.end(JSON.stringify(body)); };
  const cookieOf = (req) => (String(req.headers.cookie || "").match(/(?:^|;\s*)omd_dev=([a-f0-9]{64})/) || [])[1] || "";
  async function deviceOf(req) {
    const c = cookieOf(req); if (!c) return null;
    const s = await getSettings();
    const h = sha(c);
    return (s.castDevices || []).find((d) => same(d.key, h)) || null;
  }
  const readBody = (req, max = 400000) => new Promise((resolve, reject) => {
    let n = 0; const parts = [];
    req.on("data", (c) => { n += c.length; if (n > max) { reject(new Error("too big")); req.destroy(); } else parts.push(c); });
    req.on("end", () => { try { resolve(JSON.parse(Buffer.concat(parts).toString("utf8") || "{}")); } catch { reject(new Error("bad json")); } });
    req.on("error", reject);
  });
  const nameFrom = (ua) => {
    ua = String(ua || "");
    const m = ua.match(/\(([^)]+)\)/)?.[1] || "";
    if (/iPhone/.test(ua)) return "iPhone"; if (/iPad/.test(ua)) return "iPad";
    if (/Android/.test(ua)) { const model = m.split(";").map((x) => x.trim()).filter((x) => x && !/^(Linux|Android|U|K|wv|[a-z]{2}-[A-Z]{2})/.test(x))[0]; return model && model.length < 30 ? `Android phone (${model})` : "Android phone"; }
    if (/Windows/.test(ua)) return "Windows PC"; if (/Macintosh/.test(ua)) return "Mac";
    return "Phone or tablet";
  };

  async function handle(req, res) {
    if (!isLocal(req.socket.remoteAddress)) { res.writeHead(403); return res.end("Only devices on your home network can use this."); }
    // Only plain addresses: a web site can't trick your browser into talking to this server under its own name.
    if (!/^(\d{1,3}(\.\d{1,3}){3}|localhost|\[[0-9a-f:]+\])(:\d+)?$/i.test(String(req.headers.host || ""))) { res.writeHead(421); return res.end(); }
    const url = new URL(req.url, "http://x");
    const p = url.pathname;
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("referrer-policy", "no-referrer");
    if (req.method === "GET" && (p === "/" || p === "/index.html")) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store",
        "content-security-policy": "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'" });
      return res.end(fs.readFileSync(page));
    }
    if (req.method === "GET" && p === "/icon.png") { res.writeHead(200, { "content-type": "image/png", "cache-control": "max-age=86400" }); return res.end(fs.readFileSync(path.join(path.dirname(page), "..", "assets", "icon.png"))); }
    if (!p.startsWith("/api/")) { res.writeHead(404); return res.end("Not found"); }
    if (req.method !== "GET" && req.headers["content-type"] !== "application/json") return json(res, 415, { error: "JSON only" });

    if (p === "/api/pair" && req.method === "POST") {
      const { k } = await readBody(req, 2000);
      const s = await getSettings();
      if (!s.castToken || !k || !same(k, s.castToken)) { await new Promise((r) => setTimeout(r, 800)); return json(res, 403, { error: "This code isn't right any more. Scan the QR code on your PC again." }); }
      if (pending.size >= 3) return json(res, 429, { error: "Too many phones are waiting. Answer them on the PC first." });
      const name = nameFrom(req.headers["user-agent"]);
      const ticket = crypto.randomBytes(8).toString("hex");
      pending.add(ticket);
      let yes = false;
      try { yes = await askApprove({ name, ip: String(req.socket.remoteAddress).replace(/^::ffff:/, "") }); } finally { pending.delete(ticket); }
      if (!yes) return json(res, 403, { error: "Not allowed. Someone at the PC pressed Don't allow." });
      const secret = crypto.randomBytes(32).toString("hex");
      const dev = { id: crypto.randomBytes(6).toString("hex"), name, key: sha(secret), added: Date.now(), seen: Date.now() };
      await saveSettings({ castDevices: [...((await getSettings()).castDevices || []), dev] });
      onChange?.();
      return json(res, 200, { ok: true, name }, { "set-cookie": `omd_dev=${secret}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Strict` });
    }

    const dev = await deviceOf(req);
    if (!dev) return json(res, 401, { error: "pair" });
    if (Date.now() - (dev.seen || 0) > 600000) {
      const s = await getSettings();
      await saveSettings({ castDevices: (s.castDevices || []).map((d) => (d.id === dev.id ? { ...d, seen: Date.now() } : d)) });
      onChange?.();
    }
    if (p === "/api/models" && req.method === "GET") return json(res, 200, { device: dev.name, models: await choices() });
    if (p === "/api/stop" && req.method === "POST") { stop(); return json(res, 200, { ok: true }); }
    if (p === "/api/forget" && req.method === "POST") {
      const s = await getSettings();
      await saveSettings({ castDevices: (s.castDevices || []).filter((d) => d.id !== dev.id) });
      onChange?.();
      return json(res, 200, { ok: true }, { "set-cookie": "omd_dev=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict" });
    }
    if (p === "/api/chat" && req.method === "POST") {
      const b = await readBody(req);
      const text = String(b.text || "").slice(0, 20000).trim();
      if (!text) return json(res, 400, { error: "Type a message first." });
      const allowed = (await choices()).find((m) => m.file === b.file);
      if (!allowed) return json(res, 403, { error: "That model can't be used from your phone. You can change that on the PC in My models (⚙️ on its card)." });
      const conv = b.conv && /^[a-z0-9]{6,40}$/.test(b.conv.id) ? b.conv : null;
      const history = (Array.isArray(b.history) ? b.history : []).slice(-30).map((m) => ({ role: m.role === "user" ? "user" : "bot", text: String(m.text || "").slice(0, 20000) }));
      res.writeHead(200, { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" });
      const out = (o) => { try { res.write(JSON.stringify(o) + "\n"); } catch {} };
      const turnId = "phone-" + crypto.randomBytes(6).toString("hex");
      let full = "";
      taps.set(turnId, (channel, d) => {
        if (channel === "chat:route") out({ t: "route", name: d.name, task: d.taskLabel, file: d.file });
        else if (d.kind === "thought") out({ t: "thought", v: d.text });
        else { full += d.text; out({ t: "text", v: d.text }); }
      });
      let closed = false;
      res.on("close", () => { if (!res.writableFinished && !closed) { closed = true; stop(); } });
      try {
        const r = await chatSend({ text, file: b.file, turnId, convId: conv?.id || null, history, claudeSession: b.claudeSession || null, files: false, via: "phone" });
        const answer = (r && r.text) || full;
        out({ t: "done", text: answer, session: r?.session || null, model: r?.model || null, stopped: !!r?.stopped });
        if (conv && answer) saveChat({ id: conv.id, title: conv.title, messages: conv.messages, claudeSession: r?.session || b.claudeSession || null, model: b.file, text, answer, device: dev.name }).catch(() => {});
      } catch (err) {
        out({ t: "done", error: String(err.message || err).replace(/^Error: /, "") });
      } finally { taps.delete(turnId); closed = true; res.end(); }
      return;
    }
    return json(res, 404, { error: "Not found" });
  }

  return {
    get on() { return !!server; },
    get port() { return port; },
    async start(wantPort = 8765) {
      if (server) return;
      const s = await getSettings();
      if (!s.castToken) await saveSettings({ castToken: crypto.randomBytes(16).toString("hex") });
      for (const tryPort of [wantPort, wantPort + 1, wantPort + 2, 0]) {
        const srv = http.createServer((req, res) => handle(req, res).catch((err) => { try { json(res, 500, { error: String(err.message || err) }); } catch {} }));
        srv.requestTimeout = 0; srv.headersTimeout = 20000;
        try {
          await new Promise((resolve, reject) => { srv.once("error", reject); srv.listen(tryPort, "0.0.0.0", resolve); });
          server = srv; port = srv.address().port; return;
        } catch (err) { if (err.code !== "EADDRINUSE") throw err; }
      }
    },
    async stop() { if (!server) return; const s = server; server = null; port = 0; s.closeAllConnections?.(); await new Promise((r) => s.close(() => r())); },
    async info() {
      const s = await getSettings();
      const ips = lanAddresses();
      const base = server && ips[0] ? `http://${ips[0].address}:${port}/` : "";
      return {
        on: !!server, port, url: base, pairUrl: base && s.castToken ? `${base}#k=${s.castToken}` : "",
        qr: base && s.castToken ? await QRCode.toDataURL(`${base}#k=${s.castToken}`, { margin: 1, width: 360, color: { dark: "#14161fff", light: "#ffffffff" } }) : "",
        others: ips.slice(1).map((x) => `http://${x.address}:${port}/`),
        noNetwork: !!server && !ips.length,
        devices: (s.castDevices || []).map(({ key, ...d }) => d),
      };
    },
  };
}
