// Natural voices. Runs in its own background process so speaking never slows the window.
// Uses Kokoro (82M, Apache-2.0) through kokoro-js, fully offline once its files are downloaded.
import { KokoroTTS } from "kokoro-js";
import { env } from "@huggingface/transformers";

const port = process.parentPort;
const MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";
let tts = null, loading = null;

async function load(dir) {
  if (tts) return;
  loading ??= (async () => {
    // Only ever read the files the app downloaded; never fetch anything from here.
    env.localModelPath = dir;
    env.allowRemoteModels = false;
    env.allowLocalModels = true;
    tts = await KokoroTTS.from_pretrained(MODEL, { dtype: "q8", device: "cpu" });
    // The very first sentence is slow while the speech engine warms up, so say something silently now.
    try { await tts.generate("Hello there.", { voice: "af_heart" }); } catch {}
  })();
  try { await loading; } finally { loading = null; }
}

async function speak({ dir, text, voice, speed }) {
  await load(dir);
  const audio = await tts.generate(text, { voice, speed: speed || 1 });
  return { samples: audio.audio, rate: audio.sampling_rate };
}

port.on("message", async ({ data }) => {
  try {
    const result = data.op === "speak" ? await speak(data.args) : await load(data.args.dir);
    port.postMessage({ id: data.id, result });
  } catch (err) {
    port.postMessage({ id: data.id, error: err.message || String(err) });
  }
});
