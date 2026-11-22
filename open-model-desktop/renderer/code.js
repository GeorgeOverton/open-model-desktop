// Claude Code mode: pick a folder, ask for a change, and Claude works on the files there.
// Like the VS Code extension, it asks before it edits a file or runs a command (unless you choose otherwise).
(() => {
  "use strict";
  const { $, esc, toast, bus, store } = window.OMD;
  const D = window.desktop;
  const clean = (err) => String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
  const md = (t) => window.OMDChat.md(t);

  let folder = store.get("codeFolder", "");
  let recent = store.get("codeRecent", []);
  let sessions = store.get("codeSessions", {});
  let mode = store.get("codeMode", "default");
  let runId = null, textEl = null, textBuf = "";
  const cards = new Map();   // tool id -> card element
  const log = () => $("#codeLog");

  const base = (p) => String(p || "").split(/[\\/]/).filter(Boolean).pop() || p;
  const rel = (p) => {
    const s = String(p || "");
    if (folder && s.toLowerCase().startsWith(folder.toLowerCase())) return s.slice(folder.length).replace(/^[\\/]+/, "") || base(s);
    return s;
  };

  // ---------- Top bar ----------
  async function fillModes() {
    const modes = await D.code.modes();
    $("#codeMode").innerHTML = modes.map((m) => `<option value="${m.id}" ${m.id === mode ? "selected" : ""} title="${esc(m.blurb)}">${esc(m.name)}</option>`).join("");
    $("#codeMode").title = modes.find((m) => m.id === mode)?.blurb || "";
  }
  $("#codeMode").addEventListener("change", async (e) => { mode = e.target.value; store.set("codeMode", mode); await fillModes(); });
  function renderBar() {
    $("#codeFolder").textContent = folder ? `📁 ${base(folder)}` : "📁 Choose a folder…";
    $("#codeFolder").title = folder || "Choose the folder Claude can work in";
    $("#codePath").textContent = folder || "";
  }
  async function chooseFolder() {
    const f = await D.code.pickFolder();
    if (f) useFolder(f);
  }
  function useFolder(f) {
    if (runId) { toast("Wait for Claude to finish (or press Stop) first."); return; }
    folder = f; store.set("codeFolder", f);
    recent = [f, ...recent.filter((x) => x !== f)].slice(0, 6); store.set("codeRecent", recent);
    renderBar(); showEmpty();
    $("#codePrompt").focus();
  }
  $("#codeFolder").addEventListener("click", chooseFolder);
  $("#codeNew").addEventListener("click", () => {
    if (runId) D.code.stop(runId);
    if (folder) { delete sessions[folder]; store.set("codeSessions", sessions); }
    showEmpty(); $("#codePrompt").focus();
  });

  // ---------- Empty screen: what this is, and setting it up ----------
  async function showEmpty() {
    cards.clear(); textEl = null;
    const st = await D.claude.plan().catch(() => ({}));
    const ready = st.installed && st.loggedIn && st.usesPlan;
    log().innerHTML = `<div class="codeintro">
      <h2>Claude Code</h2>
      <p>Choose a folder, then ask Claude to do something with the files in it: <em>"fix the bug where the total is wrong"</em>,
        <em>"make a simple website for my bakery"</em>, <em>"tidy up these notes into one document"</em>.
        Claude reads the files, then shows you each change it wants to make. Nothing changes until you press <strong>Allow</strong>.</p>
      <p class="small muted">This uses the official Claude Code on your Claude Pro plan, like the VS Code extension, and shares your plan's usage limit. Claude only works inside the folder you choose. What it reads is sent to Anthropic.</p>
      ${ready ? "" : `<p class="warn small">${!st.installed ? "Claude Code isn't installed yet." : "Claude Code isn't signed in to your Claude account yet."}
        <button class="btn sm primary" data-goto="settings" data-claude-settings>Set it up in Settings</button></p>`}
      ${folder ? `<p>Working in <strong>${esc(base(folder))}</strong> <span class="small muted">${esc(folder)}</span> <button class="linkish small" id="codeOpenFolder">Open folder</button></p>
        ${sessions[folder] ? `<p class="small muted">Claude remembers your last task in this folder, so you can carry on. Press New task to start fresh.</p>` : ""}`
        : `<p><button class="btn primary" id="codePick">📁 Choose a folder</button></p>`}
      ${recent.filter((f) => f !== folder).length ? `<div class="small"><div class="muted">Recent folders</div>${recent.filter((f) => f !== folder).map((f) => `<button class="chip recentf" data-folder="${esc(f)}" title="${esc(f)}">📁 ${esc(base(f))}</button>`).join(" ")}</div>` : ""}
    </div>`;
  }
  log().addEventListener("click", (e) => {
    const go = e.target.closest("[data-goto]");
    if (go) { window.OMD.show("settings"); setTimeout(() => $("#claudeApiBox")?.scrollIntoView({ block: "start" }), 60); return; }
    if (e.target.id === "codePick") return chooseFolder();
    if (e.target.id === "codeOpenFolder") return D.code.open(folder);
    const rf = e.target.closest("[data-folder]"); if (rf) return useFolder(rf.dataset.folder);
    const ap = e.target.closest("[data-ans]"); if (ap) return answer(ap);
  });

  // ---------- Showing what Claude does ----------
  function add(cls, html) {
    if (log().querySelector(".codeintro")) log().innerHTML = "";
    const el = document.createElement("div");
    el.className = cls; el.innerHTML = html;
    log().appendChild(el);
    const w = log().querySelector(".codeworking"); if (w && w !== el) log().appendChild(w);   // keep "Claude is working…" at the bottom
    el.scrollIntoView({ block: "end" });
    return el;
  }
  const lines = (s, sign, cls) => String(s ?? "").split("\n").map((l) => `<div class="dln ${cls}"><span>${sign}</span>${esc(l) || " "}</div>`).join("");
  const diff = (oldS, newS) => `<div class="diff">${lines(oldS, "−", "del")}${lines(newS, "+", "add")}</div>`;
  function describe(name, input) {
    const p = rel(input.file_path || input.notebook_path || input.path || "");
    switch (name) {
      case "Read": return { icon: "📖", title: `Read <b>${esc(p)}</b>` };
      case "Edit": return { icon: "✏️", title: `Edit <b>${esc(p)}</b>`, body: diff(input.old_string, input.new_string) };
      case "MultiEdit": return { icon: "✏️", title: `Edit <b>${esc(p)}</b> (${(input.edits || []).length} changes)`, body: (input.edits || []).map((x) => diff(x.old_string, x.new_string)).join("") };
      case "Write": return { icon: "📝", title: `Write <b>${esc(p)}</b>`, body: `<div class="diff">${lines(input.content, "+", "add")}</div>` };
      case "NotebookEdit": return { icon: "📓", title: `Edit notebook <b>${esc(p)}</b>`, body: `<pre>${esc(input.new_source || "")}</pre>` };
      case "Bash": return { icon: "▶", title: `Run a command${input.description ? `: ${esc(input.description)}` : ""}`, body: `<pre class="cmd">${esc(input.command)}</pre>` };
      case "Glob": return { icon: "🔎", title: `Look for files matching <code>${esc(input.pattern)}</code>` };
      case "Grep": return { icon: "🔎", title: `Search the files for <code>${esc(input.pattern)}</code>` };
      case "LS": return { icon: "📂", title: `List <b>${esc(p || "the folder")}</b>` };
      case "WebFetch": return { icon: "🌐", title: `Open <b>${esc(input.url)}</b>` };
      case "WebSearch": return { icon: "🌐", title: `Search the web for <b>${esc(input.query)}</b>` };
      case "TodoWrite": return { icon: "☑", title: "To-do list", body: `<ul class="todos">${(input.todos || []).map((t) => `<li class="${esc(t.status)}">${t.status === "completed" ? "✅" : t.status === "in_progress" ? "⏳" : "⬜"} ${esc(t.content)}</li>`).join("")}</ul>` };
      case "Task": return { icon: "🤖", title: `Helper: ${esc(input.description || "")}` };
      case "ExitPlanMode": return { icon: "📋", title: "Claude's plan", body: `<div class="plan">${md(input.plan || "")}</div>` };
      default: return { icon: "🔧", title: esc(name.replace(/^mcp__\w+__/, "")), body: `<pre>${esc(JSON.stringify(input, null, 2)).slice(0, 4000)}</pre>` };
    }
  }
  function toolCard(ev) {
    textEl = null;
    if (ev.name === "TodoWrite") { const old = log().querySelector(".tcard.todo"); if (old) old.remove(); }
    const d = describe(ev.name, ev.input);
    const el = add(`tcard ${ev.name === "TodoWrite" ? "todo" : ""}`, `<div class="thead"><span class="ticon">${d.icon}</span><span class="ttitle">${d.title}</span><span class="tstate small muted"></span></div>${d.body ? `<div class="tbody">${d.body}</div>` : ""}`);
    el.dataset.tool = ev.name; el._input = ev.input;
    cards.set(ev.id, el);
  }
  function toolResult(ev) {
    const el = cards.get(ev.id); if (!el) return;
    el.classList.add(ev.error ? "failed" : "done");
    el.querySelector(".tstate").textContent = ev.error ? (/denied|said no|user (doesn't|does not) want|rejected/i.test(ev.text) ? "Not allowed" : "Didn't work") : "✓";
    el.querySelector(".tapprove")?.remove();
    const show = el.dataset.tool === "Bash" || ev.error;
    if (show && ev.text.trim()) el.insertAdjacentHTML("beforeend", `<details class="tout"><summary>${ev.error ? "What went wrong" : "Output"}</summary><pre>${esc(ev.text.slice(0, 8000))}</pre></details>`);
  }
  function approvalCard(a) {
    // Attach the question to the card for that step, if it's on screen.
    const el = [...cards.values()].reverse().find((c) => c.dataset.tool === a.tool && !c.classList.contains("done") && !c.classList.contains("failed") && !c.querySelector(".tapprove"))
      || add("tcard", `<div class="thead"><span class="ticon">🔧</span><span class="ttitle">${describe(a.tool, a.input).title}</span><span class="tstate small muted"></span></div>`);
    el.classList.add("asking");
    const edit = /^(Edit|MultiEdit|Write|NotebookEdit)$/.test(a.tool);
    const always = edit ? "Allow all edits in this folder" : a.tool === "Bash" ? `Always allow "${esc(String(a.input.command || "").trim().split(/\s+/)[0])}" commands` : `Always allow ${esc(a.tool)}`;
    const plan = a.tool === "ExitPlanMode";
    el.insertAdjacentHTML("beforeend", `<div class="tapprove" data-id="${esc(a.id)}">
      <span class="small"><strong>${plan ? "Go ahead with this plan?" : edit ? "Make this change?" : a.tool === "Bash" ? "Run this command?" : "Allow this?"}</strong></span>
      <span class="abtns"><button class="btn sm primary" data-ans="allow" type="button">${plan ? "Yes, go ahead" : "Allow"}</button>
      ${plan ? "" : `<button class="btn sm" data-ans="always" type="button" title="Until you close the app">${always}</button>`}
      <button class="btn sm" data-ans="deny" type="button">${plan ? "No, keep planning" : "Don't allow"}</button></span>
      <input class="tinstead" placeholder="Or tell Claude what to do instead, then press Don't allow" aria-label="Tell Claude what to do instead"></div>`);
    el.scrollIntoView({ block: "end" });
    el.querySelector("[data-ans=allow]").focus();
  }
  async function answer(btn) {
    const box = btn.closest(".tapprove"); if (!box) return;
    const decision = btn.dataset.ans, msg = box.querySelector(".tinstead").value.trim();
    box.querySelectorAll("button,input").forEach((x) => { x.disabled = true; });
    await D.code.answer({ id: box.dataset.id, decision, message: msg ? `The user said no, and said: ${msg}` : "" });
    const card = box.closest(".tcard"); card.classList.remove("asking");
    card.querySelector(".tstate").textContent = decision === "deny" ? "Not allowed" : "Allowed";
    box.remove();
  }
  D.code.onApprove((a) => { if (a.runId === runId) approvalCard(a); });
  D.code.onEvent((ev) => {
    if (ev.runId !== runId) return;
    if (ev.kind === "text") {
      if (!textEl) { textBuf = ""; textEl = add("msg bot codetext", `<div class="answer"></div>`).querySelector(".answer"); }
      textBuf += ev.text; textEl.innerHTML = md(textBuf); textEl.scrollIntoView({ block: "end" });
    } else if (ev.kind === "break") textEl = null;
    else if (ev.kind === "tool") toolCard(ev);
    else if (ev.kind === "result") toolResult(ev);
  });

  // ---------- Asking ----------
  function setBusy(v) { $("#codeSend").hidden = v; $("#codeStop").hidden = !v; $("#codeFolder").disabled = v; }
  const prompt = $("#codePrompt");
  prompt.addEventListener("input", () => { prompt.style.height = "auto"; prompt.style.height = Math.min(200, prompt.scrollHeight) + "px"; });
  prompt.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("#codeForm").requestSubmit(); } });
  $("#codeStop").addEventListener("click", () => runId && D.code.stop(runId));
  $("#codeForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = prompt.value.trim();
    if (!text || runId) return;
    if (!folder) { toast("Choose a folder first."); return chooseFolder(); }
    prompt.value = ""; prompt.style.height = "auto";
    add("msg user", esc(text).replace(/\n/g, "<br>"));
    const working = add("codeworking small muted", `<span class="dots">●●●</span> Claude is working in ${esc(base(folder))}…`);
    runId = Math.random().toString(36).slice(2); textEl = null;
    const my = runId;
    setBusy(true);
    try {
      const r = await D.code.send({ runId: my, folder, text, mode, resume: sessions[folder] || null });
      if (r?.session) { sessions[folder] = r.session; store.set("codeSessions", sessions); }
      add("codedone small muted", r?.stopped ? "Stopped." : `✓ Done${r?.seconds ? ` in ${r.seconds < 60 ? r.seconds + " s" : Math.round(r.seconds / 60) + " min"}` : ""}. <button class="linkish" id="codeOpenFolder">Open folder</button>`);
    } catch (err) {
      add("codedone err", esc(clean(err)));
    } finally {
      working.remove();
      runId = null; setBusy(false);
      log().querySelectorAll(".tapprove").forEach((b) => b.remove());
      log().lastElementChild?.scrollIntoView({ block: "end" });
    }
  });

  bus.addEventListener("view", (e) => { if (e.detail === "code" && !runId && !log().children.length) showEmpty(); if (e.detail === "code") setTimeout(() => prompt.focus(), 50); });
  fillModes(); renderBar(); showEmpty();
})();
