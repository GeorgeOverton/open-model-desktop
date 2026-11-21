// Safe bridge between the window and the main process.
const { contextBridge, ipcRenderer } = require("electron");
const on = (channel) => (cb) => { const h = (_e, d) => cb(d); ipcRenderer.on(channel, h); return () => ipcRenderer.off(channel, h); };
contextBridge.exposeInMainWorld("desktop", {
  settings: { get: () => ipcRenderer.invoke("settings:get"), set: (p) => ipcRenderer.invoke("settings:set", p) },
  sys: {
    info: () => ipcRenderer.invoke("sys:info"),
    openModelsFolder: () => ipcRenderer.invoke("sys:openModelsFolder"),
    openExternal: (u) => ipcRenderer.invoke("sys:openExternal", u),
    askMic: () => ipcRenderer.invoke("sys:askMic"),
    copy: (t) => ipcRenderer.invoke("sys:copy", t),
  },
  auto: {
    tiers: () => ipcRenderer.invoke("auto:tiers"),
    preview: (tier) => ipcRenderer.invoke("auto:preview", tier),
  },
  updates: {
    status: () => ipcRenderer.invoke("update:status"),
    check: () => ipcRenderer.invoke("update:check"),
    download: () => ipcRenderer.invoke("update:download"),
    install: () => ipcRenderer.invoke("update:install"),
    onStatus: on("update:status"),
  },
  web: {
    open: (id) => ipcRenderer.invoke("web:open", id),
    external: (id) => ipcRenderer.invoke("web:external", id),
  },
  claude: {
    status: () => ipcRenderer.invoke("claude:status"),
    connect: () => ipcRenderer.invoke("claude:connect"),
    disconnect: () => ipcRenderer.invoke("claude:disconnect"),
    models: () => ipcRenderer.invoke("claude:models"),
    plan: () => ipcRenderer.invoke("claude:plan"),
    login: () => ipcRenderer.invoke("claude:login"),
    onActivity: on("claude:activity"), onSay: on("claude:say"),
  },
  downloads: {
    start: (job) => ipcRenderer.invoke("dl:start", job),
    cancel: (id) => ipcRenderer.invoke("dl:cancel", id),
    active: () => ipcRenderer.invoke("dl:active"),
    onProgress: on("dl:progress"), onDone: on("dl:done"), onError: on("dl:error"),
  },
  models: { list: () => ipcRenderer.invoke("models:list"), remove: (f) => ipcRenderer.invoke("models:delete", f) },
  chat: {
    load: (f) => ipcRenderer.invoke("chat:load", f),
    current: () => ipcRenderer.invoke("chat:current"),
    unload: () => ipcRenderer.invoke("chat:unload"),
    reset: (sp) => ipcRenderer.invoke("chat:reset", sp),
    stop: () => ipcRenderer.invoke("chat:stop"),
    send: (o) => ipcRenderer.invoke("chat:send", o),
    onChunk: on("chat:chunk"), onStatus: on("chat:status"), onRoute: on("chat:route"),
  },
  tts: {
    status: () => ipcRenderer.invoke("tts:status"),
    download: () => ipcRenderer.invoke("tts:download"),
    speak: (o) => ipcRenderer.invoke("tts:speak", o),
    warmup: () => ipcRenderer.invoke("tts:warmup"),
    onProgress: on("tts:progress"),
  },
  voice: {
    status: () => ipcRenderer.invoke("voice:status"),
    download: () => ipcRenderer.invoke("voice:download"),
    onProgress: on("voice:progress"),
  },
});
