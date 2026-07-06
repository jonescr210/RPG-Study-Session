const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");
const sharedData = require("./shared-data.js");

const root = __dirname;
const port = Number(process.env.PORT || 4174);
const feedPath = path.join(root, "dm-feed.json");
const answerPath = path.join(root, "dm-answer.json");
const questionSetsPath = path.join(root, "question-sets.json");
const ollamaHost = process.env.OLLAMA_HOST || "http://localhost:11434";
const lmStudioHost = process.env.LM_STUDIO_HOST || "http://127.0.0.1:1234";
const DEFAULT_PLAYER_ACTION_COOLDOWN_MS = 120_000;
const PLAYER_PROMPT_SERVER_ARM_MS = 2_000;
const defaultPiperExePath = path.join(root, "tts", "piper", process.platform === "win32" ? "piper.exe" : "piper");
const defaultPiperModelPath = path.join(root, "tts", "voices", "en_GB-northern_english_male-medium.onnx");
const piperExePath = process.env.PIPER_EXE || defaultPiperExePath;
const piperModelPath = process.env.PIPER_MODEL || defaultPiperModelPath;
const piperConfigPath = process.env.PIPER_CONFIG || `${piperModelPath}.json`;
const piperCachePath = path.join(root, ".tts-cache");

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
  ".wav": "audio/wav"
};

