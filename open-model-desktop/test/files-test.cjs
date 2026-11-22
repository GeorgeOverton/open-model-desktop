// Typical answers from small local models (Llama 3.2 1B/3B, Qwen 2.5/3, Phi, Gemma, Mistral styles), and the files we expect.
const vm = require("vm"); const ctx = { window: {} }; vm.runInNewContext(require("fs").readFileSync(require("path").join(__dirname, "../renderer/files.js"), "utf8"), ctx); const F = ctx.window.OMDFiles;
const T = [];
const t = (name, request, answer, want, opts = {}) => T.push({ name, request, answer, want, opts });
const fence = "```";

t("follows the format", "make a python script that prints hello", `File: hello.py\n${fence}python\nprint("hello")\n${fence}`, ["hello.py"]);
t("bold name", "write a hello world script in python", `Here is the script:\n\n**hello_world.py**\n${fence}python\nprint("Hello, World!")\n${fence}\n\nRun it with \`python hello_world.py\`.`, ["hello_world.py"]);
t("backtick name with colon", "create a web page about cats", `Sure! Save this as \`cats.html\`:\n\n${fence}html\n<!DOCTYPE html>\n<html><body><h1>Cats</h1></body></html>\n${fence}`, ["cats.html"]);
t("heading name", "make a css file for a dark theme", `### style.css\n${fence}css\nbody { background: #111; color: #eee; }\n${fence}`, ["style.css"]);
t("name in info string", "write me a node script", `${fence}javascript app.js\nconsole.log("hi")\n${fence}`, ["app.js"]);
t("name in info colon", "write me a node script", `${fence}js:server.js\nconsole.log("hi")\n${fence}`, ["server.js"]);
t("first line comment", "write a python script that adds two numbers", `Here's a simple script:\n\n${fence}python\n# add.py\na = 1\nb = 2\nprint(a + b)\n${fence}`, ["add.py"]);
t("html comment first line", "make a web page with a button", `${fence}html\n<!-- index.html -->\n<button>Click</button>\n${fence}`, ["index.html"]);
t("no name, guessed from request", "create a python script that sorts a list of numbers", `Here is a Python script that sorts a list:\n\n${fence}python\nnums = [3, 1, 2]\nnums.sort()\nprint(nums)\n${fence}\n\nThis uses the built-in sort method.`, ["sorts-list-numbers.py"]);
t("no lang, sniffed html", "make me a simple website for my bakery", `${fence}\n<!DOCTYPE html>\n<html>\n<head><title>Bakery</title></head>\n<body>Welcome</body>\n</html>\n${fence}`, ["bakery.html"]);
t("Node.js is not a file name", "write a node.js script that reads a file", `Here's a Node.js script:\n\n${fence}javascript\nconst fs = require("fs");\nconsole.log(fs.readFileSync("a.txt", "utf8"));\n${fence}`, ["reads.js"]);
t("command blocks are not files", "make a python script that prints the date", `Save this as date.py:\n\n${fence}python\nimport datetime\nprint(datetime.date.today())\n${fence}\n\nThen run:\n\n${fence}bash\npython date.py\n${fence}`, ["date.py"]);
t("filename asked for", "create a file called notes.txt with three reminders", `${fence}\nBuy milk\nCall mum\nPay rent\n${fence}`, ["notes.txt"]);
t("plain text answer becomes the file", "make a shopping list file for a week of dinners", `Here's your shopping list:\n\n- Chicken breasts\n- Rice\n- Broccoli\n- Pasta\n- Tomatoes\n\nLet me know if you'd like any changes!`, ["shopping-list-week.md"]);
t("plain csv answer", "make a spreadsheet of the planets and their moons", `Planet,Moons\nMercury,0\nVenus,0\nEarth,1\nMars,2`, ["planets-moons.csv"]);
t("letter as document", "write a letter to my landlord about the broken heating as a document", `Dear Mr Smith,\n\nI am writing to let you know that the heating has been broken since Monday. Could you please arrange a repair?\n\nKind regards,\nGeorge`, ["letter-landlord-broken.txt"]);
t("ordinary chat is not a file", "what is the capital of France?", `The capital of France is Paris.`, []);
t("code question stays a snippet", "how do I reverse a list in python?", `Use slicing:\n\n${fence}python\nnums[::-1]\n${fence}`, []);
t("two files", "make a web page with a separate stylesheet", `**index.html**\n${fence}html\n<link rel="stylesheet" href="style.css">\n<h1>Hi</h1>\n${fence}\n\n**style.css**\n${fence}css\nh1 { color: red; }\n${fence}`, ["index.html", "style.css"]);
t("two unnamed files guessed", "make a web page with a separate stylesheet", `${fence}html\n<!DOCTYPE html>\n<link rel="stylesheet" href="style.css">\n<h1>Hi</h1>\n${fence}\n\n${fence}css\nh1 {\n  color: red;\n}\n${fence}`, ["stylesheet.html", "stylesheet.css"]);
t("unclosed final block", "write a python script that counts to ten", `File: count.py\n${fence}python\nfor i in range(1, 11):\n    print(i)`, ["count.py"], { final: true });
t("same name twice", "make two versions of hello.py", `File: hello.py\n${fence}python\nprint("a")\n${fence}\nFile: hello.py\n${fence}python\nprint("b")\n${fence}`, ["hello.py", "hello-2.py"]);
t("Filename: label", "write a batch file that cleans temp", `Filename: clean.bat\n\n${fence}bat\ndel /q %TEMP%\\*\n${fence}`, ["clean.bat"]);
t("numbered list name", "make a readme for my project", `1. **README.md**\n\n${fence}markdown\n# My project\n\nIt does things.\n${fence}`, ["README.md"]);
t("tilde fences", "write a python script that prints hi", `~~~python\nprint("hi")\n~~~`, ["prints-hi.py"]);
t("inline closing fence", "create a python file that prints hi", `File: hi.py\n${fence}python\nprint("hi")${fence}`, ["hi.py"]);
t("Qwen think tags already removed, name in text", "Create a JSON file with 3 users", `Here is \`users.json\` with three users:\n${fence}json\n[{"name":"A"},{"name":"B"},{"name":"C"}]\n${fence}`, ["users.json"]);
t("follow-up keeps the earlier name", "now make it say goodbye too", `Here's the updated script:\n\n${fence}python\nprint("hello")\nprint("goodbye")\nprint("done")\n${fence}`, ["hello.py"], { earlier: ["hello.py"] });
t("poem is not a file", "write a poem about autumn", `Leaves fall softly down,\ngolden on the quiet ground.`, []);
t("list of films is not a file", "make a list of 5 good films", `1. Up\n2. Alien\n3. Heat\n4. Jaws\n5. Rocky`, []);
t("phi filename comment", "write a calculator program in python", `${fence}python\n# filename: calc.py\ndef add(a, b):\n    return a + b\n${fence}`, ["calc.py"]);
t("files off", "make a python script that prints hello", `File: hello.py\n${fence}python\nprint("hello")\n${fence}`, [], { files: false });
t("version number not a file", "write a script for python 3.11 that prints hi", `Works on Python 3.11:\n${fence}python\nprint("hi")\n${fence}`, ["prints-hi.py"]);

