/*
 * LOCAL NODE.JS SERVER / REST API
 * ===============================
 * Uses Node's built-in http, filesystem, compression, crypto, OS, and child
 * process modules—there is no Express dependency. The server:
 * - serves the teacher and player web applications with caching/compression;
 * - stores the current room-code session and synchronizes player devices;
 * - persists saved question sets, music presets, and optional DM feed files;
 * - proxies local AI requests to Ollama or LM Studio;
 * - proxies ElevenLabs streaming TTS and launches local Piper/Kokoro workers;
 * - exposes health and trace endpoints used by preflight/debug tooling.
 *
 * Start with playerSession below for the shared network model, then read the
 * http.createServer() route table to see every /api endpoint and its validation.
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const zlib = require("zlib");
const crypto = require("crypto");
const { spawn } = require("child_process");
const sharedData = require("./shared-data.js");

const root = __dirname;
const port = Number(process.env.PORT || 4174);
const feedPath = path.join(root, "dm-feed.json");
const answerPath = path.join(root, "dm-answer.json");
const questionSetsPath = path.join(root, "question-sets.json");
const musicPresetsPath = path.join(root, "music-presets.json");
const serverLogDirectory = path.join(root, "logs");
const serverLogPath = path.join(serverLogDirectory, "server-debug.log");
const SERVER_LOG_MAX_BYTES = 2 * 1024 * 1024;
const SERVER_LOG_ROTATIONS = 3;
const ollamaHost = process.env.OLLAMA_HOST || "http://localhost:11434";
const lmStudioHost = process.env.LM_STUDIO_HOST || "http://127.0.0.1:1234";
const DEFAULT_PLAYER_ACTION_COOLDOWN_MS = 120_000;
// Keep a short mount/animation guard without making players wait through a
// full two-second dead zone before their input can be accepted.
const PLAYER_PROMPT_SERVER_ARM_MS = 900;
const PLAYER_CLASS_IDS = ["soldier", "medic", "scout", "enforcer", "engineer", "tactician"];
const EXTERNAL_REQUEST_TIMEOUT_MS = 60_000;
const STATUS_REQUEST_TIMEOUT_MS = 10_000;
const elevenLabsApiKey = String(process.env.ELEVENLABS_API_KEY || "").trim();
const elevenLabsModel = String(process.env.ELEVENLABS_MODEL || "eleven_flash_v2_5").trim();
const elevenLabsSpeechSessions = new Map();
const elevenLabsVoicePreviews = new Map();
const excludedElevenLabsVoiceNames = new Set([
  "adam", "antoni", "arnold", "bella", "brian", "daniel", "domi", "elli", "josh", "rachel", "sam"
]);
const defaultPiperExePath = path.join(root, "tts", "piper", process.platform === "win32" ? "piper.exe" : "piper");
const defaultPiperModelPath = path.join(root, "tts", "voices", "en_GB-northern_english_male-medium.onnx");
const piperExePath = process.env.PIPER_EXE || defaultPiperExePath;
const piperModelPath = process.env.PIPER_MODEL || defaultPiperModelPath;
const piperConfigPath = process.env.PIPER_CONFIG || `${piperModelPath}.json`;
const piperCachePath = path.join(root, ".tts-cache");
const kokoroWorkerPath = path.join(root, "kokoro-worker.py");
const kokoroRuntimePath = process.env.KOKORO_RUNTIME || path.join(root, "tts", "kokoro", "runtime");
const kokoroModelPath = process.env.KOKORO_MODEL_DIR || path.join(root, "tts", "kokoro", "model", "kokoro-en-v0_19");
const kokoroPython = process.env.KOKORO_PYTHON || "python";
const kokoroVoices = [
  { id: 0, name: "af", label: "American Female" },
  { id: 1, name: "af_bella", label: "Bella (American Female)" },
  { id: 2, name: "af_nicole", label: "Nicole (American Female)" },
  { id: 3, name: "af_sarah", label: "Sarah (American Female)" },
  { id: 4, name: "af_sky", label: "Sky (American Female)" },
  { id: 5, name: "am_adam", label: "Adam (American Male)" },
  { id: 6, name: "am_michael", label: "Michael (American Male)" },
  { id: 7, name: "bf_emma", label: "Emma (British Female)" },
  { id: 8, name: "bf_isabella", label: "Isabella (British Female)" },
  { id: 9, name: "bm_george", label: "George (British Male)" },
  { id: 10, name: "bm_lewis", label: "Lewis (British Male)" }
];
let kokoroWorker = null;
let kokoroReady = false;
let kokoroStartupPromise = null;
let kokoroStartupResolve = null;
let kokoroStartupReject = null;
let kokoroStdoutBuffer = "";
let kokoroLastError = "";
let kokoroRequestId = 0;
const kokoroPending = new Map();
let serverRequestCounter = 0;
const traceThrottle = new Map();

function rotateServerLogIfNeeded() {
  try {
    if (!fs.existsSync(serverLogPath) || fs.statSync(serverLogPath).size < SERVER_LOG_MAX_BYTES) return;
    for (let index = SERVER_LOG_ROTATIONS; index >= 1; index -= 1) {
      const source = index === 1 ? serverLogPath : `${serverLogPath}.${index - 1}`;
      const destination = `${serverLogPath}.${index}`;
      if (!fs.existsSync(source)) continue;
      if (fs.existsSync(destination)) fs.rmSync(destination, { force: true });
      fs.renameSync(source, destination);
    }
  } catch (error) {
    console.error(`[server-trace] log rotation failed: ${error.message || error}`);
  }
}

function serverTrace(event, details = {}, level = "info") {
  const entry = {
    at: new Date().toISOString(),
    level,
    event,
    pid: process.pid,
    ...details
  };
  const line = JSON.stringify(entry);
  try {
    fs.mkdirSync(serverLogDirectory, { recursive: true });
    rotateServerLogIfNeeded();
    fs.appendFileSync(serverLogPath, `${line}\n`, "utf8");
  } catch (error) {
    console.error(`[server-trace] log write failed: ${error.message || error}`);
  }
  const announce = `[server-trace] ${entry.at} ${level.toUpperCase()} ${event}${details.message ? ` | ${details.message}` : ""}`;
  if (level === "error") console.error(announce);
  else if (level === "warn") console.warn(announce);
  else console.log(announce);
  return entry;
}

function serverTraceThrottled(key, intervalMs, event, details = {}, level = "warn") {
  const now = Date.now();
  if (now - Number(traceThrottle.get(key) || 0) < intervalMs) return null;
  traceThrottle.set(key, now);
  return serverTrace(event, details, level);
}

function readServerTrace(limit = 200) {
  try {
    const lines = fs.readFileSync(serverLogPath, "utf8").trim().split(/\r?\n/).filter(Boolean);
    return lines.slice(-Math.max(1, Math.min(1000, Number(limit) || 200))).map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return { at: "", level: "error", event: "trace.parse_failed", message: line.slice(0, 500) };
      }
    });
  } catch {
    return [];
  }
}

function sessionTraceSummary() {
  return {
    roomCode: playerSession.roomCode || "",
    sessionStatus: playerSession.status || "",
    promptId: playerSession.prompt?.id || "",
    promptAccepting: Boolean(playerSession.prompt?.accepting),
    participants: playerSession.participants.length,
    answers: playerSession.answers.length,
    actions: playerSession.actions.length,
    revision: Number(playerSession.revision) || 0,
    hostRevision: Number(playerSession.hostRevision) || 0
  };
}

function fetchWithTimeout(resource, options = {}, timeoutMs = EXTERNAL_REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, Number(timeoutMs) || EXTERNAL_REQUEST_TIMEOUT_MS));
  return fetch(resource, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".flac": "audio/flac",
  ".mp4": "video/mp4",
  ".webm": "video/webm"
};

const streamableMediaExtensions = new Set([
  ".wav",
  ".mp3",
  ".ogg",
  ".m4a",
  ".aac",
  ".flac",
  ".mp4",
  ".webm"
]);

const compressibleStaticExtensions = new Set([
  ".html",
  ".css",
  ".js",
  ".json",
  ".md",
  ".svg"
]);

function staticFileEtag(stats) {
  return `W/"${stats.size.toString(16)}-${Math.trunc(stats.mtimeMs).toString(16)}"`;
}

function staticRequestIsFresh(req, etag, modifiedAtMs) {
  const ifNoneMatch = String(req.headers["if-none-match"] || "").trim();
  if (ifNoneMatch) {
    return ifNoneMatch === "*" || ifNoneMatch.split(",").some((value) => value.trim() === etag);
  }
  const ifModifiedSince = String(req.headers["if-modified-since"] || "").trim();
  if (!ifModifiedSince) return false;
  const cachedAt = Date.parse(ifModifiedSince);
  if (!Number.isFinite(cachedAt)) return false;
  return Math.trunc(modifiedAtMs / 1000) <= Math.trunc(cachedAt / 1000);
}

function parseByteRange(rangeHeader, size) {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(String(rangeHeader || "").trim());
  if (!match || size <= 0) return { invalid: true };
  const startText = match[1];
  const endText = match[2];
  if (!startText && !endText) return { invalid: true };

  let start;
  let end;
  if (!startText) {
    const suffixLength = Number(endText);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return { invalid: true };
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(startText);
    end = endText ? Number(endText) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return { invalid: true };
    end = Math.min(end, size - 1);
  }

  if (start < 0 || start >= size || end < start) return { invalid: true };
  return { start, end };
}

let currentFeed = readFeed();
let currentAnswer = readAnswer();
let questionSetStore = readQuestionSetStore();
let musicPresetStore = readMusicPresetStore();
// In-memory coordination record for one active classroom game. `revision`
// changes whenever player-visible state changes, allowing clients to receive a
// lightweight 204 response when their cached copy is already current.
let playerSession = {
  roomCode: "",
  status: "setup",
  title: "",
  players: [],
  prompt: null,
  participants: [],
  answers: [],
  actions: [],
  queuedActions: [],
  removedNames: [],
  allowQueuedPlayerActions: false,
  actionCooldownMs: DEFAULT_PLAYER_ACTION_COOLDOWN_MS,
  promptPublishedAt: 0,
  promptAcceptAfter: 0,
  revision: 0,
  hostRevision: 0,
  updatedAt: Date.now()
};

function readFeed() {
  try {
    return JSON.parse(fs.readFileSync(feedPath, "utf8"));
  } catch {
    return { id: "initial", text: "" };
  }
}

function readAnswer() {
  try {
    return JSON.parse(fs.readFileSync(answerPath, "utf8"));
  } catch {
    return { id: "initial", answer: "" };
  }
}

function readQuestionSetStore() {
  try {
    const parsed = JSON.parse(fs.readFileSync(questionSetsPath, "utf8"));
    return {
      sets: Array.isArray(parsed.sets) ? parsed.sets.filter((set) => set && set.id && set.name) : [],
      selectedIds: Array.isArray(parsed.selectedIds) ? parsed.selectedIds.map(String) : []
    };
  } catch {
    return { sets: [], selectedIds: [] };
  }
}

function writeQuestionSetStore(store = questionSetStore) {
  questionSetStore = {
    sets: Array.isArray(store.sets) ? store.sets.filter((set) => set && set.id && set.name) : [],
    selectedIds: Array.isArray(store.selectedIds) ? store.selectedIds.map(String) : []
  };
  fs.writeFileSync(questionSetsPath, JSON.stringify(questionSetStore, null, 2) + "\n");
  return questionSetStore;
}

function readMusicPresetStore() {
  try {
    const parsed = JSON.parse(fs.readFileSync(musicPresetsPath, "utf8"));
    return {
      presets: Array.isArray(parsed.presets) ? parsed.presets.filter((preset) => preset && preset.id && preset.name) : []
    };
  } catch {
    return { presets: [] };
  }
}

function writeMusicPresetStore(store = musicPresetStore) {
  musicPresetStore = {
    presets: Array.isArray(store.presets) ? store.presets.filter((preset) => preset && preset.id && preset.name) : []
  };
  fs.writeFileSync(musicPresetsPath, JSON.stringify(musicPresetStore, null, 2) + "\n");
  return musicPresetStore;
}

function sendJson(res, status, payload) {
  if (status >= 400) {
    serverTrace("http.rejected", {
      requestId: res._traceRequestId || "",
      method: res._traceMethod || "",
      path: res._tracePath || "",
      statusCode: status,
      message: String(payload?.error || "Request rejected").slice(0, 500),
      ...sessionTraceSummary()
    }, status >= 500 ? "error" : "warn");
  }
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body)
  });
  res.end(body);
}

function sendNoContent(res) {
  res.writeHead(204, {
    "cache-control": "no-store"
  });
  res.end();
}

function touchPlayerSession() {
  playerSession.updatedAt = Date.now();
  playerSession.revision = Math.max(0, Number(playerSession.revision) || 0) + 1;
}

function armPlayerSessionPromptIfReady() {
  const acceptAfter = Number(playerSession.promptAcceptAfter || 0);
  if (!playerSession.prompt?.accepting || !acceptAfter || Date.now() < acceptAfter) return;
  playerSession.promptAcceptAfter = 0;
  touchPlayerSession();
}

function publicPlayerSession() {
  const session = {
    ...playerSession,
    prompt: playerSession.prompt ? { ...playerSession.prompt } : null
  };
  if (session.prompt?.accepting && Date.now() < Number(playerSession.promptAcceptAfter || 0)) {
    session.prompt.accepting = false;
    session.prompt.arming = true;
    session.prompt.acceptAfter = playerSession.promptAcceptAfter;
  }
  return session;
}

function publicPlayerSyncSession() {
  const session = publicPlayerSession();
  return {
    roomCode: session.roomCode,
    title: session.title,
    status: session.status,
    prompt: session.prompt,
    revision: session.revision,
    hostRevision: session.hostRevision,
    updatedAt: session.updatedAt
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    const timeout = setTimeout(() => {
      reject(new Error("Request body timed out"));
      req.destroy();
    }, 10_000);
    const finish = (callback, value) => {
      clearTimeout(timeout);
      callback(value);
    };
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 5_000_000) {
        finish(reject, new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => finish(resolve, body));
    req.on("error", (error) => finish(reject, error));
  });
}

function staticPath(urlPath) {
  const clean = decodeURIComponent(urlPath.split("?")[0]);
  const requested = clean === "/" ? "/index.html" : clean;
  const resolved = path.resolve(root, "." + requested);
  if (!resolved.startsWith(root)) return null;
  return resolved;
}

function localAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((entry) => entry && entry.family === "IPv4" && !entry.internal)
    .map((entry) => entry.address);
}

function preferredJoinAddress(addresses) {
  const clean = [...new Set(addresses.map((address) => String(address || "").trim()).filter(Boolean))];
  if (!clean.length) return "";
  return clean.find((address) => address.startsWith("192.168.137."))
    || clean.find((address) => /^192\.168\./.test(address))
    || clean.find((address) => /^10\./.test(address))
    || clean.find((address) => /^172\.(1[6-9]|2\d|3[0-1])\./.test(address))
    || clean[0];
}

function playerJoinUrlBase() {
  const address = preferredJoinAddress(localAddresses());
  return address ? `http://${address}:${port}/player.html` : `http://localhost:${port}/player.html`;
}

const profanitySubstitutions = sharedData.profanitySubstitutions || [];

function sanitizeText(value, options = {}) {
  const fallback = options.fallback || "";
  const maxLength = options.maxLength || 240;
  let text = String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  for (const [pattern, replacement] of profanitySubstitutions) {
    text = text.replace(pattern, replacement);
  }

  text = trimTextToLength(text, maxLength);
  return text || fallback;
}

function trimTextToLength(text, maxLength) {
  if (!Number.isFinite(maxLength) || maxLength <= 0 || text.length <= maxLength) return text;
  const clipped = text.slice(0, maxLength).trim();
  if (!clipped) return "";

  if (maxLength >= 120) {
    const sentenceMatches = Array.from(clipped.matchAll(/[.!?](?=(?:["')\]]|\s|$))/g));
    const lastSentence = sentenceMatches.at(-1);
    if (lastSentence && lastSentence.index + 1 >= Math.floor(maxLength * 0.45)) {
      return clipped.slice(0, lastSentence.index + 1).trim();
    }
  }

  const lastSpace = clipped.lastIndexOf(" ");
  if (lastSpace >= Math.floor(maxLength * 0.6)) {
    return clipped.slice(0, lastSpace).trim();
  }
  return clipped;
}

function sanitizePlayerName(value) {
  return sanitizeText(value, { fallback: "Operator", maxLength: 32 });
}

function normalize(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ");
}

function isSessionPlayerIncapacitated(name) {
  const state = Array.isArray(playerSession.playerStates)
    ? playerSession.playerStates.find((entry) => normalize(entry.name) === normalize(name))
    : null;
  return Boolean(state?.incapacitated) || Number(state?.hp) <= 0;
}

async function callOllama(payload) {
  const requestedPredict = Number(payload.maxTokens ?? payload.numPredict ?? payload.num_predict);
  const numPredict = Number.isFinite(requestedPredict) && requestedPredict > 0
    ? Math.floor(requestedPredict)
    : null;
  const startedAt = Date.now();
  const model = payload.model || "llama3.2:3b";
  serverTrace("llm.started", {
    provider: "ollama",
    model,
    promptChars: String(payload.prompt || "").length,
    format: payload.format || "text"
  });
  const options = {
    temperature: Number.isFinite(Number(payload.temperature)) ? Number(payload.temperature) : 0.75
  };
  if (numPredict) options.num_predict = numPredict;
  const response = await fetchWithTimeout(`${ollamaHost}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      prompt: payload.prompt || "",
      stream: false,
      format: payload.format || undefined,
      think: payload.think === undefined ? false : payload.think,
      options
    })
  });

  const body = await response.text();
  if (!response.ok) throw new Error(body || `Ollama returned ${response.status}`);
  const result = JSON.parse(body);
  result.server_duration_ms = Date.now() - startedAt;
  result.num_predict = numPredict;
  serverTrace("llm.completed", {
    provider: "ollama",
    model,
    durationMs: result.server_duration_ms,
    responseChars: String(result.response || "").length,
    numPredict
  });
  return result;
}

async function callLmStudio(payload) {
  const requestedPredict = Number(payload.maxTokens ?? payload.numPredict ?? payload.num_predict);
  const numPredict = Number.isFinite(requestedPredict) && requestedPredict > 0
    ? Math.floor(requestedPredict)
    : null;
  const startedAt = Date.now();
  const model = payload.model || "google/gemma-4-e4b";
  serverTrace("llm.started", {
    provider: "lmstudio",
    model,
    promptChars: String(payload.prompt || "").length,
    format: payload.format || "text"
  });
  const requestReasoning = lmStudioReasoningSetting(model);
  const requestBody = {
    model,
    messages: [
      {
        role: "system",
        content: "Write only the requested player-facing output. Do not include hidden reasoning, chain-of-thought, analysis, tags, or commentary about being an AI."
      },
      {
        role: "user",
        content: payload.prompt || ""
      }
    ],
    stream: false,
    temperature: Number.isFinite(Number(payload.temperature)) ? Number(payload.temperature) : 0.75,
    chat_template_kwargs: { enable_thinking: false },
    store: false
  };
  if (requestReasoning) requestBody.reasoning = requestReasoning;
  if (numPredict) requestBody.max_tokens = numPredict;
  const response = await fetchWithTimeout(`${lmStudioHost}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(requestBody)
  });

  const body = await response.text();
  if (!response.ok) throw new Error(body || `LM Studio returned ${response.status}`);
  const result = JSON.parse(body);
  const text = String(result.choices?.[0]?.message?.content || "").trim();
  const reasoning = String(result.choices?.[0]?.message?.reasoning_content || "");
  const cleaned = stripReasoningText(text);
  if (looksLikeVisibleReasoning(cleaned || text)) {
    throw new Error("LM Studio returned visible reasoning instead of player-facing narration. Retrying with a non-thinking model is recommended.");
  }
  if (!cleaned && (reasoning || Number(result.usage?.reasoning_output_tokens) > 0 || Number(result.usage?.reasoning_tokens) > 0)) {
    throw new Error("LM Studio returned reasoning-only output. Select a non-thinking model or disable thinking for this model in LM Studio.");
  }
  const normalizedResult = {
    model: result.model || payload.model || "google/gemma-4-e4b",
    response: cleaned,
    total_duration: null,
    server_duration_ms: Date.now() - startedAt,
    num_predict: numPredict,
    stats: result.usage || null
  };
  serverTrace("llm.completed", {
    provider: "lmstudio",
    model: normalizedResult.model,
    durationMs: normalizedResult.server_duration_ms,
    responseChars: normalizedResult.response.length,
    numPredict
  });
  return normalizedResult;
}

async function loadLmStudioModel(model) {
  const requestedModel = String(model || "").trim();
  if (!requestedModel) throw new Error("Missing model");
  const startedAt = Date.now();
  const response = await fetchWithTimeout(`${lmStudioHost}/api/v1/models/load`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: requestedModel,
      echo_load_config: true
    })
  }, STATUS_REQUEST_TIMEOUT_MS);
  const body = await response.text();
  if (!response.ok) throw new Error(body || `LM Studio returned ${response.status}`);
  const parsed = body ? JSON.parse(body) : {};
  return {
    ...parsed,
    model: requestedModel,
    server_duration_ms: Date.now() - startedAt
  };
}

function lmStudioReasoningSetting(model) {
  const name = String(model || "").toLowerCase();
  if (name.includes("gpt-oss")) return "low";
  return null;
}

function stripReasoningText(text) {
  let value = String(text || "")
    .replace(/\\u003c/gi, "<")
    .replace(/\\u003e/gi, ">")
    .replace(/\\u002f/gi, "/");
  const closingThinkIndex = value.toLowerCase().lastIndexOf("</think>");
  if (closingThinkIndex >= 0) value = value.slice(closingThinkIndex + "</think>".length);
  return value
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^\s*(?:the\s+)?user\s+(?:wants|asked|is asking)\s+me\b[\s\S]*?(?=\n\s*(?:final|answer|response|paragraph)\s*:|\n{2,}|$)/i, "")
    .replace(/^\s*(?:situation|task|request)\s*:\s*(?:the\s+)?user\s+(?:wants|asked|is asking)[\s\S]*?(?=\n\s*(?:final|answer|response|paragraph)\s*:|\n{2,}|$)/i, "")
    .replace(/^\s*(?:thinking process|constraint checklist(?:\s*&\s*confidence score)?|checklist|analysis|reasoning|thoughts?|plan)\s*:?\s*[\s\S]*?(?=\n\s*(?:final|answer|response|paragraph)\s*:|\n{2,}|$)/i, "")
    .replace(/^\s*(analysis|reasoning|thoughts?|plan)\s*:\s*[\s\S]*?(?=\n\s*(answer|response)\s*:|\n{2,}|$)/i, "")
    .replace(/^\s*(answer|response|final|paragraph)\s*:\s*/i, "")
    .trim();
}

