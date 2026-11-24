// Reads the text out of files you add to a chat (documents, PDFs, spreadsheets, code), so any model can use them.
// Pictures are passed on as pictures to models that can see them (Claude); other models are told they can't.
import zlib from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const IMAGE_TYPES = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp" };
const TEXT_EXT = /^(txt|md|markdown|csv|tsv|json|jsonl|xml|html?|css|js|mjs|cjs|ts|tsx|jsx|py|rb|java|c|h|cpp|hpp|cs|go|rs|php|sh|bat|cmd|ps1|sql|ya?ml|toml|ini|cfg|conf|log|env|tex|srt|vtt|ics|vcf|svg|lua|r|kt|swift|dart|vue|gitignore)$/i;

// ---------- A small ZIP reader (Word, PowerPoint, Excel and OpenDocument files are ZIPs of XML) ----------
function unzip(buf) {
  const files = new Map();
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("This file looks damaged.");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count && p + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nlen);
    p += 46 + nlen + xlen + clen;
    files.set(name, () => {
      const lnlen = buf.readUInt16LE(local + 26), lxlen = buf.readUInt16LE(local + 28);
      const data = buf.subarray(local + 30 + lnlen + lxlen, local + 30 + lnlen + lxlen + csize);
      return method === 8 ? zlib.inflateRawSync(data) : method === 0 ? data : Buffer.alloc(0);
    });
  }
  return files;
}
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => (e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENT[e] ?? m));
const xmlText = (x) => decode(x.replace(/<[^>]+>/g, ""));
const tidy = (s) => s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

function docx(files) {
  const x = files.get("word/document.xml")?.().toString("utf8");
  if (!x) throw new Error("No text found in this Word file.");
  return tidy(xmlText(x.replace(/<w:tab\/>/g, "\t").replace(/<w:br[^>]*\/>/g, "\n").replace(/<\/w:p>/g, "\n").replace(/<\/w:tc>/g, "\t")));
}
function pptx(files) {
  const slides = [...files.keys()].filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k)).sort((a, b) => +a.match(/\d+/)[0] - +b.match(/\d+/)[0]);
  return tidy(slides.map((k, i) => `Slide ${i + 1}:\n` + xmlText(files.get(k)().toString("utf8").replace(/<\/a:p>/g, "\n"))).join("\n\n"));
}
function xlsx(files) {
  const shared = [];
  const ss = files.get("xl/sharedStrings.xml")?.().toString("utf8") || "";
  for (const m of ss.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(xmlText(m[1]));
  const sheets = [...files.keys()].filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort((a, b) => +a.match(/\d+/)[0] - +b.match(/\d+/)[0]);
  const csvCell = (v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return tidy(sheets.map((k, i) => {
    const x = files.get(k)().toString("utf8");
    const rows = [...x.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map((r) => [...r[1].matchAll(/<c([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)].map((c) => {
      const t = (c[1].match(/t="(\w+)"/) || [])[1], v = ((c[2] || "").match(/<v>([\s\S]*?)<\/v>/) || [])[1] ?? ((c[2] || "").match(/<t[^>]*>([\s\S]*?)<\/t>/) || [])[1] ?? "";
      return csvCell(t === "s" ? shared[+v] ?? "" : decode(v));
    }).join(","));
    return `Sheet ${i + 1}:\n` + rows.join("\n");
  }).join("\n\n"));
}
const odf = (files) => tidy(xmlText((files.get("content.xml")?.().toString("utf8") || "").replace(/<\/text:p>|<\/text:h>/g, "\n").replace(/<text:tab\/>/g, "\t")));
const rtf = (s) => tidy(s.replace(/\\par[d]?/g, "\n").replace(/\{\\\*[^{}]*\}/g, "").replace(/\\'([0-9a-f]{2})/gi, (m, h) => String.fromCharCode(parseInt(h, 16))).replace(/\\[a-z]+-?\d* ?/gi, "").replace(/[{}]/g, ""));

async function pdf(buf) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const fonts = path.join(path.dirname(fileURLToPath(import.meta.resolve("pdfjs-dist/package.json"))), "standard_fonts") + path.sep;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: false, isEvalSupported: false, disableFontFace: true, standardFontDataUrl: fonts, verbosity: 0 }).promise;
  const pages = [];
  for (let i = 1; i <= Math.min(doc.numPages, 300); i++) {
    const c = await (await doc.getPage(i)).getTextContent();
    let line = "", out = [];
    for (const it of c.items) { line += it.str; if (it.hasEOL) { out.push(line); line = ""; } }
    if (line) out.push(line);
    pages.push(out.join("\n"));
  }
  await doc.destroy();
  const text = tidy(pages.map((t, i) => (doc.numPages > 1 ? `Page ${i + 1}:\n` : "") + t).join("\n\n"));
  if (!text.replace(/Page \d+:/g, "").trim()) throw new Error("This PDF has no text in it (it may be scanned pictures), so models can't read it.");
  return text;
}

// Returns { kind: "text", text } or { kind: "image", mime }.
export async function extract(name, buf) {
  const ext = (String(name).split(".").pop() || "").toLowerCase();
  if (IMAGE_TYPES[ext]) return { kind: "image", mime: IMAGE_TYPES[ext] };
  if (ext === "pdf") return { kind: "text", text: await pdf(buf) };
  if (["docx", "docm", "dotx"].includes(ext)) return { kind: "text", text: docx(unzip(buf)) };
  if (["pptx", "ppsx"].includes(ext)) return { kind: "text", text: pptx(unzip(buf)) };
  if (["xlsx", "xlsm"].includes(ext)) return { kind: "text", text: xlsx(unzip(buf)) };
  if (["odt", "ods", "odp"].includes(ext)) return { kind: "text", text: odf(unzip(buf)) };
  if (ext === "rtf") return { kind: "text", text: rtf(buf.toString("latin1")) };
  if (TEXT_EXT.test(ext) || (!ext.length && buf.length < 2e6)) {
    const t = buf.toString("utf8");
    if (/\u0000/.test(t.slice(0, 4000))) throw new Error("This doesn't look like a text file.");
    return { kind: "text", text: t.replace(/^﻿/, "") };
  }
  if (["doc", "xls", "ppt"].includes(ext)) throw new Error(`Old .${ext} files can't be read. Save it as .${ext}x (in Office: File → Save As) and add that instead.`);
  throw new Error(`Models can't read .${ext || "this kind of"} files. Try a document, PDF, spreadsheet, text file or picture.`);
}