let fail = 0;
for (const c of T) {
  const r = F.parse(c.answer, { request: c.request, final: c.opts.final ?? true, files: c.opts.files ?? true, earlier: c.opts.earlier || [] });
  const got = r.blocks.filter((b) => b.name).map((b) => b.name);
  const ok = JSON.stringify(got) === JSON.stringify(c.want);
  if (!ok) fail++;
  console.log(ok ? "PASS" : "FAIL", c.name, ok ? "" : `got ${JSON.stringify(got)} want ${JSON.stringify(c.want)}`);
}
// The name line is taken out of the answer, and the whole-answer file drops the chatty first and last lines.
const r1 = F.parse(`File: hello.py\n${fence}python\nprint(1)\n${fence}`, { request: "make a script", final: true });
console.log(r1.parts[0].s.includes("hello.py") ? "FAIL name line kept" : "PASS name line removed");
const r2 = F.parse(`Here's your shopping list:\n\n- Rice\n- Beans\n\nLet me know if you'd like changes!`, { request: "make a shopping list file", final: true });
console.log(r2.blocks[0]?.content === "- Rice\n- Beans\n" ? "PASS whole answer trimmed" : "FAIL whole answer " + JSON.stringify(r2.blocks[0]?.content));
console.log(fail ? `${fail} failed` : "all passed");

// What it is and how to run it, at the top of code files (only when the model didn't write its own comment).
const note = (name, content, req) => F.withNote({ name, content }, req);
const n1 = note("hello.py", 'print("hi")', "make a hello script");
console.log(/^# hello\.py: Python made for your request/.test(n1) && /\n# How to run: Needs Python/.test(n1) ? "PASS python note" : "FAIL python note " + n1);
console.log(note("add.py", "# adds numbers\nprint(1)", "x") === "# adds numbers\nprint(1)" ? "PASS keeps the model's own comment" : "FAIL own comment");
const n3 = note("index.html", "<!DOCTYPE html>\n<h1>Hi</h1>", "make a page");
console.log(/^<!DOCTYPE html>\n<!-- index\.html: Web page/.test(n3) ? "PASS html note after doctype" : "FAIL html " + n3);
const n4 = note("run.sh", "#!/bin/bash\necho hi", "x");
console.log(/^#!\/bin\/bash\n# run\.sh:/.test(n4) ? "PASS shebang stays first" : "FAIL shebang " + n4);
console.log(note("data.csv", "a,b\n1,2", "x") === "a,b\n1,2" && note("notes.md", "# Notes", "x") === "# Notes" ? "PASS no note in data files" : "FAIL data note");
console.log(F.runsCode("x.py") && F.runsCode("go.bat") && !F.runsCode("page.html") && !F.runsCode("list.txt") ? "PASS knows which files run code" : "FAIL runsCode");