function looksLikeVisibleReasoning(text) {
  const value = String(text || "").trim();
  if (!value) return false;
  return /^\s*(?:the\s+)?user\s+(?:wants|asked|is asking)\s+me\b/i.test(value)
    || /^\s*(?:situation|task|request)\s*:\s*(?:the\s+)?user\s+(?:wants|asked|is asking)\b/i.test(value)
    || /^\s*(?:thinking process|constraint checklist(?:\s*&\s*confidence score)?|checklist|analysis|reasoning|thoughts?|plan)\s*:?\b/i.test(value)
    || /\bConstraint Checklist\b/i.test(value)
    || /\bConfidence Score\b/i.test(value)
    || /\bAct as player-facing output\s*:\s*Yes\b/i.test(value)
    || /\bAnalyze the Request\b/i.test(value);
}

function piperStatus() {
  const exeExists = fs.existsSync(piperExePath);
  const modelExists = fs.existsSync(piperModelPath);
  const configExists = fs.existsSync(piperConfigPath);
  return {
    available: exeExists && modelExists && configExists,
    exeExists,
    modelExists,
    configExists,
    exePath: piperExePath,
    modelPath: piperModelPath,
    configPath: piperConfigPath,
    voiceName: "en_GB northern english male medium"
  };
}

function elevenLabsStatus() {
  return {
    available: Boolean(elevenLabsApiKey),
    model: elevenLabsModel,
    voiceName: "ElevenLabs Flash",
    error: elevenLabsApiKey ? "" : "Set ELEVENLABS_API_KEY and restart the server"
  };
}

