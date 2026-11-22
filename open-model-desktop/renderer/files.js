// Finds the files in a model's answer. Small local models rarely follow a format exactly, so this is forgiving:
// it takes the file name from wherever the model put it, guesses one when the user asked for a file and the model
// didn't name it, and saves the whole answer as a document when a file was asked for but no code block came back.
(() => {
  "use strict";
  const EXT = { python: "py", py: "py", python3: "py", javascript: "js", js: "js", node: "js", jsx: "jsx", typescript: "ts", ts: "ts", tsx: "tsx", html: "html", htm: "html",
    css: "css", scss: "scss", json: "json", bash: "sh", sh: "sh", shell: "sh", zsh: "sh", powershell: "ps1", ps1: "ps1", ps: "ps1", bat: "bat", batch: "bat", cmd: "bat",
    sql: "sql", markdown: "md", md: "md", csv: "csv", tsv: "tsv", yaml: "yml", yml: "yml", java: "java", c: "c", h: "h", cpp: "cpp", "c++": "cpp", csharp: "cs", "c#": "cs", cs: "cs",
    go: "go", golang: "go", rust: "rs", rs: "rs", ruby: "rb", rb: "rb", php: "php", xml: "xml", svg: "svg", text: "txt", txt: "txt", plaintext: "txt", plain: "txt", ini: "ini",
    toml: "toml", kotlin: "kt", kt: "kt", swift: "swift", lua: "lua", r: "r", perl: "pl", dart: "dart", vue: "vue", latex: "tex", tex: "tex", vbscript: "vbs", vb: "vb" };
  const KIND = { py: "Python", js: "JavaScript", ts: "TypeScript", html: "Web page", css: "Stylesheet", json: "JSON", sh: "Shell script", ps1: "PowerShell script", bat: "Batch file",
    sql: "SQL", md: "Document", csv: "Spreadsheet (CSV)", tsv: "Spreadsheet (TSV)", yml: "YAML", txt: "Text", svg: "Picture (SVG)", xml: "XML", java: "Java", cs: "C#", cpp: "C++", c: "C",
    go: "Go", rs: "Rust", rb: "Ruby", php: "PHP" };
  const EXTS = "py|pyw|js|mjs|cjs|jsx|ts|tsx|html?|css|scss|less|json|jsonl|sh|bash|ps1|bat|cmd|sql|md|markdown|csv|tsv|ya?ml|java|c|h|cpp|hpp|cc|cs|go|rs|rb|php|xml|svg|txt|ini|toml|cfg|conf|env|kt|swift|lua|r|pl|dart|vue|tex|ics|vcf|log|vbs|vb|gitignore|dockerfile|makefile";
  // Names that look like files but are things people talk about (Node.js, Chart.js ...).
  const NOT_FILES = /^(node|vue|next|nuxt|react|three|chart|d3|express|ember|backbone|angular|alpine|p5|socket|deno|nest|solid|svelte|anime|moment|lodash|underscore|jquery|bootstrap|tailwind|ext|knockout|marionette|meteor|phaser|pixi|paper|fabric|leaflet|hammer|matter|tone|ml5|brain|tf)\.js$|^asp\.net$|^e\.g$|^i\.e$/i;
  const NAME = new RegExp(String.raw`([A-Za-z0-9_][\w\-\/\\]*?\.(?:${EXTS})|\.(?:gitignore|env)|(?:Dockerfile|Makefile))(?![\w.])`, "i");
  const NAME_G = new RegExp(NAME.source, "gi");
  const QUOTED = new RegExp(String.raw`[\`"'“‘]([^\`"'”’\n]{1,80}?\.(?:${EXTS}))[\`"'”’]`, "i");
  const okName = (n) => n && !NOT_FILES.test(n.split(/[\\/]/).pop()) && !/^\d+\.\d+$/.test(n);
  const base = (n) => n.split(/[\\/]/).pop().trim();

  // ---------- What the user asked for ----------
  const FILE_NOUN = /\b(files?|scripts?|programs?|web ?pages?|websites?|pages?|documents?|docs?|spreadsheets?|csv|tsv|json|txt|text files?|readme|config(?:uration)? files?|html|stylesheets?|batch files?|apps?|games?|markdown|templates?|reports?|letters?|essays?|resumes?|cvs?|invoices?|lists?|notes|plans?|timetables?|schedules?|recipes?|calendars?)\b/i;
  const MAKE_VERB = /\b(create|make|write|generate|save|build|give me|produce|draft|code|put|turn|export|convert|need|want)\b/i;
  const DOC_NOUN = /\b(files?|documents?|docs?|spreadsheets?|csv|tsv|txt|text files?|markdown|readme|\.md|reports?|letters?|essays?|resumes?|cvs?|invoices?|templates?)\b/i;
  const ASKS_FILE = /\b(as|in|into|to) an? (\w+ )?(file|document|spreadsheet)\b|\bfile (called|named)\b|\bsave (it|this|that)\b|\bdownload(able)?\b/i;
  function wantsFile(req) {
    const s = String(req || "");
    if (!s) return false;
    if (requestName(s) || ASKS_FILE.test(s)) return true;
    const m = s.match(MAKE_VERB);
    return !!m && FILE_NOUN.test(s.slice(m.index));
  }
  // A document file is wanted even when the model answers in plain text (no code block).
  const wantsDoc = (req) => { const s = String(req || ""); return !!requestName(s) || ASKS_FILE.test(s) || (wantsFile(s) && DOC_NOUN.test(s)); };
  function requestName(req) {
    const s = String(req || "");
    const q = s.match(QUOTED); if (q && okName(q[1])) return base(q[1]);
    for (const m of s.matchAll(NAME_G)) if (okName(m[1]) && /[A-Za-z]/.test(m[1].split(".")[0] || "x")) return base(m[1]);
    return "";
  }
  const STOP = new Set(("a an the me my our your please can could would you i want need to of in on for with that which this it and or is be will so as at by from into about " +
    "create make write generate save build give produce draft code put turn export convert simple small quick little new basic short nice full whole complete " +
    "file files script scripts program programs code page pages web webpage website document doc spreadsheet csv tsv txt text json html markdown called named " +
    "python javascript js typescript css bash shell powershell sql java c cpp rust go ruby php kotlin swift lua using use some just also then their his her its node separate two three one version versions"
    ).split(" "));
  function slugFrom(req) {
    const words = String(req || "").toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).filter((w) => w && !STOP.has(w) && w.length > 1 && !/^\d+$/.test(w));
    return words.slice(0, 3).join("-").slice(0, 40) || "";
  }
  const KIND_WORD = [[/\bweb ?page|website|landing page|html\b/i, "page"], [/\bspreadsheet|csv\b/i, "table"], [/\bscript\b/i, "script"], [/\bgame\b/i, "game"],
    [/\bapp\b/i, "app"], [/\blist\b/i, "list"], [/\bnotes\b/i, "notes"], [/\bletter\b/i, "letter"], [/\breport\b/i, "report"]];
  const kindWord = (req) => (KIND_WORD.find(([re]) => re.test(req)) || [, "file"])[1];
  function langFromRequest(req) {
    const s = String(req || "").toLowerCase();
    if (/\bpython\b/.test(s)) return "py"; if (/\b(web ?page|website|html)\b/.test(s)) return "html"; if (/\bjavascript|node\b/.test(s)) return "js";
    if (/\bpowershell\b/.test(s)) return "ps1"; if (/\b(bash|shell script)\b/.test(s)) return "sh"; if (/\bbatch\b/.test(s)) return "bat";
    if (/\b(spreadsheet|csv)\b/.test(s)) return "csv"; if (/\bjson\b/.test(s)) return "json"; if (/\bmarkdown\b/.test(s)) return "md"; if (/\bsql\b/.test(s)) return "sql";
    if (/\btext file|txt\b/.test(s)) return "txt";
    return "";
  }
  // When the code block has no language, look at what's inside.
  function sniff(body) {
    const t = body.trimStart();
    if (/^<!doctype html|^<html|<\/(body|div|head)>/i.test(t)) return "html";
    if (/^<svg/i.test(t)) return "svg";
    if (/^<\?xml/i.test(t)) return "xml";
    if (/^#!.*\b(ba|z)?sh\b/.test(t)) return "sh";
    if (/^#!.*python/.test(t) || /^(import \w+|from [\w.]+ import|def \w+\(|class \w+[:(]|print\()/m.test(t)) return "py";
    if (/^(const|let|var|function|import .* from|export |console\.log|document\.)/m.test(t)) return "js";
    if (/^\s*[{[]/.test(t)) { try { JSON.parse(t); return "json"; } catch {} }
    if (/^[^{};\n]+\{[^}]*:[^}]*;[^}]*\}/m.test(t) && !/[()]\s*\{/.test(t)) return "css";
    const lines = t.split("\n").filter(Boolean);
    if (lines.length >= 2 && lines.every((l) => l.split(",").length >= 2) && new Set(lines.slice(0, 6).map((l) => l.split(",").length)).size === 1) return "csv";
    if (/^(#{1,6} |\* |- |\d+\. )/m.test(t)) return "md";
    if (/^(SELECT|CREATE TABLE|INSERT INTO)\b/im.test(t)) return "sql";
    return "";
  }
  const extOf = (lang, body, req) => EXT[lang] || (lang && /^[a-z0-9]{1,6}$/.test(lang) && new RegExp(`^(${EXTS})$`, "i").test(lang) ? lang : "") || sniff(body) || langFromRequest(req) || "txt";

  // ---------- Where the model put the name ----------
  const strip = (l) => l.replace(/\*\*|__|[*`#>~]|📄|📁|📝|🗂️?|^\s*(?:[-+]|\d+[.)])\s+/g, "").trim();
  // Look at the text just before a code block (its last line or two).
  function nameBefore(before) {
    const lines = before.replace(/\s+$/, "").split("\n");
    for (let k = lines.length - 1, n = 0; k >= 0 && n < 2; k--, n++) {
      const raw = lines[k];
      if (!raw.trim()) { n--; if (lines.length - k > 3) break; continue; }
      const q = raw.match(QUOTED), plain = strip(raw);
      const m = (q && okName(q[1]) && q) || [...plain.matchAll(NAME_G)].reverse().find((x) => okName(x[1]));
      if (!m) { if (n === 0) continue; break; }
      const name = base(m[1]);
      const rest = plain.replace(m[1], "").replace(/\b(file ?name|file|save (?:this |it )?(?:as|to)|name|path|filename)\b/gi, "").replace(/[\s:=()\-–—.,]/g, "");
      const strong = !rest || /:\s*$/.test(raw) || /\b(file|save|saved|called|named|create|put|paste|copy|into|as)\b/i.test(plain) || !!q;
      if (!strong) return null;
      // Take the name line out of the answer when it held nothing but the name.
      const cut = !rest ? lines.slice(0, k).join("\n") : null;
      return { name, cut };
    }
    return null;
  }
  // A first line in the code like "# hello.py", "// app.js" or "<!-- index.html -->".
  const FIRST_LINE = new RegExp(String.raw`^\s*(?:#|\/\/|--|;|<!--|\/\*|%|'|REM\b|::)\s*(?:file(?:name)?\s*[:=]\s*)?([\w.\-\/\\]+\.(?:${EXTS}))\s*(?:-->|\*\/)?\s*$`, "i");
  const nameInside = (body) => { const m = body.split("\n", 1)[0].match(FIRST_LINE); return m && okName(m[1]) ? base(m[1]) : ""; };
  function nameInInfo(info) {
    const m = info.match(/(?:file(?:name)?|title|name|path)\s*[=:]\s*["']?([^"'\s]+)/i); if (m) return base(m[1]);
    const parts = info.split(/[\s:]+/).filter(Boolean);
    const f = parts.find((p) => NAME.test(p) && p.match(NAME)[1].length === p.length && okName(p));
    return f ? base(f) : "";
  }
  const SHELLISH = /^(bash|sh|shell|console|terminal|cmd|powershell|ps|zsh|text|)$/;
  const isCommand = (b) => SHELLISH.test(b.lang) && b.content.trim().split("\n").length <= 2 && /^\s*(\$ )?(pip|npm|npx|python3?|node|cd|mkdir|open|start|run|java|javac|gcc|g\+\+|go|cargo|ruby|php|bash|sh|chmod|\.\/)\b/.test(b.content);

  // Split the answer into text and code blocks. final: the model has finished (an unclosed last block counts as finished).
  // earlier: names of files made earlier in this chat, so "now make it say goodbye" updates hello.py.
  function parse(text, { request = "", final = false, saved = [], files = true, earlier = [] } = {}) {
    const parts = [], blocks = [];
    const src = String(text || "");
    const re = /(`{3,}|~{3,})([^\n`]*)\n?([\s\S]*?)(\n?[ \t]*\1[ \t]*(?=\n|$)|$)/g;
    let last = 0, m;
    while ((m = re.exec(src))) {
      if (m[0] === "") { re.lastIndex++; continue; }
      const closed = !!m[4];
      let before = src.slice(last, m.index).replace(/[ \t]+$/, "");
      const info = m[2].trim(), body = m[3];
      const lang = (info.split(/[\s:{=]/)[0] || "").toLowerCase().replace(/^\./, "");
      let name = "", how = "";
      if (files) {
        name = nameInInfo(info); if (name) how = "info";
        if (!name) { const nb = nameBefore(before); if (nb) { name = nb.name; how = "before"; if (nb.cut != null) before = nb.cut; } }
        if (!name) { name = nameInside(body); if (name) how = "inside"; }
      }
      parts.push({ t: "text", s: before });
      const b = { i: blocks.length, name, how, lang, content: body.replace(/\n[ \t]*$/, ""), done: closed || final };
      blocks.push(b); parts.push({ t: "block", b });
      last = m.index + m[0].length;
      if (!closed) break;
    }
    parts.push({ t: "text", s: src.slice(last) });
    if (files) guessNames(blocks, parts, { request, final, saved, src, earlier });
    // Two files with the same name: number the later ones.
    const seen = new Map();
    for (const b of blocks) if (b.name) {
      const k = b.name.toLowerCase(), n = (seen.get(k) || 0) + 1; seen.set(k, n);
      if (n > 1) b.name = b.name.replace(/(\.[^.]+)?$/, (e) => `-${n}${e}`);
    }
    for (const s of saved) { const b = blocks[s.b]; if (b && s.name) { b.name = s.name; b.path = s.path || ""; } }
    return { parts, blocks };
  }

  function guessNames(blocks, parts, { request, final, saved, src, earlier }) {
    const wants = wantsFile(request);
    // A changed version of a file made earlier in the chat keeps its name (when only one earlier file has that kind).
    if (earlier.length) {
      const loose = blocks.filter((b) => !b.name && !isCommand(b) && b.content.trim().split("\n").length > 2);
      for (const b of loose) {
        const ext = extOf(b.lang, b.content, request), same = [...new Set(earlier)].filter((n) => n.split(".").pop().toLowerCase() === ext);
        if (same.length === 1 && !blocks.some((x) => x.name === same[0])) { b.name = same[0]; b.how = "earlier"; }
      }
    }
    const savedWhole = saved.find((s) => s.whole);
    if (!blocks.length) {
      // A file was asked for and the answer has no code block: the answer itself is the file.
      if (savedWhole || (final && wantsDoc(request) && src.trim().length > 40)) wholeAnswer(blocks, parts, request, src, savedWhole);
      return;
    }
    if (!wants) return;
    const unnamed = blocks.filter((b) => !b.name && !isCommand(b) && b.content.trim());
    if (!unnamed.length) return;
    const reqName = requestName(request);
    const named = blocks.some((b) => b.name);
    // With several unnamed blocks, the ones that are only a line or two are usually examples, not files.
    const pick = unnamed.length === 1 ? unnamed : unnamed.filter((b) => b.content.trim().split("\n").length > 2);
    for (const b of (pick.length ? pick : [unnamed.reduce((a, c) => (c.content.length > a.content.length ? c : a))])) {
      const ext = extOf(b.lang, b.content, request);
      if (reqName && !named && !blocks.some((x) => x.name === reqName) && (reqName.split(".").pop().toLowerCase() === ext || pick.length <= 1)) b.name = reqName;
      else b.name = `${slugFrom(request) || kindWord(request)}.${ext}`;
      b.how = "guess";
    }
  }

  const INTRO = /^\s*(sure|certainly|of course|okay|ok|absolutely|here(?:'s| is| are)|below is|i(?:'ve| have) (?:created|written|made)|this is)\b[^\n]*(?::|!|\.)\s*$/i;
  const OUTRO = /^\s*(let me know|i hope|hope this|feel free|you can (?:copy|save|paste|open)|enjoy|if you (?:need|want|have)|just copy|save (?:this|it)|note:|this (?:file|list|document) (?:can|will|should))/i;
  function wholeAnswer(blocks, parts, request, src, savedWhole) {
    const lines = src.replace(/\s+$/, "").split("\n");
    let a = 0, z = lines.length;
    while (a < z && !lines[a].trim()) a++;
    if (a < z - 1 && INTRO.test(lines[a])) { a++; while (a < z && !lines[a].trim()) a++; }
    while (z > a + 1 && (!lines[z - 1].trim() || OUTRO.test(lines[z - 1]))) z--;
    const content = lines.slice(a, z).join("\n").replace(/^\s*(-{3,}|\*{3,})\s*\n|\n\s*(-{3,}|\*{3,})\s*$/g, "").trim();
    if (!content) return;
    let name = savedWhole?.name || requestName(request);
    if (!name) {
      const want = langFromRequest(request);
      const ext = want && want !== "html" && want !== "py" && want !== "js" ? want : sniff(content) === "csv" ? "csv" : /(^|\n)(#{1,6} |\* |- |\d+\. )|\*\*/.test(content) ? "md" : "txt";
      name = `${slugFrom(request) || kindWord(request)}.${ext}`;
    }
    const b = { i: 0, name, how: "whole", lang: name.split(".").pop(), content: content + "\n", done: true, whole: true };
    blocks.push(b);
    parts.length = 0;
    parts.push({ t: "text", s: lines.slice(0, a).join("\n") }, { t: "block", b }, { t: "text", s: lines.slice(z).join("\n") });
  }

  // ---------- What the file is and how to use it ----------
  const HOWTO = {
    py: (n) => `Needs Python (free from python.org). Double-click it, or open a terminal in its folder and type: python ${n}`,
    pyw: () => "Needs Python (free from python.org). Double-click it to run it.",
    js: (n) => `Needs Node.js (free from nodejs.org). Open a terminal in its folder and type: node ${n}`,
    mjs: (n) => `Needs Node.js (free from nodejs.org). Open a terminal in its folder and type: node ${n}`,
    ts: (n) => `TypeScript. Needs Node.js, then in a terminal in its folder type: npx tsx ${n}`,
    html: () => "Open it and it shows in your web browser.",
    htm: () => "Open it and it shows in your web browser.",
    css: (n) => `A stylesheet. A web page uses it with <link rel="stylesheet" href="${n}"> (keep them in the same folder).`,
    bat: () => "Double-click it to run it on Windows.",
    cmd: () => "Double-click it to run it on Windows.",
    ps1: (n) => `Right-click it and choose "Run with PowerShell", or type in PowerShell: .\\${n}`,
    sh: (n) => `In a terminal in its folder, type: bash ${n}`,
    vbs: () => "Double-click it to run it on Windows.",
    csv: () => "Opens in Excel, Google Sheets or LibreOffice Calc.",
    tsv: () => "Opens in Excel, Google Sheets or LibreOffice Calc.",
    md: () => "A text document. Opens in Notepad or any text editor (Markdown apps show the formatting).",
    txt: () => "Opens in Notepad or any text editor.",
    json: () => "A data or settings file. Open it in Notepad or any text editor.",
    yml: () => "A settings file. Open it in Notepad or any text editor.",
    yaml: () => "A settings file. Open it in Notepad or any text editor.",
    ini: () => "A settings file. Open it in Notepad or any text editor.",
    toml: () => "A settings file. Open it in Notepad or any text editor.",
    xml: () => "A data file. Open it in a text editor or a web browser.",
    svg: () => "A picture. Open it and it shows in your web browser.",
    sql: () => "Database commands. Run them in your database tool (for example DB Browser for SQLite or MySQL Workbench).",
    java: (n) => `Needs Java (JDK). In a terminal in its folder type: java ${n}`,
    c: (n) => `Compile it first, for example: gcc ${n} -o program, then run program.`,
    cpp: (n) => `Compile it first, for example: g++ ${n} -o program, then run program.`,
    cs: () => "C#. Put it in a .NET project (dotnet new console) and run: dotnet run",
    go: (n) => `Needs Go (go.dev). In a terminal type: go run ${n}`,
    rs: (n) => `Needs Rust (rustup.rs). Compile it with: rustc ${n}`,
    rb: (n) => `Needs Ruby. In a terminal type: ruby ${n}`,
    php: (n) => `Needs PHP. In a terminal type: php ${n}`,
    lua: (n) => `Needs Lua. In a terminal type: lua ${n}`,
    r: (n) => `Open it in RStudio, or type in a terminal: Rscript ${n}`,
  };
  const howTo = (name) => { const ext = (name.split(".").pop() || "").toLowerCase(); return (HOWTO[ext] || (() => "Open it in Notepad or any text editor."))(name); };
  // Files that run code on the computer when opened, so the app asks first.
  const RUNS = /\.(py|pyw|js|mjs|cjs|bat|cmd|ps1|sh|vbs|vb|exe|msi|com|scr|jar|wsf|hta|lnk|reg|rb|pl|php|lua)$/i;
  const runsCode = (name) => RUNS.test(String(name || ""));
  function describe(b, request) {
    const ext = (b.name.split(".").pop() || "").toLowerCase();
    const kind = KIND[ext] || ext.toUpperCase() + " file";
    const r = String(request || "").replace(/\s+/g, " ").trim();
    return r ? `${kind} made for your request: "${r.length > 90 ? r.slice(0, 87).replace(/\s+\S*$/, "") + "…" : r}"` : kind;
  }
  // A short note at the top of code files saying what it is and how to run it (only when the model didn't start with a comment).
  const COMMENT = { py: "#", pyw: "#", sh: "#", rb: "#", r: "#", yml: "#", yaml: "#", toml: "#", ps1: "#", pl: "#", js: "//", mjs: "//", cjs: "//", ts: "//", jsx: "//", tsx: "//",
    java: "//", c: "//", cpp: "//", cs: "//", go: "//", rs: "//", swift: "//", kt: "//", dart: "//", sql: "--", lua: "--", bat: "REM", cmd: "REM", ini: ";" };
  const LOOKS_COMMENT = /^\s*(#(?!!)|\/\/|\/\*|--|<!--|REM\b|::|;|"""|''')/i;
  function withNote(b, request) {
    const ext = (b.name.split(".").pop() || "").toLowerCase();
    const lines = b.content.split("\n");
    let at = 0;
    if (/^#!/.test(lines[0] || "") || /^\s*@echo off/i.test(lines[0] || "") || /^\s*<!doctype/i.test(lines[0] || "") || /^\s*<\?xml/.test(lines[0] || "")) at = 1;
    if (LOOKS_COMMENT.test(lines[at] || "")) return b.content;
    const what = describe(b, request).replace(/"/g, "'"), how = howTo(b.name);
    let note;
    if (COMMENT[ext]) note = [`${COMMENT[ext]} ${b.name}: ${what}`, `${COMMENT[ext]} How to run: ${how}`];
    else if (["html", "htm", "svg", "xml"].includes(ext)) note = [`<!-- ${b.name}: ${what.replace(/--/g, "-")}. ${how.replace(/--/g, "-").replace(/[<>]/g, "")} -->`];
    else if (ext === "css" || ext === "scss") note = [`/* ${b.name}: ${what.replace(/\*\//g, "")}. ${how.replace(/\*\//g, "")} */`];
    else return b.content;
    return [...lines.slice(0, at), ...note, ...lines.slice(at)].join("\n");
  }

  const api = { parse, wantsFile, wantsDoc, requestName, EXT, KIND, extOf, howTo, describe, withNote, runsCode };
  if (typeof window !== "undefined") window.OMDFiles = api;
  if (typeof module !== "undefined") module.exports = api;
})();
