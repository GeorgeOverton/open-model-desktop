# Open Model Desktop

A desktop app for finding free open AI models, downloading them, and chatting with them **offline**, including a **voice mode** where a wake phrase like *"Hey Jarvis"* wakes the model you chose for that phrase.

It uses the same look and model picks as the Open Model Finder web page.

## Install on Windows (easiest)

Unzip **Open-Model-Desktop-Windows-Setup.zip** and double-click **Open-Model-Desktop-Setup-0.3.0.exe**. The setup wizard installs the app, puts an **Open Model Desktop** shortcut on your desktop and in the Start menu, and opens the app when it's done. No Node.js needed.

Windows may show a blue "Windows protected your PC" box because the installer isn't signed with a paid certificate. Click **More info**, then **Run anyway**.

## Install on Linux
Download `Open-Model-Desktop-<version>.AppImage` from the latest release on GitHub, then make it runnable and start it:
`chmod +x Open-Model-Desktop-*.AppImage && ./Open-Model-Desktop-*.AppImage` (or right-click → Properties → Allow executing).
Ubuntu 22.04 and newer may need `sudo apt install libfuse2` once. The AppImage updates itself (Settings → Updates).

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

## Updates (Windows and Linux)
Settings → Updates → **Check for updates** looks at the Releases of github.com/GeorgeOverton/open-model-desktop
(change it under "Where updates come from"). It also checks quietly a few seconds after the app starts.
- **Windows (installed with the setup wizard)** and **Linux AppImage**: Download update, then Restart to update. The app replaces
  itself and starts again. Models, chats and settings are kept.
- **Running from the source folder** (Start_Linux.sh, Start (Windows).bat) or a Linux copy that isn't the AppImage: the app can't
  replace itself, so Check for updates downloads the newest AppImage (Linux) or setup file (Windows) into Downloads. On Linux press
  Start the new version: from then on that AppImage updates itself. (Ubuntu may need `sudo apt install libfuse2` once for AppImages.)

### Publishing a new version
Releases are built by GitHub (`.github/workflows/release.yml`), never by hand, because the update button needs the
`latest.yml` (Windows) and `latest-linux.yml` (Linux) files that the workflow adds. Releases uploaded by hand don't have them.
1. Change `"version"` in `package.json` to a higher number (for example `0.18.0`) and push it to GitHub.
2. On GitHub: **Actions → Release → Run workflow → Run workflow**.
3. About 20 minutes later the release `v0.18.0` appears with `Open-Model-Desktop-Setup-0.18.0.exe`, `Open-Model-Desktop-0.18.0.AppImage`
   and the two update files, and copies of the app offer it.
The workflow works whether the app is at the top of the repository or in an `open-model-desktop` folder inside it.

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
Ask any model, local or Claude, to make a file ("make me a shopping list file", "write a Python script that…", "make a web page for…")
and it's saved as a real file in **Documents › Open Model Desktop**, in a folder for each chat (named by date and the chat's title).
It shows as a file card under the answer with **Open**, **Show in folder**, **Save as…** and **Copy**. Deleting a chat keeps its files.

Small local models often don't follow the "File: name.ext" format, so the app is forgiving (see `renderer/files.js`):

