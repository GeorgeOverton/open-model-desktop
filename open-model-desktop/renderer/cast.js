// "📱 Phone": use the models on this PC from a phone on the same Wi-Fi (main.js + cast.mjs run the small web server).
(() => {
  "use strict";
  const { $, esc, toast, bus } = window.OMD;
  const D = window.desktop;
  const dlg = $("#castDlg");
  let info = null;

  const ago = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 2 ? "just now" : m < 60 ? `${m} minutes ago` : m < 1440 ? `${Math.round(m / 60)} hours ago` : `${Math.round(m / 1440)} days ago`; };
  function render() {
    const i = info || { on: false, devices: [] };
    const devices = i.devices.length ? `<ul class="castdevs">${i.devices.map((d) => `<li><span>📱 <b>${esc(d.name)}</b><span class="small muted"> · last used ${ago(d.seen || d.added)}</span></span>
        <button class="btn sm ghost" type="button" data-cast-remove="${esc(d.id)}" aria-label="Remove ${esc(d.name)}">Remove</button></li>`).join("")}</ul>`
      : `<p class="small muted">No phones yet. The first time a phone scans the code, you'll be asked here whether to let it in.</p>`;
    $("#castBody").innerHTML = !i.on ? `
      <p>Chat with the models on this PC from your phone. Your PC does the work, so it needs to stay on with the app open, and the phone needs to be on the <b>same Wi-Fi</b>.</p>
      <ul class="castpts small">
        <li>🔒 Only phones on your home network can connect, and only after you press <b>Allow</b> here.</li>
        <li>🚫 It isn't reachable from the internet.</li>
        <li>⚙️ Choose which models a phone can use with ⚙️ on each card in My models.</li>
      </ul>
      <p class="small muted">Want to ask with your voice through an Amazon Echo? Set up Alexa in <button class="linkish" type="button" data-cast-alexa>Settings → Amazon Alexa</button>.</p>
      <p class="small muted">Windows may ask whether Open Model Desktop can use your network. Choose <b>Private networks</b> and press Allow.</p>
      <div class="row"><button class="btn" type="button" data-cast-close>Not now</button><button class="btn primary" type="button" data-cast-on>Turn on</button></div>`
    : `
      <div class="castqr">
        ${i.qr ? `<img src="${esc(i.qr)}" alt="QR code to open Open Model Desktop on your phone" width="180" height="180">` : `<div class="noqr">⚠️</div>`}
        <div>
          ${i.noNetwork ? `<p><b>This PC isn't on a network.</b> Connect it to Wi-Fi or a cable, then reopen this.</p>`
            : `<p><b>Scan this with your phone's camera.</b> Then press Allow here when it asks.</p>
              <p class="small muted">Or type this in the phone's browser:<br><code class="casturl">${esc(i.url)}</code></p>
              ${i.others.length ? `<p class="small muted">Not working? This PC is also at ${i.others.map(esc).join(", ")}.</p>` : ""}`}
          <p class="small muted">Tip: on the phone, use "Add to Home screen" to get an app icon.</p>
        </div>
      </div>
      <h3>Phones allowed</h3>
      ${devices}
      <div class="row"><button class="linkish small" type="button" data-cast-newcode title="Old QR codes stop working. Phones already allowed keep working.">New code</button>
        <span class="rowr"><button class="btn danger" type="button" data-cast-off>Turn off</button><button class="btn primary" type="button" data-cast-close>Done</button></span></div>`;
    document.querySelectorAll("[data-cast]").forEach((b) => { b.classList.toggle("on", !!i.on); b.title = i.on ? "Your phone can use these models (press to see the code)" : "Use these models on your phone"; });
  }
  async function refresh() { try { info = await D.cast.info(); } catch {} render(); }
  async function open() { await refresh(); if (!dlg.open) dlg.showModal(); }
  document.addEventListener("click", async (e) => {
    if (e.target.closest("[data-cast]")) return open();
    if (!dlg.contains(e.target)) return;
    const t = e.target.closest("button"); if (!t) return;
    try {
      if (t.matches("[data-cast-close]")) dlg.close();
      else if (t.matches("[data-cast-alexa]")) { dlg.close(); window.OMD.show("settings"); setTimeout(() => $("#alexaSection")?.scrollIntoView({ block: "start" }), 50); }
      else if (t.matches("[data-cast-on]")) { t.disabled = true; info = await D.cast.set(true); render(); }
      else if (t.matches("[data-cast-off]")) { info = await D.cast.set(false); render(); toast("Phones can't use your models now. Turn it on again any time."); }
      else if (t.matches("[data-cast-newcode]")) { info = await D.cast.newCode(); render(); toast("New code made. The old QR code won't work any more."); }
      else if (t.dataset.castRemove) { info = await D.cast.remove(t.dataset.castRemove); render(); toast("That phone can't use your models any more."); }
    } catch (err) { toast("Couldn't do that: " + String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""), 6000); render(); }
  });
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });

  // A phone scanned the code: ask here.
  const asks = new Map();
  D.cast.onAsk(async ({ id, name, ip }) => {
    const p = window.OMD.askDialog({ title: "Let this phone use your models?",
      html: `<p><b>📱 ${esc(name)}</b> on your Wi-Fi (${esc(ip)}) scanned your code and wants to chat with the models on this PC.</p>
        <p class="small muted">Only allow it if it's your phone, or someone you trust. You can remove it any time with 📱 Phone.</p>`, yes: "Allow", no: "Don't allow" });
    asks.set(id, p);
    const r = await p; asks.delete(id);
    await D.cast.answer(id, r.yes);
    if (r.yes) toast(`${name} can now use your models.`, 4000);
    refresh();
  });
  D.cast.onAskDone(({ id }) => { if (asks.has(id)) document.querySelectorAll("dialog.ask[open]").forEach((d) => d.querySelector("[data-a=no]")?.click()); });
  D.cast.onChanged((d) => { if (d?.chats) bus.dispatchEvent(new CustomEvent("chatsChanged")); if (dlg.open) refresh(); });
  refresh();
})();
