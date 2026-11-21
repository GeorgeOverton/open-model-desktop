// "Optimal" mode: works out what kind of question you asked, then picks the best downloaded model
// for it that fits a memory size (for example 8 GB). A tiny model reads the question when the
// answer isn't obvious from the words alone.

export const TASKS = {
  coding: { label: "coding", tag: "coding" },
  maths: { label: "maths and logic", tag: "reasoning" },
  writing: { label: "writing", tag: "writing" },
  translate: { label: "other languages", tag: "multilingual" },
  chat: { label: "everyday questions", tag: "chat" },
};
export const TIERS = [
  { id: "@auto", gb: 0, name: "✨ Optimal for this computer" },
  { id: "@auto:8", gb: 8, name: "✨ Optimal 8 GB" },
  { id: "@auto:16", gb: 16, name: "✨ Optimal 16 GB" },
  { id: "@auto:32", gb: 32, name: "✨ Optimal 32 GB" },
];

// Quick look at the words. Returns the task and how sure we are (0 = no idea).
const RULES = {
  coding: [/```/, /\b(code|coding|function|bug|error|exception|stack ?trace|compile|python|javascript|typescript|java|c\+\+|c#|rust|golang|sql|regex|html|css|api|script|debug|refactor|git|json|class|variable)\b/i],
  maths: [/\b(solve|calculate|equation|integral|derivative|probability|percent(age)?|proof|prove|algebra|geometry|maths?|logic puzzle|riddle|how many|average)\b/i, /\d+\s*[-+*/^×÷]\s*\d+/, /\d+(\.\d+)?\s*%/],
  writing: [/\b(write|rewrite|draft|essay|story|poem|email|letter|cover letter|blog|summari[sz]e|proofread|paragraph|caption|tweet|speech|lyrics|tone)\b/i],
  translate: [/\b(translate|translation|in (french|spanish|german|italian|portuguese|chinese|japanese|korean|arabic|hindi|russian|dutch|polish|turkish))\b/i, /[^\x00-ɏ\s\d.,!?'"()-]{4,}/],
};
export function guessTask(text) {
  const scores = Object.fromEntries(Object.entries(RULES).map(([k, res]) => [k, res.reduce((n, re) => n + (re.test(text) ? 1 : 0), 0)]));
  const [best, n] = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  return n ? { task: best, sure: n } : { task: "chat", sure: 0 };
}
export const ROUTER_PROMPT = "You sort questions into one category. Categories: coding, maths, writing, translate, chat. Reply with only the single category word.";
export function parseTask(answer) {
  const m = String(answer || "").toLowerCase().match(/\b(coding|code|maths?|math|writing|write|translate|translation|chat)\b/);
  if (!m) return null;
  return { code: "coding", coding: "coding", math: "maths", maths: "maths", write: "writing", writing: "writing", translation: "translate", translate: "translate", chat: "chat" }[m[1]];
}

// Memory a model needs to run (same estimate the app shows on each card).
const needGB = (m) => (m.size / 1e9) * 1.2 + 0.8;
const sizeGB = (m) => m.size / 1e9;
export const isChatModel = (m) => !(m.tags || []).includes("embeddings") && !m.online;

// The tiny model that reads your question: the smallest chat model, preferring ones that answer straight away (not "thinking" models).
export function pickRouter(models) {
  const small = models.filter((m) => isChatModel(m) && sizeGB(m) <= 2.6);
  return small.sort((a, b) => (/qwen3|r1|think|qwq/i.test(a.name) - /qwen3|r1|think|qwq/i.test(b.name)) || a.size - b.size)[0] || null;
}

// Best model for the task within the memory size. Models made for the task win; then bigger (usually smarter) wins.
export function pickModel(models, task, tierGB) {
  const usable = tierGB * 0.85;   // leave room for the rest of the computer
  const all = models.filter(isChatModel);
  const fits = all.filter((m) => needGB(m) <= usable);
  const pool = fits.length ? fits : [...all].sort((a, b) => a.size - b.size).slice(0, 1);
  const tag = TASKS[task]?.tag || "chat";
  const score = (m) => {
    const t = m.tags || [];
    let s = sizeGB(m);
    if (t.includes(tag)) s += 100;
    if (task === "maths" && t.includes("coding")) s += 20;
    if (task === "coding" && t.includes("reasoning")) s += 20;
    if (task !== "coding" && t.includes("coding") && !t.includes("chat")) s -= 60;   // code-only models are poor at chatting
    if (/vl\b|vision/i.test(m.name) && task !== "chat") s -= 5;
    return s;
  };
  const best = [...pool].sort((a, b) => score(b) - score(a))[0] || null;
  return { model: best, fits: fits.length > 0, matched: !!best && (best.tags || []).includes(tag) };
}