async function fetchElevenLabsVoices() {
  if (!elevenLabsApiKey) throw new Error("ElevenLabs API key is not configured");
  const response = await fetch("https://api.elevenlabs.io/v2/voices?page_size=100", {
    headers: { "xi-api-key": elevenLabsApiKey },
    signal: AbortSignal.timeout(STATUS_REQUEST_TIMEOUT_MS)
  });
  if (!response.ok) {
    const detail = sanitizeText(await response.text(), { maxLength: 500 });
    throw new Error(detail || `ElevenLabs voice lookup failed with HTTP ${response.status}`);
  }
  const body = await response.json();
  const voices = (Array.isArray(body.voices) ? body.voices : []).map((voice) => ({
    id: sanitizeText(voice.voice_id, { maxLength: 100 }),
    name: sanitizeText(voice.name, { maxLength: 100 }) || "ElevenLabs voice",
    category: sanitizeText(voice.category, { maxLength: 60 }),
    previewUrl: /^https:\/\//i.test(String(voice.preview_url || "")) ? String(voice.preview_url) : ""
  })).filter((voice) => {
    if (!voice.id) return false;
    const canonicalName = voice.name.split(/\s+-\s+|:/, 1)[0].trim().toLowerCase();
    return !excludedElevenLabsVoiceNames.has(canonicalName);
  }).sort((left, right) => {
    const categoryRank = (voice) => voice.category === "premade" ? 0 : voice.category === "generated" ? 1 : 2;
    return categoryRank(left) - categoryRank(right) || left.name.localeCompare(right.name);
  });
  elevenLabsVoicePreviews.clear();
  voices.forEach((voice) => {
    if (voice.previewUrl) elevenLabsVoicePreviews.set(voice.id, voice.previewUrl);
  });
  return voices.map(({ previewUrl, ...voice }) => voice);
}