let currentFeed = readFeed();
let currentAnswer = readAnswer();
let questionSetStore = readQuestionSetStore();
let playerSession = {
  roomCode: "",
  status: "setup",
  title: "",
  players: [],
  prompt: null,
  participants: [],
  answers: [],
  actions: [],
  removedNames: [],
  actionCooldownMs: DEFAULT_PLAYER_ACTION_COOLDOWN_MS,
  promptPublishedAt: 0,
  promptAcceptAfter: 0,
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

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body)
  });
  res.end(body);
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

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 5_000_000) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
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
  const options = {
    temperature: Number.isFinite(Number(payload.temperature)) ? Number(payload.temperature) : 0.75
  };
  if (numPredict) options.num_predict = numPredict;
  const response = await fetch(`${ollamaHost}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: payload.model || "llama3.2:3b",
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
  return result;
}

async function callLmStudio(payload) {
  const requestedPredict = Number(payload.maxTokens ?? payload.numPredict ?? payload.num_predict);
  const numPredict = Number.isFinite(requestedPredict) && requestedPredict > 0
    ? Math.floor(requestedPredict)
    : null;
  const startedAt = Date.now();
  const model = payload.model || "google/gemma-4-e4b";
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
  const response = await fetch(`${lmStudioHost}/v1/chat/completions`, {
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
  return {
    model: result.model || payload.model || "google/gemma-4-e4b",
    response: cleaned,
    total_duration: null,
    server_duration_ms: Date.now() - startedAt,
    num_predict: numPredict,
    stats: result.usage || null
  };
}

async function loadLmStudioModel(model) {
  const requestedModel = String(model || "").trim();
  if (!requestedModel) throw new Error("Missing model");
  const startedAt = Date.now();
  const response = await fetch(`${lmStudioHost}/api/v1/models/load`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: requestedModel,
      echo_load_config: true
    })
  });
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
        const audio = fs.readFileSync(outputPath);
        fs.unlink(outputPath, () => {});
        resolve(audio);
      } catch (error) {
        reject(error);
      }
    });
    child.stdin.end(`${text.trim()}\n`);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

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

    if (url.pathname === "/api/player-session" && req.method === "GET") {
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
      const nextPromptId = parsed.prompt?.id || "";
      const roomChanged = parsed.roomCode && parsed.roomCode !== playerSession.roomCode;
      const now = Date.now();
      const promptChanged = Boolean(nextPromptId && nextPromptId !== previousPromptId);
      const promptPublishedAt = promptChanged ? now : Number(playerSession.promptPublishedAt || 0);
      const promptAcceptAfter = promptChanged ? now + PLAYER_PROMPT_SERVER_ARM_MS : Number(playerSession.promptAcceptAfter || 0);
      playerSession = {
        ...playerSession,
        ...parsed,
        participants: roomChanged ? [] : playerSession.participants,
        answers: parsed.resetAnswers || promptChanged ? [] : playerSession.answers,
        actions: parsed.resetAnswers || promptChanged ? [] : playerSession.actions,
        removedNames: roomChanged ? [] : playerSession.removedNames,
        promptPublishedAt,
        promptAcceptAfter,
        updatedAt: now
      };
      return sendJson(res, 200, { ok: true, session: publicPlayerSession() });
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
      const participant = existing || { id: `player-${Date.now()}-${Math.random().toString(16).slice(2)}`, name, joinedAt: Date.now(), lastActionAt: 0, simulated };
      if (existing && !Number.isFinite(Number(existing.lastActionAt))) existing.lastActionAt = 0;
      if (existing && simulated) existing.simulated = true;
      if (!existing) playerSession.participants.push(participant);
      playerSession.updatedAt = Date.now();
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
      playerSession.players = playerSession.players.filter((player) => {
        if (!name) return true;
        return String(player || "").toLowerCase() !== name;
      });
      playerSession.updatedAt = Date.now();
      return sendJson(res, 200, { ok: true, removed: before !== playerSession.participants.length, session: playerSession });
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
      return sendJson(res, 200, { ok: true, roomCode, promptId, answers, actions, participants: playerSession.participants });
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
      const playerName = participant.name || postedPlayerName;
      if (playerSession.prompt?.lockedPlayer && normalize(playerSession.prompt.lockedPlayer) !== normalize(playerName)) {
        return sendJson(res, 403, { ok: false, error: "Only the locked operator can answer this prompt" });
      }
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
      playerSession.updatedAt = Date.now();
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
      if (!roomCode || roomCode !== playerSession.roomCode) return sendJson(res, 400, { ok: false, error: "Invalid room code" });
      if (!promptId || promptId !== playerSession.prompt?.id) return sendJson(res, 400, { ok: false, error: "Prompt is no longer active" });
      if (playerSession.status !== "open" || !playerSession.prompt?.accepting) return sendJson(res, 409, { ok: false, error: "Prompt is not accepting actions" });
      if (Date.now() < Number(playerSession.promptAcceptAfter || 0)) return sendJson(res, 409, { ok: false, error: "Prompt is still locking in" });
      if (!playerSession.prompt?.allowPlayerActions && !playerSession.prompt?.actionOnly) return sendJson(res, 409, { ok: false, error: "This prompt is not accepting actions" });
      if (!action) return sendJson(res, 400, { ok: false, error: "Missing action" });
      const participant = playerSession.participants.find((player) => player.id === playerId);
      if (!participant) return sendJson(res, 403, { ok: false, error: "Player is not in this room" });
      const playerName = participant.name || postedPlayerName;
      if (isSessionPlayerIncapacitated(playerName)) return sendJson(res, 403, { ok: false, error: "Incapacitated players cannot act" });
      const now = Date.now();
      const configuredCooldownMs = Number(playerSession.actionCooldownMs);
      const cooldownMs = Number.isFinite(configuredCooldownMs) ? Math.max(0, configuredCooldownMs) : DEFAULT_PLAYER_ACTION_COOLDOWN_MS;
      const lastActionAt = Number(participant.lastActionAt) || 0;
      const cooldownRemainingMs = Math.max(0, cooldownMs - (now - lastActionAt));
      if (cooldownRemainingMs > 0) {
        return sendJson(res, 429, {
          ok: false,
          error: `Action cooldown active for ${Math.ceil(cooldownRemainingMs / 1000)} more seconds`,
          cooldownRemainingMs,
          cooldownUntil: lastActionAt + cooldownMs
        });
      }
      const priorIndex = playerSession.actions.findIndex((entry) => entry.promptId === promptId && entry.playerId === playerId);
      if (priorIndex >= 0 && !playerSession.prompt?.actionOnly) return sendJson(res, 409, { ok: false, error: "Action already submitted for this turn" });
      const entry = {
        id: `player-action-${now}-${Math.random().toString(16).slice(2)}`,
        roomCode,
        promptId,
        action,
        playerId,
        playerName,
        submittedAt: now
      };
      playerSession.actions.push(entry);
      participant.lastActionAt = now;
      playerSession.updatedAt = Date.now();
      return sendJson(res, 200, { ok: true, action: entry, cooldownUntil: now + cooldownMs, cooldownMs });
    }

    if (url.pathname === "/api/ollama/tags" && req.method === "GET") {
      const response = await fetch(`${ollamaHost}/api/tags`);
      const body = await response.text();
      if (!response.ok) throw new Error(body || `Ollama returned ${response.status}`);
      return sendJson(res, 200, JSON.parse(body));
    }

    if (url.pathname === "/api/lmstudio/tags" && req.method === "GET") {
      const response = await fetch(`${lmStudioHost}/api/v0/models`);
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
      return sendJson(res, 200, { ok: true, provider: "piper", ...piperStatus() });
    }

    if (url.pathname === "/api/tts/speak" && req.method === "POST") {
      const body = await readBody(req);
      const parsed = body ? JSON.parse(body) : {};
      const text = sanitizeText(parsed.text, { maxLength: 2500 });
      if (!text) return sendJson(res, 400, { ok: false, error: "Missing text" });
      const audio = await generatePiperSpeech(text, { rate: parsed.rate });
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
    if (!filePath || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      return res.end("Not found");
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "content-type": contentTypes[ext] || "application/octet-stream",
      "cache-control": "no-store"
    });
    fs.createReadStream(filePath).pipe(res);
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error.message });
  }
});

server.listen(port, () => {
  console.log(`Mission console server running at http://localhost:${port}/`);
});
