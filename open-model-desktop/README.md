# Open Model Desktop

A desktop app for finding free open AI models, downloading them, and chatting with them **offline**, including a **voice mode** where a wake phrase like *"Hey Jarvis"* wakes the model you chose for that phrase.

It uses the same look and model picks as the Open Model Finder web page.

## Install on Windows (easiest)

Unzip **Open-Model-Desktop-Windows-Setup.zip** and double-click **Open-Model-Desktop-Setup-0.3.0.exe**. The setup wizard installs the app, puts an **Open Model Desktop** shortcut on your desktop and in the Start menu, and opens the app when it's done. No Node.js needed.

Windows may show a blue "Windows protected your PC" box because the installer isn't signed with a paid certificate. Click **More info**, then **Run anyway**.

## Start it from the source code (Mac, Linux, or Windows without the installer)

1. Install **Node.js** (the "LTS" version) from https://nodejs.org. You only do this once.
2. Double-click:
   - **Windows:** `Start (Windows).bat`
   - **Mac:** `Start (Mac).command` (the first time, right-click it and choose **Open**)
   - **Linux:** run `npm install` then `npm start` in this folder.

The first start installs everything it needs (a few minutes, about 1 GB). After that it opens straight away.

## Using it

1. **Find models.** Pick your memory (the app guesses it for you) and what you want to do. Press **Download** on a model with a green *Runs great* badge, then pick the highlighted version. Good first picks: **Llama 3.2 3B** or **Qwen3 4B**.
2. **My models** shows download progress. Downloads resume if your internet drops or you close the app. Press **▶ Run** on a model to start it: it shows **Running** with a **Cancel** button to stop it. One model runs at a time, so running another stops the first.
3. **Chat.** Pick a model and type. No internet needed. Reasoning models show a *Show its thinking* box.
4. **Voice.**
   - Press **Download speech pack** once (about 40 MB, English).
   - Each **wake phrase** has a model. "Hey Jarvis" gets your first model automatically. Press **+ Add a wake phrase** to add more, for example *"Hey Coder"* for a coding model.
   - Optional **personality** per phrase, e.g. *"You are Jarvis, a calm British butler."*
   - Press **🎤 Test** and say the phrase. If the app hears something different (say "hey service"), press **Use that** and it will accept that too.
   - Press the big microphone. Say *"Hey Jarvis, what's a good name for a cat?"* in one go, or say *"Hey Jarvis"*, wait for the beep, then ask. Replies are read out loud, and you can ask a follow-up without the wake phrase for a few seconds afterwards.
   - Press **Esc** or the microphone to stop it talking.

## Voices and Settings

Answers can be read out loud in 11 natural English voices that run on your computer: Hannah, Bella, Emma, Nicole, Michael, Ryan, Jack, Sarah, George, Isabella and Oliver (American and British, male and female). Open **Settings** to see each voice's accent, tone and a naturalness rating, press **▶ Preview** to hear it, and **Use** to pick it. The voices need a one-time 92 MB download (the Kokoro voice engine); until then the app uses your computer's built-in voice.

Settings also holds the voice-mode setup: the listening pack, your wake phrases (each with its own model and voice), the follow-up timer, speaking speed, and an optional Hugging Face token. In Chat, each answer shows the voice's name and a 🔊 button to read it aloud.

## Tray icon and pop-ups

While the app is open, its icon sits in the system tray (bottom right on Windows, next to the clock; you may need to click the **^** arrow). Hover it to see which model is running. Right-click it to open the app, stop the model, or quit. Closing the window keeps the app (and a running model) in the tray; choose **Quit** from the tray menu to close it fully. You get a Windows pop-up when a model starts running or a download finishes.

## How it works