async function requestElevenLabsSpeech(text, options = {}) {
  if (!elevenLabsApiKey) throw new Error("ElevenLabs API key is not configured");
  const voiceId = sanitizeText(options.voiceId, { maxLength: 100 });
  if (!voiceId) throw new Error("Select an ElevenLabs voice");
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream?output_format=mp3_44100_128`, {
    method: "POST",
    headers: {
      "accept": "audio/mpeg",
      "content-type": "application/json",
      "xi-api-key": elevenLabsApiKey
    },
    body: JSON.stringify({
      text,
      model_id: elevenLabsModel,
      voice_settings: {
        stability: 0.55,
        similarity_boost: 0.75,
        style: 0,
        use_speaker_boost: false,
        speed: Math.max(0.75, Math.min(1.25, Number(options.rate) || 1))
      }
    }),
    signal: AbortSignal.timeout(EXTERNAL_REQUEST_TIMEOUT_MS)
  });
  if (!response.ok || !response.body) {
    const detail = sanitizeText(await response.text(), { maxLength: 700 });
    throw new Error(detail || `ElevenLabs speech failed with HTTP ${response.status}`);
  }
  return response;
}

async function pipeElevenLabsSpeech(res, session) {
  const startedAt = Date.now();
  const upstream = await requestElevenLabsSpeech(session.text, session);
  res.writeHead(200, {
    "content-type": "audio/mpeg",
    "cache-control": "no-store",
    "transfer-encoding": "chunked"
  });
  const reader = upstream.body.getReader();
  let audioBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    audioBytes += value.byteLength;
    if (!res.write(Buffer.from(value))) await new Promise((resolve) => res.once("drain", resolve));
  }
  serverTrace("tts.completed", { provider: "elevenlabs", durationMs: Date.now() - startedAt, textChars: session.text.length, audioBytes });
  res.end();
}

function generatePiperSpeech(text, options = {}) {
  return new Promise((resolve, reject) => {
    const status = piperStatus();
    if (!status.available) {
      reject(new Error("Piper is not ready. Add piper.exe, the .onnx voice, and the .onnx.json config under the local tts folder."));
      return;
    }
    fs.mkdirSync(piperCachePath, { recursive: true });
    const outputPath = path.join(piperCachePath, `speech-${Date.now()}-${Math.random().toString(16).slice(2)}.wav`);
    const rate = Math.max(0.75, Math.min(1.25, Number(options.rate) || 1));
    const lengthScale = Math.max(0.72, Math.min(1.35, 1 / rate));
    const args = [
      "--model", piperModelPath,
      "--config", piperConfigPath,
      "--output_file", outputPath,
      "--length_scale", String(lengthScale),
      "--sentence_silence", "0.12"
    ];
    const child = spawn(piperExePath, args, { windowsHide: true });
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("Piper speech generation timed out."));
    }, 45_000);

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(stderr.trim() || `Piper exited with code ${code}`));
        return;
      }
      try {
        const audio = prependWavSilence(fs.readFileSync(outputPath), 320);
        fs.unlink(outputPath, () => {});
        resolve(audio);
      } catch (error) {
        reject(error);
      }
    });
    child.stdin.end(`${text.trim()}\n`);
  });
}

function kokoroStatus() {
  const workerExists = fs.existsSync(kokoroWorkerPath);
  const runtimeExists = fs.existsSync(path.join(kokoroRuntimePath, "sherpa_onnx", "__init__.py"));
  const modelExists = fs.existsSync(path.join(kokoroModelPath, "model.onnx"));
  const voicesExist = fs.existsSync(path.join(kokoroModelPath, "voices.bin"));
  const tokensExist = fs.existsSync(path.join(kokoroModelPath, "tokens.txt"));
  const dataExists = fs.existsSync(path.join(kokoroModelPath, "espeak-ng-data"));
  return {
    available: workerExists && runtimeExists && modelExists && voicesExist && tokensExist && dataExists,
    ready: kokoroReady,
    workerExists,
    runtimeExists,
    modelExists,
    voicesExist,
    tokensExist,
    dataExists,
    voiceName: "Kokoro: Lewis (British Male)",
    voices: kokoroVoices,
    error: kokoroLastError
  };
}

function rejectKokoroPending(error) {
  kokoroPending.forEach((pending) => {
    clearTimeout(pending.timeout);
    pending.reject(error);
  });
  kokoroPending.clear();
}

function resetKokoroWorker(error) {
  const failure = error instanceof Error ? error : new Error(String(error || "Kokoro worker stopped"));
  kokoroLastError = failure.message;
  kokoroReady = false;
  kokoroWorker = null;
  kokoroStdoutBuffer = "";
  if (kokoroStartupReject) kokoroStartupReject(failure);
  kokoroStartupPromise = null;
  kokoroStartupResolve = null;
  kokoroStartupReject = null;
  rejectKokoroPending(failure);
}

function handleKokoroMessage(message) {
  if (message?.type === "ready") {
    kokoroReady = true;
    kokoroLastError = "";
    if (kokoroStartupResolve) kokoroStartupResolve(message);
    kokoroStartupPromise = null;
    kokoroStartupResolve = null;
    kokoroStartupReject = null;
    return;
  }
  const pending = kokoroPending.get(String(message?.id || ""));
  if (!pending) return;
  kokoroPending.delete(String(message.id));
  clearTimeout(pending.timeout);
  if (message.ok) pending.resolve(message);
  else pending.reject(new Error(message.error || "Kokoro speech generation failed"));
}

function startKokoroWorker() {
  if (kokoroWorker && kokoroReady) return Promise.resolve();
  if (kokoroStartupPromise) return kokoroStartupPromise;
  const status = kokoroStatus();
  if (!status.available) {
    return Promise.reject(new Error("Kokoro is not installed. Run setup-kokoro-tts.ps1 first."));
  }

  kokoroStartupPromise = new Promise((resolve, reject) => {
    kokoroStartupResolve = resolve;
    kokoroStartupReject = reject;
  });
  const startupTimeout = setTimeout(() => {
    if (!kokoroReady) {
      kokoroWorker?.kill();
      resetKokoroWorker(new Error("Kokoro model loading timed out"));
    }
  }, 30_000);

  kokoroWorker = spawn(kokoroPython, ["-u", kokoroWorkerPath], {
    cwd: root,
    windowsHide: true,
    env: {
      ...process.env,
      KOKORO_RUNTIME: kokoroRuntimePath,
      KOKORO_MODEL_DIR: kokoroModelPath
    }
  });
  let stderr = "";
  kokoroWorker.stdout.on("data", (chunk) => {
    kokoroStdoutBuffer += chunk.toString();
    const lines = kokoroStdoutBuffer.split(/\r?\n/);
    kokoroStdoutBuffer = lines.pop() || "";
    lines.filter(Boolean).forEach((line) => {
      try {
        handleKokoroMessage(JSON.parse(line));
      } catch {
        kokoroLastError = `Invalid Kokoro worker response: ${line.slice(0, 180)}`;
      }
    });
    if (kokoroReady) clearTimeout(startupTimeout);
  });
  kokoroWorker.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  kokoroWorker.on("error", (error) => {
    clearTimeout(startupTimeout);
    resetKokoroWorker(error);
  });
  kokoroWorker.on("close", (code) => {
    clearTimeout(startupTimeout);
    if (kokoroWorker || !kokoroReady) {
      resetKokoroWorker(new Error(stderr.trim() || `Kokoro worker exited with code ${code}`));
    }
  });
  return kokoroStartupPromise;
}

async function generateKokoroSpeech(text, options = {}) {
  await startKokoroWorker();
  fs.mkdirSync(piperCachePath, { recursive: true });
  const id = String(++kokoroRequestId);
  const outputPath = path.join(piperCachePath, `kokoro-${Date.now()}-${id}.wav`);
  const requestedVoiceId = Number.parseInt(options.voiceId, 10);
  const voiceId = Number.isFinite(requestedVoiceId) ? Math.max(0, Math.min(10, requestedVoiceId)) : 10;
  const rate = Math.max(0.75, Math.min(1.25, Number(options.rate) || 1));
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      kokoroPending.delete(id);
      reject(new Error("Kokoro speech generation timed out"));
    }, 90_000);
    kokoroPending.set(id, { resolve, reject, timeout });
    kokoroWorker.stdin.write(`${JSON.stringify({ id, text, rate, sid: voiceId, outputPath })}\n`, (error) => {
      if (!error) return;
      clearTimeout(timeout);
      kokoroPending.delete(id);
      reject(error);
    });
  });
  try {
    return prependWavSilence(fs.readFileSync(outputPath), 240);
  } finally {
    fs.unlink(outputPath, () => {});
  }
}

process.on("exit", () => {
  if (kokoroWorker) kokoroWorker.kill();
});

function prependWavSilence(buffer, silenceMs = 250) {
  try {
    if (!Buffer.isBuffer(buffer) || buffer.length < 44) return buffer;
    if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") return buffer;

    let offset = 12;
    let fmtOffset = -1;
    let dataOffset = -1;
    let dataSizeOffset = -1;
    let dataSize = 0;

    while (offset + 8 <= buffer.length) {
      const chunkId = buffer.toString("ascii", offset, offset + 4);
      const chunkSize = buffer.readUInt32LE(offset + 4);
      const chunkDataOffset = offset + 8;
      if (chunkId === "fmt ") fmtOffset = chunkDataOffset;
      if (chunkId === "data") {
        dataOffset = chunkDataOffset;
        dataSizeOffset = offset + 4;
        dataSize = chunkSize;
        break;
      }
      offset = chunkDataOffset + chunkSize + (chunkSize % 2);
    }

    if (fmtOffset < 0 || dataOffset < 0 || dataSizeOffset < 0) return buffer;
    const byteRate = buffer.readUInt32LE(fmtOffset + 8);
    const blockAlign = buffer.readUInt16LE(fmtOffset + 12);
    if (!byteRate || !blockAlign) return buffer;

    const silenceBytes = Math.max(blockAlign, Math.floor(byteRate * (Number(silenceMs) || 0) / 1000 / blockAlign) * blockAlign);
    const output = Buffer.concat([
      buffer.subarray(0, dataOffset),
      Buffer.alloc(silenceBytes),
      buffer.subarray(dataOffset, dataOffset + dataSize),
      buffer.subarray(dataOffset + dataSize)
    ]);
    output.writeUInt32LE(output.length - 8, 4);
    output.writeUInt32LE(dataSize + silenceBytes, dataSizeOffset);
    return output;
  } catch {
    return buffer;
  }
}

// Central REST router. Each branch validates method/path and delegates to the
// relevant session, storage, local-model, or speech service operation.
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const requestId = `req-${++serverRequestCounter}`;
    const requestStartedAt = Date.now();
    res._traceRequestId = requestId;
    res._traceMethod = req.method || "";
    res._tracePath = url.pathname;
    res.once("finish", () => {
      const durationMs = Date.now() - requestStartedAt;
      if (durationMs >= 2_000) {
        serverTrace("http.slow", {
          requestId,
          method: req.method || "",
          path: url.pathname,
          status: res.statusCode,
          durationMs,
          ...sessionTraceSummary()
        }, "warn");
      }
    });
    req.once("aborted", () => {
      serverTrace("http.aborted", {
        requestId,
        method: req.method || "",
        path: url.pathname,
        durationMs: Date.now() - requestStartedAt
      }, "warn");
    });

    if (url.pathname === "/api/debug/server-log" && req.method === "GET") {
      return sendJson(res, 200, {
        ok: true,
        logPath: serverLogPath,
        session: sessionTraceSummary(),
        entries: readServerTrace(url.searchParams.get("limit"))
      });
    }

    if (url.pathname === "/api/debug/client-trace" && req.method === "POST") {
      const body = await readBody(req);
      let parsed = {};
      try {
        parsed = body ? JSON.parse(body) : {};
      } catch {
        return sendJson(res, 400, { ok: false, error: "Invalid trace payload" });
      }
      const traceId = String(parsed.traceId || "").slice(0, 80);
      const marker = String(parsed.marker || "MARK").slice(0, 80);
      const phase = String(parsed.phase || "").slice(0, 160);
      serverTrace("client.room_transition", {
        traceId,
        marker,
        phase,
        elapsedMs: Math.max(0, Number(parsed.elapsedMs) || 0),
        phaseMs: Math.max(0, Number(parsed.phaseMs) || 0),
        details: parsed.details && typeof parsed.details === "object" ? parsed.details : {},
        snapshot: parsed.snapshot && typeof parsed.snapshot === "object" ? parsed.snapshot : {},
        ...sessionTraceSummary()
      }, marker === "TIMEOUT" || marker === "MAIN_THREAD_GAP" || marker === "ERROR" ? "warn" : "info");
      return sendJson(res, 200, { ok: true, traceId, marker });
    }

    if (url.pathname === "/api/debug/transition-trace" && req.method === "GET") {
      const transitionEntries = readServerTrace(1000)
        .filter((entry) => entry.event === "client.room_transition" && entry.traceId);
      const requestedTraceId = String(url.searchParams.get("traceId") || "").slice(0, 80);
      const traceId = requestedTraceId || transitionEntries.at(-1)?.traceId || "";
      const entries = traceId ? transitionEntries.filter((entry) => entry.traceId === traceId) : [];
      const completed = entries.findLast?.((entry) => entry.marker === "COMPLETE") || null;
      const slowest = completed?.details?.slowest || [];
      return sendJson(res, 200, {
        ok: true,
        traceId,
        active: Boolean(traceId && !completed),
        totalMs: completed?.details?.totalMs || entries.at(-1)?.elapsedMs || 0,
        slowest,
        entries
      });
    }

    if (url.pathname === "/j" && req.method === "GET") {
      const room = String(url.searchParams.get("room") || "").trim().toUpperCase();
      const target = `/player.html${room ? `?room=${encodeURIComponent(room)}` : ""}`;
      res.writeHead(302, {
        location: target,
        "cache-control": "no-store"
      });
      return res.end();
    }

    if (url.pathname === "/api/feed" && req.method === "GET") {
      return sendJson(res, 200, currentFeed);
    }

    if (url.pathname === "/api/feed" && req.method === "POST") {
      const body = await readBody(req);
      const parsed = body ? JSON.parse(body) : {};
      if (!parsed.id) parsed.id = `feed-${Date.now()}`;
      currentFeed = parsed;
      fs.writeFileSync(feedPath, JSON.stringify(currentFeed, null, 2) + "\n");
      serverTrace("dm.feed_updated", {
        feedId: currentFeed.id,
        hasQuestion: Boolean(currentFeed.question),
        advanceRoom: Boolean(currentFeed.advanceRoom),
        textChars: String(currentFeed.story || currentFeed.text || "").length
      });
      return sendJson(res, 200, { ok: true, feed: currentFeed });
    }

    if (url.pathname === "/api/answer" && req.method === "GET") {
      return sendJson(res, 200, currentAnswer);
    }

    if (url.pathname === "/api/answer" && req.method === "POST") {
      const body = await readBody(req);
      const parsed = body ? JSON.parse(body) : {};
      if (!parsed.id) parsed.id = `answer-${Date.now()}`;
      currentAnswer = parsed;
      fs.writeFileSync(answerPath, JSON.stringify(currentAnswer, null, 2) + "\n");
      serverTrace("teacher.answer_received", {
        answerId: currentAnswer.id,
        promptId: currentAnswer.promptId || "",
        source: currentAnswer.source || "",
        questionIndex: currentAnswer.questionIndex ?? null,
        nodeIndex: currentAnswer.nodeIndex ?? null,
        timeout: Boolean(currentAnswer.timeout)
      });
      return sendJson(res, 200, { ok: true, answer: currentAnswer });
    }

    if (url.pathname === "/api/question-sets" && req.method === "GET") {
      return sendJson(res, 200, { ok: true, ...questionSetStore });
    }

    if (url.pathname === "/api/question-sets" && req.method === "POST") {
      const body = await readBody(req);
      const parsed = body ? JSON.parse(body) : {};
      const sets = Array.isArray(parsed.sets) ? parsed.sets : [];
      const selectedIds = Array.isArray(parsed.selectedIds) ? parsed.selectedIds : [];
      const cleanSets = sets
        .filter((set) => set && set.id && set.name)
        .map((set) => ({
          id: sanitizeText(set.id, { maxLength: 80 }),
          name: sanitizeText(set.name, { maxLength: 70 }),
          createdAt: sanitizeText(set.createdAt, { maxLength: 40 }),
          updatedAt: sanitizeText(set.updatedAt, { maxLength: 40 }),
          useDifficulty: Boolean(set.useDifficulty),
          mainText: String(set.mainText || ""),
          easyText: String(set.easyText || ""),
          mediumText: String(set.mediumText || ""),
          hardText: String(set.hardText || "")
        }));
      const selected = selectedIds.map(String).filter((id) => cleanSets.some((set) => set.id === id));
      const store = writeQuestionSetStore({ sets: cleanSets, selectedIds: selected });
      return sendJson(res, 200, { ok: true, ...store });
    }

    if (url.pathname === "/api/music-presets" && req.method === "GET") {
      return sendJson(res, 200, { ok: true, ...musicPresetStore });
    }

    if (url.pathname === "/api/music-presets" && req.method === "POST") {
      const body = await readBody(req);
      const parsed = body ? JSON.parse(body) : {};
      const presets = Array.isArray(parsed.presets) ? parsed.presets : [];
      const cleanPresets = presets
        .filter((preset) => preset && preset.id && preset.name)
        .map((preset) => ({
          id: sanitizeText(preset.id, { maxLength: 80 }),
          name: sanitizeText(preset.name, { maxLength: 70 }),
          normalUrl: sanitizeText(preset.normalUrl, { maxLength: 500 }),
          bossUrl: sanitizeText(preset.bossUrl, { maxLength: 500 }),
          createdAt: sanitizeText(preset.createdAt, { maxLength: 40 }),
          updatedAt: sanitizeText(preset.updatedAt, { maxLength: 40 })
        }));
      const store = writeMusicPresetStore({ presets: cleanPresets });
      return sendJson(res, 200, { ok: true, ...store });
    }

    if (url.pathname === "/api/player-session" && req.method === "GET") {
      armPlayerSessionPromptIfReady();
      const playerId = String(url.searchParams.get("playerId") || "").trim();
      const participant = playerId ? playerSession.participants.find((entry) => entry.id === playerId) : null;
      if (participant) {
        const now = Date.now();
        const heartbeatGapMs = Number(participant.lastSeenAt) ? now - Number(participant.lastSeenAt) : 0;
        participant.lastSeenAt = now;
        if (heartbeatGapMs >= 15_000) {
          serverTrace("player.heartbeat_resumed", {
            roomCode: playerSession.roomCode,
            playerId: participant.id,
            playerName: participant.name,
            heartbeatGapMs
          }, "warn");
        }
      }
      const sinceRevision = Math.max(0, Number(url.searchParams.get("sinceRevision")) || 0);
      if (sinceRevision > 0 && sinceRevision === Math.max(0, Number(playerSession.revision) || 0)) {
        return sendNoContent(res);
      }
      return sendJson(res, 200, publicPlayerSession());
    }

    if (url.pathname === "/api/host-info" && req.method === "GET") {
      const addresses = localAddresses();
      return sendJson(res, 200, {
        ok: true,
        port,
        addresses,
        preferredAddress: preferredJoinAddress(addresses),
        playerJoinUrlBase: playerJoinUrlBase()
      });
    }

    if (url.pathname === "/api/player-session" && req.method === "POST") {
      const body = await readBody(req);
      const parsed = body ? JSON.parse(body) : {};
      const previousPromptId = playerSession.prompt?.id || "";
      const previousStatus = playerSession.status || "";
      const nextPromptId = parsed.prompt?.id || "";
      const roomChanged = parsed.roomCode && parsed.roomCode !== playerSession.roomCode;
      const now = Date.now();
      const incomingHostRevision = Math.max(0, Number(parsed.hostRevision) || 0);
      const currentHostRevision = roomChanged ? 0 : Math.max(0, Number(playerSession.hostRevision) || 0);
      if (!roomChanged && incomingHostRevision && incomingHostRevision <= currentHostRevision) {
        serverTrace("session.publish_stale", {
          roomCode: playerSession.roomCode,
          incomingHostRevision,
          currentHostRevision,
          previousPromptId,
          nextPromptId
        }, "warn");
        return sendJson(res, 409, { ok: false, stale: true, error: "Stale host update ignored", session: publicPlayerSession() });
      }
      const clearingPrompt = Object.prototype.hasOwnProperty.call(parsed, "prompt") && parsed.prompt === null;
      const expectedPromptId = String(parsed.expectedPromptId || "");
      const activePromptId = String(playerSession.prompt?.id || "");
      if (!roomChanged && clearingPrompt && expectedPromptId && activePromptId && expectedPromptId !== activePromptId) {
        serverTrace("session.prompt_clear_conflict", {
          roomCode: playerSession.roomCode,
          expectedPromptId,
          activePromptId,
          incomingHostRevision
        }, "warn");
        return sendJson(res, 409, { ok: false, conflict: true, error: "Prompt clear no longer matches active prompt", session: publicPlayerSession() });
      }
      const promptChanged = Boolean(nextPromptId && nextPromptId !== previousPromptId);
      const promptPublishedAt = promptChanged ? now : Number(playerSession.promptPublishedAt || 0);
      const promptAcceptAfter = promptChanged ? now + PLAYER_PROMPT_SERVER_ARM_MS : Number(playerSession.promptAcceptAfter || 0);
      playerSession = {
        ...playerSession,
        ...parsed,
        participants: roomChanged || parsed.resetParticipants ? [] : playerSession.participants,
        answers: parsed.resetAnswers || promptChanged ? [] : playerSession.answers,
        actions: parsed.resetAnswers || promptChanged ? [] : playerSession.actions,
        queuedActions: roomChanged || parsed.resetQueuedActions ? [] : playerSession.queuedActions,
        removedNames: roomChanged ? [] : playerSession.removedNames,
        promptPublishedAt,
        promptAcceptAfter,
        revision: Math.max(0, Number(playerSession.revision) || 0) + 1,
        hostRevision: Math.max(currentHostRevision, incomingHostRevision),
        updatedAt: now
      };
      delete playerSession.expectedPromptId;
      delete playerSession.resetParticipants;
      serverTrace("session.published", {
        roomCode: playerSession.roomCode,
        roomChanged: Boolean(roomChanged),
        previousStatus,
        status: playerSession.status,
        previousPromptId,
        promptId: playerSession.prompt?.id || "",
        promptChanged,
        accepting: Boolean(playerSession.prompt?.accepting),
        acceptAfter: Number(playerSession.promptAcceptAfter) || 0,
        resetAnswers: Boolean(parsed.resetAnswers),
        resetParticipants: Boolean(parsed.resetParticipants),
        participants: playerSession.participants.length,
        answers: playerSession.answers.length,
        hostRevision: playerSession.hostRevision,
        revision: playerSession.revision
      });
      return sendJson(res, 200, { ok: true, session: publicPlayerSession() });
    }

    if (url.pathname === "/api/player-sync" && req.method === "GET") {
      armPlayerSessionPromptIfReady();
      const roomCode = String(url.searchParams.get("roomCode") || "").trim().toUpperCase();
      const promptId = String(url.searchParams.get("promptId") || "");
      if (!roomCode || roomCode !== playerSession.roomCode) {
        serverTraceThrottled(`sync-room:${roomCode}:${playerSession.roomCode}`, 5_000, "sync.room_mismatch", {
          requestedRoomCode: roomCode,
          activeRoomCode: playerSession.roomCode,
          requestedPromptId: promptId,
          activePromptId: playerSession.prompt?.id || ""
        });
        return sendJson(res, 409, { ok: false, error: "Session room changed", session: publicPlayerSyncSession() });
      }
      if (promptId && playerSession.prompt?.id && promptId !== playerSession.prompt.id) {
        serverTraceThrottled(`sync-prompt:${promptId}:${playerSession.prompt.id}`, 5_000, "sync.prompt_mismatch", {
          roomCode,
          requestedPromptId: promptId,
          activePromptId: playerSession.prompt.id,
          status: playerSession.status,
          accepting: Boolean(playerSession.prompt.accepting)
        });
      }
      const sinceRevision = Math.max(0, Number(url.searchParams.get("sinceRevision")) || 0);
      if (sinceRevision > 0 && sinceRevision === Math.max(0, Number(playerSession.revision) || 0)) {
        return sendJson(res, 200, {
          ok: true,
          unchanged: true,
          revision: playerSession.revision,
          participants: playerSession.participants
        });
      }
      const answers = playerSession.answers.filter((answer) => !promptId || answer.promptId === promptId);
      const actions = playerSession.actions.filter((action) => !promptId || action.promptId === promptId);
      const queuedActions = playerSession.queuedActions.filter((action) => action.roomCode === roomCode);
      return sendJson(res, 200, {
        ok: true,
        session: publicPlayerSyncSession(),
        promptId,
        answers,
        actions,
        queuedActions,
        participants: playerSession.participants
      });
    }

    if (url.pathname === "/api/player-join" && req.method === "POST") {
      const body = await readBody(req);
      const parsed = body ? JSON.parse(body) : {};
      const roomCode = String(parsed.roomCode || "").trim().toUpperCase();
      const name = sanitizePlayerName(parsed.name);
      const simulated = Boolean(parsed.simulated);
      if (!roomCode || roomCode !== playerSession.roomCode) return sendJson(res, 400, { ok: false, error: "Invalid room code" });
      if (!name) return sendJson(res, 400, { ok: false, error: "Missing player name" });
      if (playerSession.removedNames.includes(name.toLowerCase())) return sendJson(res, 403, { ok: false, error: "This player was removed from the room" });
      const existing = playerSession.participants.find((player) => player.name.toLowerCase() === name.toLowerCase());
      const usedClasses = new Set(playerSession.participants.map((player) => player.classId).filter(Boolean));
      const simulatedClassId = simulated ? PLAYER_CLASS_IDS.find((classId) => !usedClasses.has(classId)) || "" : "";
      const participant = existing || { id: `player-${Date.now()}-${Math.random().toString(16).slice(2)}`, name, classId: simulatedClassId, joinedAt: Date.now(), lastSeenAt: Date.now(), lastActionAt: 0, simulated };
      if (existing && !Number.isFinite(Number(existing.lastActionAt))) existing.lastActionAt = 0;
      if (existing && simulated) existing.simulated = true;
      participant.lastSeenAt = Date.now();
      if (!existing) playerSession.participants.push(participant);
      touchPlayerSession();
      serverTrace(existing ? "player.rejoined" : "player.joined", {
        roomCode,
        playerId: participant.id,
        playerName: participant.name,
        simulated: Boolean(participant.simulated),
        reconnect: Boolean(parsed.reconnect),
        classId: participant.classId || "",
        participants: playerSession.participants.length
      });
      return sendJson(res, 200, { ok: true, participant, session: publicPlayerSession() });
    }

    if (url.pathname === "/api/player-class" && req.method === "POST") {
      const body = await readBody(req);
      const parsed = body ? JSON.parse(body) : {};
      const roomCode = String(parsed.roomCode || "").trim().toUpperCase();
      const playerId = String(parsed.playerId || "").trim();
      const classId = String(parsed.classId || "").trim().toLowerCase();
      if (!roomCode || roomCode !== playerSession.roomCode) return sendJson(res, 400, { ok: false, error: "Invalid room code" });
      if (playerSession.status !== "lobby") return sendJson(res, 409, { ok: false, error: "Class selection is closed" });
      if (!PLAYER_CLASS_IDS.includes(classId)) return sendJson(res, 400, { ok: false, error: "Invalid class" });
      const participant = playerSession.participants.find((player) => player.id === playerId);
      if (!participant) return sendJson(res, 404, { ok: false, error: "Player not found" });
      const reserved = playerSession.participants.find((player) => player.id !== playerId && player.classId === classId);
      if (reserved) return sendJson(res, 409, { ok: false, error: `${classId} is already reserved` });
      participant.classId = classId;
      touchPlayerSession();
      serverTrace("player.class_selected", {
        roomCode,
        playerId,
        playerName: participant.name,
        classId
      });
      return sendJson(res, 200, { ok: true, participant, session: publicPlayerSession() });
    }

    if (url.pathname === "/api/player-remove" && req.method === "POST") {
      const body = await readBody(req);
      const parsed = body ? JSON.parse(body) : {};
      const roomCode = String(parsed.roomCode || "").trim().toUpperCase();
      const playerId = String(parsed.playerId || "").trim();
      const name = sanitizeText(parsed.name, { maxLength: 32 }).toLowerCase();
      if (!roomCode || roomCode !== playerSession.roomCode) return sendJson(res, 400, { ok: false, error: "Invalid room code" });
      const before = playerSession.participants.length;
      playerSession.participants = playerSession.participants.filter((player) => {
        if (playerId && player.id === playerId) return false;
        if (!playerId && name && player.name.toLowerCase() === name) return false;
        return true;
      });
      if (name && !playerSession.removedNames.includes(name)) playerSession.removedNames.push(name);
      playerSession.answers = playerSession.answers.filter((answer) => {
        if (playerId && answer.playerId === playerId) return false;
        if (!playerId && name && String(answer.playerName || "").toLowerCase() === name) return false;
        return true;
      });
      playerSession.actions = playerSession.actions.filter((action) => {
        if (playerId && action.playerId === playerId) return false;
        if (!playerId && name && String(action.playerName || "").toLowerCase() === name) return false;
        return true;
      });
      playerSession.queuedActions = playerSession.queuedActions.filter((action) => {
        if (playerId && action.playerId === playerId) return false;
        if (!playerId && name && String(action.playerName || "").toLowerCase() === name) return false;
        return true;
      });
      playerSession.players = playerSession.players.filter((player) => {
        if (!name) return true;
        return String(player || "").toLowerCase() !== name;
      });
      touchPlayerSession();
      serverTrace("player.removed", {
        roomCode,
        requestedPlayerId: playerId,
        requestedName: name,
        removed: before !== playerSession.participants.length,
        participants: playerSession.participants.length
      }, before !== playerSession.participants.length ? "info" : "warn");
      return sendJson(res, 200, { ok: true, removed: before !== playerSession.participants.length, session: publicPlayerSession() });
    }

    if (url.pathname === "/api/player-answers" && req.method === "GET") {
      const roomCode = String(url.searchParams.get("roomCode") || "").trim().toUpperCase();
      const promptId = String(url.searchParams.get("promptId") || "");
      const answers = playerSession.answers.filter((answer) => {
        return (!roomCode || answer.roomCode === roomCode) && (!promptId || answer.promptId === promptId);
      });
      const actions = playerSession.actions.filter((action) => {
        return (!roomCode || action.roomCode === roomCode) && (!promptId || action.promptId === promptId);
      });
      const queuedActions = playerSession.queuedActions.filter((action) => !roomCode || action.roomCode === roomCode);
      return sendJson(res, 200, { ok: true, roomCode, promptId, answers, actions, queuedActions, participants: playerSession.participants });
    }

    if (url.pathname === "/api/player-answer" && req.method === "POST") {
      const body = await readBody(req);
      const parsed = body ? JSON.parse(body) : {};
      const roomCode = String(parsed.roomCode || "").trim().toUpperCase();
      const promptId = String(parsed.promptId || "");
      const answer = sanitizeText(parsed.answer, { maxLength: 180 });
      const playerId = String(parsed.playerId || "").trim();
      const postedPlayerName = sanitizePlayerName(parsed.playerName);
      if (!roomCode || roomCode !== playerSession.roomCode) return sendJson(res, 400, { ok: false, error: "Invalid room code" });
      if (!promptId || promptId !== playerSession.prompt?.id) return sendJson(res, 400, { ok: false, error: "Prompt is no longer active" });
      if (playerSession.status !== "open" || !playerSession.prompt?.accepting) return sendJson(res, 409, { ok: false, error: "Prompt is not accepting answers" });
      if (Date.now() < Number(playerSession.promptAcceptAfter || 0)) return sendJson(res, 409, { ok: false, error: "Prompt is still locking in" });
      if (playerSession.prompt?.actionOnly) return sendJson(res, 409, { ok: false, error: "This prompt only accepts actions" });
      if (!answer) return sendJson(res, 400, { ok: false, error: "Missing answer" });
      const participant = playerSession.participants.find((player) => player.id === playerId);
      if (!participant) return sendJson(res, 403, { ok: false, error: "Player is not in this room" });
      participant.lastSeenAt = Date.now();
      const playerName = participant.name || postedPlayerName;
      if (isSessionPlayerIncapacitated(playerName)) return sendJson(res, 403, { ok: false, error: "Incapacitated players cannot answer" });
      const priorIndex = playerSession.answers.findIndex((entry) => entry.promptId === promptId && entry.playerId === playerId);
      const entry = {
        id: `player-answer-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        roomCode,
        promptId,
        answer,
        playerId,
        playerName,
        submittedAt: Date.now(),
        acceptedAt: Date.now(),
        clientSentAt: Number(parsed.clientSentAt) || null
      };
      if (priorIndex >= 0) playerSession.answers[priorIndex] = entry;
      else playerSession.answers.push(entry);
      touchPlayerSession();
      serverTrace("answer.accepted", {
        roomCode,
        promptId,
        playerId,
        playerName,
        replacedPrior: priorIndex >= 0,
        clientToServerMs: entry.clientSentAt ? Math.max(0, entry.acceptedAt - entry.clientSentAt) : null,
        answerCount: playerSession.answers.filter((answerEntry) => answerEntry.promptId === promptId).length
      });
      return sendJson(res, 200, { ok: true, answer: entry });
    }

    if (url.pathname === "/api/player-action" && req.method === "POST") {
      const body = await readBody(req);
      const parsed = body ? JSON.parse(body) : {};
      const roomCode = String(parsed.roomCode || "").trim().toUpperCase();
      const promptId = String(parsed.promptId || "");
      const action = sanitizeText(parsed.action, { maxLength: 180 });
      const playerId = String(parsed.playerId || "").trim();
      const postedPlayerName = sanitizePlayerName(parsed.playerName);
      const queued = Boolean(parsed.queued);
      const isAbilityAction = !queued && /^(?:ABILITY|CLASS):/i.test(action);
      if (!roomCode || roomCode !== playerSession.roomCode) return sendJson(res, 400, { ok: false, error: "Invalid room code" });
      if (queued) {
        if (!playerSession.allowQueuedPlayerActions) return sendJson(res, 409, { ok: false, error: "Action queue is not available yet" });
      } else {
        if (!promptId || promptId !== playerSession.prompt?.id) return sendJson(res, 400, { ok: false, error: "Prompt is no longer active" });
        if (playerSession.status !== "open" || !playerSession.prompt?.accepting) return sendJson(res, 409, { ok: false, error: "Prompt is not accepting actions" });
        if (Date.now() < Number(playerSession.promptAcceptAfter || 0)) return sendJson(res, 409, { ok: false, error: "Prompt is still locking in" });
        if (!playerSession.prompt?.allowPlayerActions && !playerSession.prompt?.actionOnly) return sendJson(res, 409, { ok: false, error: "This prompt is not accepting actions" });
      }
      if (!action) return sendJson(res, 400, { ok: false, error: "Missing action" });
      const participant = playerSession.participants.find((player) => player.id === playerId);
      if (!participant) return sendJson(res, 403, { ok: false, error: "Player is not in this room" });
      participant.lastSeenAt = Date.now();
      const playerName = participant.name || postedPlayerName;
      if (isSessionPlayerIncapacitated(playerName)) return sendJson(res, 403, { ok: false, error: "Incapacitated players cannot act" });
      const now = Date.now();
      const configuredCooldownMs = Number(playerSession.actionCooldownMs);
      const cooldownMs = isAbilityAction
        ? 0
        : Number.isFinite(configuredCooldownMs) ? Math.max(0, configuredCooldownMs) : DEFAULT_PLAYER_ACTION_COOLDOWN_MS;
      const lastActionAt = Number(participant.lastActionAt) || 0;
      const cooldownRemainingMs = Math.max(0, cooldownMs - (now - lastActionAt));
      if (!isAbilityAction && cooldownRemainingMs > 0) {
        return sendJson(res, 429, {
          ok: false,
          error: `Action cooldown active for ${Math.ceil(cooldownRemainingMs / 1000)} more seconds`,
          cooldownRemainingMs,
          cooldownUntil: lastActionAt + cooldownMs
        });
      }
      const priorIndex = playerSession.actions.findIndex((entry) => entry.promptId === promptId && entry.playerId === playerId);
      if (!queued && !isAbilityAction && priorIndex >= 0 && !playerSession.prompt?.actionOnly) return sendJson(res, 409, { ok: false, error: "Action already submitted for this turn" });
      if (queued && playerSession.queuedActions.some((entry) => entry.playerId === playerId)) {
        return sendJson(res, 409, { ok: false, error: "You already have an action queued" });
      }
      const entry = {
        id: `player-action-${now}-${Math.random().toString(16).slice(2)}`,
        roomCode,
        promptId: promptId || playerSession.prompt?.id || "",
        action,
        playerId,
        playerName,
        submittedAt: now,
        queued
      };
      if (queued) playerSession.queuedActions.push(entry);
      else playerSession.actions.push(entry);
      if (!isAbilityAction) participant.lastActionAt = now;
      touchPlayerSession();
      serverTrace(queued ? "action.queued" : "action.accepted", {
        roomCode,
        promptId: entry.promptId,
        playerId,
        playerName,
        queued,
        ability: isAbilityAction,
        actionCount: queued ? playerSession.queuedActions.length : playerSession.actions.filter((actionEntry) => actionEntry.promptId === entry.promptId).length,
        cooldownMs
      });
      return sendJson(res, 200, { ok: true, action: entry, cooldownUntil: now + cooldownMs, cooldownMs });
    }

    if (url.pathname === "/api/player-action-consume" && req.method === "POST") {
      const body = await readBody(req);
      const parsed = body ? JSON.parse(body) : {};
      const roomCode = String(parsed.roomCode || "").trim().toUpperCase();
      const actionId = String(parsed.actionId || "").trim();
      if (!roomCode || roomCode !== playerSession.roomCode) return sendJson(res, 400, { ok: false, error: "Invalid room code" });
      const before = playerSession.queuedActions.length;
      playerSession.queuedActions = playerSession.queuedActions.filter((entry) => entry.id !== actionId);
      touchPlayerSession();
      serverTrace("action.consumed", {
        roomCode,
        actionId,
        consumed: before !== playerSession.queuedActions.length,
        remainingQueuedActions: playerSession.queuedActions.length
      });
      return sendJson(res, 200, { ok: true, consumed: before !== playerSession.queuedActions.length });
    }

    if (url.pathname === "/api/ollama/tags" && req.method === "GET") {
      const response = await fetchWithTimeout(`${ollamaHost}/api/tags`, {}, STATUS_REQUEST_TIMEOUT_MS);
      const body = await response.text();
      if (!response.ok) throw new Error(body || `Ollama returned ${response.status}`);
      return sendJson(res, 200, JSON.parse(body));
    }

    if (url.pathname === "/api/lmstudio/tags" && req.method === "GET") {
      const response = await fetchWithTimeout(`${lmStudioHost}/api/v0/models`, {}, STATUS_REQUEST_TIMEOUT_MS);
      const body = await response.text();
      if (!response.ok) throw new Error(body || `LM Studio returned ${response.status}`);
      const parsed = JSON.parse(body);
      const models = Array.isArray(parsed.data)
        ? parsed.data.map((model) => ({ ...model, name: model.id || model.name || model.model })).filter((model) => model.name)
        : [];
      return sendJson(res, 200, { ...parsed, models });
    }

    if (url.pathname === "/api/lmstudio/load" && req.method === "POST") {
      const body = await readBody(req);
      const parsed = body ? JSON.parse(body) : {};
      if (!parsed.model) return sendJson(res, 400, { ok: false, error: "Missing model" });
      const result = await loadLmStudioModel(parsed.model);
      return sendJson(res, 200, {
        ok: true,
        model: result.model,
        status: result.status || "loaded",
        type: result.type || null,
        instanceId: result.instance_id || null,
        loadTimeSeconds: result.load_time_seconds || null,
        serverDurationMs: result.server_duration_ms || null,
        result
      });
    }

    if (url.pathname === "/api/ollama/generate" && req.method === "POST") {
      const body = await readBody(req);
      const parsed = body ? JSON.parse(body) : {};
      if (!parsed.prompt) return sendJson(res, 400, { ok: false, error: "Missing prompt" });
      const result = await callOllama(parsed);
      return sendJson(res, 200, {
        ok: true,
        model: result.model,
        response: stripReasoningText(result.response || ""),
        totalDuration: result.total_duration || null,
        serverDurationMs: result.server_duration_ms || null,
        numPredict: result.num_predict || null
      });
    }

    if (url.pathname === "/api/lmstudio/generate" && req.method === "POST") {
      const body = await readBody(req);
      const parsed = body ? JSON.parse(body) : {};
      if (!parsed.prompt) return sendJson(res, 400, { ok: false, error: "Missing prompt" });
      const result = await callLmStudio(parsed);
      return sendJson(res, 200, {
        ok: true,
        model: result.model,
        response: stripReasoningText(result.response || ""),
        totalDuration: result.total_duration || null,
        serverDurationMs: result.server_duration_ms || null,
        numPredict: result.num_predict || null
      });
    }

    if (url.pathname === "/api/tts/status" && req.method === "GET") {
      const requestedProvider = url.searchParams.get("provider");
      const provider = ["kokoro", "elevenlabs"].includes(requestedProvider) ? requestedProvider : "piper";
      const status = provider === "kokoro" ? kokoroStatus() : provider === "elevenlabs" ? elevenLabsStatus() : piperStatus();
      return sendJson(res, 200, { ok: true, provider, ...status });
    }

    if (url.pathname === "/api/tts/voices" && req.method === "GET") {
      if (url.searchParams.get("provider") !== "elevenlabs") return sendJson(res, 400, { ok: false, error: "Unsupported voice provider" });
      const voices = await fetchElevenLabsVoices();
      return sendJson(res, 200, { ok: true, provider: "elevenlabs", voices });
    }

    if (url.pathname === "/api/tts/preview" && req.method === "GET") {
      const voiceId = sanitizeText(url.searchParams.get("voiceId"), { maxLength: 100 });
      if (!voiceId) return sendJson(res, 400, { ok: false, error: "Voice is required" });
      if (!elevenLabsVoicePreviews.size) await fetchElevenLabsVoices();
      const previewUrl = elevenLabsVoicePreviews.get(voiceId);
      if (!previewUrl) return sendJson(res, 404, { ok: false, error: "Voice preview unavailable" });
      const preview = await fetch(previewUrl, { signal: AbortSignal.timeout(STATUS_REQUEST_TIMEOUT_MS) });
      if (!preview.ok) return sendJson(res, 502, { ok: false, error: `Voice preview failed with HTTP ${preview.status}` });
      const audio = Buffer.from(await preview.arrayBuffer());
      const upstreamContentType = preview.headers.get("content-type") || "";
      res.writeHead(200, {
        "Content-Type": upstreamContentType.startsWith("audio/") ? upstreamContentType : "audio/mpeg",
        "Content-Length": audio.length,
        "Cache-Control": "public, max-age=86400"
      });
      res.end(audio);
      return;
    }

    if (url.pathname === "/api/tts/session" && req.method === "POST") {
      const body = await readBody(req);
      const parsed = body ? JSON.parse(body) : {};
      if (parsed.provider !== "elevenlabs") return sendJson(res, 400, { ok: false, error: "Unsupported streaming provider" });
      if (!elevenLabsApiKey) return sendJson(res, 503, { ok: false, error: "ElevenLabs API key is not configured" });
      const text = sanitizeText(parsed.text, { maxLength: 2500 });
      const voiceId = sanitizeText(parsed.voiceId, { maxLength: 100 });
      if (!text || !voiceId) return sendJson(res, 400, { ok: false, error: "Text and voice are required" });
      const token = crypto.randomUUID();
      elevenLabsSpeechSessions.set(token, { text, voiceId, rate: parsed.rate, createdAt: Date.now() });
      const expiry = setTimeout(() => elevenLabsSpeechSessions.delete(token), 60_000);
      expiry.unref?.();
      return sendJson(res, 200, { ok: true, streamUrl: `/api/tts/stream/${token}` });
    }

    if (url.pathname.startsWith("/api/tts/stream/") && req.method === "GET") {
      const token = url.pathname.slice("/api/tts/stream/".length);
      const session = elevenLabsSpeechSessions.get(token);
      elevenLabsSpeechSessions.delete(token);
      if (!session) return sendJson(res, 404, { ok: false, error: "Speech stream expired" });
      await pipeElevenLabsSpeech(res, session);
      return;
    }

    if (url.pathname === "/api/tts/speak" && req.method === "POST") {
      const body = await readBody(req);
      const parsed = body ? JSON.parse(body) : {};
      const text = sanitizeText(parsed.text, { maxLength: 2500 });
      if (!text) return sendJson(res, 400, { ok: false, error: "Missing text" });
      const provider = ["kokoro", "elevenlabs"].includes(parsed.provider) ? parsed.provider : "piper";
      const ttsStartedAt = Date.now();
      serverTrace("tts.started", {
        provider,
        textChars: text.length,
        rate: Number(parsed.rate) || 1,
        voiceId: parsed.voiceId ?? null
      });
      if (provider === "elevenlabs") {
        await pipeElevenLabsSpeech(res, { text, rate: parsed.rate, voiceId: parsed.voiceId });
        return;
      }
      const audio = provider === "kokoro"
        ? await generateKokoroSpeech(text, { rate: parsed.rate, voiceId: parsed.voiceId })
        : await generatePiperSpeech(text, { rate: parsed.rate });
      serverTrace("tts.completed", {
        provider,
        durationMs: Date.now() - ttsStartedAt,
        textChars: text.length,
        audioBytes: audio.length
      });
      res.writeHead(200, {
        "content-type": "audio/wav",
        "cache-control": "no-store",
        "content-length": audio.length
      });
      return res.end(audio);
    }

    if (url.pathname === "/api/health") {
      return sendJson(res, 200, { ok: true });
    }

    const filePath = staticPath(url.pathname);
    if (!filePath || !fs.existsSync(filePath)) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      return res.end("Not found");
    }

    const fileStats = fs.statSync(filePath);
    if (fileStats.isDirectory()) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      return res.end("Not found");
    }
    const ext = path.extname(filePath).toLowerCase();
    const fileSize = fileStats.size;
    const streamableMedia = streamableMediaExtensions.has(ext);
    const etag = staticFileEtag(fileStats);
    const commonHeaders = {
      "content-type": contentTypes[ext] || "application/octet-stream",
      // Large audio tracks should not be revalidated and downloaded again on
      // every combat-room transition. Versioned filenames still invalidate
      // naturally when an asset is replaced.
      "cache-control": streamableMedia ? "public, max-age=86400" : "no-cache",
      "etag": etag,
      "last-modified": fileStats.mtime.toUTCString()
    };
    if (streamableMedia) commonHeaders["accept-ranges"] = "bytes";

    const requestedRange = streamableMedia && req.headers.range
      ? parseByteRange(req.headers.range, fileSize)
      : null;
    if (!requestedRange && (req.method === "GET" || req.method === "HEAD") && staticRequestIsFresh(req, etag, fileStats.mtimeMs)) {
      res.writeHead(304, commonHeaders);
      return res.end();
    }
    if (requestedRange?.invalid) {
      res.writeHead(416, {
        ...commonHeaders,
        "content-range": `bytes */${fileSize}`,
        "content-length": 0
      });
      return res.end();
    }

    if (requestedRange) {
      const chunkLength = requestedRange.end - requestedRange.start + 1;
      res.writeHead(206, {
        ...commonHeaders,
        "content-range": `bytes ${requestedRange.start}-${requestedRange.end}/${fileSize}`,
        "content-length": chunkLength
      });
      if (req.method === "HEAD") return res.end();
      return fs.createReadStream(filePath, {
        start: requestedRange.start,
        end: requestedRange.end
      }).pipe(res);
    }

    const acceptsGzip = /(?:^|,)\s*gzip\s*(?:;|,|$)/i.test(String(req.headers["accept-encoding"] || ""));
    const useGzip = !streamableMedia && compressibleStaticExtensions.has(ext) && acceptsGzip;
    const responseHeaders = useGzip
      ? { ...commonHeaders, "content-encoding": "gzip", "vary": "Accept-Encoding" }
      : { ...commonHeaders, "content-length": fileSize };
    res.writeHead(200, responseHeaders);
    if (req.method === "HEAD") return res.end();
    const fileStream = fs.createReadStream(filePath);
    if (useGzip) return fileStream.pipe(zlib.createGzip({ level: 6 })).pipe(res);
    return fileStream.pipe(res);
  } catch (error) {
    serverTrace("request.failed", {
      requestId: res._traceRequestId || "",
      method: req.method || "",
      path: res._tracePath || req.url || "",
      message: String(error?.message || error || "Unknown server error").slice(0, 1000),
      stack: String(error?.stack || "").split(/\r?\n/).slice(0, 8).join("\n"),
      ...sessionTraceSummary()
    }, "error");
    sendJson(res, 500, { ok: false, error: error.message });
  }
});

server.on("clientError", (error, socket) => {
  const code = String(error?.code || "");
  serverTraceThrottled(`client-error:${code}`, 5_000, "http.client_error", {
    code,
    message: String(error?.message || error || "Client connection error").slice(0, 500)
  }, code === "ECONNRESET" ? "info" : "warn");
  if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
});

process.on("uncaughtExceptionMonitor", (error, origin) => {
  serverTrace("process.uncaught_exception", {
    origin,
    message: String(error?.message || error || "Uncaught exception").slice(0, 1000),
    stack: String(error?.stack || "").split(/\r?\n/).slice(0, 12).join("\n")
  }, "error");
});

process.on("unhandledRejection", (reason) => {
  serverTrace("process.unhandled_rejection", {
    message: String(reason?.message || reason || "Unhandled rejection").slice(0, 1000),
    stack: String(reason?.stack || "").split(/\r?\n/).slice(0, 12).join("\n")
  }, "error");
});

server.listen(port, () => {
  serverTrace("server.started", {
    port,
    root,
    logPath: serverLogPath,
    ollamaHost,
    lmStudioHost
  });
  console.log(`Mission console server running at http://localhost:${port}/`);
});