- It finds the name wherever the model put it: `File: x.py`, `**x.py**`, `` `x.py` ``, `### x.py`, "Save this as x.py:", the code block's
  info line (```` ```python app.py ````), or a first-line comment like `# x.py` or `<!-- index.html -->`.
- If you asked for a file and the model didn't name it, it picks a name from your request (or the file name you gave) and the kind of code.
  One-line commands like `python hello.py` are left as snippets.
- If you asked for a document (a letter, a CSV, a notes file…) and the model just wrote it out as text, the answer itself is saved,
  without the "Here's your…" and "Let me know…" lines.
- A changed version of a file in a later message ("now make it say goodbye") keeps the same name and updates the file.
- A code block left unfinished when the model stops still counts.

**It asks first.** Before a file is saved, its card asks "Save this file on this computer?" (Save, Always save files, Don't save).
Before opening a file that would run code (.py, .bat, .ps1, .js and so on) it warns you and asks again (Open it, Always allow, Cancel).
"Always" ticks a box in Settings → Saved chats; untick it to be asked again.

**What it is and how to run it.** Each file card says what the file is and how to use it (for example "Needs Python… type: python hello.py"),
and code files get the same two lines as a comment at the top, unless the model already wrote one.

Ordinary questions stay ordinary: code blocks in them get Copy and Save as file. Turn files off in Settings → Saved chats.
Test the file finder with `node` on the cases in `test/files-test.cjs`.

## Talking in Chat, and saved voice chats
Press 🎤 next to Send in Chat and just talk: when you pause, what you said is sent, the answer is read out as it's written, and then
it listens again. Press 🎤 again (or Esc) to stop. These chats are saved like any other. Voice mode conversations are saved too (their
titles start with 🎙️), and files work in Voice mode: it says "I'm making the file now" instead of reading code out, and the file card
appears on screen.

The app asks before it first uses the microphone (Settings → Voice mode has a box to turn it off again). Speech is turned into text on
this computer by the offline speech pack; nothing is recorded or uploaded.

**Speaking sooner:** the voice engine warms up when the app starts, the first few words are spoken as soon as they arrive, long sentences
are split, and while answers are being spoken the model leaves two CPU cores free for the voice.

## Several models at once
With Settings → Running models ticked (the default), each model runs in its own background process, so Chat can use one model while a
wake phrase uses another, without reloading. Before starting a model the app checks free memory; if it won't fit, it stops the model you
used longest ago (never one that is answering) and says so in a message. If loading still runs out of memory, it stops the others and tries
once more. My models shows Running/Stop on each model, and the sidebar lists everything that's running. Untick the box for one model at a time.

## Your own names for models
Press ✎ next to a model's name in My models and type a name (Reset goes back to the original). The name is used in Chat, Voice mode, the
model menus, the tray and for Claude Desktop. After renaming, the app offers a matching wake phrase ("Hey Nova").

## Model icons
Answers in Chat and Voice mode show the icon of the model that wrote them (its maker's logo), and Voice mode's wake phrase list shows each
phrase's model icon. With Optimal mode, the icon changes to the model it picked.

## Voice mode: Clear and collapse
🧹 Clear wipes the conversation on screen and starts a fresh one (the old one stays in Saved chats). The wake phrase list folds away with the
arrow next to its title, and stays folded next time.

## Adding files and pictures to a chat
Press 📎 next to the message box, drag files onto the chat, or paste a picture. The first time, the app asks before it reads them (tick
"Remember my choice" to stop it asking; change it later in Settings → Saved chats). Word, PowerPoint, Excel, OpenDocument, PDF, RTF and
text or code files are read on this computer and their text goes to the model with your message (long files are cut to what the model can
take, and the chip says so). Pictures go to Claude, which can see them; local models can't see pictures, so the app tells you and the model
is told a picture was added. Scanned PDFs (pictures of pages) and old .doc/.xls/.ppt files can't be read; the app says what to do instead.

## Taking a photo with the camera
Press 📎 and choose 📷 Take a photo. The first time, the app asks before it turns the camera on (tick "Remember my choice" to stop it
asking; change it later in Settings → Saved chats → Camera). Press 📸 Take photo, then Use this photo (or Retake), and the photo is added to your message
like any other picture. If you have more than one camera, pick it in the list. The camera turns off as soon as the window closes. A model
whose "File Uploading" switch is off can't be sent a photo, and the app says so.

## What each model may do
Press ⚙️ on a model's card in My models and it flips over to switches: File Uploading (read files and pictures you add),
File Creation (make files and save them), Open Programs (run scripts it makes), Microphone Access, and Remote Access (your phone or
Alexa). Switch any of them off (0) for that model (Done flips it back, and the card
shows 🔒 with what's turned off). Off always wins, even if you pressed "Always" on a file. Files a model isn't allowed to open are
shown in their folder instead.

## Use your models on your phone
Press 📱 Phone in Chat (or "Use on my phone" in Voice mode) and Turn on. Scan the QR code with the phone's camera, then press Allow on
the PC. The phone gets a simple chat page (add it to the home screen for an app icon). The PC does the work, so it must stay on with the
app open, and the phone must be on the same Wi-Fi. To talk instead of typing, use the 🎤 on the phone's keyboard; 🔈 reads answers out loud.
- Only devices on your home network can connect, never the internet, and each new phone needs Allow on the PC.
- Remove a phone, make a new code (old QR codes stop working) or turn it off in the same box.
- Switch "Remote Access" off with ⚙️ on a model card to keep a model off phones and Alexa.
- Phone chats are saved in Saved chats on the PC (they start with 📱).
- Windows asks once whether the app may use your network: choose Private networks and Allow.

## Amazon Alexa
"Alexa, ask my computer what's a good name for a cat?" is answered by a model on your PC. You need your own free Alexa skill (Alexa
developer console, same Amazon account as your Echo) and a free ngrok account with a static domain, so Amazon's servers can reach the PC.
Settings → Amazon Alexa has the fields and step-by-step setup, plus buttons that copy the skill setup (JSON) and the endpoint address.
- The app starts ngrok itself (install it with `winget install ngrok.ngrok`, or point the app at ngrok.exe).
- Alexa's server on the PC only listens on the PC itself; the tunnel forwards to it. Every request must carry Amazon's signature
  (checked against Amazon's certificate), be less than 150 seconds old, and come from your skill ID. Everything else is refused.
- Alexa waits about 8 seconds. If the model is slower, Alexa says it's still thinking: say "what's the answer" a few seconds later.
  "Start over" begins a new conversation. Alexa chats are saved in Saved chats (they start with 🔊).
- Pick which model Alexa uses; models with "Remote Access" switched off (⚙️ on the card) can't be used.

## Uninstalling
Uninstalling (Windows Settings → Apps) also deletes all downloaded models, voices, the speech pack and saved chats. Files the models made in
Documents › Open Model Desktop are kept. Updating the app keeps everything.

## Search page
The "what the words mean" notes are behind the ⓘ icon at the top right. Find models always opens on Starter picks, and models too big for
your computer (greyed out) are always listed last.

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