| Part | What it uses |
|---|---|
| App window | Electron |
| Running models | [node-llama-cpp](https://node-llama-cpp.withcat.ai) (llama.cpp). Uses your Mac's GPU (Metal), NVIDIA (CUDA) or other graphics cards (Vulkan) automatically, or the CPU |
| Model files | GGUF files downloaded straight from Hugging Face |
| Wake phrases and voice commands | [Vosk](https://alphacephei.com/vosk/) speech recognition, running inside the app, offline |
| Reading replies aloud | [Kokoro](https://huggingface.co/hexgrad/Kokoro-82M) natural voices via kokoro-js (offline), or your computer's built-in voice |

Models run in a separate background process, so a broken or unsupported model file shows an error instead of crashing the app. One model is loaded at a time; switching wake phrases loads the other model (a few seconds).

Your files live in the app's data folder (**My models → Open the models folder**). Nothing you say or type leaves your computer. The internet is only used to search Hugging Face and to download models and the speech pack.

## Make an installer

`npm run dist` builds an installer for the computer you run it on (the Windows one creates desktop and Start menu shortcuts): a `.exe` on Windows, a `.dmg` on Mac, an AppImage on Linux. It appears in the `dist` folder. (A Mac installer that others can open without warnings needs an Apple developer certificate.)

## Good to know

- **Wake phrases** work best as two or three distinct words. Unusual names may be heard as similar common words; use **Test** and **Use that** to teach it.
- **Speech is English only** for now.
- **Images:** vision models download and chat fine, but this app only sends text for now.
- **Gated models** (some Llama and Gemma uploads) need you to accept the licence on Hugging Face first. The starter picks avoid these.
- **Voices on Linux** need `speech-dispatcher` installed for replies to be read aloud.
- `OMD_HF_MIRROR=https://hf-mirror.com npm start` downloads from a Hugging Face mirror if huggingface.co is blocked where you are.

## Files

| File | What it is |
|---|---|
| `main.js` | App window, downloads, settings |
| `engine.mjs` | The model runtime (runs in its own process) |
| `preload.cjs` | Safe bridge between the window and the app |
| `renderer/app.js` | Find models and My models |
| `renderer/chat.js` | Chat screen |
| `renderer/voice.js` | Voice mode and wake phrases |
| `renderer/speaker.js` | The voices and their names |
| `renderer/settings.js` | Settings page |
| `tts.mjs` | The natural voice engine (runs in its own process) |
| `renderer/models.js` | Tags and hand-picked starter models (edit to change the picks) |
| `renderer/styles.css` | Look and feel |

## Use your models from the Claude app

Settings → **Use with the Claude app** → **Connect to the Claude app**, then quit and reopen Claude once.
This adds an "open-model-desktop" connector to Claude's settings file (a backup is kept as `claude_desktop_config.json.bak`).
Claude can then list your downloaded models, ask one of them a question (fully on this computer), and read text out loud
in your natural voices. If Open Model Desktop isn't open, Claude starts it quietly in the tray.
The link only listens on this computer (127.0.0.1) and needs a secret that changes every time the app starts.
For Claude Code, use the "Copy Claude Code command" button.

## Claude on your Claude Pro plan

Settings → **Claude on your Pro plan**. The app uses the official Claude Code app on your computer, signed in to
your Claude account (no API key, no extra bill). Install it with the one-line command shown there, press Sign in,
then tick "Use Claude in this app". Claude then works in Chat and Voice mode and can be Run from Online models.
It shares your plan's usage limit with claude.ai and the Claude app; when the limit is used up it stops and shows
when it resets. If Claude Code isn't set up, choosing Claude opens the free claude.ai website instead.

## Online models

The **Online models** tab lists free online assistants (Claude, ChatGPT, Gemini, Copilot, Le Chat, DeepSeek).
Open one to use its official website in its own window and sign in with your own free account. Each service keeps
its own sign-in. The app doesn't read or automate those pages.

## Favourites and sorting

Press ☆ on any card in My models or Online models to pin it to the top. My models has a Sort by menu
(recently used, name, size, newest download).

## Optimal mode
Pick **✨ Optimal** at the top of Chat (or for a wake phrase in Voice) and the app picks the best of your downloaded
models for each question, then starts it. There are four choices: *Optimal for this computer* (uses most of this
computer's memory), *Optimal 8 GB*, *16 GB* and *32 GB* (the most memory the chosen model may use).

1. The words of your question are checked first (code, sums, "write a…", "translate…").
2. When that isn't clear, a tiny model (your smallest downloaded model under 2.5 GB) reads the question in the background
   and answers with one word: coding, maths, writing, translate or chat.
3. The app then picks the biggest model that fits the memory size and is made for that kind of question
   (a coding model for code, a reasoning model for maths). Everyday questions go to your best all-round model.

The chat shows which model it picked. Settings → Optimal mode shows what it would pick for each kind of question.
The logic is in `router.mjs`.

## Updates (from GitHub releases)
The app has a **Check for updates** button in Settings → Updates. It checks a GitHub repository's Releases, downloads
the new installer when you press Download, and installs it when you press Restart to update.
It also checks quietly a few seconds after it starts.

### One-time setup
1. On github.com, create a new **public** repository, for example `open-model-desktop`.
   (Public, so the app can see its releases without a password.)
2. Put this folder in it: on the repository page choose "uploading an existing file" and drag in everything here
   except `node_modules` and `dist`, or use git:
   ```
   git init && git add . && git commit -m "Open Model Desktop 0.7.0"
   git branch -M main
   git remote add origin https://github.com/YOURNAME/open-model-desktop.git
   git push -u origin main
   ```
   Make sure the `.github/workflows/release.yml` file is included (it's hidden on some computers).
3. In the app, open Settings → Updates, type `YOURNAME/open-model-desktop` and press Save.
   (Versions built by GitHub already know the repository, so you only do this once.)

### Publishing a new version
1. Change `"version"` in `package.json`, for example from `0.7.0` to `0.8.0`.
2. Commit, tag and push:
   ```
   git commit -am "Version 0.8.0"
   git tag v0.8.0
   git push && git push --tags
   ```
3. GitHub builds the Windows installer (Actions tab, about 10 minutes) and publishes it as a release with
   `latest.yml`. The app then finds it with Check for updates.

You can also start a build from the Actions tab → Release → Run workflow. The installer isn't code-signed, so
Windows may show "Windows protected your PC" when you install it by hand (More info, then Run anyway).

## Saved chats
Every conversation in Chat is saved automatically, only on this computer (one file per chat in the app's `chats` folder,
next to `models`). The list on the left of Chat shows them by date. Click one to open it and carry on where you left off,
✎ to rename, 🗑 to delete, or type in the search box to find a chat by its words. A reopened chat remembers what was said:
local models are given the earlier messages, and Claude picks up its own conversation again. You can also change the model
in the middle of a chat and the new model gets the earlier messages. Turn saving off, open the folder, or delete every saved
chat in Settings → Saved chats. Voice mode conversations aren't saved.

## Find new models
Find models → **✨ Find new models** looks on Hugging Face for popular and trending models that aren't in Starter picks yet.
Tick the ones you want and press Add: they join Starter picks (marked "Added"), with their real download size. Open one and press
"Remove from Starter picks" to take it off again. Nothing is downloaded until you press Download, as usual.

## Voice mode speed
Voice mode now starts talking at the first comma of an answer instead of waiting for a whole sentence, starts loading the model
the moment it hears the wake phrase (while you're still asking), and skips the "thinking" step of thinking models.

## Files in Chat
Ask any model to make a file ("make me a shopping list", "write a Python script that…", "make a web page for…") and it appears as a
file card under the answer, with **Open**, **Save as…** and **Copy**. Files are kept in the app's `files` folder, next to the chat they
came from, and deleted with that chat. Any other code block also gets Copy and Save as file. Turn it off in Settings → Saved chats.

## Claude Code
The **🛠️ Claude Code** page works like the Claude Code extension for VS Code: choose a folder, ask for a change, and Claude reads the
files and works on them. Before each file change or command it shows you exactly what it wants to do (changes as a red and green diff)
with **Allow**, **Always allow** and **Don't allow** (you can also type what to do instead). Modes: *Ask before changes* (default),
*Allow file edits* and *Plan only*. It uses the official Claude Code on your Claude Pro plan (set up in Settings → Claude on your Pro plan),
never an API key, and carries on your last task in each folder until you press New task.
How it works: the app runs `claude -p` in that folder with `--permission-prompt-tool`, pointing at the `approve` tool of `mcp-server.mjs`,
which asks the app over its private local connection.

## Ideas borrowed from LM Studio's catalog
- **Tool use** filter and badge, for models that can call tools and functions (Qwen 2.5/3, Llama 3.x, Mistral, gpt-oss and others).
- **One card per model family** with a chip for each size (for example Qwen3 4B, 8B, 30B). The size picked for you is the biggest that
  runs great on your computer, else the biggest that fits; sizes that are too big are crossed out. Click another chip to switch.
- **"Released 3 months ago" / "Added by you today"** on each card, and a **Recently added** sort for Starter picks
  (models you added with Find new models come first, then the newest releases).

## Licence
Open Model Desktop is free to use, copy, change and share for noncommercial purposes. **Nobody may sell copies or charge
for it without written permission from George.** The terms are the PolyForm Noncommercial License 1.0.0 with that note on top;
see [LICENSE](LICENSE). The installer shows the licence before it installs. Third-party parts (Electron, node-llama-cpp,
kokoro-js, vosk-browser, model and voice files, company logos) keep their own licences.
