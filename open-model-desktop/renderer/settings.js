// Settings page: voices (with previews), voice mode and downloads.
(() => {
  "use strict";
  const { $, esc, toast, bus, avatar } = window.OMD;
  const D = window.desktop;
  const S = window.Speaker;
  let settings = {};
  const clean = (err) => String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");

  async function save(patch) {
    settings = await D.settings.set(patch);
    S.configure(settings);
    bus.dispatchEvent(new CustomEvent("settings", { detail: settings }));
  }
  const stars = (n) => `<span class="stars" title="${n} out of 5 for naturalness">${"★".repeat(Math.floor(n))}${n % 1 ? "½" : ""}<span class="off">${"★".repeat(5 - Math.ceil(n))}</span></span>`;
  const PREVIEW = (v) => `Hi, I'm ${v.name}. I can read your answers out loud, completely offline.`;

  function renderTts() {
    const box = $("#ttsBox");
    if (S.installed) {
      box.className = "way ok-box";
      box.innerHTML = `<h3>✓ Natural voices installed</h3><p class="small muted">These sound like real people and work with no internet. Each answer takes a moment to start while the voice is made.</p>`;
    } else {
      box.className = "way";
      box.innerHTML = `<h3>Get natural voices</h3>
        <p>The voices below sound far more human than your computer's built-in voice. They need a one-time download of about <strong>92 MB</strong>, then work offline.</p>
        <button class="btn primary" id="getTts">Download natural voices</button>
        <div class="bar" id="ttsBar" hidden><span></span></div>
        <p class="small muted">Until then, answers use your computer's built-in voice.</p>`;
      $("#getTts").addEventListener("click", async (e) => {
        e.target.disabled = true; e.target.textContent = "Downloading…"; $("#ttsBar").hidden = false;
        try { await D.tts.download(); await S.refresh(); renderTts(); renderVoices(); toast("Natural voices ready. Press ▶ Preview to hear them."); }
        catch (err) { toast("Couldn't download the voices: " + String(err.message).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""), 7000); e.target.disabled = false; e.target.textContent = "Try again"; }
      });
    }
  }
  D.tts.onProgress((p) => { const s = $("#ttsBar span"); if (s && p.total) s.style.width = (100 * p.got / p.total).toFixed(1) + "%"; });

  function renderVoices() {
    const cur = settings.voice || "af_heart";
    $("#voiceGrid").innerHTML = S.VOICES.map((v) => `
      <article class="vcard ${v.id === cur ? "on" : ""}" data-voice="${v.id}">
        <div class="vtop">${avatar(v, true)}<div><h3>${esc(v.name)}</h3><div class="small muted">${v.accent} English · ${v.gender}</div></div>
          ${v.id === cur ? `<span class="pick">✓ In use</span>` : ""}</div>
        <p class="small">${esc(v.tone)}</p>
        <div class="vfoot">${stars(v.stars)}
          <span class="vbtns"><button class="btn sm" data-preview="${v.id}" ${S.installed ? "" : "disabled title='Download natural voices first'"}>▶ Preview</button>
          ${v.id === cur ? "" : `<button class="btn sm primary" data-use="${v.id}">Use</button>`}</span></div>
      </article>`).join("");
  }
  $("#voiceGrid").addEventListener("click", async (e) => {
    const p = e.target.closest("[data-preview]");
    if (p) { S.stop(); S.say(PREVIEW(S.byId(p.dataset.preview)), p.dataset.preview); p.textContent = "Playing…"; S.onIdle(() => { p.textContent = "▶ Preview"; }, true); return; }
    const u = e.target.closest("[data-use]");
    if (u) { await save({ voice: u.dataset.use }); renderVoices(); toast(`${S.byId(u.dataset.use).name} will now read your answers.`); }
  });

  function fillSystemVoices() {
    const vs = window.speechSynthesis ? window.speechSynthesis.getVoices().filter((v) => /^en/i.test(v.lang)) : [];
    $("#voiceName").innerHTML = `<option value="">System default</option>` + vs.map((v) =>
      `<option ${v.name === settings.voiceName ? "selected" : ""} value="${esc(v.name)}">${esc(v.name)} (${esc(v.lang)})</option>`).join("");
  }
  if (window.speechSynthesis) window.speechSynthesis.onvoiceschanged = fillSystemVoices;

  $("#voiceSpeed").addEventListener("input", (e) => { $("#voiceSpeedVal").textContent = (+e.target.value).toFixed(2) + "×"; });
  $("#voiceSpeed").addEventListener("change", (e) => save({ voiceSpeed: +e.target.value }));
  $("#speakReplies").addEventListener("change", (e) => save({ speakReplies: e.target.checked }));
  $("#speakChat").addEventListener("change", (e) => save({ speakChat: e.target.checked }));
  $("#saveChats").addEventListener("change", async (e) => { await save({ saveChats: e.target.checked }); toast(e.target.checked ? "Chats will be saved on this computer." : "New chats won't be saved. Chats you already saved are kept until you delete them.", 4500); });
  $("#openChatsFolder").addEventListener("click", () => D.chats.openFolder());
  $("#makeFiles").addEventListener("change", (e) => save({ makeFiles: e.target.checked }));
  $("#openFilesFolder").addEventListener("click", () => window.desktop.files.openFolder());
  $("#filesAutoSave").addEventListener("change", (e) => save({ filesAutoSave: e.target.checked }));
  $("#micAllowed").addEventListener("change", (e) => { save({ micAllowed: e.target.checked }); if (!e.target.checked) bus.dispatchEvent(new CustomEvent("micOff")); });
  $("#multiModels").addEventListener("change", (e) => save({ multiModels: e.target.checked }));
  $("#filesAutoRun").addEventListener("change", (e) => save({ filesAutoRun: e.target.checked }));
  // "Always" buttons on file cards change these, so keep the boxes in step.
  bus.addEventListener("settings", (e) => { $("#filesAutoSave").checked = !!e.detail.filesAutoSave; $("#filesAutoRun").checked = !!e.detail.filesAutoRun; $("#micAllowed").checked = !!e.detail.micAllowed; });
  window.desktop.files.where().then((p) => { if (p) $("#filesWhere").textContent = p; }).catch(() => {});
  $("#delAllWrap").addEventListener("click", async (e) => {
    const act = e.target.closest("button")?.id;
    const wrap = $("#delAllWrap");
    if (act === "delAllChats") wrap.innerHTML = `Delete every saved chat? <button class="btn sm danger" id="delAllYes">Delete all</button> <button class="btn sm" id="delAllNo">Keep them</button>`;
    else if (act === "delAllNo") wrap.innerHTML = `<button class="linkish danger" id="delAllChats">Delete all saved chats</button>`;
    else if (act === "delAllYes") {
      await D.chats.removeAll();
      wrap.innerHTML = `<button class="linkish danger" id="delAllChats">Delete all saved chats</button>`;
      bus.dispatchEvent(new CustomEvent("chatsChanged")); toast("All saved chats deleted.");
    }
  });
  $("#voiceName").addEventListener("change", (e) => save({ voiceName: e.target.value }));
  $("#followUp").addEventListener("change", (e) => save({ followUpSeconds: +e.target.value }));
  $("#saveToken").addEventListener("click", async () => { await save({ hfToken: $("#hfToken").value.trim() }); toast("Saved."); });
  $("#openFolder2").addEventListener("click", () => D.sys.openModelsFolder());
  document.addEventListener("click", (e) => { const g = e.target.closest("#view-voice [data-goto]"); if (g) window.OMD.show(g.dataset.goto); });

  // ---------- Claude as one of your models, on your Claude Pro plan ----------
  const INSTALL = {
    win32: { label: "Windows (PowerShell)", cmd: "irm https://claude.ai/install.ps1 | iex" },
    darwin: { label: "Mac (Terminal)", cmd: "curl -fsSL https://claude.ai/install.sh | bash" },
    linux: { label: "Terminal", cmd: "curl -fsSL https://claude.ai/install.sh | bash" },
  };
  async function renderClaudeApi() {
    const box = $("#claudeApiBox");
    box.innerHTML = `<p class="small muted">Checking for Claude Code…</p>`;
    const [models, st, info] = await Promise.all([D.claude.models(), D.claude.plan(), D.sys.info()]);
    const cur = settings.claudeModel ?? "";
    const ready = st.installed && st.loggedIn && st.usesPlan;
    const on = ready && settings.claudeEnabled;
    const inst = INSTALL[info.platform] || INSTALL.linux;
    const step = (n, done, title, body) => `<li class="cstep ${done ? "done" : ""}"><span class="cnum">${done ? "✓" : n}</span><div><strong>${title}</strong>${body ? `<div class="small">${body}</div>` : ""}</div></li>`;
    box.className = "way" + (on ? " ok-box" : "");
    box.innerHTML = `
      <div class="claude-head"><span class="claude-mark online" aria-hidden="true">☁</span>
        <div><h3>${on ? "✓ Claude is one of your models" : "Add Claude, using your Claude Pro plan"}</h3>
        <p class="small muted">Claude then works right here in Chat and Voice mode, and you can Run it from Online models. There's no extra bill:
          it uses your Claude Pro (or Max) plan, through the official <strong>Claude Code</strong> app signed in to your account.
          It shares your plan's usage limit with claude.ai and the Claude app, and when the limit is used up it stops until the limit resets, just like the Claude app.
          Claude runs online, so what you ask it goes to Anthropic. Your downloaded models stay fully offline.</p></div></div>
      ${st.limit ? `<p class="small warn">⛔ Your Claude plan's limit is used up for now${st.limit !== "later" ? ` (resets ${esc(st.limit)})` : ""}.</p>` : ""}
      <ol class="csteps">
        ${step(1, st.installed, "Install Claude Code", st.installed ? `Installed${st.version ? ` (version ${esc(st.version)})` : ""}.`
          : `Open ${esc(inst.label)} and paste this, then press Enter:<pre class="cfg">${esc(inst.cmd)}</pre><button class="btn sm" id="copyInstall">Copy</button> <a href="https://code.claude.com/docs/en/setup">Other ways to install</a>`)}
        ${step(2, st.loggedIn && st.usesPlan, "Sign in with your Claude Pro account",
          !st.installed ? "" : st.loggedIn && st.usesPlan ? `Signed in${st.account ? ` as ${esc(st.account)}` : ""}${st.plan ? ` (${esc(st.plan)} plan)` : ""}.`
          : `${st.loggedIn ? "Claude Code is signed in with an API key, which is billed per use. Sign in with your Claude account instead. " : ""}<button class="btn sm primary" id="claudeLogin">Sign in</button>
             <span class="muted">or open a terminal, type <code>claude</code>, then <code>/login</code> and choose your Claude account.</span>`)}
        ${step(3, on, "Add Claude to my models", ready ? `<label class="toggle inline"><input type="checkbox" id="claudeEnabled" ${on ? "checked" : ""}> Use Claude in this app: Online models, Chat and wake phrases</label>` : "")}
      </ol>
      <p class="small"><button class="btn sm" id="claudeRecheck">Check again</button></p>
      <h3 class="mt">Which Claude</h3>
      <div class="cgrid">${models.map((m) => `
        <label class="copt ${m.id === cur ? "on" : ""}"><input type="radio" name="claudeModel" value="${m.id}" ${m.id === cur ? "checked" : ""}>
          <span><strong>${esc(m.name)}</strong><br><span class="small">${esc(m.blurb)}</span></span></label>`).join("")}</div>`;
    $("#copyInstall")?.addEventListener("click", () => { D.sys.copy(inst.cmd); toast("Copied. Paste it into " + inst.label + "."); });
    $("#claudeRecheck").addEventListener("click", () => renderClaudeApi());
    $("#claudeLogin")?.addEventListener("click", async (e) => {
      e.target.disabled = true; e.target.textContent = "Finish signing in in your browser…";
      try { await D.claude.login(); toast("Signed in."); } catch (err) { toast(clean(err), 8000); }
      renderClaudeApi();
    });
    $("#claudeEnabled")?.addEventListener("change", async (e) => {
      await save({ claudeEnabled: e.target.checked }); renderClaudeApi(); window.OMD.refreshMine();
      toast(e.target.checked ? "Claude added. Find it in Online models, or pick it at the top of Chat." : "Claude removed from your models.", 4500);
    });
    box.querySelectorAll("input[name=claudeModel]").forEach((r) => r.addEventListener("change", async () => {
      await save({ claudeModel: r.value }); renderClaudeApi(); window.OMD.refreshMine();
      toast(`Claude will now use ${models.find((m) => m.id === r.value).name.toLowerCase()}.`);
    }));
  }

  // ---------- Optimal mode ----------
  let autoTier = "@auto:8";
  async function renderAuto() {
    const box = $("#autoBox");
    const [tiers, p] = await Promise.all([D.auto.tiers(), D.auto.preview(autoTier)]);
    const any = p.picks.some((x) => x.name);
    box.innerHTML = `
      <p>Pick <strong>✨ Optimal</strong> at the top of Chat, or for a wake phrase, and the app chooses the best of your downloaded models for each question, then starts it.
        A coding question goes to a coding model, a maths question to a reasoning model, and so on. Everything else goes to your best everyday model.</p>
      <p class="small muted">The memory size (8 GB, 16 GB, 32 GB) is how much memory the chosen model may use. "For this computer" uses all of this computer's memory (${p.gb && autoTier === "@auto" ? p.gb + " GB" : "it works this out"}).
        When the words don't make the kind of question clear, a tiny model${p.router ? ` (<strong>${esc(p.router)}</strong>)` : ""} reads it first, which takes a second or two.
        ${p.router ? "" : "Download a small model (under 2.5 GB, like Llama 3.2 1B or Qwen2.5 1.5B) and Optimal mode uses it for this. Until then it goes by the words alone."}</p>
      <label class="small" for="autoTier"><strong>See what it would pick for</strong></label>
      <div class="srow"><select id="autoTier">${tiers.map((t) => `<option value="${t.id}" ${t.id === autoTier ? "selected" : ""}>${esc(t.name)}</option>`).join("")}</select></div>
      ${any ? `<table class="picks"><tbody>${p.picks.map((x) => `<tr><td>${esc(x.task[0].toUpperCase() + x.task.slice(1))}</td><td><strong>${esc(x.name)}</strong>
        ${!x.fits ? `<span class="small warn"> (nothing fits ${p.gb} GB, so the smallest)</span>` : x.matched ? "" : `<span class="small muted"> (no model made for this yet, so your best all-rounder)</span>`}</td></tr>`).join("")}</tbody></table>`
        : `<p class="small warn">Download a model first from Find models. Optimal mode picks from the models in My models.</p>`}`;
    $("#autoTier").addEventListener("change", (e) => { autoTier = e.target.value; renderAuto(); });
  }
  bus.addEventListener("models", () => renderAuto().catch(() => {}));

  // ---------- Updates ----------
  let upd = {};
  function renderUpdates() {
    const box = $("#updateBox");
    const st = upd;
    const msg = {
      idle: "", checking: "Checking GitHub for a newer version…",
      current: `✓ You have the newest version${st.latest ? ` (${esc(st.latest)})` : ""}.`,
      available: `🎉 Version <strong>${esc(st.latest || "")}</strong> is available.`,
      downloading: `Downloading the update… ${st.percent || 0}%`,
      ready: `✓ Version ${esc(st.latest || "")} is downloaded. Restart to finish.`,
      error: `<span class="warn">${esc(st.message || "Couldn't check for updates.")}</span>`,
    }[st.state || "idle"];
    box.innerHTML = `
      <div class="row"><h3>Open Model Desktop ${esc(st.current || "")}</h3>
        <span>${st.state === "available" ? `<button class="btn primary" id="updDownload">Download update</button>`
          : st.state === "ready" ? `<button class="btn primary" id="updInstall">Restart to update</button>`
          : `<button class="btn" id="updCheck" ${st.state === "checking" || st.state === "downloading" ? "disabled" : ""}>Check for updates</button>`}</span></div>
      ${msg ? `<p>${msg}</p>` : ""}
      ${st.state === "downloading" ? `<div class="bar"><span style="width:${st.percent || 0}%"></span></div>` : ""}
      ${st.notes && st.state === "available" ? `<p class="small muted">${esc(st.notes)}</p>` : ""}
      ${st.packaged || st.state === "error" ? "" : `<p class="small muted">Updates work in the installed app (the one from the setup wizard). You're running it from the source folder.</p>`}
      <label class="small" for="updRepo"><strong>GitHub repository with the updates</strong> <span class="muted">(like <code>yourname/open-model-desktop</code>)</span></label>
      <div class="srow"><input id="updRepo" placeholder="owner/name" value="${esc(settings.updateRepo || st.repo || "")}" autocomplete="off"><button class="btn sm" id="updSave">Save</button></div>
      <p class="small muted">The app checks this repository's Releases on GitHub a few seconds after it starts, and tells you when there's a newer version. Nothing is downloaded until you press Download.</p>`;
    $("#updCheck")?.addEventListener("click", async () => { try { await D.updates.check(); } catch (err) { upd = { ...upd, state: "error", message: clean(err) }; renderUpdates(); } });
    $("#updDownload")?.addEventListener("click", async () => { try { await D.updates.download(); } catch (err) { upd = { ...upd, state: "error", message: clean(err) }; renderUpdates(); } });
    $("#updInstall")?.addEventListener("click", () => D.updates.install());
    $("#updSave").addEventListener("click", async () => {
      const v = $("#updRepo").value.trim().replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/, "").replace(/\/+$/, "");
      if (v && !/^[\w.-]+\/[\w.-]+$/.test(v)) { toast("That doesn't look right. Use owner/name, like yourname/open-model-desktop."); return; }
      await save({ updateRepo: v }); upd = { ...upd, ...(await D.updates.status()), state: "idle" }; renderUpdates();
      toast(v ? "Saved. Press Check for updates." : "Cleared.");
    });
  }
  D.updates.onStatus((st) => { upd = { ...upd, ...st }; renderUpdates(); });

  // ---------- Use with the Claude app ----------
  async function renderClaude(st) {
    st ??= await D.claude.status();
    const box = $("#claudeBox");
    box.className = "way" + (st.connected ? " ok-box" : "");
    box.innerHTML = `
      <div class="claude-head"><span class="claude-mark" aria-hidden="true">🔌</span>
        <div><h3>${st.connected ? "✓ Connected to the Claude desktop app" : "Let the Claude desktop app use your downloaded models"}</h3>
        <p class="small muted">${st.connected
          ? "In the Claude app you can now say things like <em>“ask my local Qwen model to summarise this”</em> or <em>“read that out loud in George's voice”</em>. Claude asks before using a tool the first time."
          : "Claude can hand work to the models on this computer, which keeps it private and works with no internet for the model part. It can also read answers out loud in your natural voices."}</p></div></div>
      ${st.claudeFound ? "" : `<p class="small warn">The Claude app wasn't found on this computer. Get it from <a href="https://claude.ai/download">claude.ai/download</a>, open it once, then come back.</p>`}
      <div class="row-btns">
        ${st.connected ? `<button class="btn sm" id="claudeOff">Disconnect</button>` : `<button class="btn primary" id="claudeOn" ${st.claudeFound ? "" : "disabled"}>Connect to the Claude app</button>`}
        <span class="small muted">${st.connected ? "If you just connected, quit and reopen the Claude app once." : "Then quit and reopen the Claude app once."}</span>
      </div>
      <details class="howto"><summary>What Claude can do, and how to set it up by hand</summary>
        <ul class="small">
          <li><strong>List my local models</strong>: see what's downloaded here and what's running.</li>
          <li><strong>Ask a local model</strong>: send a question to one of your models and get its answer back.</li>
          <li><strong>Speak aloud</strong>: read text out loud with Hannah, Emma, George and the other voices.</li>
        </ul>
        <p class="small muted">If this app isn't open, Claude starts it quietly in the tray. Nothing leaves your computer except what you and Claude already send to Claude.</p>
        <p class="small">Claude app settings file: <code>${esc(st.configFile)}</code></p>
        <pre class="cfg">${esc(st.manual)}</pre>
        <p class="small"><button class="btn sm" id="copyCfg">Copy setup text</button> <button class="btn sm" id="copyCli">Copy Claude Code command</button></p>
      </details>`;
    $("#claudeOn")?.addEventListener("click", async (e) => {
      e.target.disabled = true;
      try { renderClaude(await D.claude.connect()); toast("Connected. Quit and reopen the Claude app to start using your models there.", 6000); }
      catch (err) { toast(clean(err), 7000); e.target.disabled = false; }
    });
    $("#claudeOff")?.addEventListener("click", async () => {
      try { renderClaude(await D.claude.disconnect()); toast("Disconnected from the Claude app."); } catch (err) { toast(clean(err), 7000); }
    });
    $("#copyCfg").addEventListener("click", () => { D.sys.copy(st.manual); toast("Copied. Paste it into the Claude app's settings file."); });
    $("#copyCli").addEventListener("click", () => { D.sys.copy(st.cli); toast("Copied. Paste it into a terminal where Claude Code is installed."); });
  }
  // Show what Claude is doing with your models.
  D.claude.onActivity((a) => { if (a.kind === "ask") toast(`The Claude app asked ${a.model} a question…`, 4000); });
  D.claude.onSay(({ text, voice }) => {
    const v = S.VOICES.find((x) => x.name.toLowerCase() === voice.toLowerCase() || x.id === voice);
    S.stop(); S.sayAll(text, v?.id);
  });

  window.OMDSettings = { get: () => settings, save: (patch) => save(patch) };

  (async () => {
    settings = await D.settings.get();
    S.configure(settings);
    await S.refresh();
    $("#voiceSpeed").value = settings.voiceSpeed || 1; $("#voiceSpeedVal").textContent = (+(settings.voiceSpeed || 1)).toFixed(2) + "×";
    $("#speakReplies").checked = settings.speakReplies !== false;
    $("#speakChat").checked = !!settings.speakChat;
    $("#saveChats").checked = settings.saveChats !== false;
    $("#makeFiles").checked = settings.makeFiles !== false;
    $("#filesAutoSave").checked = !!settings.filesAutoSave;
    $("#micAllowed").checked = !!settings.micAllowed;
    $("#multiModels").checked = settings.multiModels !== false;
    $("#filesAutoRun").checked = !!settings.filesAutoRun;
    $("#followUp").value = String(settings.followUpSeconds ?? 8);
    $("#hfToken").value = settings.hfToken || "";
    fillSystemVoices(); renderTts(); renderVoices();
    renderClaudeApi().catch((err) => { $("#claudeApiBox").textContent = "Couldn't load Claude settings: " + clean(err); });
    renderClaude().catch((err) => { $("#claudeBox").textContent = "Couldn't check the Claude app: " + clean(err); });
    renderAuto().catch((err) => { $("#autoBox").textContent = "Couldn't load Optimal mode: " + clean(err); });
    upd = await D.updates.status(); renderUpdates();
  })();
})();
