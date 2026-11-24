// Settings → Amazon Alexa (main.js + alexa.mjs do the work).
(() => {
  "use strict";
  const { $, esc, toast, bus } = window.OMD;
  const D = window.desktop;
  let st = {}, s = {};
  const errText = (err) => String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
  const ago = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`; };

  function fillModels() {
    const sel = $("#alexaModel");
    const list = window.OMD.chatChoices.filter((m) => window.OMD.perms(m.file).cast);
    const want = s.alexaModel || "@auto";
    sel.innerHTML = list.length ? list.map((m) => `<option value="${esc(m.file)}" ${m.file === want ? "selected" : ""}>${esc(m.name)}</option>`).join("") : `<option value="">No models can be used by Alexa</option>`;
    if (list.length && !list.some((m) => m.file === want)) sel.value = list[0].file;
  }
  function paintStatus() {
    const el = $("#alexaStatus");
    el.className = "alexastat";
    if (!s.alexaOn) { el.textContent = ""; return; }
    const need = [!s.alexaNgrokSet && "your ngrok authtoken", !s.alexaDomain && "your ngrok domain", !s.alexaSkillId && "your skill ID"].filter(Boolean);
    let msg;
    if (st.tunnel === "on") { msg = `● Online at ${st.url}` + (st.last ? ` · last used ${ago(st.last)}` : " · waiting for Alexa"); el.classList.add(need.length ? "warn" : "ok"); }
    else if (st.tunnel === "starting") msg = "Starting the tunnel…";
    else if (st.tunnel === "no-ngrok") { msg = "ngrok isn't installed, or the app can't find it. See step 1 below."; el.classList.add("warn"); }
    else if (st.tunnel === "needs-setup") { msg = "Almost there: add " + need.join(", ") + "."; el.classList.add("warn"); }
    else { msg = st.server ? "The tunnel is off." : "Not running."; el.classList.add("warn"); }
    if (st.tunnel === "on" && need.length) msg += ". Still needed: " + need.join(", ") + ".";
    if (st.error) msg += "  ⚠️ " + st.error;
    el.textContent = msg;
  }
  async function load() {
    s = await D.settings.get();
    $("#alexaOn").checked = !!s.alexaOn;
    $("#alexaInvocation").value = s.alexaInvocation || "my computer";
    $("#alexaSkillId").value = s.alexaSkillId || "";
    $("#alexaDomain").value = s.alexaDomain || "";
    $("#alexaNgrokPath").value = s.alexaNgrokPath || "";
    $("#alexaToken").value = ""; $("#alexaToken").placeholder = s.alexaNgrokSet ? "Saved (paste a new one to change it)" : "Paste it from the ngrok dashboard";
    document.querySelectorAll(".alexaInv").forEach((x) => { x.textContent = s.alexaInvocation || "my computer"; });
    fillModels();
    try { st = await D.alexa.status(); } catch {}
    paintStatus();
  }
  const save = async (patch) => { s = await window.OMDSettings.save(patch).then(() => D.settings.get()); paintStatus(); };
  $("#alexaOn").addEventListener("change", async (e) => {
    try { st = await D.alexa.set(e.target.checked); s = await D.settings.get(); paintStatus(); if (e.target.checked) toast("Alexa is on. Finish the setup steps below if you haven't yet.", 4500); }
    catch (err) { toast("Couldn't start Alexa: " + errText(err), 6000); }
  });
  $("#alexaModel").addEventListener("change", (e) => save({ alexaModel: e.target.value }));
  $("#alexaInvocation").addEventListener("change", (e) => {
    const v = e.target.value.toLowerCase().replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();
    if (v && v.split(" ").length < 2) { toast('Alexa needs at least two words here, like "my computer".', 5000); e.target.value = s.alexaInvocation || "my computer"; return; }
    e.target.value = v || "my computer";
    document.querySelectorAll(".alexaInv").forEach((x) => { x.textContent = e.target.value; });
    save({ alexaInvocation: e.target.value });
    toast("Changed. Copy the skill setup again and paste it into the Alexa console, then Build skill.", 6000);
  });
  $("#alexaSkillId").addEventListener("change", (e) => {
    const v = e.target.value.trim();
    if (v && !/^amzn1\.ask\.skill\.[0-9a-f-]{20,}$/i.test(v)) toast("That doesn't look like a skill ID. It starts with amzn1.ask.skill.", 5000);
    save({ alexaSkillId: v });
  });
  $("#alexaToken").addEventListener("change", (e) => { const v = e.target.value.trim(); if (!v) return; save({ alexaNgrokToken: v }); e.target.value = ""; e.target.placeholder = "Saved (paste a new one to change it)"; toast("Authtoken saved."); });
  $("#alexaDomain").addEventListener("change", (e) => { const v = e.target.value.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, ""); e.target.value = v; save({ alexaDomain: v }); });
  $("#alexaNgrokPath").addEventListener("change", (e) => save({ alexaNgrokPath: e.target.value.trim().replace(/^"|"$/g, "") }));
  $("#alexaCopyModel").addEventListener("click", async () => { await D.sys.copy(await D.alexa.model()); toast("Copied. Paste it into Build → Interaction Model → JSON Editor in the Alexa console.", 5000); });
  $("#alexaCopyUrl").addEventListener("click", async () => {
    const u = st.url || (s.alexaDomain ? `https://${s.alexaDomain}/alexa` : "");
    if (!u) return toast("Add your ngrok domain first (step 1).", 4000);
    await D.sys.copy(u); toast("Copied " + u, 4000);
  });
  $("#alexaSection").addEventListener("click", (e) => { const a = e.target.closest("[data-ext]"); if (a) D.sys.openExternal(a.dataset.ext); });
  D.alexa.onStatus((x) => { st = { ...st, ...x }; paintStatus(); });
  bus.addEventListener("models", fillModels);
  bus.addEventListener("settings", (e) => { if (e.detail) { s = { ...s, ...e.detail }; fillModels(); paintStatus(); } });
  setInterval(() => { if (s.alexaOn && st.last) paintStatus(); }, 60000);
  load();
})();
