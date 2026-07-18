const sharedData = window.StudyAdventureShared || {};
const dmPrompts = window.StudyAdventurePrompts || {};
const actionRooms = window.StudyAdventureActionRooms || {};
const combatSystem = window.StudyAdventureCombat || {};
const singleDeviceClassAssignments = new Map();
const ttsModule = window.StudyAdventureTts || {};
const DEFAULT_NETWORK_TIMEOUT_MS = 8_000;
const LOCAL_DM_REQUEST_TIMEOUT_MS = 65_000;
// Presentation-only animation state should never hold mission progression for
// an extended period. Boss video playback has its own longer watchdog.
const COMBAT_GATE_MAX_WAIT_MS = 12_000;
const ROOM_TRANSITION_TRACE_HEARTBEAT_MS = 1_000;
const ROOM_TRANSITION_TRACE_TIMEOUT_MS = 45_000;
const ROOM_TRANSITION_MAIN_THREAD_GAP_MS = 350;
// Temporary isolation switch: prevents music, SFX, and narration audio from
// fetching, buffering, decoding, or playing while room-transition hangs are tested.
const DISABLE_AUDIO_LOADING_FOR_TRANSITION_DIAGNOSTICS = false;
// Keep boss combat responsive while the optional multi-phase narration plan is disabled.
const ENABLE_BOSS_PHASE_PLAN_GENERATION = false;
// Room-to-room narration already has deterministic fallbacks. Keeping this
// off prevents local model latency from blocking route and combat transitions.
const ENABLE_TRANSITION_NARRATION_GENERATION = false;
const PLAYER_HEARTBEAT_STALE_MS = 15_000;
const PLAYER_PROMPT_PUBLICATION_RETRY_MS = 1_500;
const PLAYER_PROMPT_PUBLICATION_MAX_RETRIES = 5;

function fetchWithTimeout(resource, options = {}, timeoutMs = DEFAULT_NETWORK_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), Math.max(1, Number(timeoutMs) || DEFAULT_NETWORK_TIMEOUT_MS));
  return fetch(resource, { ...options, signal: controller.signal })
    .finally(() => window.clearTimeout(timer));
}

const playerSessionApi = {
  fetchHostInfo: () => fetchWithTimeout("/api/host-info", { cache: "no-store" }).then((response) => response.ok ? response.json() : null),
  publishSession: (payload) => fetchWithTimeout("/api/player-session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  }).catch(() => null),
  fetchSession: () => fetchWithTimeout(`/api/player-session?ts=${Date.now()}`, { cache: "no-store" }).then((response) => response.ok ? response.json() : null),
  fetchAnswers: (roomCode, promptId) => fetchWithTimeout(`/api/player-answers?roomCode=${encodeURIComponent(roomCode)}&promptId=${encodeURIComponent(promptId || "")}&ts=${Date.now()}`, { cache: "no-store" }).then((response) => response.ok ? response.json() : null),
  joinPlayer: (roomCode, name, options = {}) => fetchWithTimeout("/api/player-join", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ roomCode, name, simulated: Boolean(options.simulated) })
  }).then((response) => response.json()).catch(() => null),
  submitAnswer: (payload) => fetchWithTimeout("/api/player-answer", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  }).then((response) => response.json()).catch(() => null),
  submitAction: (payload) => fetchWithTimeout("/api/player-action", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  }).then((response) => response.json()).catch(() => null),
  consumeQueuedAction: (payload) => fetchWithTimeout("/api/player-action-consume", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  }).then((response) => response.json()).catch(() => null),
  ...(window.StudyAdventurePlayerSession || {})
};

const DASHBOARD_OPTIONAL_SRC = "dashboard-optional.js?v=performance-1";
let dashboardOptionalPromise = null;

function loadDashboardOptional() {
  if (window.StudyAdventureDashboardOptional) return Promise.resolve(window.StudyAdventureDashboardOptional);
  if (dashboardOptionalPromise) return dashboardOptionalPromise;
  dashboardOptionalPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = DASHBOARD_OPTIONAL_SRC;
    script.async = true;
    script.addEventListener("load", () => resolve(window.StudyAdventureDashboardOptional || null), { once: true });
    script.addEventListener("error", () => {
      dashboardOptionalPromise = null;
      reject(new Error("Optional dashboard tools could not be loaded."));
    }, { once: true });
    document.head.appendChild(script);
  });
  return dashboardOptionalPromise;
}

function invokeDashboardOptional(method, args = []) {
  return loadDashboardOptional()
    .then((module) => typeof module?.[method] === "function" ? module[method](...args) : undefined)
    .catch((error) => {
      console.warn(error?.message || error);
    });
}

function renderSimulatorPanel() {
  if (!els.simulatorPanel) return;
  const hasSimPlayers = simulatedParticipants().length > 0;
  if (!hasSimPlayers) {
    els.simulatorPanel.hidden = true;
    els.simulatorPanel.innerHTML = "";
    return;
  }
  invokeDashboardOptional("renderSimulatorPanel");
}

function renderItemRewardChoice() {
  invokeDashboardOptional("renderItemRewardChoice");
}

function openItemCodex() {
  invokeDashboardOptional("openItemCodex");
}

function renderDebugConsole() {
  renderUtilityPanels();
  if (!state.debugConsoleOpen && state.activeUtilityPanel !== "debug") return;
  invokeDashboardOptional("renderDebugConsole");
}

const AUDIO_EFFECT_SELECTIONS_STORAGE_KEY = "studyAdventureAudioEffectSelections";
const ITEM_CODEX_STORAGE_KEY = "studyAdventureItemCodex";
const FINAL_SUBMISSION_HOLD_MS = 800;
const LOCKED_OPERATOR_FOLLOWUP_MS = 10_000;
const EMERGENCY_SIM_TARGET_REMAINING_MS = 4_500;
const DEPLOYMENT_ROSTER_REVEAL_DELAY_MS = 1450;
const DEPLOYMENT_ROSTER_STAGGER_MS = 160;
const BOSS_VISUAL_PROFILES = Object.freeze({
  "blood-red": Object.freeze({
    id: "blood-red",
    phase: "mid",
    imageSrc: "assets/boss-eyes-red-black.png",
    introSrc: "assets/boss-eyes-intro-july17.mp4?v=1"
  }),
  "spectral-green": Object.freeze({
    id: "spectral-green",
    phase: "final",
    imageSrc: "assets/boss-eyes-final-green.png?v=1",
    introSrc: "assets/boss-eyes-final-intro-60fps.mp4?v=1"
  }),
  "signal-yellow": Object.freeze({
    id: "signal-yellow",
    phase: "mid",
    imageSrc: "assets/boss-eyes-signal-yellow.png?v=1",
    introSrc: "assets/boss-eyes-signal-yellow-intro-60fps.mp4?v=1"
  }),
  "arc-blue": Object.freeze({
    id: "arc-blue",
    phase: "final",
    imageSrc: "assets/boss-eyes-arc-blue.png?v=1",
    introSrc: "assets/boss-eyes-arc-blue-intro-60fps.mp4?v=1"
  })
});
const DEFAULT_BOSS_VISUAL_BY_PHASE = Object.freeze({
  mid: "blood-red",
  final: "spectral-green"
});
const BOSS_VISUAL_BY_MISSION_TYPE = Object.freeze({
  "decayed bunker": Object.freeze({
    mid: "blood-red",
    final: "spectral-green"
  }),
  "abandoned space station": Object.freeze({
    mid: "signal-yellow",
    final: "arc-blue"
  })
});
const bossVisualPreloadCache = new Map();
const GAME_SFX_EVENTS = [
  { id: "ui", label: "UI / Button" },
  { id: "typewriter", label: "Text Typewriter" },
  { id: "question", label: "Query Incoming" },
  { id: "submitted", label: "Player Submitted" },
  { id: "correct", label: "Correct Answer" },
  { id: "incorrect", label: "Incorrect Answer" },
  { id: "damage", label: "Damage Taken" },
  { id: "blocked", label: "Blocked Damage" },
  { id: "loot", label: "Item Found" },
  { id: "timer", label: "Timer Tick" },
  { id: "emergency", label: "Emergency Alert" },
  { id: "transition", label: "Room Transition" },
  { id: "recovery", label: "Recovery Room" },
  { id: "boss", label: "Boss Encounter" },
  { id: "failure", label: "Mission Failure" },
  { id: "ending", label: "Mission Ending" }
];

function defaultBossVisualId(phase = "mid") {
  return DEFAULT_BOSS_VISUAL_BY_PHASE[phase === "final" ? "final" : "mid"];
}

function selectBossVisualId(phase = "mid", missionType = state.missionType) {
  const phaseKey = phase === "final" ? "final" : "mid";
  const missionKey = normalize(missionType);
  const missionVisuals = BOSS_VISUAL_BY_MISSION_TYPE[missionKey]
    || BOSS_VISUAL_BY_MISSION_TYPE["decayed bunker"];
  return missionVisuals[phaseKey] || defaultBossVisualId(phaseKey);
}

function bossVisualProfileForNode(node) {
  const requestedId = node?.bossVisualId || defaultBossVisualId(node?.bossPhase);
  return BOSS_VISUAL_PROFILES[requestedId] || BOSS_VISUAL_PROFILES[defaultBossVisualId(node?.bossPhase)];
}

function bossVisualProfilesForMission(missionType = state.missionType) {
  const missionVisuals = BOSS_VISUAL_BY_MISSION_TYPE[normalize(missionType)]
    || BOSS_VISUAL_BY_MISSION_TYPE["decayed bunker"];
  return [...new Set([missionVisuals.mid, missionVisuals.final])]
    .map((id) => BOSS_VISUAL_PROFILES[id])
    .filter(Boolean);
}

function scheduleBossVisualPreload(missionType = state.missionType) {
  const preload = () => bossVisualProfilesForMission(missionType).forEach((profile) => {
    if (!bossVisualPreloadCache.has(profile.imageSrc)) {
      const image = new Image();
      image.decoding = "async";
      image.src = profile.imageSrc;
      bossVisualPreloadCache.set(profile.imageSrc, image);
    }
    if (!bossVisualPreloadCache.has(profile.introSrc)) {
      const video = document.createElement("video");
      video.muted = true;
      video.preload = "auto";
      video.src = profile.introSrc;
      video.load();
      bossVisualPreloadCache.set(profile.introSrc, video);
    }
  });
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(preload, { timeout: 2400 });
  } else {
    window.setTimeout(preload, 0);
  }
}

function readStoredAudioEffectSelections() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(AUDIO_EFFECT_SELECTIONS_STORAGE_KEY) || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function readStoredItemCodex() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(ITEM_CODEX_STORAGE_KEY) || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

const state = {
  started: false,
  resolved: false,
  questions: [],
  players: [],
  inventory: { medkits: 2, ems: 0 },
  itemCodex: readStoredItemCodex(),
  pendingRewardChoice: null,
  pendingRewardExit: null,
  itemRewardMode: "random",
  pendingAbilityTarget: null,
  classAbilityTargets: {},
  classAbilityTargetNotices: {},
  pendingClassAbilityUses: [],
  pendingAbilityUses: [],
  firstBossRewardGranted: false,
  missionType: "Decayed Bunker",
  environment: "",
  setupGeneratedMission: null,
  threat: "",
  threatProfile: null,
  title: "",
  currentQuestion: 0,
  currentNode: 0,
  nodes: [],
  roomNames: {},
  mapPositions: [],
  mapLayoutSeed: 0,
  mapRevealedNodes: new Set(),
  mapRenderSignature: "",
  routeMarkerAnimationKey: "",
  routeMarkerAnimationFrame: 0,
  routeMarkerSettleTimer: null,
  bossAreaNames: { mid: "", final: "" },
  bossPhasePlans: {},
  bossPhasePlanRequests: {},
  bossTestMode: false,
  bossTestPhase: "final",
  bossTestPromptStarted: false,
  combatTestMode: false,
  actionDrivenMode: false,
  actionRooms: [],
  actionThreatPressure: 0,
  actionRoomAttempts: {},
  actionReceiptLogKey: "",
  actionTurnOrder: [],
  actionResolutionQueue: null,
  combatEncounters: {},
  combatPresentationRunId: 0,
  combatPresentationTimers: [],
  initiativeCurrentTurn: null,
  combatStageEnteredNodes: new Set(),
  combatDisplayedHp: {},
  statusRenderSignature: "",
  combatEntryWatchdogTimer: null,
  combatNextNodeTimer: null,
  combatNextNodeWaitStartedAt: 0,
  combatMountBlocked: false,
  roomTransitionTrace: null,
  roomTransitionTraceCounter: 0,
  combatXpBaseline: [],
  actionContinueGateTimer: null,
  activeObstacles: {},
  nodeResults: {},
  encounter: null,
  challengeTypes: [],
  recoveryUsed: new Set(),
  rng: mulberry32(8128),
  selectedEMS: false,
  secondWindEnabled: false,
  secondWindUsed: false,
  secondWindPlayerName: "",
  secondWindPendingPlayerName: "",
  challengeHistory: [],
  missionAccuracyResults: {},
  typeTimers: [],
  typeTimerResolvers: new Map(),
  typewriterGeneration: 0,
  autoScrollTimers: [],
  chatMode: false,
  localDmMode: false,
  deviceMode: "multi",
  localDmProvider: window.localStorage.getItem("studyAdventureLocalDmProvider") || "lmstudio",
  ollamaModel: "google/gemma-4-e4b",
  feedLastId: "",
  feedPollTimer: null,
  playerPollTimer: null,
  playerSyncInFlight: false,
  playerHostRevision: 0,
  playerServerRevision: 0,
  playerServerPromptId: "",
  playerLastPublishedVitalsSignature: "",
  playerPendingVitalsSignature: "",
  playerSessionPublishChain: Promise.resolve(),
  playerSyncFailureCount: 0,
  playerPromptPublicationRetryTimer: null,
  playerPromptPublicationRetryId: "",
  playerPromptPublicationRetryAttempt: 0,
  roomCode: "",
  playerPromptId: "",
  playerPromptRequiredIds: [],
  playerPromptRequiredNames: [],
  playerPromptRequiredAt: 0,
  lockedOperatorWindowPromptId: "",
  lockedOperatorWindowTimer: null,
  lockedOperatorWindowDeadline: 0,
  playerAnswers: [],
  playerActions: [],
  queuedPlayerActions: [],
  playerSubmissionLogKey: "",
  resolutionDelayPending: false,
  resolutionDelayPromptId: "",
  resolutionDelayTimer: null,
  resolutionDelayStartedAt: 0,
  resolutionDelayCallback: null,
  resolutionDelayAttempts: 0,
  processedPlayerActionIds: new Set(),
  processedQueuedActionIds: new Set(),
  scoredPromptIds: new Set(),
  questionOpenedAt: 0,
  questionDurationMs: 60_000,
  questionPauseStartedAt: 0,
  questionPausedTotalMs: 0,
  simulatorAutoAnswer: window.localStorage.getItem("studyAdventureSimulatorAutoAnswer") === "true",
  simulatorAutoAnswerAccuracy: Math.max(0, Math.min(100, Number(window.localStorage.getItem("studyAdventureSimulatorAutoAnswerAccuracy") ?? 50))),
  simulatorAwareAbilities: window.localStorage.getItem("studyAdventureSimulatorAwareAbilities") === "true",
  simulatorAutoAnswerPromptId: "",
  simulatorAutoAnswerTimers: [],
  simulatorAwareAbilityPromptId: "",
  simulatorAwareAbilityTimers: [],
  simulatorPromptRepairPromise: null,
  playerParticipants: [],
  playerJoinUrl: "",
  playerJoinUrlReady: false,
  joinLobbyActive: false,
  pendingMissionConfig: null,
  briefingReady: false,
  currentBriefing: null,
  openingLogStory: "",
  pendingChatNode: null,
  readinessLogged: false,
  teamReady: false,
  bossReadyPending: false,
  bossReadyChecks: new Set(),
  bossAudioStartedNodes: new Set(),
  bossMusicStartedNodes: new Set(),
  bossReadyAudioTimer: null,
  bossEyesStrikeTimer: null,
  bossEyesExitTimer: null,
  bossDamageImpactTimer: null,
  bossScreenCrackLevel: 0,
  bossScreenCrackNode: -1,
  answerPending: false,
  lastSubmittedAnswer: "",
  previousAnswerFlashId: "",
  answerResults: {},
  playerAnswerFeedback: {},
  sceneHistory: [],
  turnHistory: [],
  endingPending: false,
  sideActionRooms: new Set(),
  sideActionPending: false,
  sideActionWaitingId: "",
  narrowedChoices: {},
  classHints: {},
  sideActionGuard: false,
  previousAnswer: null,
  emergencyTimerEnabled: true,
  emergencyTimerDuration: 60,
  fastMode: window.localStorage.getItem("studyAdventureFastMode") === "true",
  teacherTextSize: window.localStorage.getItem("studyAdventureTeacherTextSize") || "normal",
  sfxPreset: window.localStorage.getItem("studyAdventureSfxPreset") || "subtle",
  youtubeMusicUrl: window.localStorage.getItem("studyAdventureYoutubeMusicUrl") || "",
  youtubeBossMusicUrl: window.localStorage.getItem("studyAdventureYoutubeBossMusicUrl") || "",
  useYoutubeMusic: window.localStorage.getItem("studyAdventureUseYoutubeMusic") === "true",
  useYoutubeBossMusic: window.localStorage.getItem("studyAdventureUseYoutubeBossMusic") === "true",
  youtubeMusicRandomStart: window.localStorage.getItem("studyAdventureYoutubeMusicRandomStart") === "true",
  backgroundMusicLoaded: false,
  backgroundMusicPreloads: {},
  backgroundMusicPreloadScheduled: false,
  backgroundMusicMode: "normal",
  backgroundMusicVideoId: "",
  backgroundMusicFadeTimer: null,
  backgroundMusicTransitionRunId: 0,
  backgroundMusicCurrentVolume: 72,
  backgroundMusicFadingOutForBossReady: false,
  backgroundMusicRandomStartTimer: null,
  backgroundMusicRandomStartPollTimer: null,
  backgroundMusicRandomStartPending: null,
  ttsPlaybackActive: false,
  audioEffects: [],
  audioEffectDefaults: {},
  audioEffectSelections: readStoredAudioEffectSelections(),
  audioEffectPlayers: {},
  lastSfxAt: {},
  introSequenceAudio: null,
  introSequenceAudioRunId: 0,
  introSequenceFadingAudio: null,
  introSequenceFadeTimer: null,
  failureAudio: null,
  failureAudioRunId: 0,
  emergencyTimer: null,
  transmissionPending: false,
  transmissionStartedAt: 0,
  transmissionUiTimer: null,
  routeTransition: null,
  deploymentStartedAt: 0,
  deploymentCompletionStartedAt: 0,
  deploymentCompletionWait: 0,
  deploymentTimer: null,
  deploymentReadySfxTimer: null,
  deploymentRosterSfxTimers: [],
  deploymentRosterAudio: [],
  deploymentReady: false,
  deploymentRunId: 0,
  setupTransitionTimers: [],
  dashboardBootTimers: [],
  dashboardBootAudio: [],
  openingWaitStartedAt: 0,
  openingWaitTimer: null,
  mapQuestionOverlayHideTimer: null,
  mapQuestionOverlayKey: "",
  mapQuestionAlertActive: false,
  questionSurfaceVisible: false,
  questionPresentationReady: false,
  questionRevealRunId: 0,
  continueGateTimer: null,
  teamFailurePending: false,
  logPresentationPending: false,
  logPresentationRunId: 0,
  playerDevicePanelCollapsed: false,
  debugConsoleOpen: false,
  activeUtilityPanel: "",
  debugEvents: [],
  missionLogHistory: [],
  savedQuestionSetsCache: [],
  selectedQuestionSetIdsCache: [],
  questionSetsServerReady: false,
  savedMusicPresetsCache: [],
  musicPresetsServerReady: false,
  parseIssueHighlightKey: "",
  localRequestCounter: 0,
  localDmQueue: Promise.resolve(),
  localDmModelEntries: [],
  localDmModelRefreshPending: false,
  ttsVoices: [],
  ttsLastText: "",
  ttsLastQuestionKey: "",
  ttsLastLogKey: "",
  ttsAutoLog: false,
  ttsAutoQuestion: false,
  ttsProvider: "browser",
  ttsPiperAvailable: false,
  ttsPiperVoiceName: "",
  ttsPiperError: "",
  ttsKokoroAvailable: false,
  ttsKokoroVoiceName: "",
  ttsKokoroVoices: [],
  ttsKokoroError: "",
  ttsAudio: null,
  ttsAudioUrl: "",
  ttsVoiceURI: "",
  ttsRate: 1,
  ttsTextDelayMs: 1000,
  ttsTextDelayMode: "auto",
  ttsMeasuredStartupMs: 0,
  ttsLastPlaybackPromise: Promise.resolve(),
  ttsLastPlaybackStartPromise: Promise.resolve({ played: false, delayMs: 0, leadMs: 0 }),
  ttsPlaybackResolve: null,
  ttsPlaybackToken: 0
};

const TIMEOUT_ANSWER = "player failed to submit";
const TWO_BOSS_MIN_QUESTIONS = 18;
const COMBAT_QUESTION_POOL_SIZE = 5;
const MID_BOSS_QUESTIONS = COMBAT_QUESTION_POOL_SIZE;
const FINAL_BOSS_QUESTIONS = COMBAT_QUESTION_POOL_SIZE;
const ENABLE_ROUTE_MARKER_TRANSITION = true;
// Keep route travel readable without making room transitions feel stalled.
// Mission progression waits only for the unfinished portion of this animation.
const ROUTE_TRAVEL_MS = 2200;
// Boss-readiness approaches move at half speed so the audio and visual handoff
// have room to build before the squad reaches the critical-contact marker.
const BOSS_READY_ROUTE_TRAVEL_MS = ROUTE_TRAVEL_MS * 2;
const ENEMY_VISUAL_POOLS = Object.freeze({
  bunker: Object.freeze([
    ...Array.from({ length: 5 }, (_, index) => `enemy_assets/ghosts/shadow-enemy-${index + 1}.png`),
    ...Array.from({ length: 5 }, (_, index) => `enemy_assets/soldiers/enemy-soldier-${index + 1}.png`)
  ]),
  spaceStation: Object.freeze([
    ...Array.from({ length: 5 }, (_, index) => `enemy_assets/monster/alien-enemy-${index + 1}.png`),
    ...Array.from({ length: 5 }, (_, index) => `enemy_assets/soldiers/enemy-soldier-${index + 1}.png`),
    ...Array.from({ length: 5 }, (_, index) => `enemy_assets/ghosts/shadow-enemy-${index + 1}.png`)
  ])
});
const COMBAT_FORMATION_READY_MS = 4300;
const COMBAT_ENTRY_COMPLETE_MS = 4550;
const COMBAT_ENTRY_WATCHDOG_MS = 8000;
const BOSS_INTRO_START_DELAY_MS = 2250;
const BOSS_INTRO_VIDEO_FADE_MS = 650;
const BOSS_INTRO_STATIC_FADE_MS = 950;
const BOSS_INTRO_WATCHDOG_MS = 24000;
const QUESTION_SET_STORAGE_KEY = "studyAdventureQuestionSets";
const SELECTED_QUESTION_SETS_KEY = "studyAdventureSelectedQuestionSets";
const MUSIC_PRESET_STORAGE_KEY = "studyAdventureMusicPresets";
const STATUS_NAME_DISPLAY_LIMIT = 14;
const PLAYER_ACTION_COOLDOWN_MS = 120000;
const ACTION_DIALOGUE_HOLD_MS = 12000;
const PLAYER_PROMPT_DELIVERY_GRACE_MS = 3000;
const GENERATED_ENVIRONMENT_NOTE = "Let the local DM create a custom mission location and persistent enemy.";
const BACKGROUND_MUSIC_VOLUME = 72;
const BACKGROUND_MUSIC_DUCK_VOLUME = 24;
const TTS_SFX_DUCK_GAIN = 0.22;
const LOCAL_NORMAL_MUSIC_SRC = "audio-effects/normal_music.mp3";
const LOCAL_BOSS_MUSIC_SRC = "audio-effects/boss_music.mp3";
let narrationAudioContext = null;
const narrationAudioNodes = new WeakMap();

function isFastMode() {
  return Boolean(state.fastMode);
}

function narrationSentenceRange(normalRange, fastRange) {
  return isFastMode() ? fastRange : normalRange;
}

function questionAlertDelayMs() {
  return isFastMode() ? 550 : 1000;
}

function questionRevealDelayMs() {
  return 1100;
}

function queryAlertDurationMs() {
  return questionRevealDelayMs();
}

function waitForQueryAlert() {
  return new Promise((resolve) => {
    trackTypeTimer(resolve, questionRevealDelayMs(), resolve);
  });
}

function trackTypeTimer(callback, delay, onCancel = null) {
  let timer = null;
  timer = window.setTimeout(() => {
    state.typeTimerResolvers.delete(timer);
    const timerIndex = state.typeTimers.indexOf(timer);
    if (timerIndex >= 0) state.typeTimers.splice(timerIndex, 1);
    callback();
  }, Math.max(0, Number(delay) || 0));
  state.typeTimers.push(timer);
  if (typeof onCancel === "function") state.typeTimerResolvers.set(timer, onCancel);
  return timer;
}

function continueCountdownSeconds() {
  return isFastMode() ? 5 : 10;
}

function normalizeTeacherTextSize(value) {
  return ["compact", "normal", "large", "xl", "projector"].includes(value) ? value : "normal";
}

function applyTeacherTextSize(value = state.teacherTextSize) {
  state.teacherTextSize = normalizeTeacherTextSize(value);
  document.documentElement.dataset.teacherTextSize = state.teacherTextSize;
  const dashboardScale = {
    compact: 0.9,
    normal: 1,
    large: 1.12,
    xl: 1.24,
    projector: 1.38
  }[state.teacherTextSize] || 1;
  document.documentElement.style.setProperty("--dashboard-text-scale", String(dashboardScale));
  if (els.teacherTextSize) els.teacherTextSize.value = state.teacherTextSize;
}

function typewriterDelayFor(previous) {
  if (isFastMode()) {
    return /[.!?]/.test(previous) ? 36 : previous === "," ? 18 : 7;
  }
  return /[.!?]/.test(previous) ? 78 : previous === "," ? 44 : 17;
}

const simulatorNamePool = sharedData.simulatorNamePool || [];
const profanitySubstitutions = sharedData.profanitySubstitutions || [];

const els = {
  missionType: document.getElementById("missionType"),
  customTheme: document.getElementById("customTheme"),
  generateEnvironmentBtn: document.getElementById("generateEnvironmentBtn"),
  generatedEnvironmentNote: document.getElementById("generatedEnvironmentNote"),
  playersInput: document.getElementById("playersInput"),
  singleDeviceClassAssignments: document.getElementById("singleDeviceClassAssignments"),
  deviceModeSingle: document.getElementById("deviceModeSingle"),
  deviceModeMulti: document.getElementById("deviceModeMulti"),
  dmEngine: document.getElementById("dmEngine"),
  questionSource: document.getElementById("questionSource"),
  bossTestMode: document.getElementById("bossTestMode"),
  bossTestPhase: document.getElementById("bossTestPhase"),
  bossTestPhaseField: document.getElementById("bossTestPhaseField"),
  combatTestMode: document.getElementById("combatTestMode"),
  actionDrivenMode: document.getElementById("actionDrivenMode"),
  playerCountNote: document.getElementById("playerCountNote"),
  questionCountNote: document.getElementById("questionCountNote"),
  questionParseIssues: document.getElementById("questionParseIssues"),
  questionParseIssuesList: document.getElementById("questionParseIssuesList"),
  preflightSummary: document.getElementById("preflightSummary"),
  launchStatus: document.getElementById("launchStatus"),
  setupModeStatus: document.getElementById("setupModeStatus"),
  setupRouteStatus: document.getElementById("setupRouteStatus"),
  setupDmStatus: document.getElementById("setupDmStatus"),
  setupSystemsStatus: document.getElementById("setupSystemsStatus"),
  systemCheckList: document.getElementById("systemCheckList"),
  recheckSystemsBtn: document.getElementById("recheckSystemsBtn"),
  localDmProvider: document.getElementById("localDmProvider"),
  localDmProviderGroup: document.getElementById("localDmProviderGroup"),
  ollamaModel: document.getElementById("ollamaModel"),
  ollamaModelGroup: document.getElementById("ollamaModelGroup"),
  ollamaModelStatus: document.getElementById("ollamaModelStatus"),
  advancedSettings: document.getElementById("advancedSettings"),
  emergencyTimerEnabled: document.getElementById("emergencyTimerEnabled"),
  fastModeEnabled: document.getElementById("fastModeEnabled"),
  secondWindEnabled: document.getElementById("secondWindEnabled"),
  emergencyTimerDuration: document.getElementById("emergencyTimerDuration"),
  emergencyTimerDurationGroup: document.getElementById("emergencyTimerDurationGroup"),
  teacherTextSize: document.getElementById("teacherTextSize"),
  teacherTextSizeGroup: document.getElementById("teacherTextSizeGroup"),
  sfxPreset: document.getElementById("sfxPreset"),
  sfxMappingGrid: document.getElementById("sfxMappingGrid"),
  youtubeMusicUrl: document.getElementById("youtubeMusicUrl"),
  youtubeBossMusicUrl: document.getElementById("youtubeBossMusicUrl"),
  youtubeMusicUrlGroup: document.getElementById("youtubeMusicUrlGroup"),
  youtubeBossMusicUrlGroup: document.getElementById("youtubeBossMusicUrlGroup"),
  youtubeMusicRandomStartGroup: document.getElementById("youtubeMusicRandomStartGroup"),
  useYoutubeMusic: document.getElementById("useYoutubeMusic"),
  useYoutubeBossMusic: document.getElementById("useYoutubeBossMusic"),
  youtubeMusicRandomStart: document.getElementById("youtubeMusicRandomStart"),
  savedMusicPresetsPanel: document.getElementById("savedMusicPresetsPanel"),
  savedMusicPresetsNote: document.getElementById("savedMusicPresetsNote"),
  savedMusicPresetsList: document.getElementById("savedMusicPresetsList"),
  musicPresetNameInput: document.getElementById("musicPresetNameInput"),
  saveMusicPresetBtn: document.getElementById("saveMusicPresetBtn"),
  missionLength: document.getElementById("missionLength"),
  missionLengthNote: document.getElementById("missionLengthNote"),
  questionBankGroup: document.getElementById("questionBankGroup"),
  questionTips: document.getElementById("questionTips"),
  questionsInput: document.getElementById("questionsInput"),
  notebookPrompt: document.getElementById("notebookPrompt"),
  copyNotebookPromptBtn: document.getElementById("copyNotebookPromptBtn"),
  savedQuestionSetsPanel: document.getElementById("savedQuestionSetsPanel"),
  savedQuestionSetsNote: document.getElementById("savedQuestionSetsNote"),
  savedQuestionSetsList: document.getElementById("savedQuestionSetsList"),
  questionSetsSelectAllControl: document.getElementById("questionSetsSelectAllControl"),
  questionSetsSelectAll: document.getElementById("questionSetsSelectAll"),
  questionSetsSelectAllLabel: document.getElementById("questionSetsSelectAllLabel"),
  questionSetNameInput: document.getElementById("questionSetNameInput"),
  saveQuestionSetBtn: document.getElementById("saveQuestionSetBtn"),
  loadSampleBtn: document.getElementById("loadSampleBtn"),
  startBtn: document.getElementById("startBtn"),
  joinLobby: document.getElementById("joinLobby"),
  lobbyRoomCode: document.getElementById("lobbyRoomCode"),
  lobbyJoinLink: document.getElementById("lobbyJoinLink"),
  lobbyJoinHelp: document.getElementById("lobbyJoinHelp"),
  lobbyQrCode: document.getElementById("lobbyQrCode"),
  lobbyPlayerList: document.getElementById("lobbyPlayerList"),
  addSimPlayersBtn: document.getElementById("addSimPlayersBtn"),
  cancelLobbyBtn: document.getElementById("cancelLobbyBtn"),
  launchFromLobbyBtn: document.getElementById("launchFromLobbyBtn"),
  resetBtn: document.getElementById("resetBtn"),
  resetConfirmOverlay: document.getElementById("resetConfirmOverlay"),
  resetConfirmMessage: document.getElementById("resetConfirmMessage"),
  resetConfirmCancelBtn: document.getElementById("resetConfirmCancelBtn"),
  resetConfirmAcceptBtn: document.getElementById("resetConfirmAcceptBtn"),
  itemRewardOverlay: document.getElementById("itemRewardOverlay"),
  itemRewardTitle: document.getElementById("itemRewardTitle"),
  itemRewardSubtitle: document.getElementById("itemRewardSubtitle"),
  itemRewardChoices: document.getElementById("itemRewardChoices"),
  itemRewardContinueBtn: document.getElementById("itemRewardContinueBtn"),
  itemCodexOverlay: document.getElementById("itemCodexOverlay"),
  itemCodexCloseBtn: document.getElementById("itemCodexCloseBtn"),
  itemCodexSummary: document.getElementById("itemCodexSummary"),
  itemCodexList: document.getElementById("itemCodexList"),
  copyScriptBtn: document.getElementById("copyScriptBtn"),
  setupPanel: document.getElementById("setupPanel"),
  briefingCard: document.getElementById("briefingCard"),
  missionAudioPanel: document.getElementById("missionAudioPanel"),
  ttsStatus: document.getElementById("ttsStatus"),
  ttsPlayBtn: document.getElementById("ttsPlayBtn"),
  ttsPauseBtn: document.getElementById("ttsPauseBtn"),
  ttsStopBtn: document.getElementById("ttsStopBtn"),
  ttsReplayBtn: document.getElementById("ttsReplayBtn"),
  ttsProvider: document.getElementById("ttsProvider"),
  ttsVoiceSelect: document.getElementById("ttsVoiceSelect"),
  setupTtsProvider: document.getElementById("setupTtsProvider"),
  setupTtsVoiceSelect: document.getElementById("setupTtsVoiceSelect"),
  ttsRate: document.getElementById("ttsRate"),
  ttsTextDelay: document.getElementById("ttsTextDelay"),
  ttsAutoLog: document.getElementById("ttsAutoLog"),
  ttsAutoQuestion: document.getElementById("ttsAutoQuestion"),
  backgroundMusicPanel: document.getElementById("backgroundMusicPanel"),
  backgroundMusicStatus: document.getElementById("backgroundMusicStatus"),
  backgroundMusicLoadBtn: document.getElementById("backgroundMusicLoadBtn"),
  backgroundMusicStopBtn: document.getElementById("backgroundMusicStopBtn"),
  backgroundMusicEmbed: document.getElementById("backgroundMusicEmbed"),
  statusUpdatePanel: document.getElementById("statusUpdatePanel"),
  statusUpdateFeed: document.getElementById("statusUpdateFeed"),
  statusGrid: document.getElementById("statusGrid"),
  encounterCard: document.getElementById("encounterCard"),
  answerControls: document.getElementById("answerControls"),
  mapControlDock: document.getElementById("mapControlDock"),
  playControlDock: document.getElementById("playControlDock"),
  mapWrap: document.querySelector(".map-wrap"),
  missionMap: document.getElementById("missionMap"),
  squadMapMarker: document.getElementById("squadMapMarker"),
  combatStage: document.getElementById("combatStage"),
  combatBossIntro: document.getElementById("combatBossIntro"),
  combatBossIntroVideo: document.getElementById("combatBossIntroVideo"),
  combatStageLabel: document.getElementById("combatStageLabel"),
  combatStageRound: document.getElementById("combatStageRound"),
  combatEnemyFormation: document.getElementById("combatEnemyFormation"),
  combatPartyFormation: document.getElementById("combatPartyFormation"),
  combatActionBanner: document.getElementById("combatActionBanner"),
  initiativeTimeline: document.getElementById("initiativeTimeline"),
  initiativeTimelineStatus: document.getElementById("initiativeTimelineStatus"),
  initiativeTimelineTrack: document.getElementById("initiativeTimelineTrack"),
  mapTitle: document.getElementById("mapTitle"),
  missionProgress: document.getElementById("missionProgress"),
  progressPill: document.getElementById("progressPill"),
  progressSummary: document.getElementById("progressSummary"),
  inventoryActions: document.getElementById("inventoryActions"),
  lastAnswerPanel: document.getElementById("lastAnswerPanel"),
  lastAnswerResult: document.getElementById("lastAnswerResult"),
  lastSubmittedDisplay: document.getElementById("lastSubmittedDisplay"),
  lastCorrectDisplay: document.getElementById("lastCorrectDisplay"),
  mapPanel: document.getElementById("mapPanel"),
  routeTelemetry: document.getElementById("routeTelemetry"),
  routeTelemetryLabel: document.getElementById("routeTelemetryLabel"),
  routeProgressFill: document.getElementById("routeProgressFill"),
  mapQuestionOverlay: document.getElementById("mapQuestionOverlay"),
  mapFailureOverlay: document.getElementById("mapFailureOverlay"),
  mapEmergencyTimer: document.getElementById("mapEmergencyTimer"),
  mapEmergencyTimerLabel: document.getElementById("mapEmergencyTimerLabel"),
  mapEmergencyTimerValue: document.getElementById("mapEmergencyTimerValue"),
  mapEmergencyPauseBtn: document.getElementById("mapEmergencyPauseBtn"),
  deploymentOverlay: document.getElementById("deploymentOverlay"),
  setupTransitionBlackout: document.getElementById("setupTransitionBlackout"),
  setupTransitionLabel: document.getElementById("setupTransitionLabel"),
  deploymentTheme: document.getElementById("deploymentTheme"),
  deploymentPhase: document.getElementById("deploymentPhase"),
  deploymentElapsed: document.getElementById("deploymentElapsed"),
  deploymentProgressFill: document.getElementById("deploymentProgressFill"),
  deploymentRoster: document.getElementById("deploymentRoster"),
  deploymentReadyMessage: document.getElementById("deploymentReadyMessage"),
  deploymentFragment: document.getElementById("deploymentFragment"),
  deploymentTitle: document.getElementById("deploymentTitle"),
  deploymentOperation: document.getElementById("deploymentOperation"),
  deploymentRoute: document.getElementById("deploymentRoute"),
  deploymentThreatPings: document.getElementById("deploymentThreatPings"),
  playerSessionPanel: document.getElementById("playerSessionPanel"),
  playerRoomCode: document.getElementById("playerRoomCode"),
  playerDeviceToggleBtn: document.getElementById("playerDeviceToggleBtn"),
  playerJoinLink: document.getElementById("playerJoinLink"),
  playerJoinHelp: document.getElementById("playerJoinHelp"),
  playerQrCode: document.getElementById("playerQrCode"),
  simulatorPanel: document.getElementById("simulatorPanel"),
  playerAnswerBoard: document.getElementById("playerAnswerBoard"),
  debugConsoleShell: document.getElementById("debugConsoleShell"),
  missionUtilityShell: document.getElementById("missionUtilityShell"),
  missionUtilityOverlay: document.getElementById("missionUtilityOverlay"),
  missionControlsToggle: document.getElementById("missionControlsToggle"),
  missionControlsPanel: document.getElementById("missionControlsPanel"),
  missionLogHistoryToggle: document.getElementById("missionLogHistoryToggle"),
  missionLogHistoryPanel: document.getElementById("missionLogHistoryPanel"),
  missionLogHistoryClear: document.getElementById("missionLogHistoryClear"),
  missionLogHistoryList: document.getElementById("missionLogHistoryList"),
  missionAudioToggle: document.getElementById("missionAudioToggle"),
  debugConsoleToggle: document.getElementById("debugConsoleToggle"),
  debugConsolePanel: document.getElementById("debugConsolePanel"),
  debugConsoleClear: document.getElementById("debugConsoleClear"),
  debugConsoleLog: document.getElementById("debugConsoleLog")
};

let ttsManager = null;
let resetConfirmationReturnFocus = null;

const questionBank = window.StudyAdventureQuestions || {};
const sampleQuestions = questionBank.sampleQuestions || "";
const localQuestionBank = questionBank.localQuestionBank || [];

window.addEventListener("error", (event) => {
  const detail = event.message || event.error?.message || "Unknown script error";
  setLaunchStatus(`Script error: ${detail}`, true);
});

window.addEventListener("unhandledrejection", (event) => {
  const detail = event.reason?.message || String(event.reason || "Unknown async error");
  setLaunchStatus(`Async error: ${detail}`, true);
});

els.loadSampleBtn.addEventListener("click", () => {
  loadSampleSetup();
});
els.copyNotebookPromptBtn.addEventListener("click", copyNotebookPrompt);
els.saveQuestionSetBtn?.addEventListener("click", saveCurrentQuestionSet);
els.questionSetsSelectAll?.addEventListener("change", () => {
  const sets = readSavedQuestionSets();
  const next = els.questionSetsSelectAll.checked
    ? new Set(sets.map((set) => String(set.id)))
    : new Set();
  writeSelectedQuestionSetIds(next);
  renderSavedQuestionSets();
  updateSetupSummary();
});

els.startBtn.addEventListener("click", startMission);
els.generateEnvironmentBtn?.addEventListener("click", generateCustomMissionEnvironment);
els.cancelLobbyBtn.addEventListener("click", closeJoinLobby);
els.launchFromLobbyBtn.addEventListener("click", launchMissionFromLobby);
els.addSimPlayersBtn?.addEventListener("click", () => addSimulatedPlayers(3));
els.playerDeviceToggleBtn?.addEventListener("click", () => {
  state.playerDevicePanelCollapsed = !state.playerDevicePanelCollapsed;
  renderPlayerSessionPanel();
});
els.resetBtn.addEventListener("click", resetMission);
els.resetConfirmCancelBtn?.addEventListener("click", () => closeResetConfirmation());
els.resetConfirmAcceptBtn?.addEventListener("click", confirmMissionReset);
els.itemRewardContinueBtn?.addEventListener("click", continueItemRewardChoice);
els.itemCodexCloseBtn?.addEventListener("click", () => { if (els.itemCodexOverlay) els.itemCodexOverlay.hidden = true; });
els.itemCodexOverlay?.addEventListener("click", (event) => {
  if (event.target === els.itemCodexOverlay) els.itemCodexOverlay.hidden = true;
});
els.resetConfirmOverlay?.addEventListener("click", (event) => {
  if (event.target === els.resetConfirmOverlay) closeResetConfirmation();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !els.resetConfirmOverlay?.hidden) closeResetConfirmation();
});
els.copyScriptBtn.addEventListener("click", copyDmScript);
els.recheckSystemsBtn?.addEventListener("click", checkMissionSystems);
els.sfxPreset?.addEventListener("change", () => {
  state.sfxPreset = normalizeSfxPreset(els.sfxPreset.value);
  window.localStorage.setItem("studyAdventureSfxPreset", state.sfxPreset);
  syncMapAudioReactor();
  playGameSfx("ui");
});
els.sfxMappingGrid?.addEventListener("change", (event) => {
  const select = event.target.closest(".sfx-event-select");
  if (!select) return;
  const eventId = select.dataset.eventId || "";
  if (!eventId) return;
  state.audioEffectSelections[eventId] = select.value;
  window.localStorage.setItem(AUDIO_EFFECT_SELECTIONS_STORAGE_KEY, JSON.stringify(state.audioEffectSelections));
  playGameSfx(eventId);
});
els.youtubeMusicUrl?.addEventListener("input", () => {
  state.youtubeMusicUrl = els.youtubeMusicUrl.value.trim();
  window.localStorage.setItem("studyAdventureYoutubeMusicUrl", state.youtubeMusicUrl);
  syncBackgroundMusicPanel();
});
els.youtubeBossMusicUrl?.addEventListener("input", () => {
  state.youtubeBossMusicUrl = els.youtubeBossMusicUrl.value.trim();
  window.localStorage.setItem("studyAdventureYoutubeBossMusicUrl", state.youtubeBossMusicUrl);
  syncBackgroundMusicPanel();
});
els.useYoutubeMusic?.addEventListener("change", () => {
  state.useYoutubeMusic = Boolean(els.useYoutubeMusic.checked);
  window.localStorage.setItem("studyAdventureUseYoutubeMusic", String(state.useYoutubeMusic));
  syncMusicSourceControls();
  syncBackgroundMusicPanel();
});
els.useYoutubeBossMusic?.addEventListener("change", () => {
  state.useYoutubeBossMusic = Boolean(els.useYoutubeBossMusic.checked);
  window.localStorage.setItem("studyAdventureUseYoutubeBossMusic", String(state.useYoutubeBossMusic));
  syncMusicSourceControls();
  syncBackgroundMusicPanel();
});
els.youtubeMusicRandomStart?.addEventListener("change", () => {
  state.youtubeMusicRandomStart = Boolean(els.youtubeMusicRandomStart.checked);
  window.localStorage.setItem("studyAdventureYoutubeMusicRandomStart", String(state.youtubeMusicRandomStart));
});
els.saveMusicPresetBtn?.addEventListener("click", saveCurrentMusicPreset);
els.backgroundMusicLoadBtn?.addEventListener("click", () => loadBackgroundMusic());
els.backgroundMusicStopBtn?.addEventListener("click", () => stopBackgroundMusic());
els.missionType.addEventListener("change", () => {
  state.setupGeneratedMission = null;
  if (els.generatedEnvironmentNote) els.generatedEnvironmentNote.textContent = GENERATED_ENVIRONMENT_NOTE;
  syncSetupMode();
});
els.customTheme.addEventListener("input", () => {
  if (state.setupGeneratedMission && normalize(state.setupGeneratedMission.environment) !== normalize(els.customTheme.value)) {
    state.setupGeneratedMission = null;
    if (els.generatedEnvironmentNote) els.generatedEnvironmentNote.textContent = "Generated boss cleared after manual environment edit.";
  }
  updateSetupSummary();
});
els.dmEngine.addEventListener("change", syncSetupMode);
els.questionSource.addEventListener("change", () => {
  delete els.missionLength.dataset.manual;
  syncSetupMode();
});
els.bossTestMode?.addEventListener("change", () => {
  if (els.bossTestMode.checked && els.combatTestMode) els.combatTestMode.checked = false;
  if (els.bossTestPhaseField) els.bossTestPhaseField.hidden = !els.bossTestMode.checked;
  updateSetupSummary();
});
els.bossTestPhase?.addEventListener("change", updateSetupSummary);
els.combatTestMode?.addEventListener("change", () => {
  if (els.combatTestMode.checked && els.actionDrivenMode) els.actionDrivenMode.checked = false;
  if (els.combatTestMode.checked && els.bossTestMode) els.bossTestMode.checked = false;
  updateSetupSummary();
});
els.actionDrivenMode?.addEventListener("change", () => {
  if (els.actionDrivenMode.checked && els.combatTestMode) els.combatTestMode.checked = false;
  delete els.missionLength.dataset.manual;
  syncSetupMode();
});
els.deviceModeSingle.addEventListener("change", syncSetupMode);
els.deviceModeMulti.addEventListener("change", syncSetupMode);
els.playersInput.addEventListener("input", () => {
  renderSingleDeviceClassAssignments();
  updateSetupSummary();
});
els.questionsInput.addEventListener("input", updateSetupSummary);
els.missionLength.addEventListener("input", () => {
  els.missionLength.dataset.manual = "true";
  updateSetupSummary();
});
if (els.localDmProvider) {
  els.localDmProvider.value = state.localDmProvider;
  els.localDmProvider.addEventListener("change", () => {
    state.localDmProvider = selectedLocalDmProvider();
    window.localStorage.setItem("studyAdventureLocalDmProvider", state.localDmProvider);
    populateLocalDmModels();
    checkMissionSystems();
  });
}
els.ollamaModel.addEventListener("change", () => {
  handleLocalDmModelSelection();
});
els.ollamaModel.addEventListener("focus", refreshLocalDmModelsForDropdown);
els.ollamaModel.addEventListener("pointerdown", refreshLocalDmModelsForDropdown);
els.emergencyTimerEnabled.addEventListener("change", syncSetupMode);
if (els.fastModeEnabled) {
  els.fastModeEnabled.checked = state.fastMode;
  els.fastModeEnabled.addEventListener("change", () => {
    state.fastMode = Boolean(els.fastModeEnabled.checked);
    window.localStorage.setItem("studyAdventureFastMode", String(state.fastMode));
    updateSetupSummary();
  });
}
applyTeacherTextSize();
syncPerformanceVisibilityState();
document.addEventListener("visibilitychange", syncPerformanceVisibilityState, { passive: true });
initGameAudioControls();
renderSavedMusicPresets();
loadSavedMusicPresetsFromServer();
els.teacherTextSize?.addEventListener("change", () => {
  applyTeacherTextSize(els.teacherTextSize.value);
  window.localStorage.setItem("studyAdventureTeacherTextSize", state.teacherTextSize);
});
els.mapEmergencyPauseBtn?.addEventListener("click", toggleEmergencyTimerPause);
els.missionControlsToggle?.addEventListener("click", () => {
  if (state.activeUtilityPanel !== "controls") renderChatControls();
  toggleUtilityPanel("controls");
});
els.missionLogHistoryToggle?.addEventListener("click", () => toggleUtilityPanel("history"));
els.missionAudioToggle?.addEventListener("click", () => toggleUtilityPanel("audio"));
els.debugConsoleToggle?.addEventListener("click", () => {
  toggleUtilityPanel("debug");
});
els.missionLogHistoryClear?.addEventListener("click", () => {
  state.missionLogHistory = [];
  renderMissionLogHistory();
});
els.debugConsoleClear?.addEventListener("click", () => {
  state.debugEvents = [];
  renderDebugConsole();
});
initTtsControls();
syncBackgroundMusicPanel();
syncSetupMode();
renderSavedQuestionSets();
loadSavedQuestionSetsFromServer();
populateLocalDmModels();
checkMissionSystems();
renderDebugConsole();
renderMissionLogHistory();
startTestSessionFromUrl();
restoreLobbyFromServer();

function loadSampleSetup() {
  state.setupGeneratedMission = null;
  els.playersInput.value = "Chris\nDavis\nMorgan\nLee\nTaylor\nJordan";
  els.customTheme.value = "Storm-buried RF relay bunker with a ghost signal in the walls";
  if (els.generatedEnvironmentNote) els.generatedEnvironmentNote.textContent = GENERATED_ENVIRONMENT_NOTE;
  els.questionsInput.value = sampleQuestions;
  els.questionSource.value = "demo";
  delete els.missionLength.dataset.manual;
  syncSetupMode();
}

function copyNotebookPrompt() {
  navigator.clipboard.writeText(els.notebookPrompt.value).then(() => {
    els.copyNotebookPromptBtn.textContent = "Copied";
    window.setTimeout(() => {
      els.copyNotebookPromptBtn.textContent = "Copy NotebookLM Prompt";
    }, 1200);
  });
}

function initGameAudioControls() {
  state.sfxPreset = normalizeSfxPreset(state.sfxPreset);
  autoLoadDefaultMusicPreset();
  if (els.sfxPreset) els.sfxPreset.value = state.sfxPreset;
  if (els.youtubeMusicUrl) els.youtubeMusicUrl.value = state.youtubeMusicUrl;
  if (els.youtubeBossMusicUrl) els.youtubeBossMusicUrl.value = state.youtubeBossMusicUrl;
  if (els.useYoutubeMusic) els.useYoutubeMusic.checked = state.useYoutubeMusic;
  if (els.useYoutubeBossMusic) els.useYoutubeBossMusic.checked = state.useYoutubeBossMusic;
  if (els.youtubeMusicRandomStart) els.youtubeMusicRandomStart.checked = state.youtubeMusicRandomStart;
  syncMusicSourceControls();
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(loadAudioEffectManifest, { timeout: 1_200 });
  } else {
    window.setTimeout(loadAudioEffectManifest, 0);
  }
}

function syncMusicSourceControls() {
  if (els.youtubeMusicUrl) els.youtubeMusicUrl.disabled = !state.useYoutubeMusic;
  if (els.youtubeBossMusicUrl) els.youtubeBossMusicUrl.disabled = !state.useYoutubeBossMusic;
  if (els.youtubeMusicUrlGroup) els.youtubeMusicUrlGroup.hidden = !state.useYoutubeMusic;
  if (els.youtubeBossMusicUrlGroup) els.youtubeBossMusicUrlGroup.hidden = !state.useYoutubeBossMusic;
  if (els.youtubeMusicRandomStartGroup) els.youtubeMusicRandomStartGroup.hidden = !state.useYoutubeMusic;
}

function syncPerformanceVisibilityState() {
  document.documentElement.classList.toggle("app-tab-hidden", document.hidden);
  if (!document.hidden) {
    pollPlayerAnswers();
    checkDmFeed();
  }
}

function normalizeSfxPreset(value) {
  return ["off", "subtle", "cinematic"].includes(value) ? value : "subtle";
}

function readLocalSavedMusicPresets() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(MUSIC_PRESET_STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter((preset) => preset && preset.id && preset.name) : [];
  } catch {
    return [];
  }
}

function readSavedMusicPresets() {
  if (!state.musicPresetsServerReady && !state.savedMusicPresetsCache.length) {
    state.savedMusicPresetsCache = readLocalSavedMusicPresets();
  }
  return state.savedMusicPresetsCache;
}

function writeSavedMusicPresets(presets) {
  state.savedMusicPresetsCache = Array.isArray(presets)
    ? presets.filter((preset) => preset && preset.id && preset.name)
    : [];
  window.localStorage.setItem(MUSIC_PRESET_STORAGE_KEY, JSON.stringify(state.savedMusicPresetsCache));
  persistMusicPresetsToServer();
}

function mergeMusicPresets(primary = [], secondary = []) {
  const byId = new Map();
  for (const preset of [...secondary, ...primary]) {
    if (!preset?.id || !preset?.name) continue;
    byId.set(preset.id, preset);
  }
  return [...byId.values()];
}

function loadSavedMusicPresetsFromServer() {
  state.savedMusicPresetsCache = readLocalSavedMusicPresets();
  return fetchWithTimeout("/api/music-presets", { cache: "no-store" })
    .then((response) => response.ok ? response.json() : null)
    .then((payload) => {
      if (!payload?.ok) return;
      const serverPresets = Array.isArray(payload.presets)
        ? payload.presets.filter((preset) => preset && preset.id && preset.name)
        : [];
      const localPresets = readLocalSavedMusicPresets();
      if (serverPresets.length) {
        const merged = mergeMusicPresets(serverPresets, localPresets);
        state.savedMusicPresetsCache = merged;
        window.localStorage.setItem(MUSIC_PRESET_STORAGE_KEY, JSON.stringify(merged));
        if (merged.length !== serverPresets.length) persistMusicPresetsToServer();
      } else if (localPresets.length) {
        state.savedMusicPresetsCache = localPresets;
        persistMusicPresetsToServer();
      } else {
        state.savedMusicPresetsCache = [];
      }
      state.musicPresetsServerReady = true;
      autoLoadDefaultMusicPreset();
      renderSavedMusicPresets();
    })
    .catch(() => {
      state.musicPresetsServerReady = false;
    });
}

function persistMusicPresetsToServer() {
  fetchWithTimeout("/api/music-presets", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ presets: state.savedMusicPresetsCache })
  })
    .then((response) => response.ok ? response.json() : null)
    .then((payload) => {
      if (!payload?.ok) return;
      state.musicPresetsServerReady = true;
      state.savedMusicPresetsCache = Array.isArray(payload.presets)
        ? payload.presets
        : state.savedMusicPresetsCache;
      window.localStorage.setItem(MUSIC_PRESET_STORAGE_KEY, JSON.stringify(state.savedMusicPresetsCache));
      renderSavedMusicPresets();
    })
    .catch(() => {
      state.musicPresetsServerReady = false;
    });
}

function saveCurrentMusicPreset() {
  const normalUrl = els.youtubeMusicUrl?.value.trim() || "";
  const bossUrl = els.youtubeBossMusicUrl?.value.trim() || "";
  if (!normalUrl && !bossUrl) {
    setLaunchStatus("Add a normal or boss YouTube link before saving a music preset.", true);
    return;
  }
  if ((normalUrl && !extractYouTubeId(normalUrl)) || (bossUrl && !extractYouTubeId(bossUrl))) {
    setLaunchStatus("One of the music links is not a valid YouTube URL.", true);
    return;
  }

  const name = sanitizeText(els.musicPresetNameInput?.value, { maxLength: 70 });
  if (!name) {
    setLaunchStatus("Enter a name for this music preset.", true);
    els.musicPresetNameInput?.focus();
    return;
  }

  const now = new Date().toISOString();
  const presets = readSavedMusicPresets();
  const existing = presets.find((preset) => normalize(preset.name) === normalize(name));
  const savedPreset = {
    id: existing?.id || `music-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
    name,
    normalUrl,
    bossUrl,
    createdAt: existing?.createdAt || now,
    updatedAt: now
  };
  writeSavedMusicPresets(existing
    ? presets.map((preset) => preset.id === existing.id ? savedPreset : preset)
    : [...presets, savedPreset]);
  if (els.musicPresetNameInput) els.musicPresetNameInput.value = "";
  setLaunchStatus(`${existing ? "Updated" : "Saved"} music preset "${name}".`);
  renderSavedMusicPresets();
}

function renderSavedMusicPresets() {
  if (!els.savedMusicPresetsList || !els.savedMusicPresetsNote) return;
  const presets = readSavedMusicPresets();
  els.savedMusicPresetsNote.textContent = presets.length
    ? `${presets.length} saved preset${presets.length === 1 ? "" : "s"}. Load one to use its normal and boss tracks.`
    : "No saved presets yet.";
  els.savedMusicPresetsList.innerHTML = presets.length ? presets.map((preset) => {
    const normalLabel = preset.normalUrl ? "Normal track linked" : "No normal track";
    const bossLabel = preset.bossUrl ? "Boss track linked" : "No boss track";
    return `
      <div class="saved-question-row">
        <div class="saved-music-links">
          <strong>${escapeHtml(preset.name)}</strong>
          <small title="${escapeAttribute(preset.normalUrl || "")}">${escapeHtml(normalLabel)}</small>
          <small title="${escapeAttribute(preset.bossUrl || "")}">${escapeHtml(bossLabel)}</small>
        </div>
        <div class="saved-question-actions">
          <button class="secondary loadMusicPresetBtn" type="button" data-preset-id="${escapeAttribute(preset.id)}">Load</button>
          <button class="secondary renameMusicPresetBtn" type="button" data-preset-id="${escapeAttribute(preset.id)}">Rename</button>
          <button class="secondary deleteMusicPresetBtn" type="button" data-preset-id="${escapeAttribute(preset.id)}">Delete</button>
        </div>
      </div>
    `;
  }).join("") : `<p class="muted-small">Saved normal and boss music pairs will appear here.</p>`;

  els.savedMusicPresetsList.querySelectorAll(".loadMusicPresetBtn").forEach((button) => {
    button.addEventListener("click", () => loadMusicPreset(button.dataset.presetId || ""));
  });
  els.savedMusicPresetsList.querySelectorAll(".renameMusicPresetBtn").forEach((button) => {
    button.addEventListener("click", () => renameMusicPreset(button.dataset.presetId || ""));
  });
  els.savedMusicPresetsList.querySelectorAll(".deleteMusicPresetBtn").forEach((button) => {
    button.addEventListener("click", () => deleteMusicPreset(button.dataset.presetId || ""));
  });
}

function loadMusicPreset(id) {
  const preset = readSavedMusicPresets().find((entry) => entry.id === id);
  if (!preset) return;
  applyMusicPreset(preset, { announce: true });
}

function applyMusicPreset(preset, { announce = false } = {}) {
  if (!preset) return false;
  state.youtubeMusicUrl = preset.normalUrl || "";
  state.youtubeBossMusicUrl = preset.bossUrl || "";
  state.useYoutubeMusic = Boolean(state.youtubeMusicUrl);
  state.useYoutubeBossMusic = Boolean(state.youtubeBossMusicUrl);
  if (els.youtubeMusicUrl) els.youtubeMusicUrl.value = state.youtubeMusicUrl;
  if (els.youtubeBossMusicUrl) els.youtubeBossMusicUrl.value = state.youtubeBossMusicUrl;
  if (els.useYoutubeMusic) els.useYoutubeMusic.checked = state.useYoutubeMusic;
  if (els.useYoutubeBossMusic) els.useYoutubeBossMusic.checked = state.useYoutubeBossMusic;
  if (els.musicPresetNameInput) els.musicPresetNameInput.value = preset.name;
  window.localStorage.setItem("studyAdventureYoutubeMusicUrl", state.youtubeMusicUrl);
  window.localStorage.setItem("studyAdventureYoutubeBossMusicUrl", state.youtubeBossMusicUrl);
  window.localStorage.setItem("studyAdventureUseYoutubeMusic", String(state.useYoutubeMusic));
  window.localStorage.setItem("studyAdventureUseYoutubeBossMusic", String(state.useYoutubeBossMusic));
  syncMusicSourceControls();
  syncBackgroundMusicPanel();
  if (announce) setLaunchStatus(`Loaded music preset "${preset.name}".`);
  return true;
}

function autoLoadDefaultMusicPreset() {
  if (!state.useYoutubeMusic && !state.useYoutubeBossMusic) return null;
  const normalUrl = els.youtubeMusicUrl?.value.trim() || state.youtubeMusicUrl || "";
  const bossUrl = els.youtubeBossMusicUrl?.value.trim() || state.youtubeBossMusicUrl || "";
  const needsNormal = state.useYoutubeMusic && !normalUrl;
  const needsBoss = state.useYoutubeBossMusic && !bossUrl;
  if (!needsNormal && !needsBoss) return null;
  const preset = readSavedMusicPresets().find((entry) => needsNormal && entry.normalUrl || needsBoss && entry.bossUrl);
  if (!preset) return null;
  applyMusicPreset(preset);
  return preset;
}

function renameMusicPreset(id) {
  const presets = readSavedMusicPresets();
  const preset = presets.find((entry) => entry.id === id);
  if (!preset) return;
  const nextName = sanitizeText(window.prompt("Rename music preset:", preset.name), { maxLength: 70 });
  if (!nextName || nextName === preset.name) return;
  if (presets.some((entry) => entry.id !== id && normalize(entry.name) === normalize(nextName))) {
    setLaunchStatus(`A music preset named "${nextName}" already exists.`, true);
    return;
  }
  writeSavedMusicPresets(presets.map((entry) => entry.id === id
    ? { ...entry, name: nextName, updatedAt: new Date().toISOString() }
    : entry));
  setLaunchStatus(`Renamed music preset to "${nextName}".`);
  renderSavedMusicPresets();
}

function deleteMusicPreset(id) {
  const presets = readSavedMusicPresets();
  const preset = presets.find((entry) => entry.id === id);
  if (!preset || !window.confirm(`Delete saved music preset "${preset.name}"?`)) return;
  writeSavedMusicPresets(presets.filter((entry) => entry.id !== id));
  setLaunchStatus(`Deleted music preset "${preset.name}".`);
  renderSavedMusicPresets();
}

function loadAudioEffectManifest() {
  if (els.sfxMappingGrid) {
    els.sfxMappingGrid.innerHTML = `<p class="field-note">Loading custom sound effect list...</p>`;
  }
  fetchWithTimeout("audio-effects.json", { cache: "no-cache" })
    .then((response) => {
      if (!response.ok) throw new Error("audio-effects.json not found");
      return response.json();
    })
    .then((manifest) => {
      state.audioEffects = Array.isArray(manifest.effects)
        ? manifest.effects
            .filter((effect) => effect && effect.id && effect.src)
            .map((effect) => ({
              id: String(effect.id),
              label: String(effect.label || effect.id),
              src: String(effect.src)
            }))
        : [];
      state.audioEffectDefaults = manifest.defaults && typeof manifest.defaults === "object" ? manifest.defaults : {};
      renderAudioEffectMapping();
    })
    .catch((error) => {
      state.audioEffects = [];
      state.audioEffectDefaults = {};
      renderAudioEffectMapping(error.message);
    });
}

function renderAudioEffectMapping(errorMessage = "") {
  if (!els.sfxMappingGrid) return;
  if (!state.audioEffects.length) {
    els.sfxMappingGrid.innerHTML = `
      <p class="field-note">No custom sound files are listed yet. Add files under <strong>audio-effects</strong>, then list them in <strong>audio-effects.json</strong>.</p>
      ${errorMessage ? `<p class="field-note warning">${escapeHtml(errorMessage)}</p>` : ""}
    `;
    return;
  }
  const options = [
    `<option value="">No sound</option>`,
    ...state.audioEffects.map((effect) => `<option value="${escapeAttribute(effect.id)}">${escapeHtml(effect.label)}</option>`)
  ].join("");
  els.sfxMappingGrid.innerHTML = GAME_SFX_EVENTS.map((eventInfo) => {
    const selected = Object.prototype.hasOwnProperty.call(state.audioEffectSelections, eventInfo.id)
      ? state.audioEffectSelections[eventInfo.id]
      : state.audioEffectDefaults[eventInfo.id] || "";
    return `
      <label class="sfx-event-field">
        <span>${escapeHtml(eventInfo.label)}</span>
        <select class="sfx-event-select" data-event-id="${escapeAttribute(eventInfo.id)}">
          ${options}
        </select>
      </label>
    `.trim();
  }).join("");
  els.sfxMappingGrid.querySelectorAll(".sfx-event-select").forEach((select) => {
    const eventId = select.dataset.eventId || "";
    const selected = Object.prototype.hasOwnProperty.call(state.audioEffectSelections, eventId)
      ? state.audioEffectSelections[eventId]
      : state.audioEffectDefaults[eventId] || "";
    select.value = selected;
  });
}

function audioEffectForEvent(eventName) {
  const selectedId = Object.prototype.hasOwnProperty.call(state.audioEffectSelections, eventName)
    ? state.audioEffectSelections[eventName]
    : state.audioEffectDefaults[eventName] || "";
  if (!selectedId) return null;
  return state.audioEffects.find((effect) => effect.id === selectedId) || null;
}

function releaseLocalMediaElement(media) {
  if (!media || media.tagName !== "AUDIO") return;
  try {
    media.pause();
    media.removeAttribute("src");
    media.load();
  } catch {
    // Media cleanup must never interrupt mission flow.
  }
}

function playGameSfx(eventName, options = {}) {
  if (DISABLE_AUDIO_LOADING_FOR_TRANSITION_DIAGNOSTICS) return null;
  if (state.sfxPreset === "off") return null;
  if (eventName === "ending") stopBackgroundMusic();
  const nowMs = Date.now();
  const minInterval = Number.isFinite(options.minInterval) ? Math.max(0, options.minInterval) : 90;
  if (nowMs - (state.lastSfxAt[eventName] || 0) < minInterval) return null;
  const effect = audioEffectForEvent(eventName);
  if (!effect) return null;
  state.lastSfxAt[eventName] = nowMs;
  try {
    const key = `${effect.id}:${effect.src}`;
    let audio = state.audioEffectPlayers[key];
    if (!audio) {
      audio = new Audio();
      audio.preload = "metadata";
      audio.src = effect.src;
      state.audioEffectPlayers[key] = audio;
    }
    if (audio.studyAdventureFadeTimer) window.clearInterval(audio.studyAdventureFadeTimer);
    audio.studyAdventureFadeTimer = null;
    audio.pause();
    audio.currentTime = 0;
    const baseVolume = state.sfxPreset === "cinematic" ? 0.92 : 0.48;
    audio.studyAdventureBaseVolume = Math.max(0, Math.min(1, baseVolume * (Number.isFinite(options.volumeScale) ? options.volumeScale : 1)));
    audio.volume = effectiveGameSfxVolume(audio);
    setNarrationLowPass(audio, state.ttsPlaybackActive);
    audio.studyAdventurePlayPromise = audio.play();
    audio.studyAdventurePlayPromise.catch(() => {});
    if (options.pulse !== false) pulseMapAudioReactor(eventName);
    return audio;
  } catch {
    // Custom SFX should never interrupt the game loop.
    return null;
  }
}

function effectiveGameSfxVolume(audio) {
  const baseVolume = Number.isFinite(audio?.studyAdventureBaseVolume)
    ? audio.studyAdventureBaseVolume
    : Math.max(0, Math.min(1, Number(audio?.volume) || 0));
  return Math.max(0, Math.min(1, baseVolume * (state.ttsPlaybackActive ? TTS_SFX_DUCK_GAIN : 1)));
}

function narrationAudioNode(audio) {
  if (!audio || audio.tagName !== "AUDIO") return null;
  const existing = narrationAudioNodes.get(audio);
  if (existing) return existing;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;
  try {
    narrationAudioContext ||= new AudioContextClass();
    const source = narrationAudioContext.createMediaElementSource(audio);
    const filter = narrationAudioContext.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 22000;
    filter.Q.value = 0.72;
    source.connect(filter);
    filter.connect(narrationAudioContext.destination);
    const node = { source, filter, lowPassActive: false };
    narrationAudioNodes.set(audio, node);
    return node;
  } catch {
    return null;
  }
}

function setNarrationLowPass(audio, active) {
  const node = narrationAudioNode(audio);
  if (!node || !narrationAudioContext) return;
  const nextActive = Boolean(active);
  if (node.lowPassActive === nextActive) return;
  node.lowPassActive = nextActive;
  narrationAudioContext.resume?.().catch(() => {});
  const frequency = node.filter.frequency;
  const now = narrationAudioContext.currentTime;
  const target = nextActive ? 1800 : 22000;
  const duration = nextActive ? 0.34 : 1.4;
  if (typeof frequency.cancelAndHoldAtTime === "function") {
    frequency.cancelAndHoldAtTime(now);
  } else {
    const current = Math.max(40, Number(frequency.value) || 22000);
    frequency.cancelScheduledValues(now);
    frequency.setValueAtTime(current, now);
  }
  frequency.exponentialRampToValueAtTime(target, now + duration);
}

function narrationDuckedAudioPlayers() {
  return [...new Set([
    ...Object.values(state.audioEffectPlayers),
    state.introSequenceAudio,
    state.introSequenceFadingAudio,
    state.failureAudio,
    ...state.deploymentRosterAudio,
    ...state.dashboardBootAudio
  ].filter(Boolean))];
}

function syncGameSfxNarrationDuck() {
  narrationDuckedAudioPlayers().forEach((audio) => {
    if (!Number.isFinite(audio.studyAdventureBaseVolume)) audio.studyAdventureBaseVolume = audio.volume;
    if (!audio.studyAdventureFadeTimer) audio.volume = effectiveGameSfxVolume(audio);
    setNarrationLowPass(audio, state.ttsPlaybackActive);
  });
}

function stopGameSfx(eventName) {
  const effect = audioEffectForEvent(eventName);
  if (!effect) return;
  const key = `${effect.id}:${effect.src}`;
  const audio = state.audioEffectPlayers[key];
  if (!audio) return;
  try {
    if (audio.studyAdventureFadeTimer) window.clearInterval(audio.studyAdventureFadeTimer);
    audio.studyAdventureFadeTimer = null;
    audio.pause();
    audio.currentTime = 0;
    releaseLocalMediaElement(audio);
    delete state.audioEffectPlayers[key];
  } catch {
    // Custom SFX should never interrupt the game loop.
  }
}

function fadeOutGameSfx(eventName, durationMs = 450) {
  const effect = audioEffectForEvent(eventName);
  if (!effect) return;
  const key = `${effect.id}:${effect.src}`;
  const audio = state.audioEffectPlayers[key];
  if (!audio || audio.paused) return;
  if (audio.studyAdventureFadeTimer) window.clearInterval(audio.studyAdventureFadeTimer);
  const startedAt = performance.now();
  const startingVolume = audio.volume;
  audio.studyAdventureFadeTimer = window.setInterval(() => {
    const progress = Math.min(1, (performance.now() - startedAt) / Math.max(1, durationMs));
    audio.volume = Math.max(0, startingVolume * (1 - progress));
    if (progress < 1) return;
    window.clearInterval(audio.studyAdventureFadeTimer);
    audio.studyAdventureFadeTimer = null;
    try {
      audio.pause();
      audio.currentTime = 0;
      audio.volume = startingVolume;
      releaseLocalMediaElement(audio);
      delete state.audioEffectPlayers[key];
    } catch {
      // Custom SFX should never interrupt the game loop.
    }
  }, 35);
}

function stopAllGameSfx() {
  Object.values(state.audioEffectPlayers).forEach((audio) => {
    try {
      if (audio.studyAdventureFadeTimer) window.clearInterval(audio.studyAdventureFadeTimer);
      audio.studyAdventureFadeTimer = null;
      audio.pause();
      audio.currentTime = 0;
      releaseLocalMediaElement(audio);
    } catch {
      // Audio cleanup must not interrupt a reset or a new mission.
    }
  });
  state.audioEffectPlayers = {};
  state.lastSfxAt = {};
}

function startIntroSequenceAudio() {
  stopIntroSequenceAudio();
  if (DISABLE_AUDIO_LOADING_FOR_TRANSITION_DIAGNOSTICS) return;
  if (state.sfxPreset === "off" || state.teamReady) return;
  const endingEffect = audioEffectForEvent("ending");
  const sources = [...new Set([endingEffect?.src, "audio-effects/ending.mp3"].filter(Boolean))];
  const runId = ++state.introSequenceAudioRunId;

  const playSource = (index) => {
    if (runId !== state.introSequenceAudioRunId || state.teamReady || index >= sources.length) return;
    const audio = new Audio();
    audio.preload = "metadata";
    audio.src = sources[index];
    let advanced = false;
    const tryNextSource = () => {
      if (advanced) return;
      advanced = true;
      if (state.introSequenceAudio === audio) state.introSequenceAudio = null;
      playSource(index + 1);
    };
    audio.loop = true;
    audio.studyAdventureBaseVolume = state.sfxPreset === "cinematic" ? 0.72 : 0.42;
    audio.volume = effectiveGameSfxVolume(audio);
    setNarrationLowPass(audio, state.ttsPlaybackActive);
    state.introSequenceAudio = audio;
    audio.addEventListener("error", tryNextSource, { once: true });
    audio.play().catch(() => {
      if (audio.error && runId === state.introSequenceAudioRunId) tryNextSource();
    });
  };

  playSource(0);
}

function stopIntroSequenceAudio() {
  state.introSequenceAudioRunId += 1;
  if (state.introSequenceFadeTimer) window.clearInterval(state.introSequenceFadeTimer);
  state.introSequenceFadeTimer = null;
  const audioPlayers = [state.introSequenceAudio, state.introSequenceFadingAudio].filter(Boolean);
  state.introSequenceAudio = null;
  state.introSequenceFadingAudio = null;
  for (const audio of audioPlayers) {
    try {
      audio.pause();
      audio.currentTime = 0;
      releaseLocalMediaElement(audio);
    } catch {
      // Intro audio should never interrupt the mission flow.
    }
  }
}

function fadeOutIntroSequenceAudio(durationMs = 1400) {
  const audio = state.introSequenceAudio;
  if (!audio) return;
  state.introSequenceAudioRunId += 1;
  if (state.introSequenceFadeTimer) window.clearInterval(state.introSequenceFadeTimer);
  state.introSequenceAudio = null;
  state.introSequenceFadingAudio = audio;
  const startedAt = Date.now();
  const startingVolume = audio.volume;
  state.introSequenceFadeTimer = window.setInterval(() => {
    const ratio = Math.min(1, (Date.now() - startedAt) / Math.max(1, durationMs));
    audio.volume = Math.max(0, startingVolume * (1 - ratio));
    if (ratio < 1) return;
    window.clearInterval(state.introSequenceFadeTimer);
    state.introSequenceFadeTimer = null;
    if (state.introSequenceFadingAudio === audio) state.introSequenceFadingAudio = null;
    try {
      audio.pause();
      audio.currentTime = 0;
      releaseLocalMediaElement(audio);
    } catch {
      // Intro audio should never interrupt the mission flow.
    }
  }, 50);
}

function playMissionFailureAudio() {
  stopBackgroundMusic();
  stopIntroSequenceAudio();
  stopGameSfx("boss");
  stopGameSfx("ending");
  stopMissionFailureAudio();
  if (DISABLE_AUDIO_LOADING_FOR_TRANSITION_DIAGNOSTICS) return;
  if (state.sfxPreset === "off") return;

  const configuredEffect = audioEffectForEvent("failure");
  const sources = [...new Set([
    configuredEffect?.src,
    "audio-effects/failure-optimized.wav"
  ].filter(Boolean))];
  const runId = ++state.failureAudioRunId;

  const playSource = (index) => {
    if (runId !== state.failureAudioRunId || index >= sources.length) return;
    const audio = new Audio();
    audio.preload = "metadata";
    audio.src = sources[index];
    let advanced = false;
    const tryNextSource = () => {
      if (advanced) return;
      advanced = true;
      if (state.failureAudio === audio) state.failureAudio = null;
      playSource(index + 1);
    };
    audio.studyAdventureBaseVolume = state.sfxPreset === "cinematic" ? 0.96 : 0.58;
    audio.volume = effectiveGameSfxVolume(audio);
    setNarrationLowPass(audio, state.ttsPlaybackActive);
    state.failureAudio = audio;
    audio.addEventListener("error", tryNextSource, { once: true });
    audio.play().then(() => pulseMapAudioReactor("failure")).catch(() => {
      if (audio.error && runId === state.failureAudioRunId) tryNextSource();
    });
  };

  playSource(0);
}

function stopMissionFailureAudio() {
  state.failureAudioRunId += 1;
  const audio = state.failureAudio;
  state.failureAudio = null;
  if (!audio) return;
  releaseLocalMediaElement(audio);
}

function startNormalBackgroundMusicAfterReady() {
  fadeOutIntroSequenceAudio();
  if (DISABLE_AUDIO_LOADING_FOR_TRANSITION_DIAGNOSTICS) {
    stopBackgroundMusic();
    if (els.backgroundMusicStatus) els.backgroundMusicStatus.textContent = "Audio loading disabled for transition diagnostics";
    return;
  }
  preloadBackgroundMusicTracks();
  loadBackgroundMusic("normal", { fadeIn: true });
}

function preloadBackgroundMusicTracks() {
  // These tracks are 59–88 MB each. Creating two `preload="auto"` audio
  // elements at mission start made Opera fetch/decode both files at once,
  // competing with the map/combat transition and freezing every open tab.
  // Keep this hook for callers, but stream only the track that is actually
  // needed when the scene is ready (see loadBackgroundMusic).
  state.backgroundMusicPreloadScheduled = false;
}

function syncBackgroundMusicPanel() {
  if (els.backgroundMusicPanel) els.backgroundMusicPanel.hidden = false;
  if (els.backgroundMusicStatus) {
    els.backgroundMusicStatus.textContent = DISABLE_AUDIO_LOADING_FOR_TRANSITION_DIAGNOSTICS
      ? "Audio loading disabled for transition diagnostics"
      : state.backgroundMusicLoaded
      ? `${titleCase(state.backgroundMusicMode)} music loaded`
      : "Bundled music ready";
  }
  syncMapAudioReactor();
}

function sendYouTubePlayerCommand(iframe, func, args = []) {
  if (!iframe?.contentWindow) return;
  iframe.contentWindow.postMessage(JSON.stringify({ event: "command", func, args }), "*");
}

function clearBackgroundMusicRandomStart() {
  window.clearTimeout(state.backgroundMusicRandomStartTimer);
  window.clearInterval(state.backgroundMusicRandomStartPollTimer);
  state.backgroundMusicRandomStartTimer = null;
  state.backgroundMusicRandomStartPollTimer = null;
  state.backgroundMusicRandomStartPending = null;
}

function finishBackgroundMusicRandomStart(pending, duration = 0) {
  if (!pending || state.backgroundMusicRandomStartPending !== pending) return;
  const { iframe, transitionRunId, videoId } = pending;
  clearBackgroundMusicRandomStart();
  if (transitionRunId !== state.backgroundMusicTransitionRunId || state.backgroundMusicVideoId !== videoId) return;
  const latestStart = Math.max(0, Math.floor(Number(duration) - (30 * 60)));
  if (latestStart > 0) {
    const startAt = Math.floor(Math.random() * (latestStart + 1));
    sendYouTubePlayerCommand(iframe, "seekTo", [startAt, true]);
  }
  fadeInBackgroundMusic(iframe);
}

function prepareBackgroundMusicRandomStart(iframe, transitionRunId, videoId) {
  clearBackgroundMusicRandomStart();
  const pending = { iframe, transitionRunId, videoId };
  state.backgroundMusicRandomStartPending = pending;
  const requestPlaybackInfo = () => iframe?.contentWindow?.postMessage(JSON.stringify({
    event: "listening",
    id: "study-adventure-music",
    channel: "study-adventure-music"
  }), "*");
  requestPlaybackInfo();
  state.backgroundMusicRandomStartPollTimer = window.setInterval(requestPlaybackInfo, 400);
  sendYouTubePlayerCommand(iframe, "setVolume", [0]);
  sendYouTubePlayerCommand(iframe, "playVideo");
  state.backgroundMusicRandomStartTimer = window.setTimeout(() => finishBackgroundMusicRandomStart(pending), 3500);
}

window.addEventListener("message", (event) => {
  const pending = state.backgroundMusicRandomStartPending;
  if (!pending || event.source !== pending.iframe?.contentWindow) return;
  let payload = event.data;
  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload);
    } catch {
      return;
    }
  }
  const duration = Number(payload?.info?.duration);
  if (payload?.event === "infoDelivery" && Number.isFinite(duration) && duration > 0) {
    finishBackgroundMusicRandomStart(pending, duration);
  }
});

function backgroundMusicPlayer() {
  return els.backgroundMusicEmbed?.querySelector("iframe, audio") || null;
}

function setBackgroundMusicPlayerVolume(player, volume, options = {}) {
  if (!player) return;
  const ensurePlayback = options.ensurePlayback !== false;
  if (player.tagName === "AUDIO") {
    player.volume = Math.max(0, Math.min(1, volume / 100));
    setNarrationLowPass(player, state.ttsPlaybackActive);
    if (ensurePlayback) player.play().catch(() => {});
    return;
  }
  sendYouTubePlayerCommand(player, "setVolume", [Math.round(volume)]);
  if (ensurePlayback) sendYouTubePlayerCommand(player, "playVideo");
}

function rampBackgroundMusic(player, fromVolume, toVolume, durationMs, onComplete) {
  window.clearInterval(state.backgroundMusicFadeTimer);
  state.backgroundMusicFadeTimer = null;
  state.backgroundMusicCurrentVolume = fromVolume;
  setBackgroundMusicPlayerVolume(player, fromVolume);

  const startedAt = performance.now();
  state.backgroundMusicFadeTimer = window.setInterval(() => {
    const progress = Math.min(1, (performance.now() - startedAt) / durationMs);
    const eased = 1 - ((1 - progress) ** 3);
    const volume = fromVolume + ((toVolume - fromVolume) * eased);
    state.backgroundMusicCurrentVolume = volume;
    setBackgroundMusicPlayerVolume(player, volume, { ensurePlayback: false });
    if (progress >= 1) {
      window.clearInterval(state.backgroundMusicFadeTimer);
      state.backgroundMusicFadeTimer = null;
      if (typeof onComplete === "function") onComplete();
    }
  }, 100);
}

function backgroundMusicListeningVolume() {
  return state.ttsPlaybackActive ? BACKGROUND_MUSIC_DUCK_VOLUME : BACKGROUND_MUSIC_VOLUME;
}

function fadeInBackgroundMusic(player, durationMs = 2200, targetVolume = backgroundMusicListeningVolume()) {
  rampBackgroundMusic(player, 0, targetVolume, durationMs);
}

function duckBackgroundMusicForTts() {
  state.ttsPlaybackActive = true;
  syncGameSfxNarrationDuck();
  if (!state.backgroundMusicLoaded || state.backgroundMusicFadingOutForBossReady) return;
  const player = backgroundMusicPlayer();
  if (!player) return;
  setNarrationLowPass(player, true);
  rampBackgroundMusic(player, state.backgroundMusicCurrentVolume, BACKGROUND_MUSIC_DUCK_VOLUME, 320);
}

function restoreBackgroundMusicAfterTts() {
  state.ttsPlaybackActive = false;
  syncGameSfxNarrationDuck();
  if (!state.backgroundMusicLoaded || state.backgroundMusicFadingOutForBossReady) return;
  const player = backgroundMusicPlayer();
  if (!player) return;
  setNarrationLowPass(player, false);
  rampBackgroundMusic(player, state.backgroundMusicCurrentVolume, BACKGROUND_MUSIC_VOLUME, 620);
}

function fadeOutBackgroundMusicForBossReady(durationMs = 1200) {
  if (!state.backgroundMusicLoaded) return;
  const player = backgroundMusicPlayer();
  if (!player) {
    stopBackgroundMusic();
    return;
  }
  state.backgroundMusicFadingOutForBossReady = true;
  if (els.backgroundMusicStatus) els.backgroundMusicStatus.textContent = "Fading out for critical contact...";
  rampBackgroundMusic(player, state.backgroundMusicCurrentVolume, 0, durationMs, () => stopBackgroundMusic());
}

function loadBackgroundMusic(mode = desiredBackgroundMusicMode(), options = {}) {
  if (DISABLE_AUDIO_LOADING_FOR_TRANSITION_DIAGNOSTICS) {
    stopBackgroundMusic();
    if (els.backgroundMusicStatus) els.backgroundMusicStatus.textContent = "Audio loading disabled for transition diagnostics";
    return;
  }
  const requestedMode = mode === "boss" ? "boss" : "normal";
  const normalUrl = els.youtubeMusicUrl?.value?.trim() || state.youtubeMusicUrl;
  const bossUrl = els.youtubeBossMusicUrl?.value?.trim() || state.youtubeBossMusicUrl;
  const url = requestedMode === "boss" ? bossUrl : normalUrl;
  const youtubeRequested = requestedMode === "boss" ? state.useYoutubeBossMusic : state.useYoutubeMusic;
  const id = youtubeRequested ? extractYouTubeId(url) : "";
  const useYoutube = Boolean(id);
  const localSrc = requestedMode === "boss" ? LOCAL_BOSS_MUSIC_SRC : LOCAL_NORMAL_MUSIC_SRC;
  const sourceKey = useYoutube ? `youtube:${id}` : `local:${requestedMode}`;
  state.youtubeMusicUrl = normalUrl;
  state.youtubeBossMusicUrl = bossUrl;
  window.localStorage.setItem("studyAdventureYoutubeMusicUrl", normalUrl);
  window.localStorage.setItem("studyAdventureYoutubeBossMusicUrl", bossUrl);
  if (youtubeRequested && !useYoutube && els.backgroundMusicStatus) {
    els.backgroundMusicStatus.textContent = `Invalid ${requestedMode} YouTube URL; using bundled music`;
  }
  if (state.backgroundMusicLoaded && state.backgroundMusicVideoId === sourceKey) {
    state.backgroundMusicMode = requestedMode;
    if (els.backgroundMusicPanel) els.backgroundMusicPanel.hidden = false;
    if (els.backgroundMusicStatus) els.backgroundMusicStatus.textContent = `${titleCase(state.backgroundMusicMode)} music loaded`;
    const currentPlayer = backgroundMusicPlayer();
    if (currentPlayer && !state.backgroundMusicFadingOutForBossReady) {
      rampBackgroundMusic(currentPlayer, state.backgroundMusicCurrentVolume, backgroundMusicListeningVolume(), 360);
    }
    syncMapAudioReactor();
    return;
  }

  const previousPlayer = backgroundMusicPlayer();
  const transitionRunId = ++state.backgroundMusicTransitionRunId;
  state.backgroundMusicMode = requestedMode;
  if (els.backgroundMusicStatus) {
    els.backgroundMusicStatus.textContent = previousPlayer && options.transition
      ? `Transitioning to ${titleCase(requestedMode)} music...`
      : `Loading ${titleCase(requestedMode)} music...`;
  }

  const mountTrack = (requestedFadeIn = false) => {
    if (transitionRunId !== state.backgroundMusicTransitionRunId) return;
    const fadeIn = requestedMode === "normal" || requestedFadeIn;
    const randomStart = requestedMode === "normal" && state.youtubeMusicRandomStart;
    state.backgroundMusicLoaded = true;
    state.backgroundMusicVideoId = sourceKey;
    state.backgroundMusicFadingOutForBossReady = false;
    if (els.backgroundMusicPanel) els.backgroundMusicPanel.hidden = false;
    if (els.backgroundMusicStatus) els.backgroundMusicStatus.textContent = `${titleCase(requestedMode)} music loaded`;
    if (!els.backgroundMusicEmbed) return;
    state.backgroundMusicCurrentVolume = fadeIn ? 0 : backgroundMusicListeningVolume();

    if (useYoutube) {
      const origin = encodeURIComponent(window.location.origin);
      const src = `https://www.youtube.com/embed/${encodeURIComponent(id)}?autoplay=1&loop=1&playlist=${encodeURIComponent(id)}&controls=1&modestbranding=1&enablejsapi=1&origin=${origin}`;
      els.backgroundMusicEmbed.innerHTML = `<iframe title="YouTube background music" src="${src}" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>`;
      const iframe = els.backgroundMusicEmbed.querySelector("iframe");
      iframe?.addEventListener("load", () => {
        if (transitionRunId !== state.backgroundMusicTransitionRunId || state.backgroundMusicVideoId !== sourceKey) return;
        if (randomStart) {
          prepareBackgroundMusicRandomStart(iframe, transitionRunId, sourceKey);
        } else if (fadeIn) {
          fadeInBackgroundMusic(iframe);
        } else {
          setBackgroundMusicPlayerVolume(iframe, backgroundMusicListeningVolume());
        }
      }, { once: true });
    } else {
      const audio = state.backgroundMusicPreloads[requestedMode] || document.createElement("audio");
      audio.title = `Bundled ${requestedMode} background music`;
      audio.loop = true;
      audio.controls = true;
      // Metadata is enough to begin playback without eagerly buffering the
      // entire multi-minute track. The browser will stream the rest while the
      // combat scene remains responsive.
      audio.preload = "metadata";
      if (!audio.src || !audio.src.endsWith(localSrc)) audio.src = localSrc;
      els.backgroundMusicEmbed.innerHTML = "";
      els.backgroundMusicEmbed.appendChild(audio);
      state.backgroundMusicPreloads[requestedMode] = audio;
      let localStarted = false;
      if (audio) audio.volume = Math.max(0, Math.min(1, state.backgroundMusicCurrentVolume / 100));
      audio?.addEventListener("error", () => {
        if (transitionRunId === state.backgroundMusicTransitionRunId && els.backgroundMusicStatus) {
          els.backgroundMusicStatus.textContent = `Missing ${localSrc}`;
        }
      }, { once: true });
      const startLocalTrack = () => {
        if (localStarted) return;
        if (transitionRunId !== state.backgroundMusicTransitionRunId || state.backgroundMusicVideoId !== sourceKey) return;
        localStarted = true;
        if (randomStart && Number.isFinite(audio.duration) && audio.duration > 30 * 60) {
          audio.currentTime = Math.floor(Math.random() * ((audio.duration - 30 * 60) + 1));
        }
        audio.play().catch(() => {});
        if (fadeIn) fadeInBackgroundMusic(audio);
        else setBackgroundMusicPlayerVolume(audio, backgroundMusicListeningVolume());
      };
      audio?.addEventListener("loadedmetadata", startLocalTrack, { once: true });
      if (audio?.readyState >= 1) startLocalTrack();
      else audio?.load();
    }
    syncMapAudioReactor();
    playGameSfx("ui");
  };

  if (previousPlayer && options.transition) {
    rampBackgroundMusic(previousPlayer, state.backgroundMusicCurrentVolume, 0, 900, () => {
      const cachedPlayer = Object.values(state.backgroundMusicPreloads).includes(previousPlayer);
      if (cachedPlayer) {
        previousPlayer.pause();
        previousPlayer.volume = 0;
      } else {
        releaseLocalMediaElement(previousPlayer);
      }
      mountTrack(true);
    });
  } else {
    mountTrack(Boolean(options.fadeIn));
  }
}

function stopBackgroundMusic() {
  state.backgroundMusicTransitionRunId += 1;
  clearBackgroundMusicRandomStart();
  window.clearInterval(state.backgroundMusicFadeTimer);
  state.backgroundMusicFadeTimer = null;
  const player = backgroundMusicPlayer();
  if (player?.tagName === "AUDIO") {
    const cachedPlayer = Object.values(state.backgroundMusicPreloads).includes(player);
    if (cachedPlayer) {
      player.pause();
      player.volume = 0;
    } else {
      releaseLocalMediaElement(player);
    }
  }
  if (els.backgroundMusicEmbed) els.backgroundMusicEmbed.innerHTML = "";
  state.backgroundMusicLoaded = false;
  state.backgroundMusicVideoId = "";
  state.backgroundMusicCurrentVolume = 0;
  state.backgroundMusicFadingOutForBossReady = false;
  if (els.backgroundMusicStatus) els.backgroundMusicStatus.textContent = "Stopped";
  syncMapAudioReactor();
}

function releaseBackgroundMusicPreloads() {
  Object.values(state.backgroundMusicPreloads).forEach((audio) => releaseLocalMediaElement(audio));
  state.backgroundMusicPreloads = {};
  state.backgroundMusicPreloadScheduled = false;
}

function syncMapAudioReactor() {
  if (!els.mapPanel) return;
  els.mapPanel.classList.toggle("audio-reactive", state.sfxPreset !== "off" || state.backgroundMusicLoaded);
  els.mapPanel.classList.toggle("music-reactive", state.backgroundMusicLoaded);
}

function pulseMapAudioReactor(eventName = "") {
  if (!els.mapPanel || state.sfxPreset === "off") return;
  els.mapPanel.classList.remove("audio-sfx-pulse", "audio-sfx-critical");
  void els.mapPanel.offsetWidth;
  const critical = ["damage", "incorrect", "emergency", "boss", "failure", "ending"].includes(eventName);
  const className = critical ? "audio-sfx-critical" : "audio-sfx-pulse";
  els.mapPanel.classList.add(className);
  window.setTimeout(() => els.mapPanel?.classList.remove(className), critical ? 1100 : 850);
}

function startBossReadyAudio(payload = {}) {
  const nodeIndex = Number.isInteger(payload.bossNodeIndex) ? payload.bossNodeIndex : state.currentNode;
  if (state.bossAudioStartedNodes.has(nodeIndex)) return;
  state.bossAudioStartedNodes.add(nodeIndex);
  playGameSfx("boss");
}

function routeTravelDurationMs(transition = state.routeTransition) {
  return transition?.boss ? BOSS_READY_ROUTE_TRAVEL_MS : ROUTE_TRAVEL_MS;
}

function startBossReadyAudioForRoute(transition = state.routeTransition) {
  if (!transition?.moving || !transition.boss) return;
  fadeOutBackgroundMusicForBossReady();
  startBossReadyAudio({ bossNodeIndex: transition.to });
}

function scheduleBossReadyAudioHandoff(payload = {}) {
  const nodeIndex = Number.isInteger(payload.bossNodeIndex) ? payload.bossNodeIndex : state.currentNode;
  window.clearTimeout(state.bossReadyAudioTimer);
  const attempt = () => {
    state.bossReadyAudioTimer = null;
    if (!state.started || !state.bossReadyPending || state.currentNode !== nodeIndex) return;
    if (state.bossAudioStartedNodes.has(nodeIndex)) return;
    const priorCombatVisible = Boolean(els.combatStage && !els.combatStage.hidden);
    const routeStillMoving = Boolean(
      state.routeTransition?.moving
      || els.squadMapMarker?.classList.contains("traveling")
    );
    if (priorCombatVisible || routeStillMoving) {
      state.bossReadyAudioTimer = window.setTimeout(attempt, 160);
      return;
    }
    // Fallback for readiness gates reached without a moving route marker.
    fadeOutBackgroundMusicForBossReady();
    startBossReadyAudio(payload);
  };
  attempt();
}

function startBossQuestionMusic() {
  const node = state.nodes[state.currentNode];
  const bossActive = node?.type === "boss" || Boolean(currentBossProgress());
  if (!bossActive || state.bossMusicStartedNodes.has(state.currentNode)) return;
  state.bossMusicStartedNodes.add(state.currentNode);
  syncBossEyesVisual();
  fadeOutGameSfx("boss", 480);
  loadBackgroundMusic("boss", state.backgroundMusicLoaded ? { transition: true } : { fadeIn: true });
}

function primeBossThemeForNode(nodeIndex) {
  const bossNode = state.nodes?.[nodeIndex];
  if (!document.body || bossNode?.type !== "boss") return null;
  const profile = bossVisualProfileForNode(bossNode);
  if (!profile) return null;
  document.body.dataset.bossVisual = profile.id;
  document.body.classList.add("boss-theme-active");
  return profile;
}

function syncBossThemePresence() {
  if (!document.body) return;
  const mapEyesVisible = Boolean(els.mapPanel && (
    els.mapPanel.classList.contains("boss-eyes-active")
    || els.mapPanel.classList.contains("boss-eyes-exiting")
  ));
  const combatBossVisible = Boolean(els.combatStage
    && !els.combatStage.hidden
    && els.combatStage.classList.contains("boss-fight"));
  const routeBossNodeIndex = state.transmissionPending
    && state.routeTransition?.moving
    && state.routeTransition?.boss
    ? state.routeTransition.to
    : -1;
  const currentBossNode = state.nodes?.[state.currentNode]?.type === "boss"
    ? state.nodes[state.currentNode]
    : null;
  const bossReadinessActive = Boolean(currentBossNode && (
    state.bossReadyPending
    || state.bossReadyChecks.has(state.currentNode)
  ));
  const themeActive = document.body.classList.contains("mission-active") && (
    mapEyesVisible
    || combatBossVisible
    || routeBossNodeIndex >= 0
    || bossReadinessActive
  );

  if (!themeActive) {
    document.body.classList.remove("boss-theme-active");
    delete document.body.dataset.bossVisual;
    return;
  }

  let bossNode = null;
  if (combatBossVisible) {
    const stageNodeIndex = Number(els.combatStage.dataset.nodeIndex);
    if (Number.isInteger(stageNodeIndex)) bossNode = state.nodes?.[stageNodeIndex] || null;
  }
  if (!bossNode && routeBossNodeIndex >= 0) bossNode = state.nodes?.[routeBossNodeIndex] || null;
  if (!bossNode && currentBossNode) bossNode = currentBossNode;

  let visualId = bossNode ? bossVisualProfileForNode(bossNode)?.id : "";
  if (!visualId && combatBossVisible) {
    visualId = els.combatStage.classList.contains("final-boss-visual") ? "spectral-green" : "blood-red";
  }
  if (!visualId && mapEyesVisible) {
    visualId = els.mapPanel.classList.contains("boss-final-visual") ? "spectral-green" : "blood-red";
  }
  if (!BOSS_VISUAL_PROFILES[visualId]) visualId = document.body.dataset.bossVisual;
  if (!BOSS_VISUAL_PROFILES[visualId]) visualId = defaultBossVisualId(bossNode?.bossPhase);

  document.body.dataset.bossVisual = visualId;
  document.body.classList.add("boss-theme-active");
}

function syncBossEyesVisual() {
  const node = state.nodes[state.currentNode];
  const bossActive = node?.type === "boss" || Boolean(currentBossProgress());
  const eyesExiting = els.mapPanel?.classList.contains("boss-eyes-exiting");
  if (node?.type === "boss") {
    const finalBoss = node.bossPhase === "final";
    els.mapPanel?.classList.toggle("boss-final-visual", finalBoss);
    els.mapPanel?.classList.toggle("boss-mid-visual", !finalBoss);
  } else if (!eyesExiting) {
    els.mapPanel?.classList.remove("boss-final-visual", "boss-mid-visual");
  }
  const combatStageActive = Boolean(els.combatStage && (
    !els.combatStage.hidden
    || els.combatStage.classList.contains("exiting")
    || els.combatStage.classList.contains("combat-cleared")
  ));
  if (eyesExiting && !combatStageActive) {
    els.mapPanel.classList.add("boss-eyes-active");
    syncBossThemePresence();
    return;
  }
  if (!bossActive || combatStageActive) {
    window.clearTimeout(state.bossEyesExitTimer);
    state.bossEyesExitTimer = null;
    els.mapPanel?.classList.remove("boss-eyes-active", "boss-eyes-exiting", "boss-eyes-strike");
    syncBossThemePresence();
    return;
  }
  const revealActive = bossActive && state.bossMusicStartedNodes.has(state.currentNode);
  els.mapPanel?.classList.toggle("boss-eyes-active", revealActive);
  syncBossThemePresence();
}

function beginBossEyesExit(force = false) {
  if (!force && !els.mapPanel?.classList.contains("boss-eyes-active")) return;
  window.clearTimeout(state.bossEyesExitTimer);
  els.mapPanel.classList.add("boss-eyes-active", "boss-eyes-exiting");
  syncBossThemePresence();
  state.bossEyesExitTimer = window.setTimeout(() => {
    state.bossEyesExitTimer = null;
    els.mapPanel?.classList.remove("boss-eyes-active", "boss-eyes-exiting");
    clearBossDamageVisual();
    syncBossEyesVisual();
  }, 1400);
}

function clearBossDamageVisual() {
  window.clearTimeout(state.bossDamageImpactTimer);
  state.bossDamageImpactTimer = null;
  state.bossScreenCrackLevel = 0;
  state.bossScreenCrackNode = -1;
  document.body.classList.remove("boss-damage-impact");
  els.mapPanel?.classList.remove(
    "boss-damage-impact",
    "boss-crack-level-1",
    "boss-crack-level-2",
    "boss-crack-level-3"
  );
}

function triggerBossDamageImpact(effects = []) {
  const damageHits = effects.filter((effect) => effect.kind === "hit" && Number(effect.amount || 0) > 0);
  const node = state.nodes[state.currentNode];
  const bossActive = node?.type === "boss" || Boolean(currentBossProgress());
  const failureActive = state.teamFailurePending
    || document.body.classList.contains("situation-failure")
    || els.mapPanel?.classList.contains("mission-failed");
  if (!bossActive || failureActive || !damageHits.length || !els.mapPanel) return;

  if (state.bossScreenCrackNode !== state.currentNode) {
    clearBossDamageVisual();
    state.bossScreenCrackNode = state.currentNode;
  }
  state.bossScreenCrackLevel = Math.min(3, state.bossScreenCrackLevel + damageHits.length);
  els.mapPanel.classList.remove("boss-crack-level-1", "boss-crack-level-2", "boss-crack-level-3");
  els.mapPanel.classList.add(`boss-crack-level-${state.bossScreenCrackLevel}`);

  window.clearTimeout(state.bossDamageImpactTimer);
  document.body.classList.remove("boss-damage-impact");
  els.mapPanel.classList.remove("boss-damage-impact");
  void els.mapPanel.offsetWidth;
  document.body.classList.add("boss-damage-impact");
  els.mapPanel.classList.add("boss-damage-impact");
  state.bossDamageImpactTimer = window.setTimeout(() => {
    document.body.classList.remove("boss-damage-impact");
    els.mapPanel?.classList.remove("boss-damage-impact");
    state.bossDamageImpactTimer = null;
  }, 760);
}

function desiredBackgroundMusicMode() {
  const node = state.nodes[state.currentNode];
  const bossActive = node?.type === "boss" || Boolean(currentBossProgress());
  // Keep the normal bed quiet and in place during a boss readiness check.
  // The boss track starts only when the first combat prompt is presented.
  if (isCombatNode(node)) {
    if (node?.type === "boss" && !state.bossMusicStartedNodes.has(state.currentNode)) return "normal";
    return "boss";
  }
  if (bossActive && state.bossMusicStartedNodes.has(state.currentNode)) return "boss";
  return "normal";
}

function syncBackgroundMusicForEncounter() {
  if (!state.backgroundMusicLoaded) return;
  // A boss-readiness payload exists before route travel begins. Let that route
  // transition own the fade into the readiness cue without encounter sync
  // switching the background bed underneath it.
  if (state.bossReadyPending) return;
  const desiredMode = desiredBackgroundMusicMode();
  if (desiredMode === state.backgroundMusicMode) return;
  loadBackgroundMusic(desiredMode, { transition: true });
}

function titleCase(value) {
  return String(value || "").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function extractYouTubeId(url) {
  const text = String(url || "").trim();
  if (!text) return "";
  try {
    const parsed = new URL(text);
    if (/youtu\.be$/i.test(parsed.hostname)) return parsed.pathname.split("/").filter(Boolean)[0] || "";
    if (/youtube\.com$/i.test(parsed.hostname) || /youtube-nocookie\.com$/i.test(parsed.hostname)) {
      if (parsed.searchParams.get("v")) return parsed.searchParams.get("v");
      const parts = parsed.pathname.split("/").filter(Boolean);
      const embedIndex = parts.findIndex((part) => ["embed", "shorts", "live"].includes(part));
      if (embedIndex >= 0) return parts[embedIndex + 1] || "";
    }
  } catch {
    const match = text.match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([A-Za-z0-9_-]{8,})/);
    return match?.[1] || "";
  }
  return "";
}

function ensureTtsManager() {
  if (!ttsManager && typeof ttsModule.create === "function") {
    ttsManager = ttsModule.create({
      state,
      els,
      escapeHtml,
      escapeAttribute,
      cleanText: cleanSpeechText,
      getCurrentLogText: currentMissionLogSpeechText,
      disableAudioLoading: DISABLE_AUDIO_LOADING_FOR_TRANSITION_DIAGNOSTICS,
      onPlaybackStart: duckBackgroundMusicForTts,
      onPlaybackEnd: restoreBackgroundMusicAfterTts
    });
  }
  return ttsManager;
}

function initTtsControls() {
  ensureTtsManager()?.init();
}

function ttsCanSpeak() {
  return Boolean(ensureTtsManager()?.canSpeak());
}

function waitForTtsPlayback(playback) {
  return ensureTtsManager()?.waitForPlayback(playback) || Promise.resolve();
}

function waitForTtsPresentationStart(playback) {
  return ensureTtsManager()?.waitForPresentationStart(playback) || Promise.resolve();
}

function syncTtsPresentation(autoRead, extraDelayMs = 0) {
  return waitForTtsPresentationStart(autoRead?.playback).then(() => {
    const delay = (Number(autoRead?.visualDelay) || 0) + (Number(extraDelayMs) || 0);
    return delayPresentation(delay);
  });
}

function noTtsRead() {
  return ensureTtsManager()?.noRead() || { visualDelay: 0, playback: Promise.resolve() };
}

function speakText(text, options = {}) {
  return ensureTtsManager()?.speakText(text, options) || Promise.resolve();
}

function prefetchTtsTexts(items = []) {
  return ensureTtsManager()?.prefetchTexts(items) || Promise.resolve([]);
}

function stopTts() {
  ensureTtsManager()?.stop();
}

function toggleTtsPause() {
  ensureTtsManager()?.togglePause();
}

function ttsVisualDelayMs() {
  return ensureTtsManager()?.visualDelayMs() || 0;
}
function speakCurrentMissionLog() {
  speakText(currentMissionLogSpeechText(), { label: "Reading log" });
}

function maybeAutoReadMissionLog(entry) {
  if (!state.ttsAutoLog || !ttsCanSpeak()) return noTtsRead();
  const text = missionLogSpeechText(entry) || currentMissionLogSpeechText();
  const key = `${state.currentQuestion}:${state.currentNode}:${text}`;
  if (!text || key === state.ttsLastLogKey) return noTtsRead();
  state.ttsLastLogKey = key;
  return { visualDelay: ttsVisualDelayMs(), playback: speakText(text, { label: "Reading log" }) };
}

function maybeAutoReadQuestion(options = {}) {
  if (!state.ttsAutoQuestion || !ttsCanSpeak()) return noTtsRead();
  const info = currentQuestionInfo();
  if (!info.question || (!state.questionPresentationReady && !options.allowBeforeReady)) return noTtsRead();
  const text = currentQuestionSpeechText(info);
  const key = `${state.currentQuestion}:${state.currentNode}:${text}`;
  if (!text || key === state.ttsLastQuestionKey) return noTtsRead();
  state.ttsLastQuestionKey = key;
  return { visualDelay: ttsVisualDelayMs(), playback: speakText(text, { label: "Reading query" }) };
}

function prefetchUpcomingTts(payload = {}) {
  if (!ttsCanSpeak()) return Promise.resolve([]);
  const items = [];
  if (state.ttsAutoLog && payload.continuationStory) {
    items.push({ text: payload.continuationStory, purpose: "continuation" });
  }
  if (state.ttsAutoQuestion && payload.question) {
    const questionText = currentQuestionSpeechText() || cleanSpeechText(payload.question);
    if (questionText) items.push({ text: questionText, purpose: "question" });
  }
  return items.length ? prefetchTtsTexts(items) : Promise.resolve([]);
}

function delayPresentation(ms) {
  const delay = Math.max(0, Number(ms) || 0);
  if (!delay) return Promise.resolve();
  return new Promise((resolve) => {
    trackTypeTimer(resolve, delay, resolve);
  });
}

function currentMissionLogSpeechText() {
  const entries = document.querySelectorAll("#chatTranscript .transcript-entry");
  const entry = entries[entries.length - 1];
  return missionLogSpeechText(entry);
}

function missionLogSpeechText(entry) {
  if (!entry) return "";
  const speechText = String(entry.dataset.speechText || "").trim();
  if (speechText) return speechText;
  const clone = entry.cloneNode(true);
  clone.querySelectorAll(".damage-log, .mission-continue-gate, .log-question, .transmission-display, .log-tag").forEach((node) => node.remove());
  clone.querySelectorAll("[data-text]").forEach((node) => {
    if (!node.textContent.trim()) node.textContent = node.dataset.text || "";
  });
  return clone.textContent || "";
}

function currentQuestionSpeechText(info = currentQuestionInfo()) {
  if (!info.question) return "";
  return displayQuestionText(info.question);
}

function cleanSpeechText(text) {
  return String(text || "")
    .replace(/\breceiving\s+(?:transmission|comm(?:unication)?s?)\b[\s.:!\-]*/gi, "")
    .replace(/\s+/g, " ")
    .replace(/! Alert !/gi, "Alert.")
    .replace(/! Query Incoming !/gi, "Query incoming.")
    .replace(/\bHP\b/g, "H P")
    .replace(/\bEMS\b/g, "E M S")
    .replace(/\bRF\b/g, "R F")
    .trim();
}

function selectedDeviceMode() {
  return els.deviceModeSingle?.checked ? "single" : "multi";
}

function syncDeviceModeClass(deviceMode = selectedDeviceMode()) {
  document.body.classList.toggle("single-device-mode", deviceMode === "single");
  document.body.classList.toggle("multi-device-mode", deviceMode !== "single");
  syncAnswerControlsDock(deviceMode);
}

function syncAnswerControlsDock(deviceMode = state.deviceMode || selectedDeviceMode()) {
  if (!els.answerControls || !els.mapControlDock || !els.playControlDock) return;
  const targetDock = state.started && deviceMode === "single" ? els.mapControlDock : els.playControlDock;
  if (els.answerControls.parentElement !== targetDock) {
    targetDock.appendChild(els.answerControls);
  }
}

function setupRosterPlayers() {
  return els.playersInput.value
    .split(/[\n,]+/)
    .map((name) => sanitizeText(name, { maxLength: 32 }))
    .filter(Boolean);
}

function renderSingleDeviceClassAssignments() {
  const container = els.singleDeviceClassAssignments;
  if (!container) return;
  const players = setupRosterPlayers();
  const singleDevice = selectedDeviceMode() === "single";
  container.hidden = !singleDevice || !players.length;
  if (container.hidden) return;
  const validNames = new Set(players.map(normalize));
  for (const key of [...singleDeviceClassAssignments.keys()]) {
    if (!validNames.has(key)) singleDeviceClassAssignments.delete(key);
  }
  const claimed = new Set();
  players.forEach((name, index) => {
    const key = normalize(name);
    const current = singleDeviceClassAssignments.get(key);
    if (combatSystem.classDefinition?.(current) && !claimed.has(current)) claimed.add(current);
    else {
      const fallback = combatSystem.CLASS_IDS?.find((classId) => !claimed.has(classId)) || "";
      singleDeviceClassAssignments.set(key, fallback);
      if (fallback) claimed.add(fallback);
    }
  });
  container.innerHTML = `<strong>Class Assignments</strong>${players.map((name) => {
    const key = normalize(name);
    const selected = singleDeviceClassAssignments.get(key) || "";
    return `<label><span>${escapeHtml(name)}</span><select class="singleClassSelect" data-player-key="${escapeAttribute(key)}">${(combatSystem.CLASS_IDS || []).map((classId) => {
      const definition = combatSystem.classDefinition?.(classId) || { label: classId, gear: "" };
      const taken = players.some((other) => normalize(other) !== key && singleDeviceClassAssignments.get(normalize(other)) === classId);
      return `<option value="${escapeAttribute(classId)}" ${selected === classId ? "selected" : ""} ${taken ? "disabled" : ""}>${escapeHtml(definition.label)} · ${escapeHtml(definition.gear)}</option>`;
    }).join("")}</select></label>`;
  }).join("")}`;
  container.querySelectorAll(".singleClassSelect").forEach((select) => select.addEventListener("change", () => {
    singleDeviceClassAssignments.set(select.dataset.playerKey, select.value);
    renderSingleDeviceClassAssignments();
  }));
}

function startTestSessionFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const requested = params.get("test");
  if (!requested) return;

  const length = Math.max(1, Math.min(60, Number(requested) || 30));
  loadSampleSetup();
  els.dmEngine.value = "local";
  els.questionSource.value = "demo";
  syncSetupMode();
  els.missionLength.value = String(length);
  window.setTimeout(startMission, 0);
}

function startMission() {
  try {
    const lengthValidation = missionLengthValidation();
    if (!lengthValidation.valid) {
      updateSetupSummary();
      setLaunchStatus(lengthValidation.message, true);
      els.missionLength.focus();
      return;
    }
    stopTts();
    setLaunchStatus("Preparing mission...");
    const config = readMissionConfig();
    if (!config) {
      setLaunchStatus("Mission setup is incomplete. Add valid questions first.", true);
      return;
    }
    if (config.deviceMode === "multi") {
      if (state.joinLobbyActive) {
        state.pendingMissionConfig = config;
        setLaunchStatus("Join lobby is already open. Use Launch Mission in the lobby.");
        renderJoinLobby();
        return;
      }
      openJoinLobby(config);
      setLaunchStatus("Opening multi-device join lobby...");
      return;
    }

    const players = setupRosterPlayers();
    if (!players.length) {
      setLaunchStatus("Add at least one player name for Single Device mode.", true);
      alert("Add at least one player name for Single Device mode.");
      return;
    }
    if (players.length > (combatSystem.CLASS_IDS?.length || 6)) {
      setLaunchStatus("Class missions currently support up to six players.", true);
      return;
    }
    renderSingleDeviceClassAssignments();
    const playerClasses = Object.fromEntries(players.map((name) => [normalize(name), singleDeviceClassAssignments.get(normalize(name))]));
    setLaunchStatus("Launching single-device mission...");
    launchMission(players, { ...config, playerClasses });
  } catch (error) {
    console.error("Mission launch failed", error);
    logDebugEvent({
      kind: "error",
      label: "Mission launch failed",
      detail: String(error?.stack || error?.message || error || "unknown launch error").slice(0, 1200)
    });
    setLaunchStatus(`Launch error: ${error.message || error}`, true);
  }
}

function readMissionConfig() {
  autoLoadDefaultMusicPreset();
  const engine = els.dmEngine.value;
  const chatMode = engine !== "classic";
  const localDmMode = engine === "local";
  const actionDrivenMode = Boolean(els.actionDrivenMode?.checked);
  const questionPool = getSetupStudyQuestions();
  const lengthValidation = missionLengthValidation(questionPool.length, actionDrivenMode);
  if (!lengthValidation.valid) {
    setLaunchStatus(lengthValidation.message, true);
    return null;
  }
  let length = actionDrivenMode ? actionMissionLengthFor() : missionLengthFor(questionPool.length);
  const bossTestPhase = els.bossTestPhase?.value === "mid" ? "mid" : "final";
  if (!actionDrivenMode && els.bossTestMode?.checked && bossTestPhase === "mid") {
    if (questionPool.length < TWO_BOSS_MIN_QUESTIONS) {
      setLaunchStatus(`Mid boss testing needs at least ${TWO_BOSS_MIN_QUESTIONS} questions in the selected bank; ${questionPool.length} detected.`, true);
      return null;
    }
    // The midpoint boss only exists in the full two-boss route. Expand a
    // shorter automatic/default mission selection to include that route.
    if (length < TWO_BOSS_MIN_QUESTIONS) {
      length = TWO_BOSS_MIN_QUESTIONS;
      els.missionLength.value = String(length);
      els.missionLength.dataset.manual = "true";
    }
  }
  const questions = actionDrivenMode
    ? makeActionMissionPlaceholders(length)
    : engine === "manual"
    ? makeChatQuestions(length)
    : selectMissionQuestions(questionPool, length);

  if (questions.length < 1) {
    setLaunchStatus(actionDrivenMode ? "Set at least one action room before launching." : "No study questions found. Click Load Demo Session or paste questions first.", true);
    return null;
  }

  return {
    engine,
    chatMode,
    localDmMode,
    deviceMode: selectedDeviceMode(),
    questions,
    localDmProvider: selectedLocalDmProvider(),
    ollamaModel: els.ollamaModel.value || defaultLocalDmModel(),
    missionType: els.missionType.value,
    environment: els.customTheme.value.trim() || defaultEnvironment(els.missionType.value),
    generatedMission: generatedMissionForLaunch(),
    emergencyTimerEnabled: els.emergencyTimerEnabled.checked,
    emergencyTimerDuration: Number(els.emergencyTimerDuration.value) || 60,
    secondWindEnabled: Boolean(els.secondWindEnabled?.checked),
    sfxPreset: normalizeSfxPreset(els.sfxPreset?.value),
    youtubeMusicUrl: els.youtubeMusicUrl?.value.trim() || state.youtubeMusicUrl || "",
    youtubeBossMusicUrl: els.youtubeBossMusicUrl?.value.trim() || state.youtubeBossMusicUrl || "",
    useYoutubeMusic: Boolean(els.useYoutubeMusic?.checked),
    useYoutubeBossMusic: Boolean(els.useYoutubeBossMusic?.checked),
    youtubeMusicRandomStart: Boolean(els.youtubeMusicRandomStart?.checked),
    bossTestMode: Boolean(els.bossTestMode?.checked),
    bossTestPhase: els.bossTestPhase?.value === "mid" ? "mid" : "final",
    combatTestMode: Boolean(els.combatTestMode?.checked),
    actionDrivenMode
  };
}

function generatedMissionForLaunch() {
  const generated = state.setupGeneratedMission;
  const environment = els.customTheme.value.trim();
  if (!generated || !environment) return null;
  if (normalize(generated.environment) !== normalize(environment)) return null;
  return generated;
}

function generateCustomMissionEnvironment() {
  const button = els.generateEnvironmentBtn;
  const note = els.generatedEnvironmentNote;
  const missionType = els.missionType.value || "Decayed Bunker";
  if (button) button.disabled = true;
  if (note) note.textContent = "Receiving generated mission environment...";
  requestOllama(makeEnvironmentGeneratorPrompt(missionType), { temperature: 0.88, format: "json" })
    .then((text) => {
      const generated = parseGeneratedMissionEnvironment(text);
      if (!generated.environment || !generated.threatIdentity) throw new Error("Generated mission did not include an environment and threat.");
      state.setupGeneratedMission = generated;
      els.customTheme.value = generated.environment;
      if (note) {
        note.textContent = `${generated.environment} | Boss: ${generated.threatIdentity}`;
      }
      setLaunchStatus(`Generated environment with ${generated.threatIdentity}.`);
      updateSetupSummary();
      logDebugEvent({
        kind: "response",
        label: "Generated environment",
        detail: JSON.stringify(generated, null, 2)
      });
    })
    .catch((error) => {
      if (note) note.textContent = `Generation failed: ${error.message || error}`;
      setLaunchStatus("Environment generation failed. Check the local DM connection.", true);
    })
    .finally(() => {
      if (button) button.disabled = false;
    });
}

function makeEnvironmentGeneratorPrompt(missionType) {
  return dmPrompts.makeEnvironmentGeneratorPrompt({
    missionType,
    currentEnvironmentIdea: els.customTheme.value.trim()
  });
}

function parseGeneratedMissionEnvironment(text) {
  const parsed = parseJsonObjectFromText(text) || {};
  return {
    environment: cleanBriefingField(parsed.environment || parsed.location || parsed.setting || ""),
    threatIdentity: cleanThreatIdentity(parsed.threatIdentity || parsed.enemy || parsed.boss || parsed.threat || ""),
    threatDetails: {
      manifestation: cleanBriefingField(parsed.threatDetails?.manifestation),
      signs: cleanBriefingField(parsed.threatDetails?.signs),
      tactics: cleanBriefingField(parsed.threatDetails?.tactics),
      escalation: cleanBriefingField(parsed.threatDetails?.escalation),
      confrontation: cleanBriefingField(parsed.threatDetails?.confrontation),
      weakness: cleanBriefingField(parsed.threatDetails?.weakness)
    },
    bossAreas: {
      mid: cleanBossAreaName(parsed.bossAreas?.mid),
      final: cleanBossAreaName(parsed.bossAreas?.final)
    }
  };
}

function applySetupGeneratedMission(generated) {
  if (!generated || !state.threatProfile) return;
  if (generated.threatIdentity) {
    state.threatProfile.identity = generated.threatIdentity;
    state.threatProfile.archetype = generated.threatIdentity;
    state.threatProfile.summary = generated.threatDetails?.manifestation || generated.threatIdentity;
    state.threatProfile.description = generated.threatDetails?.manifestation || state.threatProfile.description;
  }
  if (generated.threatDetails && Object.values(generated.threatDetails).some(Boolean)) {
    state.threatProfile.generated = { ...generated.threatDetails };
  }
}

function actionMissionLengthFor() {
  const requested = Number(els.missionLength.value);
  if (!Number.isFinite(requested) || requested < 1) return 5;
  return Math.max(1, Math.min(30, Math.round(requested)));
}

function missionLengthValidation(total = getSetupQuestionReport().questions.length, actionDrivenMode = Boolean(els.actionDrivenMode?.checked)) {
  if (!actionDrivenMode && total < 1) {
    return { valid: true, value: 0, max: 0, message: "Add study questions to set a mission length." };
  }
  const raw = String(els.missionLength.value || "").trim();
  const max = actionDrivenMode ? 30 : total;
  const value = Number(raw);
  if (!raw || !Number.isInteger(value) || value < 1 || value > max) {
    return {
      valid: false,
      value,
      max,
      message: `Enter a whole mission length from 1 to ${max}. The mission will not start until this is changed.`
    };
  }
  return { valid: true, value, max, message: "" };
}

function makeActionMissionPlaceholders(length) {
  return Array.from({ length: Math.max(1, Number(length) || 10) }, (_, index) => ({
    question: `Action turn ${index + 1}`,
    choices: [],
    answerKey: "",
    answerText: "",
    area: "",
    mode: "action",
    type: "action"
  }));
}

function positionMissionForBossTest(phase = state.bossTestPhase) {
  const groups = bossQuestionGroups(state.questions.length);
  const targetPhase = phase === "mid" ? "mid" : "final";
  const targetGroup = groups.find((group) => group.phase === targetPhase);
  if (!targetGroup) return;
  const bossNodeIndex = state.nodes.findIndex((node) => node.type === "boss" && node.questionIndex === targetGroup.start);
  if (bossNodeIndex < 0) return;
  const preBossQuestion = Math.max(0, targetGroup.start - 1);
  const preBossNodeIndex = bossNodeIndex - 1;
  if (targetGroup.start > 0 && preBossNodeIndex >= 0) {
    const existingNode = state.nodes[preBossNodeIndex] || {};
    state.nodes[preBossNodeIndex] = {
      ...existingNode,
      type: "challenge",
      roomKind: "obstacle",
      questionIndex: preBossQuestion,
      questionIndexes: [preBossQuestion],
      label: "Staging",
      bossTestStaging: true
    };
    state.currentQuestion = preBossQuestion;
    state.currentNode = preBossNodeIndex;
  } else {
    state.currentQuestion = targetGroup.start;
    state.currentNode = bossNodeIndex;
  }
  state.challengeHistory = Array.from({ length: state.currentQuestion }, (_, index) => ({
    correct: true,
    type: "Boss Test Setup",
    skipped: true,
    questionIndex: index
  }));
  state.readinessLogged = true;
  state.teamReady = true;
  logDebugEvent({
    kind: "response",
    label: "Boss test start armed",
    detail: preBossNodeIndex >= 0 && targetGroup.start > 0
      ? `Starting in staging room ${preBossNodeIndex + 1}; ${targetPhase} boss room ${bossNodeIndex + 1} remains locked behind critical contact`
      : `No pre-boss question available; starting at the ${targetGroup.phase} boss readiness gate`
  });
}

function seedBossTestRoster(phase = "final") {
  if (!state.bossTestMode || !combatSystem.levelForXp || !combatSystem.rollItemChoices) return;
  const final = phase === "final";
  state.players.forEach((player, index) => {
    // Mid-boss testing represents two completed combats; alternate level 2
    // and level 3 so the test exercises both sides of the expected range.
    const xp = final ? 150 : index % 2 ? 45 : 20;
    const levelInfo = combatSystem.levelForXp(xp);
    const midBossReward = combatSystem.rollItemChoices({ rng: state.rng, count: 3, rarity: "epic" })[0];
    const secondItem = combatSystem.rollItemChoices({ rng: state.rng, count: 3 })
      .find((item) => item.id !== midBossReward?.id) || combatSystem.items?.find((item) => item.id !== midBossReward?.id);
    const seededItems = final
      ? [midBossReward, secondItem].filter(Boolean)
      : [combatSystem.rollItemChoices({ rng: state.rng, count: 3 })[0] || midBossReward].filter(Boolean);
    player.xp = xp;
    player.level = levelInfo.level;
    player.maxHp = levelInfo.maxHp;
    player.hp = player.maxHp;
    player.items = seededItems.map((item) => item.id).slice(0, 2);
    player.itemNotice = final ? "Boss test loadout: mid-boss Epic reward simulated." : "Boss test loadout: two prior combats simulated.";
    player.abilityNotice = final ? "Final boss test: max-level abilities online." : `Mid boss test: level ${player.level} combat readiness.`;
    refreshPlayerItemStats(player);
  });
  // The final-boss scenario already includes the first-boss cache in each
  // inventory, so its victory reward should be treated as the second cache.
  state.firstBossRewardGranted = final;
}

function launchMission(players, config) {
  try {
    clearFinalSubmissionDelay();
    clearLockedOperatorAnswerWindow();
    clearSetupToDeploymentTransition();
    stopAllGameSfx();
    const cleanPlayers = players.map((name) => sanitizeText(name, { fallback: "Operator", maxLength: 32 })).filter(Boolean);
    if (!cleanPlayers.length || !config?.questions?.length) {
      setLaunchStatus("Mission could not launch: missing players or questions.", true);
      return;
    }
    setLaunchStatus("Mission launch accepted. Deploying...");
    state.started = true;
    state.chatMode = config.chatMode;
    state.localDmMode = config.localDmMode;
    state.deviceMode = config.deviceMode || "multi";
    syncDeviceModeClass(state.deviceMode);
    state.localDmProvider = config.localDmProvider || selectedLocalDmProvider();
    state.ollamaModel = config.ollamaModel;
    state.resolved = false;
    state.players = cleanPlayers.map((name, index) => combatSystem.normalizePlayer
      ? combatSystem.normalizePlayer({
          name,
          hp: 10,
          status: [],
          incapacitated: false,
          points: 0,
          xp: 0,
          answerStreak: 0,
          classId: config.playerClasses?.[normalize(name)] || combatSystem.CLASS_IDS?.[index % combatSystem.CLASS_IDS.length]
        })
      : { name, hp: 10, maxHp: 10, status: [], incapacitated: false, points: 0, xp: 0, level: 1, answerStreak: 0 });
    state.inventory = { medkits: 2, ems: 0 };
    state.itemCodex = readStoredItemCodex();
    state.pendingRewardChoice = null;
    state.pendingRewardExit = null;
    state.pendingAbilityTarget = null;
    state.classAbilityTargets = {};
    state.classAbilityTargetNotices = {};
    state.pendingClassAbilityUses = [];
    state.pendingAbilityUses = [];
    state.statusRenderSignature = "";
    state.playerLastPublishedVitalsSignature = "";
    state.playerPendingVitalsSignature = "";
    state.playerSessionPublishChain = Promise.resolve();
    state.firstBossRewardGranted = false;
    state.missionType = config.missionType;
    state.environment = config.environment;
    state.title = makeTitle(state.missionType, state.environment);
    state.rng = mulberry32(seedFrom(`${state.title}|${cleanPlayers.join(",")}|${config.questions.length}`));
    scheduleEnemyVisualPreload();
    scheduleBossVisualPreload(state.missionType);
    state.threatProfile = createThreatProfile(state.missionType, state.environment);
    applySetupGeneratedMission(config.generatedMission);
    state.threat = state.threatProfile.identity || state.threatProfile.archetype || state.threatProfile.summary;
    state.currentQuestion = 0;
    state.currentNode = 0;
    state.actionDrivenMode = Boolean(config.actionDrivenMode);
    state.combatTestMode = Boolean(config.combatTestMode && !state.actionDrivenMode);
    const missionQuestions = state.combatTestMode && config.questions.length === 1
      ? [config.questions[0], { ...config.questions[0] }]
      : config.questions;
    state.challengeTypes = buildChallengePlan(missionQuestions.length);
    state.questions = state.actionDrivenMode ? missionQuestions : config.localDmMode || !config.chatMode ? prepareQuestions(missionQuestions, state.challengeTypes) : missionQuestions;
    state.nodes = state.combatTestMode ? buildCombatTestNodes(state.questions.length) : buildNodes(state.questions.length);
    state.mapLayoutSeed = seedFrom(`${state.title}|${cleanPlayers.join(",")}|${config.questions.length}|${Date.now()}|${Math.random()}`);
    state.mapPositions = generateSprawledRoutePositions(state.nodes.length, state.mapLayoutSeed);
    state.mapRevealedNodes = new Set();
    state.mapRenderSignature = "";
    state.roomNames = {};
    state.bossAreaNames = generatedBossAreaFallbacks(state.missionType, state.environment, state.threat);
    applyGeneratedBossAreas(config.generatedMission?.bossAreas);
    state.bossPhasePlans = {};
    state.bossPhasePlanRequests = {};
    state.bossTestMode = Boolean(config.bossTestMode && !state.combatTestMode);
    state.bossTestPhase = config.bossTestPhase === "mid" ? "mid" : "final";
    seedBossTestRoster(state.bossTestPhase);
    state.bossTestPromptStarted = false;
    state.actionRooms = state.actionDrivenMode ? buildActionRooms(config.questions.length) : [];
    state.actionThreatPressure = 0;
    state.actionRoomAttempts = {};
    state.actionReceiptLogKey = "";
    state.actionTurnOrder = shuffleForSession(cleanPlayers);
    state.actionResolutionQueue = null;
    state.combatEncounters = {};
    clearCombatPresentation();
    state.combatStageEnteredNodes = new Set();
    state.activeObstacles = {};
    state.nodeResults = {};
    state.recoveryUsed = new Set();
    state.selectedEMS = false;
    state.secondWindEnabled = Boolean(config.secondWindEnabled);
    state.secondWindUsed = false;
    state.secondWindPlayerName = "";
    state.secondWindPendingPlayerName = "";
    state.challengeHistory = [];
    state.missionAccuracyResults = {};
    state.feedLastId = "";
    state.playerPromptId = "";
    state.playerSyncInFlight = false;
    state.playerHostRevision = 0;
    state.playerServerRevision = 0;
    state.playerServerPromptId = "";
    state.playerSyncFailureCount = 0;
    state.playerPromptRequiredIds = [];
    state.playerPromptRequiredNames = [];
    state.playerPromptRequiredAt = 0;
    state.lockedOperatorWindowPromptId = "";
    state.lockedOperatorWindowDeadline = 0;
    state.playerAnswers = [];
    state.playerActions = [];
    state.queuedPlayerActions = [];
    state.resolutionDelayPending = false;
    state.resolutionDelayPromptId = "";
    state.resolutionDelayTimer = null;
    state.processedPlayerActionIds = new Set();
    state.processedQueuedActionIds = new Set();
    state.scoredPromptIds = new Set();
    state.questionOpenedAt = 0;
    state.questionDurationMs = 60_000;
    state.questionPauseStartedAt = 0;
    state.questionPausedTotalMs = 0;
    state.readinessLogged = false;
    state.currentBriefing = null;
    state.openingLogStory = "";
    state.teamReady = false;
    state.bossReadyPending = false;
    state.bossReadyChecks = new Set();
    state.bossAudioStartedNodes = new Set();
    state.bossMusicStartedNodes = new Set();
    window.clearTimeout(state.bossReadyAudioTimer);
    state.bossReadyAudioTimer = null;
    window.clearTimeout(state.bossEyesExitTimer);
    state.bossEyesExitTimer = null;
    window.clearTimeout(state.bossEyesStrikeTimer);
    state.bossEyesStrikeTimer = null;
    clearBossDamageVisual();
    state.answerPending = false;
    state.lastSubmittedAnswer = "";
    state.previousAnswerFlashId = "";
    state.answerResults = {};
    state.playerAnswerFeedback = {};
    state.sceneHistory = [];
    state.turnHistory = [];
    state.missionLogHistory = [];
    renderMissionLogHistory();
    state.endingPending = false;
    state.sideActionRooms = new Set();
    state.sideActionPending = false;
    state.sideActionWaitingId = "";
    state.narrowedChoices = {};
    state.classHints = {};
    state.sideActionGuard = false;
    state.previousAnswer = null;
    state.emergencyTimerEnabled = config.emergencyTimerEnabled;
    state.emergencyTimerDuration = config.emergencyTimerDuration;
    state.sfxPreset = config.sfxPreset || "subtle";
    state.youtubeMusicUrl = config.youtubeMusicUrl || "";
    state.youtubeBossMusicUrl = config.youtubeBossMusicUrl || "";
    state.useYoutubeMusic = Boolean(config.useYoutubeMusic);
    state.useYoutubeBossMusic = Boolean(config.useYoutubeBossMusic);
    state.youtubeMusicRandomStart = Boolean(config.youtubeMusicRandomStart);
    window.localStorage.setItem("studyAdventureSfxPreset", state.sfxPreset);
    window.localStorage.setItem("studyAdventureYoutubeMusicUrl", state.youtubeMusicUrl);
    window.localStorage.setItem("studyAdventureYoutubeBossMusicUrl", state.youtubeBossMusicUrl);
    window.localStorage.setItem("studyAdventureUseYoutubeMusic", String(state.useYoutubeMusic));
    window.localStorage.setItem("studyAdventureUseYoutubeBossMusic", String(state.useYoutubeBossMusic));
    window.localStorage.setItem("studyAdventureYoutubeMusicRandomStart", String(state.youtubeMusicRandomStart));
    stopMissionFailureAudio();
    stopBackgroundMusic();
    setMissionFailureVisual(false);
    syncBackgroundMusicPanel();
    state.emergencyTimer = null;
    state.transmissionPending = false;
    state.transmissionStartedAt = 0;
    state.routeTransition = null;
    state.playerDevicePanelCollapsed = state.deviceMode === "multi";
    state.deploymentStartedAt = 0;
    state.deploymentCompletionStartedAt = 0;
    state.deploymentCompletionWait = 0;
    state.deploymentReady = false;
    state.questionPresentationReady = false;
    state.questionRevealRunId = 0;
    state.teamFailurePending = false;
    state.logPresentationPending = false;
    state.logPresentationRunId = 0;
    state.joinLobbyActive = false;
    state.pendingMissionConfig = null;

    if (state.bossTestMode && !state.actionDrivenMode) positionMissionForBossTest(state.bossTestPhase);

    if (state.teamReady || !state.chatMode) startNormalBackgroundMusicAfterReady();
    else {
      startIntroSequenceAudio();
      preloadBackgroundMusicTracks();
    }

    resetStatusUpdates();
    els.joinLobby.hidden = true;
    startSetupToDeploymentTransition();
    renderBriefing();
    renderStatus();
    renderMap();
    if (state.deviceMode === "multi") startPlayerSession();
    else {
      state.roomCode = "";
      state.playerParticipants = [];
      state.playerAnswers = [];
      state.playerActions = [];
      state.queuedPlayerActions = [];
      state.processedPlayerActionIds = new Set();
      state.processedQueuedActionIds = new Set();
      renderPlayerSessionPanel();
    }
    beginNextNode();
    if (state.chatMode) startDmFeed();
  } catch (error) {
    console.error("Mission deployment failed", error);
    setLaunchStatus(`Deploy error: ${error.message || error}`, true);
    throw error;
  }
}

function resetMission() {
  if (document.body.classList.contains("dashboard-exiting")) return;
  const message = document.body.classList.contains("mission-active")
    ? "Reset this mission and return to preflight? Current mission progress will be cleared."
    : "Reset the current preflight setup? Unsaved settings will be cleared.";
  if (!els.resetConfirmOverlay) return;
  resetConfirmationReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : els.resetBtn;
  if (els.resetConfirmMessage) els.resetConfirmMessage.textContent = message;
  els.resetConfirmOverlay.hidden = false;
  document.body.classList.add("reset-confirm-open");
  window.requestAnimationFrame(() => {
    els.resetConfirmOverlay?.classList.add("visible");
    els.resetConfirmCancelBtn?.focus();
  });
  playGameSfx("ui");
}

function closeResetConfirmation({ restoreFocus = true, immediate = false } = {}) {
  if (!els.resetConfirmOverlay) return;
  els.resetConfirmOverlay.classList.remove("visible");
  document.body.classList.remove("reset-confirm-open");
  const finish = () => {
    if (!els.resetConfirmOverlay?.classList.contains("visible")) els.resetConfirmOverlay.hidden = true;
    if (restoreFocus && resetConfirmationReturnFocus?.isConnected) resetConfirmationReturnFocus.focus();
    resetConfirmationReturnFocus = null;
  };
  if (immediate) finish();
  else window.setTimeout(finish, 180);
}

function confirmMissionReset() {
  if (!els.resetConfirmOverlay || els.resetConfirmOverlay.hidden) return;
  const missionActive = document.body.classList.contains("mission-active");
  closeResetConfirmation({ restoreFocus: false, immediate: true });
  playGameSfx("ui");
  if (missionActive) {
    startDashboardToSetupTransition();
    return;
  }
  performMissionReset();
}

function performMissionReset({ preserveTransition = false } = {}) {
  roomTransitionTraceFinish("mission reset");
  state.started = false;
  clearFinalSubmissionDelay();
  clearLockedOperatorAnswerWindow();
  if (!preserveTransition) clearSetupToDeploymentTransition();
  clearTypewriters();
  stopTts();
  stopAllGameSfx();
  stopIntroSequenceAudio();
  stopMissionFailureAudio();
  stopBackgroundMusic();
  releaseBackgroundMusicPreloads();
  stopEmergencyTimer();
  stopTransmissionFeedback();
  state.deploymentRunId += 1;
  clearDashboardBootSequence();
  stopDeploymentSequence();
  stopDmFeed();
  stopPlayerSession();
  state.chatMode = false;
  state.localDmMode = false;
  state.deviceMode = selectedDeviceMode();
  state.resolved = false;
  state.questions = [];
  state.players = [];
  state.inventory = { medkits: 2, ems: 0 };
  state.itemCodex = readStoredItemCodex();
  state.pendingRewardChoice = null;
  state.pendingRewardExit = null;
  state.pendingAbilityTarget = null;
  state.classAbilityTargets = {};
  state.classAbilityTargetNotices = {};
  state.pendingClassAbilityUses = [];
  state.pendingAbilityUses = [];
  state.statusRenderSignature = "";
  state.playerLastPublishedVitalsSignature = "";
  state.playerPendingVitalsSignature = "";
  state.playerSessionPublishChain = Promise.resolve();
  state.firstBossRewardGranted = false;
  if (els.itemRewardOverlay) els.itemRewardOverlay.hidden = true;
  if (els.itemCodexOverlay) els.itemCodexOverlay.hidden = true;
  state.setupGeneratedMission = null;
  if (els.generatedEnvironmentNote) els.generatedEnvironmentNote.textContent = GENERATED_ENVIRONMENT_NOTE;
  state.threat = "";
  state.threatProfile = null;
  state.currentQuestion = 0;
  state.currentNode = 0;
  state.nodes = [];
  state.roomNames = {};
  state.mapPositions = [];
  state.mapLayoutSeed = 0;
  state.mapRevealedNodes = new Set();
  state.mapRenderSignature = "";
  state.bossAreaNames = { mid: "", final: "" };
  state.bossPhasePlans = {};
  state.bossPhasePlanRequests = {};
  state.bossTestMode = false;
  state.bossTestPhase = "final";
  state.bossTestPromptStarted = false;
  state.combatTestMode = false;
  state.actionDrivenMode = false;
  state.actionRooms = [];
  state.combatEncounters = {};
  clearCombatPresentation();
  state.combatStageEnteredNodes = new Set();
  state.actionThreatPressure = 0;
  state.actionRoomAttempts = {};
  state.actionReceiptLogKey = "";
  state.actionTurnOrder = [];
  state.activeObstacles = {};
  state.nodeResults = {};
  state.encounter = null;
  state.challengeTypes = [];
  state.challengeHistory = [];
  state.missionAccuracyResults = {};
  state.recoveryUsed = new Set();
  state.selectedEMS = false;
  state.secondWindEnabled = false;
  state.secondWindUsed = false;
  state.secondWindPlayerName = "";
  state.secondWindPendingPlayerName = "";
  state.feedLastId = "";
  state.roomCode = "";
  state.playerPromptId = "";
  state.playerPromptRequiredIds = [];
  state.playerPromptRequiredNames = [];
  state.playerPromptRequiredAt = 0;
  state.lockedOperatorWindowPromptId = "";
  state.lockedOperatorWindowDeadline = 0;
  state.playerAnswers = [];
  state.playerActions = [];
  state.queuedPlayerActions = [];
  state.resolutionDelayPending = false;
  state.resolutionDelayPromptId = "";
  state.resolutionDelayTimer = null;
  state.processedPlayerActionIds = new Set();
  state.processedQueuedActionIds = new Set();
  state.scoredPromptIds = new Set();
  state.questionOpenedAt = 0;
  state.questionDurationMs = 60_000;
  state.questionPauseStartedAt = 0;
  state.questionPausedTotalMs = 0;
  state.playerParticipants = [];
  state.playerJoinUrl = "";
  state.playerJoinUrlReady = false;
  state.joinLobbyActive = false;
  state.pendingMissionConfig = null;
  state.readinessLogged = false;
  state.currentBriefing = null;
  state.openingLogStory = "";
  state.teamReady = false;
  state.bossReadyPending = false;
  state.bossReadyChecks = new Set();
  state.bossAudioStartedNodes = new Set();
  state.bossMusicStartedNodes = new Set();
  window.clearTimeout(state.bossReadyAudioTimer);
  state.bossReadyAudioTimer = null;
  window.clearTimeout(state.bossEyesStrikeTimer);
  state.bossEyesStrikeTimer = null;
  window.clearTimeout(state.bossEyesExitTimer);
  state.bossEyesExitTimer = null;
  clearBossDamageVisual();
  state.answerPending = false;
  state.lastSubmittedAnswer = "";
  state.previousAnswerFlashId = "";
  state.answerResults = {};
  state.playerAnswerFeedback = {};
  state.sceneHistory = [];
  state.turnHistory = [];
  state.endingPending = false;
  state.sideActionRooms = new Set();
  state.sideActionPending = false;
  state.sideActionWaitingId = "";
  state.narrowedChoices = {};
  state.classHints = {};
  state.sideActionGuard = false;
  state.previousAnswer = null;
  state.emergencyTimer = null;
  state.transmissionPending = false;
  state.transmissionStartedAt = 0;
  state.routeTransition = null;
  state.deploymentStartedAt = 0;
  state.deploymentCompletionStartedAt = 0;
  state.deploymentCompletionWait = 0;
  state.deploymentReady = false;
  state.openingWaitStartedAt = 0;
  state.questionPresentationReady = false;
  state.questionRevealRunId = 0;
  state.teamFailurePending = false;
  state.logPresentationPending = false;
  state.logPresentationRunId = 0;
  state.missionLogHistory = [];
  renderMissionLogHistory();
  document.body.classList.remove(
    "mission-active",
    "setup-to-deployment",
    "dashboard-online",
    "boss-theme-active",
    "situation-boss",
    "situation-emergency",
    "situation-recovery",
    "situation-party-wounded",
    "situation-party-critical",
    "situation-failure",
    "mission-log-streaming"
  );
  delete document.body.dataset.missionTheme;
  delete document.body.dataset.bossVisual;
  setMissionFailureVisual(false);
  stopOpeningWaitCounter();
  els.setupPanel.style.display = "";
  els.joinLobby.hidden = true;
  els.playersInput.value = "";
  singleDeviceClassAssignments.clear();
  els.startBtn.disabled = false;
  els.launchFromLobbyBtn.textContent = "Launch Mission";
  els.launchFromLobbyBtn.disabled = true;
  if (els.addSimPlayersBtn) {
    els.addSimPlayersBtn.disabled = false;
    els.addSimPlayersBtn.textContent = "Add 3 Sim Players";
  }
  setLaunchStatus("");
  syncSetupMode();
  els.briefingCard.classList.remove("briefing-collapsed");
  els.briefingCard.innerHTML = `<p class="eyebrow">Briefing</p><h2>Ready for orders</h2><p>Start a mission to generate the briefing, player state, dungeon route, and first challenge.</p>`;
  resetStatusUpdates();
  els.statusGrid.innerHTML = "";
  els.encounterCard.innerHTML = placeholderTransmissionHtml();
  els.answerControls.innerHTML = "";
  els.mapTitle.textContent = "Awaiting Mission";
  els.progressPill.textContent = "0 / 0";
  els.progressSummary.textContent = "0 / 0 questions resolved";
  els.inventoryActions.innerHTML = "";
  renderPlayerSessionPanel();
  renderPreviousAnswer();
  renderRouteTelemetry();
  renderMapEmergencyTimer();
  els.missionMap.innerHTML = "";
}

function startDmFeed() {
  stopDmFeed();
  state.feedPollTimer = window.setInterval(checkDmFeed, 500);
  checkDmFeed();
}

function stopDmFeed() {
  if (state.feedPollTimer) {
    window.clearInterval(state.feedPollTimer);
    state.feedPollTimer = null;
  }
}

function openJoinLobby(config) {
  state.pendingMissionConfig = config;
  state.deviceMode = "multi";
  state.joinLobbyActive = true;
  state.started = false;
  state.roomCode = "";
  state.playerPromptId = "";
  state.playerSyncInFlight = false;
  state.playerHostRevision = 0;
  state.playerServerRevision = 0;
  state.playerServerPromptId = "";
  state.playerSyncFailureCount = 0;
  state.playerPromptRequiredIds = [];
  state.playerPromptRequiredNames = [];
  state.playerPromptRequiredAt = 0;
  state.playerAnswers = [];
  state.playerActions = [];
  state.processedPlayerActionIds = new Set();
  state.playerParticipants = [];
  state.playerJoinUrl = "";
  state.playerJoinUrlReady = false;
  els.joinLobby.hidden = false;
  els.startBtn.disabled = true;
  stopPlayerPolling();
  state.playerPollTimer = window.setInterval(pollPlayerAnswers, 350);
  adoptOrCreateLobby(config);
}

function adoptOrCreateLobby(config) {
  playerSessionApi.fetchSession()
    .catch(() => null)
    .then((session) => {
      const canReuse = session?.status === "lobby" && session.roomCode && Array.isArray(session.participants) && session.participants.length > 0;
      state.roomCode = canReuse ? session.roomCode : makeRoomCode();
      state.playerParticipants = canReuse ? session.participants : [];
      loadPlayerJoinUrl();
      return publishPlayerSession({
        status: "lobby",
        title: "Squad Join Lobby",
        players: [],
        prompt: null,
        resetAnswers: true
      });
    })
    .then(() => {
      pollPlayerAnswers();
      renderJoinLobby();
    });
}

function closeJoinLobby() {
  state.joinLobbyActive = false;
  state.pendingMissionConfig = null;
  els.joinLobby.hidden = true;
  els.startBtn.disabled = false;
  stopPlayerSession();
}

function launchMissionFromLobby() {
  setLaunchStatus("Checking connected players...");
  els.launchFromLobbyBtn.disabled = true;
  els.launchFromLobbyBtn.textContent = "Launching...";
  playerSessionApi.fetchSession()
    .catch(() => null)
    .then((session) => {
      if (session?.participants) state.playerParticipants = session.participants;
      const players = state.playerParticipants
        .map((player) => sanitizeText(player.name, { fallback: "Operator", maxLength: 32 }))
        .filter(Boolean);
      const config = state.pendingMissionConfig || readMissionConfig();
      if (!config || players.length < 1) {
        els.launchFromLobbyBtn.textContent = "Launch Mission";
        renderJoinLobby();
        els.lobbyJoinHelp.textContent = players.length < 1
          ? "No connected players found yet. Have students join, then try Launch Mission again."
          : "Mission setup is incomplete. Check questions and settings, then try again.";
        setLaunchStatus(players.length < 1 ? "No connected players found in this room." : "Mission setup is incomplete.", true);
        return;
      }
      const missingClasses = state.playerParticipants.filter((player) => !combatSystem.classDefinition?.(player.classId));
      const selectedClasses = state.playerParticipants.map((player) => player.classId).filter(Boolean);
      if (players.length > (combatSystem.CLASS_IDS?.length || 6) || missingClasses.length || new Set(selectedClasses).size !== selectedClasses.length) {
        els.launchFromLobbyBtn.textContent = "Launch Mission";
        els.launchFromLobbyBtn.disabled = false;
        els.lobbyJoinHelp.textContent = players.length > 6
          ? "Class missions currently support up to six players."
          : "Every player must reserve a unique class before launch.";
        setLaunchStatus(els.lobbyJoinHelp.textContent, true);
        return;
      }
      const playerClasses = Object.fromEntries(state.playerParticipants.map((player) => [normalize(player.name), player.classId]));
      setLaunchStatus(`Launching mission with ${players.length} player${players.length === 1 ? "" : "s"}...`);
      launchMission(players, { ...config, deviceMode: "multi", playerClasses });
    })
    .catch((error) => {
      logDebugEvent({
        kind: "error",
        label: "Lobby launch recovered",
        detail: String(error?.message || error || "mission launch failed").slice(0, 500)
      });
      state.started = false;
      els.launchFromLobbyBtn.textContent = "Launch Mission";
      els.launchFromLobbyBtn.disabled = false;
      setLaunchStatus(`Launch failed: ${error?.message || error || "try again"}`, true);
      if (state.joinLobbyActive) renderJoinLobby();
    });
}

function setLaunchStatus(message, isError = false) {
  if (!els.launchStatus) return;
  els.launchStatus.textContent = message || "";
  els.launchStatus.classList.toggle("error", Boolean(isError));
}

function restoreLobbyFromServer() {
  if (state.started || state.joinLobbyActive) return;
  playerSessionApi.fetchSession()
    .then((session) => {
      if (!session || session.status !== "lobby" || !session.roomCode || !session.participants?.length) return;
      if (!getSetupStudyQuestions().length) return;
      const config = readMissionConfig();
      if (!config) return;
      state.pendingMissionConfig = { ...config, deviceMode: "multi" };
      state.deviceMode = "multi";
      if (els.deviceModeMulti) els.deviceModeMulti.checked = true;
      state.joinLobbyActive = true;
      state.roomCode = session.roomCode;
      state.playerParticipants = session.participants || [];
      state.playerAnswers = [];
      state.playerActions = [];
      state.processedPlayerActionIds = new Set();
      loadPlayerJoinUrl();
      els.joinLobby.hidden = false;
      els.startBtn.disabled = true;
      stopPlayerPolling();
      state.playerPollTimer = window.setInterval(pollPlayerAnswers, 350);
      renderJoinLobby();
    })
    .catch(() => {});
}

function startPlayerSession() {
  loadPlayerJoinUrl();
  renderPlayerSessionPanel();
  publishPlayerSession({ status: "briefing", prompt: null, resetAnswers: true, resetQueuedActions: true });
  stopPlayerPolling();
  state.playerPollTimer = window.setInterval(pollPlayerAnswers, 350);
  pollPlayerAnswers();
}

function loadPlayerJoinUrl() {
  state.playerJoinUrl = defaultPlayerJoinUrl();
  if (isPublicJoinOrigin()) {
    state.playerJoinUrlReady = true;
    renderPlayerSessionPanel();
    renderJoinLobby();
    return;
  }
  state.playerJoinUrlReady = false;
  playerSessionApi.fetchHostInfo()
    .then((info) => {
      const serverJoinUrl = String(info?.playerJoinUrlBase || "").trim();
      if (/^https?:\/\/.+\/player\.html$/i.test(serverJoinUrl)) {
        state.playerJoinUrl = serverJoinUrl;
        state.playerJoinUrlReady = true;
        renderPlayerSessionPanel();
        renderJoinLobby();
        return;
      }
      const address = preferredJoinAddress(info?.addresses || []);
      if (!address) {
        state.playerJoinUrlReady = true;
        renderPlayerSessionPanel();
        renderJoinLobby();
        return;
      }
      state.playerJoinUrl = `${safeJoinProtocol()}//${address}:${info.port || safeJoinPort()}/player.html`;
      state.playerJoinUrlReady = true;
      renderPlayerSessionPanel();
      renderJoinLobby();
    })
    .catch(() => {
      state.playerJoinUrlReady = true;
      renderPlayerSessionPanel();
      renderJoinLobby();
    });
}

function safeJoinProtocol() {
  return playerSessionApi.safeJoinProtocol?.() || (window.location.protocol === "https:" ? "https:" : "http:");
}

function safeJoinPort() {
  return playerSessionApi.safeJoinPort?.() || window.location.port || 4174;
}

function defaultPlayerJoinUrl() {
  return playerSessionApi.defaultPlayerJoinUrl?.() || `${safeJoinProtocol()}//localhost:${safeJoinPort()}/player.html`;
}

function isPublicJoinOrigin() {
  return Boolean(playerSessionApi.isPublicJoinOrigin?.());
}

function currentPlayerJoinUrl() {
  const candidate = String(state.playerJoinUrl || "");
  if (/^https?:\/\//i.test(candidate)) return candidate;
  return defaultPlayerJoinUrl();
}

function playerJoinUrlForRoom(options = {}) {
  const baseJoinUrl = currentPlayerJoinUrl();
  if (typeof playerSessionApi.playerJoinUrlForRoom === "function") {
    return playerSessionApi.playerJoinUrlForRoom(baseJoinUrl, state.roomCode, options);
  }
  return `${baseJoinUrl}?room=${encodeURIComponent(state.roomCode || "")}`;
}

function preferredJoinAddress(addresses) {
  return playerSessionApi.preferredJoinAddress?.(addresses) || "";
}

function renderJoinLobby() {
  if (!els.joinLobby || !state.joinLobbyActive) return;
  els.launchFromLobbyBtn.textContent = "Launch Mission";
  const joinUrl = playerJoinUrlForRoom();
  const qrJoinUrl = playerJoinUrlForRoom({ compact: true });
  els.lobbyRoomCode.textContent = state.roomCode || "----";
  els.lobbyJoinLink.href = joinUrl;
  if (!state.playerJoinUrlReady && window.location.hostname === "localhost") {
    els.lobbyJoinHelp.textContent = "Building phone join link...";
    els.lobbyQrCode.innerHTML = "<p class=\"muted-small\">Waiting for network address.</p>";
  } else {
    els.lobbyJoinHelp.textContent = `Scan the QR code or open ${joinUrl}.`;
    try {
      els.lobbyQrCode.innerHTML = qrSvg(qrJoinUrl);
    } catch {
      els.lobbyQrCode.textContent = qrJoinUrl;
    }
  }
  els.lobbyPlayerList.innerHTML = state.playerParticipants.length
    ? state.playerParticipants.map((player) => `
      <div class="lobby-player">
          <strong class="player-colored-name" style="--player-color:${playerColor(player.name, state.playerParticipants.indexOf(player))}">${escapeHtml(player.name)}</strong>
        <div class="lobby-player-actions">
          <span>${escapeHtml(combatSystem.classDefinition?.(player.classId)?.label || "Choose class")}</span>
          <button class="secondary removePlayerBtn" type="button" data-player-id="${escapeAttribute(player.id)}" data-player-name="${escapeAttribute(player.name)}">Remove</button>
        </div>
      </div>
    `).join("")
    : "<p class=\"muted-small\">No players have joined yet.</p>";
  const classesReady = state.playerParticipants.length > 0
    && state.playerParticipants.length <= (combatSystem.CLASS_IDS?.length || 6)
    && state.playerParticipants.every((player) => combatSystem.classDefinition?.(player.classId))
    && new Set(state.playerParticipants.map((player) => player.classId)).size === state.playerParticipants.length;
  els.launchFromLobbyBtn.disabled = !classesReady;
  bindRemovePlayerButtons();
}

function addSimulatedPlayers(count = 3) {
  if (!state.joinLobbyActive || !state.roomCode) return;
  const names = randomSimulatorNames(count);
  if (els.addSimPlayersBtn) {
    els.addSimPlayersBtn.disabled = true;
    els.addSimPlayersBtn.textContent = "Adding...";
  }
  Promise.all(names.map((name) => playerSessionApi.joinPlayer(state.roomCode, name, { simulated: true })))
    .then((payloads) => {
      const session = payloads.find((payload) => payload?.session)?.session;
      if (session) state.playerParticipants = session.participants || state.playerParticipants;
      renderJoinLobby();
    })
    .finally(() => {
      if (els.addSimPlayersBtn) {
        els.addSimPlayersBtn.disabled = false;
        els.addSimPlayersBtn.textContent = "Add 3 Sim Players";
      }
    });
}

function randomSimulatorNames(count) {
  const existing = new Set([
    ...state.playerParticipants.map((player) => normalize(player.name)),
    ...setupRosterPlayers().map((name) => normalize(name))
  ]);
  const available = simulatorNamePool.filter((name) => !existing.has(normalize(name)));
  const shuffled = [...available].sort(() => Math.random() - 0.5);
  const names = shuffled.slice(0, count);
  let suffix = 1;
  while (names.length < count) {
    const fallback = `Sim${suffix}`;
    suffix += 1;
    if (!existing.has(normalize(fallback)) && !names.some((name) => sameName(name, fallback))) names.push(fallback);
  }
  return names;
}

function stopPlayerSession() {
  stopPlayerPolling();
  clearLockedOperatorAnswerWindow();
  clearPromptPublicationRetry();
  cancelSimulatorAutoAnswerTimers();
  cancelSimulatorAwareAbilityTimers();
  if (state.roomCode) publishPlayerSession({ status: "ended", prompt: null, resetAnswers: true, resetQueuedActions: true, resetParticipants: true });
  state.playerAnswers = [];
  state.playerActions = [];
  state.queuedPlayerActions = [];
  state.processedPlayerActionIds = new Set();
  state.processedQueuedActionIds = new Set();
  state.playerParticipants = [];
  renderPlayerSessionPanel();
}

function stopPlayerPolling() {
  if (state.playerPollTimer) {
    window.clearInterval(state.playerPollTimer);
    state.playerPollTimer = null;
  }
  state.playerSyncInFlight = false;
}

function ensurePlayerAnswerPolling() {
  if (!state.started || state.deviceMode !== "multi" || !state.roomCode || state.playerPollTimer) return;
  state.playerPollTimer = window.setInterval(pollPlayerAnswers, 350);
  window.setTimeout(pollPlayerAnswers, 0);
}

function publishPlayerSession(extra = {}) {
  if (!state.roomCode) return Promise.resolve(null);
  const roomCode = state.roomCode;
  state.playerHostRevision += 1;
  const requestedPrompt = extra.prompt === undefined ? buildPlayerPrompt() : extra.prompt;
  const activeNode = state.nodes?.[state.currentNode];
  const activeBossVisualId = activeNode?.type === "boss"
    ? bossVisualProfileForNode(activeNode)?.id || ""
    : "";
  const payload = {
    roomCode,
    status: extra.status || (state.questionPresentationReady ? "open" : "waiting"),
    title: extra.title || state.title,
    players: extra.players || state.players.map((player) => player.name),
    playerStates: extra.playerStates || playerStatePayload(),
    actionCooldownMs: state.actionDrivenMode ? 0 : PLAYER_ACTION_COOLDOWN_MS,
    allowQueuedPlayerActions: Boolean(state.started && state.teamReady && state.localDmMode && state.deviceMode === "multi" && !state.actionDrivenMode),
    bossVisualId: extra.bossVisualId === undefined ? activeBossVisualId : String(extra.bossVisualId || ""),
    prompt: requestedPrompt,
    resetAnswers: Boolean(extra.resetAnswers),
    resetQueuedActions: Boolean(extra.resetQueuedActions),
    resetParticipants: Boolean(extra.resetParticipants),
    hostRevision: state.playerHostRevision,
    expectedPromptId: requestedPrompt === null ? String(extra.expectedPromptId || state.playerPromptId || state.playerServerPromptId || "") : ""
  };
  // Host updates must be serialized. Rendering, prompt repair, timer updates,
  // and answer resolution can all publish within the same polling interval;
  // concurrent requests arrive out of order and the server correctly rejects
  // the older host revision, leaving the client stuck between prompt states.
  const publish = () => playerSessionApi.publishSession(payload).then((result) => {
    if (result?.session) state.playerLastPublishedVitalsSignature = JSON.stringify(payload.playerStates);
    const session = result?.session;
    if (session && state.roomCode === roomCode) {
      state.playerServerRevision = Math.max(state.playerServerRevision, Number(session.revision) || 0);
      state.playerServerPromptId = session.prompt?.id || "";
      state.playerHostRevision = Math.max(state.playerHostRevision, Number(session.hostRevision) || 0);
    }
    return result;
  });
  const publication = state.playerSessionPublishChain.then(publish, publish);
  state.playerSessionPublishChain = publication.catch(() => null);
  return publication;
}

function publishPlayerVitals() {
  if (!state.roomCode || state.joinLobbyActive || !state.started || state.deviceMode !== "multi") return;
  const playerStates = playerStatePayload();
  const signature = JSON.stringify(playerStates);
  if (signature === state.playerLastPublishedVitalsSignature || signature === state.playerPendingVitalsSignature) return;
  state.playerPendingVitalsSignature = signature;
  publishPlayerSession({ playerStates, resetAnswers: false }).catch(() => null).finally(() => {
    if (state.playerPendingVitalsSignature === signature) state.playerPendingVitalsSignature = "";
  });
}

function clearPromptPublicationRetry(promptId = "") {
  if (promptId && state.playerPromptPublicationRetryId && state.playerPromptPublicationRetryId !== promptId) return;
  if (state.playerPromptPublicationRetryTimer) window.clearTimeout(state.playerPromptPublicationRetryTimer);
  state.playerPromptPublicationRetryTimer = null;
  state.playerPromptPublicationRetryId = "";
  state.playerPromptPublicationRetryAttempt = 0;
}

function schedulePromptPublicationRepair(promptId, attempt = 0) {
  if (!promptId || promptId !== state.playerPromptId || state.resolved || attempt > PLAYER_PROMPT_PUBLICATION_MAX_RETRIES) return;
  if (state.playerPromptPublicationRetryTimer
    && state.playerPromptPublicationRetryId === promptId
    && state.playerPromptPublicationRetryAttempt <= attempt) return;
  if (state.playerPromptPublicationRetryTimer) window.clearTimeout(state.playerPromptPublicationRetryTimer);
  state.playerPromptPublicationRetryId = promptId;
  state.playerPromptPublicationRetryAttempt = attempt;
  state.playerPromptPublicationRetryTimer = window.setTimeout(() => {
    state.playerPromptPublicationRetryTimer = null;
    repairCurrentPromptPublication(promptId).then((result) => {
      const session = result?.session;
      const synchronized = session?.status === "open" && session?.prompt?.id === promptId;
      if (synchronized) {
        clearPromptPublicationRetry(promptId);
        return;
      }
      if (promptId === state.playerPromptId && !state.resolved) {
        schedulePromptPublicationRepair(promptId, attempt + 1);
      }
    });
  }, PLAYER_PROMPT_PUBLICATION_RETRY_MS + attempt * 500);
}

function playerTimerPayload() {
  const timer = state.emergencyTimer;
  if (!timer) return null;
  return {
    label: timer.label || "Challenge Window",
    durationMs: timer.durationMs,
    remainingMs: Math.max(0, timer.remainingMs),
    deadline: timer.deadline,
    paused: Boolean(timer.paused),
    starting: Boolean(timer.starting),
    kind: timer.kind || ""
  };
}

function sideActionBlocksPlayerAnswers() {
  return state.sideActionPending
    && !(state.deviceMode === "multi" && state.localDmMode && !state.actionDrivenMode);
}

function playerStatePayload() {
  return state.players.map((player) => {
    const displayedHp = state.combatDisplayedHp[normalize(player.name)];
    const hp = Number.isFinite(displayedHp) ? displayedHp : player.hp;
    return {
    name: player.name,
    hp: Math.max(0, hp),
    maxHp: Math.max(10, Number(player.maxHp) || 10),
    status: [...player.status],
    incapacitated: Boolean(player.incapacitated) || hp <= 0,
    points: Math.max(0, Math.round(Number(player.points) || 0)),
    xp: Math.max(0, Math.round(Number(player.xp) || 0)),
    level: Math.max(1, Math.round(Number(player.level) || 1)),
    answerStreak: Math.max(0, Math.round(Number(player.answerStreak) || 0)),
    enforcerReserve: player.classId === "enforcer" ? Math.max(0, Math.round(Number(player.enforcerReserve) || 0)) : 0,
    classId: player.classId || "",
    classLabel: combatSystem.classDefinition?.(player.classId)?.label || "Operator",
    classGear: player.classGear || combatSystem.classDefinition?.(player.classId)?.gear || "",
    classColor: player.classColor || combatSystem.classDefinition?.(player.classId)?.color || "",
    items: Array.isArray(player.items) ? player.items.slice(0, 2) : [],
    equippedItem: player.equippedItem || null,
    classCooldowns: { ...(player.classCooldowns || {}) },
    abilityUsedThisTurn: abilityUsedThisTurn(player),
    itemNotice: player.itemNotice || "",
    abilityNotice: player.abilityNotice || state.classAbilityTargetNotices?.[normalize(player.name)] || "",
    answerFeedback: state.playerAnswerFeedback?.[normalize(player.name)] || null
    };
  });
}

function currentAbilityTurnKey() {
  const encounter = isCombatNode(state.nodes[state.currentNode]) ? state.combatEncounters?.[state.currentNode] : null;
  return `${state.currentNode}:${state.currentQuestion}:${Number(encounter?.round) || 0}`;
}

function abilityUsedThisTurn(player) {
  return Boolean(player?._abilityTurnKey && player._abilityTurnKey === currentAbilityTurnKey());
}

function activateScoutHintForPrompt(info, scout = null) {
  if (!info?.question || !scout || state.classHints[state.currentQuestion]) return;
  let hint = "";
  if (info.question.mode === "multiple") {
    const removable = info.question.choices?.filter((choice) => choice.key !== info.question.answerKey) || [];
    const removeCount = scout.level >= 3 ? 2 : 1;
    const removed = removable.sort(() => state.rng() - 0.5).slice(0, removeCount);
    if (removed.length) {
      state.narrowedChoices[state.currentQuestion] = [...new Set([...(state.narrowedChoices[state.currentQuestion] || []), ...removed.map((choice) => choice.key)])];
      hint = scout.level >= 3
        ? `${scout.name}'s upgraded Spectrum Analyzer eliminates options ${removed.map((choice) => choice.key).join(" and ")}.`
        : `${scout.name}'s Spectrum Analyzer eliminates option ${removed[0].key}.`;
    }
  } else {
    const answer = String(info.question.answerText || "").trim();
    if (answer) hint = `${scout.name}'s Spectrum Analyzer reveals that the answer begins with “${answer[0].toUpperCase()}”.`;
  }
  if (!hint) return;
  state.classHints[state.currentQuestion] = hint;
  markCombatCooldown(scout, "spectrum-analyzer");
}

function activateCurrentQuestionHint(source, label = "Hint") {
  const info = currentQuestionInfo();
  if (!info?.question || !source || state.classHints[state.currentQuestion]) return false;
  const answer = String(info.question.answerText || "").trim();
  state.classHints[state.currentQuestion] = answer
    ? `${source.name}'s ${label} reveals a clue beginning with “${answer.slice(0, 1).toUpperCase()}”.`
    : `${source.name}'s ${label} highlights the active prompt.`;
  renderChatControls();
  renderMapQuestionOverlay();
  return true;
}

function buildPlayerPrompt() {
  const node = state.nodes[state.currentNode];
  if (node?.type === "recovery") {
    const { hp, medkits, ems } = recoveryAmounts(node.tier);
    const promptId = `recovery-${state.currentNode}-${node.tier}`;
    state.playerPromptId = promptId;
    return {
      id: promptId,
      questionIndex: state.currentQuestion,
      nodeIndex: state.currentNode,
      title: state.title,
      areaName: recoveryAreaName(node),
      challengeLabel: node.tier === 1 ? "Recovery Event" : "Major Recovery Event",
      kind: "recovery",
      lockedPlayer: "",
      allowPlayerActions: false,
      accepting: state.questionPresentationReady && !state.answerPending && !state.resolutionDelayPending && !sideActionBlocksPlayerAnswers() && !state.resolved,
      mode: "multiple",
      question: "Choose one recovery option.",
      choices: [
        { key: "A", text: `Everyone active recovers ${hp} HP` },
        { key: "B", text: `Gain ${medkits} Medkits` },
        { key: "C", text: `Gain ${ems} EMS Device${ems > 1 ? "s" : ""}` }
      ]
    };
  }
  const info = currentQuestionInfo();
  if (!info.question) return null;
  const combatEncounter = isCombatNode(node) ? currentCombatEncounter() : null;
  const promptId = `${state.currentQuestion}-${state.currentNode}-${info.question.mode}-${info.type.kind}${combatEncounter ? `-r${combatEncounter.round}` : ""}`;
  state.playerPromptId = promptId;
  return {
    id: promptId,
    questionIndex: state.currentQuestion,
    nodeIndex: state.currentNode,
    title: state.title,
    areaName: info.areaName,
    challengeLabel: info.type.label,
    kind: info.type.kind,
    actionOnly: Boolean(state.actionDrivenMode),
    boss: Boolean(info.type.boss),
    bossVisualId: node?.type === "boss" ? bossVisualProfileForNode(node)?.id || "" : "",
    bossStep: info.type.bossStep || 0,
    bossTotal: info.type.bossTotal || 0,
    bossPhase: info.type.bossPhase || "",
    combat: combatEncounter ? {
      hp: combatEncounter.hp,
      maxHp: combatEncounter.maxHp,
      enemyCount: combatEncounter.enemies.filter((enemy) => !enemy.defeated).length,
      round: combatEncounter.round + 1,
      boss: node?.type === "boss",
      intent: combatIntentText(info.type, info.operator)
    } : null,
    classHint: state.classHints[state.currentQuestion] || "",
    lockedPlayer: info.operator?.name || "",
    allowPlayerActions: actionsAllowedThisEncounter(),
    accepting: state.questionPresentationReady && !state.answerPending && !state.resolutionDelayPending && !sideActionBlocksPlayerAnswers() && !state.resolved,
    timer: playerTimerPayload(),
    mode: info.question.mode,
    question: displayQuestionText(info.question),
    choices: info.question.mode === "multiple"
      ? info.question.choices
          .filter((choice) => !(state.narrowedChoices[state.currentQuestion] || []).includes(choice.key))
          .map((choice) => ({ key: choice.key, text: choice.text }))
      : []
  };
}

function publishCurrentPlayerPrompt(options = {}) {
  if (!state.started || !state.teamReady && state.chatMode) return;
  const transitionStep = roomTransitionTraceStepStart("publish player prompt", {
    deviceMode: state.deviceMode,
    roomCode: state.roomCode || ""
  });
  ensurePlayerAnswerPolling();
  clearFinalSubmissionDelay();
  clearLockedOperatorAnswerWindow();
  cancelSimulatorAutoAnswerTimers();
  cancelSimulatorAwareAbilityTimers();
  const prompt = buildPlayerPrompt();
  clearPromptPublicationRetry();
  state.playerSubmissionLogKey = `${prompt?.id || ""}|reset`;
  state.playerAnswers = [];
  state.playerActions = [];
  snapshotPromptRequiredResponders(prompt);
  const publication = publishPlayerSession({ status: "open", prompt, resetAnswers: true });
  let publicationCompletion = Promise.resolve(publication);
  if (state.deviceMode === "multi" && state.roomCode) {
    publicationCompletion = publicationCompletion.then((result) => {
      const synchronized = result?.session?.status === "open" && result?.session?.prompt?.id === prompt?.id;
      if (!synchronized && prompt?.id === state.playerPromptId && !state.resolved) {
        schedulePromptPublicationRepair(prompt.id);
      }
      startBossQuestionMusic();
      return result;
    }).catch(() => {
      if (prompt?.id === state.playerPromptId && !state.resolved) schedulePromptPublicationRepair(prompt.id);
    });
  } else {
    startBossQuestionMusic();
  }
  renderStatus();
  if (options.renderOverlay !== false) renderMapQuestionOverlay();
  return publicationCompletion.finally(() => {
    roomTransitionTraceStepEnd(transitionStep, {
      promptId: prompt?.id || "",
      accepting: Boolean(prompt?.accepting)
    });
    roomTransitionTraceFinish("question ready and prompt published", { promptId: prompt?.id || "" });
  });
}

function clearFinalSubmissionDelay() {
  if (state.resolutionDelayTimer) window.clearTimeout(state.resolutionDelayTimer);
  state.resolutionDelayTimer = null;
  state.resolutionDelayPending = false;
  state.resolutionDelayPromptId = "";
  state.resolutionDelayStartedAt = 0;
  state.resolutionDelayCallback = null;
  state.resolutionDelayAttempts = 0;
  document.body.classList.remove("answer-resolution-queued");
}

function completeFinalSubmissionResolution(promptId) {
  if (!state.resolutionDelayPending || state.resolutionDelayPromptId !== promptId) return false;
  const callback = state.resolutionDelayCallback;
  const attempt = state.resolutionDelayAttempts;
  const stillCurrent = state.started
    && state.playerPromptId === promptId
    && !state.answerPending
    && !state.resolved;
  if (state.resolutionDelayTimer) window.clearTimeout(state.resolutionDelayTimer);
  state.resolutionDelayTimer = null;
  state.resolutionDelayPending = false;
  state.resolutionDelayPromptId = "";
  state.resolutionDelayStartedAt = 0;
  state.resolutionDelayCallback = null;
  document.body.classList.remove("answer-resolution-queued");
  if (stillCurrent && typeof callback === "function") {
    const completed = callback();
    // A stale responder snapshot or a competing local answer used to make the
    // callback return without advancing. Retry a bounded number of times using
    // the same prompt instead of allowing every poll to create a new hold.
    if (completed === false && state.started && state.playerPromptId === promptId && !state.resolved) {
      if (attempt < 3) {
        window.setTimeout(() => {
          if (state.started && state.playerPromptId === promptId && !state.resolved && !state.answerPending) {
            queueFinalSubmissionResolution(callback, "retrying blocked submission resolution");
          }
        }, 120);
      } else {
        logDebugEvent({
          kind: "error",
          label: "Submission resolution blocked",
          detail: `${promptId} | callback guard rejected after ${attempt} retries`
        });
      }
    }
  } else if (!stillCurrent && state.started && state.playerPromptId === promptId && !state.resolved) {
    logDebugEvent({
      kind: "state",
      label: "Submission hold skipped",
      detail: `${promptId} | answerPending=${state.answerPending} resolved=${state.resolved}`
    });
  }
  return stillCurrent;
}

function recoverOverdueSubmissionResolution() {
  if (!state.resolutionDelayPending || !state.resolutionDelayPromptId || !state.resolutionDelayStartedAt) return;
  if (Date.now() - state.resolutionDelayStartedAt < FINAL_SUBMISSION_HOLD_MS + 1_500) return;
  logDebugEvent({
    kind: "state",
    label: "Submission hold recovered by sync watchdog",
    detail: state.resolutionDelayPromptId
  });
  completeFinalSubmissionResolution(state.resolutionDelayPromptId);
}

function queueFinalSubmissionResolution(callback, label = "required responses complete") {
  const promptId = state.playerPromptId || buildPlayerPrompt()?.id || "";
  if (!promptId || state.resolutionDelayPending || state.answerPending || state.resolved) return false;

  state.resolutionDelayPending = true;
  state.resolutionDelayPromptId = promptId;
  state.resolutionDelayStartedAt = Date.now();
  state.resolutionDelayCallback = callback;
  state.resolutionDelayAttempts = Math.max(0, Number(state.resolutionDelayAttempts) || 0) + 1;
  stopTts();
  stopEmergencyTimer();
  document.body.classList.add("answer-resolution-queued");
  renderMapQuestionOverlay();
  if (state.deviceMode === "multi" && state.roomCode) {
    publishPlayerSession({ status: "open", prompt: buildPlayerPrompt(), resetAnswers: false });
  }
  logDebugEvent({
    kind: "state",
    label: "Final submission hold",
    detail: `${promptId} | ${label} | ${FINAL_SUBMISSION_HOLD_MS}ms`
  });

  state.resolutionDelayTimer = window.setTimeout(() => {
    completeFinalSubmissionResolution(promptId);
  }, FINAL_SUBMISSION_HOLD_MS);
  return true;
}

function clearPendingPlayerPromptState(options = {}) {
  clearFinalSubmissionDelay();
  clearLockedOperatorAnswerWindow();
  clearPromptPublicationRetry();
  cancelSimulatorAutoAnswerTimers();
  cancelSimulatorAwareAbilityTimers();
  state.playerAnswers = [];
  state.playerActions = [];
  state.playerSubmissionLogKey = "pending-reset";
  if (options.publish !== false && state.started && state.roomCode && state.deviceMode === "multi") {
    publishPlayerSession({ status: options.status || "waiting", prompt: null, resetAnswers: true });
  }
  renderStatus();
  renderMapQuestionOverlay();
  renderPlayerSessionPanel();
}

function publishPlayerWaiting(status = "waiting") {
  publishPlayerSession({ status, prompt: buildPlayerPrompt(), resetAnswers: false });
}

function pollPlayerAnswers() {
  if (!state.roomCode) return;
  if (document.hidden) return;
  if (state.playerSyncInFlight) return;
  if (state.joinLobbyActive) {
    state.playerSyncInFlight = true;
    playerSessionApi.fetchSession()
      .then((session) => {
        state.playerParticipants = session?.participants || [];
        renderJoinLobby();
      })
      .catch(() => {})
      .finally(() => {
        state.playerSyncInFlight = false;
      });
    return;
  }
  if (!state.started) return;
  const promptId = state.playerPromptId || buildPlayerPrompt()?.id || "";
  const syncRoomCode = state.roomCode;
  state.playerSyncInFlight = true;
  const syncRequest = typeof playerSessionApi.fetchSync === "function"
    ? playerSessionApi.fetchSync(state.roomCode, promptId, state.playerServerRevision)
    : Promise.all([
        playerSessionApi.fetchAnswers(state.roomCode, promptId),
        playerSessionApi.fetchSession().catch(() => null)
      ]).then(([payload, session]) => ({ ...payload, session }));
  syncRequest
    .then((payload) => {
      if (!state.started || state.roomCode !== syncRoomCode) return;
      if (payload?.unchanged) {
        if (Array.isArray(payload.participants)) state.playerParticipants = payload.participants;
        recoverOverdueSubmissionResolution();
        return;
      }
      if (state.playerSyncFailureCount >= 3) {
        logDebugEvent({
          kind: "state",
          label: "Player synchronization restored",
          detail: `${syncRoomCode} reconnected after ${state.playerSyncFailureCount} failed polls`
        });
      }
      state.playerSyncFailureCount = 0;
      const session = payload?.session || null;
      if (session) {
        state.playerServerRevision = Math.max(state.playerServerRevision, Number(session.revision) || 0);
        state.playerServerPromptId = session.prompt?.id || "";
        state.playerHostRevision = Math.max(state.playerHostRevision, Number(session.hostRevision) || 0);
      }
      const questionVisible = Boolean(els.mapQuestionOverlay && !els.mapQuestionOverlay.hidden);
      const localPromptActive = Boolean(promptId && !state.answerPending && !state.resolutionDelayPending && !state.resolved
        && (state.questionPresentationReady || questionVisible));
      const serverPromptAccepting = Boolean(session?.status === "open" && session?.prompt?.accepting);
      if (localPromptActive && (session?.prompt?.id !== promptId || !serverPromptAccepting)) {
        repairCurrentPromptPublication(promptId);
      }
      handlePlayerAnswersPayload(payload, promptId);
      recoverOverdueSubmissionResolution();
    })
    .catch((error) => {
      state.playerSyncFailureCount += 1;
      if (state.playerSyncFailureCount === 3 || state.playerSyncFailureCount % 10 === 0) {
        logDebugEvent({
          kind: "error",
          label: "Player synchronization interrupted",
          detail: `${state.playerSyncFailureCount} consecutive failed polls | ${String(error?.message || error || "unknown polling error").slice(0, 500)}`
        });
      }
    })
    .finally(() => {
      state.playerSyncInFlight = false;
    });
}

function handlePlayerAnswersPayload(payload, requestedPromptId = "") {
  if (!payload?.ok) return;
  const payloadPromptId = payload.promptId || requestedPromptId || "";
  const currentPromptId = state.playerPromptId || buildPlayerPrompt()?.id || "";
  if (payloadPromptId && currentPromptId && payloadPromptId !== currentPromptId) {
    logDebugEvent({
      kind: "state",
      label: "Stale player submissions ignored",
      detail: `received ${payloadPromptId} while current prompt is ${currentPromptId}`
    });
    return;
  }
  const previousVisibleSubmissions = state.actionDrivenMode ? state.playerActions : state.playerAnswers;
  const previousSubmissionNames = new Set(previousVisibleSubmissions.map((entry) => normalize(entry.playerName)).filter(Boolean));
  state.playerAnswers = (payload.answers || []).filter((answer) => !currentPromptId || answer.promptId === currentPromptId);
  state.playerActions = (payload.actions || []).filter((action) => !currentPromptId || action.promptId === currentPromptId);
  state.queuedPlayerActions = Array.isArray(payload.queuedActions) ? payload.queuedActions : [];
  state.playerParticipants = payload.participants || [];

  // Resolve accepted submissions before optional UI work. A rendering exception must
  // never strand valid player answers on the server with the encounter still open.
  maybeAutoResolveEmergencyAnswer();
  maybeResolveQueuedPlayerAction();
  maybeResolvePlayerAction();

  const visibleSubmissions = state.actionDrivenMode ? state.playerActions : state.playerAnswers;
  const newlySubmittedNames = [...new Set(visibleSubmissions
    .map((entry) => entry.playerName || state.playerParticipants.find((player) => String(player.id || "") === String(entry.playerId || ""))?.name || "")
    .filter((name) => name && !previousSubmissionNames.has(normalize(name))))];
  const submissionLogKey = [
    state.playerPromptId,
    ...state.playerAnswers.map((answer) => `a:${answer.playerId || answer.playerName}:${answer.submittedAt || ""}`),
    ...state.playerActions.map((action) => `x:${action.playerId || action.playerName}:${action.submittedAt || ""}`)
  ].join("|");
  if (submissionLogKey !== state.playerSubmissionLogKey && (state.playerAnswers.length || state.playerActions.length)) {
    state.playerSubmissionLogKey = submissionLogKey;
    playGameSfx("submitted");
    logDebugEvent({
      kind: "response",
      label: "Player device submissions received",
      detail: [
        state.playerPromptId ? `prompt ${state.playerPromptId}` : "no active prompt id",
        state.playerAnswers.length ? `answers: ${state.playerAnswers.map((answer) => answer.playerName || answer.playerId || "unknown").join(", ")}` : "",
        state.playerActions.length ? `actions: ${state.playerActions.map((action) => action.playerName || action.playerId || "unknown").join(", ")}` : ""
      ].filter(Boolean).join(" | ")
    });
    syncRosterSubmissionState();
    pulsePlayerSubmissionCards(newlySubmittedNames);
  }
  renderPlayerSessionPanel();
  renderInitiativeTimeline();
  renderMapQuestionOverlay();
  if (state.actionDrivenMode && state.teamReady && !state.answerPending) {
    renderChatControls();
    const actionLogKey = currentActionEntries().map((entry) => entry.id).join("|");
    if (actionLogKey && actionLogKey !== state.actionReceiptLogKey) {
      state.actionReceiptLogKey = actionLogKey;
      logDebugEvent({
        kind: "response",
        label: "Player actions received",
        detail: `${currentActionEntries().length} action${currentActionEntries().length === 1 ? "" : "s"} for ${state.playerPromptId || "current prompt"}`
      });
    }
    if (everyoneActiveSubmittedAction()) {
      queueFinalSubmissionResolution(() => resolveActionRoomTurn(), "all operator actions received");
    }
  }
}

function maybeResolvePlayerAction() {
  if (!state.localDmMode || state.deviceMode !== "multi") return;
  if (state.actionDrivenMode) return;
  if (!state.questionPresentationReady || state.answerPending || state.sideActionPending || state.resolved || state.emergencyTimer?.kind === "emergency") return;
  if (!actionsAllowedThisEncounter()) return;
  const nextAction = [...state.playerActions]
    .filter((action) => action.promptId === state.playerPromptId && !state.processedPlayerActionIds.has(action.id))
    .sort((a, b) => a.submittedAt - b.submittedAt)[0];
  if (!nextAction) return;
  state.processedPlayerActionIds.add(nextAction.id);
  resolvePlayerSideAction(nextAction);
}

function maybeResolveQueuedPlayerAction() {
  if (!state.localDmMode || state.deviceMode !== "multi" || state.actionDrivenMode || !state.teamReady) return;
  if (!state.questionPresentationReady || state.answerPending || state.resolutionDelayPending || state.sideActionPending || state.resolved || state.emergencyTimer?.kind === "emergency") return;
  if (!actionsAllowedThisEncounter()) return;
  const nextAction = [...state.queuedPlayerActions]
    .filter((action) => !state.processedQueuedActionIds.has(action.id))
    .sort((a, b) => Number(a.submittedAt || 0) - Number(b.submittedAt || 0))[0];
  if (!nextAction) return;
  state.processedQueuedActionIds.add(nextAction.id);
  state.queuedPlayerActions = state.queuedPlayerActions.filter((action) => action.id !== nextAction.id);
  playerSessionApi.consumeQueuedAction({ roomCode: state.roomCode, actionId: nextAction.id });
  logDebugEvent({
    kind: "state",
    label: "Queued player action released",
    detail: `${nextAction.playerName || "Operator"} | ${nextAction.action}`
  });
  resolvePlayerSideAction(nextAction);
}

function actionsAllowedThisEncounter() {
  const node = state.nodes[state.currentNode];
  // Boss rooms are combat encounters too; keeping them in the same action
  // channel lets field devices queue healing, guarding, and target choices
  // instead of silently disabling those controls at the most important fight.
  return Boolean(state.localDmMode && node && node.type !== "recovery");
}

function currentActionEntries() {
  if (!state.actionDrivenMode) return [];
  const activeNames = new Set(state.players.filter((player) => !player.incapacitated).map((player) => normalize(player.name)));
  const info = currentQuestionInfo();
  const lockedName = info?.type?.locked && info.operator ? normalize(info.operator.name) : "";
  const order = actionTurnOrderIndex();
  return [...state.playerActions]
    .filter((entry) => entry.promptId === state.playerPromptId)
    .filter((entry) => !entry.playerName || activeNames.has(normalize(entry.playerName)) || entry.source === "teacher")
    .filter((entry) => !lockedName || normalize(entry.playerName) === lockedName || entry.source === "teacher")
    .sort((a, b) => {
      const aOrder = order.get(normalize(a.playerName)) ?? 999;
      const bOrder = order.get(normalize(b.playerName)) ?? 999;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return Number(a.submittedAt || 0) - Number(b.submittedAt || 0);
    });
}

function actionTurnOrderIndex() {
  return new Map((state.actionTurnOrder || []).map((name, index) => [normalize(name), index]));
}

function rotateActionTurnOrder(count = 1) {
  if (!state.actionTurnOrder?.length) return;
  const turns = Math.max(1, Math.min(state.actionTurnOrder.length, Number(count) || 1));
  for (let index = 0; index < turns; index++) {
    state.actionTurnOrder.push(state.actionTurnOrder.shift());
  }
}

function everyoneActiveSubmittedAction() {
  if (!state.actionDrivenMode || state.deviceMode !== "multi" || !state.questionPresentationReady || state.answerPending || state.resolutionDelayPending || state.resolved) return false;
  const required = requiredDeviceAnswerNames(currentQuestionInfo());
  if (!required.size) return false;
  const submitted = new Set(currentActionEntries().map((entry) => normalize(entry.playerName)));
  return [...required].every((name) => submitted.has(name));
}

function actionSubmissionSummary(entries = currentActionEntries()) {
  if (!state.actionDrivenMode) return "";
  const order = state.actionTurnOrder?.length ? `Turn order: ${state.actionTurnOrder.join(" > ")}.` : "";
  if (!entries.length) return `${order} ${state.deviceMode === "multi" ? "No player actions submitted yet." : "No team action added yet."}`.trim();
  return `${order} ${entries.map((entry) => `${entry.playerName || "Team"}: ${entry.action}`).join(" | ")}`.trim();
}

function addSingleDeviceAction() {
  const input = document.getElementById("singleDeviceActionInput");
  const action = sanitizeText(input?.value, { maxLength: 180 });
  if (!action || !state.actionDrivenMode || state.answerPending || !state.questionPresentationReady || state.resolved) return;
  state.playerActions = state.playerActions.filter((entry) => entry.promptId !== state.playerPromptId || entry.source !== "teacher");
  state.playerActions.push({
    id: `teacher-action-${Date.now()}`,
    promptId: state.playerPromptId,
    playerName: "Team",
    action,
    source: "teacher",
    submittedAt: Date.now()
  });
  if (input) input.value = "";
  renderChatControls();
}

function resolveActionRoomTurn(options = {}) {
  if (!state.actionDrivenMode || state.answerPending || state.resolutionDelayPending || state.resolved || !state.questionPresentationReady) return;
  if (state.deviceMode === "single" && !options.timeout) addSingleDeviceAction();
  const entries = currentActionEntries();
  const room = state.actionRooms[state.currentQuestion] || actionRoomTypePool[0];
  const info = currentQuestionInfo();
  const orderedEntries = entries.length
    ? entries
    : [{ id: `timeout-action-${Date.now()}`, promptId: state.playerPromptId, playerName: info.operator?.name || "Team", action: options.timeout ? "freezes and fails to react" : "No decisive action", source: "system", submittedAt: Date.now() }];
  state.answerPending = true;
  state.questionPresentationReady = false;
  stopTts();
  stopEmergencyTimer();
  publishPlayerWaiting("resolving");
  renderChatControls();
  renderInventoryActions();
  startPassiveTransmissionFeedback({ type: { label: room.label || "Action Judgment" } });

  requestActionJudgments(room, orderedEntries, info, Boolean(options.timeout))
    .then((baseScored) => {
      stopTransmissionFeedback(true);
      const safetyChecked = applyActionSafetyOverrides(baseScored, room);
      if (safetyChecked.some((entry) => entry.safetyOverride)) {
        logRoomDebug(`Action safety overrides: ${info.areaName}`, safetyChecked
          .filter((entry) => entry.safetyOverride)
          .map((entry) => ({
            player: entry.playerName,
            action: entry.action,
            targetId: entry.targetId,
            override: entry.safetyOverride,
            score: entry.score,
            risk: entry.risk
          })), { maxLength: 4000 });
      }
      const chained = applyActionChainModifiers(safetyChecked);
      const scored = applyActionRollModifiers(chained, room);
      state.actionResolutionQueue = {
        room,
        info,
        entries: orderedEntries,
        scored,
        index: 0,
        beforeRoom: snapshotPlayers(),
        eventNotes: bleedTick(),
        timeout: Boolean(options.timeout),
        prepared: new Map()
      };
      resolveNextActionInQueue();
    });
}

function resolveNextActionInQueue() {
  const queue = state.actionResolutionQueue;
  if (!queue) return;
  if (queue.index >= queue.scored.length) {
    finalizeActionRoomQueue(queue);
    return;
  }

  prepareActionResolution(queue, queue.index);
  displayPreparedActionResolution(queue, queue.index);
}

function prepareActionResolution(queue, index) {
  if (!queue || index >= queue.scored.length) return null;
  const existing = queue.prepared?.get(index);
  if (existing) return existing;
  const scoredEntry = queue.scored[index];
  const before = snapshotPlayers();
  const eventNotes = queue.eventNotes || {};
  const actionOutcome = applySingleActionOutcome(queue.room, scoredEntry, index, queue.scored, eventNotes, queue.timeout);
  const playerEvents = changedPlayerEvents(before, eventNotes);
  const fallback = singleActionResolutionFallback(queue.room, scoredEntry, actionOutcome, playerEvents, queue);
  const prompt = makeLocalSingleActionResolutionPrompt(queue.room, scoredEntry, actionOutcome, playerEvents, queue);
  logRoomDebug(`Action narration prompt: ${queue.info.areaName}`, prompt, { maxLength: 9000 });
  const prepared = {
    index,
    scoredEntry,
    actionOutcome,
    playerEvents,
    done: false,
    story: "",
    promise: requestOllama(prompt, { temperature: 0.82 })
      .then((text) => safeSingleActionNarration(text, playerEvents, fallback))
      .catch(() => fallback)
      .then((story) => {
        prepared.story = ensureActionInjuryNarration(story, playerEvents);
        prepared.done = true;
        logRoomDebug(`Action narration: ${queue.info.areaName}`, {
          actionIndex: index + 1,
          actor: scoredEntry.playerName,
          action: scoredEntry.action,
          targetId: scoredEntry.targetId || "",
          score: scoredEntry.score,
          entityOutcome: actionOutcome.entityOutcome,
          playerEvents,
          story: prepared.story
        });
        return prepared;
      })
  };
  queue.prepared.set(index, prepared);
  return prepared;
}

function displayPreparedActionResolution(queue, index) {
  const prepared = prepareActionResolution(queue, index);
  if (!prepared) return;
  startPassiveTransmissionFeedback({ type: { label: queue.room.label || "Action Turn" }, playerEvents: prepared.playerEvents });
  prepared.promise.then(() => {
      stopTransmissionFeedback(true);
      if (teamFullyIncapacitated()) {
        renderTeamFailureCard(prepared.story);
        return;
      }
      appendTranscript({
        tag: `Action ${index + 1} / ${queue.scored.length}`,
        areaName: queue.info.areaName,
        story: prepared.story,
        recordHistory: true,
        hideLogTag: false,
        replace: index === 0,
        onTypedComplete: () => {
          displayDeferredActionStatus(prepared.playerEvents, prepared.actionOutcome.statusLog);
          renderStatus();
          renderInventoryActions();
          if (index + 1 >= queue.scored.length) prepareActionRoomFinalization(queue);
          else prepareActionResolution(queue, index + 1);
          renderActionContinueGate(index);
        }
      });
    });
}

function renderActionContinueGate(index) {
  const queue = state.actionResolutionQueue;
  const transcript = document.getElementById("chatTranscript");
  const entry = transcript?.querySelector(".transcript-entry:last-child");
  if (!queue || !entry) return;
  const gate = document.createElement("div");
  gate.className = "mission-continue-gate action-continue-gate";
  const finalAction = index + 1 >= queue.scored.length;
  gate.innerHTML = `<button type="button">${finalAction ? "Resolve Room" : "Continue"}</button><span>${finalAction ? "Finish the room outcome" : "Next operator action"}</span>`;
  entry.appendChild(gate);
  startMissionLogAutoScroll({ startAtBottom: true });
  gate.querySelector("button")?.addEventListener("click", () => {
    const button = gate.querySelector("button");
    if (button) button.disabled = true;
    gate.classList.add("resolving");
    gate.remove();
    queue.index = index + 1;
    resolveNextActionInQueue();
  }, { once: true });
}

function finalizeActionRoomQueue(queue) {
  const finalization = prepareActionRoomFinalization(queue);
  const showWaiting = !finalization.done;
  if (showWaiting) startPassiveTransmissionFeedback({ type: { label: queue.room.label || "Action Turn" } });
  finalization.promise.then((prepared) => {
    if (showWaiting) stopTransmissionFeedback();
    completeActionRoomFinalization(queue, prepared);
  });
}

function prepareActionRoomFinalization(queue) {
  if (queue.finalization) return queue.finalization;
  const resolution = evaluateActionRoom(queue.room, queue.entries, {
    preScored: queue.scored,
    eventNotes: queue.eventNotes,
    skipConsequences: true
  });
  logRoomDebug(`Room scoring: ${queue.info.areaName}`, formatActionRoomScoreDebug(queue.room, resolution), { maxLength: 5000 });
  const nextInfo = resolution.progress ? nextActionRoomInfo() : currentActionRoomInfo();
  if (resolution.progress && state.actionDrivenMode && nextInfo?.actionRoom) {
    preloadActionRoomOpening(nextInfo);
  }
  const statusLog = actionResolutionStatusLog(resolution, []);
  const fallback = actionRoomSummaryFallback(queue.room, resolution, nextInfo);
  const transitionFallback = actionRoomContinuationStory(queue.room, nextInfo, resolution);
  const prompt = makeLocalActionRoomSummaryPrompt(queue.room, resolution, queue.entries, nextInfo);
  const finalization = {
    resolution,
    nextInfo,
    statusLog,
    done: false,
    parsed: null,
    promise: null
  };
  finalization.promise = requestOllama(prompt, { temperature: 0.78 })
    .then((text) => {
      const parsed = parseActionRoomSummaryResponse(text, fallback, transitionFallback, resolution.progress);
      logRoomDebug(`Room outcome: ${queue.info.areaName}`, {
        raw: text,
        parsed,
        resolution,
        finalEntities: queue.room.entities || []
      });
      return parsed;
    })
    .catch(() => {
      const parsed = { outcome: fallback, transition: transitionFallback };
      logRoomDebug(`Room outcome fallback: ${queue.info.areaName}`, {
        parsed,
        resolution,
        finalEntities: queue.room.entities || []
      });
      return parsed;
    })
    .then((parsed) => {
      finalization.parsed = parsed;
      finalization.done = true;
      return finalization;
    });
  queue.finalization = finalization;
  return finalization;
}

function completeActionRoomFinalization(queue, prepared) {
  const { resolution, nextInfo, statusLog } = prepared;
  const { outcome, transition } = prepared.parsed || {};
  state.answerPending = false;
  state.playerActions = [];
  state.processedPlayerActionIds = new Set();
  state.actionResolutionQueue = null;
  rotateActionTurnOrder(queue.scored.length);
  if (!resolution.progress) {
    state.actionRoomAttempts[state.currentQuestion] = (state.actionRoomAttempts[state.currentQuestion] || 0) + 1;
    updateCurrentNodeResult(false);
  }
  if (teamFullyIncapacitated()) {
    renderTeamFailureCard(outcome);
    return;
  }
  appendTranscript({
    tag: resolution.progress ? `${queue.room.label} Cleared` : `${queue.room.label} Holds`,
    areaName: queue.info.areaName,
    story: outcome,
    replace: false,
    activeObstacle: nextInfo.activeObstacle,
    question: nextInfo.questionText,
    inventory: { ...state.inventory },
    statusLog,
    correct: resolution.progress,
    advanceRoom: resolution.progress,
    continuationStory: resolution.progress ? transition : "",
    suppressEffectFlash: true,
    deferStatusLog: true
  });
  renderStatus();
  renderMap();
}

function ensureActionInjuryNarration(story, playerEvents = []) {
  const collapsed = collapseActionDamageSentences(story, playerEvents);
  if (collapsed !== String(story || "").trim()) return collapsed;
  const missing = playerEvents.filter((event) => event.amount > 0 && event.cause && !actionStoryExplainsPlayerInjury(story, event));
  if (!missing.length) return story;
  const addendum = missing.map((event) => eventNarrativeInjurySentence(event)).join(" ");
  return collapseActionDamageSentences(`${story} ${addendum}`.trim(), playerEvents);
}

function safeSingleActionNarration(text, playerEvents, fallback) {
  const cleaned = cleanLocalNarration(text);
  if (!cleaned) return fallback;
  const safe = safeLocalNarration(cleaned, playerEvents, fallback);
  return stripRedundantActionDamageSentences(safe, playerEvents);
}

function actionStoryExplainsPlayerInjury(story, event) {
  const text = String(story || "");
  if (event.cause && new RegExp(escapeRegExp(event.cause.slice(0, 38)), "i").test(text)) return true;
  const player = escapeRegExp(event.name || "");
  if (!player) return false;
  const injuryWords = "(?:hurt|injur|damage|wound|burn|bleed|blood|shock|concuss|slam|strike|struck|catch|caught|stagger|collapse|cut|scorch|spark|fragment|shrapnel)";
  return new RegExp(`\\b${player}\\b[^.!?]{0,220}\\b${injuryWords}\\b|\\b${injuryWords}\\b[^.!?]{0,220}\\b${player}\\b`, "i").test(text);
}

function scrubGenericActionCause(text) {
  return cleanBriefingField(text)
    .replace(/\bunstable room hazard\b/gi, "the room's active hazard")
    .replace(/\bambient hazard\b/gi, "the room's active hazard")
    .replace(/\broute access point\b/gi, "the blocked exit")
    .replace(/\breacts badly to the attempted move and catches them before they can clear the danger\b/gi, "lashes back before they can clear the danger")
    .replace(/\s*\b\d+\s*HP\b\.?/gi, "")
    .trim();
}

function stripRedundantActionDamageSentences(story, playerEvents = []) {
  let output = collapseActionDamageSentences(story, playerEvents);
  for (const event of playerEvents) {
    if (!event?.amount || !event.name) continue;
    const pattern = new RegExp(`(?:^|\\s+)${escapeRegExp(event.name)}\\s+is\\s+hurt\\s+(?:because|when)[^.!?]*(?:[.!?]|$)`, "gi");
    output = output.replace(pattern, (match, offset, fullText) => {
      const without = `${fullText.slice(0, offset)} ${fullText.slice(offset + match.length)}`.trim();
      return actionStoryExplainsPlayerInjury(without, event) ? " " : match;
    });
  }
  return output.replace(/\s{2,}/g, " ").trim();
}

function collapseActionDamageSentences(story, playerEvents = []) {
  let output = String(story || "").trim();
  for (const event of playerEvents) {
    if (!event?.amount || !event.name) continue;
    const pattern = new RegExp(`(?:^|\\s+)${escapeRegExp(event.name)}\\s+is\\s+hurt\\s+(?:because|when)[^.!?]*(?:[.!?]|$)`, "gi");
    const matches = [...output.matchAll(pattern)];
    if (matches.length <= 1) continue;
    output = output.replace(pattern, " ");
    output = `${output.trim()} ${eventNarrativeInjurySentence(event)}`;
  }
  return output.replace(/\s{2,}/g, " ").trim();
}

function eventNarrativeInjurySentence(event) {
  const cause = normalize(event.cause);
  const name = cleanBriefingField(event.name) || "The operator";
  if (/bleeding worsens|existing bleeding/.test(cause)) return `${name}'s earlier wound opens again under the strain.`;
  if (/sound|signal|hostile pressure/.test(cause)) return `${name}'s distraction draws the room's hostile pressure straight onto their position.`;
  if (/active hazard|surges?|lashes back|mounting pressure/.test(cause)) return `A pressure surge lashes through the chamber and catches ${name} before they can settle back into cover.`;
  if (/wire|electrical|current|conductor|contact point/.test(cause)) return `Current snaps through the disturbed equipment and locks onto ${name} for a brutal second.`;
  if (/shot|fragments|sparks|ricochet/.test(cause)) return `The impact throws sparks and fragments back across ${name}'s lane.`;
  if (/fixture|snaps loose|caught/.test(cause)) return `The disturbed fixture breaks loose and whips into ${name}'s path.`;
  return `${name} takes the backlash from the action before the team can pull them clear.`;
}

function requestActionJudgments(room, entries, info, timeout = false) {
  const fallback = () => entries.map((entry) => scoreActionEntry(room, entry));
  if (!entries.length) return Promise.resolve(fallback());
  const prompt = makeActionJudgmentPrompt(room, entries, info, timeout);
  logRoomDebug(`Action judgment prompt: ${info.areaName}`, prompt, { maxLength: 9000 });
  return requestOllama(prompt, { temperature: 0.18 })
    .then((text) => {
      const parsed = parseActionJudgmentResponse(text, entries, room);
      logRoomDebug(`Action judgments: ${info.areaName}`, formatActionJudgmentDebug(text, parsed, room), { maxLength: 12000 });
      return parsed;
    })
    .catch(() => {
      const parsed = fallback();
      logRoomDebug(`Action judgments fallback: ${info.areaName}`, formatActionJudgmentDebug("", parsed, room), { maxLength: 12000 });
      return parsed;
    });
}

function formatActionJudgmentDebug(raw, parsed, room) {
  return [
    "RAW RESPONSE:",
    raw || "(fallback heuristic used)",
    "",
    "PARSED ACTIONS:",
    JSON.stringify(parsed, null, 2),
    "",
    "ROOM ENTITIES:",
    JSON.stringify(room.entities || [], null, 2)
  ].join("\n");
}

function makeActionJudgmentPrompt(room, entries, info, timeout = false) {
  return dmPrompts.makeActionJudgmentPrompt({
    operation: state.title,
    environment: state.environment,
    areaName: info.areaName || room.areaName,
    roomLabel: room.label,
    roomObjective: room.objective,
    roomEntities: roomEntitySummary(room),
    threat: state.threat,
    threatProfile: compactThreatProfileText(),
    timeout,
    pressureSpotlight: room.pressureSpotlight,
    pressureOperatorName: info.operator?.name,
    activeOperators: activePlayers().map((player) => player.name).join(", "),
    actionLines: entries.map((entry, index) => `${index + 1}. ${entry.playerName || "Team"}: ${entry.action}`).join(" | ")
  });
}

function parseActionJudgmentResponse(text, entries, room) {
  const parsed = parseJsonObjectFromText(text);
  const rawActions = Array.isArray(parsed?.actions) ? parsed.actions : Array.isArray(parsed) ? parsed : [];
  if (!rawActions.length) return entries.map((entry) => scoreActionEntry(room, entry));
  return entries.map((entry, index) => {
    const raw = rawActions[index] || rawActions.find((item) => sameName(item.playerName, entry.playerName)) || {};
    const fallback = scoreActionEntry(room, entry);
    const score = Number(raw.score);
    const cleanScore = Number.isFinite(score) ? Math.max(-5, Math.min(6, Math.round(score))) : fallback.score;
    const classification = normalize(raw.classification || raw.category || fallback.category).replace(/\s+/g, "-") || fallback.category;
    const reason = sanitizeText(raw.reason || raw.rationale || "", { maxLength: 180 });
    const risk = sanitizeText(raw.risk || "", { maxLength: 40 });
    const act = sanitizeText(raw.act || raw.verb || "", { maxLength: 80 });
    const targetText = sanitizeText(raw.targetText || raw.targetPhrase || "", { maxLength: 100 });
    const targetResolution = normalize(raw.targetResolution || "").replace(/\s+/g, "_");
    const senseRating = clampNumber(raw.senseRating ?? raw.sense ?? raw.rating, 1, 10, 5);
    const targetId = sanitizeText(raw.targetId || raw.target || "", { fallback: "nothing", maxLength: 80 }) || "nothing";
    const resolvedTargetLabel = sanitizeText(raw.resolvedTargetLabel || raw.targetLabel || "", { fallback: targetId === "nothing" ? "nothing" : "", maxLength: 120 }) || (targetId === "nothing" ? "nothing" : "");
    const stateChange = sanitizeText(raw.stateChange || raw.change || "", { maxLength: 160 });
    const adjustedScore = senseRating <= 3 ? Math.min(cleanScore, 0) : cleanScore;
    const adjustedClassification = senseRating <= 3 && ["helpful", "brilliant"].includes(classification) ? "weak" : classification;
    return {
      ...fallback,
      category: adjustedClassification,
      score: adjustedScore,
      risk,
      act,
      targetText: targetText || "nothing",
      targetResolution: validTargetResolution(targetResolution),
      targetId,
      resolvedTargetLabel,
      senseRating,
      tagsUsed: asArray(raw.tagsUsed).map((tag) => normalize(tag).trim()).filter(Boolean),
      stateChange,
      pressureDelta: clampNumber(raw.pressureDelta, -3, 3, 0),
      usesDelta: clampNumber(raw.usesDelta, -3, 3, 0),
      entityDamage: clampNumber(raw.entityDamage, 0, 8, 0),
      createsOpening: Boolean(raw.createsOpening),
      secondaryEffects: parseActionSecondaryEffects(raw.secondaryEffects, room),
      modelJudged: true,
      reasons: [reason || `model judged as ${classification}`]
    };
  });
}

function parseActionSecondaryEffects(value, room) {
  return asArray(value)
    .map((effect) => {
      const targetId = sanitizeText(effect?.targetId || effect?.target || "", { maxLength: 80 });
      const target = findRoomEntity(room, targetId);
      if (!target) return null;
      const engagedWithRaw = sanitizeText(effect?.engagedWith || effect?.engaged_with || "", { maxLength: 80 });
      const engagedPlayer = activePlayers().find((player) => sameName(player.name, engagedWithRaw));
      return {
        targetId: target.id,
        resolvedTargetLabel: target.label,
        stateChange: sanitizeText(effect?.stateChange || effect?.state || effect?.change || "", { maxLength: 140 }),
        pressureDelta: clampNumber(effect?.pressureDelta, -3, 3, 0),
        entityDamage: clampNumber(effect?.entityDamage, 0, 8, 0),
        engagedWith: engagedPlayer?.name || (normalize(engagedWithRaw) === "nothing" ? "" : "")
      };
    })
    .filter(Boolean);
}

function applyActionSafetyOverrides(scored, room) {
  return scored.map((entry) => {
    const target = findRoomEntity(room, entry.targetId);
    const hazardViolation = hazardSafetyViolation(entry, target);
    const destructiveViolation = typeof actionRooms.destructiveActionViolation === "function"
      ? actionRooms.destructiveActionViolation(entry, target, { roomKind: room?.kind })
      : null;
    const violation = hazardViolation || destructiveViolation;
    if (!violation) return entry;
    const minScore = Number.isFinite(Number(violation.minScore)) ? Number(violation.minScore) : -2;
    const scoreCap = Number.isFinite(Number(violation.scoreCap)) ? Number(violation.scoreCap) : -1;
    return {
      ...entry,
      category: ["harmful", "reckless"].includes(entry.category) ? entry.category : "reckless",
      score: Math.min(Number(entry.score) || 0, minScore),
      scoreCap,
      risk: "high",
      pressureDelta: Math.max(Number(entry.pressureDelta) || 0, violation.pressureDelta || 1),
      usesDelta: 0,
      createsOpening: false,
      safetyOverride: violation,
      stateChange: entry.stateChange || (hazardViolation ? "unsafe interaction escalates the hazard" : "destructive action destabilizes the target"),
      reasons: [
        ...asArray(entry.reasons),
        `safety override: ${violation.reason}`
      ]
    };
  });
}

function hazardSafetyViolation(entry, target) {
  if (!target || target.type !== "hazard") return null;
  const tags = entityTagSet(target);
  const text = normalize(`${entry.action} ${entry.act || ""} ${entry.targetText || ""}`);
  if (!text || hasProtectiveHazardMethod(text)) return null;
  const checks = [
    ["contact-danger", /\b(grab|grabs|touch|touches|hold|holds|handle|handles|pick up|pull|push|kick|hit|punch|smash|strike|lick)\b/, "direct physical contact with a contact-danger hazard"],
    ["electrical-contact", /\b(grab|touch|hold|handle|pull|push|bare hand|water|metal tool|kick|hit)\b/, "unsafe contact with an electrical hazard"],
    ["heat-contact", /\b(grab|touch|hold|handle|walk through|run through|jump into|step into)\b/, "unsafe contact with a heat hazard"],
    ["chemical-contact", /\b(grab|touch|open|spill|smell|inhale|breathe|drink|wipe|handle)\b/, "unsafe contact with a chemical hazard"],
    ["unstable-structure", /\b(kick|hit|smash|force|climb|shake|pull|push|charge|jump|run)\b/, "physical force against an unstable structure"],
    ["pressure-danger", /\b(open|force|cut|shoot|hit|smash|pull|yank|pierce|break)\b/, "unsafe force against a pressure hazard"],
    ["noise-triggered", /\b(shout|yell|scream|fire|shoot|slam|bang|explode|grenade|blast)\b/, "noise or shock near a noise-triggered hazard"],
    ["motion-triggered", /\b(run|rush|sprint|charge|jump|dive|cross|step|walk|crawl)\b/, "reckless movement through a motion-triggered hazard"],
    ["signal-sensitive", /\b(radio|transmit|jam|jammer|emp|pulse|overload|broadcast|signal)\b/, "unsafe signal action near a signal-sensitive hazard"],
    ["contamination", /\b(touch|grab|handle|open|smell|inhale|breathe|drink|eat|wipe|carry)\b/, "unsafe exposure to contamination"]
  ];
  const match = checks.find(([tag, pattern]) => tags.has(tag) && pattern.test(text));
  if (!match) return null;
  return {
    tag: match[0],
    reason: match[2],
    pressureDelta: ["electrical-contact", "chemical-contact", "pressure-danger", "contamination"].includes(match[0]) ? 2 : 1
  };
}

function hasProtectiveHazardMethod(text) {
  return /\b(insulated|gloves?|ppe|suit|remote|robot|drone|tool|tongs|pole|rope|from cover|behind cover|at a distance|shut down|shutdown|power off|de-energize|deenergize|grounded|grounding|contain|containment|ventilate|seal|bypass|avoid touching|without touching)\b/.test(text);
}

function validTargetResolution(value) {
  const allowed = new Set(["matched_existing", "matched_enemy", "matched_operator", "created_one_off", "invalid_target", "no_target"]);
  return allowed.has(value) ? value : "";
}

function clampNumber(value, min, max, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function parseJsonObjectFromText(text) {
  const value = String(text || "").trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  try {
    return JSON.parse(value);
  } catch {}
  const firstObject = value.indexOf("{");
  const lastObject = value.lastIndexOf("}");
  if (firstObject >= 0 && lastObject > firstObject) {
    try {
      return JSON.parse(value.slice(firstObject, lastObject + 1));
    } catch {}
  }
  const firstArray = value.indexOf("[");
  const lastArray = value.lastIndexOf("]");
  if (firstArray >= 0 && lastArray > firstArray) {
    try {
      return JSON.parse(value.slice(firstArray, lastArray + 1));
    } catch {}
  }
  return null;
}

function findRoomEntity(room, targetId) {
  const id = normalize(targetId).replace(/\s+/g, "_");
  if (!id) return null;
  return asArray(room?.entities).find((entity) => normalize(entity.id).replace(/\s+/g, "_") === id || sameName(entity.label, targetId)) || null;
}

function actionTargetsEntity(action, entity) {
  const text = normalize(action);
  if (!entity) return false;
  if (normalize(entity.label).split(" ").some((word) => word.length > 3 && text.includes(word))) return true;
  return asArray(entity.tags).some((tag) => text.includes(normalize(tag)));
}

function actionExploitsVulnerability(scoredEntry, entity) {
  const text = normalize(`${scoredEntry.action} ${asArray(scoredEntry.tagsUsed).join(" ")}`);
  return asArray(entity?.vulnerabilities).some((vulnerability) => {
    const key = normalize(vulnerability);
    return key && text.includes(key);
  });
}

function applyRoomEntityOutcome(room, scoredEntry) {
  const target = findRoomEntity(room, scoredEntry.targetId)
    || asArray(room?.entities).find((entity) => actionTargetsEntity(scoredEntry.action, entity))
    || null;
  const outcome = { target, lines: [], rewardLines: [], rewardFacts: [], secondaryEffects: [], secondaryFacts: [], openingCreated: false, enemyNeutralized: false };
  if (!target) {
    applySecondaryEntityEffects(room, scoredEntry, outcome);
    return outcome;
  }

  const score = Number(scoredEntry.score) || 0;
  if (target.exhausted || target.neutralized || /destroyed|empty|exhausted|neutralized/i.test(target.state || "")) {
    if (score > 1) scoredEntry.score = Math.min(scoredEntry.score, 1);
    scoredEntry.reasons = [...asArray(scoredEntry.reasons), `${target.label} has already been exhausted or neutralized`];
    applySecondaryEntityEffects(room, scoredEntry, outcome);
    return outcome;
  }

  if (target.type === "enemy") {
    if (directEnemyEngagementAction(scoredEntry)) applyEarlyFinalBossBoost(target, outcome);
    let damage = 0;
    if (score >= 5) damage = 4;
    else if (score >= 3) damage = 2;
    else if (score >= 2) damage = 1;
    if (scoredEntry.createsOpening) {
      target.opening = true;
      outcome.openingCreated = true;
    }
    if (target.opening && damage > 0) damage += 1;
    if (actionExploitsVulnerability(scoredEntry, target)) damage += 2;
    if (Number.isFinite(Number(scoredEntry.entityDamage)) && scoredEntry.entityDamage > 0) damage = Math.max(damage, Number(scoredEntry.entityDamage));
    if (damage > 0) {
      const bonus = consumeCombatBonus(scoredEntry.playerName);
      if (bonus) {
        damage += bonus.amount;
        outcome.rewardLines.push(`${scoredEntry.playerName}: ${bonus.label} spent`);
        outcome.rewardFacts.push(`${scoredEntry.playerName}'s earlier salvage gives this attack extra force.`);
      }
    }
    damage = Math.max(0, damage - (Number(target.armor) || 0));
    if (damage > 0 && Number.isFinite(Number(target.hp))) {
      target.hp = Math.max(0, Number(target.hp) - damage);
      outcome.lines.push(`${target.label}: ${damage} damage${target.hp <= 0 ? ", neutralized" : `, ${target.hp} HP remaining`}`);
      target.state = target.hp <= 0 ? "neutralized" : scoredEntry.stateChange || "wounded";
      target.neutralized = target.hp <= 0;
      outcome.enemyNeutralized = target.neutralized;
      target.opening = false;
    } else if (score <= 1) {
      target.pressure = Math.min(5, (Number(target.pressure) || 0) + 1);
      outcome.lines.push(`${target.label}: pressure rising`);
    }
  } else if (target.type === "hazard") {
    const delta = Number(scoredEntry.pressureDelta) || (score >= 3 ? -1 : score < 0 ? 1 : 0);
    target.pressure = Math.max(0, Math.min(5, (Number(target.pressure) || 0) + delta));
    if (score >= 2) target.mitigation = Math.min(Number(target.threshold) || 3, (Number(target.mitigation) || 0) + 1);
    if (target.mitigation >= (Number(target.threshold) || 99)) {
      target.state = scoredEntry.stateChange || "mitigated";
      target.neutralized = true;
    } else if (scoredEntry.stateChange) {
      target.state = scoredEntry.stateChange;
    }
    outcome.lines.push(`${target.label}: ${target.state}`);
  } else if (target.type === "route" || target.type === "npc") {
    if (score >= 2) target.progress = Math.min(Number(target.threshold) || 3, (Number(target.progress) || 0) + 1);
    if (score < 0) target.pressure = Math.min(5, (Number(target.pressure) || 0) + 1);
    if (Number.isFinite(Number(scoredEntry.pressureDelta)) && scoredEntry.pressureDelta) {
      target.pressure = Math.max(0, Math.min(5, (Number(target.pressure) || 0) + Number(scoredEntry.pressureDelta)));
    }
    if (target.progress >= (Number(target.threshold) || 99)) target.state = scoredEntry.stateChange || (target.type === "npc" ? "cooperative" : "opened");
    else if (scoredEntry.stateChange) target.state = scoredEntry.stateChange;
    outcome.lines.push(`${target.label}: ${target.state}`);
  } else {
    const defaultUseDelta = Number.isFinite(Number(scoredEntry.usesDelta))
      ? Number(scoredEntry.usesDelta)
      : score >= 1 && Number.isFinite(Number(target.usesRemaining)) ? -1 : 0;
    if (Number.isFinite(Number(target.usesRemaining)) && defaultUseDelta) {
      target.usesRemaining = Math.max(0, Number(target.usesRemaining) + defaultUseDelta);
      if (target.usesRemaining <= 0) {
        target.exhausted = true;
        target.state = scoredEntry.stateChange || "exhausted";
      } else if (scoredEntry.stateChange) {
        target.state = scoredEntry.stateChange;
      }
      outcome.lines.push(`${target.label}: ${target.state}, ${target.usesRemaining} use${target.usesRemaining === 1 ? "" : "s"} left`);
      applySearchReward(target, scoredEntry, outcome);
    } else if (scoredEntry.stateChange) {
      target.state = scoredEntry.stateChange;
      outcome.lines.push(`${target.label}: ${target.state}`);
      applySearchReward(target, scoredEntry, outcome);
    }
  }

  applySecondaryEntityEffects(room, scoredEntry, outcome);
  return outcome;
}

function applySecondaryEntityEffects(room, scoredEntry, outcome) {
  for (const effect of asArray(scoredEntry.secondaryEffects)) {
    const entity = findRoomEntity(room, effect.targetId);
    if (!entity) continue;
    const applied = {
      targetId: entity.id,
      label: entity.label,
      type: entity.type,
      stateBefore: entity.state || "",
      stateAfter: entity.state || "",
      pressureDelta: 0,
      entityDamage: 0,
      engagedWith: ""
    };

    const pressureDelta = Number(effect.pressureDelta) || 0;
    if (pressureDelta) {
      entity.pressure = Math.max(0, Math.min(5, (Number(entity.pressure) || 0) + pressureDelta));
      applied.pressureDelta = pressureDelta;
    }

    const damage = Math.max(0, Number(effect.entityDamage) || 0);
    const engagedWith = activePlayers().find((player) => sameName(player.name, effect.engagedWith))?.name || "";
    if (entity.type === "enemy" && engagedWith) applyEarlyFinalBossBoost(entity, outcome);
    if (damage && Number.isFinite(Number(entity.hp))) {
      entity.hp = Math.max(0, Number(entity.hp) - damage);
      entity.neutralized = entity.hp <= 0;
      if (entity.neutralized) entity.state = "neutralized";
      applied.entityDamage = damage;
      if (entity.neutralized) outcome.enemyNeutralized = true;
    }

    if (entity.type === "enemy" && engagedWith) {
      entity.engagedWith = engagedWith;
      entity.state = "engaged";
      entity.pressure = Math.max(Number(entity.pressure) || 0, 2);
      applied.engagedWith = engagedWith;
    } else if (effect.stateChange && !entity.neutralized) {
      entity.state = effect.stateChange;
    }

    applied.stateAfter = entity.state || "";
    const fact = secondaryEntityFact(entity, applied);
    outcome.secondaryEffects.push(applied);
    if (fact) outcome.secondaryFacts.push(fact);
    const line = secondaryEntityStatusLine(entity, applied);
    if (line) outcome.lines.push(line);
  }
}

function directEnemyEngagementAction(scoredEntry) {
  const text = normalize(`${scoredEntry.action} ${scoredEntry.act || ""}`);
  return /\b(attack|fight|shoot|fire|strike|hit|kick|punch|stab|slash|blast|grenade|emp|charge|tackle|trap|pin|engage|block)\b/.test(text);
}

function isBeforeMissionHalfway() {
  const total = Math.max(1, state.questions.length || state.actionRooms.length || 1);
  return state.currentQuestion < total / 2;
}

function isEarlyFinalBoss(entity) {
  return entity?.type === "enemy" && entity.role === "final_boss" && isBeforeMissionHalfway();
}

function applyEarlyFinalBossBoost(entity, outcome = null) {
  if (!isEarlyFinalBoss(entity) || entity.earlyBossBoosted) return false;
  const currentMax = Number.isFinite(Number(entity.maxHp)) ? Number(entity.maxHp) : Number(entity.hp);
  const currentHp = Number.isFinite(Number(entity.hp)) ? Number(entity.hp) : currentMax;
  if (Number.isFinite(currentMax)) entity.maxHp = Math.max(1, currentMax * 2);
  if (Number.isFinite(currentHp)) entity.hp = Math.max(1, currentHp * 2);
  entity.earlyBossBoosted = true;
  entity.pressure = Math.max(Number(entity.pressure) || 0, 4);
  if (outcome?.lines) outcome.lines.push(`${entity.label}: early confrontation surge`);
  if (outcome?.secondaryFacts) outcome.secondaryFacts.push(`${entity.label} surges with overwhelming force because it was engaged before the mission midpoint.`);
  return true;
}

function actionEntityDamageMultiplier(entity) {
  return isEarlyFinalBoss(entity) || entity?.earlyBossBoosted ? 2 : 1;
}

function secondaryEntityFact(entity, applied) {
  if (!entity) return "";
  if (entity.neutralized) return `${entity.label} is neutralized by the secondary effect.`;
  if (entity.type === "enemy" && applied.engagedWith) return `${entity.label} is now engaged with ${applied.engagedWith}.`;
  if (applied.stateAfter && applied.stateAfter !== applied.stateBefore) return `${entity.label} shifts from ${applied.stateBefore || "unsettled"} to ${applied.stateAfter}.`;
  if (applied.pressureDelta > 0) return `${entity.label} becomes more dangerous.`;
  if (applied.pressureDelta < 0) return `${entity.label} loses pressure.`;
  if (applied.entityDamage > 0) return `${entity.label} is damaged by the secondary effect.`;
  return "";
}

function secondaryEntityStatusLine(entity, applied) {
  if (!entity || !applied) return "";
  if (entity.type === "enemy" && applied.engagedWith) return `${entity.label}: engaged with ${applied.engagedWith}`;
  if (applied.stateAfter && applied.stateAfter !== applied.stateBefore) return `${entity.label}: ${applied.stateAfter}`;
  if (applied.pressureDelta > 0) return `${entity.label}: pressure rising`;
  if (applied.pressureDelta < 0) return `${entity.label}: pressure easing`;
  if (applied.entityDamage > 0) return `${entity.label}: damaged`;
  return "";
}

function applySearchReward(target, scoredEntry, outcome) {
  const score = Number(scoredEntry.score) || 0;
  if (score < 2 || !isSearchInteraction(target, scoredEntry)) return;
  if (isMedicalRewardSource(target)) {
    const roll = state.rng();
    if (roll < 0.15) {
      state.inventory.medkits += 2;
      outcome.rewardLines.push(`${scoredEntry.playerName}: found 2 Medkits`);
      outcome.rewardFacts.push(`${scoredEntry.playerName} finds two usable medkits in ${target.label}.`);
    } else if (roll < 0.55) {
      state.inventory.medkits += 1;
      outcome.rewardLines.push(`${scoredEntry.playerName}: found 1 Medkit`);
      outcome.rewardFacts.push(`${scoredEntry.playerName} finds one usable medkit in ${target.label}.`);
    }
    return;
  }
  if (!isSupplyRewardSource(target)) return;
  if (state.rng() < 0.45) {
    const player = findPlayer({ name: scoredEntry.playerName });
    if (!player || player.incapacitated) return;
    const bonus = {
      kind: "combat",
      amount: 1,
      uses: 1,
      label: "Improvised strike bonus"
    };
    player.bonuses = asArray(player.bonuses).filter((item) => item?.kind !== "combat");
    player.bonuses.push(bonus);
    outcome.rewardLines.push(`${player.name}: found improvised combat gear`);
    outcome.rewardFacts.push(`${player.name} salvages gear from ${target.label} that can strengthen their next attack.`);
  }
}

function isMedicalRewardSource(target) {
  const tags = entityTagSet(target);
  const label = normalize(target?.label);
  return ["medical", "med", "med-grade", "first-aid", "trauma", "aid"].some((tag) => tags.has(tag))
    || /\b(med|medical|first aid|trauma|aid station|medkit|med-kit|bandage|field dressing)\b/.test(label);
}

function entityTagSet(entity) {
  return new Set(asArray(entity?.tags).map((tag) => normalize(tag)).filter(Boolean));
}

function isSearchInteraction(target, scoredEntry) {
  const tags = entityTagSet(target);
  const text = normalize(`${scoredEntry.action} ${asArray(scoredEntry.tagsUsed).join(" ")}`);
  return tags.has("searchable")
    || /\b(search|inspect|scavenge|salvage|loot|open|check|rifle|look)\b/.test(text);
}

function isSupplyRewardSource(target) {
  const tags = entityTagSet(target);
  const label = normalize(target?.label);
  return ["supply", "salvage", "cache", "gear", "tool", "parts"].some((tag) => tags.has(tag))
    || /\b(supply|supplies|closet|locker|cache|crate|cabinet|shelf|shelves|parts|gear|bag|bin|cart)\b/.test(label);
}

function consumeCombatBonus(playerName) {
  const player = findPlayer({ name: playerName });
  if (!player?.bonuses?.length) return null;
  const index = player.bonuses.findIndex((bonus) => bonus?.kind === "combat" && Number(bonus.uses) > 0);
  if (index < 0) return null;
  const bonus = player.bonuses[index];
  bonus.uses = Math.max(0, Number(bonus.uses) - 1);
  if (bonus.uses <= 0) player.bonuses.splice(index, 1);
  return {
    amount: Number.isFinite(Number(bonus.amount)) ? Number(bonus.amount) : 1,
    label: bonus.label || "combat bonus"
  };
}

function applySingleActionOutcome(room, scoredEntry, index, scoredList, eventNotes, timeout = false) {
  const active = activePlayers();
  const player = findPlayer({ name: scoredEntry.playerName });
  const target = player && !player.incapacitated ? player : active[Math.floor(state.rng() * Math.max(1, active.length))];
  const entityOutcome = applyRoomEntityOutcome(room, scoredEntry);
  const outcome = {
    playerName: target?.name || scoredEntry.playerName || "Team",
    statusLog: "",
    injuryCause: "",
    score: scoredEntry.score,
    entityOutcome
  };
  const pressureSpotlight = Boolean(room.pressureSpotlight);
  const missedSpotlight = pressureSpotlight && timeout && index === 0;
  const catastrophic = missedSpotlight || scoredEntry.score <= -3;
  const bad = scoredEntry.score < 0;
  const strain = scoredEntry.score === 0 || (scoredEntry.chainModifier || 0) < 0;

  if ((catastrophic || bad || strain) && target) {
    const sourceEntity = entityOutcome.target;
    const amount = (missedSpotlight ? 4 : catastrophic ? 3 : bad ? 1 : 0) * actionEntityDamageMultiplier(sourceEntity);
    if (amount) {
      applyDamage(target, amount, "action");
      if (catastrophic && state.rng() < 0.55) addStatusToPlayer(target, randomStatus());
      outcome.injuryCause = missedSpotlight
        ? `${target.name} is hurt because the pressure spike gives them no room to recover after they fail to react.`
        : actionDamageCause(target, scoredList, room, catastrophic ? "disaster" : "failure");
      addEventNote(eventNotes, target.name, outcome.injuryCause);
    }
  }

  const entity = entityOutcome.target;
  if (entity && ["enemy", "hazard"].includes(entity.type) && (Number(entity.pressure) || 0) >= 4 && scoredEntry.score <= 1 && active.length) {
    const pressureTarget = target || active[Math.floor(state.rng() * active.length)];
    if (pressureTarget && !pressureTarget.incapacitated) {
      applyDamage(pressureTarget, 1 * actionEntityDamageMultiplier(entity), "action");
      const cause = actionPressureDamageCause(pressureTarget, entity);
      addEventNote(eventNotes, pressureTarget.name, cause);
      entity.pressure = Math.max(2, (Number(entity.pressure) || 4) - 1);
    }
  }

  if (missedSpotlight && active.length > 1) {
    const splash = active.filter((player) => player.name !== target?.name).slice(0, Math.max(1, Math.floor(active.length / 3)));
    splash.forEach((player) => {
      applyDamage(player, 1, "action");
      const cause = `${player.name} is hurt because the failed reaction lets the room-wide backlash spill across the team's position.`;
      addEventNote(eventNotes, player.name, cause);
    });
  }

  if (!entityOutcome.rewardLines.length && scoredEntry.score >= 5 && room.kind === "resource" && state.rng() < 0.25) {
    state.inventory.medkits += 1;
    outcome.statusLog = `${scoredEntry.playerName}: found 1 Medkit`;
  }

  if (entityOutcome.lines.length || entityOutcome.rewardLines.length) {
    outcome.statusLog = [outcome.statusLog, ...entityOutcome.lines, ...entityOutcome.rewardLines].filter(Boolean).join(" ");
  }

  return outcome;
}

function displayDeferredActionStatus(playerEvents = [], statusLog = "") {
  if (!playerEvents.length && !statusLog) return;
  const entry = document.createElement("div");
  appendDamageLog(entry, {
    players: playerEvents,
    statusLog
  });
  const effects = playerEvents
    .map((event) => {
      const player = findPlayer(event);
      return player ? { player, kind: event.effect || "pulse", amount: event.amount || 0 } : null;
    })
    .filter(Boolean);
  renderStatus();
  renderPlayerDmControls();
  if (effects.length) flashStatusEffects(effects);
}

function makeLocalSingleActionResolutionPrompt(room, scoredEntry, outcome, playerEvents, queue) {
  const previous = queue.index > 0 ? queue.scored[queue.index - 1] : null;
  const next = queue.index + 1 < queue.scored.length ? queue.scored[queue.index + 1] : null;
  const statusContext = playerEvents.length
    ? playerEvents.map((event) => `${event.name}: ${event.incapacitated ? "incapacitated" : "injured"}${event.status.length ? `, ${event.status.join(", ")}` : ""}`).join("; ")
    : `${scoredEntry.playerName}: no injury`;
  const injuryCue = actionInjuryCue(scoredEntry, outcome, playerEvents);
  return dmPrompts.makeSingleActionResolutionPrompt({
    sentenceRange: narrationSentenceRange("1-5", "1-3"),
    playerName: scoredEntry.playerName,
    operation: state.title,
    environment: state.environment,
    areaName: room.areaName,
    roomObjective: room.objective,
    relevantTargetLine: relevantActionTargetLine(scoredEntry),
    action: scoredEntry.action,
    rollLine: actionRollNarrationLine(scoredEntry),
    injuryCue,
    secondaryFacts: outcome.entityOutcome?.secondaryFacts || [],
    rewardFacts: outcome.entityOutcome?.rewardFacts || [],
    statusContext,
    sequenceContext: `${previous ? `${previous.playerName} acted before this.` : "this is the first action"}; ${next ? "another operator still needs to act" : "this is the last individual action before the room outcome is judged"}`,
    threat: state.threat,
    threatProfile: compactThreatProfileOneLine()
  });
}

function actionInjuryCue(scoredEntry, outcome, playerEvents = []) {
  if (!outcome.injuryCause && !playerEvents.some((event) => event.amount > 0)) {
    return "Result to narrate: no injury is required unless it follows naturally.";
  }
  const cue = actionInjuryCueText(scoredEntry, outcome);
  return `Result to narrate: ${scoredEntry.playerName} is injured by ${cue}. Describe the cause naturally inside the scene; do not append a separate injury-explanation sentence.`;
}

function actionInjuryCueText(scoredEntry = {}, outcome = {}) {
  const target = cleanBriefingField(scoredEntry.resolvedTargetLabel || scoredEntry.targetText || "");
  const type = outcome.entityOutcome?.target?.type || "";
  const action = normalize(scoredEntry.action);
  if (type === "enemy") return "the hostile response to this action";
  if (type === "hazard") return target && !isGenericActionEntityLabel(target) ? `contact with ${target}` : "the room hazard reacting to the action";
  if (/\bshoot|fire|gun\b/.test(action)) return "fragments, sparks, or ricochet from the shot";
  if (/\bwire|cable|conduit|relay|panel|terminal|breaker\b/.test(action)) return "electrical contact from damaged equipment";
  if (/\bsearch|open|pry|grab|pull\b/.test(action)) return "disturbing an unstable fixture or trapped object";
  if (/\brun|sprint|charge|jump|dive\b/.test(action)) return "moving into an unsecured hazard";
  return "the physical consequence of the action";
}

function relevantActionTargetLine(scoredEntry) {
  const resolution = scoredEntry.targetResolution || "";
  if (["invalid_target", "no_target"].includes(resolution)) return "";
  const label = sanitizeText(scoredEntry.resolvedTargetLabel || scoredEntry.targetText || scoredEntry.targetId || "", { maxLength: 120 });
  if (!label || normalize(label) === "nothing") return "";
  return `Relevant target: ${label}.`;
}

function compactThreatProfileOneLine() {
  const details = [
    state.threatProfile?.description,
    state.threatProfile?.generated?.manifestation,
    state.threatProfile?.generated?.tactics || state.threatProfile?.tactics
  ].map((item) => cleanBriefingField(item)).filter(Boolean);
  return trimTextToLength(details.join(" "), 320);
}

function singleActionResolutionFallback(room, scoredEntry, outcome, playerEvents, queue) {
  const action = actionFallbackOpening(scoredEntry);
  const modifier = scoredEntry.chainModifier > 0
    ? "The previous operator's work gives the attempt a cleaner opening."
    : scoredEntry.chainModifier < 0
    ? "The previous action leaves the room unstable, turning the attempt dangerous."
    : "";
  const injury = playerEvents.length
    ? ` ${playerEvents.map((event) => eventNarrativeInjurySentence(event)).join(" ")}`
    : "";
  const continuation = queue.index + 1 < queue.scored.length ? "The next operator has to move before the room can be judged." : "The last action lands, and the room's reaction is about to decide the route.";
  return collapseActionDamageSentences(`${action} ${modifier} ${state.threat} keeps pressure on the chamber as the result takes shape.${injury} ${continuation}`, playerEvents);
}

function actionFallbackOpening(scoredEntry) {
  const name = cleanBriefingField(scoredEntry?.playerName) || "The operator";
  const action = cleanBriefingField(scoredEntry?.action);
  if (!action) return `${name} moves into the room's pressure and tests the danger.`;
  const withoutName = action.replace(new RegExp(`^${escapeRegExp(name)}\\s+`, "i"), "").trim();
  if (/^pose\b|dramatic|showboat|flex|dance|taunt/i.test(withoutName)) {
    return `${name} turns the moment into a display, holding the pose long enough for the room to react.`;
  }
  return `${name} follows through on the action: ${withoutName}.`;
}

function applyActionRollModifiers(scored, room) {
  return scored.map((entry) => {
    const roll = Math.floor(state.rng() * 10) + 1;
    const result = actionRollResult(roll);
    const target = findRoomEntity(room, entry.targetId);
    const adjusted = {
      ...entry,
      roll,
      rollTier: result.tier,
      rollModifier: result.scoreModifier,
      rollFacts: [...result.facts],
      score: Math.max(-5, Math.min(6, Number(entry.score || 0) + result.scoreModifier)),
      reasons: [...asArray(entry.reasons), `${result.scoreModifier >= 0 ? "+" : ""}${result.scoreModifier} ${result.label}`]
    };
    if (Number.isFinite(Number(entry.scoreCap))) {
      adjusted.score = Math.min(adjusted.score, Number(entry.scoreCap));
      adjusted.rollFacts.push("the unsafe method prevents the action from becoming clean progress");
    }

    if (result.pressureDelta > 0) {
      adjusted.pressureDelta = Math.max(Number(adjusted.pressureDelta) || 0, result.pressureDelta);
    } else if (result.pressureDelta < 0) {
      adjusted.pressureDelta = Math.min(Number(adjusted.pressureDelta) || 0, result.pressureDelta);
    }
    if (result.risk && !entry.safetyOverride) adjusted.risk = result.risk;
    if (result.forceCategory && !["harmful", "reckless"].includes(adjusted.category)) adjusted.category = result.forceCategory;

    if (target?.type === "enemy" && result.entityDamage) {
      adjusted.entityDamage = Math.max(Number(adjusted.entityDamage) || 0, result.entityDamage);
    }
    if (target?.type === "enemy" && result.createsOpening) adjusted.createsOpening = true;
    return adjusted;
  });
}

function actionRollResult(roll) {
  if (roll >= 10) {
    return {
      tier: "critical-success",
      label: "critical success",
      scoreModifier: 2,
      pressureDelta: -1,
      entityDamage: 2,
      createsOpening: true,
      facts: ["the action lands unusually cleanly", "the room briefly gives the operator an opening"]
    };
  }
  if (roll >= 7) {
    return {
      tier: "strong-success",
      label: "strong success",
      scoreModifier: 1,
      pressureDelta: 0,
      entityDamage: 1,
      createsOpening: false,
      facts: ["the action gains more ground than expected"]
    };
  }
  if (roll >= 3) {
    return {
      tier: "normal",
      label: "steady result",
      scoreModifier: 0,
      pressureDelta: 0,
      entityDamage: 0,
      createsOpening: false,
      facts: ["the action plays out according to its quality"]
    };
  }
  if (roll === 2) {
    return {
      tier: "complication",
      label: "complication",
      scoreModifier: -1,
      pressureDelta: 1,
      entityDamage: 0,
      createsOpening: false,
      risk: "medium",
      facts: ["the action partly works but introduces a complication"]
    };
  }
  return {
    tier: "critical-failure",
    label: "critical failure",
    scoreModifier: -2,
    pressureDelta: 2,
    entityDamage: 0,
    createsOpening: false,
    risk: "high",
    forceCategory: "reckless",
    facts: ["the action backfires badly", "the room or threat gains a dangerous opening"]
  };
}

function actionRollNarrationLine(scoredEntry) {
  const facts = asArray(scoredEntry.rollFacts).filter(Boolean);
  const safety = scoredEntry.safetyOverride?.reason
    ? `Safety context: ${scoredEntry.safetyOverride.reason}; the action should not be narrated as clean success.`
    : "";
  if (!facts.length && !safety) return "";
  const guidance = {
    "critical-success": "Outcome tone: the action should feel unusually clean, decisive, or lucky, with an opening created by the result.",
    "strong-success": "Outcome tone: the action should feel cleaner or more effective than expected.",
    normal: "Outcome tone: the action should resolve according to its basic quality without extra luck or backlash.",
    complication: "Outcome tone: the action should partly work or remain plausible, but add a complication or rising pressure.",
    "critical-failure": "Outcome tone: the action should backfire badly, intensify danger, or give the room/threat an opening."
  };
  return [`Action variance: ${facts.join("; ")}. ${guidance[scoredEntry.rollTier] || ""}`, safety].filter(Boolean).join(" ");
}

function evaluateActionRoom(room, entries, options = {}) {
  const active = activePlayers();
  const eventNotes = options.eventNotes || bleedTick();
  const scoredBase = options.preScored ? [] : entries.length
    ? entries.map((entry) => scoreActionEntry(room, entry))
    : [{ playerName: "Team", action: "No decisive action", score: -2, reasons: ["no one commits to a useful move"], risk: "high" }];
  const scored = options.preScored || applyActionChainModifiers(scoredBase);
  const scores = scored.map((entry) => entry.score);
  const average = scores.reduce((sum, value) => sum + value, 0) / Math.max(1, scores.length);
  const best = Math.max(...scores);
  const worst = Math.min(...scores);
  const primary = room.scoring === "best" ? best : room.scoring === "worst" ? worst : average;
  const attempt = state.actionRoomAttempts[state.currentQuestion] || 0;
  let tier = "stall";
  if (primary >= 3.5) tier = "excellent";
  else if (primary >= 2) tier = "success";
  else if (primary >= 1) tier = "partial";
  else if (primary < -2 || (room.kind === "escape" && attempt + 1 >= (room.turnLimit || 3) && primary < 1)) tier = "disaster";
  else if (primary < 0) tier = "failure";

  const progress = ["excellent", "success"].includes(tier);
  const damaged = [];
  const lowScorers = scored.filter((entry) => entry.score < 0);
  const targetPlayers = lowScorers
    .map((entry) => findPlayer({ name: entry.playerName }))
    .filter((player) => player && !player.incapacitated);

  if (options.skipConsequences) {
    if (["failure", "disaster"].includes(tier)) state.actionThreatPressure += tier === "disaster" ? 2 : 1;
    else if (["excellent", "success"].includes(tier)) state.actionThreatPressure = Math.max(0, state.actionThreatPressure - 1);
  } else if (tier === "partial") {
    const target = targetPlayers[0] || active[Math.floor(state.rng() * Math.max(1, active.length))];
    if (target) {
      applyDamage(target, 1, "action");
      addEventNote(eventNotes, target.name, actionDamageCause(target, scored, room, "partial"));
      damaged.push(target.name);
    }
    state.actionThreatPressure += 1;
  } else if (tier === "failure") {
    const targets = targetPlayers.length ? targetPlayers.slice(0, 2) : active.slice(0, 1);
    targets.forEach((player) => {
      applyDamage(player, 1, "action");
      addEventNote(eventNotes, player.name, actionDamageCause(player, scored, room, "failure"));
      damaged.push(player.name);
    });
    state.actionThreatPressure += 1;
  } else if (tier === "disaster") {
    const targets = targetPlayers.length ? targetPlayers : active;
    targets.slice(0, Math.max(1, Math.ceil(active.length / 2))).forEach((player) => {
      applyDamage(player, 2, "action");
      if (state.rng() < 0.45) addStatusToPlayer(player, randomStatus());
      addEventNote(eventNotes, player.name, actionDamageCause(player, scored, room, "disaster"));
      damaged.push(player.name);
    });
    state.actionThreatPressure += 2;
  } else if (tier === "excellent") {
    if (room.kind === "resource" || state.rng() < 0.25) state.inventory.medkits += 1;
    state.actionThreatPressure = Math.max(0, state.actionThreatPressure - 1);
  } else if (tier === "success") {
    state.actionThreatPressure = Math.max(0, state.actionThreatPressure - 1);
  }

  return { room, scored, tier, progress, primary, average, best, worst, damaged, eventNotes };
}

function formatActionRoomScoreDebug(room, resolution) {
  const winCondition = actionRoomWinCondition(room);
  const actionScores = resolution.scored.map((entry, index) => ({
    order: index + 1,
    player: entry.playerName,
    action: entry.action,
    score: entry.score,
    category: entry.category,
    risk: entry.risk || "",
    target: entry.resolvedTargetLabel || entry.targetId || "nothing",
    senseRating: entry.senseRating || "",
    d10: entry.roll || "",
    rollResult: entry.rollTier || "",
    rollModifier: entry.rollModifier || 0,
    rollFacts: entry.rollFacts || [],
    safetyOverride: entry.safetyOverride || null,
    reasons: entry.reasons || []
  }));
  return {
    objective: room.objective,
    winCondition,
    scoringMethod: room.scoring || "team",
    advancementThreshold: "primary score >= 2.0",
    tier: resolution.tier,
    progress: resolution.progress,
    primaryScore: Number(resolution.primary.toFixed(2)),
    teamAverage: Number(resolution.average.toFixed(2)),
    bestScore: resolution.best,
    worstScore: resolution.worst,
    actionScores
  };
}

function actionRoomWinCondition(room = {}) {
  const scoring = room.scoring || "team";
  const basis = scoring === "best"
    ? "highest single operator score"
    : scoring === "worst"
    ? "lowest operator score"
    : "team average score";
  const limit = room.turnLimit ? ` Escape limit: ${room.turnLimit} attempts.` : "";
  return `${room.objective || "complete the room objective"} Primary score is based on ${basis}. The room advances on success or excellent results only: primary score 2.0 or higher.${limit}`;
}

function actionDamageCause(player, scored, room, tier) {
  const entry = scored.find((item) => sameName(item.playerName, player.name)) || scored[0];
  const action = entry?.action || "their attempted action";
  const entity = findRoomEntity(room, entry?.targetId);
  if (entry?.modelJudged && entity && !isGenericActionEntityLabel(entity.label)) {
    if (entity.type === "enemy") return `${player.name} is hurt when ${state.threat} exploits the opening left by the attempted move.`;
    if (entity.type === "hazard") return `${player.name} is hurt when ${entity.label} flares across their path before they can clear the danger.`;
    return `${player.name} is hurt when ${entity.label} fails under the attempted move and throws the impact back at them.`;
  }
  const cause = actionHazardCause(action, room, tier);
  return `${player.name} is hurt because ${cause}`;
}

function actionPressureDamageCause(player, entity) {
  const label = cleanBriefingField(entity?.label);
  if (!label || isGenericActionEntityLabel(label)) {
    return `${player.name} is hurt when the room's active hazard surges under mounting pressure and lashes back through the chamber.`;
  }
  if (entity.type === "enemy") {
    return `${player.name} is hurt when ${state.threat} uses the mounting pressure to strike across the room.`;
  }
  return `${player.name} is hurt when ${label} surges under mounting pressure and lashes back through the room.`;
}

function isGenericActionEntityLabel(label) {
  return /^(?:unstable room hazard|ambient hazard|room hazard|active hazard|route access point|route exit|object|hazard)$/i.test(cleanBriefingField(label));
}

function actionHazardCause(action, room, tier) {
  const text = normalize(action);
  if (/\bemp|pulse|grenade|jammer\b/.test(text)) return "the electromagnetic burst rebounds through live conductors and turns nearby metal into a snapping current path.";
  if (/\bgrenade|explosive|blast|charge\b/.test(text)) return "the blast overpressures the confined room and throws fragments back across the team lane.";
  if (/\bshoot|fire|gun\b/.test(text)) return "the shot strikes unstable equipment and sends fragments or sparks back through the room.";
  if (/\bwire|cable|conduit|relay|panel|terminal|breaker\b/.test(text)) return "the damaged electrical system surges through the contact point before they can break away.";
  if (/\brun|sprint|charge|jump|dive\b/.test(text)) return "their movement carries them into an exposed hazard before the route is secured.";
  if (/\bsearch|open|pry|grab|pull\b/.test(text)) return "the disturbed fixture snaps loose and catches them before they can get clear.";
  if (/\btalk|shout|threaten|call|radio\b/.test(text)) return "the sound or signal draws the room's hostile pressure directly onto their position.";
  if (tier === "disaster") return "the room's main hazard cascades through their position after the action collapses.";
  if (room.kind === "enemy") return `${state.threat} exploits the opening left by their action.`;
  return "the room reacts badly to the attempted move and the hazard catches them at close range.";
}

function applyActionChainModifiers(scored) {
  return scored.map((entry, index, list) => {
    if (index === 0) return entry;
    const previous = list[index - 1];
    let modifier = 0;
    const reasons = [...entry.reasons];
    if (previous.score >= 4) {
      modifier += 1;
      reasons.push("+1 helped by previous action");
    } else if (previous.score <= -2) {
      modifier -= 1;
      reasons.push("-1 complicated by previous action");
    }
    return {
      ...entry,
      score: Math.max(-5, Math.min(6, entry.score + modifier)),
      chainModifier: modifier,
      reasons
    };
  });
}

function scoreActionEntry(room, entry) {
  const action = sanitizeText(entry?.action, { maxLength: 180 }).toLowerCase();
  const category = heuristicSideActionClassification(action).category || "flavor";
  let score = 0;
  const reasons = [];
  const add = (points, reason) => {
    score += points;
    reasons.push(`${points > 0 ? "+" : ""}${points} ${reason}`);
  };
  if (action.length > 18) add(1, "specific");
  else add(-1, "vague");
  if (/\b(help|cover|protect|carry|assist|guard|brace|shield|stabilize)\b/.test(action)) add(1, "team support");
  if (/\b(search|scan|inspect|read|listen|watch|look)\b/.test(action)) add(room.kind === "normal" || room.kind === "resource" || room.kind === "puzzle" || room.kind === "dialogue" ? 2 : 1, "investigates the room");
  if (/\b(repair|fix|reroute|bypass|patch|seal|ground|restore|calibrate|align)\b/.test(action)) add(room.kind === "repair" || room.kind === "hazard" || room.kind === "defense" ? 2 : 1, "addresses systems");
  if (/\b(hide|sneak|quiet|crawl|distract|decoy|wait)\b/.test(action)) add(room.kind === "stealth" || room.kind === "enemy" ? 2 : 0, "matches stealth pressure");
  if (/\b(attack|shoot|hit|trap|fight|block|barricade|hold)\b/.test(action)) add(room.kind === "enemy" || room.kind === "defense" ? 2 : -1, "uses force");
  if (/\b(talk|ask|question|calm|negotiate|warn|signal|radio)\b/.test(action)) add(room.kind === "dialogue" || room.kind === "question" ? 2 : 0, "communicates");
  if (/\b(run|escape|open|unlock|force|climb|crawl)\b/.test(action)) add(room.kind === "escape" || room.kind === "normal" ? 2 : 0, "moves toward progress");
  if (/\b(backflip|dance|sing|joke|impress)\b/.test(action)) add(room.kind === "dialogue" ? 0 : -1, "silly under pressure");
  if (/\b(cut off|stab teammate|shoot teammate|kill chris|kill davis|kill morgan|kill lee|kill taylor|kill jordan)\b/.test(action)) add(-4, "harmful to the team");
  if (/\b(live wire|bare hand|jump into|touch the arc|drink|lick)\b/.test(action)) add(-3, "reckless hazard contact");
  if (!action) add(-2, "no action");
  return {
    playerName: entry?.playerName || "Team",
    action: entry?.action || "No decisive action",
    category,
    score: Math.max(-5, Math.min(6, score)),
    reasons
  };
}

function nextActionRoomInfo() {
  const nextIndex = Math.min(state.currentQuestion + 1, state.questions.length - 1);
  const room = state.actionRooms[nextIndex];
  if (!room || state.currentQuestion + 1 >= state.questions.length) {
    return {
      areaName: "Extraction Marker",
      tag: "Final Mission Result",
      questionText: "",
      question: null,
      type: { label: "Final Mission Result" },
      activeObstacle: "The final route is ready to resolve."
    };
  }
  const node = state.nodes[state.currentNode + 1] || {};
  return {
    areaName: room.areaName || roomName(node, state.currentNode + 1),
    tag: room.label,
    questionText: actionRoomPromptText(room, 0),
    question: { question: actionRoomPromptText(room, 0), mode: "action" },
    type: { label: room.label, kind: "action" },
    activeObstacle: actionRoomObstacle(room, 0),
    actionRoom: room
  };
}

function actionResolutionStatusLog(resolution, playerEvents) {
  const scoreLine = `Room result: ${resolution.progress ? "progress made" : "route held"}.`;
  const changes = playerEvents.map((event) => `${event.name}: ${event.note}${event.status.length ? `, ${event.status.join(", ")}` : ""}`);
  return [scoreLine, ...changes].join(" ");
}

function makeLocalActionRoomResolutionPrompt(room, resolution, entries, playerEvents, nextInfo) {
  return [
    `Write a player-facing action-room resolution in ${narrationSentenceRange("4-7", "2-4")} sentences.`,
    "Use the submitted actions as real physical choices in the scene.",
    "Do not mention score numbers, threat pressure, hidden mechanics, categories, rolls, quiz, questions, or answer choices.",
    "Mandatory: if any affected player lost HP or gained a status, explicitly narrate why it happened, tied to that player and their action. Do not leave damage unexplained.",
    "If the team fails or stalls, keep them in the current room and make the next action opportunity clear.",
    "If the team progresses, resolve the room consequence first, then point toward the next area without describing the next room's full prompt.",
    actionThreatContinuityRule(room),
    `Operation: ${state.title}.`,
    `Environment: ${state.environment}.`,
    `Current area: ${room.areaName}.`,
    `Room type: ${room.label}.`,
    `Objective: ${room.objective}.`,
    `Result tier: ${resolution.tier}. Progress: ${resolution.progress ? "yes" : "no"}.`,
    `Submitted actions: ${entries.length ? entries.map((entry) => `${entry.playerName || "Team"}: ${entry.action}`).join("; ") : "No decisive action."}`,
    `Resolve the actions in this order, letting earlier actions modify the danger or opportunity for later actions: ${resolution.scored.map((entry) => entry.playerName).join(" -> ")}.`,
    `Action assessments for context only: ${resolution.scored.map((entry) => `${entry.playerName}: ${entry.score} (${entry.reasons.join(", ")})`).join("; ")}.`,
    `Hidden threat pressure for tone only: ${state.actionThreatPressure}.`,
    playerEvents.length ? `Injury facts to reflect without copying this wording: ${playerEvents.map((event) => `${event.name}: ${actionInjuryCueText(resolution.scored.find((entry) => sameName(entry.playerName, event.name)) || {}, findActionOutcomeForPlayer(event.name, resolution, room))}`).join("; ")}.` : "",
    playerEvents.length ? `Affected players: ${compactTeamStatusText(playerEvents)}.` : "Affected players: none.",
    `Threat: ${state.threat}; ${compactThreatProfileText()}.`,
    `Next area if progress occurs: ${nextInfo.areaName}.`
  ].filter(Boolean).join("\n");
}

function findActionOutcomeForPlayer(playerName, resolution = {}, room = {}) {
  const entry = (resolution.scored || []).find((item) => sameName(item.playerName, playerName));
  if (!entry) return null;
  return {
    entityOutcome: {
      target: findRoomEntity(room, entry.targetId)
    }
  };
}

function actionRoomResolutionFallback(room, resolution, entries, playerEvents, nextInfo) {
  const actions = entries.length ? entries.map((entry) => `${entry.playerName || "Team"} tries to ${entry.action}`).join("; ") : "The squad hesitates without committing to a clear move";
  const consequence = resolution.progress
    ? `The room gives way under the combined effort, and the route opens toward ${nextInfo.areaName}.`
    : `The room refuses to yield, and ${state.threat} presses closer through the failing systems.`;
  const injuries = playerEvents.length ? ` ${playerEvents.map((event) => `${event.cause || event.note} ${event.name} is left at ${event.hp} HP`).join(" ")}` : "";
  return `${actions}. ${consequence}${injuries}`;
}

function makeLocalActionRoomSummaryPrompt(room, resolution, entries, nextInfo) {
  return [
    "FINAL OUTPUT ONLY. Return valid JSON only. No markdown.",
    "Write player-facing action-room resolution text.",
    `Return this exact shape: {"outcome":"${narrationSentenceRange("1-5", "1-3")} sentences resolving the current room","transition":"${narrationSentenceRange("1-4", "1-2")} sentences moving from the current room toward the next area"}`,
    "The outcome resolves how the completed sequence of operator actions changes the current room.",
    "The transition describes the team physically leaving this room and approaching the next area. It must be model-written, specific, and not use generic route-marker phrasing.",
    "Do not repeat each action in detail; those have already been narrated.",
    "Do not mention scores, hidden pressure, mechanics, prompts, turns, categories, or rules.",
    "Use third person only. Do not write you or your.",
    resolution.progress
      ? "The team makes progress. The transition should carry the consequences forward into the next area without fully describing the next room's encounter."
      : "The room holds. Leave transition empty and make the outcome clear that the team must try another set of field actions here.",
    actionThreatContinuityRule(room),
    `Operation: ${state.title}.`,
    `Environment: ${state.environment}.`,
    `Current area: ${room.areaName}.`,
    `Room type: ${room.label}.`,
    `Objective: ${room.objective}.`,
    `Final room entity state:\n${roomEntitySummary(room)}`,
    `Overall result: ${resolution.tier}. Progress: ${resolution.progress ? "yes" : "no"}.`,
    `Action order completed: ${entries.length ? entries.map((entry) => entry.playerName || "Team").join(" -> ") : "No decisive action"}.`,
    `Threat: ${state.threat}; ${compactThreatProfileText()}.`,
    `Next area if progress occurs: ${nextInfo.areaName}.`,
    `Next area objective/prompt context, private only: ${nextInfo.questionText || "final route resolution"}.`
  ].filter(Boolean).join("\n");
}

function parseActionRoomSummaryResponse(text, fallbackOutcome, fallbackTransition, progress) {
  const parsed = parseJsonObjectFromText(text);
  if (parsed && typeof parsed === "object") {
    const outcome = cleanLocalNarration(parsed.outcome || parsed.story || parsed.text || "") || fallbackOutcome;
    const transition = progress ? cleanLocalNarration(parsed.transition || parsed.continuation || "") || fallbackTransition : "";
    return { outcome, transition };
  }
  const cleaned = cleanLocalNarration(text);
  return {
    outcome: cleaned || fallbackOutcome,
    transition: progress ? fallbackTransition : ""
  };
}

function actionRoomSummaryFallback(room, resolution, nextInfo) {
  if (resolution.progress) {
    return `The last action settles into place, and ${room.areaName} finally gives the squad a way through. ${state.threat} recoils through the failing systems but does not disappear. The route opens toward ${nextInfo.areaName}.`;
  }
  return `The last action fails to break the room's hold, and ${room.areaName} stays hostile around the squad. ${state.threat} keeps its grip on the route, forcing the operators to commit to another plan before they can move on.`;
}

function actionRoomContinuationStory(room, nextInfo, resolution) {
  if (!nextInfo.questionText) return "The squad clears the final obstruction and follows the last signal toward extraction.";
  const tone = resolution.tier === "excellent" ? "with momentum" : resolution.tier === "partial" ? "under pressure" : "through the smoke";
  return `The team leaves ${room.areaName} ${tone}, following the route markers toward ${nextInfo.areaName}. The next space is already reacting to their presence.`;
}

function clearLockedOperatorAnswerWindow() {
  if (state.lockedOperatorWindowTimer) window.clearTimeout(state.lockedOperatorWindowTimer);
  state.lockedOperatorWindowTimer = null;
  state.lockedOperatorWindowPromptId = "";
  state.lockedOperatorWindowDeadline = 0;
}

function resolveLockedOperatorResponses(answers, reason = "locked operator responses received") {
  const info = currentQuestionInfo();
  if (!info?.type?.locked || !info.operator || !answers?.length) return false;
  const operatorAnswer = answers.find((answer) => sameName(answer.playerName, info.operator.name));
  if (!operatorAnswer?.answer) return false;
  const teamScoring = usesIndividualTeamDeviceScoring(info);
  const entries = teamScoring
    ? deviceTeamAnswerEntries(answers, info.question)
    : deviceAnswerEntries(answers, info.question);
  if (!entries.length) return false;
  clearLockedOperatorAnswerWindow();
  setDeviceAnswerResults(entries);
  awardDeviceAnswerPointsOnce(entries, info.question);
  logDebugEvent({
    kind: "state",
    label: "Resolving locked operator responses",
    detail: `${state.playerPromptId || "current prompt"} | ${entries.length} response${entries.length === 1 ? "" : "s"} | ${reason}`
  });
  if (teamScoring) {
    return queueFinalSubmissionResolution(
      () => resolveLocalDeviceTeamAnswers(answers),
      reason
    );
  }
  return queueFinalSubmissionResolution(
    () => submitDeviceAnswer(operatorAnswer.answer),
    reason
  );
}

function startLockedOperatorAnswerWindow(promptId, operatorSubmittedAt = Date.now()) {
  if (!promptId || state.lockedOperatorWindowPromptId === promptId || state.resolutionDelayPending || state.answerPending || state.resolved) return;
  clearLockedOperatorAnswerWindow();
  state.lockedOperatorWindowPromptId = promptId;
  const submittedAt = Number(operatorSubmittedAt) || Date.now();
  state.lockedOperatorWindowDeadline = submittedAt + LOCKED_OPERATOR_FOLLOWUP_MS;
  const remainingMs = Math.max(0, state.lockedOperatorWindowDeadline - Date.now());
  logDebugEvent({
    kind: "state",
    label: "Locked operator follow-up window opened",
    detail: `${promptId} | ${remainingMs}ms remaining of ${LOCKED_OPERATOR_FOLLOWUP_MS}ms for remaining operators`
  });
  state.lockedOperatorWindowTimer = window.setTimeout(() => {
    state.lockedOperatorWindowTimer = null;
    if (!state.started || state.playerPromptId !== promptId || state.resolved || state.answerPending || state.resolutionDelayPending) return;
    const info = currentQuestionInfo();
    if (!info?.type?.locked || !info.operator) return;
    const operatorAnswer = state.playerAnswers.find((answer) => sameName(answer.playerName, info.operator.name));
    if (!operatorAnswer?.answer) return;
    const answers = deviceAnswersWithTimeouts([...state.playerAnswers]);
    resolveLockedOperatorResponses(answers, "10-second locked operator follow-up expired");
  }, remainingMs);
}

function maybeAutoResolveEmergencyAnswer() {
  if (!state.questionPresentationReady || state.answerPending || state.resolutionDelayPending || state.resolved) return;
  const info = currentQuestionInfo();
  const answers = [...state.playerAnswers].sort((a, b) => a.submittedAt - b.submittedAt);
  const hadRequiredSnapshot = Boolean(state.playerPromptRequiredIds?.length || state.playerPromptRequiredNames?.length);
  const noAvailableResponders = hadRequiredSnapshot
    && promptResponderGraceElapsed()
    && !requiredDeviceAnswerIds(info).size
    && !requiredDeviceAnswerNames(info).size;
  if (noAvailableResponders) {
    logDebugEvent({
      kind: "state",
      label: "Disconnected responders timed out",
      detail: `${state.playerPromptId || "current prompt"} continued after ${PLAYER_HEARTBEAT_STALE_MS}ms without a heartbeat`
    });
    if (usesIndividualTeamDeviceScoring(info)) {
      const timedOutAnswers = deviceAnswersWithTimeouts(answers);
      queueFinalSubmissionResolution(
        () => resolveLocalDeviceTeamAnswers(timedOutAnswers),
        "unavailable operators timed out"
      );
    } else {
      queueFinalSubmissionResolution(
        () => submitDeviceAnswer(TIMEOUT_ANSWER),
        info.type.locked ? "locked operator disconnected" : "required operators disconnected"
      );
    }
    return;
  }
  if (!answers.length) return;
  if (info.type.kind === "emergency") {
    const entries = deviceAnswerEntries([answers[0]], info.question);
    setDeviceAnswerResults(entries);
    awardDeviceAnswerPointsOnce(entries, info.question);
    logDebugEvent({
      kind: "state",
      label: "Auto-resolving emergency answer",
      detail: `${answers[0].playerName || answers[0].playerId || "unknown"} submitted first for ${state.playerPromptId || "current prompt"}`
    });
    const timerSnapshot = state.emergencyTimer ? { ...state.emergencyTimer } : null;
    queueFinalSubmissionResolution(() => {
      if (state.localDmMode && state.chatMode) resolveLocalEmergencyDeviceAnswer(answers[0], timerSnapshot);
      else submitDeviceAnswer(answers[0].answer);
    }, "first emergency response received");
    return;
  }
  if (info.type.locked && info.operator) {
    const operatorAnswer = answers.find((answer) => sameName(answer.playerName, info.operator.name));
    if (!operatorAnswer?.answer) return;
    if (everyoneActiveSubmitted(answers)) {
      resolveLockedOperatorResponses(answers, "all locked challenge responders received");
    } else {
      startLockedOperatorAnswerWindow(state.playerPromptId, operatorAnswer.submittedAt);
    }
    return;
  }
  if (everyoneActiveSubmitted(answers)) {
    awardDeviceAnswerPointsOnce(deviceAnswerEntries(answers, info.question), info.question);
    if (usesIndividualTeamDeviceScoring(info)) {
      queueFinalSubmissionResolution(
        () => resolveLocalDeviceTeamAnswers(answers),
        "all required operator responses received"
      );
      return;
    }
    setDeviceAnswerResults(deviceAnswerEntries(answers, info.question));
    const popular = mostPopularAnswer(answers);
    if (popular) {
      logDebugEvent({
        kind: "state",
        label: "Auto-resolving team answer",
        detail: `All required operators submitted for ${state.playerPromptId || "current prompt"}`
      });
      queueFinalSubmissionResolution(
        () => submitDeviceAnswer(popular),
        "all required operator responses received"
      );
    }
  }
}

function usesIndividualTeamDeviceScoring(info) {
  return state.deviceMode === "multi"
    && state.localDmMode
    && ["individual", "team", "truefalse", "locked"].includes(info?.type?.kind)
    && state.nodes[state.currentNode]?.type !== "recovery";
}

function snapshotPromptRequiredResponders(prompt = null) {
  if (!prompt || prompt.kind === "recovery" || prompt.actionOnly) {
    state.playerPromptRequiredIds = [];
    state.playerPromptRequiredNames = [];
    state.playerPromptRequiredAt = 0;
    return;
  }
  const info = currentQuestionInfo();
  if (!info?.question || info.type?.kind === "emergency") {
    state.playerPromptRequiredIds = [];
    state.playerPromptRequiredNames = [];
    state.playerPromptRequiredAt = 0;
    return;
  }
  state.playerPromptRequiredIds = [...requiredDeviceAnswerIds(info, { live: true })];
  state.playerPromptRequiredNames = [...requiredDeviceAnswerNames(info, { live: true })];
  state.playerPromptRequiredAt = Date.now();
  logDebugEvent({
    kind: "state",
    label: "Required responders locked",
    detail: [
      state.playerPromptId || "no prompt id",
      state.playerPromptRequiredNames.length ? `names: ${state.playerPromptRequiredNames.join(", ")}` : "",
      state.playerPromptRequiredIds.length ? `ids: ${state.playerPromptRequiredIds.join(", ")}` : ""
    ].filter(Boolean).join(" | ")
  });
}

function everyoneActiveSubmitted(answers) {
  const info = currentQuestionInfo();
  const requiredIds = requiredDeviceAnswerIds(info);
  if (requiredIds.size) {
    const submittedIds = new Set(answers.map((answer) => String(answer.playerId || "")).filter(Boolean));
    if ([...requiredIds].every((id) => submittedIds.has(id))) return true;
    // A reconnect can legitimately change a participant id while the prompt
    // is still active. If the answer's normalized player names satisfy the
    // same required roster, do not strand the encounter on an old id snapshot.
    const requiredNames = requiredDeviceAnswerNames(info);
    if (requiredNames.size) {
      const submittedNames = new Set(answers.map((answer) => normalize(answer.playerName)).filter(Boolean));
      return [...requiredNames].every((name) => submittedNames.has(name));
    }
    return false;
  }
  const activeNames = requiredDeviceAnswerNames(info);
  if (!activeNames.size) {
    const hadRequiredSnapshot = Boolean(state.playerPromptRequiredIds?.length || state.playerPromptRequiredNames?.length);
    return hadRequiredSnapshot && answers.length > 0;
  }
  const submitted = new Set(answers.map((answer) => normalize(answer.playerName)));
  return [...activeNames].every((name) => submitted.has(name));
}

function requiredDeviceAnswerIds(info = currentQuestionInfo(), options = {}) {
  if (info?.type?.kind === "emergency") return new Set();
  if (!options.live && state.playerPromptRequiredIds?.length) {
    return new Set(state.playerPromptRequiredIds.filter((id) => promptResponderIdAvailable(id)));
  }
  const activeRoster = new Set(activePlayers().map((player) => normalize(player.name)));
  const ids = state.playerParticipants
    .filter((player) => activeRoster.has(normalize(player.name)))
    .map((player) => String(player.id || ""))
    .filter(Boolean);
  return new Set(ids);
}

function requiredDeviceAnswerNames(info = currentQuestionInfo(), options = {}) {
  if (info?.type?.kind === "emergency") return new Set();
  if (!options.live && state.playerPromptRequiredNames?.length) {
    return new Set(state.playerPromptRequiredNames.filter((name) => promptResponderNameAvailable(name)));
  }
  const activeRoster = new Set(activePlayers().map((player) => normalize(player.name)));
  const connected = state.playerParticipants
    .map((player) => normalize(player.name))
    .filter((name) => activeRoster.has(name));
  return new Set(connected.length ? connected : [...activeRoster]);
}

function promptResponderGraceElapsed() {
  return Boolean(state.playerPromptRequiredAt && Date.now() - state.playerPromptRequiredAt >= PLAYER_HEARTBEAT_STALE_MS);
}

function participantHeartbeatActive(participant) {
  if (!participant) return false;
  if (participant.simulated) return true;
  const lastSeenAt = Number(participant.lastSeenAt) || 0;
  return !lastSeenAt || Date.now() - lastSeenAt < PLAYER_HEARTBEAT_STALE_MS;
}

function promptResponderIdAvailable(id) {
  if (!promptResponderGraceElapsed()) return true;
  if (state.playerAnswers.some((answer) => String(answer.playerId || "") === String(id))) return true;
  return participantHeartbeatActive(state.playerParticipants.find((participant) => String(participant.id || "") === String(id)));
}

function promptResponderNameAvailable(name) {
  if (!promptResponderGraceElapsed()) return true;
  if (state.playerAnswers.some((answer) => normalize(answer.playerName) === normalize(name))) return true;
  return participantHeartbeatActive(state.playerParticipants.find((participant) => sameName(participant.name, name)));
}

function canUseIndividualPlayerAnswer() {
  if (!state.questionPresentationReady || state.answerPending || state.resolutionDelayPending || state.resolved) return false;
  const info = currentQuestionInfo();
  if (info.type.kind === "emergency") return true;
  if (info.type.locked) return true;
  if (["individual", "team", "truefalse"].includes(info.type.kind)) return everyoneActiveSubmitted(state.playerAnswers);
  return true;
}

function mostPopularAnswer(answers) {
  const counts = new Map();
  for (const answer of answers) {
    const key = normalize(answer.answer);
    if (!key) continue;
    const current = counts.get(key) || { count: 0, firstTime: answer.submittedAt, value: answer.answer };
    current.count += 1;
    current.firstTime = Math.min(current.firstTime, answer.submittedAt);
    counts.set(key, current);
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.firstTime - b.firstTime)[0]?.value || "";
}

function deviceTeamAnswerEntries(answers, question) {
  const requiredNames = state.playerPromptRequiredNames?.length
    ? new Set(state.playerPromptRequiredNames)
    : null;
  const roster = requiredNames
    ? state.players.filter((player) => requiredNames.has(normalize(player.name)))
    : activePlayers();
  return roster.map((player) => {
    const submitted = answers.find((answer) => sameName(answer.playerName, player.name));
    const answer = submitted?.answer || "";
    return {
      player,
      answer,
      correct: answer ? isLocalAnswerCorrect(answer, question) : false,
      submittedAt: submitted?.submittedAt || 0
    };
  });
}

function deviceAnswerEntries(answers, question) {
  return answers.map((submitted) => {
    const player = state.players.find((entry) => sameName(entry.name, submitted.playerName));
    if (!player) return null;
    return {
      player,
      answer: submitted.answer || "",
      correct: submitted.answer ? isLocalAnswerCorrect(submitted.answer, question) : false,
      submittedAt: submitted.submittedAt || 0
    };
  }).filter(Boolean);
}

function questionDifficulty(question) {
  const difficulty = normalize(question?.difficulty || "medium");
  if (difficulty === "easy" || difficulty === "hard") return difficulty;
  return "medium";
}

function difficultyPointMultiplier(question) {
  return { easy: 1, medium: 1.5, hard: 2 }[questionDifficulty(question)];
}

function questionScoringDurationMs(info = currentQuestionInfo()) {
  if (info?.type?.boss) return 180_000;
  if (info?.type?.kind === "emergency") return 10_000;
  return Math.max(10_000, Number(state.emergencyTimerDuration || 60) * 1000);
}

function pointTimestamp(value) {
  if (Number.isFinite(Number(value)) && Number(value) > 0) return Number(value);
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function calculateAnswerPoints(question, submittedAt = Date.now()) {
  const durationMs = Math.max(1_000, Number(state.questionDurationMs) || 60_000);
  const openedAt = Number(state.questionOpenedAt) || pointTimestamp(submittedAt);
  const submittedTime = pointTimestamp(submittedAt);
  const activePauseMs = state.questionPauseStartedAt
    ? Math.max(0, submittedTime - state.questionPauseStartedAt)
    : 0;
  const elapsedMs = Math.max(0, submittedTime - openedAt - state.questionPausedTotalMs - activePauseMs);
  const speedRatio = Math.max(0, Math.min(1, 1 - elapsedMs / durationMs));
  const rawPoints = 100 + Math.round(100 * speedRatio);
  return {
    points: Math.round(rawPoints * difficultyPointMultiplier(question)),
    difficulty: questionDifficulty(question),
    multiplier: difficultyPointMultiplier(question),
    elapsedMs
  };
}

function awardPointsToPlayer(player, question, submittedAt) {
  if (!player) return null;
  const award = calculateAnswerPoints(question, submittedAt);
  player.points = Math.max(0, Math.round(Number(player.points) || 0)) + award.points;
  const durationMs = Math.max(1_000, Number(state.questionDurationMs) || questionScoringDurationMs());
  const fast = award.elapsedMs <= durationMs * 0.25;
  const xpAmount = combatSystem.xpForCorrectAnswer?.({ fast, difficulty: questionDifficulty(question), streak: player.answerStreak }) || 5;
  const encounter = isCombatNode(state.nodes[state.currentNode]) ? currentCombatEncounter() : null;
  if (encounter && !encounter.cleared) {
    bankCombatXp(encounter, player, xpAmount);
    return { player, ...award, total: player.points, xpAmount: 0, bankedXp: xpAmount, leveledUp: false };
  }
  const xpResult = combatSystem.addXp?.(player, xpAmount) || { amount: 0, leveledUp: false };
  return { player, ...award, total: player.points, xpAmount: xpResult.amount, bankedXp: 0, leveledUp: xpResult.leveledUp };
}

function scoringPromptId() {
  return state.playerPromptId || `${state.currentQuestion}-${state.currentNode}`;
}

function logPointAwards(awards, question) {
  if (!awards.length) return;
  logDebugEvent({
    kind: "state",
    label: "Player points awarded",
    detail: `${questionDifficulty(question)} | ${awards.map((award) => `${award.player.name} +${award.points} (${(award.elapsedMs / 1000).toFixed(1)}s, total ${award.total})`).join(" | ")}`
  });
  renderStatus();
}

function awardDeviceAnswerPointsOnce(entries, question) {
  const promptId = scoringPromptId();
  if (state.scoredPromptIds.has(promptId)) return;
  state.scoredPromptIds.add(promptId);
  captureCombatXpBaseline();
  entries.forEach((entry) => combatSystem.recordAnswer?.(entry.player, Boolean(entry.correct)));
  const awards = entries
    .filter((entry) => entry?.correct && entry.player)
    .map((entry) => awardPointsToPlayer(entry.player, question, entry.submittedAt))
    .filter(Boolean);
  logPointAwards(awards, question);
  if (!awards.length) {
    renderStatus();
    publishPlayerVitals();
  }
}

function awardSharedAnswerPointsOnce({ correct, question, type = {}, operator = null, submittedAt = Date.now(), scoringPlayer = null, source = "" }) {
  const promptId = scoringPromptId();
  if (state.scoredPromptIds.has(promptId)) return;
  state.scoredPromptIds.add(promptId);
  captureCombatXpBaseline();
  if (state.actionDrivenMode) return;
  if (state.deviceMode === "multi" && !scoringPlayer) return;
  let recipients = [];
  if (scoringPlayer) recipients = [scoringPlayer];
  else if (type.locked && operator) recipients = [operator];
  else if (type.kind === "emergency" && type.emergencyAnswerPlayer) recipients = [type.emergencyAnswerPlayer];
  else recipients = activePlayers();
  recipients.forEach((player) => combatSystem.recordAnswer?.(player, Boolean(correct)));
  if (!correct) {
    renderStatus();
    publishPlayerVitals();
    return;
  }
  const awards = recipients.map((player) => awardPointsToPlayer(player, question, submittedAt)).filter(Boolean);
  logPointAwards(awards, question);
}

function captureCombatXpBaseline() {
  if (!isCombatNode(state.nodes[state.currentNode]) || state.combatXpBaseline.length) return;
  state.combatXpBaseline = state.players.map((player) => ({
    name: player.name,
    xp: Math.max(0, Number(player.xp) || 0),
    level: Math.max(1, Number(player.level) || 1)
  }));
}

function deviceChallengeSucceeded(entries, type) {
  if (type.kind === "individual" || type.kind === "locked" || type.locked) return entries.every((entry) => entry.correct);
  const correctCount = entries.filter((entry) => entry.correct).length;
  return correctCount >= Math.ceil(entries.length / 2);
}

function setDeviceAnswerResults(entries, question = currentQuestionInfo()?.question) {
  state.answerResults = {};
  const feedback = {};
  for (const entry of entries) {
    if (!entry?.player) continue;
    const name = normalize(entry.player.name);
    const correct = Boolean(entry.correct);
    state.answerResults[name] = correct;
    feedback[name] = {
      correct,
      submitted: entry.answer ? submittedAnswerDisplayText(entry.answer, question) : "No response",
      correctAnswer: answerRevealText(question),
      id: `${state.playerPromptId || "answer"}-${name}`
    };
  }
  state.playerAnswerFeedback = feedback;
  renderStatus();
  publishPlayerVitals();
}

function sameName(a, b) {
  return normalize(a) === normalize(b);
}

function renderPlayerSessionPanel() {
  if (!els.playerSessionPanel) return;
  els.playerSessionPanel.hidden = !state.started || state.deviceMode !== "multi";
  if (!state.started || state.deviceMode !== "multi") return;
  els.playerSessionPanel.classList.toggle("collapsed", state.playerDevicePanelCollapsed);
  if (els.playerDeviceToggleBtn) {
    els.playerDeviceToggleBtn.textContent = state.playerDevicePanelCollapsed ? "Open" : "Collapse";
    els.playerDeviceToggleBtn.setAttribute("aria-expanded", String(!state.playerDevicePanelCollapsed));
  }
  const joinUrl = playerJoinUrlForRoom();
  els.playerRoomCode.textContent = state.roomCode || "----";
  els.playerJoinLink.href = joinUrl;
  els.playerJoinHelp.textContent = state.playerJoinUrlReady
    ? `Players can open ${joinUrl} and enter room code ${state.roomCode || "----"}.`
    : "Building phone join link...";
  renderSimulatorPanel();
  const answers = [...state.playerAnswers].sort((a, b) => a.submittedAt - b.submittedAt);
  const participants = state.playerParticipants.length
    ? `
      <p>${state.playerParticipants.length} device${state.playerParticipants.length === 1 ? "" : "s"} joined.</p>
      <div class="player-device-list">
        ${state.playerParticipants.map((player) => {
          const submitted = participantHasCurrentSubmission(player);
          return `
          <div class="player-device-row">
            <strong>${escapeHtml(player.name)}</strong>
            <span class="device-submit-state ${submitted ? "submitted" : "pending"}">${submitted ? "Submitted" : "Pending"}</span>
            <button class="secondary removePlayerBtn" type="button" data-player-id="${escapeAttribute(player.id)}" data-player-name="${escapeAttribute(player.name)}">Remove</button>
          </div>
        `;
        }).join("")}
      </div>
    `
    : "<p>No player devices joined yet.</p>";
  const canUseAnswer = canUseIndividualPlayerAnswer();
  const answerRows = answers.length
    ? answers.map((answer) => `
      <div class="player-answer-row">
        <div>
          <strong class="player-colored-name" style="--player-color:${playerColor(answer.playerName, participantColorIndex(answer.playerName))}">${escapeHtml(answer.playerName || "Unknown")}</strong>
          <span>Answer submitted</span>
        </div>
        <button class="secondary usePlayerAnswerBtn" type="button" data-answer="${escapeAttribute(answer.answer)}" ${canUseAnswer ? "" : "disabled"}>Use</button>
      </div>
    `).join("")
    : "<p class=\"muted-small\">Waiting for player answers.</p>";
  els.playerAnswerBoard.innerHTML = `${participants}<div class="player-answer-list">${answerRows}</div>`;
  document.querySelectorAll(".usePlayerAnswerBtn").forEach((button) => {
    button.addEventListener("click", () => submitDeviceAnswer(button.dataset.answer || "", { source: "teacher-use-player-answer" }));
  });
  bindRemovePlayerButtons();
}

function participantHasCurrentSubmission(participant) {
  if (!participant) return false;
  const id = String(participant.id || "");
  const name = normalize(participant.name);
  const promptId = state.playerPromptId || "";
  const submissions = state.actionDrivenMode ? state.playerActions : state.playerAnswers;
  return submissions.some((entry) => {
    if (promptId && entry.promptId !== promptId) return false;
    const idMatches = Boolean(id && String(entry.playerId || "") === id);
    const nameMatches = Boolean(name && normalize(entry.playerName) === name);
    return idMatches || nameMatches;
  });
}

function pulsePlayerSubmissionCards(playerNames = []) {
  if (!playerNames.length || !els.statusGrid) return;
  const submittedNames = new Set(playerNames.map(normalize));
  els.statusGrid.querySelectorAll(".status-card").forEach((card) => {
    if (!submittedNames.has(normalize(card.dataset.playerName))) return;
    card.classList.remove("status-card-submitted-new");
    void card.offsetWidth;
    card.classList.add("status-card-submitted-new");
    window.setTimeout(() => card.classList.remove("status-card-submitted-new"), 1500);
  });
}

function syncRosterSubmissionState() {
  if (!els.statusGrid) return;
  els.statusGrid.querySelectorAll(".status-card[data-player-name]").forEach((card) => {
    const playerName = card.dataset.playerName || "";
    const submitted = state.started
      && state.deviceMode === "multi"
      && state.questionPresentationReady
      && !state.answerPending
      && !state.resolved
      && participantHasCurrentSubmission({ name: playerName });
    card.classList.toggle("status-card-submitted", submitted);
    const badgeHost = card.querySelector(".roster-card-badges");
    if (!badgeHost) return;
    const existing = badgeHost.querySelector(".answer-submit-badge");
    if (submitted && !existing) {
      const badge = document.createElement("span");
      badge.className = "answer-submit-badge";
      badge.title = "Submitted";
      badge.setAttribute("aria-label", "Submitted");
      badge.textContent = "Submitted";
      badgeHost.appendChild(badge);
    } else if (!submitted && existing) {
      existing.remove();
    }
  });
}

function cancelSimulatorAutoAnswerTimers() {
  state.simulatorAutoAnswerTimers.forEach((timerId) => window.clearTimeout(timerId));
  state.simulatorAutoAnswerTimers = [];
  state.simulatorAutoAnswerPromptId = "";
}

function cancelSimulatorAwareAbilityTimers() {
  state.simulatorAwareAbilityTimers.forEach((timerId) => window.clearTimeout(timerId));
  state.simulatorAwareAbilityTimers = [];
  state.simulatorAwareAbilityPromptId = "";
}

function simulatorAccuracyControlHtml() {
  return `
    <section class="sim-accuracy-control" aria-labelledby="simAccuracyLabel">
      <div>
        <strong id="simAccuracyLabel">Bot Auto-Answer Accuracy</strong>
        <output id="simAccuracyValue" for="simAccuracySlider">${state.simulatorAutoAnswerAccuracy}%</output>
      </div>
      <input id="simAccuracySlider" type="range" min="0" max="100" step="5" value="${state.simulatorAutoAnswerAccuracy}" aria-label="Bot auto-answer accuracy">
      <p>Each simulated player independently uses this chance of answering correctly.</p>
    </section>
  `;
}

function bindSimulatorAccuracyControl() {
  const slider = document.getElementById("simAccuracySlider");
  const value = document.getElementById("simAccuracyValue");
  if (!slider) return;
  slider.addEventListener("input", () => {
    state.simulatorAutoAnswerAccuracy = Math.max(0, Math.min(100, Number(slider.value) || 0));
    if (value) value.textContent = `${state.simulatorAutoAnswerAccuracy}%`;
    window.localStorage.setItem("studyAdventureSimulatorAutoAnswerAccuracy", String(state.simulatorAutoAnswerAccuracy));
  });
}

function repairCurrentPromptPublication(promptId) {
  if (!promptId || promptId !== state.playerPromptId || state.resolved || state.answerPending || state.resolutionDelayPending) return Promise.resolve(null);
  if (state.simulatorPromptRepairPromise) return state.simulatorPromptRepairPromise;
  const prompt = buildPlayerPrompt();
  if (!prompt || prompt.id !== promptId) return Promise.resolve(null);
  state.simulatorPromptRepairPromise = Promise.resolve(publishPlayerSession({
    status: "open",
    prompt,
    resetAnswers: false
  })).then((result) => {
    if (result?.session?.status === "open" && result?.session?.prompt?.id === promptId) {
      clearPromptPublicationRetry(promptId);
    }
    return result;
  }).finally(() => {
    state.simulatorPromptRepairPromise = null;
  });
  return state.simulatorPromptRepairPromise;
}

const generalActionBank = sharedData.generalActionBank || {};

function statusUpdateScrollInner(feed = els.statusUpdateFeed) {
  if (!feed) return null;
  let inner = feed.querySelector(".status-update-scroll-inner");
  if (!inner) {
    inner = document.createElement("div");
    inner.className = "status-update-scroll-inner";
    while (feed.firstChild) inner.appendChild(feed.firstChild);
    feed.appendChild(inner);
  }
  return inner;
}

function missionLogScrollInner(transcript = document.getElementById("chatTranscript")) {
  if (!transcript) return null;
  cleanupMissionLogShell(transcript);
  let inner = transcript.querySelector(".chat-transcript-scroll-inner");
  if (!inner) {
    inner = document.createElement("div");
    inner.className = "chat-transcript-scroll-inner";
    while (transcript.firstChild) inner.appendChild(transcript.firstChild);
    transcript.appendChild(inner);
  }
  return inner;
}

function cleanupMissionLogShell(transcript = document.getElementById("chatTranscript")) {
  const card = transcript?.closest?.("#encounterCard");
  if (!card) return;
  card.querySelectorAll(":scope > .encounter-tag").forEach((tag) => {
    if (normalize(tag.textContent) === "mission log") tag.remove();
  });
}

function resetMissionLogScroll(transcript = document.getElementById("chatTranscript")) {
  if (!transcript) return null;
  cleanupMissionLogShell(transcript);
  stopAutoScroll(transcript);
  transcript.innerHTML = "";
  const inner = document.createElement("div");
  inner.className = "chat-transcript-scroll-inner";
  transcript.appendChild(inner);
  transcript.scrollTop = 0;
  return inner;
}

function appendMissionLogEntry(entry, { replace = false } = {}) {
  const transcript = document.getElementById("chatTranscript");
  if (!transcript) return null;
  const inner = replace ? resetMissionLogScroll(transcript) : missionLogScrollInner(transcript);
  if (!inner) return null;
  stopAutoScroll(transcript);
  if (!entry.classList.contains("transmission-waiting")) {
    removeTransmissionWaitingEntries(inner);
  }
  inner.appendChild(entry);
  transcript.scrollTop = 0;
  return transcript;
}

function removeTransmissionWaitingEntries(root = document) {
  root.querySelectorAll?.(".transmission-waiting").forEach((entry) => {
    entry.classList.add("fading");
    window.setTimeout(() => entry.remove(), 180);
  });
}

function startMissionLogAutoScroll(options = {}) {
  // Mission log scrolling is intentionally manual. Status update boxes still use
  // startAutoScrollIfOverflow directly.
}

function simulatedAnswerParticipants(info) {
  const activeNames = new Set(activePlayers().map((player) => normalize(player.name)));
  const connected = simulatedParticipants().filter((participant) => activeNames.has(normalize(participant.name)));
  if (info.type.kind === "emergency") return connected.slice(0, 1);
  return connected;
}

function simulatedParticipants() {
  return state.playerParticipants.filter((participant) => {
    if (participant.simulated) return true;
    const name = String(participant.name || "");
    return simulatorNamePool.some((simName) => sameName(simName, name)) || /^sim\s*\d+$/i.test(name);
  });
}

function simulatedAnswerFor(question, correct) {
  if (correct) return question.mode === "fill" ? question.answerText : question.answerKey;
  if (question.mode === "fill") return "incorrect test answer";
  const wrongChoice = question.choices.find((choice) => choice.key !== question.answerKey);
  return wrongChoice?.key || "Z";
}

function bindRemovePlayerButtons() {
  document.querySelectorAll(".removePlayerBtn").forEach((button) => {
    button.addEventListener("click", () => removePlayerFromSession({
      id: button.dataset.playerId || "",
      name: button.dataset.playerName || ""
    }));
  });
}

function removePlayerFromSession(player) {
  if (!state.roomCode || (!player.id && !player.name)) return;
  document.querySelectorAll(".removePlayerBtn").forEach((button) => {
    if (button.dataset.playerId === player.id || button.dataset.playerName === player.name) button.disabled = true;
  });

  fetchWithTimeout("/api/player-remove", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      roomCode: state.roomCode,
      playerId: player.id,
      name: player.name
    })
  })
    .then((response) => response.json().then((payload) => ({ ok: response.ok, payload })))
    .then(({ ok, payload }) => {
      if (!ok || !payload.ok) throw new Error(payload.error || "Could not remove player.");
      applyRemovedPlayer(player, payload.session);
    })
    .catch(() => {
      renderJoinLobby();
      renderPlayerSessionPanel();
    });
}

function applyRemovedPlayer(player, session) {
  const removedName = normalize(player.name);
  if (player.id) state.playerPromptRequiredIds = state.playerPromptRequiredIds.filter((id) => String(id) !== String(player.id));
  if (removedName) state.playerPromptRequiredNames = state.playerPromptRequiredNames.filter((name) => normalize(name) !== removedName);
  state.playerParticipants = session?.participants || state.playerParticipants.filter((participant) => {
    if (player.id && participant.id === player.id) return false;
    return normalize(participant.name) !== removedName;
  });
  state.playerAnswers = state.playerAnswers.filter((answer) => {
    if (player.id && answer.playerId === player.id) return false;
    return normalize(answer.playerName) !== removedName;
  });
  if (state.started && removedName) {
    state.players = state.players.filter((entry) => normalize(entry.name) !== removedName);
    publishPlayerSession({ players: state.players.map((entry) => entry.name), resetAnswers: false });
    renderStatus();
    renderMap();
    updateActiveLocalQuestionDisplay();
    const info = currentQuestionInfo();
    if (state.questionPresentationReady && info?.type?.locked && sameName(info.operator?.name, player.name)) {
      queueFinalSubmissionResolution(() => submitDeviceAnswer(TIMEOUT_ANSWER), "locked operator removed");
    } else {
      maybeAutoResolveEmergencyAnswer();
    }
  }
  renderJoinLobby();
  renderPlayerSessionPanel();
}

function renderPlayerJoinQr(joinUrl) {
  if (!els.playerQrCode) return;
  try {
    els.playerQrCode.innerHTML = qrSvg(joinUrl);
  } catch {
    els.playerQrCode.innerHTML = `<p class="muted-small">${escapeHtml(joinUrl)}</p>`;
  }
}

function submitDeviceAnswer(answer, options = {}) {
  if (!answer || !state.questionPresentationReady || state.answerPending || state.resolutionDelayPending || state.resolved) return false;
  if (state.chatMode) submitPlayerAnswerValue(answer, { source: options.source || "device-auto" });
  else {
    publishPlayerWaiting("resolving");
    resolveChallenge(answer);
  }
  return true;
}

function makeRoomCode() {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 4; i++) code += letters[Math.floor(Math.random() * letters.length)];
  return code;
}

function qrSvg(text) {
  const matrix = makeQrMatrix(text);
  const quiet = 4;
  const scale = 6;
  const size = matrix.length + quiet * 2;
  const rects = [];
  matrix.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (dark) rects.push(`<rect x="${x + quiet}" y="${y + quiet}" width="1" height="1"></rect>`);
    });
  });
  return `
    <svg viewBox="0 0 ${size} ${size}" width="${size * scale}" height="${size * scale}" role="img" aria-label="QR code for player join link">
      <rect width="${size}" height="${size}" fill="#f5f7f2"></rect>
      <g fill="#071012">${rects.join("")}</g>
    </svg>
  `;
}

function makeQrMatrix(text) {
  const version = 4;
  const size = 17 + version * 4;
  const dataCodewords = 80;
  const eccCodewords = 20;
  const bytes = new TextEncoder().encode(text);
  if (bytes.length > 78) throw new Error("QR data too long");

  const bits = [];
  appendBits(bits, 0b0100, 4);
  appendBits(bits, bytes.length, 8);
  bytes.forEach((byte) => appendBits(bits, byte, 8));
  appendBits(bits, 0, Math.min(4, dataCodewords * 8 - bits.length));
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bitsToByte(bits.slice(i, i + 8)));
  for (let pad = 0; data.length < dataCodewords; pad++) data.push(pad % 2 ? 0x11 : 0xec);

  const codewords = [...data, ...reedSolomonRemainder(data, eccCodewords)];
  const modules = Array.from({ length: size }, () => Array(size).fill(false));
  const reserved = Array.from({ length: size }, () => Array(size).fill(false));
  const setFunction = (x, y, dark) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    modules[y][x] = dark;
    reserved[y][x] = true;
  };

  drawFinder(modules, reserved, 0, 0);
  drawFinder(modules, reserved, size - 7, 0);
  drawFinder(modules, reserved, 0, size - 7);
  drawAlignment(modules, reserved, 26, 26);
  for (let i = 8; i < size - 8; i++) {
    setFunction(i, 6, i % 2 === 0);
    setFunction(6, i, i % 2 === 0);
  }
  setFunction(8, size - 8, true);
  reserveFormat(reserved, size);

  const dataBits = codewords.flatMap((codeword) => Array.from({ length: 8 }, (_, bit) => ((codeword >>> (7 - bit)) & 1) === 1));
  let bitIndex = 0;
  let upward = true;
  for (let x = size - 1; x >= 1; x -= 2) {
    if (x === 6) x--;
    for (let yOffset = 0; yOffset < size; yOffset++) {
      const y = upward ? size - 1 - yOffset : yOffset;
      for (let dx = 0; dx < 2; dx++) {
        const xx = x - dx;
        if (reserved[y][xx]) continue;
        const bit = bitIndex < dataBits.length ? dataBits[bitIndex++] : false;
        modules[y][xx] = bit !== qrMask(0, xx, y);
      }
    }
    upward = !upward;
  }
  drawFormat(modules, reserved, size, 0);
  return modules;
}

function appendBits(bits, value, length) {
  for (let i = length - 1; i >= 0; i--) bits.push(((value >>> i) & 1) === 1);
}

function bitsToByte(bits) {
  return bits.reduce((value, bit) => (value << 1) | (bit ? 1 : 0), 0);
}

function drawFinder(modules, reserved, x, y) {
  for (let yy = -1; yy <= 7; yy++) {
    for (let xx = -1; xx <= 7; xx++) {
      const px = x + xx;
      const py = y + yy;
      if (px < 0 || py < 0 || py >= modules.length || px >= modules.length) continue;
      const dark = xx >= 0 && xx <= 6 && yy >= 0 && yy <= 6 && (xx === 0 || xx === 6 || yy === 0 || yy === 6 || (xx >= 2 && xx <= 4 && yy >= 2 && yy <= 4));
      modules[py][px] = dark;
      reserved[py][px] = true;
    }
  }
}

function drawAlignment(modules, reserved, cx, cy) {
  for (let y = -2; y <= 2; y++) {
    for (let x = -2; x <= 2; x++) {
      const dark = Math.max(Math.abs(x), Math.abs(y)) !== 1;
      modules[cy + y][cx + x] = dark;
      reserved[cy + y][cx + x] = true;
    }
  }
}

function reserveFormat(reserved, size) {
  for (let i = 0; i < 9; i++) {
    reserved[8][i] = true;
    reserved[i][8] = true;
  }
  for (let i = 0; i < 8; i++) {
    reserved[8][size - 1 - i] = true;
    reserved[size - 1 - i][8] = true;
  }
}

function drawFormat(modules, reserved, size, mask) {
  const bits = formatBits(mask);
  const set = (x, y, index) => {
    modules[y][x] = ((bits >>> index) & 1) === 1;
    reserved[y][x] = true;
  };
  for (let i = 0; i <= 5; i++) set(8, i, i);
  set(8, 7, 6);
  set(8, 8, 7);
  set(7, 8, 8);
  for (let i = 9; i < 15; i++) set(14 - i, 8, i);
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, i);
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, i);
}

function formatBits(mask) {
  let data = (1 << 3) | mask;
  let bits = data << 10;
  const generator = 0x537;
  for (let i = 14; i >= 10; i--) {
    if (((bits >>> i) & 1) !== 0) bits ^= generator << (i - 10);
  }
  return (((data << 10) | bits) ^ 0x5412) & 0x7fff;
}

function qrMask(mask, x, y) {
  if (mask === 0) return (x + y) % 2 === 0;
  return false;
}

function reedSolomonRemainder(data, degree) {
  const generator = reedSolomonGenerator(degree);
  const result = Array(degree).fill(0);
  for (const byte of data) {
    const factor = byte ^ result.shift();
    result.push(0);
    generator.forEach((coefficient, index) => {
      result[index] ^= gfMultiply(coefficient, factor);
    });
  }
  return result;
}

function reedSolomonGenerator(degree) {
  let result = [1];
  for (let i = 0; i < degree; i++) {
    const next = Array(result.length + 1).fill(0);
    result.forEach((coefficient, index) => {
      next[index] ^= gfMultiply(coefficient, 1);
      next[index + 1] ^= gfMultiply(coefficient, gfPow(2, i));
    });
    result = next;
  }
  return result.slice(1);
}

function gfPow(value, power) {
  let result = 1;
  for (let i = 0; i < power; i++) result = gfMultiply(result, value);
  return result;
}

function gfMultiply(a, b) {
  let result = 0;
  for (let i = 0; i < 8; i++) {
    if (b & 1) result ^= a;
    const high = a & 0x80;
    a = (a << 1) & 0xff;
    if (high) a ^= 0x1d;
    b >>>= 1;
  }
  return result;
}

function checkDmFeed() {
  if (!state.chatMode || !state.started) return;
  if (document.hidden) return;
  if (state.currentQuestion === 0 && !state.teamReady) return;
  fetchFeed()
    .then((response) => response.ok ? response.json() : null)
    .then((feed) => {
      if (!feed || !feed.id || feed.id === state.feedLastId) return;
      if (!feed.text && !feed.story && !feed.question) return;
      if (appendTranscript(feed)) state.feedLastId = feed.id;
    })
    .catch(() => {});
}

function fetchFeed() {
  return fetchWithTimeout(`/api/feed?ts=${Date.now()}`, { cache: "no-store" })
    .then((response) => response.ok ? response : fetchWithTimeout(`dm-feed.json?ts=${Date.now()}`, { cache: "no-store" }))
    .catch(() => fetchWithTimeout(`dm-feed.json?ts=${Date.now()}`, { cache: "no-store" }));
}

function syncSetupMode() {
  const localDmMode = els.dmEngine.value === "local";
  const actionDrivenMode = Boolean(els.actionDrivenMode?.checked);
  const pastedQuestions = els.questionSource.value === "paste";
  const savedQuestions = els.questionSource.value === "saved";
  const deviceMode = selectedDeviceMode();
  syncDeviceModeClass(deviceMode);
  if (deviceMode === "single" && state.joinLobbyActive) closeJoinLobby();
  els.questionBankGroup.hidden = actionDrivenMode || !pastedQuestions;
  els.savedQuestionSetsPanel.hidden = actionDrivenMode || els.questionSource.value === "demo";
  els.questionTips.hidden = actionDrivenMode || !pastedQuestions;
  els.saveQuestionSetBtn.disabled = actionDrivenMode || !pastedQuestions;
  els.questionSetNameInput.disabled = actionDrivenMode || !pastedQuestions;
  if (els.localDmProviderGroup) els.localDmProviderGroup.hidden = !localDmMode;
  els.ollamaModelGroup.hidden = !localDmMode;
  els.advancedSettings.hidden = false;
  if (els.fastModeEnabled) els.fastModeEnabled.checked = state.fastMode;
  els.emergencyTimerDurationGroup.hidden = !els.emergencyTimerEnabled.checked;
  els.playersInput.placeholder = deviceMode === "single"
    ? "Chris\nDavis\nMorgan\nLee\nTaylor\nJordan"
    : "Optional notes. Players will scan the QR code in the join lobby.";
  renderSingleDeviceClassAssignments();
  els.startBtn.textContent = localDmMode ? "Start Local Mission" : els.dmEngine.value === "manual" ? "Start Live Mission" : "Start Mission";
  if (!state.joinLobbyActive) els.startBtn.disabled = false;
  if (savedQuestions) renderSavedQuestionSets();
  updateSetupSummary();
}

function selectedLocalDmProvider() {
  const provider = els.localDmProvider?.value || state.localDmProvider || "lmstudio";
  return provider === "ollama" ? "ollama" : "lmstudio";
}

function defaultLocalDmModel(provider = selectedLocalDmProvider()) {
  return provider === "ollama" ? "qwen3.5:9b" : "google/gemma-4-e4b";
}

function localDmModelStorageKey(provider = selectedLocalDmProvider()) {
  return provider === "ollama" ? "studyAdventureOllamaModel" : "studyAdventureLmStudioModel";
}

function localDmTagsEndpoint(provider = selectedLocalDmProvider()) {
  return provider === "ollama" ? "/api/ollama/tags" : "/api/lmstudio/tags";
}

function localDmLoadEndpoint(provider = selectedLocalDmProvider()) {
  return provider === "lmstudio" ? "/api/lmstudio/load" : "";
}

function localDmGenerateEndpoint(provider = selectedLocalDmProvider()) {
  return provider === "ollama" ? "/api/ollama/generate" : "/api/lmstudio/generate";
}

function localDmProviderLabel(provider = selectedLocalDmProvider()) {
  return provider === "ollama" ? "Ollama" : "LM Studio";
}

function extractLocalDmModelNames(body, provider = selectedLocalDmProvider()) {
  if (provider === "ollama") return (body.models || []).map((model) => model.name).filter(Boolean);
  return extractLocalDmModelEntries(body, provider).map((model) => model.name).filter(Boolean);
}

function extractLocalDmModelEntries(body, provider = selectedLocalDmProvider()) {
  const source = provider === "ollama"
    ? (Array.isArray(body.models) ? body.models : [])
    : (Array.isArray(body.models) ? body.models : Array.isArray(body.data) ? body.data : []);
  return source
    .map((model) => ({
      ...model,
      name: model.name || model.id || model.model || "",
      loaded: provider === "lmstudio" && normalize(model.state) === "loaded"
    }))
    .filter((model) => model.name);
}

function preferredLocalDmModel(models, savedModel, provider = selectedLocalDmProvider(), entries = []) {
  const defaultModel = defaultLocalDmModel(provider);
  if (provider === "lmstudio") {
    const loaded = entries.find((model) => model.loaded && !/embed|embedding/i.test(model.name));
    if (loaded) return loaded.name;
    const nonEmbedding = models.find((model) => !/embed|embedding/i.test(model));
    if (nonEmbedding) return nonEmbedding;
  }
  if (savedModel && models.includes(savedModel)) return savedModel;
  if (models.includes(defaultModel)) return defaultModel;
  return models[0] || defaultModel;
}

function populateLocalDmModels(options = {}) {
  const provider = selectedLocalDmProvider();
  state.localDmProvider = provider;
  if (els.localDmProvider) els.localDmProvider.value = provider;
  const currentSelection = els.ollamaModel?.value || state.ollamaModel || "";
  const savedModel = window.localStorage.getItem(localDmModelStorageKey(provider));
  if (els.ollamaModelStatus) els.ollamaModelStatus.textContent = `Checking ${localDmProviderLabel(provider)} models...`;
  return fetchWithTimeout(localDmTagsEndpoint(provider), { cache: "no-store" })
    .then((response) => response.json().then((body) => ({ response, body })))
    .then(({ response, body }) => {
      if (!response.ok) throw new Error(body.error || `${localDmProviderLabel(provider)} is unavailable`);
      const entries = extractLocalDmModelEntries(body, provider);
      const sortedEntries = provider === "lmstudio"
        ? entries.slice().sort((a, b) => Number(b.loaded) - Number(a.loaded))
        : entries;
      const models = sortedEntries.map((model) => model.name);
      if (!models.length) throw new Error(`No ${localDmProviderLabel(provider)} models are loaded`);
      state.localDmModelEntries = sortedEntries;
      const selected = options.preserveSelection && currentSelection && models.includes(currentSelection)
        ? currentSelection
        : preferredLocalDmModel(models, savedModel, provider, sortedEntries);
      els.ollamaModel.innerHTML = models
        .map((model) => {
          const entry = sortedEntries.find((item) => item.name === model);
          const label = entry?.loaded ? `${model} (loaded)` : model;
          return `<option value="${escapeAttribute(model)}" data-loaded="${entry?.loaded ? "true" : "false"}">${escapeHtml(label)}</option>`;
        })
        .join("");
      els.ollamaModel.value = selected;
      state.ollamaModel = selected;
      window.localStorage.setItem(localDmModelStorageKey(provider), selected);
      const loadedCount = provider === "lmstudio" ? sortedEntries.filter((model) => model.loaded).length : models.length;
      els.ollamaModelStatus.textContent = provider === "lmstudio"
        ? `${localDmProviderLabel(provider)} linked: ${models.length} available, ${loadedCount} loaded.`
        : `${localDmProviderLabel(provider)} linked: ${models.length} model${models.length === 1 ? "" : "s"} available.`;
    })
    .catch(() => {
      if (savedModel) ensureOllamaModelOption(savedModel);
      state.localDmModelEntries = [];
      state.ollamaModel = els.ollamaModel.value || savedModel || defaultLocalDmModel(provider);
      els.ollamaModelStatus.textContent = `${localDmProviderLabel(provider)} is offline. Recheck after the local server is running.`;
    });
}

function refreshLocalDmModelsForDropdown() {
  if (state.localDmModelRefreshPending) return;
  state.localDmModelRefreshPending = true;
  populateLocalDmModels({ preserveSelection: true })
    .finally(() => {
      state.localDmModelRefreshPending = false;
    });
}

function selectedLocalDmModelEntry(model = els.ollamaModel?.value, provider = selectedLocalDmProvider()) {
  return state.localDmModelEntries.find((entry) => entry.name === model)
    || [...(els.ollamaModel?.options || [])].find((option) => option.value === model)?.dataset
    || null;
}

function handleLocalDmModelSelection() {
  const provider = selectedLocalDmProvider();
  const model = els.ollamaModel.value;
  state.ollamaModel = model;
  window.localStorage.setItem(localDmModelStorageKey(provider), model);
  if (provider !== "lmstudio") return;

  const entry = selectedLocalDmModelEntry(model, provider);
  const isLoaded = entry?.loaded === true || entry?.loaded === "true";
  if (isLoaded) {
    if (els.ollamaModelStatus) els.ollamaModelStatus.textContent = `${localDmProviderLabel(provider)} active: ${model} is loaded.`;
    return;
  }

  const shouldLoad = window.confirm(`${model} is available in LM Studio, but it does not appear to be loaded.\n\nLoad it now before using it as the Local DM model?`);
  if (!shouldLoad) {
    fallbackToLoadedLmStudioModel("Selection cancelled.");
    return;
  }

  loadSelectedLmStudioModel(model);
}

function fallbackToLoadedLmStudioModel(prefix = "Using loaded model.") {
  const provider = "lmstudio";
  const loadedEntry = state.localDmModelEntries.find((item) => item.loaded && !/embed|embedding/i.test(item.name));
  const fallback = loadedEntry?.name || state.localDmModelEntries.find((item) => !/embed|embedding/i.test(item.name))?.name || defaultLocalDmModel(provider);
  ensureOllamaModelOption(fallback);
  els.ollamaModel.value = fallback;
  state.ollamaModel = fallback;
  window.localStorage.setItem(localDmModelStorageKey(provider), fallback);
  if (els.ollamaModelStatus) els.ollamaModelStatus.textContent = `${prefix} Using ${fallback}.`;
  return fallback;
}

function loadSelectedLmStudioModel(model) {
  if (!model) return;
  const endpoint = localDmLoadEndpoint("lmstudio");
  if (!endpoint) return;
  els.ollamaModel.disabled = true;
  if (els.ollamaModelStatus) els.ollamaModelStatus.textContent = `Loading ${model} in LM Studio...`;
  fetchWithTimeout(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model })
  }, 90_000)
    .then((response) => response.json().then((body) => ({ response, body })))
    .then(({ response, body }) => {
      if (!response.ok || !body.ok) throw new Error(body.error || `LM Studio returned ${response.status}`);
      state.ollamaModel = model;
      window.localStorage.setItem(localDmModelStorageKey("lmstudio"), model);
      if (els.ollamaModelStatus) {
        const seconds = Number(body.loadTimeSeconds);
        els.ollamaModelStatus.textContent = Number.isFinite(seconds)
          ? `Loaded ${model} in ${seconds.toFixed(1)}s.`
          : `Loaded ${model}.`;
      }
      logDebugEvent({
        kind: "response",
        label: "LM Studio model loaded",
        detail: JSON.stringify(body.result || body, null, 2)
      });
      return populateLocalDmModels({ preserveSelection: true });
    })
    .catch((error) => {
      fallbackToLoadedLmStudioModel(`Could not load ${model}.`);
      logDebugEvent({
        kind: "error",
        label: "LM Studio model load failed",
        detail: `${model}: ${error.message || error}`
      });
    })
    .finally(() => {
      els.ollamaModel.disabled = false;
    });
}

function populateOllamaModels() {
  return populateLocalDmModels();
}

function checkMissionSystems() {
  if (!els.systemCheckList) return Promise.resolve();
  setSystemCheckRows([
    { label: "Game Server", state: "checking", detail: "Checking" },
    { label: "Local Narrator", state: "checking", detail: "Checking" },
    { label: "Voice System", state: "checking", detail: "Checking" }
  ]);
  if (els.setupSystemsStatus) els.setupSystemsStatus.textContent = "Checking";
  if (els.recheckSystemsBtn) els.recheckSystemsBtn.disabled = true;

  const checks = [
    fetchWithTimeout("/api/health", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`)))
      .then(() => ({ label: "Game Server", state: "ok", detail: "Linked" }))
      .catch(() => ({ label: "Game Server", state: "bad", detail: "Offline" })),
    fetchWithTimeout(localDmTagsEndpoint(), { cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`)))
      .then((body) => {
        const provider = selectedLocalDmProvider();
        const count = extractLocalDmModelNames(body, provider).length;
        return { label: "Local Narrator", state: count ? "ok" : "warn", detail: count ? `${count} model${count === 1 ? "" : "s"}` : "No models" };
      })
      .catch(() => ({ label: "Local Narrator", state: "bad", detail: `${localDmProviderLabel()} offline` })),
    (() => {
      const provider = els.setupTtsProvider?.value || state.ttsProvider || "browser";
      if (provider === "browser") {
        const available = Boolean(window.speechSynthesis);
        return Promise.resolve({ label: "Voice System", state: available ? "ok" : "warn", detail: available ? "Browser voice ready" : "Browser voice unavailable" });
      }
      return fetchWithTimeout(`/api/tts/status?provider=${encodeURIComponent(provider)}`, { cache: "no-store" })
        .then((response) => response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`)))
        .then((body) => ({ label: "Voice System", state: body.available ? "ok" : "warn", detail: body.available ? `${provider === "kokoro" ? "Kokoro" : "Piper"} ready` : `${provider === "kokoro" ? "Kokoro" : "Piper"} unavailable` }))
        .catch(() => ({ label: "Voice System", state: "warn", detail: `${provider === "kokoro" ? "Kokoro" : "Piper"} unavailable` }));
    })()
  ];

  return Promise.all(checks).then((results) => {
    setSystemCheckRows(results);
    const server = results.find((entry) => entry.label === "Game Server");
    const narrator = results.find((entry) => entry.label === "Local Narrator");
    if (els.setupSystemsStatus) {
      els.setupSystemsStatus.textContent = server?.state !== "ok"
        ? "Server Offline"
        : narrator?.state === "ok"
        ? "Narrator Linked"
        : `${localDmProviderLabel()} Offline`;
    }
  }).finally(() => {
    if (els.recheckSystemsBtn) els.recheckSystemsBtn.disabled = false;
  });
}

function setSystemCheckRows(rows) {
  if (!els.systemCheckList) return;
  els.systemCheckList.innerHTML = rows.map((row) => `
    <div class="system-check-row ${escapeAttribute(row.state)}">
      <span>${escapeHtml(row.label)}</span>
      <strong>${escapeHtml(row.detail)}</strong>
    </div>
  `).join("");
}

function ensureOllamaModelOption(model) {
  if (!model || [...els.ollamaModel.options].some((option) => option.value === model)) return;
  const option = document.createElement("option");
  option.value = model;
  option.textContent = model;
  els.ollamaModel.prepend(option);
  els.ollamaModel.value = model;
}

function readLocalSavedQuestionSets() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(QUESTION_SET_STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter((set) => set && set.id && set.name) : [];
  } catch {
    return [];
  }
}

function readSavedQuestionSets() {
  if (!state.questionSetsServerReady && !state.savedQuestionSetsCache.length) {
    state.savedQuestionSetsCache = readLocalSavedQuestionSets();
  }
  return state.savedQuestionSetsCache;
}

function writeSavedQuestionSets(sets) {
  state.savedQuestionSetsCache = Array.isArray(sets) ? sets.filter((set) => set && set.id && set.name) : [];
  window.localStorage.setItem(QUESTION_SET_STORAGE_KEY, JSON.stringify(state.savedQuestionSetsCache));
  persistQuestionSetsToServer();
}

function readLocalSelectedQuestionSetIds() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SELECTED_QUESTION_SETS_KEY) || "[]");
    return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
  } catch {
    return new Set();
  }
}

function selectedQuestionSetIds() {
  if (!state.questionSetsServerReady && !state.selectedQuestionSetIdsCache.length) {
    state.selectedQuestionSetIdsCache = [...readLocalSelectedQuestionSetIds()];
  }
  return new Set(state.selectedQuestionSetIdsCache);
}

function writeSelectedQuestionSetIds(ids) {
  state.selectedQuestionSetIdsCache = [...ids].map(String);
  window.localStorage.setItem(SELECTED_QUESTION_SETS_KEY, JSON.stringify(state.selectedQuestionSetIdsCache));
  persistQuestionSetsToServer();
}

function mergeQuestionSets(primary = [], secondary = []) {
  const byKey = new Map();
  for (const set of [...secondary, ...primary]) {
    if (!set?.id || !set?.name) continue;
    const key = set.id || normalize(set.name);
    byKey.set(key, set);
  }
  return [...byKey.values()];
}

function loadSavedQuestionSetsFromServer() {
  state.savedQuestionSetsCache = readLocalSavedQuestionSets();
  state.selectedQuestionSetIdsCache = [...readLocalSelectedQuestionSetIds()];
  return fetchWithTimeout("/api/question-sets", { cache: "no-store" })
    .then((response) => response.ok ? response.json() : null)
    .then((payload) => {
      if (!payload?.ok) return;
      const serverSets = Array.isArray(payload.sets) ? payload.sets.filter((set) => set && set.id && set.name) : [];
      const serverSelected = Array.isArray(payload.selectedIds) ? payload.selectedIds.map(String) : [];
      const localSets = readLocalSavedQuestionSets();
      const localSelected = [...readLocalSelectedQuestionSetIds()];
      if (serverSets.length) {
        const mergedSets = mergeQuestionSets(serverSets, localSets);
        const mergedSelected = [...new Set([...serverSelected, ...localSelected])]
          .filter((id) => mergedSets.some((set) => set.id === id));
        state.savedQuestionSetsCache = mergedSets;
        state.selectedQuestionSetIdsCache = mergedSelected;
        window.localStorage.setItem(QUESTION_SET_STORAGE_KEY, JSON.stringify(mergedSets));
        window.localStorage.setItem(SELECTED_QUESTION_SETS_KEY, JSON.stringify(mergedSelected));
        if (mergedSets.length !== serverSets.length || mergedSelected.length !== serverSelected.length) persistQuestionSetsToServer();
      } else if (localSets.length) {
        state.savedQuestionSetsCache = localSets;
        state.selectedQuestionSetIdsCache = localSelected;
        persistQuestionSetsToServer();
      } else {
        state.savedQuestionSetsCache = [];
        state.selectedQuestionSetIdsCache = [];
      }
      state.questionSetsServerReady = true;
      renderSavedQuestionSets();
      updateSetupSummary();
    })
    .catch(() => {
      state.questionSetsServerReady = false;
    });
}

function persistQuestionSetsToServer() {
  fetchWithTimeout("/api/question-sets", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sets: state.savedQuestionSetsCache,
      selectedIds: state.selectedQuestionSetIdsCache
    })
  })
    .then((response) => response.ok ? response.json() : null)
    .then((payload) => {
      if (!payload?.ok) return;
      state.questionSetsServerReady = true;
      state.savedQuestionSetsCache = Array.isArray(payload.sets) ? payload.sets : state.savedQuestionSetsCache;
      state.selectedQuestionSetIdsCache = Array.isArray(payload.selectedIds) ? payload.selectedIds.map(String) : state.selectedQuestionSetIdsCache;
    })
    .catch(() => {
      state.questionSetsServerReady = false;
    });
}

function saveCurrentQuestionSet() {
  const texts = {
    mainText: els.questionsInput.value.trim(),
    easyText: "",
    mediumText: "",
    hardText: ""
  };
  const sourceText = texts.mainText;
  const report = parseQuestionReport(texts.mainText);
  if (!sourceText || !report.questions.length) {
    setLaunchStatus("Paste valid questions before saving a question set.", true);
    return;
  }

  const now = new Date().toISOString();
  const rawName = sanitizeText(els.questionSetNameInput.value, { maxLength: 70 });
  const name = rawName || `Question Set ${new Date().toLocaleDateString()}`;
  const sets = readSavedQuestionSets();
  const existing = sets.find((set) => normalize(set.name) === normalize(name));
  const savedSet = {
    id: existing?.id || `qs-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
    name,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    useDifficulty: false,
    ...texts
  };
  const nextSets = existing
    ? sets.map((set) => set.id === existing.id ? savedSet : set)
    : [...sets, savedSet];
  writeSavedQuestionSets(nextSets);
  const selected = selectedQuestionSetIds();
  selected.add(savedSet.id);
  writeSelectedQuestionSetIds(selected);
  els.questionSetNameInput.value = "";
  setLaunchStatus(`Saved "${name}" with ${report.questions.length} parsed question${report.questions.length === 1 ? "" : "s"}.`);
  renderSavedQuestionSets();
  updateSetupSummary();
}

function syncQuestionSetSelectAllControl(sets, selected) {
  if (!els.questionSetsSelectAll || !els.questionSetsSelectAllLabel || !els.questionSetsSelectAllControl) return;
  const selectedCount = sets.filter((set) => selected.has(String(set.id))).length;
  const allSelected = sets.length > 0 && selectedCount === sets.length;
  els.questionSetsSelectAll.checked = allSelected;
  els.questionSetsSelectAll.indeterminate = selectedCount > 0 && !allSelected;
  els.questionSetsSelectAll.disabled = sets.length === 0;
  els.questionSetsSelectAllControl.classList.toggle("is-disabled", sets.length === 0);
  els.questionSetsSelectAllLabel.textContent = allSelected ? "Deselect all" : "Select all";
}

function renderSavedQuestionSets() {
  if (!els.savedQuestionSetsList || !els.savedQuestionSetsNote) return;
  const sets = readSavedQuestionSets();
  const selected = selectedQuestionSetIds();
  els.savedQuestionSetsNote.textContent = sets.length
    ? `${sets.length} saved set${sets.length === 1 ? "" : "s"}. Check one or more, then choose Saved Question Sets as the source.`
    : "No saved sets yet.";
  syncQuestionSetSelectAllControl(sets, selected);
  els.savedQuestionSetsList.innerHTML = sets.length ? sets.map((set) => {
    const count = savedQuestionSetReport(set).questions.length;
    return `
      <div class="saved-question-row">
        <label class="saved-question-check">
          <input class="questionSetUseCheck" type="checkbox" value="${escapeAttribute(set.id)}" ${selected.has(set.id) ? "checked" : ""}>
          <span>
            <strong>${escapeHtml(set.name)}</strong>
            <small>${count} parsed question${count === 1 ? "" : "s"}${set.useDifficulty ? " · legacy split bank" : ""}</small>
          </span>
        </label>
        <div class="saved-question-actions">
          <button class="secondary loadQuestionSetBtn" type="button" data-set-id="${escapeAttribute(set.id)}">Open in Editor</button>
          <button class="secondary deleteQuestionSetBtn" type="button" data-set-id="${escapeAttribute(set.id)}">Delete</button>
        </div>
      </div>
    `;
  }).join("") : `<p class="muted-small">Saved banks will appear here after you paste and save a set.</p>`;

  document.querySelectorAll(".questionSetUseCheck").forEach((input) => {
    input.addEventListener("change", () => {
      const next = selectedQuestionSetIds();
      if (input.checked) next.add(input.value);
      else next.delete(input.value);
      writeSelectedQuestionSetIds(next);
      syncQuestionSetSelectAllControl(sets, next);
      updateSetupSummary();
    });
  });
  document.querySelectorAll(".loadQuestionSetBtn").forEach((button) => {
    button.addEventListener("click", () => loadQuestionSetForEditing(button.dataset.setId || ""));
  });
  document.querySelectorAll(".deleteQuestionSetBtn").forEach((button) => {
    button.addEventListener("click", () => deleteQuestionSet(button.dataset.setId || ""));
  });
}

function loadQuestionSetForEditing(id) {
  const set = readSavedQuestionSets().find((entry) => entry.id === id);
  if (!set) return;
  els.questionSource.value = "paste";
  els.questionsInput.value = editableQuestionSetText(set);
  els.questionSetNameInput.value = set.name;
  delete els.missionLength.dataset.manual;
  syncSetupMode();
  setLaunchStatus(`Loaded "${set.name}" for editing.`);
}

function editableQuestionSetText(set) {
  if (!set?.useDifficulty) return set?.mainText || "";
  return [
    labeledQuestionBlocks(set.easyText, "Easy"),
    labeledQuestionBlocks(set.mediumText, "Medium"),
    labeledQuestionBlocks(set.hardText, "Hard")
  ].filter(Boolean).join("\n\n");
}

function labeledQuestionBlocks(text, difficulty) {
  return splitQuestionBlocks(text)
    .map((block) => `Difficulty: ${difficulty}\n${block}`)
    .join("\n\n");
}

function deleteQuestionSet(id) {
  const sets = readSavedQuestionSets();
  const set = sets.find((entry) => entry.id === id);
  if (!set) return;
  if (!window.confirm(`Delete saved question set "${set.name}"?`)) return;
  writeSavedQuestionSets(sets.filter((entry) => entry.id !== id));
  const selected = selectedQuestionSetIds();
  selected.delete(id);
  writeSelectedQuestionSetIds(selected);
  renderSavedQuestionSets();
  updateSetupSummary();
}

function selectedQuestionSets() {
  const selected = selectedQuestionSetIds();
  return readSavedQuestionSets().filter((set) => selected.has(set.id));
}

function savedQuestionSetReport(set) {
  if (set.useDifficulty) {
    const reports = [
      parseQuestionReport(set.easyText || ""),
      parseQuestionReport(set.mediumText || ""),
      parseQuestionReport(set.hardText || "")
    ];
    return {
      questions: [
        ...reports[0].questions.map((question) => ({ ...question, difficulty: "easy", sourceSet: set.name })),
        ...reports[1].questions.map((question) => ({ ...question, difficulty: "medium", sourceSet: set.name })),
        ...reports[2].questions.map((question) => ({ ...question, difficulty: "hard", sourceSet: set.name }))
      ],
      rejected: reports.flatMap((report) => report.rejected)
    };
  }
  const report = parseQuestionReport(set.mainText || "");
  return {
    questions: report.questions.map((question) => ({ ...question, sourceSet: set.name })),
    rejected: report.rejected
  };
}

function savedQuestionSetsReport() {
  const reports = selectedQuestionSets().map(savedQuestionSetReport);
  return {
    questions: reports.flatMap((report) => report.questions),
    rejected: reports.flatMap((report) => report.rejected)
  };
}

function makeChatQuestions(length) {
  const count = Math.max(1, Math.min(60, Number.isFinite(length) ? Math.round(length) : 25));
  return Array.from({ length: count }, (_, index) => ({
    question: `Live mission room ${index + 1}`,
    choices: [],
    answerKey: "",
    answerText: "",
    mode: "chat"
  }));
}

function makeLocalQuestions(length) {
  const count = Math.max(1, Math.min(60, Number.isFinite(length) ? Math.round(length) : 25));
  return Array.from({ length: count }, (_, index) => {
    const base = localQuestionBank[index % localQuestionBank.length];
    return {
      ...base,
      choices: base.choices.map((choice) => ({ ...choice }))
    };
  });
}

function getSetupStudyQuestions() {
  if (els.questionSource.value === "demo") {
    return localQuestionBank.map((question) => ({
      ...question,
      choices: question.choices.map((choice) => ({ ...choice })),
      difficulty: "medium"
    }));
  }

  if (els.questionSource.value === "saved") {
    const savedReport = savedQuestionSetsReport();
    if (savedReport.questions.length) return savedReport.questions;
    return getPastedQuestionReport().questions;
  }

  return getPastedQuestionReport().questions;
}

function getPastedQuestionReport() {
  return parseQuestionReport(els.questionsInput.value);
}

function getSetupQuestionReport() {
  if (els.questionSource.value === "demo") {
    return { questions: getSetupStudyQuestions(), rejected: [] };
  }
  if (els.questionSource.value === "saved") {
    const savedReport = savedQuestionSetsReport();
    if (savedReport.questions.length) return savedReport;
    return getPastedQuestionReport();
  }
  return getPastedQuestionReport();
}

function missionLengthFor(total) {
  const requested = Number(els.missionLength.value);
  if (!total) return 0;
  if (!Number.isFinite(requested) || requested < 1) return Math.max(1, Math.ceil(total / 2));
  return Math.max(1, Math.min(total, Math.round(requested)));
}

function missionStructureSummary(questionCount) {
  if (!questionCount) {
    return {
      challengeRooms: 0,
      recoveryRooms: 0,
      totalMapNodes: 0,
      bossQuestions: 0,
      normalRooms: 0,
      bossText: "No boss rooms",
      warning: ""
    };
  }
  const groups = bossQuestionGroups(questionCount);
  const bossQuestions = groups.reduce((sum, group) => sum + group.questionIndexes.length, 0);
  const mapNodes = buildNodes(questionCount);
  const normalRooms = mapNodes.filter((node) => node.type === "challenge" || node.type === "combat").length;
  const challengeRooms = mapNodes.filter((node) => node.type === "challenge" || node.type === "combat" || node.type === "boss").length;
  const recoveryRooms = mapNodes.filter((node) => node.type === "recovery").length;
  const hasMid = groups.some((group) => group.phase === "mid");
  const hasFinal = groups.some((group) => group.phase === "final");
  const bossText = hasMid && hasFinal
    ? "health-based midpoint boss + health-based final boss"
    : hasFinal
    ? "health-based final boss only"
    : "No boss rooms";
  const warning = questionCount < TWO_BOSS_MIN_QUESTIONS
    ? `Use ${TWO_BOSS_MIN_QUESTIONS}+ questions to include both midpoint and final bosses.`
    : "";
  return {
    challengeRooms,
    recoveryRooms,
    totalMapNodes: mapNodes.length,
    bossQuestions,
    normalRooms,
    bossText,
    warning
  };
}

function updateSetupSummary() {
  const report = getSetupQuestionReport();
  const questions = report.questions;
  const total = questions.length;
  const actionDrivenMode = Boolean(els.actionDrivenMode?.checked);
  const roster = setupRosterPlayers();
  const deviceMode = selectedDeviceMode();
  const savedSourceActive = els.questionSource.value === "saved";
  const selectedSets = savedSourceActive ? selectedQuestionSets() : [];
  const manualLength = els.missionLength.dataset.manual === "true";
  if (actionDrivenMode && !manualLength) els.missionLength.value = "5";
  if (!actionDrivenMode && total && !manualLength) els.missionLength.value = String(Math.max(1, Math.ceil(total / 2)));
  if (!actionDrivenMode && !total && !manualLength) els.missionLength.value = "";
  const lengthValidation = missionLengthValidation(total, actionDrivenMode);
  const length = actionDrivenMode ? actionMissionLengthFor() : missionLengthFor(total);
  const engine = els.dmEngine.options[els.dmEngine.selectedIndex]?.text || "Local Auto DM";
  const structure = missionStructureSummary(length);
  const bossTest = Boolean(els.bossTestMode?.checked);
  const bossTestPhase = els.bossTestPhase?.value === "mid" ? "mid" : "final";
  if (els.bossTestPhaseField) els.bossTestPhaseField.hidden = !bossTest;
  const combatTest = Boolean(els.combatTestMode?.checked);
  if (els.setupModeStatus) els.setupModeStatus.textContent = deviceMode === "single" ? "Single Device" : "Device Lobby";
  if (els.setupRouteStatus) els.setupRouteStatus.textContent = actionDrivenMode ? `${length} Action Rooms` : total ? `${length} ${combatTest ? "Combat Loop" : bossTest ? "Boss Test" : "Randomized"}` : "Awaiting Bank";
  if (els.setupDmStatus) els.setupDmStatus.textContent = `${engine.replace(" Auto", "")}${state.fastMode ? " Fast" : ""}`;

  els.playerCountNote.textContent = deviceMode === "single"
    ? roster.length ? `${roster.length} player${roster.length === 1 ? "" : "s"} ready for teacher-screen input.` : "Add one player per line for Single Device mode."
    : "Players will join by device after setup.";
  const rejected = report.rejected.length;
  if (els.missionLengthNote) {
    els.missionLengthNote.textContent = lengthValidation.valid
      ? actionDrivenMode
        ? "Action missions support 1 to 30 rooms."
        : total
        ? `${lengthValidation.value} of ${total} questions. The automatic default is half of the bank.`
        : "Defaults to half of the available questions."
      : lengthValidation.message;
    els.missionLengthNote.classList.toggle("input-warning", !lengthValidation.valid);
  }
  const setPrefix = savedSourceActive
    ? selectedSets.length
      ? `${selectedSets.length} saved set${selectedSets.length === 1 ? "" : "s"} selected. `
      : total
      ? "No saved sets selected; using pasted questions. "
      : "No saved sets selected. "
    : "";
  els.questionCountNote.textContent = actionDrivenMode
    ? `Action-driven mission enabled. The route will use ${length} room${length === 1 ? "" : "s"} and resolve progress from player actions instead of study questions.`
    : combatTest && total
    ? `${setPrefix}${total} question${total === 1 ? "" : "s"} parsed. Combat Test Loop will begin with one normal staging room, then create ${Math.ceil(Math.max(1, length - 1) / COMBAT_QUESTION_POOL_SIZE)} consecutive combat room${Math.ceil(Math.max(1, length - 1) / COMBAT_QUESTION_POOL_SIZE) === 1 ? "" : "s"} with up to ${COMBAT_QUESTION_POOL_SIZE} questions each.`
    : total
    ? `${setPrefix}${total} question${total === 1 ? "" : "s"} parsed. Mission will use ${length} question${length === 1 ? "" : "s"} across ${structure.challengeRooms} encounter room${structure.challengeRooms === 1 ? "" : "s"} plus ${structure.recoveryRooms} recovery room${structure.recoveryRooms === 1 ? "" : "s"}. Boss plan: ${structure.bossText}.${structure.warning ? ` ${structure.warning}` : ""}${rejected ? ` ${rejected} block${rejected === 1 ? "" : "s"} could not be parsed.` : ""}`
    : `${setPrefix}No questions parsed yet.`;
  if (!lengthValidation.valid) els.questionCountNote.textContent += ` ${lengthValidation.message}`;
  els.questionCountNote.classList.toggle("has-errors", rejected > 0 || !lengthValidation.valid);
  renderParseIssues(report.rejected);
  els.preflightSummary.textContent = false && total
    ? `${players.length} players · ${length} challenges · ${engine}`
    : "Add study questions to begin.";
  els.preflightSummary.textContent = actionDrivenMode
    ? `${deviceMode === "single" ? `${roster.length || 0} players` : "Device join lobby"} - ${length} action rooms - ${engine}${state.fastMode ? " - Fast pacing" : ""}`
    : total
    ? `${deviceMode === "single" ? `${roster.length || 0} players` : "Device join lobby"} - ${length} questions - ${combatTest ? "Combat test loop" : `${structure.challengeRooms} encounter rooms`} - ${engine}${bossTest && !combatTest ? ` - ${bossTestPhase === "mid" ? "Mid" : "Final"} boss test` : ""}${state.fastMode ? " - Fast pacing" : ""}`
    : "Add study questions to begin.";
  if (!lengthValidation.valid) els.preflightSummary.textContent = "Mission length needs attention before launch.";
}

function renderParseIssues(rejected) {
  els.questionParseIssues.hidden = !rejected.length;
  els.questionParseIssuesList.innerHTML = "";
  if (!rejected.length) {
    state.parseIssueHighlightKey = "";
    return;
  }
  els.questionParseIssues.open = true;
  const issueKey = rejected.map((block) => normalize(block).slice(0, 80)).join("|");
  for (const [index, block] of rejected.entries()) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "parse-issue-jump";
    const preview = cleanQuestionMarkup(block).replace(/\s+/g, " ").trim();
    button.textContent = preview.length > 180 ? `${preview.slice(0, 177)}...` : preview;
    button.addEventListener("click", () => highlightRejectedQuestionBlock(block));
    item.appendChild(button);
    els.questionParseIssuesList.appendChild(item);
    if (index === 0 && issueKey !== state.parseIssueHighlightKey) {
      state.parseIssueHighlightKey = issueKey;
      window.setTimeout(() => highlightRejectedQuestionBlock(block), 80);
    }
  }
}

function highlightRejectedQuestionBlock(block) {
  const location = findRejectedQuestionBlock(block);
  if (!location) return false;
  const { input, start, end } = location;
  if (els.questionSource.value !== "paste") els.questionSource.value = "paste";
  syncSetupMode();
  input.focus({ preventScroll: true });
  input.setSelectionRange(start, Math.max(start + 1, end));
  scrollTextareaSelectionIntoView(input, start);
  input.classList.add("parse-highlight-active");
  window.setTimeout(() => input.classList.remove("parse-highlight-active"), 1800);
  return true;
}

function findRejectedQuestionBlock(block) {
  const sources = [els.questionsInput].filter(Boolean);
  for (const input of sources) {
    const range = findTextRange(input.value, block);
    if (range) return { input, ...range };
  }
  return null;
}

function findTextRange(text, block) {
  const source = String(text || "");
  const target = String(block || "").trim();
  if (!source || !target) return null;
  const exact = source.indexOf(target);
  if (exact >= 0) return { start: exact, end: exact + target.length };

  const lines = target.split("\n").map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return null;
  const firstLine = lines[0];
  const first = source.indexOf(firstLine);
  if (first < 0) return null;
  const lastLine = lines[lines.length - 1];
  const last = source.indexOf(lastLine, first + firstLine.length);
  const end = last >= 0 ? last + lastLine.length : first + firstLine.length;
  return { start: first, end };
}

function scrollTextareaSelectionIntoView(input, start) {
  const before = input.value.slice(0, start);
  const lineIndex = before.split("\n").length - 1;
  const lineHeight = parseFloat(getComputedStyle(input).lineHeight) || 18;
  input.scrollTop = Math.max(0, lineIndex * lineHeight - input.clientHeight * 0.35);
  input.scrollIntoView({ behavior: "smooth", block: "center" });
}

function selectMissionQuestions(questions, length) {
  const count = Math.max(0, Math.min(length, questions.length));
  if (!questions.some((question) => question.difficulty)) return shuffleForSession(questions).slice(0, count);

  const pools = {
    easy: shuffleForSession(questions.filter((question) => question.difficulty === "easy")),
    medium: shuffleForSession(questions.filter((question) => question.difficulty === "medium")),
    hard: shuffleForSession(questions.filter((question) => question.difficulty === "hard"))
  };
  const remaining = shuffleForSession(questions);
  const picked = Array(count).fill(null);

  const takeQuestion = (fallbacks) => {
    const pool = fallbacks.map((name) => pools[name]).find((candidate) => candidate.length);
    const question = pool ? pool.shift() : remaining[0];
    if (!question) return null;
    for (const key of Object.keys(pools)) {
      const position = pools[key].indexOf(question);
      if (position >= 0) pools[key].splice(position, 1);
    }
    const remainingPosition = remaining.indexOf(question);
    if (remainingPosition >= 0) remaining.splice(remainingPosition, 1);
    return question;
  };

  // Reserve hard material for major encounters before filling ordinary rooms.
  for (let index = 0; index < count; index++) {
    if (isBossQuestion(index, count)) picked[index] = takeQuestion(["hard", "medium", "easy"]);
  }

  for (let index = 0; index < count; index++) {
    if (picked[index]) continue;
    const desired = desiredDifficultyForEncounter(index, count);
    picked[index] = takeQuestion(desired === "easy" ? ["easy", "medium", "hard"] : ["medium", "easy", "hard"]);
  }

  return picked.filter(Boolean);
}

function shuffleForSession(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function desiredDifficultyForEncounter(index, total) {
  if (isBossQuestion(index, total)) return "hard";
  if (index < Math.max(2, Math.floor(total * 0.24))) return "easy";
  return "medium";
}

function parsePlayers(text) {
  return text
    .split(/[\n,]/)
    .map((name) => name.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function parseQuestions(text) {
  return questionBank.parseQuestions(text);
}

function parseQuestionReport(text) {
  return questionBank.parseQuestionReport(text);
}

function splitQuestionBlocks(text) {
  return questionBank.splitQuestionBlocks(text);
}

function parseQuestionBlock(block) {
  return questionBank.parseQuestionBlock(block);
}

function isTrueFalseChoiceSet(choices) {
  if (!Array.isArray(choices) || choices.length !== 2) return false;
  const values = choices.map((choice) => normalize(choice.text)).sort();
  return values[0] === "false" && values[1] === "true";
}

function cleanQuestionMarkup(value) {
  return questionBank.cleanQuestionMarkup(value);
}

function prepareQuestions(questions, challengeTypes = []) {
  const presentedQuestions = questions.map((question, index) => {
    return question;
  });

  const eligibleIndexes = presentedQuestions
    .map((question, index) => {
      if (challengeTypes[index]?.kind === "emergency") return -1;
      if (question.type === "true-false") return -1;
      if (question.type === "fill") return -1;
      return isFillEligible(question.answerText) ? index : -1;
    })
    .filter((index) => index >= 0);
  const fillTarget = Math.min(
    eligibleIndexes.length,
    Math.max(eligibleIndexes.length >= 7 ? 1 : 0, Math.floor(eligibleIndexes.length * 0.15))
  );
  const fillIndexes = new Set(shuffle(eligibleIndexes).slice(0, fillTarget));
  return presentedQuestions.map((question, index) => ({
    ...question,
    mode: question.type === "fill" && challengeTypes[index]?.kind !== "emergency"
      ? "fill"
      : challengeTypes[index]?.kind === "emergency" || question.type === "true-false"
      ? "multiple"
      : fillIndexes.has(index)
      ? "fill"
      : "multiple"
  }));
}

function isFillEligible(answer) {
  const words = answer.trim().split(/\s+/);
  return words.length <= 4 && answer.length <= 34 && !/[;:,.]/.test(answer);
}

function buildNodes(questionCount) {
  const nodes = [];
  if (state.actionDrivenMode) return buildActionNodes(questionCount);
  const firstRecovery = Math.max(1, Math.floor(questionCount / 3));
  const secondRecovery = Math.max(firstRecovery + 1, Math.floor((questionCount * 2) / 3));
  const bossGroups = bossQuestionGroups(questionCount);
  const bossByStart = new Map(bossGroups.map((group) => [group.start, group]));
  const bossIndexes = new Set(bossGroups.flatMap((group) => group.questionIndexes));
  const hasMidBoss = bossGroups.some((group) => group.phase === "mid");
  let postBossRecoveryInserted = false;
  let normalRoomOrdinal = 0;

  for (let i = 0; i < questionCount;) {
    const bossGroup = bossByStart.get(i);
    if (bossGroup) {
      nodes.push({
        type: "boss",
        bossPhase: bossGroup.phase,
        bossVisualId: selectBossVisualId(bossGroup.phase),
        questionIndex: bossGroup.start,
        questionIndexes: bossGroup.questionIndexes,
        label: bossGroup.phase === "final" ? "Final" : "Boss"
      });
      if (bossGroup.phase !== "final") {
        nodes.push({
          type: "recovery",
          tier: 2,
          label: "Shelter",
          afterBoss: true
        });
        postBossRecoveryInserted = true;
      }
      i = bossGroup.end + 1;
      continue;
    }
    if (!bossIndexes.has(i) && i === firstRecovery) nodes.push({ type: "recovery", tier: 1, label: "Aid" });
    if (!hasMidBoss && !postBossRecoveryInserted && !bossIndexes.has(i) && i === secondRecovery) nodes.push({ type: "recovery", tier: 2, label: "Hub" });
    const combatRoom = normalRoomOrdinal % 3 === 1;
    const desiredRounds = COMBAT_QUESTION_POOL_SIZE;
    const boundaryIndexes = [firstRecovery, !hasMidBoss ? secondRecovery : -1, ...bossGroups.map((group) => group.start)]
      .filter((index) => index > i);
    const nextBoundary = boundaryIndexes.length ? Math.min(...boundaryIndexes) : questionCount;
    const roomEnd = combatRoom ? Math.min(nextBoundary, i + desiredRounds) : i + 1;
    const questionIndexes = range(i, Math.max(i, roomEnd - 1));
    nodes.push({
      type: combatRoom ? "combat" : "challenge",
      roomKind: combatRoom ? "combat" : "obstacle",
      questionIndex: i,
      questionIndexes,
      label: combatRoom ? "Contact" : String(i + 1)
    });
    i = roomEnd;
    normalRoomOrdinal += 1;
  }
  return nodes;
}

function buildCombatTestNodes(questionCount) {
  const total = Math.max(1, Number(questionCount) || 1);
  const nodes = [{
    type: "challenge",
    roomKind: "obstacle",
    combatTestStaging: true,
    questionIndex: 0,
    questionIndexes: [0],
    label: "Staging"
  }];
  const questionsPerRoom = COMBAT_QUESTION_POOL_SIZE;
  const combatStart = total > 1 ? 1 : 0;
  for (let index = combatStart; index < total; index += questionsPerRoom) {
    const questionIndexes = range(index, Math.min(total - 1, index + questionsPerRoom - 1));
    nodes.push({
      type: "combat",
      roomKind: "combat",
      combatTest: true,
      questionIndex: index,
      questionIndexes,
      label: `Test ${nodes.length}`
    });
  }
  return nodes;
}

const actionRoomTypePool = actionRooms.typePool || [];

function buildActionNodes(count) {
  const total = Math.max(1, Number(count) || 10);
  return Array.from({ length: total }, (_, index) => ({
    type: "challenge",
    actionRoom: true,
    actionRoomIndex: index,
    questionIndex: index,
    label: String(index + 1)
  }));
}

function buildActionRooms(count) {
  const shuffled = shuffleForSession(actionRoomTypePool);
  return Array.from({ length: Math.max(1, Number(count) || 10) }, (_, index) => {
    const template = index === Math.max(1, Number(count) || 10) - 1
      ? { kind: "extraction", label: "Extraction Room", scoring: "team", objective: "secure extraction, carry survivors, and force the final route open" }
      : shuffled[index % shuffled.length];
    const pressureEligible = index > 0 && template.kind !== "dialogue" && template.kind !== "resource" && template.kind !== "normal";
    return {
      ...template,
      areaName: actionRoomAreaName(template, index),
      entities: fallbackActionRoomEntities(template, index),
      turnLimit: template.kind === "escape" ? 3 : 0,
      pressureSpotlight: pressureEligible && state.rng() < 0.18
    };
  });
}

function isCombatNode(node = state.nodes[state.currentNode]) {
  return Boolean(node && (node.type === "combat" || node.type === "boss"));
}

function combatQuestionIndexes(node = state.nodes[state.currentNode]) {
  if (!node) return [];
  const indexes = Array.isArray(node.questionIndexes) && node.questionIndexes.length
    ? node.questionIndexes
    : [Number(node.questionIndex) || 0];
  return indexes.slice(0, COMBAT_QUESTION_POOL_SIZE);
}

function combatTierPlan(node, nodeIndex = state.currentNode) {
  if (node?.type === "boss") return ["heavy"];
  const ratio = state.nodes.length > 1 ? nodeIndex / (state.nodes.length - 1) : 0;
  if (ratio < 0.3) return state.rng() < 0.5 ? ["light", "light"] : ["light", "light", "light"];
  if (ratio < 0.68) return state.rng() < 0.5 ? ["medium", "light"] : ["medium", "light", "light"];
  return state.rng() < 0.55 ? ["heavy", "light"] : ["medium", "medium", "light"];
}

function ensureCombatEncounter(nodeIndex = state.currentNode) {
  const node = state.nodes[nodeIndex];
  if (!isCombatNode(node) || !combatSystem.createEnemyGroup) return null;
  if (state.combatEncounters[nodeIndex]) return state.combatEncounters[nodeIndex];
  const group = combatSystem.createEnemyGroup(combatTierPlan(node, nodeIndex), state.rng);
  if (node.type !== "boss") assignEnemyVisuals(group.enemies);
  const playerScale = 0.6 + activePlayers().length * 0.3;
  for (const enemy of group.enemies) {
    enemy.hp = Math.max(1, Math.round(enemy.hp * playerScale));
    enemy.maxHp = enemy.hp;
  }
  if (node.type === "boss") {
    const finalBoss = node.bossPhase === "final";
    const targetHp = Math.max(finalBoss ? 36 : 28, activePlayers().length * (finalBoss ? 26 : 20));
    group.enemies[0].label = finalBoss ? state.threat || "Final Hostile" : `${state.threat || "Hostile"} Vanguard`;
    group.enemies[0].hp = targetHp;
    group.enemies[0].maxHp = targetHp;
    group.enemies[0].boss = true;
    group.enemies[0].activations = finalBoss ? 3 : 2;
  }
  group.hp = group.enemies.reduce((sum, enemy) => sum + enemy.hp, 0);
  group.maxHp = group.hp;
  const encounter = {
    ...group,
    nodeIndex,
    roomType: node.type === "boss" ? "boss" : "combat",
    round: 0,
    cleared: false,
    lastRound: null
  };
  state.combatEncounters[nodeIndex] = encounter;
  return encounter;
}

function currentCombatEncounter() {
  return ensureCombatEncounter(state.currentNode);
}

function preserveUnusedCombatQuestions(node, encounter) {
  if (!node || node.type !== "combat" || !encounter?.cleared) return;
  const indexes = combatQuestionIndexes(node);
  const unused = indexes.filter((index) => index > state.currentQuestion);
  if (!unused.length) return;
  node.questionIndexes = indexes.filter((index) => index <= state.currentQuestion);
  const inserted = unused.map((questionIndex) => ({
    type: "challenge",
    roomKind: "obstacle",
    questionIndex,
    questionIndexes: [questionIndex],
    label: String(questionIndex + 1),
    recoveredFromCombat: true
  }));
  state.nodes.splice(state.currentNode + 1, 0, ...inserted);
  const oldPositions = [...state.mapPositions];
  const regenerated = generateSprawledRoutePositions(state.nodes.length, state.mapLayoutSeed + unused.length * 97);
  for (let index = 0; index <= state.currentNode && oldPositions[index]; index += 1) regenerated[index] = oldPositions[index];
  state.mapPositions = stabilizeRoutePositions(regenerated, { lockedCount: state.currentNode + 1 });
  // Inserting recovered obstacle nodes shifts every later room index. Keep
  // the combat presentation gate aligned with the moved rooms so a future
  // combat node is not accidentally treated as already entered.
  state.combatStageEnteredNodes = new Set([...state.combatStageEnteredNodes].map((index) => (
    index > state.currentNode ? index + inserted.length : index
  )));
  const shiftedEncounters = {};
  Object.entries(state.combatEncounters || {}).forEach(([index, encounter]) => {
    const numericIndex = Number(index);
    const shiftedIndex = numericIndex > state.currentNode ? numericIndex + inserted.length : numericIndex;
    shiftedEncounters[shiftedIndex] = encounter ? { ...encounter, nodeIndex: shiftedIndex } : encounter;
  });
  state.combatEncounters = shiftedEncounters;
  for (const key of Object.keys(state.roomNames).map(Number).filter((index) => index > state.currentNode).sort((a, b) => b - a)) {
    state.roomNames[key + inserted.length] = state.roomNames[key];
    delete state.roomNames[key];
  }
  logDebugEvent({
    kind: "state",
    label: "Combat cleared early",
    detail: `${unused.length} unused study question${unused.length === 1 ? "" : "s"} returned as obstacle rooms`
  });
}

function combatCooldownReady(player, ability, turns, encounter = null) {
  const last = Number(player?.classCooldowns?.[ability]);
  const current = encounter ? Number(encounter.round) || 0 : Number(state.currentQuestion) || 0;
  return !Number.isFinite(last) || current - last >= turns;
}

function markCombatCooldown(player, ability, encounter = null) {
  const marker = encounter ? Number(encounter.round) || 0 : Number(state.currentQuestion) || 0;
  player.classCooldowns = { ...(player.classCooldowns || {}), [ability]: marker };
}

function combatAnswerElapsedMs(submittedAt) {
  const submitted = pointTimestamp(submittedAt);
  const activePauseMs = state.questionPauseStartedAt ? Math.max(0, submitted - state.questionPauseStartedAt) : 0;
  return Math.max(0, submitted - (Number(state.questionOpenedAt) || submitted) - state.questionPausedTotalMs - activePauseMs);
}

function combatBraceMitigation(entry, type) {
  if (!entry) return 0;
  const duration = Math.max(1_000, Number(state.questionDurationMs) || questionScoringDurationMs({ type }));
  // A few client/device paths can omit the optional timestamp.  A correct
  // response must still brace; use the current instant as a conservative
  // fallback instead of silently treating it as an unbraced hit.
  const submittedAt = entry.submittedAt || Date.now();
  const elapsed = Math.max(0, Math.min(duration, combatAnswerElapsedMs(submittedAt)));
  // Emergency response windows are shorter, so compress the normal 5s/20s
  // breakpoints proportionally instead of giving them a full minute to brace.
  const breakpointScale = Math.min(1, duration / 60_000);
  const firstBreakpoint = 5_000 * breakpointScale;
  const secondBreakpoint = 20_000 * breakpointScale;
  if (elapsed <= firstBreakpoint) return 0.8;
  if (elapsed <= secondBreakpoint) {
    const progress = (elapsed - firstBreakpoint) / Math.max(1, secondBreakpoint - firstBreakpoint);
    return 0.8 - progress * 0.3;
  }
  const progress = (elapsed - secondBreakpoint) / Math.max(1, duration - secondBreakpoint);
  return Math.max(0.25, 0.5 - progress * 0.25);
}

function combatBraceEntry(entries, type, operator, target) {
  if (type?.locked && operator && sameName(operator.name, target?.name)) {
    return entries.find((entry) => entry.player && sameName(entry.player.name, operator.name)) || null;
  }
  if (type?.kind === "emergency") {
    return [...entries]
      .filter((entry) => entry.player && !entry.player.incapacitated)
      .sort((a, b) => pointTimestamp(a.submittedAt) - pointTimestamp(b.submittedAt))[0] || null;
  }
  return entries.find((entry) => entry.player && target && sameName(entry.player.name, target.name)) || null;
}

function empoweredReady(player, encounter, key, cadence = 3) {
  if (!player || Number(player.level) < 3 || !encounter) return false;
  const lastRound = Number(player.classCooldowns?.[key]);
  return !Number.isFinite(lastRound) || encounter.round - lastRound >= cadence;
}

function markEmpoweredUse(player, key, encounter) {
  player.classCooldowns = { ...(player.classCooldowns || {}), [key]: encounter.round };
}

function clearCombatAbilityMarkers(players = state.players) {
  players.forEach((player) => {
    delete player._combatRedirect;
    delete player._combatBubble;
    delete player._classDoubleAttackReady;
    delete player._classCommandReady;
    delete player._classCommandProtocol;
    delete player._classDisruptionReady;
    delete player._classShieldReady;
  });
}

function combatPlayerDamage(entry, question, type) {
  if (!entry?.correct || !entry.player) return 0;
  const duration = Math.max(1_000, Number(state.questionDurationMs) || questionScoringDurationMs({ type }));
  let elapsed = combatAnswerElapsedMs(entry.submittedAt || Date.now());
  if (entry.player.classId === "scout") elapsed *= 0.9;
  let damage = combatSystem.answerDamage?.(elapsed, duration, questionDifficulty(question)) || 2;
  damage += combatSystem.classCombatDamage?.(entry.player) || 0;
  damage += itemBonus(entry.player, "damage") + itemBonus(entry.player, "streakDamage");
  const armedItemDamage = Math.max(0, Number(entry.player._itemAbilityDamageBonus) || 0);
  if (armedItemDamage) {
    damage += armedItemDamage;
    entry.player._itemAbilityDamageBonus = 0;
  }
  if (type.kind === "emergency") damage += 2;
  return Math.max(1, Math.round(damage));
}

function enforcerReduction(player) {
  if (player?.classId !== "enforcer") return 0;
  const streak = Math.max(0, Number(player.answerStreak) || 0);
  return streak >= 5 ? 0.5 : streak >= 3 ? 0.35 : streak >= 1 ? 0.2 : 0;
}

function enforcerReserveCap(player) {
  return Math.max(0, Math.floor(Math.max(10, Number(player?.maxHp) || 10) * 0.5));
}

function addEnforcerReserve(player, amount) {
  if (player?.classId !== "enforcer" || player.incapacitated) return 0;
  const cap = enforcerReserveCap(player);
  const current = Math.max(0, Math.min(cap, Math.round(Number(player.enforcerReserve) || 0)));
  const added = Math.max(0, Math.min(cap - current, Math.round(Number(amount) || 0)));
  player.enforcerReserve = current + added;
  return added;
}

function applyCombatDamage(player, amount, source, notes, facts, encounter = null, allowRedirect = true) {
  if (!player || player.incapacitated) return 0;
  let incoming = Math.max(0, Math.round(Number(amount) || 0));
  if (incoming > 0 && player._itemAbilityGuard) {
    const beforeGuard = incoming;
    incoming = Math.max(0, incoming - 4);
    player._itemAbilityGuard = false;
    addEnforcerReserve(player, beforeGuard - incoming);
    facts.push(`${player.name}'s item guard matrix reduces the incoming hit`);
    addEventNote(notes, player.name, `${player.name}'s protection module absorbs part of the attack.`);
  }
  incoming += Math.max(0, itemRisk(player, "incomingDamage"));
  const beforeFlatReduction = incoming;
  incoming = Math.max(0, incoming - itemBonus(player, "damageReduction"));
  addEnforcerReserve(player, beforeFlatReduction - incoming);
  const passiveRate = enforcerReduction(player);
  if (passiveRate) {
    const beforePercentageReduction = incoming;
    incoming = Math.max(0, Math.round(incoming * (1 - passiveRate)));
    addEnforcerReserve(player, beforePercentageReduction - incoming);
  }
  // Preserve the reason a hit dealt no damage so the combat presentation can
  // call it out as BLOCKED instead of showing a confusing "-0" result.
  if (Number(amount) > 0 && incoming === 0) player._combatBlocked = true;
  if (encounter?.bubbleTargetName && sameName(encounter.bubbleTargetName, player.name)) {
    addEnforcerReserve(player, incoming);
    encounter.bubbleTargetName = "";
    player._combatBubble = true;
    facts.push(`${player.name}'s Engineer bubble absorbs one incoming hit`);
    addEventNote(notes, player.name, `${player.name}'s protection bubble catches the attack.`);
    return 0;
  }
  if (incoming > 0 && player._classShieldReady) {
    addEnforcerReserve(player, incoming);
    const shieldName = Number(player.level) >= 3 ? "RRR" : "R&R";
    facts.push(`${player.name}'s ${shieldName} shield blocks all incoming damage this turn`);
    addEventNote(notes, player.name, `${player.name}'s ${shieldName} shield catches the attack before it lands.`);
    player._combatBlocked = true;
    return 0;
  }
  if (allowRedirect && incoming > 0 && player.classId !== "enforcer" && incoming >= player.hp) {
    const redirector = activePlayers().find((candidate) => candidate.classId === "enforcer" && Number(candidate.level) >= 3 && !candidate.incapacitated && combatCooldownReady(candidate, "fatal-redirect", 3, encounter));
    if (redirector) {
      markCombatCooldown(redirector, "fatal-redirect", encounter);
      const redirectedAmount = Math.max(1, Math.ceil(incoming / 2));
      const redirectedDamage = applyCombatDamage(redirector, redirectedAmount, source, notes, facts, encounter, false);
      player._combatRedirect = { target: redirector, damage: redirectedDamage, amount: redirectedAmount };
      facts.push(`${redirector.name}'s RRR redirects fatal damage away from ${player.name} and onto the Enforcer at half strength`);
      addEventNote(notes, redirector.name, `${redirector.name}'s RRR intercepts the fatal blow meant for ${player.name}.`);
      return 0;
    }
  }
  const before = player.hp;
  applyDamage(player, incoming, source);
  const dealt = Math.max(0, before - player.hp);
  if (dealt) addEventNote(notes, player.name, `${player.name} is hit during the enemy counterattack.`);
  return dealt;
}

function combatTargetsForActivation(entries, type, operator) {
  const active = activePlayers();
  if (!active.length) return [];
  const resolveActive = (player) => active.find((candidate) => candidate && player && sameName(candidate.name, player.name)) || null;
  const wrong = entries.filter((entry) => !entry.correct && entry.player && !entry.player.incapacitated).map((entry) => resolveActive(entry.player)).filter(Boolean);
  if (type.locked && operator && !operator.incapacitated) return [resolveActive(operator) || operator];
  if (type.kind === "team") return active;
  if (type.kind === "emergency" && wrong.length) return [wrong[0]];
  if ((type.kind === "individual" || type.kind === "truefalse") && wrong.length) return [wrong[Math.floor(state.rng() * wrong.length)]];
  return [active[Math.floor(state.rng() * active.length)]];
}

function combatIntentText(type = null, operator = null) {
  if (!type) type = combatRoundChallengeType(state.currentQuestion);
  if (!operator && type.locked) operator = selectOperator(state.currentQuestion);
  const encounter = isCombatNode(state.nodes[state.currentNode]) ? currentCombatEncounter() : null;
  const count = encounter?.enemies.filter((enemy) => !enemy.defeated).reduce((sum, enemy) => sum + Math.max(1, Number(enemy.activations) || 1), 0) || 0;
  if (type.locked && operator) return `${count} incoming activation${count === 1 ? "" : "s"} focused on ${operator.name}.`;
  if (type.kind === "team") return `${count} team-wide attack${count === 1 ? "" : "s"}; correct responders automatically brace.`;
  if (type.kind === "emergency") return `${count} rapid activation${count === 1 ? "" : "s"}; an incorrect first responder becomes the priority target.`;
  return `${count} targeted activation${count === 1 ? "" : "s"}; incorrect responders are prioritized.`;
}

function applyPendingCombatAbilities(encounter, notes, facts, supportEvents = []) {
  let disruptionCount = 0;
  const classPending = Array.isArray(state.pendingClassAbilityUses) ? state.pendingClassAbilityUses.splice(0) : [];
  classPending.forEach((use) => {
    const source = state.players.find((player) => sameName(player.name, use.sourceName));
    if (!source || source.incapacitated) return;
    const target = use.targetName
      ? state.players.find((player) => sameName(player.name, use.targetName) && !player.incapacitated)
      : source;
    const classId = String(use.classId || source.classId || "").toLowerCase();
    if (!encounter && !["medic", "scout"].includes(classId)) return;
    if (["medic", "engineer"].includes(classId) && !target) return;
    if (classId === "medic") {
      const empoweredMedic = Number(source.level) >= 3 && empoweredReady(source, encounter, "medic-overflow", 3);
      const amount = Math.min(14, 4 + Math.min(4, Math.max(0, Number(source.answerStreak) || 0)) + itemBonus(source, "healing") + (empoweredMedic ? 2 : 0));
      const before = target.hp;
      healPlayer(target, amount);
      const healed = Math.max(0, target.hp - before);
      if (healed) {
        facts.push(`${source.name}'s Surgical Kit restores ${target.name}`);
        addEventNote(notes, target.name, `${source.name} uses the Surgical Kit to restore ${healed} HP.`);
        supportEvents.push({ kind: "heal", source: source.name, target: target.name, amount: healed, hpAfter: target.hp, maxHp: target.maxHp, label: "Surgical Kit" });
      }
      if (empoweredMedic) {
        markEmpoweredUse(source, "medic-overflow", encounter);
        activePlayers().filter((player) => player !== target && player.hp < player.maxHp).sort((a, b) => a.hp - b.hp).slice(0, 2).forEach((secondary) => {
          const secondaryBefore = secondary.hp;
          healPlayer(secondary, 2 + Math.floor(itemBonus(source, "healing") / 2));
          if (secondary.hp > secondaryBefore) supportEvents.push({ kind: "heal", source: source.name, target: secondary.name, amount: secondary.hp - secondaryBefore, hpAfter: secondary.hp, maxHp: secondary.maxHp, label: "Medical Field" });
        });
        facts.push(`${source.name}'s empowered Surgical Kit sends smaller heals to nearby teammates`);
      }
    } else if (classId === "scout") {
      activateScoutHintForPrompt(currentQuestionInfo(), source);
      if (state.classHints[state.currentQuestion]) {
        facts.push(`${source.name}'s Spectrum Analyzer sharpens the active prompt`);
        supportEvents.push({ kind: "hint", source: source.name, target: source.name, amount: 1, label: "Spectrum Analyzer" });
      }
    } else if (classId === "enforcer") {
      source._classShieldReady = true;
      const shieldName = Number(source.level) >= 3 ? "RRR" : "R&R";
      facts.push(`${source.name}'s ${shieldName} shield is armed and will block all incoming damage this turn`);
      supportEvents.push({ kind: "guard", source: source.name, target: source.name, amount: 0, label: `${shieldName} — Ballistic Shield` });
      const reserve = Math.max(0, Math.round(Number(source.enforcerReserve) || 0));
      if (reserve > 0 && source.hp < source.maxHp) {
        const before = source.hp;
        healPlayer(source, reserve);
        const repaired = Math.max(0, source.hp - before);
        source.enforcerReserve = 0;
        if (repaired) {
          const repairName = Number(source.level) >= 3 ? "RRR Repair" : "R&R Repair";
          facts.push(`${source.name}'s ${repairName} converts the damage reserve into ${repaired} HP`);
          addEventNote(notes, source.name, `${source.name}'s ${repairName} restores ${repaired} HP from the stored damage reserve.`);
          supportEvents.push({ kind: "regen", source: source.name, target: source.name, amount: repaired, hpAfter: source.hp, maxHp: source.maxHp, label: repairName });
        }
      } else if (reserve > 0 && source.hp >= source.maxHp) {
        source.enforcerReserve = 0;
      }
    } else if (classId === "engineer") {
      source._classDisruptionReady = true;
      disruptionCount += 1 + itemBonus(source, "disruption");
      facts.push(`${source.name}'s Arc Toolkit disrupts an enemy activation`);
      supportEvents.push({ kind: "disrupt", source: source.name, target: source.name, amount: 1, label: "Arc Toolkit" });
      if (Number(source.level) >= 3 && target) {
        encounter.bubbleTargetName = target.name;
        markEmpoweredUse(source, "engineer-bubble", encounter);
        facts.push(`${source.name}'s empowered Arc Toolkit places a one-hit bubble on ${target.name}`);
        addEventNote(notes, target.name, `${source.name} deploys a protection bubble around ${target.name}.`);
        supportEvents.push({ kind: "bubble", source: source.name, target: target.name, amount: 1, label: "Protection Bubble" });
      }
    } else if (classId === "soldier") {
      source._classDoubleAttackReady = true;
      facts.push(`${source.name}'s Heavy Rifle Overdrive primes a second attack`);
      supportEvents.push({ kind: "damage", source: source.name, target: source.name, amount: 0, label: "Heavy Rifle Overdrive" });
    } else if (classId === "tactician") {
      source._classCommandReady = true;
      markCombatCooldown(source, "tactician-command", encounter);
      source._classCommandProtocol = ["assault", "guard", "support"].includes(String(use.protocol || "").toLowerCase())
        ? String(use.protocol).toLowerCase()
        : "assault";
      const protocolLabel = source._classCommandProtocol[0].toUpperCase() + source._classCommandProtocol.slice(1);
      facts.push(`${source.name} selects ${protocolLabel} Protocol`);
      supportEvents.push({ kind: "protocol", source: source.name, target: source.name, amount: 0, label: `${protocolLabel} Protocol` });
    }
    delete state.classAbilityTargets[normalize(source.name)];
    delete state.classAbilityTargetNotices[normalize(source.name)];
    source.abilityNotice = `${classAbilityLabel(classId)} resolved`;
  });
  const pending = Array.isArray(state.pendingAbilityUses) ? state.pendingAbilityUses.splice(0) : [];
  pending.forEach((use) => {
    const source = state.players.find((player) => sameName(player.name, use.sourceName));
    const item = itemForPlayer(use.itemId);
    const ability = itemAbilityDefinition(item);
    if (!source || source.incapacitated || !ability) return;
    if (!encounter && !["heal", "hint"].includes(ability.effect)) return;
    const target = use.targetName
      ? state.players.find((player) => sameName(player.name, use.targetName) && !player.incapacitated)
      : source;
    if (ability.effect === "heal") {
      if (!target) return;
      const before = target.hp;
      healPlayer(target, 4);
      const healed = Math.max(0, target.hp - before);
      facts.push(`${source.name}'s ${ability.label} restores ${target.name}`);
      supportEvents.push({ kind: "heal", source: source.name, target: target.name, amount: healed, hpAfter: target.hp, maxHp: target.maxHp, label: ability.label });
      addEventNote(notes, target.name, `${source.name}'s ${ability.label} restores ${healed} HP.`);
    } else if (ability.effect === "damage") {
      source._itemAbilityDamageBonus = Math.max(0, Number(source._itemAbilityDamageBonus) || 0) + 4;
      facts.push(`${source.name}'s ${ability.label} arms a bonus combat strike`);
      supportEvents.push({ kind: "damage", source: source.name, target: source.name, amount: 4, label: ability.label });
    } else if (ability.effect === "guard") {
      source._itemAbilityGuard = true;
      facts.push(`${source.name}'s ${ability.label} braces the next incoming hit`);
      supportEvents.push({ kind: "guard", source: source.name, target: source.name, amount: 4, label: ability.label });
    } else if (ability.effect === "disrupt") {
      disruptionCount += 1 + itemBonus(source, "disruption");
      facts.push(`${source.name}'s ${ability.label} primes an enemy disruption`);
      supportEvents.push({ kind: "disrupt", source: source.name, target: source.name, amount: 1, label: ability.label });
    } else if (ability.effect === "hint") {
      const info = currentQuestionInfo();
      const answer = String(info.question?.answerText || "").trim();
      state.classHints[state.currentQuestion] = answer ? `${source.name}'s ${ability.label} reveals a clue beginning with “${answer.slice(0, 1).toUpperCase()}”.` : `${source.name}'s ${ability.label} highlights the active prompt.`;
      facts.push(`${source.name}'s ${ability.label} sharpens the active prompt`);
      supportEvents.push({ kind: "hint", source: source.name, target: source.name, amount: 1, label: ability.label });
    }
    source.abilityNotice = `${ability.label} resolved`;
  });
  return disruptionCount;
}

function supportEventStatusLog(events = []) {
  return events.filter(Boolean).map((event) => {
    if (event.kind === "heal" || event.kind === "regen") return `${event.source}'s ${event.label} restores ${event.target} for ${event.amount} HP.`;
    if (event.kind === "hint") return `${event.source} uses ${event.label}; a clue is added to the prompt.`;
    if (event.kind === "guard") return `${event.source} arms ${event.label}; all incoming damage is blocked this turn.`;
    return `${event.source} uses ${event.label}.`;
  }).join(" ");
}

function bankCombatXp(encounter, player, amount) {
  if (!encounter || !player || amount <= 0) return;
  encounter.pendingXp = encounter.pendingXp || {};
  const key = normalize(player.name);
  encounter.pendingXp[key] = Math.max(0, Number(encounter.pendingXp[key]) || 0) + amount;
}

function applyCombatVictoryXp(encounter) {
  if (!encounter?.cleared || encounter.xpApplied) return;
  encounter.xpApplied = true;
  for (const player of state.players) {
    const amount = Math.max(0, Number(encounter.pendingXp?.[normalize(player.name)]) || 0);
    if (amount) combatSystem.addXp?.(player, amount);
  }
  encounter.pendingXp = {};
}

function applyCombatEncounter(entries, type, operator, question) {
  const encounter = currentCombatEncounter();
  if (!encounter) return applyDeviceTeamEncounter(entries, type);
  const roundStartPlayers = state.combatXpBaseline.length
    ? state.combatXpBaseline.map((player) => ({ ...player }))
    : state.players.map((player) => ({ name: player.name, xp: player.xp, level: player.level }));
  state.combatXpBaseline = [];
  encounter.round += 1;
  const roundStartEnemies = encounter.enemies.map((enemy) => ({ id: enemy.id, hp: enemy.hp, maxHp: enemy.maxHp, defeated: enemy.defeated }));
  const notes = bleedTick();
  const roundStartVitals = state.players.map((player) => ({
    name: player.name,
    hp: Math.max(0, Number(player.hp) || 0),
    maxHp: Math.max(10, Number(player.maxHp) || 10),
    status: [...(player.status || [])],
    incapacitated: Boolean(player.incapacitated)
  }));
  const facts = [];
  const combatSupportEvents = [];
  clearCombatAbilityMarkers();
  encounter.tacticianGuardAmount = 0;
  let disrupted = applyPendingCombatAbilities(encounter, notes, facts, combatSupportEvents);
  const attacks = entries.filter((entry) => entry.correct && entry.player && !entry.player.incapacitated)
    .sort((a, b) => pointTimestamp(a.submittedAt) - pointTimestamp(b.submittedAt));
  const doubleAttackers = new Set(attacks
    .filter((entry) => entry.player._classDoubleAttackReady && entry.player.classId === "soldier" && Number(entry.player.level) >= 3 && Number(entry.player.answerStreak) >= 3)
    .map((entry) => normalize(entry.player.name)));
  doubleAttackers.forEach((name) => {
    const player = attacks.find((entry) => normalize(entry.player.name) === name)?.player;
    if (player) markEmpoweredUse(player, "soldier-double", encounter);
  });
  if (doubleAttackers.size) facts.push(`${[...doubleAttackers].join(", ")} trigger an empowered second attack`);
  state.players
    .filter((player) => player._classDoubleAttackReady && player.classId === "soldier")
    .filter((player) => !doubleAttackers.has(normalize(player.name)))
    .forEach((player) => {
      const response = entries.find((entry) => entry.player && sameName(entry.player.name, player.name));
      const reason = response?.correct ? "the required answer streak was not maintained" : "the answer was incorrect";
      player.abilityNotice = `Heavy Rifle Overdrive spent: ${reason}; cooldown active.`;
      facts.push(`${player.name}'s Heavy Rifle Overdrive is spent because ${reason}; no attack is released`);
    });
  const tactician = attacks.find((entry) => entry.player._classCommandReady && entry.player.classId === "tactician");
  const tacticianProtocol = String(tactician?.player?._classCommandProtocol || "assault").toLowerCase();
  const tacticianCommand = tactician && attacks.length >= 2 && tacticianProtocol === "assault";
  const tacticianBonus = tacticianCommand ? (Number(tactician.player.level) >= 3 ? 2 : 1) : 0;
  if (tactician && tacticianProtocol === "guard") {
    encounter.tacticianGuardAmount = Number(tactician.player.level) >= 3 ? 3 : 2;
    facts.push(`${tactician.player.name}'s ${Number(tactician.player.level) >= 3 ? "empowered " : ""}Guard Protocol prepares a ${encounter.tacticianGuardAmount}-point team barrier`);
    combatSupportEvents.push({ kind: "guard", source: tactician.player.name, target: "team", amount: encounter.tacticianGuardAmount, label: "Guard Protocol" });
  } else if (tactician && tacticianProtocol === "support") {
    const supportTarget = activePlayers().filter((player) => !player.incapacitated && player.hp < player.maxHp).sort((a, b) => a.hp - b.hp)[0];
    if (supportTarget) {
      const before = supportTarget.hp;
      healPlayer(supportTarget, Number(tactician.player.level) >= 3 ? 4 : 2);
      const healed = Math.max(0, supportTarget.hp - before);
      if (healed) {
        facts.push(`${tactician.player.name}'s Support Protocol stabilizes ${supportTarget.name}`);
        combatSupportEvents.push({ kind: "heal", source: tactician.player.name, target: supportTarget.name, amount: healed, hpAfter: supportTarget.hp, maxHp: supportTarget.maxHp, label: "Support Protocol" });
        addEventNote(notes, supportTarget.name, `${tactician.player.name}'s Support Protocol restores ${healed} HP.`);
      }
    } else {
      facts.push(`${tactician.player.name}'s Support Protocol finds no injured operator`);
    }
  }
  if (tacticianCommand) {
    markEmpoweredUse(tactician.player, "tactician-command", encounter);
    facts.push(`${tactician.player.name}'s ${Number(tactician.player.level) >= 3 ? "empowered " : ""}command protocol coordinates the correct responders`);
  } else if (tactician) {
    facts.push(`${tactician.player.name}'s ${tacticianProtocol} protocol resolves without a coordination bonus`);
  }
  const attackQueue = attacks.flatMap((entry) => [entry, ...(doubleAttackers.has(normalize(entry.player.name)) ? [{ ...entry, empoweredFollowUp: true }] : [])]);
  const attackResults = [];
  for (const entry of attackQueue) {
    const damage = combatPlayerDamage(entry, question, type) + tacticianBonus;
    const target = encounter.enemies.find((enemy) => !enemy.defeated) || null;
    const targetHpBefore = target?.hp || 0;
    const groupHpBefore = encounter.hp;
    const enemyStatesBefore = encounter.enemies.map((enemy) => ({ id: enemy.id, hp: enemy.hp }));
    const applied = combatSystem.applyGroupDamage(encounter, damage);
    attackResults.push({
      player: entry.player,
      damage: applied.damage,
      empowered: Boolean(entry.empoweredFollowUp || (tacticianCommand && Number(tactician.player.level) >= 3)),
      doubleAttack: Boolean(entry.empoweredFollowUp),
      aoe: Boolean(type.locked),
      defeated: applied.defeated,
      targetId: target?.id || "",
      targetLabel: target?.label || "hostile line",
      targetMaxHp: target?.maxHp || 1,
      targetHpBefore,
      targetHpAfter: target?.hp || 0,
      enemyStatesBefore,
      enemyStatesAfter: encounter.enemies.map((enemy) => ({ id: enemy.id, hp: enemy.hp, maxHp: enemy.maxHp, defeated: enemy.defeated })),
      groupHpBefore,
      groupHpAfter: encounter.hp
    });
    if (applied.defeated.length) bankCombatXp(encounter, entry.player, 2 * applied.defeated.length);
    if (applied.cleared) break;
  }
  for (const entry of entries.filter((entry) => !entry.correct && entry.player && !entry.player.incapacitated)) {
    const backlash = Math.max(0, itemRisk(entry.player, "selfDamageOnMiss"));
    if (backlash) {
      applyDamage(entry.player, backlash, "risk item backlash");
      addEventNote(notes, entry.player.name, `${entry.player.name}'s risk item backfires for ${backlash} damage.`);
    }
  }
  encounter.cleared = encounter.hp <= 0;
  if (encounter.cleared && encounter.roomType === "boss" && !encounter.victoryXpAwarded) {
    encounter.victoryXpAwarded = true;
    for (const player of activePlayers()) bankCombatXp(encounter, player, 5);
    facts.push("Boss-victory experience is banked until the combat is fully resolved");
  }
  preserveUnusedCombatQuestions(state.nodes[state.currentNode], encounter);
  let totalDamage = 0;
  const enemyActions = [];
  const lockedSuppression = Boolean(type.locked && operator && entries.some((entry) => entry.player && sameName(entry.player.name, operator.name) && entry.correct));
  if (!encounter.cleared && lockedSuppression) {
    facts.push(`${operator.name}'s locked-operator sweep suppresses the entire hostile counterattack`);
  } else if (!encounter.cleared && !state.selectedEMS) {
    enemyPhase:
    for (const enemy of encounter.enemies.filter((entry) => !entry.defeated)) {
      const tier = combatSystem.enemyTiers?.[enemy.tier] || combatSystem.enemyTiers?.light;
      const activations = Math.max(1, Number(enemy.activations) || 1);
      for (let activation = 0; activation < activations; activation += 1) {
        if (!activePlayers().length) break enemyPhase;
        if (disrupted > 0) {
          disrupted -= 1;
          enemyActions.push({ enemy, disrupted: true, targets: [] });
          continue;
        }
        const targets = combatTargetsForActivation(entries, type, operator);
        const aoe = type.kind === "team";
        const amount = combatSystem.rollRange?.(aoe ? tier.aoeDamage : tier.damage, state.rng) || 1;
        const hits = targets.map((target) => {
          const braceEntry = combatBraceEntry(entries, type, operator, target);
          // A correct answer always puts that operator in a braced state. If
          // the targeting rules select a wrong responder, they remain fully
          // vulnerable instead.
          const braced = Boolean(braceEntry?.correct);
          const braceMitigation = braced ? combatBraceMitigation(braceEntry, type) : 0;
          const commandGuard = Math.max(0, Number(encounter.tacticianGuardAmount) || 0);
          const mitigatedAmount = braced
            ? Math.round(amount * (1 - braceMitigation))
            : Math.max(0, amount - commandGuard);
          let blocked = braced && mitigatedAmount <= 0;
          const targetAmount = blocked ? 0 : Math.max(0, mitigatedAmount);
          if (target.classId === "enforcer" && amount > targetAmount) addEnforcerReserve(target, amount - targetAmount);
          if (braced) facts.push(`${target.name} braces, mitigating ${Math.round(braceMitigation * 100)}% of the incoming attack`);
          else if (commandGuard) facts.push(`${target.name} is covered by Guard Protocol, reducing the incoming attack by ${commandGuard}`);
          if (blocked) facts.push(`${target.name} braces and blocks the area attack`);
          const hpBefore = target.hp;
          const damage = applyCombatDamage(target, targetAmount, "combat", notes, facts, encounter);
          const combatBlocked = Boolean(target._combatBlocked);
          const redirected = target._combatRedirect || null;
          const bubbleBlocked = Boolean(target._combatBubble);
          blocked = blocked || bubbleBlocked;
          blocked = blocked || combatBlocked;
          delete target._combatBlocked;
          delete target._combatRedirect;
          delete target._combatBubble;
          return { target, braced, braceMitigation, blocked, bubbleBlocked, redirected, damage, hpBefore, hpAfter: target.hp };
        });
        totalDamage += hits.reduce((sum, hit) => sum + hit.damage + (hit.redirected?.damage || 0), 0);
        enemyActions.push({ enemy, aoe, amount, targets: hits });
      }
    }
  } else if (!encounter.cleared && state.selectedEMS) {
    facts.push("The armed EMS field absorbs the enemy phase");
  }
  state.selectedEMS = false;
  const defeatedCount = attackResults.reduce((sum, attack) => sum + attack.defeated.length, 0);
  const attackSummary = attackResults.length
    ? `${attackResults.map((attack) => attack.player.name).join(", ")} drive fire into the hostile line${defeatedCount ? ` and drop ${defeatedCount} attacker${defeatedCount === 1 ? "" : "s"}` : ""}`
    : "The squad fails to break the hostile line";
  const hostileCountered = enemyActions.some((action) => !action.disrupted);
  const narration = encounter.cleared
    ? `${attackSummary}. The last hostile signal collapses and the route clears.`
    : `${attackSummary}. ${hostileCountered ? "The surviving hostiles answer with a coordinated counterattack." : "The enemy counterattack is completely disrupted."}`;
  const down = state.players.filter((player) => player.incapacitated);
  const combatStatusLines = [
    ...combatSupportEvents.map((event) => event.kind === "heal" || event.kind === "regen"
      ? `${event.source}'s ${event.label} restores ${event.target} for ${event.amount} HP.`
      : event.kind === "guard"
        ? `${event.source} arms ${event.label}; all incoming damage is blocked this turn.`
        : `${event.source} uses ${event.label}${event.target && event.target !== event.source ? ` on ${event.target}` : ""}.`),
    ...attackResults.map((attack) => `${attack.player.name}${attack.empowered ? " uses an empowered ability and" : " attacks"} ${attack.targetLabel} for ${attack.damage} damage${attack.defeated.length ? ` — KILLING BLOW (${attack.defeated.map((enemy) => enemy.label).join(", ")})` : ""}.`),
    ...(lockedSuppression ? [`${operator.name}'s area attack suppresses every enemy activation.`] : []),
    ...enemyActions.flatMap((action) => action.disrupted
      ? [`${action.enemy.label}'s attack is disrupted.`]
      : action.targets.map((hit) => hit.redirected
        ? `${hit.target.name}'s fatal damage is redirected to ${hit.redirected.target.name} by RRR at half strength.`
        : hit.bubbleBlocked
          ? `${hit.target.name}'s Engineer bubble absorbs ${action.enemy.label}'s attack.`
          : hit.blocked
            ? `${hit.target.name} braces and blocks ${action.enemy.label}'s attack.`
            : `${action.enemy.label} attacks ${hit.target.name} for ${hit.damage} damage${hit.braced ? ` after bracing (${Math.round(hit.braceMitigation * 100)}% mitigated)` : ""}.`))
  ];
  encounter.lastRound = { round: encounter.round, attackResults, enemyActions, supportEvents: combatSupportEvents, totalDamage, defeatedCount, roundStartEnemies, combatStatusLines, challengeKind: type.kind };
  facts.push(`Private mechanics: combat round ${encounter.round}; hostile pool ${encounter.hp}/${encounter.maxHp}; player attacks ${attackResults.map((attack) => `${attack.player.name} ${attack.damage}`).join(", ") || "none"}; enemy damage ${totalDamage}. Narrate physical outcomes without numbers.`);
  return {
    narration,
    loot: "",
    lootStatus: "",
    lootFact: "",
    incapacitated: down.length ? `${down.map((player) => player.name).join(", ")} cannot answer until revived.` : "",
    eventNotes: notes,
    factSeed: facts.join("; "),
    combat: true,
    combatCleared: encounter.cleared,
    teamDefeated: !activePlayers().length,
    encounter,
    attackResults,
    enemyActions,
    lockedSuppression,
    roundStartEnemies,
    roundStartVitals,
    roundStartPlayers,
    combatPlayerResults: entries.map((entry) => ({ name: entry.player.name, correct: Boolean(entry.correct) })),
    combatSupportEvents,
    combatAbilityEvents: facts.filter((fact) => /empowered|upgraded|bubble|command protocol|Surgical Kit|Arc Toolkit|Ballistic Shield|R&R|RRR/.test(fact)),
    combatStatusLog: combatStatusLines.join("\n")
  };
}

function fallbackActionRoomEntities(room, index = state.currentNode) {
  if (typeof actionRooms.fallbackEntities === "function") {
    return actionRooms.fallbackEntities(room, index, { threat: state.threat || "hostile presence" });
  }
  return [
    makeRoomEntity(`${index}_route_exit_0`, "Route access point", "route", ["exit", "route", "secure"], { state: "blocked", progress: 0, threshold: 2 }),
    makeRoomEntity(`${index}_ambient_hazard_1`, "unstable room hazard", "hazard", ["hazard", "dangerous", "contact-danger"], { state: "active", pressure: 2, mitigation: 0, threshold: 3 })
  ];
}

function makeRoomEntity(id, label, type, tags = [], extra = {}) {
  const role = normalizeEnemyRole(extra.role, type, tags);
  const cleanTags = [...new Set([...asArray(tags), role].filter((tag) => tag && tag !== "none"))];
  return {
    id,
    label,
    type,
    role,
    tags: cleanTags,
    state: extra.state || "available",
    usesRemaining: Number.isFinite(Number(extra.usesRemaining)) ? Number(extra.usesRemaining) : type === "object" ? 1 : null,
    hp: Number.isFinite(Number(extra.hp)) ? Number(extra.hp) : null,
    maxHp: Number.isFinite(Number(extra.maxHp)) ? Number(extra.maxHp) : null,
    armor: Number.isFinite(Number(extra.armor)) ? Number(extra.armor) : 0,
    pressure: Number.isFinite(Number(extra.pressure)) ? Number(extra.pressure) : type === "enemy" || type === "hazard" ? 2 : 0,
    mitigation: Number.isFinite(Number(extra.mitigation)) ? Number(extra.mitigation) : 0,
    progress: Number.isFinite(Number(extra.progress)) ? Number(extra.progress) : 0,
    threshold: Number.isFinite(Number(extra.threshold)) ? Number(extra.threshold) : 0,
    vulnerabilities: asArray(extra.vulnerabilities),
    exhausted: Boolean(extra.exhausted),
    neutralized: Boolean(extra.neutralized),
    earlyBossBoosted: Boolean(extra.earlyBossBoosted),
    engagedWith: extra.engagedWith || ""
  };
}

function normalizeEnemyRole(value, type = "", tags = []) {
  if (type !== "enemy") return "none";
  const text = normalize(`${value || ""} ${asArray(tags).join(" ")}`).replace(/\s+/g, "_");
  if (/\bfinal_boss\b/.test(text)) return "final_boss";
  if (/\bpersistent_threat_avatar\b/.test(text)) return "persistent_threat_avatar";
  if (/\bpersistent_threat_minion\b/.test(text)) return "persistent_threat_minion";
  if (/\broom_threat\b/.test(text)) return "room_threat";
  return "room_threat";
}

function actionRoomAreaName(room, index = state.currentNode) {
  const pools = {
    normal: ["Service Gallery", "Access Spine", "Broken Transit Hall"],
    hazard: ["Flooded Switchgear", "Arc-Fault Corridor", "Pressure Leak Junction"],
    repair: ["Damaged Relay Bay", "Generator Service Deck", "Control Rebuild Station"],
    enemy: ["Contact Hall", "Security Kill Lane", "Maintenance Ambush Point"],
    escape: ["Lockdown Chamber", "Collapsing Service Route", "Sealing Blast Corridor"],
    dialogue: ["Survivor Post", "Command Echo Room", "Interrogation Alcove"],
    resource: ["Supply Cage", "Emergency Cache", "Salvage Locker"],
    puzzle: ["Route Logic Chamber", "Valve Sequencing Room", "Relay Pattern Vault"],
    stealth: ["Listening Corridor", "Dark Patrol Route", "Sensor Blind Hall"],
    defense: ["Barricade Junction", "Holdout Platform", "Beacon Defense Point"],
    question: ["Riddle Terminal", "Archive Challenge Room", "Encrypted Shrine"],
    extraction: ["Extraction Threshold", "Final Egress Gate", "Signal Evac Point"]
  };
  const list = pools[room.kind] || pools.normal;
  return list[index % list.length];
}

function isBossQuestion(index, total) {
  return Boolean(bossGroupForQuestion(index, total));
}

function bossQuestionGroups(total) {
  if (total < 1) return [];
  const finalSize = Math.min(FINAL_BOSS_QUESTIONS, total);
  const finalStart = total - finalSize;
  const groups = [{
    id: "final",
    phase: "final",
    start: finalStart,
    end: total - 1,
    questionIndexes: range(finalStart, total - 1)
  }];

  if (total >= TWO_BOSS_MIN_QUESTIONS) {
    const middleSize = MID_BOSS_QUESTIONS;
    const centeredStart = Math.floor(total / 2) - Math.floor(middleSize / 2);
    const middleStart = Math.max(1, Math.min(centeredStart, finalStart - middleSize));
    groups.unshift({
      id: "mid",
      phase: "mid",
      start: middleStart,
      end: middleStart + middleSize - 1,
      questionIndexes: range(middleStart, middleStart + middleSize - 1)
    });
  }

  return groups;
}

function bossGroupForQuestion(index, total = state.questions.length || 0) {
  return bossQuestionGroups(total).find((group) => index >= group.start && index <= group.end) || null;
}

function range(start, end) {
  const values = [];
  for (let index = start; index <= end; index++) values.push(index);
  return values;
}

function beginNextNode() {
  roomTransitionTraceEmit("MARK", "begin next node", {
    combatResolving: Boolean(els.combatStage?.classList.contains("resolving")),
    combatExiting: Boolean(els.combatStage?.classList.contains("exiting"))
  });
  if (!els.combatStage?.hidden && (els.combatStage.classList.contains("resolving") || els.combatStage.classList.contains("exiting"))) {
    if (!state.combatNextNodeWaitStartedAt) state.combatNextNodeWaitStartedAt = Date.now();
    if (Date.now() - state.combatNextNodeWaitStartedAt >= COMBAT_GATE_MAX_WAIT_MS) {
      recoverCombatPresentationGate("next-room transition");
    } else {
      roomTransitionTraceEmit("WAIT", "combat presentation gate", {
        waitedMs: Date.now() - state.combatNextNodeWaitStartedAt
      });
      if (!state.combatNextNodeTimer) {
        state.combatNextNodeTimer = window.setTimeout(() => {
          state.combatNextNodeTimer = null;
          beginNextNode();
        }, 400);
      }
      return;
    }
  }
  state.combatNextNodeWaitStartedAt = 0;
  state.combatMountBlocked = false;
  renderMap();
  renderStatus();

  if (state.currentNode >= state.nodes.length) {
    renderEnding();
    return;
  }

  const node = state.nodes[state.currentNode];
  roomTransitionTraceEmit("MARK", "next node selected", {
    nodeIndex: state.currentNode,
    nodeType: node?.type || "",
    nodeLabel: node?.label || ""
  });
  if (node.type === "recovery") {
    renderRecovery(node);
    return;
  }

  if (state.chatMode) {
    if (state.briefingReady) renderChatCheckpoint(node);
    else state.pendingChatNode = node;
    return;
  }

  renderChallenge(node);
}

function renderBriefing() {
  state.briefingReady = false;
  state.pendingChatNode = null;

  if (state.chatMode) {
    renderAiBriefing();
    return;
  }

  const briefing = fallbackBriefing();
  state.currentBriefing = briefing;
  state.openingLogStory = missionBriefingLogStory(briefing, openingScene());
  completeDeploymentSequence().then((active) => {
    if (active) finishBriefing();
  });
}

function renderAiBriefing() {
  startOpeningWaitCounter();
  const briefingPromise = state.localDmMode
    ? loadLocalDmBriefing()
    : withTimeout(loadDmBriefing(), 30000, fallbackBriefing());
  briefingPromise.then((briefing) => {
    if (briefing.title) {
      state.title = briefing.title;
      els.mapTitle.textContent = briefing.title;
    }
    state.currentBriefing = briefing;

    const sections = [
      ["Situation", briefing.situation],
      ["Objective", briefing.objective],
      ["Route", briefing.route],
      ["Rules of Engagement", briefing.engagement]
    ].filter((section) => section[1]);

    const sectionHtml = sections.map(([label, text]) => `
      <section class="briefing-section">
        <h3>${escapeHtml(label)}</h3>
        <p class="typewriter" data-text="${escapeAttribute(text)}"></p>
      </section>
    `).join("");

    els.briefingCard.innerHTML = `
      <p class="eyebrow">Mission Briefing</p>
      <h2 class="mission-title">${escapeHtml(briefing.title || state.title)}</h2>
      <div id="briefingBody" class="briefing-body">
        ${briefing.subtitle ? `<p class="briefing-kicker typewriter" data-text="${escapeAttribute(briefing.subtitle)}"></p>` : ""}
        <div class="briefing-sections">
          ${sectionHtml}
        </div>
      </div>
    `;

    const introPromise = state.localDmMode
      ? (startOpeningWaitCounter(), loadLocalOpeningIntro(briefing))
      : Promise.resolve(fallbackOpeningIntro(briefing));

    Promise.all([completeDeploymentSequence(), introPromise]).then(([active, intro]) => {
      state.openingLogStory = missionBriefingLogStory(briefing, intro);
      if (active) finishBriefing();
    });
  });
}

function withTimeout(promise, ms, fallback) {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(fallback), ms);
    promise
      .then((value) => {
        window.clearTimeout(timer);
        resolve(value);
      })
      .catch(() => {
        window.clearTimeout(timer);
        resolve(fallback);
      });
  });
}

function loadLocalDmBriefing() {
  const fallback = fallbackBriefing();
  return requestOllama(makeLocalBriefingPrompt(), { temperature: 0.82, format: "json" })
    .then((text) => parseLocalBriefing(text, fallback))
    .catch(() => fallback);
}

function makeLocalBriefingPrompt() {
  return dmPrompts.makeMissionBriefingPrompt({
    fieldLength: narrationSentenceRange("1-2 sentences", "1 sentence"),
    actionDrivenMode: state.actionDrivenMode,
    missionType: state.missionType,
    environment: state.environment,
    threat: state.threat,
    threatProfile: compactThreatProfileText(),
    teamSize: state.players.length
  });
}

function parseLocalBriefing(text, fallback) {
  try {
    const parsed = JSON.parse(extractJsonPayload(text));
    const title = cleanOperationTitle(parsed.title) || fallback.title;
    applyGeneratedThreatDetails(parsed.threatDetails);
    applyGeneratedBossAreas(parsed.bossAreas);
    logDebugEvent({
      kind: "response",
      label: "Briefing parsed",
      detail: `${title}${parsed.threatDetails ? " / threat details stored" : " / no generated threat details"}${parsed.bossAreas ? " / boss areas stored" : ""}`
    });
    return {
      title,
      subtitle: cleanBriefingField(parsed.subtitle) || fallback.subtitle,
      situation: cleanBriefingField(parsed.situation) || fallback.situation,
      objective: cleanBriefingField(parsed.objective) || fallback.objective,
      route: cleanBriefingField(parsed.route) || fallback.route,
      engagement: cleanBriefingField(parsed.engagement) || fallback.engagement
    };
  } catch (error) {
    logDebugEvent({
      kind: "error",
      label: "Briefing fallback",
      detail: `Could not parse local briefing JSON: ${error.message || error}`
    });
    return fallback;
  }
}

function extractJsonPayload(text) {
  const value = String(text || "").trim();
  const fenced = value.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) return fenced[1].trim();
  if (value.startsWith("{") && value.endsWith("}")) return value;

  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  if (start >= 0 && end > start) return value.slice(start, end + 1).trim();
  return value;
}

function applyGeneratedThreatDetails(details) {
  if (!details || typeof details !== "object" || !state.threatProfile) return;
  const generated = {
    manifestation: cleanBriefingField(details.manifestation),
    signs: cleanBriefingField(details.signs),
    tactics: cleanBriefingField(details.tactics),
    escalation: cleanBriefingField(details.escalation),
    confrontation: cleanBriefingField(details.confrontation),
    weakness: cleanBriefingField(details.weakness)
  };
  if (!Object.values(generated).some(Boolean)) return;
  state.threatProfile.generated = generated;
}

function applyGeneratedBossAreas(areas) {
  if (!areas || typeof areas !== "object") return;
  const mid = cleanBossAreaName(areas.mid);
  const final = cleanBossAreaName(areas.final);
  if (mid) state.bossAreaNames.mid = mid;
  if (final) state.bossAreaNames.final = final;
}

function cleanBossAreaName(value) {
  const cleaned = cleanBriefingField(value)
    .replace(/^operation\s+/i, "")
    .replace(/[.!?]+$/g, "")
    .trim();
  if (!cleaned) return "";
  return cleaned
    .split(/\s+/)
    .slice(0, 5)
    .join(" ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .slice(0, 44);
}

function cleanOperationTitle(value) {
  const compact = cleanBriefingField(value).replace(/[.!?]+$/, "");
  if (!compact) return "";
  const operation = /^operation\b/i.test(compact) ? compact : `OPERATION ${compact}`;
  return operation.toUpperCase().slice(0, 52);
}

function cleanBriefingField(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function loadDmBriefing() {
  return fetchWithTimeout(`dm-briefing.json?ts=${Date.now()}`, { cache: "no-store" })
    .then((response) => response.ok ? response.json() : fallbackBriefing())
    .catch(fallbackBriefing);
}

function fallbackBriefing() {
  return {
    title: state.title,
    subtitle: "Training run initialized. The squad is entering an unstable facility under emergency conditions.",
    situation: openingScene(),
    objective: "Move room by room through the facility, answer each challenge, and keep the team operational until the final system is restored.",
    route: "The map marks the current room, recovery points, boss contacts, and the final gate.",
    engagement: "Answer only the active challenge. Use Medkits and EMS Devices when the team chooses to spend them. Maintain team status, preserve supplies, and keep moving until the mission is complete."
  };
}

function loadLocalOpeningIntro(briefing) {
  return requestOllama(makeLocalOpeningIntroPrompt(briefing), { temperature: 0.82 })
    .then((text) => sanitizeText(text, { fallback: fallbackOpeningIntro(briefing), maxLength: 1200, preserveNewlines: true }))
    .catch(() => fallbackOpeningIntro(briefing));
}

function makeLocalOpeningIntroPrompt(briefing) {
  return [
    `Write one player-facing opening paragraph, ${narrationSentenceRange("3-5", "2-3")} sentences.`,
    "Output only narration: no labels, checklist, analysis, or restated instructions.",
    "Blend the briefing situation with cinematic mission-opening flair for the whole operation.",
    "No study terms, answers, choices, HP, dice, mechanics, first-room names, or first-topic hints.",
    "Anchor on environment, threat, weather/architecture, route danger, and stakes.",
    "End with the team needing to confirm readiness.",
    `Existing situation to merge and improve: ${briefing?.situation || openingScene()}.`,
    `Operation: ${briefing?.title || state.title}.`,
    `Mission style: ${state.missionType}.`,
    `Environment: ${state.environment}.`,
    `Threat: ${state.threat}; ${compactThreatProfileText()}.`
  ].join("\n");
}

function fallbackOpeningIntro(briefing) {
  return `Rain hammers the approach road as the squad reaches ${state.environment}, and the last line of the briefing fades beneath the sound of water striking concrete and steel. Inside, the air tastes like hot dust and old batteries while emergency strips cast long, trembling shadows over conduit, blast doors, and dead monitors. A low vibration moves through the structure from somewhere deep in the route, turning every rail, cable tray, and sealed hatch into part of the same warning. The squad can hear ${state.threat} threaded through the emergency speakers, close enough to bend the audio but not close enough to name. Dust hangs in the flashlight beams and seems to warp around the cabling as the route display paints a narrow path through the dark. The team has one clean moment to confirm readiness before committing to the operation.`;
}

function missionBriefingLogStory(briefing, intro) {
  const situation = combineOpeningSituation(briefing?.situation, intro);
  const lines = [
    briefing?.subtitle,
    situation ? `Situation: ${situation}` : "",
    briefing?.objective ? `Objective: ${briefing.objective}` : "",
    briefing?.route ? `Route: ${briefing.route}` : "",
    briefing?.engagement ? `Rules of Engagement: ${briefing.engagement}` : ""
  ].filter(Boolean);
  return lines.join("\n\n");
}

function missionBriefingSpeechText(briefing, story) {
  const situation = extractBriefingStorySection(story, "Situation")
    || cleanBriefingField(briefing?.situation);
  return situation.replace(/^Situation:\s*/i, "").trim();
}

function extractBriefingStorySection(story, label) {
  const value = String(story || "");
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = value.match(new RegExp(`${escapedLabel}:\\s*([\\s\\S]*?)(?:\\n\\s*\\n\\s*(?:Objective|Route|Rules of Engagement):|$)`, "i"));
  return cleanBriefingField(match?.[1] || "");
}

function combineOpeningSituation(situation, intro) {
  const cleanSituation = cleanBriefingField(situation).replace(/^Situation:\s*/i, "");
  const cleanIntro = cleanBriefingField(intro).replace(/^Situation:\s*/i, "");
  if (!cleanIntro) return cleanSituation;
  if (!cleanSituation) return cleanIntro;
  if (normalize(cleanIntro).includes(normalize(cleanSituation).slice(0, 80))) return cleanIntro;
  return cleanIntro;
}

function finishBriefing() {
  stopOpeningWaitCounter();
  state.briefingReady = true;
  releaseBriefingNode();
}

function releaseBriefingNode() {
  if (!state.chatMode || !state.pendingChatNode) return;
  const node = state.pendingChatNode;
  state.pendingChatNode = null;
  renderChatCheckpoint(node);
}

function clearSetupToDeploymentTransition() {
  for (const timer of state.setupTransitionTimers) window.clearTimeout(timer);
  state.setupTransitionTimers = [];
  document.body.classList.remove(
    "setup-to-deployment",
    "setup-blackout-active",
    "dashboard-exiting",
    "dashboard-returning"
  );
  if (!els.setupTransitionBlackout) return;
  els.setupTransitionBlackout.classList.remove("visible", "handoff", "dashboard-return");
  els.setupTransitionBlackout.hidden = true;
  if (els.setupTransitionLabel) els.setupTransitionLabel.textContent = "MISSION CHANNEL TRANSFER";
}

function startDashboardToSetupTransition() {
  if (!els.setupTransitionBlackout || document.body.classList.contains("dashboard-exiting")) {
    performMissionReset();
    return;
  }

  clearSetupToDeploymentTransition();
  stopTts();
  playGameSfx("ui");
  document.body.classList.add("dashboard-exiting", "setup-blackout-active");
  els.setupTransitionBlackout.hidden = false;
  els.setupTransitionBlackout.classList.add("dashboard-return");
  if (els.setupTransitionLabel) els.setupTransitionLabel.textContent = "RETURNING TO MISSION PREP";

  window.requestAnimationFrame(() => {
    if (document.body.classList.contains("dashboard-exiting")) {
      els.setupTransitionBlackout.classList.add("visible");
    }
  });

  const resetTimer = window.setTimeout(() => {
    state.setupTransitionTimers = state.setupTransitionTimers.filter((timer) => timer !== resetTimer);
    performMissionReset({ preserveTransition: true });
    document.body.classList.remove("dashboard-exiting");
    document.body.classList.add("dashboard-returning");
    els.setupTransitionBlackout.classList.add("handoff");

    const revealTimer = window.setTimeout(() => {
      state.setupTransitionTimers = state.setupTransitionTimers.filter((timer) => timer !== revealTimer);
      clearSetupToDeploymentTransition();
    }, 900);
    state.setupTransitionTimers.push(revealTimer);
  }, 920);
  state.setupTransitionTimers.push(resetTimer);
}

function syncLiveConsoleScale() {
  const viewport = window.visualViewport;
  const viewportWidth = viewport?.width || window.innerWidth;
  const viewportHeight = viewport?.height || window.innerHeight;
  const safeWidth = Math.max(320, viewportWidth - 32);
  const safeHeight = Math.max(320, viewportHeight - 72);
  const scale = Math.min(safeWidth / 1700, safeHeight / 960);
  document.documentElement.style.setProperty("--live-console-scale", String(Math.max(0.35, scale)));
}

function mountLiveMissionStrip() {
  const mount = document.getElementById("liveMissionStripMount");
  const strip = document.querySelector(".map-main > .panel-header.compact");
  if (!mount || !strip || strip.parentElement === mount) return;
  strip.classList.add("live-mission-strip");
  mount.appendChild(strip);
}

window.addEventListener("resize", syncLiveConsoleScale, { passive: true });
window.visualViewport?.addEventListener("resize", syncLiveConsoleScale, { passive: true });
window.visualViewport?.addEventListener("scroll", syncLiveConsoleScale, { passive: true });
syncLiveConsoleScale();
mountLiveMissionStrip();

function startSetupToDeploymentTransition() {
  clearSetupToDeploymentTransition();
  if (els.setupTransitionLabel) els.setupTransitionLabel.textContent = "MISSION CHANNEL TRANSFER";
  startDeploymentSequence({ deferReveal: true });
  document.body.classList.add("setup-to-deployment", "setup-blackout-active");
  if (els.setupTransitionBlackout) {
    els.setupTransitionBlackout.hidden = false;
    window.requestAnimationFrame(() => {
      if (state.started) els.setupTransitionBlackout.classList.add("visible");
    });
  }

  const schedule = (delay, callback) => {
    const timer = window.setTimeout(() => {
      state.setupTransitionTimers = state.setupTransitionTimers.filter((entry) => entry !== timer);
      if (!state.started) return;
      callback();
    }, delay);
    state.setupTransitionTimers.push(timer);
  };

  schedule(900, () => {
    syncLiveConsoleScale();
    document.body.classList.add("mission-active");
    els.setupPanel.style.display = "none";
  });
  schedule(1220, () => {
    els.deploymentOverlay.classList.add("deployment-visible");
    playDashboardPanelCue();
    startDeploymentRosterAudio(state.deploymentRunId);
    els.setupTransitionBlackout?.classList.add("handoff");
  });
  schedule(2020, () => {
    if (els.setupTransitionBlackout) {
      els.setupTransitionBlackout.classList.remove("visible", "handoff");
      els.setupTransitionBlackout.hidden = true;
    }
    document.body.classList.remove("setup-to-deployment", "setup-blackout-active");
  });
}

function startDeploymentSequence(options = {}) {
  stopDeploymentSequence();
  state.deploymentRunId += 1;
  state.deploymentStartedAt = Date.now();
  state.deploymentCompletionStartedAt = 0;
  state.deploymentCompletionWait = 0;
  state.deploymentReady = false;
  const runId = state.deploymentRunId;
  document.body.classList.add("session-entering", "dashboard-concealed");
  document.body.classList.remove("session-revealing");
  els.deploymentOverlay.hidden = false;
  els.deploymentOverlay.className = `deployment-overlay theme-${deploymentThemeClass()}`;
  window.requestAnimationFrame(() => {
    if (!options.deferReveal && state.deploymentRunId === runId && state.started) {
      els.deploymentOverlay.classList.add("deployment-visible");
      playDashboardPanelCue();
      startDeploymentRosterAudio(runId);
    }
  });
  els.deploymentTheme.textContent = deploymentThemeLabel();
  els.deploymentTitle.hidden = true;
  els.deploymentTitle.classList.remove("operators-deployed");
  if (els.deploymentReadyMessage) {
    els.deploymentReadyMessage.hidden = false;
    els.deploymentReadyMessage.classList.remove("visible");
    els.deploymentReadyMessage.classList.add("standby");
  }
  const titleStatus = els.deploymentTitle.querySelector("span");
  if (titleStatus) titleStatus.textContent = "SIGNAL ACQUIRED";
  els.deploymentOperation.textContent = state.title || "OPERATION PENDING";
  renderDeploymentRoster();
  renderDeploymentRoute();
  renderDeploymentThreatPings();
  updateDeploymentSequence();
  state.deploymentTimer = window.setInterval(updateDeploymentSequence, 180);
}

function completeDeploymentSequence() {
  if (state.deploymentReady) return Promise.resolve(state.started);
  state.deploymentReady = true;
  const runId = state.deploymentRunId;
  const elapsed = Date.now() - state.deploymentStartedAt;
  const wait = Math.max(0, 5200 - elapsed);
  state.deploymentCompletionStartedAt = Date.now();
  state.deploymentCompletionWait = wait;
  if (els.deploymentFragment) els.deploymentFragment.textContent = "Locking final route telemetry and operator status.";
  return new Promise((resolve) => {
    window.setTimeout(() => {
      if (runId !== state.deploymentRunId || !state.started) {
        resolve(false);
        return;
      }
      if (state.deploymentTimer) window.clearInterval(state.deploymentTimer);
      state.deploymentTimer = null;
      els.deploymentPhase.textContent = "OPERATORS DEPLOYED";
      els.deploymentFragment.textContent = "All operators report ready status. Mission channel opening.";
      if (els.deploymentReadyMessage) {
        els.deploymentReadyMessage.hidden = false;
        window.requestAnimationFrame(() => {
          els.deploymentReadyMessage.classList.remove("standby");
          els.deploymentReadyMessage.classList.add("visible");
          startDeploymentReadyBlinkAudio(runId);
        });
      }
      els.deploymentTitle.hidden = false;
      const titleStatus = els.deploymentTitle.querySelector("span");
      if (titleStatus) titleStatus.textContent = "SIGNAL ACQUIRED";
      els.deploymentOperation.textContent = state.title || "OPERATION PENDING";
      els.deploymentProgressFill.style.width = "100%";
      window.setTimeout(() => {
        if (runId !== state.deploymentRunId || !state.started) {
          resolve(false);
          return;
        }
        stopDeploymentReadyBlinkAudio();
        els.deploymentOverlay.classList.add("deployment-blackout");
        window.setTimeout(() => {
          if (runId !== state.deploymentRunId || !state.started) {
            resolve(false);
            return;
          }
          els.deploymentOverlay.classList.remove("deployment-visible");
          els.deploymentOverlay.classList.add("deployment-fading");
          window.setTimeout(() => {
            if (runId !== state.deploymentRunId || !state.started) {
              resolve(false);
              return;
            }
            stopDeploymentSequence({ preserveDashboardBoot: true });
            runDashboardBootSequence(runId).then(resolve);
          }, 720);
        }, 620);
      }, 2600);
    }, wait);
  });
}

function startDeploymentReadyBlinkAudio(runId) {
  stopDeploymentReadyBlinkAudio();
  const ping = () => {
    if (runId !== state.deploymentRunId || !state.started || !els.deploymentReadyMessage?.classList.contains("visible")) {
      stopDeploymentReadyBlinkAudio();
      return;
    }
    playGameSfx("loot");
  };
  ping();
  state.deploymentReadySfxTimer = window.setInterval(ping, 700);
}

function stopDeploymentReadyBlinkAudio() {
  if (state.deploymentReadySfxTimer) window.clearInterval(state.deploymentReadySfxTimer);
  state.deploymentReadySfxTimer = null;
}

function startDeploymentRosterAudio(runId) {
  stopDeploymentRosterAudio();
  state.players.forEach((player, index) => {
    const timer = window.setTimeout(() => {
      state.deploymentRosterSfxTimers = state.deploymentRosterSfxTimers.filter((entry) => entry !== timer);
      if (runId !== state.deploymentRunId || !state.started || !els.deploymentOverlay.classList.contains("deployment-visible")) return;
      playDeploymentOperatorCue();
    }, DEPLOYMENT_ROSTER_REVEAL_DELAY_MS + index * DEPLOYMENT_ROSTER_STAGGER_MS);
    state.deploymentRosterSfxTimers.push(timer);
  });
}

function playDeploymentOperatorCue() {
  if (state.sfxPreset === "off") return;
  try {
    const audio = new Audio("audio-effects/ui-effect.mp3");
    const cleanup = () => {
      state.deploymentRosterAudio = state.deploymentRosterAudio.filter((entry) => entry !== audio);
    };
    audio.preload = "auto";
    audio.studyAdventureBaseVolume = state.sfxPreset === "cinematic" ? 0.9 : 0.52;
    audio.volume = effectiveGameSfxVolume(audio);
    setNarrationLowPass(audio, state.ttsPlaybackActive);
    audio.addEventListener("ended", cleanup, { once: true });
    audio.addEventListener("error", cleanup, { once: true });
    state.deploymentRosterAudio.push(audio);
    audio.play().catch(cleanup);
  } catch {
    // Intro cues should never interrupt the deployment sequence.
  }
}

function stopDeploymentRosterAudio() {
  for (const timer of state.deploymentRosterSfxTimers) window.clearTimeout(timer);
  state.deploymentRosterSfxTimers = [];
  state.deploymentRosterAudio.forEach((audio) => {
    try {
      audio.pause();
      audio.currentTime = 0;
    } catch {
      // Intro cues should never interrupt mission cleanup.
    }
  });
  state.deploymentRosterAudio = [];
}

function clearDashboardBootSequence() {
  for (const timer of state.dashboardBootTimers) window.clearTimeout(timer);
  state.dashboardBootTimers = [];
  stopDashboardOperatorAudio();
  document.body.classList.remove(
    "dashboard-concealed",
    "dashboard-booting",
    "dashboard-stage-shell",
    "dashboard-stage-center-top",
    "dashboard-stage-center-screen",
    "dashboard-stage-center-initiative",
    "dashboard-stage-center-legend",
    "dashboard-stage-center-simulator",
    "dashboard-stage-center-controls",
    "dashboard-stage-center-route",
    "dashboard-stage-center-timer",
    "dashboard-stage-left-progress",
    "dashboard-stage-left-operators",
    "dashboard-stage-left-supplies",
    "dashboard-stage-left-devices",
    "dashboard-stage-right-log",
    "dashboard-stage-right-encounter",
    "dashboard-stage-right-status",
    "dashboard-stage-right-tools",
    "dashboard-stage-map",
    "dashboard-map-boot",
    "dashboard-stage-map-lock",
    "dashboard-stage-telemetry",
    "dashboard-stage-log",
    "dashboard-stage-encounter",
    "dashboard-stage-status",
    "dashboard-stage-operators",
    "dashboard-stage-supplies",
    "dashboard-stage-tools"
  );
}

function runDashboardBootSequence(runId) {
  clearDashboardBootSequence();
  document.body.classList.add("dashboard-booting", "dashboard-stage-shell");
  const schedule = (delay, callback) => {
    const timer = window.setTimeout(() => {
      state.dashboardBootTimers = state.dashboardBootTimers.filter((entry) => entry !== timer);
      if (runId !== state.deploymentRunId || !state.started) return;
      callback();
    }, delay);
    state.dashboardBootTimers.push(timer);
  };

  return new Promise((resolve) => {
    const centerTopStage = 900;
    const centerScreenStage = 1750;
    const centerInitiativeStage = 3100;
    const centerLegendStage = 3450;
    const centerSimulatorStage = 3800;
    const centerControlsStage = 4150;
    const centerRouteStage = 4500;
    const centerTimerStage = 4850;
    const leftProgressStage = 5350;
    const operatorStageStart = 5850;
    const operatorStaggerMs = 220;
    const operatorCount = Math.max(1, state.players.length);
    const operatorStageEnd = operatorStageStart + ((operatorCount - 1) * operatorStaggerMs) + 760;
    const leftSuppliesStage = operatorStageEnd + 250;
    const leftDevicesStage = leftSuppliesStage + 600;
    const rightLogStage = leftDevicesStage + 900;
    const rightEncounterStage = rightLogStage + 500;
    const rightStatusStage = rightEncounterStage + 500;
    const rightToolsStage = rightStatusStage + 500;
    const onlineStageStart = rightToolsStage + 900;

    schedule(centerTopStage, () => {
      document.body.classList.add("dashboard-stage-center-top");
      playDashboardPanelCue();
    });
    schedule(centerScreenStage, () => {
      document.body.classList.add("dashboard-stage-center-screen", "dashboard-stage-map", "dashboard-map-boot");
      playGameSfx("submitted");
    });
    schedule(centerScreenStage + 1100, () => {
      document.body.classList.remove("dashboard-map-boot");
      document.body.classList.add("dashboard-stage-map-lock");
    });
    schedule(centerInitiativeStage, () => {
      document.body.classList.add("dashboard-stage-center-initiative");
      playDashboardPanelCue();
    });
    schedule(centerLegendStage, () => {
      document.body.classList.add("dashboard-stage-center-legend");
      playDashboardPanelCue();
    });
    schedule(centerSimulatorStage, () => {
      document.body.classList.add("dashboard-stage-center-simulator");
      playDashboardPanelCue();
    });
    schedule(centerControlsStage, () => {
      document.body.classList.add("dashboard-stage-center-controls");
      playDashboardPanelCue();
    });
    schedule(centerRouteStage, () => {
      document.body.classList.add("dashboard-stage-center-route");
      playDashboardPanelCue();
    });
    schedule(centerTimerStage, () => {
      document.body.classList.add("dashboard-stage-center-timer");
      playDashboardPanelCue();
    });
    schedule(leftProgressStage, () => {
      document.body.classList.add("dashboard-stage-left-progress");
      playDashboardPanelCue();
    });
    schedule(operatorStageStart, () => document.body.classList.add("dashboard-stage-left-operators"));
    state.players.forEach((player, index) => {
      schedule(operatorStageStart + index * operatorStaggerMs, playDashboardOperatorCue);
    });
    schedule(leftSuppliesStage, () => {
      document.body.classList.add("dashboard-stage-left-supplies");
      playDashboardPanelCue();
    });
    schedule(leftDevicesStage, () => {
      document.body.classList.add("dashboard-stage-left-devices");
      playDashboardPanelCue();
    });
    schedule(rightLogStage, () => {
      document.body.classList.add("dashboard-stage-right-log");
      playDashboardPanelCue();
    });
    schedule(rightEncounterStage, () => {
      document.body.classList.add("dashboard-stage-right-encounter");
      playDashboardPanelCue();
    });
    schedule(rightStatusStage, () => {
      document.body.classList.add("dashboard-stage-right-status");
      playDashboardPanelCue();
    });
    schedule(rightToolsStage, () => {
      document.body.classList.add("dashboard-stage-right-tools");
      playDashboardPanelCue();
    });
    schedule(onlineStageStart, () => {
      clearDashboardBootSequence();
      document.body.classList.add("dashboard-online");
      const onlineTimer = window.setTimeout(() => document.body.classList.remove("dashboard-online"), 1600);
      state.dashboardBootTimers.push(onlineTimer);
      resolve(true);
    });
  });
}

function playDashboardOperatorCue() {
  if (state.sfxPreset === "off") return;
  try {
    const audio = new Audio("audio-effects/ui-effect.mp3");
    const cleanup = () => {
      state.dashboardBootAudio = state.dashboardBootAudio.filter((entry) => entry !== audio);
    };
    audio.preload = "auto";
    audio.studyAdventureBaseVolume = state.sfxPreset === "cinematic" ? 0.88 : 0.5;
    audio.volume = effectiveGameSfxVolume(audio);
    setNarrationLowPass(audio, state.ttsPlaybackActive);
    audio.addEventListener("ended", cleanup, { once: true });
    audio.addEventListener("error", cleanup, { once: true });
    state.dashboardBootAudio.push(audio);
    audio.play().catch(cleanup);
  } catch {
    // Dashboard cues should never interrupt the boot sequence.
  }
}

function playDashboardPanelCue() {
  if (state.sfxPreset === "off") return;
  try {
    const audio = new Audio("audio-effects/ui-effect-small.mp3");
    const cleanup = () => {
      state.dashboardBootAudio = state.dashboardBootAudio.filter((entry) => entry !== audio);
    };
    audio.preload = "auto";
    audio.studyAdventureBaseVolume = state.sfxPreset === "cinematic" ? 0.72 : 0.38;
    audio.volume = effectiveGameSfxVolume(audio);
    setNarrationLowPass(audio, state.ttsPlaybackActive);
    audio.addEventListener("ended", cleanup, { once: true });
    audio.addEventListener("error", cleanup, { once: true });
    state.dashboardBootAudio.push(audio);
    audio.play().catch(cleanup);
  } catch {
    // Panel cues should never interrupt deployment or dashboard startup.
  }
}

function stopDashboardOperatorAudio() {
  state.dashboardBootAudio.forEach((audio) => {
    try {
      audio.pause();
      audio.currentTime = 0;
    } catch {
      // Dashboard cues should never interrupt mission cleanup.
    }
  });
  state.dashboardBootAudio = [];
}

function stopDeploymentSequence(options = {}) {
  if (state.deploymentTimer) window.clearInterval(state.deploymentTimer);
  state.deploymentTimer = null;
  stopDeploymentReadyBlinkAudio();
  stopDeploymentRosterAudio();
  state.deploymentCompletionStartedAt = 0;
  state.deploymentCompletionWait = 0;
  els.deploymentOverlay.hidden = true;
  els.deploymentOverlay.classList.remove("deployment-visible", "deployment-fading", "deployment-blackout");
  document.body.classList.remove("session-entering", "session-revealing", "setup-to-deployment");
  if (!options.preserveDashboardBoot) clearDashboardBootSequence();
}

function startOpeningWaitCounter() {
  stopOpeningWaitCounter();
  state.openingWaitStartedAt = Date.now();
  state.openingWaitTimer = window.setInterval(updateOpeningWaitCounter, 1000);
  updateOpeningWaitCounter();
}

function stopOpeningWaitCounter() {
  if (state.openingWaitTimer) window.clearInterval(state.openingWaitTimer);
  state.openingWaitTimer = null;
  state.openingWaitStartedAt = 0;
}

function updateOpeningWaitCounter() {
  if (!state.started || state.briefingReady || !state.openingWaitStartedAt) return;
  const elapsed = Date.now() - state.openingWaitStartedAt;
  if (elapsed < 8000) return;
  const elapsedText = formatLinkDelay(elapsed);
  if (state.chatMode && state.pendingChatNode && isEncounterPlaceholder()) {
    const counter = document.getElementById("openingWaitCounter");
    if (counter) {
      counter.textContent = elapsedText;
    } else {
      els.encounterCard.innerHTML = waitingTransmissionHtml(elapsedText);
    }
    return;
  }

  const counter = document.getElementById("openingWaitCounter");
  if (counter) {
    counter.textContent = elapsedText;
  }
}

function isEncounterPlaceholder() {
  return Boolean(els.encounterCard?.querySelector(".placeholder-transmission"));
}

function waitingTransmissionHtml(elapsedText) {
  return `
    <div class="transmission-display placeholder-transmission opening-wait-transmission">
      <div class="transmission-heading">
        <strong>RECEIVING TRANSMISSION...</strong>
        <span class="signal-bars" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
      </div>
      <div class="transmission-waveform" aria-hidden="true">
        <i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i>
        <i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i>
      </div>
      <p>Waiting on local narrator response.</p>
      <p class="transmission-wait-counter">No response for <strong id="openingWaitCounter">${escapeHtml(elapsedText)}</strong></p>
    </div>
  `;
}

function deploymentWaitMessage(elapsed) {
  return "Holding deployment channel while mission systems synchronize.";
}

function updateDeploymentSequence() {
  if (!state.deploymentStartedAt) return;
  if (state.deploymentReady) {
    const completionElapsed = Date.now() - state.deploymentCompletionStartedAt;
    const completionWait = Math.max(1, state.deploymentCompletionWait || 1);
    const completionRatio = Math.max(0, Math.min(1, completionElapsed / completionWait));
    els.deploymentProgressFill.style.width = `${Math.min(100, 88 + completionRatio * 12)}%`;
    return;
  }
  const elapsed = Date.now() - state.deploymentStartedAt;
  const messages = deploymentMessages();
  els.deploymentPhase.textContent = messages[Math.floor(elapsed / 1200) % messages.length];
  els.deploymentElapsed.textContent = formatLinkDelay(elapsed);
  const easedProgress = 12 + 76 * (1 - Math.exp(-elapsed / 5200));
  els.deploymentProgressFill.style.width = `${Math.min(88, easedProgress)}%`;
  const fragments = deploymentFragments();
  els.deploymentFragment.textContent = elapsed >= 8000
    ? deploymentWaitMessage(elapsed)
    : fragments[Math.floor(elapsed / 2400) % fragments.length];
}

function renderDeploymentRoster() {
  els.deploymentRoster.innerHTML = state.players
    .map((player, index) => `<div class="deployment-player" style="--roster-delay:${index * 0.16}s"><strong>${escapeHtml(player.name)}</strong><span>${Math.max(10, Number(player.maxHp) || 10)} HP · ${escapeHtml(combatSystem.classDefinition?.(player.classId)?.label || "OPERATOR")} · READY</span></div>`)
    .join("");
}

function renderDeploymentRoute() {
  const points = Math.min(10, Math.max(5, state.questions.length));
  els.deploymentRoute.innerHTML = Array.from({ length: points }, (_, index) => `
    <i style="--route-index:${index};--route-left:${10 + (index % 5) * 19}%;--route-top:${22 + Math.floor(index / 5) * 48 + (index % 2) * 7}%"></i>
  `).join("");
}

function renderDeploymentThreatPings() {
  if (!els.deploymentThreatPings) return;
  const pings = [
    [18, 21, 0],
    [72, 18, 0.7],
    [84, 54, 1.2],
    [38, 70, 1.8],
    [60, 39, 2.3]
  ];
  els.deploymentThreatPings.innerHTML = pings
    .map(([left, top, delay], index) => `<i style="--ping-left:${left}%;--ping-top:${top}%;--ping-delay:${delay}s;--ping-scale:${index % 2 ? 1.25 : 1}"></i>`)
    .join("");
}

function deploymentThemeClass() {
  if (normalize(state.missionType) === "abandoned space station") return "space-station";
  return "bunker";
}

function applyDashboardAtmosphere() {
  if (!document.body) return;
  const node = state.nodes[state.currentNode];
  const actionPressure = Boolean(state.actionDrivenMode && currentQuestionInfo()?.actionRoom?.pressureSpotlight);
  const roster = state.players.filter(Boolean);
  const partySize = roster.length;
  const lowCount = roster.filter((player) => player.incapacitated || playerLowHealth(player)).length;
  const woundedCount = roster.filter((player) => player.incapacitated || Number(player.hp) <= Math.ceil((Number(player.maxHp) || 10) * 0.5)).length;
  const averageHp = partySize
    ? roster.reduce((total, player) => total + Math.max(0, Number(player.hp) || 0), 0) / partySize
    : 5;
  const partyCritical = partySize > 0 && (lowCount >= Math.ceil(partySize / 2) || averageHp <= 2.25);
  const partyWounded = partySize > 0 && !partyCritical && (
    roster.some((player) => player.incapacitated)
    || woundedCount >= Math.ceil(partySize / 2)
    || averageHp <= 3.5
  );
  document.body.dataset.missionTheme = deploymentThemeClass();
  document.body.classList.toggle("situation-boss", Boolean(state.bossReadyPending || node?.type === "boss" || currentBossProgress()));
  document.body.classList.toggle("situation-recovery", node?.type === "recovery");
  document.body.classList.toggle("situation-emergency", Boolean(state.emergencyTimer?.kind === "emergency" || actionPressure));
  document.body.classList.toggle("situation-party-wounded", partyWounded);
  document.body.classList.toggle("situation-party-critical", partyCritical);
}

function deploymentThemeLabel() {
  const labels = {
    bunker: "BUNKER SIGNAL RECOVERY",
    "space-station": "STATION SENSOR CALIBRATION"
  };
  return labels[deploymentThemeClass()] || labels.bunker;
}

function deploymentMessages() {
  return [
    "ESTABLISHING SQUAD UPLINK",
    "MAPPING FACILITY ACCESS POINTS",
    "SCANNING EMERGENCY CHANNELS",
    "LOADING STUDY PAYLOAD",
    "SYNCHRONIZING FIELD TELEMETRY"
  ];
}

function deploymentFragments() {
  const fragments = {
    bunker: ["Static spike detected beyond mapped rooms.", "A secondary carrier answers with no identifiable source.", "Emergency channel opens, then cuts to silence."],
    "space-station": ["Hull-adjacent sensor echo detected.", "Habitation ring pressure is unstable.", "Unknown waveform riding the station bus."]
  };
  return fragments[deploymentThemeClass()] || fragments.bunker;
}

function collapseMissionBriefing() {
  els.briefingCard.classList.add("briefing-collapsed");
}

function statusRenderKey() {
  const players = state.players.map((player) => [
    player.name,
    player.hp,
    player.maxHp,
    player.incapacitated ? 1 : 0,
    (player.status || []).join(","),
    player.level,
    player.xp,
    player.answerStreak,
    player.enforcerReserve,
    (player.items || []).join(","),
    JSON.stringify(player.classCooldowns || {}),
    player.itemNotice || "",
    player.abilityNotice || "",
    JSON.stringify(state.playerAnswerFeedback?.[normalize(player.name)] || null)
  ].join(":"));
  const actions = state.playerActions.map((entry) => `${entry.playerName || entry.playerId}:${entry.promptId || ""}:${entry.id || ""}`).join("|");
  const participants = state.playerParticipants.map((entry) => `${entry.id || entry.name}:${entry.classId || ""}`).join("|");
  return [
    state.currentNode,
    state.currentQuestion,
    state.resolved ? 1 : 0,
    state.answerPending ? 1 : 0,
    state.sideActionPending ? 1 : 0,
    state.lastSubmittedAnswer,
    state.selectedEMS ? 1 : 0,
    JSON.stringify(state.combatDisplayedHp || {}),
    JSON.stringify(state.pendingAbilityTarget || null),
    players.join("|"),
    actions,
    participants
  ].join("~");
}

function renderStatus() {
  const startedAt = state.roomTransitionTrace ? performance.now() : 0;
  try {
    return renderStatusCore();
  } finally {
    if (startedAt) roomTransitionTraceRecordDuration("render status", performance.now() - startedAt);
  }
}

function renderStatusCore() {
  const signature = statusRenderKey();
  if (signature === state.statusRenderSignature) return;
  state.statusRenderSignature = signature;
  const combatStatus = "";
  const playerCards = state.players.map((player, index) => {
    const displayedHp = state.combatDisplayedHp[normalize(player.name)];
    const displayedPlayer = Number.isFinite(displayedHp)
      ? { ...player, hp: displayedHp, incapacitated: displayedHp <= 0 }
      : player;
    const classDefinition = combatSystem.classDefinition?.(player.classId) || {};
    const abilityState = classAbilityCooldownState(player);
    const promptResolved = state.resolved || state.answerPending;
    const promptAnswer = state.playerAnswers.find((entry) => sameName(entry.playerName || entry.playerId, player.name));
    const currentResult = state.answerResults[normalize(player.name)];
    const previousResult = state.playerAnswerFeedback?.[normalize(player.name)]?.correct;
    const accuracyResult = typeof currentResult === "boolean"
      ? currentResult
      : typeof previousResult === "boolean"
        ? previousResult
        : null;
    const readyClass = accuracyResult === false ? "bad" : accuracyResult === true ? "" : "answer-neutral";
    const readyGlyph = accuracyResult === false ? "&#10005;" : accuracyResult === true ? "&#10003;" : "";
    const readyLabel = accuracyResult === false ? "Previous answer incorrect" : accuracyResult === true ? "Previous answer correct" : "No answer result";
    const equippedItems = playerItems(player).slice(0, 2);
    const itemDots = Array.from({ length: 2 }, (_, slotIndex) => {
      const item = equippedItems[slotIndex];
      return item
        ? `<i class="roster-item-dot rarity-${escapeAttribute(item.rarity || "common")}" title="${escapeAttribute(item.name)}"></i>`
        : `<i class="roster-item-dot empty" title="Empty item slot"></i>`;
    }).join("");
    return `
    <article class="status-card roster-card ${playerStatusClasses(displayedPlayer)} ${playerPromptStatusClasses(player)}" style="--player-color:${playerColor(player.name)}; --role:${playerColor(player.name)}; --turn-rank:${actionTurnRank(player)}; --operator-boot-index:${index}" data-player-index="${index}" data-player-name="${escapeAttribute(player.name)}">
      <span class="role-hex player-class-icon" title="${escapeAttribute(classDefinition.label || "Operator")}" aria-hidden="true">${playerClassIcon(player.classId)}</span>
      <div class="roster-main">
        <div class="roster-name"><strong title="${escapeAttribute(player.name)}">${escapeHtml(displayPlayerName(player.name))}</strong><small>LV ${Math.max(1, Number(player.level) || 1)}</small></div>
        <div class="roster-vitals"><span>${Math.max(0, displayedPlayer.hp)} / ${Math.max(10, Number(player.maxHp) || 10)} HP</span><span class="state-pill ${statusCodeClass(displayedPlayer)}" title="${escapeAttribute(player.status.length ? player.status.join(", ") : "No status effects")}">${escapeHtml(statusCodeText(displayedPlayer))}</span></div>
      </div>
      <span class="ready-mark ${readyClass}" aria-label="${readyLabel}">${readyGlyph}</span>
      <div class="gear-line"><span>${escapeHtml(classDefinition.gear || classAbilityLabel(player.classId))}</span><b>${escapeHtml(abilityUsedThisTurn(player) ? "ARMED" : abilityState.label)}</b><span class="roster-item-dots">${itemDots}</span></div>
      <div class="roster-card-badges">${actionTurnBadge(player)}${answerSubmissionBadge(player)}${answerResultBadge(player)}${armedAbilityBadge(player)}${emsPlayerBadge(player)}${secondWindBadge(player)}</div>
      <div class="roster-card-controls">${playerItemSlotsHtml(player)}${abilityTargetPickerHtml(player)}</div>
    </article>`;
  }).join("");

  els.statusGrid.innerHTML = `
    <div class="live-roster-heading"><span>Squad Roster</span><strong>${state.players.length} / 6 Operators</strong></div>
    ${combatStatus}
    ${playerCards}
  `;
  const effectsList = document.getElementById("missionEffectsList");
  if (effectsList) {
    const effects = state.players.flatMap((player) => (player.status || []).map((status) => ({ player, status })));
    effectsList.innerHTML = effects.length
      ? effects.slice(0, 5).map(({ player, status }) => `<div class="mission-effect-row" style="--effect-color:${playerColor(player.name)}"><span>${playerClassIcon(player.classId)}</span><div><strong>${escapeHtml(status)}</strong><small>${escapeHtml(displayPlayerName(player.name))}</small></div></div>`).join("")
      : '<p class="muted-small">No active effects.</p>';
  }
  els.statusGrid.querySelectorAll("[data-item-ability]").forEach((button) => {
    if (!button.dataset.itemAbility) return;
    button.addEventListener("click", () => {
      const sourceName = button.closest(".status-card")?.dataset.playerName || "";
      const used = useTeacherItemAbility(sourceName, button.dataset.itemAbility);
      if (!used) {
        const source = state.players.find((player) => sameName(player.name, sourceName));
        publishAbilityRejection(source, `ABILITY:${button.dataset.itemAbility}`, false);
      }
    });
  });
  els.statusGrid.querySelectorAll("[data-class-ability-target]").forEach((button) => {
    button.addEventListener("click", () => {
      state.pendingAbilityTarget = { sourceName: button.dataset.classAbilityTarget || "", kind: "class" };
      announceAbilityUse(`${button.dataset.classAbilityTarget || "Operator"}: select a target for the next class ability.`, "prompt");
      renderStatus();
    });
  });
  els.statusGrid.querySelectorAll("[data-tactician-protocol-for]").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.disabled) return;
      const protocols = ["assault", "guard", "support"];
      const current = protocols.indexOf(button.dataset.protocol || "assault");
      const next = protocols[(current + 1 + protocols.length) % protocols.length];
      button.dataset.protocol = next;
      button.classList.remove("protocol-assault", "protocol-guard", "protocol-support");
      button.classList.add(`protocol-${next}`);
      const label = button.querySelector("[data-protocol-label]");
      if (label) label.textContent = next.toUpperCase();
    });
  });
  els.statusGrid.querySelectorAll("[data-class-ability-use]").forEach((button) => {
    button.addEventListener("click", () => {
      const card = button.closest("[data-player-name]");
      const protocol = card?.querySelector("[data-tactician-protocol-for]")?.dataset.protocol || "assault";
      const sourceName = button.dataset.classAbilityUse || "";
      const used = queueClassAbilityUse(sourceName, protocol, "teacher");
      if (!used) {
        const source = state.players.find((player) => sameName(player.name, sourceName));
        publishAbilityRejection(source, `CLASS:${source?.classId || ""}`, false);
      }
    });
  });
  els.statusGrid.querySelectorAll("[data-ability-target]").forEach((button) => {
    button.addEventListener("click", () => {
      const pending = state.pendingAbilityTarget;
      if (!pending) return;
      if (pending.kind === "class") {
        state.pendingAbilityTarget = null;
        queueClassAbilityUse(pending.sourceName, button.dataset.abilityTarget || "", "teacher");
        return;
      }
      useTeacherItemAbility(pending.sourceName, pending.itemId, button.dataset.abilityTarget || "");
    });
  });
  syncEmsFieldVisual();

  const roomTotal = state.nodes.filter((node) => node.type !== "recovery").length;
  const roomResolved = state.nodes
    .slice(0, state.currentNode)
    .filter((node) => node.type !== "recovery")
    .length;
  if (state.actionDrivenMode) {
    els.progressPill.textContent = `${roomResolved} / ${roomTotal}`;
    els.progressSummary.innerHTML = `
      <span>${roomResolved} / ${roomTotal} rooms cleared</span>
      <span>Action route active</span>
    `;
  } else {
    els.progressPill.textContent = `${state.currentQuestion} / ${state.questions.length}`;
    els.progressSummary.innerHTML = `
      <span>${state.currentQuestion} / ${state.questions.length} questions resolved</span>
      <span>${roomResolved} / ${roomTotal} rooms cleared</span>
    `;
  }
  renderPreviousAnswer();
  renderInventoryActions();
  renderPlayerSessionPanel();
  renderRouteTelemetry();
  renderMapEmergencyTimer();
  renderInitiativeTimeline();
  publishPlayerVitals();
}

function combatEncounterStatusHtml() {
  if (!isCombatNode(state.nodes[state.currentNode])) return "";
  const encounter = currentCombatEncounter();
  if (!encounter) return "";
  const activeEnemies = encounter.enemies.filter((enemy) => !enemy.defeated);
  const percent = encounter.maxHp ? Math.max(0, Math.min(100, encounter.hp / encounter.maxHp * 100)) : 0;
  return `<section class="combat-status-card ${encounter.roomType === "boss" ? "boss" : ""}">
    <div><span>${encounter.roomType === "boss" ? "Boss Contact" : "Hostile Group"}</span><strong>${activeEnemies.length} ACTIVE · ROUND ${encounter.round + 1}</strong></div>
    <div class="combat-health-track"><i style="width:${percent}%"></i></div>
    <p><strong>${encounter.hp} / ${encounter.maxHp}</strong> shared integrity · ${activeEnemies.map((enemy) => escapeHtml(enemy.label)).join(", ") || "Threat neutralized"}</p>
    ${encounter.cleared ? "" : `<p class="combat-intent">${escapeHtml(combatIntentText())}</p>`}
  </section>`;
}

function actionTurnRank(player) {
  if (!state.actionDrivenMode || !state.actionTurnOrder?.length) return 0;
  const index = state.actionTurnOrder.findIndex((name) => sameName(name, player.name));
  return index >= 0 ? index + 1 : 0;
}

function actionTurnBadge(player) {
  const rank = actionTurnRank(player);
  if (!rank || player.incapacitated) return "";
  return `<span class="action-turn-badge" title="Action turn order">${rank}</span>`;
}

function playerPromptStatusClasses(player) {
  const classes = [];
  if (!state.started || !state.questionPresentationReady || state.answerPending || state.resolved) return "";
  const info = currentQuestionInfo();
  if (!state.actionDrivenMode && info?.type?.locked && info.operator) {
    classes.push(sameName(player.name, info.operator.name) ? "status-card-locked-operator" : "status-card-locked-out");
  }
  if (state.deviceMode === "multi" && participantHasCurrentSubmission({ name: player.name })) classes.push("status-card-submitted");
  if (abilityUsedThisTurn(player)) classes.push("status-card-ability-armed");
  return classes.join(" ");
}

function answerSubmissionBadge(player) {
  if (!state.started || state.deviceMode !== "multi" || !state.questionPresentationReady || state.answerPending || state.resolved) return "";
  if (!participantHasCurrentSubmission({ name: player.name })) return "";
  return `<span class="answer-submit-badge" title="Submitted" aria-label="Submitted">Submitted</span>`;
}

function emsPlayerBadge(player) {
  if (!state.selectedEMS || player.incapacitated) return "";
  return `<span class="ems-player-badge" title="Protected by the armed EMS field" aria-label="EMS protected">EMS</span>`;
}

function secondWindBadge(player) {
  if (!state.secondWindUsed || !sameName(player.name, state.secondWindPlayerName)) return "";
  const pending = sameName(player.name, state.secondWindPendingPlayerName);
  return `<span class="second-wind-badge ${pending ? "pending" : ""}" title="${pending ? "Next answer must be correct" : "Second Wind secured"}" aria-label="${pending ? "Second Wind pending" : "Second Wind secured"}">${pending ? "2ND WIND?" : "2ND WIND"}</span>`;
}

function statusCodeText(player) {
  if (player.incapacitated || Number(player.hp) <= 0) return "DOWN";
  if (!player.status.length) return "OK";
  const codes = player.status.map((status) => {
    const clean = String(status).toLowerCase();
    if (clean.includes("burn")) return "B";
    if (clean.includes("bleed")) return "BL";
    if (clean.includes("shock")) return "S";
    if (clean.includes("concuss")) return "C";
    return String(status).slice(0, 2).toUpperCase();
  });
  return [...new Set(codes)].join(" ");
}

function statusCodeClass(player) {
  if (player.incapacitated || Number(player.hp) <= 0) return "status-code-down";
  if (playerLowHealth(player)) return "status-code-low";
  if (player.status.includes("Burned")) return "status-code-burned";
  if (player.status.includes("Bleeding")) return "status-code-bleeding";
  if (player.status.includes("Shocked")) return "status-code-shocked";
  if (player.status.includes("Concussed")) return "status-code-concussed";
  return "status-code-ok";
}

function answerResultBadge(player) {
  const result = state.answerResults[normalize(player.name)];
  if (result === true) return `<span class="answer-result-badge correct" title="Answered correctly" aria-label="Answered correctly">✓</span>`;
  if (result === false) return `<span class="answer-result-badge wrong" title="Answered incorrectly" aria-label="Answered incorrectly">×</span>`;
  return "";
}

function armedAbilityBadge(player) {
  if (!abilityUsedThisTurn(player)) return "";
  const label = player.abilityNotice && /queued|armed/i.test(player.abilityNotice)
    ? player.abilityNotice
    : "Ability armed for this turn";
  return `<span class="ability-armed-badge" title="${escapeAttribute(label)}" aria-label="Ability armed">ARMED</span>`;
}

// Keep answer markers ASCII-safe across teacher monitors with mixed encodings.
function answerResultBadge(player) {
  const result = state.answerResults[normalize(player.name)];
  if (result === true) return `<span class="answer-result-badge correct" title="Answered correctly" aria-label="Answered correctly">&#10003;</span>`;
  if (result === false) return `<span class="answer-result-badge wrong" title="Answered incorrectly" aria-label="Answered incorrectly">&#10005;</span>`;
  return "";
}

function renderPreviousAnswerLegacy() {
  const previous = state.previousAnswer;
  const submissionCount = state.playerAnswers.filter((answer) => answer && (answer.playerName || answer.playerId)).length;
  const submissionLabel = `${submissionCount} response${submissionCount === 1 ? "" : "s"} submitted`;
  els.lastAnswerPanel.hidden = false;
  if (!previous) {
    els.lastAnswerPanel.classList.remove("accepted", "rejected", "feedback-flash");
    els.lastAnswerResult.textContent = "Awaiting";
    els.lastSubmittedDisplay.textContent = "—";
    els.lastCorrectDisplay.textContent = "—";
    return;
  }

  els.lastAnswerPanel.classList.toggle("accepted", previous.correct);
  els.lastAnswerPanel.classList.toggle("rejected", !previous.correct);
  els.lastAnswerResult.textContent = previous.correct ? "Accepted" : "Correction Required";
  els.lastSubmittedDisplay.textContent = previous.submitted;
  els.lastCorrectDisplay.textContent = previous.required;
  if (previous.id && previous.id !== state.previousAnswerFlashId) {
    state.previousAnswerFlashId = previous.id;
    els.lastAnswerPanel.classList.remove("feedback-flash");
    void els.lastAnswerPanel.offsetWidth;
    els.lastAnswerPanel.classList.add("feedback-flash");
  }
}

function renderPreviousAnswer() {
  const previous = state.previousAnswer;
  const submissionCount = state.playerAnswers.filter((answer) => answer && (answer.playerName || answer.playerId)).length;
  els.lastAnswerPanel.hidden = false;
  els.lastSubmittedDisplay.textContent = String(submissionCount);
  if (els.missionProgress) {
    const resolvedResults = Object.values(state.missionAccuracyResults || {});
    const correctTotal = resolvedResults.filter(Boolean).length;
    const resolvedTotal = resolvedResults.length;
    const accuracy = resolvedTotal ? Math.round((correctTotal / resolvedTotal) * 100) : 0;
    els.missionProgress.style.setProperty("--mission-accuracy-angle", `${accuracy * 3.6}deg`);
    els.missionProgress.dataset.accuracyLabel = resolvedTotal ? `${accuracy}%` : "--";
    els.missionProgress.title = resolvedTotal
      ? `${accuracy}% mission accuracy (${correctTotal} correct of ${resolvedTotal} player answers)`
      : "Mission accuracy will appear after the first player answer is resolved";
  }
  if (!previous) {
    els.lastAnswerPanel.classList.remove("accepted", "rejected", "feedback-flash");
    els.lastAnswerResult.textContent = "Awaiting";
    els.lastCorrectDisplay.textContent = "—";
    return;
  }
  els.lastAnswerPanel.classList.toggle("accepted", previous.correct);
  els.lastAnswerPanel.classList.toggle("rejected", !previous.correct);
  els.lastAnswerResult.textContent = previous.correct ? "Accepted" : "Correction Required";
  els.lastCorrectDisplay.textContent = previous.required;
  if (previous.id && previous.id !== state.previousAnswerFlashId) {
    state.previousAnswerFlashId = previous.id;
    els.lastAnswerPanel.classList.remove("feedback-flash");
    void els.lastAnswerPanel.offsetWidth;
    els.lastAnswerPanel.classList.add("feedback-flash");
  }
}

function playerBonusBadge(player) {
  const combat = asArray(player?.bonuses).find((bonus) => bonus?.kind === "combat" && Number(bonus.uses) > 0);
  if (!combat) return "";
  const amount = Number.isFinite(Number(combat.amount)) ? Number(combat.amount) : 1;
  const label = combat.label || "Temporary combat bonus";
  return `<span class="status-bonus" title="${escapeAttribute(label)}">ATK +${amount}</span>`;
}

function renderRouteTelemetry() {
  const resolved = state.currentQuestion;
  const total = state.questions.length || 1;
  const transmitting = state.transmissionPending && state.routeTransition;
  const moving = Boolean(transmitting && state.routeTransition.moving);
  const progress = moving ? Math.min(total, resolved + 0.9) : resolved;
  const percent = Math.max(0, Math.min(100, (progress / total) * 100));
  els.routeProgressFill.style.setProperty("--route-progress", `${percent}%`);
  els.routeProgressFill.classList.toggle("transmitting", moving);
  els.routeTelemetry.classList.toggle("transmitting", moving);
  els.routeTelemetry.classList.toggle("incorrect", Boolean(transmitting && !state.routeTransition.correct));
  els.routeTelemetryLabel.textContent = transmitting
    ? moving
      ? state.routeTransition.correct ? "Route signal advancing" : "Fault isolated. Rerouting signal"
      : "Route transition pending"
    : state.started ? "Route link stable" : "Standing by";
}

function renderMapEmergencyTimer() {
  const timer = state.emergencyTimer;
  els.mapEmergencyTimer.hidden = false;
  els.mapEmergencyTimer.classList.toggle("inactive", !timer);
  if (!timer) {
    if (els.mapEmergencyTimerLabel) els.mapEmergencyTimerLabel.textContent = "Challenge Window";
    els.mapEmergencyTimerValue.textContent = "--";
    if (els.mapEmergencyPauseBtn) {
      els.mapEmergencyPauseBtn.textContent = "Timer Standby";
      els.mapEmergencyPauseBtn.disabled = true;
    }
    els.mapEmergencyTimer.classList.remove("critical", "final-seconds", "paused");
    return;
  }
  const seconds = Math.max(0, timer.remainingMs / 1000);
  if (els.mapEmergencyTimerLabel) els.mapEmergencyTimerLabel.textContent = timer.starting ? "Prompt opening..." : timer.label || "Challenge Window";
  els.mapEmergencyTimerValue.textContent = seconds.toFixed(1);
  if (els.mapEmergencyPauseBtn) {
    els.mapEmergencyPauseBtn.textContent = timer.starting ? "Starting..." : timer.paused ? "Resume Timer" : "Pause Timer";
    els.mapEmergencyPauseBtn.disabled = Boolean(timer.starting);
  }
  els.mapEmergencyTimer.classList.toggle("critical", seconds <= 5);
  els.mapEmergencyTimer.classList.toggle("final-seconds", seconds <= 3);
  els.mapEmergencyTimer.classList.toggle("paused", timer.paused);
}

function renderInventoryActions() {
  if (!state.started) {
    els.inventoryActions.innerHTML = "";
    return;
  }

  const suppliesLocked = suppliesAreLocked();
  const medkitDisabled = suppliesLocked || state.inventory.medkits <= 0 || !state.players.length;
  const emsDisabled = suppliesLocked || !state.questionPresentationReady || state.selectedEMS || state.inventory.ems <= 0 || state.resolved;
  els.inventoryActions.innerHTML = `
    <div class="inventory-supplies">
      <strong>Squad Supplies</strong>
      <span>${state.inventory.medkits} Medkits</span>
      <span>${state.inventory.ems} EMS Devices</span>
      <button id="openItemCodexBtn" class="secondary inventory-codex-btn" type="button">Item Codex</button>
      ${state.sideActionGuard ? "<span>Defensive preparation active</span>" : ""}
      ${state.selectedEMS ? '<span class="ems-field-status">EMS FIELD ACTIVE</span>' : ""}
    </div>
    <div class="inventory-action-row">
      <select id="inventoryMedkitTarget" aria-label="Medkit target" ${medkitDisabled ? "disabled" : ""}>
        ${state.players.map((player, index) => `<option value="${index}">${escapeHtml(player.name)}</option>`).join("")}
      </select>
      <button id="inventoryUseMedkitBtn" class="secondary" type="button" ${medkitDisabled ? "disabled" : ""}>Use Medkit</button>
      <button id="inventoryEmsBtn" class="secondary" type="button" ${emsDisabled ? "disabled" : ""}>
        ${state.selectedEMS ? "EMS Armed" : "Activate EMS"}
      </button>
    </div>
  `;
  els.inventoryActions.classList.toggle("ems-field-active", Boolean(state.selectedEMS));
  document.getElementById("openItemCodexBtn")?.addEventListener("click", openItemCodex);

  document.getElementById("inventoryUseMedkitBtn")?.addEventListener("click", () => {
    const target = Number(document.getElementById("inventoryMedkitTarget")?.value);
    if (state.chatMode) useLocalMedkit(target);
    else useMedkit(target);
  });
  document.getElementById("inventoryEmsBtn")?.addEventListener("click", () => {
    if (state.chatMode) activateLocalEMS();
    else activateEMS();
  });
}

const PLAYER_CLASS_ICONS = {
  soldier: "✶",
  medic: "+",
  scout: "≋",
  enforcer: "▣",
  engineer: "⌘",
  tactician: "◇"
};

function playerClassIcon(classId) {
  return PLAYER_CLASS_ICONS[String(classId || "").toLowerCase()] || "•";
}

function classAbilityCooldownState(player) {
  const classId = String(player?.classId || "").toLowerCase();
  const cooldowns = {
    medic: ["surgical-kit", 2],
    scout: ["spectrum-analyzer", 5],
    enforcer: ["shield", 5],
    engineer: ["arc-disrupt", 3],
    soldier: ["soldier-double", 2],
    tactician: ["tactician-command", 1]
  };
  const [key, cadence] = cooldowns[classId] || ["", 0];
  const level = Math.max(1, Number(player?.level) || 1);
  if (classId === "enforcer") {
    const last = Number(player?.classCooldowns?.[key]);
    const current = Number(state.currentQuestion || 0);
    const remaining = Number.isFinite(last) ? Math.max(0, cadence - (current - last)) : 0;
    return { label: remaining ? `RECHARGE ${remaining}` : "READY", ready: !remaining, key, cadence };
  }
  if (level < 3 && classId === "soldier") return { label: "LV 3", ready: false, key, cadence };
  if (classId === "soldier" && Math.max(0, Number(player?.answerStreak) || 0) < 3) return { label: "STREAK 3", ready: false, key, cadence };
  if (!key) return { label: "READY", ready: true, key, cadence };
  const last = Number(player?.classCooldowns?.[key]);
  const current = ["soldier", "tactician"].includes(classId)
    ? (isCombatNode(state.nodes[state.currentNode]) ? Number(currentCombatEncounter()?.round || 0) : 0)
    : Number(state.currentQuestion || 0);
  const remaining = Number.isFinite(last) ? Math.max(0, cadence - (current - last)) : 0;
  return { label: remaining ? `RECHARGE ${remaining}` : "READY", ready: !remaining, key, cadence };
}

function itemAbilityDefinition(item) {
  if (!item) return null;
  if (item.ability && typeof item.ability === "object") return item.ability;
  const stat = Object.keys(item.bonuses || {})[0] || "";
  if (!item.rarity || !["rare", "epic", "legendary"].includes(item.rarity)) return null;
  const abilities = {
    damage: { id: "overdrive", label: "Overdrive", description: "Your next correct combat answer deals +4 damage.", effect: "damage", cooldown: 3 },
    damageReduction: { id: "guard-matrix", label: "Guard Matrix", description: "Reduce the next incoming hit by 4.", effect: "guard", cooldown: 3 },
    healing: { id: "field-patch", label: "Field Patch", description: "Restore 4 HP to a selected operator.", effect: "heal", cooldown: 3 },
    hintPower: { id: "signal-burst", label: "Signal Burst", description: "Reveal an extra clue on the current question.", effect: "hint", cooldown: 5 },
    disruption: { id: "pulse-jammer", label: "Pulse Jammer", description: "Disrupt one enemy activation this round.", effect: "disrupt", cooldown: 4 },
    maxHp: { id: "emergency-buffer", label: "Emergency Buffer", description: "Restore 3 HP to a selected operator.", effect: "heal", cooldown: 4 }
  };
  return abilities[stat] || null;
}

function itemAbilityCooldownState(player, item, ability) {
  if (!ability) return { label: "", ready: false, remaining: 0 };
  const key = `item:${item.id}:${ability.id}`;
  const last = Number(player?.classCooldowns?.[key]);
  const remaining = Number.isFinite(last) ? Math.max(0, Number(ability.cooldown || 3) - (Number(state.currentQuestion || 0) - last)) : 0;
  return { key, remaining, ready: !remaining, label: remaining ? `RECHARGE ${remaining}` : "READY" };
}

function announceAbilityUse(text, kind = "ability") {
  if (!text) return;
  const log = document.createElement("div");
  log.className = "damage-log ability-use-log";
  const line = document.createElement("p");
  line.textContent = text;
  log.appendChild(line);
  appendStatusUpdateLog(log, null);
  if (kind === "heal") playGameSfx("recovery");
  else if (kind === "loot") playGameSfx("loot");
  else if (kind !== "prompt") playGameSfx("damage");
}

function classAbilityLabel(classId) {
  return {
    soldier: "Heavy Rifle Overdrive",
    medic: "Surgical Kit",
    scout: "Spectrum Analyzer",
    enforcer: "R&R / RRR",
    engineer: "Arc Toolkit",
    tactician: "Command Protocol"
  }[String(classId || "").toLowerCase()] || "Class ability";
}

function abilityRejectionText(source, action = "") {
  if (!source) return "operator is unavailable";
  if (source.incapacitated) return "operator is incapacitated";
  const clean = String(action || "");
  const classMatch = clean.match(/^CLASS:(soldier|medic|scout|enforcer|engineer|tactician)/i);
  if (classMatch) {
    const classId = classMatch[1].toLowerCase();
    if (!isCombatNode(state.nodes[state.currentNode]) && !["medic", "scout"].includes(classId)) return "combat-only ability outside a combat room";
    if (classId === "soldier" && Number(source.level) < 3) return "unlocks at level 3";
    if (abilityUsedThisTurn(source)) return "another ability or item is already armed this turn";
    const cooldown = classAbilityCooldownState(source);
    if (!cooldown.ready) return cooldown.label.toLowerCase();
    return "the current prompt is not accepting class abilities";
  }
  const itemMatch = clean.match(/^ABILITY:(?:ITEM:)?([^:]+)/i);
  if (itemMatch) {
    const item = itemForPlayer(itemMatch[1]);
    const ability = itemAbilityDefinition(item);
    if (!item || !ability) return "item ability was not found";
    const combatRoom = isCombatNode(state.nodes[state.currentNode]);
    if (!combatRoom && !["heal", "hint"].includes(ability.effect)) return "combat-only item ability outside a combat room";
    if (abilityUsedThisTurn(source)) return "another ability or item is already armed this turn";
    const cooldown = itemAbilityCooldownState(source, item, ability);
    if (!cooldown.ready) return cooldown.label.toLowerCase();
    return "the current prompt is not accepting item abilities";
  }
  return "the ability request was not recognized";
}

function publishAbilityRejection(source, action, syncPlayer = true) {
  if (!source) return;
  const reason = abilityRejectionText(source, action);
  source.abilityNotice = `Not armed: ${reason}.`;
  state.classAbilityTargetNotices[normalize(source.name)] = source.abilityNotice;
  announceAbilityUse(`${source.name}: ${source.abilityNotice}`, "prompt");
  if (syncPlayer) publishPlayerSession({ status: "open", prompt: buildPlayerPrompt(), resetAnswers: false });
  renderStatus();
}

function queueClassAbilityUse(sourceName, targetName = "", sourceMode = "teacher") {
  if ((sourceMode === "teacher" && state.deviceMode !== "single") || !sourceName) return false;
  if (state.resolved || state.nodes[state.currentNode]?.type === "recovery") return false;
  const source = state.players.find((player) => sameName(player.name, sourceName));
  if (!source || source.incapacitated) return false;
  const classId = String(source.classId || "").toLowerCase();
  const combatRoom = isCombatNode(state.nodes[state.currentNode]);
  // Support abilities remain useful during obstacle rooms. Offensive,
  // defensive-combat, and disruption abilities stay combat-only.
  if (!combatRoom && !["medic", "scout"].includes(classId)) return false;
  const abilityState = classAbilityCooldownState(source);
  if (!abilityState.key || !abilityState.ready) return false;
  if (abilityUsedThisTurn(source)) return false;
  if (classId === "soldier" && Number(source.level) < 3) return false;
  if (classId === "soldier" && Number(source.answerStreak) < 3) return false;
  const targetable = ["medic", "engineer"].includes(classId);
  const protocol = classId === "tactician"
    ? (["assault", "guard", "support"].includes(String(targetName || "").toLowerCase()) ? String(targetName).toLowerCase() : "assault")
    : "";
  const target = targetable
    ? state.players.find((player) => sameName(player.name, targetName) && !player.incapacitated)
    : source;
  if (targetable && !target) return false;
  const encounter = combatRoom ? currentCombatEncounter() : null;
  const marker = ["soldier", "tactician"].includes(classId)
    ? Number(encounter?.round || 0)
    : state.currentQuestion;
  // Tactician cooldown starts when the selected protocol actually resolves,
  // not when the player merely arms it. An unused or cancelled protocol no
  // longer appears stuck on recharge.
  if (classId !== "tactician") {
    source.classCooldowns = { ...(source.classCooldowns || {}), [abilityState.key]: marker };
  }
  if (classId === "scout") activateScoutHintForPrompt(currentQuestionInfo(), source);
  source._abilityTurnKey = currentAbilityTurnKey();
  state.pendingClassAbilityUses.push({ sourceName: source.name, classId, targetName: target?.name || "", protocol });
  state.classAbilityTargets[normalize(source.name)] = target?.name || source.name;
  state.classAbilityTargetNotices[normalize(source.name)] = `Queued: ${classAbilityLabel(classId)}${target && target !== source ? ` → ${target.name}` : ""}`;
  source.abilityNotice = state.classAbilityTargetNotices[normalize(source.name)];
  if (protocol) {
    const protocolLabel = protocol[0].toUpperCase() + protocol.slice(1);
    state.classAbilityTargetNotices[normalize(source.name)] += ` [${protocolLabel}]`;
    source.abilityNotice = state.classAbilityTargetNotices[normalize(source.name)];
  }
  announceAbilityUse(`${source.name} queues ${classAbilityLabel(classId)}${target && target !== source ? ` on ${target.name}` : ""}; it will resolve at the end of this question.`);
  renderStatus();
  return true;
}

function useTeacherItemAbility(sourceName, itemId, targetName = "", sourceMode = "teacher") {
  if ((sourceMode === "teacher" && state.deviceMode !== "single") || !sourceName || !itemId) return false;
  if (state.resolved || state.nodes[state.currentNode]?.type === "recovery") return false;
  const source = state.players.find((player) => sameName(player.name, sourceName));
  const item = itemForPlayer(itemId);
  const ability = itemAbilityDefinition(item);
  if (!source || !item || !ability || source.incapacitated) return false;
  const combatRoom = isCombatNode(state.nodes[state.currentNode]);
  if (!combatRoom && !["heal", "hint"].includes(ability.effect)) return false;
  const cooldown = itemAbilityCooldownState(source, item, ability);
  if (!cooldown.ready) return false;
  if (abilityUsedThisTurn(source)) return false;
  if (ability.effect === "heal" && !targetName && sourceMode === "teacher") {
    state.pendingAbilityTarget = { sourceName: source.name, itemId: item.id };
    announceAbilityUse(`${source.name}: choose a target for ${ability.label}.`, "prompt");
    renderStatus();
    return false;
  }
  const target = targetName ? state.players.find((player) => sameName(player.name, targetName) && !player.incapacitated) : source;
  if (ability.effect === "heal" && !target) return false;
  source.classCooldowns = { ...(source.classCooldowns || {}), [cooldown.key]: state.currentQuestion };
  source._abilityTurnKey = currentAbilityTurnKey();
  if (ability.effect === "hint") activateCurrentQuestionHint(source, ability.label);
  state.pendingAbilityTarget = null;
  state.pendingAbilityUses.push({ sourceName: source.name, itemId: item.id, abilityId: ability.id, targetName: target?.name || "" });
  source.abilityNotice = `Queued: ${ability.label}${target && target !== source ? ` → ${target.name}` : ""}`;
  announceAbilityUse(`${source.name} queues ${ability.label}${target && target !== source ? ` on ${target.name}` : ""}; it will resolve at the end of this question.`);
  renderStatus();
  return true;
}

function itemForPlayer(itemId) {
  return combatSystem.itemDefinition?.(itemId) || null;
}

function playerItemSlotsHtml(player) {
  const definition = combatSystem.classDefinition?.(player.classId);
  const items = playerItems(player);
  const abilityState = classAbilityCooldownState(player);
  const abilityTurnUsed = abilityUsedThisTurn(player);
  const abilityLabel = abilityTurnUsed ? "USED THIS TURN" : abilityState.label;
  const abilityWindow = isCombatNode(state.nodes[state.currentNode]) && !state.resolved;
  const classId = String(player.classId || "").toLowerCase();
  const reserveText = classId === "enforcer" ? `RESERVE ${Math.max(0, Math.round(Number(player.enforcerReserve) || 0))}/${enforcerReserveCap(player)}` : "";
  const manualClass = state.deviceMode === "single" && abilityWindow && ["soldier", "medic", "scout", "enforcer", "engineer", "tactician"].includes(classId);
  const targetableClass = manualClass && ["medic", "engineer"].includes(classId);
  const targetNotice = state.classAbilityTargetNotices?.[normalize(player.name)] || "";
  const displayedClassAbility = classId === "enforcer"
    ? `${Number(player.level) >= 3 ? "RRR" : "R&R"} — Ballistic Shield`
    : (definition?.gear || "Class ability");
  const abilityLabelHtml = `<span class="player-class-icon" aria-hidden="true">${playerClassIcon(player.classId)}</span>${escapeHtml(displayedClassAbility)} <b class="player-ability-state ${abilityState.ready && !abilityTurnUsed ? "ready" : "recharging"}">${escapeHtml(abilityLabel)}</b>${reserveText ? `<b class="player-ability-reserve">${escapeHtml(reserveText)}</b>` : ""}${targetNotice ? `<b class="player-ability-targeted">${escapeHtml(targetNotice)}</b>` : ""}`;
  const itemText = [0, 1].map((slot) => {
    const item = items[slot];
    if (!item) return `<span class="player-item-dot empty" aria-label="Empty item slot"></span>`;
    const ability = itemAbilityDefinition(item);
    const cooldown = itemAbilityCooldownState(player, item, ability);
    const title = ability ? `${item.name}: ${ability.description} ${cooldown.label}` : `${item.name}: ${item.summary}`;
    return `<button class="player-item-dot rarity-${escapeAttribute(item.rarity)} ${ability ? "has-ability" : ""} ${cooldown.ready && !abilityTurnUsed ? "ready" : "recharging"}" type="button" data-item-ability="${ability ? escapeAttribute(item.id) : ""}" title="${escapeAttribute(title)}" aria-label="${escapeAttribute(title)}" ${state.deviceMode === "single" && ability && cooldown.ready && !abilityTurnUsed && abilityWindow ? "" : "disabled"}></button>`;
  }).join("");
  const classAbilityControl = targetableClass
    ? `<button type="button" class="player-ability-label class-ability-button" data-class-ability-target="${escapeAttribute(player.name)}" data-class-id="${escapeAttribute(classId)}" ${abilityState.ready && !abilityTurnUsed ? "" : "disabled"}>${abilityLabelHtml}<small>Choose target, then use</small></button>`
    : manualClass
    ? `<button type="button" class="player-ability-label class-ability-button" data-class-ability-use="${escapeAttribute(player.name)}" data-class-id="${escapeAttribute(classId)}" ${abilityState.ready && !abilityTurnUsed ? "" : "disabled"}>${abilityLabelHtml}<small>${classId === "tactician" ? "Choose protocol, then use" : classId === "enforcer" ? "Arm shield" : "Use now"}</small></button>`
    : `<span class="player-ability-label">${abilityLabelHtml}</span>`;
  const tacticianProtocolPicker = manualClass && classId === "tactician"
    ? `<button type="button" class="tactician-protocol-button protocol-assault" data-tactician-protocol-for="${escapeAttribute(player.name)}" data-protocol="assault" ${abilityState.ready && !abilityTurnUsed ? "" : "disabled"}><span>PROTOCOL</span><strong data-protocol-label>ASSAULT</strong><small>Click to cycle</small></button>`
    : "";
  return `<div class="player-loadout" title="${escapeAttribute(definition?.summary || "Class ability")}">${tacticianProtocolPicker}${classAbilityControl}<div class="player-item-slots" aria-label="Equipped items">${itemText}</div>${player.itemNotice ? `<small class="player-item-notice-inline">${escapeHtml(player.itemNotice)}</small>` : ""}${player.abilityNotice ? `<small class="player-ability-notice-inline">${escapeHtml(player.abilityNotice)}</small>` : ""}</div>`;
}

function abilityTargetPickerHtml(player) {
  const pending = state.pendingAbilityTarget;
  if (!pending || !sameName(pending.sourceName, player.name)) return "";
  const targets = state.players.filter((candidate) => !candidate.incapacitated);
  if (!targets.length) return "";
  return `<div class="ability-target-picker"><small>Select target</small><div>${targets.map((target) => `<button type="button" class="ability-target-btn" data-ability-target="${escapeAttribute(target.name)}">${escapeHtml(target.name)}</button>`).join("")}</div></div>`;
}

function playerItems(player) {
  return (Array.isArray(player?.items) ? player.items : []).map(itemForPlayer).filter(Boolean);
}

function itemBonus(player, stat) {
  return playerItems(player).reduce((sum, item) => sum + (Number(item.bonuses?.[stat]) || 0), 0);
}

function itemRisk(player, stat) {
  return playerItems(player).reduce((sum, item) => sum + (Number(item.risks?.[stat]) || 0), 0);
}

function markItemDiscovered(item) {
  if (!item?.id) return;
  state.itemCodex[item.id] = { discoveredAt: Date.now() };
  window.localStorage.setItem(ITEM_CODEX_STORAGE_KEY, JSON.stringify(state.itemCodex));
}

function commitPlayerItem(player, item, replaceIndex = -1) {
  if (!player || !item) return false;
  player.items = Array.isArray(player.items) ? player.items.slice(0, 2) : [];
  if (replaceIndex >= 0 && replaceIndex < player.items.length) player.items[replaceIndex] = item.id;
  else if (player.items.length < 2) player.items.push(item.id);
  else return false;
  markItemDiscovered(item);
  player.itemNotice = `New item: ${item.name}`;
  refreshPlayerItemStats(player);
  return true;
}

function refreshPlayerItemStats(player) {
  if (!player) return;
  const baseMax = combatSystem.levelForXp?.(player.xp)?.maxHp || Number(player.maxHp) || 10;
  player.maxHp = Math.max(1, baseMax + itemBonus(player, "maxHp") + itemRisk(player, "maxHp"));
  player.hp = Math.min(player.maxHp, Math.max(0, Number(player.hp) || 0));
}

function openItemRewardChoices(encounter) {
  if (!encounter?.cleared || encounter.rewardOffered) return false;
  const boss = encounter.roomType === "boss";
  const bossNode = state.nodes?.[encounter.nodeIndex];
  if (boss && bossNode?.bossPhase === "final") return false;
  const firstBoss = boss && !state.firstBossRewardGranted;
  if (!boss && state.rng() > 0.42) return false;
  const queue = state.players.filter((player) => boss || player.items?.length < 2);
  if (!queue.length) return false;
  encounter.rewardOffered = true;
  if (firstBoss) state.firstBossRewardGranted = true;
  state.pendingRewardChoice = {
    source: firstBoss ? "First boss cache" : boss ? "Boss cache" : "Hostile salvage",
    boss,
    firstBoss,
    encounter,
    queue,
    index: 0,
    choices: combatSystem.rollItemChoices({ rng: state.rng, count: firstBoss ? 3 : 3, rarity: firstBoss ? "epic" : "" }),
    selected: null,
    replaceIndex: -1
  };
  if (state.itemRewardMode === "random") {
    const reward = state.pendingRewardChoice;
    reward.queue.forEach((player) => {
      const choices = combatSystem.rollItemChoices({ rng: state.rng, count: 3, rarity: reward.firstBoss ? "epic" : "" });
      const selected = choices[Math.floor(state.rng() * choices.length)] || choices[0];
      if (!selected) return;
      const replaceIndex = player.items?.length >= 2 ? Math.floor(state.rng() * 2) : -1;
      if (commitPlayerItem(player, selected, replaceIndex)) {
        announceAbilityUse(`${player.name} receives ${selected.name} (${combatSystem.itemRarity(selected.rarity).label}).`, "loot");
      }
    });
    state.pendingRewardChoice = null;
    renderStatus();
    return false;
  }
  renderItemRewardChoice();
  return true;
}

function continueItemRewardChoice() {
  const reward = state.pendingRewardChoice;
  if (!reward) return;
  const player = reward.queue[reward.index];
  if (reward.selected) commitPlayerItem(player, itemForPlayer(reward.selected), reward.replaceIndex);
  reward.index += 1;
  reward.selected = null;
  reward.replaceIndex = -1;
  if (reward.index >= reward.queue.length) finishItemRewardChoice();
  else {
    reward.choices = combatSystem.rollItemChoices({ rng: state.rng, count: 3, rarity: reward.firstBoss ? "epic" : "" });
    renderItemRewardChoice();
  }
}

function finishItemRewardChoice() {
  const reward = state.pendingRewardChoice;
  if (!reward) return;
  state.pendingRewardChoice = null;
  els.itemRewardOverlay.hidden = true;
  renderStatus();
  const exit = state.pendingRewardExit;
  state.pendingRewardExit = null;
  if (typeof exit === "function") exit();
}

function syncEmsFieldVisual() {
  const active = Boolean(state.selectedEMS);
  els.statusGrid?.classList.toggle("ems-field-active", active);
  els.mapPanel?.classList.toggle("ems-field-active", active);
  els.inventoryActions?.classList.toggle("ems-field-active", active);
}

function suppliesAreLocked() {
  return state.answerPending || state.sideActionPending || state.transmissionPending || state.logPresentationPending || state.teamFailurePending || state.endingPending;
}

function playerStatusClasses(player) {
  const classes = [];
  const rank = actionTurnRank(player);
  if (rank) {
    classes.push("action-turn-order");
    if (rank === 1) classes.push("action-turn-next");
  }
  if (player.incapacitated) classes.push("incapacitated");
  else if (playerLowHealth(player)) classes.push("low-health");
  if (state.selectedEMS && !player.incapacitated) classes.push("ems-protected");
  if (state.secondWindUsed && sameName(player.name, state.secondWindPlayerName)) classes.push("second-wind-used");

  for (const status of player.status) {
    classes.push(`has-${normalize(status).trim().replace(/\s+/g, "-")}`);
  }

  return classes.join(" ");
}

function setMissionFailureVisual(active) {
  const failed = Boolean(active);
  if (failed) clearBossDamageVisual();
  els.mapPanel?.classList.toggle("mission-failed", failed);
  document.body.classList.toggle("situation-failure", failed);
  if (els.mapFailureOverlay) els.mapFailureOverlay.hidden = !failed;
}

function renderLegacyInitiativeTimeline() {
  const panel = els.initiativeTimeline;
  const track = els.initiativeTimelineTrack;
  if (!panel || !track) return;
  const node = state.nodes[state.currentNode];
  const encounter = isCombatNode(node) ? currentCombatEncounter() : null;
  const hiddenAncestor = panel.parentElement?.closest("[hidden]");
  if (!state.started || !encounter || encounter.cleared || hiddenAncestor || els.combatStage?.hidden) {
    panel.hidden = true;
    track.replaceChildren();
    return;
  }

  const answers = new Map(state.playerAnswers.map((answer) => [normalize(answer.playerName || answer.playerId), answer]));
  const players = (state.players || [])
    .filter((player) => !player.incapacitated)
    .map((player, index) => ({
      kind: "player",
      id: normalize(player.name) || `player-${index}`,
      label: player.name || `Operator ${index + 1}`,
      shortLabel: (player.name || `P${index + 1}`).slice(0, 1).toUpperCase(),
      color: playerColor(player.name),
      answer: answers.get(normalize(player.name)),
      order: Number(answers.get(normalize(player.name))?.submittedAt || Number.MAX_SAFE_INTEGER) + index / 1000
    }))
    .sort((a, b) => a.order - b.order);
  const enemies = encounter.enemies
    .filter((enemy) => !enemy.defeated)
    .map((enemy, index) => ({
      kind: "enemy",
      id: enemy.id || `enemy-${index}`,
      label: enemy.label || `${titleCase(enemy.tier || "hostile")} hostile`,
      shortLabel: enemy.boss ? "B" : "H",
      color: enemy.boss ? "#e45858" : "#d6a84f",
      enemy,
      order: players.length + index
    }));
  const actors = [...players, ...enemies];
  if (!actors.length) {
    panel.hidden = true;
    track.replaceChildren();
    return;
  }
  const submittedCount = players.filter((actor) => actor.answer).length;
  const roundLabel = Math.max(1, Number(encounter.round || 0) + 1);
  if (els.initiativeTimelineStatus) {
    els.initiativeTimelineStatus.textContent = `${submittedCount}/${players.length} responses locked · Round ${roundLabel}`;
  }
  track.innerHTML = actors.map((actor, index) => {
    const isSubmitted = actor.kind === "player" && Boolean(actor.answer);
    const isCorrect = isSubmitted && actor.answer.correct === true;
    const isCurrent = actor.kind === "player" ? !isSubmitted && index === players.findIndex((entry) => !entry.answer) : submittedCount === players.length && index === players.length;
    const status = actor.kind === "enemy" ? (actor.enemy.boss ? "BOSS" : "HOSTILE") : isCorrect ? "ATTACK" : isSubmitted ? "BRACE" : "READY";
    const glyph = actor.kind === "enemy" ? (actor.enemy.boss ? "◆" : "◆") : actor.shortLabel;
    return `<div class="initiative-actor ${actor.kind} ${isSubmitted ? "submitted" : ""} ${isCurrent ? "current" : ""}" role="listitem" title="${escapeAttribute(`${actor.label} · ${status}`)}" style="--initiative-color:${escapeAttribute(actor.color)}">
      <span class="initiative-actor-glyph" aria-hidden="true">${escapeHtml(glyph)}</span>
      <span class="initiative-actor-copy"><strong>${escapeHtml(actor.label)}</strong><small>${status}</small></span>
      ${index < actors.length - 1 ? '<i class="initiative-link" aria-hidden="true">›</i>' : ""}
    </div>`;
  }).join("");
  panel.hidden = false;
}

// The live console uses the same compact hex timeline as the approved visual
// prototype. Keep labels in accessible text/title attributes so the visual
// track can stay dense without losing actor/state information.
function renderConceptInitiativeTimelineLegacy() {
  const panel = els.initiativeTimeline;
  const track = els.initiativeTimelineTrack;
  if (!panel || !track) return;
  const node = state.nodes[state.currentNode];
  const encounter = isCombatNode(node) ? currentCombatEncounter() : null;
  if (!state.started) {
    panel.hidden = true;
    track.replaceChildren();
    return;
  }
  panel.hidden = false;
  if (!encounter) {
    state.initiativeCurrentTurn = null;
    panel.classList.remove("awaiting-order");
    panel.classList.add("initiative-standby");
    track.replaceChildren();
    if (els.initiativeTimelineStatus) els.initiativeTimelineStatus.textContent = "Standby · No active combat";
    return;
  }
  panel.classList.remove("initiative-standby");

  const answers = new Map(state.playerAnswers.map((answer) => [normalize(answer.playerName || answer.playerId), answer]));
  const players = state.players.filter((player) => !player.incapacitated).map((player, index) => {
    const answer = answers.get(normalize(player.name));
    return {
      kind: "player",
      label: player.name,
      glyph: (player.name || `P${index + 1}`).slice(0, 1).toUpperCase(),
      color: playerColor(player.name),
      answer,
      order: Number(answer?.submittedAt || Number.MAX_SAFE_INTEGER) + index / 1000
    };
  }).sort((a, b) => a.order - b.order);
  const enemies = encounter.enemies.filter((enemy) => !enemy.defeated).map((enemy) => ({
    kind: "enemy",
    label: enemy.label || "Hostile",
    glyph: enemy.boss ? "B" : "H",
    color: enemy.boss ? "#ff4a45" : "#d6a84f",
    enemy
  }));
  const actors = [...players, ...enemies];
  const submittedCount = players.filter((actor) => actor.answer).length;
  const firstWaitingIndex = players.findIndex((actor) => !actor.answer);
  if (els.initiativeTimelineStatus) {
    els.initiativeTimelineStatus.textContent = `${submittedCount}/${players.length} responses locked · Round ${Math.max(1, Number(encounter.round || 0) + 1)}`;
  }
  track.innerHTML = actors.map((actor, index) => {
    const submitted = actor.kind === "player" && Boolean(actor.answer);
    const status = actor.kind === "enemy" ? (actor.enemy?.boss ? "BOSS" : "HOSTILE") : actor.answer?.correct === true ? "ATTACK" : submitted ? "BRACE" : "READY";
    const current = actor.kind === "player" ? index === firstWaitingIndex : submittedCount === players.length && index === players.length;
    return `<span class="initiative-actor turn-token ${actor.kind} ${submitted ? "submitted" : ""} ${current ? "current" : ""}" role="listitem" title="${escapeAttribute(`${actor.label} · ${status}`)}" aria-label="${escapeAttribute(`${actor.label}, ${status}`)}" style="--initiative-color:${escapeAttribute(actor.color)};--token:${escapeAttribute(actor.color)}"><span class="initiative-actor-glyph" aria-hidden="true">${escapeHtml(actor.glyph)}</span></span>`;
  }).join("");
  panel.hidden = actors.length === 0;
}

function renderInitiativeTimeline() {
  const panel = els.initiativeTimeline;
  const track = els.initiativeTimelineTrack;
  if (!panel || !track) return;
  const node = state.nodes[state.currentNode];
  const encounter = isCombatNode(node) ? currentCombatEncounter() : null;
  panel.hidden = false;
  if (!encounter) {
    state.initiativeCurrentTurn = null;
    panel.classList.remove("awaiting-order");
    panel.classList.add("initiative-standby");
    track.replaceChildren();
    if (els.initiativeTimelineStatus) els.initiativeTimelineStatus.textContent = "Standby · No active combat";
    return;
  }
  panel.classList.remove("initiative-standby");

  const answers = new Map(state.playerAnswers.map((answer) => [normalize(answer.playerName || answer.playerId), answer]));
  const players = state.players.filter((player) => !player.incapacitated).map((player, index) => {
    const answer = answers.get(normalize(player.name));
    return {
      label: player.name,
      glyph: (player.name || `P${index + 1}`).slice(0, 1).toUpperCase(),
      color: playerColor(player.name),
      answer,
      order: Number(answer?.submittedAt || Number.MAX_SAFE_INTEGER) + index / 1000
    };
  }).sort((a, b) => a.order - b.order);
  const submittedCount = players.filter((actor) => actor.answer).length;
  const combatPresentationResolving = Boolean(
    encounter.cleared
    || els.combatStage?.classList.contains("resolving")
    || els.combatStage?.classList.contains("combat-cleared")
    || els.combatStage?.classList.contains("exiting")
  );
  const acceptingSubmissions = state.questionPresentationReady
    && !state.answerPending
    && !state.resolved
    && !combatPresentationResolving
    && submittedCount < players.length;
  const hasResolvedRound = encounter.lastRound?.round === encounter.round
    && (!acceptingSubmissions || combatPresentationResolving);
  const submissionsFinal = hasResolvedRound || state.answerPending || state.resolved || submittedCount >= players.length;
  if (els.initiativeTimelineStatus) {
    els.initiativeTimelineStatus.textContent = submissionsFinal
      ? `Order locked · Round ${Math.max(1, Number(encounter.round || 0) + 1)}`
      : `${submittedCount}/${players.length} responses submitted`;
  }
  panel.classList.toggle("awaiting-order", !submissionsFinal);
  if (!submissionsFinal) {
    track.replaceChildren();
    return;
  }

  const pendingClassNames = new Set((state.pendingClassAbilityUses || []).map((use) => normalize(use.sourceName)));
  const pendingItemNames = new Set((state.pendingAbilityUses || []).map((use) => normalize(use.sourceName)));
  let abilityActors = players
    .filter((actor) => actor.answer && (pendingClassNames.has(normalize(actor.label)) || pendingItemNames.has(normalize(actor.label))))
    .map((actor) => ({ ...actor, kind: "ability", status: "ABILITY" }));
  let attackActors = players
    .filter((actor) => actor.answer?.correct === true)
    .map((actor) => ({ ...actor, kind: "attack", status: "ATTACK" }));

  const type = combatRoundChallengeType(state.currentQuestion);
  const operator = type.locked ? selectOperator(state.currentQuestion) : null;
  const lockedSuppression = Boolean(type.locked && operator && players.some((actor) => sameName(actor.label, operator.name) && actor.answer?.correct === true));
  let disruptedActivations = (state.pendingClassAbilityUses || []).reduce((total, use) => {
    if (String(use.classId || "").toLowerCase() !== "engineer") return total;
    const source = state.players.find((player) => sameName(player.name, use.sourceName));
    return total + 1 + (source ? itemBonus(source, "disruption") : 0);
  }, 0);
  disruptedActivations += (state.pendingAbilityUses || []).reduce((total, use) => {
    const ability = itemAbilityDefinition(itemForPlayer(use.itemId));
    if (ability?.effect !== "disrupt") return total;
    const source = state.players.find((player) => sameName(player.name, use.sourceName));
    return total + 1 + (source ? itemBonus(source, "disruption") : 0);
  }, 0);

  const enemyActors = [];
  if (!lockedSuppression && !state.selectedEMS) {
    encounter.enemies.filter((enemy) => !enemy.defeated).forEach((enemy) => {
      const activations = Math.max(1, Number(enemy.activations) || 1);
      for (let activation = 0; activation < activations; activation += 1) {
        if (disruptedActivations > 0) {
          disruptedActivations -= 1;
          continue;
        }
        enemyActors.push({
          label: enemy.label || "Hostile",
          glyph: enemy.boss ? "B" : "H",
          color: enemy.boss ? "#ff4a45" : "#d6a84f",
          kind: "enemy",
          status: "ATTACK"
        });
      }
    });
  }

  const resolvedRound = hasResolvedRound ? encounter.lastRound : null;
  if (resolvedRound) {
    const actorForName = (name) => players.find((actor) => sameName(actor.label, name));
    const seenAbilities = new Set();
    abilityActors = (resolvedRound.supportEvents || []).map((event) => actorForName(event.source)).filter((actor) => {
      const key = normalize(actor?.label);
      if (!key || seenAbilities.has(key)) return false;
      seenAbilities.add(key);
      return true;
    }).map((actor) => ({ ...actor, kind: "ability", status: "ABILITY" }));
    attackActors = (resolvedRound.attackResults || []).map((attack) => actorForName(attack.player?.name)).filter(Boolean).map((actor) => ({ ...actor, kind: "attack", status: "ATTACK" }));
    enemyActors.splice(0, enemyActors.length, ...(resolvedRound.enemyActions || []).filter((action) => !action.disrupted).map((action) => ({
      label: action.enemy?.label || "Hostile",
      glyph: action.enemy?.boss ? "B" : "H",
      color: action.enemy?.boss ? "#ff4a45" : "#d6a84f",
      kind: "enemy",
      status: "ATTACK"
    })));
  }

  const actors = [...abilityActors, ...attackActors, ...enemyActors];
  const activeTurn = state.initiativeCurrentTurn;
  const actorOccurrences = new Map();
  let activeTokenRendered = false;
  track.innerHTML = actors.map((actor) => {
    const actorKey = normalize(actor.label);
    const occurrenceKey = `${actor.kind}:${actorKey}`;
    const occurrence = actorOccurrences.get(occurrenceKey) || 0;
    actorOccurrences.set(occurrenceKey, occurrence + 1);
    const current = Boolean(activeTurn
      && activeTurn.kind === actor.kind
      && activeTurn.actorKey === actorKey
      && activeTurn.occurrence === occurrence);
    if (current) activeTokenRendered = true;
    return `<span class="initiative-actor turn-token ${actor.kind} ${current ? "current" : ""}" data-initiative-kind="${escapeAttribute(actor.kind)}" data-initiative-actor="${escapeAttribute(actorKey)}" role="listitem" title="${escapeAttribute(`${actor.label} · ${actor.status}`)}" aria-label="${escapeAttribute(`${actor.label}, ${actor.status}`)}"${current ? ' aria-current="step"' : ""} style="--initiative-color:${escapeAttribute(actor.color)};--token:${escapeAttribute(actor.color)}"><span class="initiative-actor-glyph" aria-hidden="true">${escapeHtml(actor.glyph)}</span></span>`;
  }).join("");
  panel.classList.toggle("turn-in-progress", activeTokenRendered);
}

function setInitiativeCurrentTurn(kind = "", actorName = "", occurrence = 0) {
  const actorKey = normalize(actorName);
  state.initiativeCurrentTurn = kind && actorKey
    ? { kind, actorKey, occurrence: Math.max(0, Number(occurrence) || 0) }
    : null;
  const panel = els.initiativeTimeline;
  const track = els.initiativeTimelineTrack;
  if (!panel || !track) return;
  const tokens = [...track.querySelectorAll(".initiative-actor")];
  tokens.forEach((token) => {
    if (token.classList.contains("current")) token.classList.add("completed");
    token.classList.remove("current");
    token.removeAttribute("aria-current");
  });
  if (!kind || !actorKey) {
    panel.classList.remove("turn-in-progress");
    return;
  }
  const candidates = tokens.filter((token) => token.dataset.initiativeKind === kind
    && token.dataset.initiativeActor === actorKey);
  const target = candidates[Math.max(0, Number(occurrence) || 0)];
  if (!target) {
    panel.classList.remove("turn-in-progress");
    return;
  }
  target.classList.remove("completed");
  target.classList.add("current");
  target.setAttribute("aria-current", "step");
  panel.classList.add("turn-in-progress");
}

function resetBossIntroVideo() {
  els.combatStage?.classList.remove("boss-intro-playing", "boss-intro-handoff", "boss-intro-complete");
  if (els.combatBossIntro) {
    els.combatBossIntro.classList.remove("fading");
    els.combatBossIntro.hidden = true;
  }
  const video = els.combatBossIntroVideo;
  if (!video) return;
  video.onended = null;
  video.onerror = null;
  video.pause();
  video.muted = true;
  video.defaultMuted = true;
  video.volume = 0;
  try {
    video.currentTime = 0;
  } catch {
    // Metadata may not be ready during a fast reset. Playback still starts at
    // zero once the resource is available.
  }
}

function playBossIntroVideo(runId, nodeIndex, onComplete) {
  const bossVideoStep = roomTransitionTraceStepStart("boss intro video", { runId, nodeIndex });
  const stage = els.combatStage;
  const shell = els.combatBossIntro;
  const video = els.combatBossIntroVideo;
  if (!stage || !shell || !video) {
    roomTransitionTraceStepEnd(bossVideoStep, { skipped: true, reason: "elements missing" });
    onComplete();
    return;
  }

  const bossNode = state.nodes?.[nodeIndex];
  const finalBoss = bossNode?.bossPhase === "final";
  const profile = primeBossThemeForNode(nodeIndex) || bossVisualProfileForNode(bossNode);
  const desiredSource = profile?.introSrc || (finalBoss ? video.dataset.finalSrc : video.dataset.midSrc);
  if (desiredSource && video.getAttribute("src") !== desiredSource) {
    video.pause();
    video.setAttribute("src", desiredSource);
    video.load();
    roomTransitionTraceEmit("MARK", "boss video source loaded", { finalBoss, source: desiredSource });
  }

  let handoffStarted = false;
  const valid = () => runId === state.combatPresentationRunId
    && nodeIndex === state.currentNode
    && !stage.hidden;
  const finishHandoff = () => {
    if (!valid()) return;
    stage.classList.remove("boss-intro-playing", "boss-intro-handoff");
    stage.classList.add("boss-intro-complete");
    shell.classList.remove("fading");
    shell.hidden = true;
    video.onended = null;
    video.onerror = null;
    video.pause();
    try { video.currentTime = 0; } catch {}
    roomTransitionTraceStepEnd(bossVideoStep, { finalBoss, handoff: "complete" });
    onComplete();
  };
  const revealStaticEyes = () => {
    if (!valid()) return;
    shell.hidden = true;
    shell.classList.remove("fading");
    video.pause();
    try { video.currentTime = 0; } catch {}
    stage.classList.remove("boss-intro-playing");
    stage.classList.add("boss-intro-handoff");
    combatPresentationTimer(finishHandoff, BOSS_INTRO_STATIC_FADE_MS, runId);
  };
  const beginHandoff = (reason = "ended") => {
    if (handoffStarted || !valid()) return;
    handoffStarted = true;
    roomTransitionTraceEmit("MARK", "boss video handoff started", { reason });
    video.onended = null;
    video.onerror = null;
    shell.classList.add("fading");
    combatPresentationTimer(revealStaticEyes, BOSS_INTRO_VIDEO_FADE_MS, runId);
  };

  stage.classList.remove("boss-intro-handoff", "boss-intro-complete");
  stage.classList.add("boss-intro-playing");
  shell.hidden = false;
  shell.classList.remove("fading");
  video.muted = true;
  video.defaultMuted = true;
  video.volume = 0;
  video.onended = () => beginHandoff("ended");
  video.onerror = () => beginHandoff("media error");
  try { video.currentTime = 0; } catch {}
  const playRequest = video.play();
  if (playRequest?.catch) playRequest.catch(() => beginHandoff("play rejected"));
  combatPresentationTimer(
    () => beginHandoff("watchdog"),
    BOSS_INTRO_WATCHDOG_MS - BOSS_INTRO_START_DELAY_MS - BOSS_INTRO_VIDEO_FADE_MS - BOSS_INTRO_STATIC_FADE_MS - 500,
    runId
  );
}

function renderMap() {
  const startedAt = state.roomTransitionTrace ? performance.now() : 0;
  try {
    return renderMapCore();
  } finally {
    if (startedAt) roomTransitionTraceRecordDuration("render map", performance.now() - startedAt);
  }
}

function renderMapCore() {
  applyDashboardAtmosphere();
  syncEmsFieldVisual();
  els.mapTitle.textContent = state.title || "Awaiting Mission";
  const routeVisible = state.teamReady || state.currentQuestion > 0 || state.currentNode > 0 || state.questionPresentationReady || state.bossReadyPending;
  const svgSignature = mapSvgRenderSignature(routeVisible);
  const svgNeedsRender = svgSignature !== state.mapRenderSignature
    || Boolean(state.nodes.length && !els.missionMap.childElementCount);
  if (!state.nodes.length) {
    if (svgNeedsRender) {
      els.missionMap.replaceChildren();
      state.mapRenderSignature = svgSignature;
    }
    hideHtmlRouteMarker();
    renderInitiativeTimeline();
    renderMapQuestionOverlay();
    return;
  }

  if (svgNeedsRender) {
    els.missionMap.replaceChildren();
    const positions = routePositions(state.nodes.length);
    const height = Math.max(510, Math.max(...positions.map((pos) => pos.y)) + 76);
    els.missionMap.setAttribute("viewBox", `0 0 900 ${height}`);
    for (let i = 0; i < positions.length - 1; i++) {
      const transmitting = state.routeTransition?.from === i
        && state.routeTransition?.to === i + 1
        && state.transmissionPending
        && state.routeTransition.moving;
      if (i >= state.currentNode && !transmitting) continue;
      const line = svg("line", {
        x1: positions[i].x,
        y1: positions[i].y,
        x2: positions[i + 1].x,
        y2: positions[i + 1].y,
        class: `route-line ${i < state.currentNode ? "cleared" : ""} ${transmitting ? "active" : ""}`
      });
      els.missionMap.appendChild(line);
    }

    state.nodes.forEach((node, index) => {
      const pos = positions[index];
      const receiving = state.transmissionPending && state.routeTransition?.to === index;
      const discovered = index < state.currentNode || (routeVisible && index === state.currentNode) || receiving;
      if (!discovered) return;
      const newlyDiscovered = !state.mapRevealedNodes.has(index);
      state.mapRevealedNodes.add(index);
      const group = svg("g", { class: `map-location${newlyDiscovered ? " newly-discovered" : ""}` });
      const status = index < state.currentNode ? "cleared" : routeVisible && index === state.currentNode ? "current" : receiving ? "receiving" : "base";
      const resultClass = discovered && node.type !== "recovery" && state.nodeResults[index] !== undefined
        ? state.nodeResults[index] ? "correct" : "incorrect"
        : "";
      const typeClass = resultClass || (discovered && node.type === "boss" ? "boss" : discovered && node.type === "combat" ? "combat" : discovered && node.type === "recovery" ? "recovery" : "");
      const radius = discovered && node.type === "boss" ? 28 : discovered && node.type === "recovery" ? 24 : 21;
      group.appendChild(svg("circle", { cx: pos.x, cy: pos.y, r: radius, class: `map-node ${typeClass || status} ${status}` }));
      group.appendChild(svg("text", { x: pos.x, y: pos.y + 6, class: "map-label" }, discovered ? node.label : "?"));
      group.appendChild(svg("text", { x: pos.x, y: pos.y + 47, class: "map-room-name" }, roomName(node, index)));
      els.missionMap.appendChild(group);
    });

    state.mapRenderSignature = svgSignature;
  }

  syncHtmlRouteMarker(routePositions(state.nodes.length), routeVisible);

  els.mapPanel.classList.toggle("transmission-active", state.transmissionPending);
  els.mapPanel.classList.toggle("transmission-incorrect", Boolean(state.transmissionPending && state.routeTransition && !state.routeTransition.correct));
  els.mapPanel.classList.toggle("transmission-boss", Boolean(state.transmissionPending && state.routeTransition?.boss));
  els.mapPanel.classList.toggle("boss-encounter", state.nodes[state.currentNode]?.type === "boss");
  renderRouteTelemetry();
  syncCombatStage();
  syncBossEyesVisual();
  renderInitiativeTimeline();
  renderMapQuestionOverlay();
}

function mapSvgRenderSignature(routeVisible) {
  const transition = state.routeTransition || {};
  const positions = state.mapPositions.map((position) => [
    Math.round((Number(position?.x) || 0) * 10) / 10,
    Math.round((Number(position?.y) || 0) * 10) / 10
  ]);
  return JSON.stringify({
    deployment: state.deploymentRunId,
    layout: state.mapLayoutSeed,
    started: Boolean(state.started),
    currentNode: state.currentNode,
    routeVisible: Boolean(routeVisible),
    nodes: state.nodes.map((node, index) => [node.type, node.label, roomName(node, index)]),
    positions,
    results: state.nodes.map((_, index) => state.nodeResults[index] ?? null),
    transmission: Boolean(state.transmissionPending),
    transition: [
      transition.from ?? null,
      transition.to ?? null,
      Boolean(transition.moving),
      transition.correct ?? null,
      Boolean(transition.boss)
    ]
  });
}

function clearCombatPresentation() {
  state.combatPresentationRunId += 1;
  for (const timer of state.combatPresentationTimers || []) window.clearTimeout(timer);
  state.combatPresentationTimers = [];
  window.clearTimeout(state.combatEntryWatchdogTimer);
  state.combatEntryWatchdogTimer = null;
  window.clearTimeout(state.combatNextNodeTimer);
  state.combatNextNodeTimer = null;
  state.combatNextNodeWaitStartedAt = 0;
  state.combatMountBlocked = false;
  state.combatDisplayedHp = {};
  state.initiativeCurrentTurn = null;
  resetBossIntroVideo();
  if (els?.combatStage) {
    els.combatStage.classList.remove("entering", "resolving", "combat-cleared", "exiting", "boss-fight", "mid-boss-visual", "final-boss-visual", "boss-eyes-attacking", "boss-eyes-hit", "final-boss-defeated", "boss-intro-playing", "boss-intro-handoff", "boss-intro-complete");
    els.combatStage.hidden = true;
    delete els.combatStage.dataset.nodeIndex;
  }
  syncBossThemePresence();
  renderInitiativeTimeline();
}

function recoverCombatPresentationGate(reason = "combat transition") {
  state.combatPresentationRunId += 1;
  for (const timer of state.combatPresentationTimers || []) window.clearTimeout(timer);
  state.combatPresentationTimers = [];
  state.initiativeCurrentTurn = null;
  window.clearTimeout(state.combatEntryWatchdogTimer);
  state.combatEntryWatchdogTimer = null;
  window.clearTimeout(state.combatNextNodeTimer);
  state.combatNextNodeTimer = null;
  state.combatNextNodeWaitStartedAt = 0;
  state.combatMountBlocked = false;
  resetBossIntroVideo();
  els.mapPanel?.classList.remove("combat-map-transitioning");
  if (els.combatStage) {
    els.combatStage.classList.remove("entering", "resolving", "exiting");
    const currentNode = state.nodes[state.currentNode];
    const bossLocked = currentNode?.type === "boss" && !state.bossReadyChecks.has(state.currentNode);
    const encounter = isCombatNode(currentNode) && !bossLocked ? currentCombatEncounter() : null;
    if (encounter) {
      state.combatStageEnteredNodes.add(state.currentNode);
      renderCombatStage(encounter);
    } else {
      els.combatStage.hidden = true;
    }
  }
  syncBossThemePresence();
  logDebugEvent({
    kind: "state",
    label: "Combat presentation watchdog recovered",
    detail: `${reason} exceeded ${COMBAT_GATE_MAX_WAIT_MS}ms`
  });
}

function combatEnemyGlyph(enemy) {
  if (enemy.boss) return "◆";
  if (enemy.tier === "heavy") return "⬢";
  if (enemy.tier === "medium") return "⬟";
  return "▲";
}

function enemyVisualPool() {
  return deploymentThemeClass() === "space-station"
    ? ENEMY_VISUAL_POOLS.spaceStation
    : ENEMY_VISUAL_POOLS.bunker;
}

function scheduleEnemyVisualPreload() {
  const preload = () => enemyVisualPool().forEach((src) => {
    const image = new Image();
    image.decoding = "async";
    image.src = src;
  });
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(preload, { timeout: 1800 });
  } else {
    window.setTimeout(preload, 0);
  }
}

function assignEnemyVisuals(enemies = []) {
  const shuffled = [...enemyVisualPool()];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(state.rng() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  enemies.forEach((enemy, index) => {
    enemy.imageSrc = shuffled[index % shuffled.length] || "";
  });
}

function renderCombatStage(encounter, options = {}) {
  if (!els.combatStage || !encounter) return;
  const enemyStates = new Map((options.enemyStates || []).map((entry) => [entry.id, entry]));
  const playerStates = new Map((options.playerStates || []).map((entry) => [normalize(entry.name), entry]));
  const playerResults = new Map((options.playerResults || []).map((entry) => [normalize(entry.name), entry.correct]));
  const bossFight = encounter.roomType === "boss";
  const bossNode = state.nodes?.[encounter.nodeIndex ?? state.currentNode];
  const finalBoss = bossFight && bossNode?.bossPhase === "final";
  if (!bossFight && encounter.enemies.some((enemy) => !enemy.imageSrc)) {
    assignEnemyVisuals(encounter.enemies);
  }
  els.combatStage.classList.toggle("boss-fight", bossFight);
  els.combatStage.classList.toggle("final-boss-visual", finalBoss);
  els.combatStage.classList.toggle("mid-boss-visual", bossFight && !finalBoss);
  els.combatStage.dataset.nodeIndex = String(encounter.nodeIndex ?? state.currentNode);
  if (bossFight) primeBossThemeForNode(encounter.nodeIndex ?? state.currentNode);
  els.combatStage.hidden = false;
  syncBossThemePresence();
  els.combatStageLabel.textContent = encounter.roomType === "boss" ? "CRITICAL HOSTILE" : "HOSTILE CONTACT";
  els.combatStageRound.textContent = `ROUND ${Math.max(1, encounter.round + (options.beforeRound ? 0 : 1))}`;
  els.combatEnemyFormation.innerHTML = encounter.enemies.filter((enemy) => {
    const snapshot = enemyStates.get(enemy.id);
    return !(snapshot ? snapshot.defeated : enemy.defeated);
  }).map((enemy) => {
    const snapshot = enemyStates.get(enemy.id);
    const hp = snapshot ? snapshot.hp : enemy.hp;
    const defeated = snapshot ? snapshot.defeated : enemy.defeated;
    const percent = enemy.maxHp ? Math.max(0, Math.min(100, hp / enemy.maxHp * 100)) : 0;
    const sprite = enemy.boss
      ? `<div class="combat-unit-sprite combat-boss-eyes-target" aria-hidden="true"><span class="combat-hit-ring"></span></div>`
      : enemy.imageSrc
        ? `<div class="combat-unit-sprite combat-enemy-image-sprite"><img class="combat-enemy-image" src="${escapeAttribute(enemy.imageSrc)}" alt="" draggable="false" decoding="async"><span class="combat-hit-ring"></span></div>`
        : `<div class="combat-unit-sprite"><i>${combatEnemyGlyph(enemy)}</i><span class="combat-hit-ring"></span></div>`;
    return `<article class="combat-enemy-unit ${enemy.tier} ${enemy.boss ? "boss" : ""} ${defeated ? "defeated" : ""}" data-enemy-id="${escapeAttribute(enemy.id)}">
      ${sprite}
      <strong>${escapeHtml(enemy.label)}</strong>
      <div class="combat-unit-hp"><i style="width:${percent}%"></i></div>
      <small>${Math.max(0, hp)} / ${enemy.maxHp}</small>
    </article>`;
  }).join("");
  els.combatPartyFormation.innerHTML = state.players.map((player) => {
    const snapshot = playerStates.get(normalize(player.name));
    const visibleHp = snapshot ? snapshot.hp : player.hp;
    const visibleDown = snapshot ? visibleHp <= 0 : player.incapacitated;
    const answerResult = playerResults.get(normalize(player.name));
    const answerClass = answerResult === true ? "answer-correct" : answerResult === false ? "answer-wrong" : "";
    const answerCue = answerResult === true ? "ATTACK READY" : answerResult === false ? "BRACE" : "";
    const hpPercent = player.maxHp ? Math.max(0, Math.min(100, visibleHp / player.maxHp * 100)) : 0;
    const classDefinition = combatSystem.classDefinition?.(player.classId) || {};
    const classLabel = classDefinition.label || "Operator";
    const classArmed = (state.pendingClassAbilityUses || []).some((use) => sameName(use.sourceName, player.name));
    const itemArmed = (state.pendingAbilityUses || []).some((use) => sameName(use.sourceName, player.name));
    const equippedNames = playerItems(player).map((item) => item.name).join(" · ");
    return `<article class="combat-party-unit ${visibleDown ? "down" : ""} ${answerClass} ${classArmed ? "class-armed" : ""} ${itemArmed ? "item-armed" : ""}" style="--player-color:${playerColor(player.name)}" data-player-name="${escapeAttribute(normalize(player.name))}">
      <div class="combat-party-avatar" style="--player-color:${playerColor(player.name)}"><span>${escapeHtml(player.name.slice(0, 1).toUpperCase())}</span></div>
      <div><strong>${escapeHtml(player.name)}${answerCue ? `<b class="combat-answer-cue">${answerCue}</b>` : ""}</strong><small>${escapeHtml(classLabel)} · LV ${player.level || 1}</small><em class="combat-ability-label">${escapeHtml(classDefinition.gear || "Ability ready")}</em>${equippedNames ? `<em class="combat-item-label">${escapeHtml(equippedNames)}</em>` : ""}<div class="combat-unit-hp party"><i style="width:${hpPercent}%"></i></div><em>${visibleHp} / ${player.maxHp} HP</em></div>
    </article>`;
  }).join("");
  renderInitiativeTimeline();
}

function syncCombatStage() {
  const node = state.nodes[state.currentNode];
  if (!isCombatNode(node) || state.currentNode >= state.nodes.length) {
    if (els.combatStage && !els.combatStage.classList.contains("resolving") && !els.combatStage.classList.contains("exiting")) els.combatStage.hidden = true;
    syncBossThemePresence();
    return;
  }
  const stageNodeIndex = Number(els.combatStage?.dataset.nodeIndex);
  if (els.combatStage?.classList.contains("exiting") && stageNodeIndex !== state.currentNode) {
    els.combatStage.classList.remove("exiting");
    els.combatStage.hidden = true;
    state.combatMountBlocked = false;
    syncBossThemePresence();
  }
  if (node.type === "boss" && !state.bossReadyChecks.has(state.currentNode)) {
    if (els.combatStage && !els.combatStage.classList.contains("resolving") && !els.combatStage.classList.contains("exiting")) {
      els.combatStage.hidden = true;
    }
    syncBossThemePresence();
    return;
  }
  if (state.combatMountBlocked) return;
  const encounter = currentCombatEncounter();
  if (!encounter || els.combatStage?.classList.contains("resolving") || els.combatStage?.classList.contains("exiting")) return;
  if (els.combatStage.classList.contains("entering")) return;
  const firstEntry = !state.combatStageEnteredNodes.has(state.currentNode);
  if (firstEntry) {
    resetBossIntroVideo();
    els.combatStage.classList.remove("resolving", "combat-cleared", "exiting", "boss-eyes-attacking", "boss-eyes-hit", "final-boss-defeated", "boss-intro-playing", "boss-intro-handoff", "boss-intro-complete");
    els.combatStage.classList.add("entering");
  }
  renderCombatStage(encounter);
  if (firstEntry) {
    const combatEntryStep = roomTransitionTraceStepStart("combat stage entry", {
      nodeIndex: state.currentNode,
      roomType: encounter.roomType,
      enemyCount: encounter.enemies?.filter((enemy) => !enemy.defeated).length || 0
    });
    state.combatStageEnteredNodes.add(state.currentNode);
    void els.combatStage.offsetWidth;
    const entryNodeIndex = state.currentNode;
    const entryRunId = state.combatPresentationRunId;
    const bossEntry = encounter.roomType === "boss";
    window.clearTimeout(state.combatEntryWatchdogTimer);
    state.combatEntryWatchdogTimer = window.setTimeout(() => {
      state.combatEntryWatchdogTimer = null;
      if (entryRunId !== state.combatPresentationRunId || state.currentNode !== entryNodeIndex) return;
      if (els.combatStage?.classList.contains("entering")) {
        roomTransitionTraceStepEnd(combatEntryStep, { watchdog: true }, "ERROR");
        recoverCombatPresentationGate("combat entry animation");
      }
    }, bossEntry ? BOSS_INTRO_WATCHDOG_MS : COMBAT_ENTRY_WATCHDOG_MS);
    els.mapPanel?.classList.remove("combat-map-transitioning");
    window.requestAnimationFrame(() => {
      if (entryRunId !== state.combatPresentationRunId || state.currentNode !== entryNodeIndex) return;
      els.mapPanel?.classList.add("combat-map-transitioning");
      roomTransitionTraceEmit("MARK", "combat map blackout started", { entryRunId, entryNodeIndex });
    });
    const completeEntry = () => {
      if (entryRunId !== state.combatPresentationRunId || state.currentNode !== entryNodeIndex) return;
      if (entryRunId === state.combatPresentationRunId) {
        window.clearTimeout(state.combatEntryWatchdogTimer);
        state.combatEntryWatchdogTimer = null;
      }
      els.combatStage?.classList.remove("entering");
      els.mapPanel?.classList.remove("combat-map-transitioning");
      roomTransitionTraceStepEnd(combatEntryStep, { bossEntry });
      if (els.combatActionBanner) els.combatActionBanner.textContent = encounter.cleared ? "HOSTILE LINE CLEARED" : combatIntentText();
      if (state.backgroundMusicMode !== "boss") {
        loadBackgroundMusic("boss", state.backgroundMusicLoaded ? { transition: true } : { fadeIn: true });
      }
      renderMapQuestionOverlay();
    };
    if (els.combatActionBanner) {
      els.combatActionBanner.textContent = bossEntry
        ? "CRITICAL SIGNAL — VISUAL CONTACT FORMING"
        : "HOSTILE CONTACT — FORMING BATTLE LINE";
    }
    if (bossEntry) {
      roomTransitionTraceEmit("MARK", "boss intro scheduled", { delayMs: BOSS_INTRO_START_DELAY_MS });
      combatPresentationTimer(() => playBossIntroVideo(entryRunId, entryNodeIndex, completeEntry), BOSS_INTRO_START_DELAY_MS, entryRunId);
    } else {
      roomTransitionTraceEmit("MARK", "combat formation timers scheduled", {
        formationReadyMs: COMBAT_FORMATION_READY_MS,
        entryCompleteMs: COMBAT_ENTRY_COMPLETE_MS
      });
      combatPresentationTimer(() => {
        if (els.combatActionBanner) els.combatActionBanner.textContent = encounter.cleared ? "HOSTILE LINE CLEARED" : combatIntentText();
      }, COMBAT_FORMATION_READY_MS, entryRunId);
      combatPresentationTimer(completeEntry, COMBAT_ENTRY_COMPLETE_MS, entryRunId);
    }
    return;
  }
  if (els.combatActionBanner) els.combatActionBanner.textContent = encounter.cleared ? "HOSTILE LINE CLEARED" : combatIntentText();
}

function combatPresentationTimer(callback, delay, runId) {
  const timer = window.setTimeout(() => {
    if (runId !== state.combatPresentationRunId) return;
    callback();
  }, delay);
  state.combatPresentationTimers.push(timer);
}

function showCombatFloat(card, text, kind) {
  if (!card) return;
  const node = document.createElement("span");
  node.className = `combat-damage-float ${kind || "damage"}`;
  node.textContent = text;
  card.appendChild(node);
  window.setTimeout(() => node.remove(), 900);
}

function updateCombatEnemyVisual(attack) {
  const card = els.combatEnemyFormation?.querySelector(`[data-enemy-id="${CSS.escape(attack.targetId || "")}"]`);
  if (!card) return;
  const cards = attack.aoe
    ? [...els.combatEnemyFormation.querySelectorAll(".combat-enemy-unit:not(.defeated)")]
    : [card];
  for (const hitCard of cards) {
    hitCard.classList.remove("hit");
    void hitCard.offsetWidth;
    hitCard.classList.add("hit");
    window.setTimeout(() => hitCard.classList.remove("hit"), 650);
  }
  if (cards.some((hitCard) => hitCard.classList.contains("boss"))) {
    els.combatStage?.classList.remove("boss-eyes-hit");
    if (els.combatStage) void els.combatStage.offsetWidth;
    els.combatStage?.classList.add("boss-eyes-hit");
    combatPresentationTimer(() => els.combatStage?.classList.remove("boss-eyes-hit"), 820, state.combatPresentationRunId);
  }
  for (const enemyState of attack.enemyStatesAfter || []) {
    const enemyCard = els.combatEnemyFormation?.querySelector(`[data-enemy-id="${CSS.escape(enemyState.id)}"]`);
    const fill = enemyCard?.querySelector(".combat-unit-hp i");
    const hpLabel = enemyCard?.querySelector("small");
    if (fill) fill.style.width = `${Math.max(0, Math.min(100, enemyState.hp / Math.max(1, enemyState.maxHp || 1) * 100))}%`;
    if (hpLabel) hpLabel.textContent = `${Math.max(0, enemyState.hp)} / ${enemyState.maxHp}`;
  }
  showCombatFloat(card, attack.aoe ? `AOE -${attack.damage}` : `-${attack.damage}`, "damage");
  if (attack.defeated?.length) playEnemyDeathSound(attack.defeated.length);
  if (attack.defeated?.length) {
    const runId = state.combatPresentationRunId;
    combatPresentationTimer(() => {
      for (const enemy of attack.defeated) {
        const defeatedCard = els.combatEnemyFormation?.querySelector(`[data-enemy-id="${CSS.escape(enemy.id)}"]`);
        defeatedCard?.classList.add("defeated");
        window.setTimeout(() => defeatedCard?.remove(), 520);
      }
    }, 260, runId);
  }
}

function playEnemyDeathSound(count = 1) {
  const total = Math.max(1, Math.min(6, Number(count) || 1));
  for (let index = 0; index < total; index += 1) {
    window.setTimeout(() => {
      const audio = new Audio("audio-effects/enemydeath.mp3");
      audio.preload = "auto";
      audio.studyAdventureBaseVolume = state.sfxPreset === "cinematic" ? 0.92 : 0.58;
      audio.volume = effectiveGameSfxVolume(audio);
      setNarrationLowPass(audio, state.ttsPlaybackActive);
      audio.play().catch(() => {});
    }, index * 120);
  }
}

function updateCombatPlayerVisual(hit, card) {
  const maxHp = Math.max(1, Number(hit.target.maxHp) || 1);
  const hpAfter = Math.max(0, Number(hit.hpAfter) || 0);
  const key = normalize(hit.target.name);
  state.combatDisplayedHp[key] = hpAfter;
  const dashboardCard = els.statusGrid?.querySelector(`[data-player-name="${CSS.escape(hit.target.name)}"]`);
  const dashboardHp = dashboardCard?.querySelector(".player-card-stats strong, .status-vitals strong");
  if (dashboardHp) dashboardHp.textContent = `${hpAfter} / ${maxHp} HP`;
  dashboardCard?.classList.toggle("incapacitated", hpAfter <= 0);
  if (!card) {
    publishPlayerVitals();
    return;
  }
  const fill = card.querySelector(".combat-unit-hp i");
  const label = card.querySelector(".combat-unit-hp.party + em") || [...card.querySelectorAll("em")].pop();
  if (fill) fill.style.width = `${Math.max(0, Math.min(100, hpAfter / maxHp * 100))}%`;
  if (label) label.textContent = `${hpAfter} / ${maxHp} HP`;
  card.classList.toggle("down", hpAfter <= 0);
  // Keep field devices in lockstep with the battle presentation instead of
  // waiting for the full round to finish. The payload uses combatDisplayedHp,
  // so each hit publishes the same intermediate value shown on the battle card.
  publishPlayerVitals();
}

function showCombatBubble(card) {
  if (!card) return;
  card.querySelector(".combat-bubble")?.remove();
  const bubble = document.createElement("span");
  bubble.className = "combat-bubble";
  bubble.setAttribute("aria-label", "Protection bubble active");
  card.appendChild(bubble);
}

function clearCombatBubble(card) {
  const bubble = card?.querySelector(".combat-bubble");
  if (!bubble) return;
  bubble.classList.add("spent");
  window.setTimeout(() => bubble.remove(), 320);
}

function showBossClawImpact(card, blocked = false) {
  if (!card) return;
  card.querySelector(".combat-claw-impact")?.remove();
  const claw = document.createElement("span");
  claw.className = `combat-claw-impact${blocked ? " blocked" : ""}`;
  claw.setAttribute("aria-hidden", "true");
  card.appendChild(claw);
  window.setTimeout(() => claw.remove(), 1050);
}

function showFatalRedirectEffect(sourceCard, targetCard) {
  if (!els.combatStage) return;
  els.combatStage.querySelector(".combat-fatal-redirect")?.remove();
  sourceCard?.classList.add("redirect-source");
  targetCard?.classList.add("redirect-target");
  const effect = document.createElement("span");
  effect.className = "combat-fatal-redirect";
  effect.textContent = "RRR // INTERCEPT";
  effect.setAttribute("aria-hidden", "true");
  els.combatStage.appendChild(effect);
  window.setTimeout(() => {
    effect.remove();
    sourceCard?.classList.remove("redirect-source");
    targetCard?.classList.remove("redirect-target");
  }, 980);
}

function showBossSwipeAttack() {
  if (!els.combatStage) return;
  els.combatStage.querySelector(".combat-boss-swipe-trail")?.remove();
  const swipe = document.createElement("span");
  swipe.className = "combat-boss-swipe-trail";
  swipe.setAttribute("aria-hidden", "true");
  els.combatStage.appendChild(swipe);
  window.setTimeout(() => swipe.remove(), 980);
}

function appendCombatActionStatus(log, text) {
  if (!log || !text) return;
  const line = document.createElement("p");
  line.className = "combat-status-live-line";
  line.textContent = text;
  log.appendChild(line);
  const feed = els.statusUpdateFeed;
  window.requestAnimationFrame(() => {
    line.classList.add("visible");
    if (feed) feed.scrollTop = feed.scrollHeight;
  });
}

function showCombatXpAwards(result, runId) {
  const baseline = new Map((result.roundStartPlayers || []).map((player) => [normalize(player.name), player]));
  let awardCount = 0;
  for (const player of state.players) {
    const before = baseline.get(normalize(player.name));
    const gained = Math.max(0, (Number(player.xp) || 0) - (Number(before?.xp) || 0));
    if (!gained) continue;
    awardCount += 1;
    const card = els.combatPartyFormation?.querySelector(`[data-player-name="${CSS.escape(normalize(player.name))}"]`);
    showCombatFloat(card, `+${gained} XP`, "xp");
    if ((Number(player.level) || 1) > (Number(before?.level) || 1)) {
      card?.classList.add("level-up");
      combatPresentationTimer(() => showCombatFloat(card, `LEVEL ${player.level}`, "level"), 520, runId);
    }
  }
  return awardCount;
}

function presentCombatResolution(result, options = {}) {
  if (!result?.combat || !els.combatStage) return;
  state.combatPresentationRunId += 1;
  state.initiativeCurrentTurn = null;
  const runId = state.combatPresentationRunId;
  for (const timer of state.combatPresentationTimers) window.clearTimeout(timer);
  state.combatPresentationTimers = [];
  const playerRoundStart = new Map();
  const roundStartVitals = new Map((result.roundStartVitals || []).map((player) => [normalize(player.name), player]));
  for (const action of result.enemyActions || []) {
    for (const hit of action.targets || []) {
      const key = normalize(hit.target.name);
      if (!playerRoundStart.has(key)) playerRoundStart.set(key, { name: hit.target.name, hp: hit.hpBefore });
    }
  }
  state.combatDisplayedHp = Object.fromEntries(state.players.map((player) => {
    const snapshot = roundStartVitals.get(normalize(player.name)) || playerRoundStart.get(normalize(player.name));
    return [normalize(player.name), snapshot ? snapshot.hp : player.hp];
  }));
  renderCombatStage(result.encounter, {
    enemyStates: result.roundStartEnemies,
    playerStates: state.players.map((player) => {
      const snapshot = roundStartVitals.get(normalize(player.name)) || playerRoundStart.get(normalize(player.name));
      return snapshot || { name: player.name, hp: player.hp, maxHp: player.maxHp, incapacitated: player.incapacitated };
    }),
    playerResults: result.combatPlayerResults,
    beforeRound: true
  });
  // Publish the round-start snapshot before the first incoming attack so
  // devices never jump straight to the round's final HP values.
  publishPlayerVitals();
  els.combatStage.classList.add("resolving");
  const statusLog = renderCombatRoundStatus(result, { deferLines: true });
  let cursor = 520;
  for (const ability of result.combatSupportEvents || []) {
    combatPresentationTimer(() => {
      setInitiativeCurrentTurn("ability", ability.source);
      const sourceCard = els.combatPartyFormation?.querySelector(`[data-player-name="${CSS.escape(normalize(ability.source))}"]`);
      const targetCard = els.combatPartyFormation?.querySelector(`[data-player-name="${CSS.escape(normalize(ability.target || ability.source))}"]`);
      sourceCard?.classList.add("ability-casting");
      targetCard?.classList.add(ability.kind === "heal" || ability.kind === "regen" ? "healing" : "ability-targeted");
      if (ability.kind === "bubble") showCombatBubble(targetCard);
      if ((ability.kind === "heal" || ability.kind === "regen") && ability.target) {
        const targetPlayer = state.players.find((player) => sameName(player.name, ability.target));
        if (targetPlayer) {
          const key = normalize(targetPlayer.name);
          const beforeHp = Number(state.combatDisplayedHp[key]);
          const amount = Math.max(0, Number(ability.amount) || 0);
          const maxHp = Math.max(1, Number(ability.maxHp) || Number(targetPlayer.maxHp) || 1);
          const nextHp = Number.isFinite(Number(ability.hpAfter))
            ? Math.max(0, Number(ability.hpAfter))
            : Math.min(maxHp, (Number.isFinite(beforeHp) ? beforeHp : targetPlayer.hp) + amount);
          updateCombatPlayerVisual({ target: { ...targetPlayer, maxHp }, hpAfter: nextHp }, targetCard);
        }
      }
      els.combatActionBanner.textContent = `${ability.source} — ${String(ability.label || "ABILITY").toUpperCase()}`;
      showCombatFloat(targetCard, ability.kind === "heal" || ability.kind === "regen" ? `+${ability.amount}` : ability.kind === "protocol" ? String(ability.label || "PROTOCOL").toUpperCase() : String(ability.kind || "ABILITY").toUpperCase(), ability.kind === "heal" || ability.kind === "regen" ? "heal" : "block");
      appendCombatActionStatus(statusLog, ability.kind === "heal"
        ? `${ability.source}'s ${ability.label} restores ${ability.target} for ${ability.amount} HP.`
        : ability.kind === "regen"
          ? `${ability.source}'s ${ability.label} restores ${ability.target} for ${ability.amount} HP.`
        : `${ability.source} uses ${ability.label}${ability.target && ability.target !== ability.source ? ` on ${ability.target}` : ""}.`);
      combatPresentationTimer(() => {
        sourceCard?.classList.remove("ability-casting");
        targetCard?.classList.remove("healing", "ability-targeted");
      }, 620, runId);
    }, cursor, runId);
    cursor += 900;
  }
  combatPresentationTimer(() => { els.combatActionBanner.textContent = "PLAYER PHASE — CORRECT ANSWERS ATTACK"; }, cursor, runId);
  cursor += 260;
  for (const attack of result.attackResults || []) {
    combatPresentationTimer(() => {
      setInitiativeCurrentTurn("attack", attack.player.name);
      const playerCard = els.combatPartyFormation?.querySelector(`[data-player-name="${CSS.escape(normalize(attack.player.name))}"]`);
      playerCard?.classList.add("attacking");
      if (attack.empowered) playerCard?.classList.add("empowered");
      if (attack.doubleAttack) playerCard?.classList.add("soldier-double-attack");
      if (attack.doubleAttack) els.combatActionBanner.textContent = `${attack.player.name} — DOUBLE TAP`;
      if (!attack.doubleAttack) els.combatActionBanner.textContent = attack.empowered
        ? `${attack.player.name} — EMPOWERED ABILITY`
        : `${attack.player.name} attacks ${attack.targetLabel}`;
      combatPresentationTimer(() => {
        playerCard?.classList.remove("attacking");
        playGameSfx("damage");
        updateCombatEnemyVisual(attack);
        appendCombatActionStatus(statusLog, `${attack.player.name} attacks ${attack.targetLabel} for ${attack.damage} damage${attack.defeated.length ? ` — KILLING BLOW (${attack.defeated.map((enemy) => enemy.label).join(", ")})` : ""}.`);
        combatPresentationTimer(() => playerCard?.classList.remove("empowered", "soldier-double-attack"), 520, runId);
      }, 500, runId);
    }, cursor, runId);
    cursor += 1350;
  }
  cursor += 650;
  combatPresentationTimer(() => {
    els.combatActionBanner.textContent = result.lockedSuppression
      ? "LOCKED OPERATOR SWEEP — ENEMY PHASE SUPPRESSED"
      : "ENEMY PHASE — INCOMING ATTACKS";
    if (result.lockedSuppression) {
      setInitiativeCurrentTurn();
      const enemyCards = [...(els.combatEnemyFormation?.querySelectorAll(".combat-enemy-unit:not(.defeated)") || [])];
      for (const enemyCard of enemyCards) {
        enemyCard.classList.add("stunned");
        showCombatFloat(enemyCard, "STUNNED", "block");
      }
      appendCombatActionStatus(statusLog, `${result.attackResults[0]?.player.name || "Locked operator"}'s area attack suppresses every enemy activation.`);
      combatPresentationTimer(() => enemyCards.forEach((enemyCard) => enemyCard.classList.remove("stunned")), 850, runId);
    }
  }, cursor, runId);
  cursor += result.lockedSuppression ? 1500 : 950;
  let lastEnemyActionEndsAt = 0;
  const enemyInitiativeOccurrences = new Map();
  for (const action of result.enemyActions || []) {
    combatPresentationTimer(() => {
      if (action.disrupted) setInitiativeCurrentTurn();
      else {
        const enemyKey = normalize(action.enemy.label || "Hostile");
        const occurrence = enemyInitiativeOccurrences.get(enemyKey) || 0;
        enemyInitiativeOccurrences.set(enemyKey, occurrence + 1);
        setInitiativeCurrentTurn("enemy", action.enemy.label || "Hostile", occurrence);
      }
      const enemyCard = els.combatEnemyFormation?.querySelector(`[data-enemy-id="${CSS.escape(action.enemy.id)}"]`);
      const bossSwipe = Boolean(action.enemy.boss && !action.disrupted);
      enemyCard?.classList.remove("attacking", "boss-swiping", "stunned", "hit");
      if (enemyCard) void enemyCard.offsetWidth;
      enemyCard?.classList.add(bossSwipe ? "boss-swiping" : "attacking");
      if (action.disrupted) {
        els.combatActionBanner.textContent = `${action.enemy.label} — ATTACK DISRUPTED`;
        enemyCard?.classList.add("stunned");
        showCombatFloat(enemyCard, "STUNNED", "block");
        appendCombatActionStatus(statusLog, `${action.enemy.label}'s attack is disrupted.`);
      } else {
        const targetNames = (action.targets || []).map((hit) => hit.target.name).join(", ");
        els.combatActionBanner.textContent = bossSwipe
          ? `${action.enemy.label} rakes the battle line — ${targetNames}`
          : `${action.enemy.label} targets ${targetNames}`;
        if (bossSwipe) {
          els.combatStage?.classList.add("boss-eyes-attacking");
          showBossSwipeAttack();
        }
        for (const hit of action.targets || []) {
          const playerCard = els.combatPartyFormation?.querySelector(`[data-player-name="${CSS.escape(normalize(hit.target.name))}"]`);
          playerCard?.classList.remove("blocking", "hit");
          if (playerCard) void playerCard.offsetWidth;
          const fullyProtected = Boolean(hit.blocked || hit.bubbleBlocked || hit.redirected);
          const protectedHit = fullyProtected || Boolean(hit.braced);
          playerCard?.classList.add(protectedHit ? "blocking" : "hit");
          if (bossSwipe) showBossClawImpact(playerCard, fullyProtected);
          if (hit.bubbleBlocked) clearCombatBubble(playerCard);
          const protectionLabel = hit.redirected ? "REDIRECT" : hit.bubbleBlocked ? "BUBBLE" : fullyProtected ? "BLOCKED" : "BRACED";
          const floatText = hit.redirected
            ? "REDIRECTED"
            : fullyProtected
            ? protectionLabel
            : hit.braced
              ? `BRACED\n-${hit.damage}`
              : `-${hit.damage}`;
          showCombatFloat(playerCard, floatText, hit.redirected ? "redirect" : fullyProtected ? "block" : "damage");
          if (fullyProtected) playGameSfx("blocked", { minInterval: 120 });
          if (hit.redirected?.target) {
            const redirectedTarget = hit.redirected.target;
            const redirectedCard = els.combatPartyFormation?.querySelector(`[data-player-name="${CSS.escape(normalize(redirectedTarget.name))}"]`);
            showFatalRedirectEffect(playerCard, redirectedCard);
            showCombatFloat(redirectedCard, "RRR INTERCEPT", "redirect");
          }
          if (!fullyProtected && hit.damage > 0) playGameSfx("damage");
          updateCombatPlayerVisual(hit, playerCard);
          if (hit.redirected?.target) {
            const redirectedTarget = hit.redirected.target;
            const redirectedCard = els.combatPartyFormation?.querySelector(`[data-player-name="${CSS.escape(normalize(redirectedTarget.name))}"]`);
            updateCombatPlayerVisual({ target: redirectedTarget, hpAfter: redirectedTarget.hp }, redirectedCard);
          }
          appendCombatActionStatus(statusLog, hit.redirected
            ? `${hit.target.name}'s fatal damage is redirected to ${hit.redirected.target.name} by RRR at half strength.`
            : hit.bubbleBlocked
              ? `${hit.target.name}'s Engineer bubble absorbs ${action.enemy.label}'s attack.`
              : hit.blocked
                ? `${hit.target.name} braces and blocks ${action.enemy.label}'s attack.`
                : `${action.enemy.label} attacks ${hit.target.name} for ${hit.damage} damage${hit.braced ? ` after bracing (${Math.round(hit.braceMitigation * 100)}% mitigated)` : ""}.`);
          combatPresentationTimer(() => playerCard?.classList.remove("blocking", "hit"), bossSwipe ? 820 : 620, runId);
        }
      }
      combatPresentationTimer(() => {
        enemyCard?.classList.remove("attacking", "boss-swiping", "stunned", "hit");
        if (bossSwipe) els.combatStage?.classList.remove("boss-eyes-attacking");
      }, bossSwipe ? 1080 : 720, runId);
    }, cursor, runId);
    lastEnemyActionEndsAt = cursor + (action.enemy.boss && !action.disrupted ? 1080 : 720);
    cursor += action.enemy.boss && !action.disrupted ? 1900 : 1550;
  }
  const combatFinalizationDelay = result.teamDefeated && lastEnemyActionEndsAt
    ? lastEnemyActionEndsAt + 160
    : cursor + 650;
  combatPresentationTimer(() => {
    if (result.combatCleared) applyCombatVictoryXp(result.encounter);
    renderCombatStage(result.encounter);
    setInitiativeCurrentTurn();
    els.combatStage.classList.remove("resolving");
    els.combatStage.classList.toggle("combat-cleared", Boolean(result.combatCleared));
    els.combatActionBanner.textContent = result.combatCleared ? "HOSTILE LINE CLEARED" : combatIntentText();
    const xpAwardCount = showCombatXpAwards(result, runId);
    if (xpAwardCount) els.combatActionBanner.textContent = `EXPERIENCE AWARDED — ${xpAwardCount} OPERATOR${xpAwardCount === 1 ? "" : "S"}`;
    state.combatDisplayedHp = {};
    renderStatus();
    if (typeof options.onComplete === "function") options.onComplete(result);
    if (result.combatCleared || state.currentNode !== result.encounter.nodeIndex) {
      const beginExit = () => {
        state.combatMountBlocked = true;
        els.combatStage.classList.add("exiting");
        if (!state.bossReadyPending && state.backgroundMusicMode !== "normal") loadBackgroundMusic("normal", { transition: true });
        combatPresentationTimer(() => {
          if (els.combatStage) {
            els.combatStage.hidden = true;
            els.combatStage.classList.remove("exiting");
            syncBossThemePresence();
            // The route can advance while the fade is still running. If the
            // destination is another combat node, retry the mount after the
            // old stage is fully clear instead of leaving the new room behind
            // a stale hidden/exiting overlay.
            if (state.currentNode !== result.encounter.nodeIndex) {
              state.combatMountBlocked = false;
              renderMap();
            }
          }
        }, 1400, runId);
      };
      const finalBossDefeated = Boolean(result.combatCleared && result.encounter.roomType === "boss" && state.nodes?.[result.encounter.nodeIndex]?.bossPhase === "final");
      if (finalBossDefeated) {
        els.combatStage.classList.add("final-boss-defeated");
        els.combatActionBanner.textContent = "CRITICAL HOSTILE NEUTRALIZED";
      }
      const rewardOpened = result.combatCleared && openItemRewardChoices(result.encounter);
      if (rewardOpened) {
        state.pendingRewardExit = () => {
          if (xpAwardCount) combatPresentationTimer(beginExit, 350, runId);
          else beginExit();
        };
      } else if (finalBossDefeated) combatPresentationTimer(beginExit, 2300, runId);
      else if (xpAwardCount) combatPresentationTimer(beginExit, 1650, runId);
      else beginExit();
    }
  }, combatFinalizationDelay, runId);
}

function renderCombatRoundStatus(result, options = {}) {
  if (!result?.combatStatusLog || !els.statusUpdateFeed) return;
  const log = document.createElement("div");
  log.className = "damage-log combat-round-log";
  if (!options.deferLines) result.combatStatusLog.split(/\r?\n/).filter(Boolean).forEach((text) => appendCombatActionStatus(log, text));
  appendStatusUpdateLog(log, null);
  return log;
}

function routeMarkerPixelPoint(position) {
  if (!position || !els.mapWrap || !els.missionMap) return null;
  const svgRect = els.missionMap.getBoundingClientRect();
  const wrapRect = els.mapWrap.getBoundingClientRect();
  const viewBox = els.missionMap.viewBox?.baseVal;
  const wrapScaleX = wrapRect.width / els.mapWrap.offsetWidth;
  const wrapScaleY = wrapRect.height / els.mapWrap.offsetHeight;
  if (!viewBox?.width || !viewBox?.height || !svgRect.width || !svgRect.height || !wrapScaleX || !wrapScaleY) return null;
  // The live console is scaled to fit the viewport. Convert visual rects back
  // into the map-wrap's logical CSS pixels before positioning the HTML marker,
  // otherwise the dashboard scale is applied a second time.
  const svgWidth = svgRect.width / wrapScaleX;
  const svgHeight = svgRect.height / wrapScaleY;
  const svgLeft = (svgRect.left - wrapRect.left) / wrapScaleX - els.mapWrap.clientLeft;
  const svgTop = (svgRect.top - wrapRect.top) / wrapScaleY - els.mapWrap.clientTop;
  const scale = Math.min(svgWidth / viewBox.width, svgHeight / viewBox.height);
  const contentWidth = viewBox.width * scale;
  const contentHeight = viewBox.height * scale;
  return {
    x: svgLeft + (svgWidth - contentWidth) / 2 + (position.x - viewBox.x) * scale,
    y: svgTop + (svgHeight - contentHeight) / 2 + (position.y - viewBox.y) * scale
  };
}

function routeMarkerTransform(point) {
  return `translate3d(${point.x}px, ${point.y}px, 0) translate3d(-50%, -50%, 0)`;
}

function hideHtmlRouteMarker() {
  if (!els.squadMapMarker) return;
  if (state.routeMarkerAnimationFrame) window.cancelAnimationFrame(state.routeMarkerAnimationFrame);
  state.routeMarkerAnimationFrame = 0;
  window.clearTimeout(state.routeMarkerSettleTimer);
  state.routeMarkerSettleTimer = null;
  state.routeMarkerAnimationKey = "";
  els.squadMapMarker.hidden = true;
  els.squadMapMarker.classList.remove("traveling", "incorrect");
}

function syncHtmlRouteMarker(positions, routeVisible) {
  const marker = els.squadMapMarker;
  if (!marker || !state.started || !routeVisible || !positions.length) {
    hideHtmlRouteMarker();
    return;
  }
  const transition = state.transmissionPending && state.routeTransition?.moving
    ? state.routeTransition
    : null;
  const targetIndex = transition ? transition.to : state.currentNode;
  const targetPoint = routeMarkerPixelPoint(positions[targetIndex]);
  if (!targetPoint) {
    hideHtmlRouteMarker();
    return;
  }
  marker.hidden = false;
  marker.classList.toggle("incorrect", Boolean(transition && !transition.correct));
  if (!transition) {
    if (state.routeMarkerAnimationFrame) window.cancelAnimationFrame(state.routeMarkerAnimationFrame);
    state.routeMarkerAnimationFrame = 0;
    window.clearTimeout(state.routeMarkerSettleTimer);
    state.routeMarkerSettleTimer = null;
    state.routeMarkerAnimationKey = "";
    marker.classList.remove("traveling");
    marker.style.transform = routeMarkerTransform(targetPoint);
    return;
  }

  const animationKey = `${transition.from}:${transition.to}:${state.transmissionStartedAt}`;
  if (state.routeMarkerAnimationKey === animationKey) return;
  const startPoint = routeMarkerPixelPoint(positions[transition.from]);
  if (!startPoint) return;
  const travelDuration = routeTravelDurationMs(transition);
  state.routeMarkerAnimationKey = animationKey;
  marker.classList.remove("traveling");
  marker.style.setProperty("--route-travel-duration", `${travelDuration}ms`);
  marker.style.transform = routeMarkerTransform(startPoint);
  state.routeMarkerAnimationFrame = window.requestAnimationFrame(() => {
    state.routeMarkerAnimationFrame = window.requestAnimationFrame(() => {
      state.routeMarkerAnimationFrame = 0;
      if (state.routeMarkerAnimationKey !== animationKey || marker.hidden) return;
      marker.classList.add("traveling");
      marker.style.transform = routeMarkerTransform(targetPoint);
      window.clearTimeout(state.routeMarkerSettleTimer);
      state.routeMarkerSettleTimer = window.setTimeout(() => {
        if (state.routeMarkerAnimationKey === animationKey) marker.classList.remove("traveling");
        state.routeMarkerSettleTimer = null;
      }, travelDuration + 80);
    });
  });
}

function renderMapQuestionOverlay() {
  if (!els.mapQuestionOverlay) return;
  const info = currentQuestionInfo();
  const node = state.nodes[state.currentNode];
  const combatTransitionActive = !els.combatStage?.hidden && (
    els.combatStage?.classList.contains("resolving")
    || els.combatStage?.classList.contains("exiting")
  );
  const combatRevealPending = combatTransitionActive || isCombatNode(node) && (
    !state.combatStageEnteredNodes.has(state.currentNode)
    || els.combatStage?.classList.contains("entering")
    || els.combatStage?.classList.contains("exiting")
  );
  if (combatRevealPending) {
    fadeMapQuestionOverlay();
    return;
  }
  const canShowQuestionSurface = Boolean(
    state.started
    && (!state.chatMode || state.teamReady)
    && !state.resolved
    && !state.answerPending
    && !state.transmissionPending
    && info.question
    && node?.type !== "recovery"
  );
  const showAlert = canShowQuestionSurface && state.mapQuestionAlertActive && !state.questionSurfaceVisible && !state.questionPresentationReady;
  const show = canShowQuestionSurface && (state.questionSurfaceVisible || state.questionPresentationReady);

  if (!show && !showAlert) {
    fadeMapQuestionOverlay();
    return;
  }

  els.mapPanel.classList.add("question-open");

  if (state.mapQuestionOverlayHideTimer) {
    window.clearTimeout(state.mapQuestionOverlayHideTimer);
    state.mapQuestionOverlayHideTimer = null;
  }

  if (showAlert) {
    const heading = `${info.areaName || roomName(state.nodes[state.currentNode] || { type: "challenge" }, state.currentNode)} - ${formatEncounterTag(info.type.label)}`;
    const overlayKey = [
      "query-alert",
      state.currentQuestion,
      state.currentNode,
      info.question.mode,
      info.type.kind,
      heading,
      info.question.question
    ].join("::");
    const alreadyVisible = !els.mapQuestionOverlay.hidden && els.mapQuestionOverlay.classList.contains("visible");
    if (alreadyVisible && overlayKey === state.mapQuestionOverlayKey) return;
    state.mapQuestionOverlayKey = overlayKey;
    const alertText = state.actionDrivenMode || info.type.kind === "action" ? "! Alert !" : "! Query Incoming !";
    els.mapQuestionOverlay.innerHTML = `
      <div class="map-query-alert" aria-live="polite">
        <span>${escapeHtml(alertText)}</span>
      </div>
    `;
    els.mapQuestionOverlay.hidden = false;
    els.mapQuestionOverlay.classList.remove("fading");
    window.requestAnimationFrame(() => els.mapQuestionOverlay.classList.add("visible"));
    return;
  }

  const progress = mapQuestionResponseProgress(info);
  const choices = info.question.mode === "action"
    ? `<div class="map-question-fill">Player actions required</div>`
    : info.question.mode === "multiple"
    ? `<div class="map-question-choices">${info.question.choices.map((choice) => `<span>${escapeHtml(choice.key)}. ${escapeHtml(choice.text)}</span>`).join("")}</div>`
    : `<div class="map-question-fill">Short response required</div>`;
  const heading = `${info.areaName || roomName(state.nodes[state.currentNode] || { type: "challenge" }, state.currentNode)} - ${formatEncounterTag(info.type.label)}`;
  const overlayKey = [
    "question",
    state.currentQuestion,
    state.currentNode,
    heading,
    info.question.mode,
    info.type.kind,
    info.question.question,
    info.question.mode === "multiple" ? info.question.choices.map((choice) => `${choice.key}:${choice.text}`).join("|") : ""
  ].join("::");
  const alreadyVisible = !els.mapQuestionOverlay.hidden && els.mapQuestionOverlay.classList.contains("visible");

  if (alreadyVisible && overlayKey === state.mapQuestionOverlayKey) {
    const progressNode = els.mapQuestionOverlay.querySelector(".map-question-topline strong");
    if (progressNode) progressNode.textContent = progress;
    return;
  }
  state.mapQuestionOverlayKey = overlayKey;

  els.mapQuestionOverlay.innerHTML = `
    <div class="map-question-card">
      <div class="map-question-topline">
        <span>${escapeHtml(heading)}</span>
        <strong>${escapeHtml(progress)}</strong>
      </div>
      <p>${escapeHtml(displayQuestionText(info.question))}</p>
      ${choices}
    </div>
  `;
  els.mapQuestionOverlay.hidden = false;
  els.mapQuestionOverlay.classList.remove("fading");
  if (alreadyVisible) {
    els.mapQuestionOverlay.classList.add("visible");
  } else {
    window.requestAnimationFrame(() => els.mapQuestionOverlay.classList.add("visible"));
  }
}

function mapQuestionResponseProgress(info) {
  if (state.deviceMode !== "multi") return "Teacher input active";
  if (state.actionDrivenMode || info.type.kind === "action") {
    const required = requiredDeviceAnswerNames(info);
    const submitted = new Set(currentActionEntries().map((action) => normalize(action.playerName)));
    const count = required.size ? [...required].filter((name) => submitted.has(name)).length : currentActionEntries().length;
    return required.size ? `${count} / ${required.size} actions` : `${count} action${count === 1 ? "" : "s"}`;
  }
  if (info.type.kind === "emergency") return "First response locks in";
  const required = requiredDeviceAnswerNames(info);
  if (!required.size) return "Collecting responses";
  const submitted = new Set(state.playerAnswers.map((answer) => normalize(answer.playerName)));
  const count = [...required].filter((name) => submitted.has(name)).length;
  if (info.type.locked && info.operator) {
    const operatorSubmitted = submitted.has(normalize(info.operator.name));
    return operatorSubmitted
      ? `${count} / ${required.size} responses · ${info.operator.name} locked in`
      : `Waiting for ${info.operator.name}`;
  }
  return `${count} / ${required.size} responses`;
}

function fadeMapQuestionOverlay(callback) {
  if (!els.mapQuestionOverlay || els.mapQuestionOverlay.hidden) {
    els.mapPanel?.classList.remove("question-open");
    if (callback) callback();
    return;
  }
  if (state.mapQuestionOverlayHideTimer) window.clearTimeout(state.mapQuestionOverlayHideTimer);
  els.mapPanel?.classList.remove("question-open");
  els.mapQuestionOverlay.classList.add("fading");
  els.mapQuestionOverlay.classList.remove("visible");
  state.mapQuestionOverlayHideTimer = window.setTimeout(() => {
    els.mapQuestionOverlay.hidden = true;
    els.mapQuestionOverlay.classList.remove("fading");
    state.mapQuestionOverlayKey = "";
    state.mapQuestionOverlayHideTimer = null;
    if (callback) callback();
  }, 360);
}

function routePositions(count) {
  if (state.mapPositions.length !== count) {
    state.mapLayoutSeed ||= seedFrom(`${state.title}|${state.environment}|${Date.now()}|${Math.random()}`);
    state.mapPositions = generateSprawledRoutePositions(count, state.mapLayoutSeed);
  }
  return state.mapPositions;
}

function generateSprawledRoutePositions(count, seed) {
  if (count <= 0) return [];
  const rng = mulberry32(seed || 1);
  const cols = 6;
  const rows = Math.max(3, Math.ceil(count / 5));
  const starts = [
    { col: Math.floor((cols - 1) / 2), row: Math.floor((rows - 1) / 2) },
    { col: Math.ceil((cols - 1) / 2), row: Math.floor((rows - 1) / 2) },
    { col: Math.floor((cols - 1) / 2), row: Math.ceil((rows - 1) / 2) },
    { col: Math.ceil((cols - 1) / 2), row: Math.ceil((rows - 1) / 2) }
  ];
  const keyFor = (cell) => `${cell.col}:${cell.row}`;
  const neighborCells = (cell) => [
    { col: cell.col + 1, row: cell.row },
    { col: cell.col - 1, row: cell.row },
    { col: cell.col, row: cell.row + 1 },
    { col: cell.col, row: cell.row - 1 }
  ].filter((next) => next.col >= 0 && next.col < cols && next.row >= 0 && next.row < rows);

  let route = null;
  for (let attempt = 0; attempt < 24 && !route; attempt++) {
    const start = starts[Math.floor(rng() * starts.length)];
    const path = [{ ...start }];
    const used = new Set([keyFor(start)]);
    let budget = 24000;
    const walk = () => {
      if (path.length >= count) return true;
      if (budget-- <= 0) return false;
      const current = path[path.length - 1];
      const candidates = neighborCells(current)
        .filter((cell) => !used.has(keyFor(cell)))
        .map((cell) => ({
          ...cell,
          onward: neighborCells(cell).filter((next) => !used.has(keyFor(next))).length,
          edge: Math.min(cell.col, cols - 1 - cell.col) + Math.min(cell.row, rows - 1 - cell.row),
          noise: rng()
        }))
        .sort((a, b) => (a.onward + a.edge * 0.18 + a.noise * 1.4) - (b.onward + b.edge * 0.18 + b.noise * 1.4));
      for (const candidate of candidates) {
        const next = { col: candidate.col, row: candidate.row };
        path.push(next);
        used.add(keyFor(next));
        if (walk()) return true;
        used.delete(keyFor(next));
        path.pop();
      }
      return false;
    };
    if (!walk()) continue;
    const colSpan = Math.max(...path.map((cell) => cell.col)) - Math.min(...path.map((cell) => cell.col));
    const rowSpan = Math.max(...path.map((cell) => cell.row)) - Math.min(...path.map((cell) => cell.row));
    if (count < 5 || (colSpan >= Math.min(3, cols - 1) && rowSpan >= Math.min(2, rows - 1))) route = path;
  }

  if (!route) route = spiralRouteCells(rows, cols).slice(0, count);
  const xGap = 744 / Math.max(1, cols - 1);
  const yGap = Math.max(104, Math.min(122, 520 / Math.max(1, rows - 1)));
  const positions = route.map((cell, index) => ({
    x: 78 + cell.col * xGap + (rng() - 0.5) * 28,
    y: 68 + cell.row * yGap + (rng() - 0.5) * 18 + (index % 2 ? 3 : -3)
  }));
  const offsetX = 450 - positions[0].x;
  const offsetY = 280 - positions[0].y;
  positions.forEach((position) => {
    position.x += offsetX;
    position.y += offsetY;
  });
  return stabilizeRoutePositions(positions, { lockedCount: 1 });
}

function stabilizeRoutePositions(positions, { lockedCount = 0, minDistance = 0 } = {}) {
  const bounds = { minX: 42, maxX: 858, minY: 42, maxY: 506 };
  const spacingTarget = Number(minDistance) > 0
    ? Number(minDistance)
    : positions.length > 26 ? 86 : positions.length > 20 ? 100 : 118;
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const result = positions.map((position) => ({
    x: Number(position?.x) || 450,
    y: Number(position?.y) || 280
  }));
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const isClear = (candidate, index) => result
    .slice(0, index)
    .every((prior) => distance(candidate, prior) >= spacingTarget);

  for (let index = Math.max(0, lockedCount); index < result.length; index += 1) {
    const origin = {
      x: clamp(result[index].x, bounds.minX, bounds.maxX),
      y: clamp(result[index].y, bounds.minY, bounds.maxY)
    };
    result[index] = origin;
    if (isClear(origin, index)) continue;

    let replacement = null;
    for (let ring = 1; ring <= 18 && !replacement; ring += 1) {
      const radius = 22 + ring * 23;
      for (let step = 0; step < 20; step += 1) {
        const angle = ((step * 137.5) + index * 31 + ring * 11) * Math.PI / 180;
        const candidate = {
          x: clamp(origin.x + Math.cos(angle) * radius, bounds.minX, bounds.maxX),
          y: clamp(origin.y + Math.sin(angle) * radius, bounds.minY, bounds.maxY)
        };
        if (isClear(candidate, index)) {
          replacement = candidate;
          break;
        }
      }
    }

    if (!replacement) {
      let bestCandidate = origin;
      let bestScore = -Infinity;
      const gridOffsets = [0, spacingTarget / 2];
      for (const offsetY of gridOffsets) {
        for (const offsetX of gridOffsets) {
          for (let y = bounds.minY + offsetY; y <= bounds.maxY; y += spacingTarget) {
            for (let x = bounds.minX + offsetX; x <= bounds.maxX; x += spacingTarget) {
              const candidate = { x, y };
              if (!isClear(candidate, index)) continue;
              const separation = result
                .slice(0, index)
                .reduce((nearest, prior) => Math.min(nearest, distance(candidate, prior)), Infinity);
              const score = separation - distance(candidate, origin) * 0.08;
              if (score > bestScore) {
                bestScore = score;
                bestCandidate = candidate;
              }
            }
          }
        }
      }
      replacement = bestCandidate;
    }
    result[index] = replacement;
  }
  return result;
}

function spiralRouteCells(rows, cols) {
  const cells = [];
  let top = 0;
  let bottom = rows - 1;
  let left = 0;
  let right = cols - 1;
  while (top <= bottom && left <= right) {
    for (let col = left; col <= right; col++) cells.push({ col, row: top });
    top += 1;
    for (let row = top; row <= bottom; row++) cells.push({ col: right, row });
    right -= 1;
    if (top <= bottom) {
      for (let col = right; col >= left; col--) cells.push({ col, row: bottom });
      bottom -= 1;
    }
    if (left <= right) {
      for (let row = bottom; row >= top; row--) cells.push({ col: left, row });
      left += 1;
    }
  }
  return cells;
}

function roomName(node, index) {
  if (index > state.currentNode) return "Unknown";
  if (state.roomNames[index]) return state.roomNames[index];
  if (node.type === "recovery") return node.afterBoss ? "Emergency Shelter" : node.tier === 1 ? "Medical Bay" : "Maintenance Hub";
  if (node.type === "boss") return bossAreaName(node);
  if (state.actionDrivenMode && node.actionRoom) return state.actionRooms[node.actionRoomIndex || index]?.areaName || "Action Sector";
  const names = ["Relay", "Generator", "Switchgear", "Ops", "Tunnel", "Archive", "Radar", "Pump", "Vault", "Uplink"];
  return names[index % names.length];
}

function bossAreaName(node = {}) {
  const final = node.bossPhase === "final";
  const generated = final ? state.bossAreaNames.final : state.bossAreaNames.mid;
  return generated || generatedBossAreaFallbacks(state.missionType, state.environment, state.threat)[final ? "final" : "mid"];
}

function generatedBossAreaFallbacks(type, environment, threat) {
  const key = normalize(type);
  const env = cleanBriefingField(environment || "the facility").replace(/^the\s+/i, "");
  const pools = {
    horror: {
      mid: ["Black Relay Ward", "Signal Ossuary", "Static Service Crypt"],
      final: ["The Dead Channel", "Blackout Heart", "The Silent Threshold"]
    },
    "military thriller": {
      mid: ["Command Breach Gallery", "Kill-Zone Relay", "Forward Control Pit"],
      final: ["Last Command Vault", "Primary Denial Chamber", "The Black Site Nerve"]
    },
    "sci fi survival": {
      mid: ["Containment Spine", "Reactor Scar", "Auxiliary Breach Deck"],
      final: ["Event Horizon Core", "Zero-Point Crucible", "The Dark Matter Crown"]
    },
    cyberpunk: {
      mid: ["Neon Firewall Pit", "Black ICE Arcade", "Subgrid Kill Floor"],
      final: ["Root Access Cathedral", "The Corpo Nerve", "Ghostline Citadel"]
    },
    fantasy: {
      mid: ["Runebound Relay", "Iron Sigil Crossing", "Arcane Breaker Hall"],
      final: ["The Crowned Engine", "Heartforge Sanctum", "Stormglass Throne"]
    },
    "post apocalyptic": {
      mid: ["Ashline Control", "Rusted Pump Bastion", "Dead Grid Station"],
      final: ["Last Light Furnace", "The Broken Citadel", "Dustcore Vault"]
    },
    "naval operations": {
      mid: ["Flooded Sonar Well", "Torpedo Control Breach", "Pressure Lock Gallery"],
      final: ["Abyssal Command Room", "The Drowned Reactor", "Keelheart Control"]
    },
    "space station": {
      mid: ["Vacuum Relay Deck", "Docking Spine Breach", "Orbital Control Scar"],
      final: ["Command Gravity Well", "The Airless Crown", "Station Heartline"]
    },
    "alien survival": {
      mid: ["Xenoformed Relay", "Molting Access Nest", "Bioelectric Choke"],
      final: ["The Brood Signal", "Hive-Root Chamber", "The Living Antenna"]
    }
  };
  const pool = pools[key] || {
    mid: [`${env} Breach Point`, "Hostile Relay Crossing", "Containment Break"],
    final: [`${env} Last Gate`, "Primary Threat Chamber", "Final Containment Line"]
  };
  const seed = seedFrom(`${type}|${environment}|${threat || ""}`);
  return {
    mid: pool.mid[seed % pool.mid.length],
    final: pool.final[(seed >> 2) % pool.final.length]
  };
}

function renderChallenge(node) {
  clearTypewriters();
  resetStatusUpdates();
  state.answerResults = {};
  state.playerAnswerFeedback = {};
  state.questionPresentationReady = false;
  const presentationRunId = beginLogPresentation();
  const q = state.questions[state.currentQuestion];
  const type = challengeType(state.currentQuestion, state.questions.length);
  const operator = type.locked ? selectOperator(state.currentQuestion) : null;
  const setup = makeSetup(type, operator, q);
  state.encounter = { node, question: q, type, operator };
  state.resolved = false;
  state.selectedEMS = false;

  els.encounterCard.innerHTML = `
    <span class="encounter-tag">${escapeHtml(formatEncounterTag(type.label))}</span>
    <h3>${escapeHtml(setup.heading)}</h3>
    <p class="typewriter" data-text="${escapeAttribute(setup.story)}"></p>
  `;

  els.answerControls.innerHTML = "";
  typeQueuedText(els.encounterCard).then(() => {
    const questionBlock = els.encounterCard.querySelector(".question-text");
    if (questionBlock) questionBlock.classList.remove("pending-content");
    finishLogPresentation(presentationRunId);
    queueMapQuestionReveal(() => {
      startEmergencyTimerForCurrentEncounter(type, { publish: false });
      publishCurrentPlayerPrompt({ renderOverlay: false });
      if (state.deviceMode === "single") renderAnswerControls(q);
    });
  });
}

function renderChatCheckpoint(node) {
  clearTypewriters();
  state.answerResults = {};
  state.playerAnswerFeedback = {};
  const actionRoom = state.actionDrivenMode ? state.actionRooms[state.currentQuestion] : null;
  const type = actionRoom
    ? { label: actionRoom.label || "Action Turn", kind: "action", actionRoom: true }
    : challengeType(node.questionIndex, state.questions.length);
  state.encounter = { node, type };
  state.resolved = false;
  state.selectedEMS = false;

  const openingBriefing = state.currentQuestion === 0 && !state.readinessLogged;
  const room = openingBriefing ? "" : roomName(node, state.currentNode);
  els.encounterCard.innerHTML = `
    ${room ? `<h3 class="mission-room-heading">${escapeHtml(room)}</h3>` : ""}
    <div id="chatTranscript" class="chat-transcript"></div>
  `;

  if (state.currentQuestion === 0 && !state.readinessLogged) {
    state.readinessLogged = true;
    const briefing = state.currentBriefing || fallbackBriefing();
    const openingStory = state.openingLogStory || missionBriefingLogStory(briefing, fallbackOpeningIntro(briefing));
    appendTranscript({
      tag: "Mission Briefing",
      hideLogTag: true,
      suppressRoomNameUpdate: true,
      story: openingStory,
      speechText: missionBriefingSpeechText(briefing, openingStory),
      teamReadyGate: true
    });
    return;
  }

  if (state.bossTestMode && state.teamReady && !state.bossTestPromptStarted) {
    state.bossTestPromptStarted = true;
    const currentNode = state.nodes[state.currentNode];
    if (currentNode?.type === "boss" && !state.bossReadyChecks.has(state.currentNode)) {
      appendTranscript({
        tag: "Readiness Check",
        areaName: bossAreaName(currentNode),
        story: `The test route is staged at ${bossAreaName(currentNode)}. The pressure ahead holds until the team chooses to begin critical contact.`,
        readyCheck: true,
        bossNodeIndex: state.currentNode,
        bossPhase: currentNode.bossPhase || "final",
        recordHistory: false
      });
    } else {
      appendBossTestCheckpointPrompt();
    }
    return;
  }

  if (state.actionDrivenMode && state.teamReady) {
    appendActionRoomPrompt();
    return;
  }

  renderChatControls();
}

function appendActionRoomPrompt() {
  const info = currentQuestionInfo();
  state.questionPresentationReady = false;
  state.actionReceiptLogKey = "";
  const showWaiting = !info.actionRoom?.openingPayload;
  if (showWaiting) startPassiveTransmissionFeedback({ type: info.type || { label: info.tag || "Action Room" } });
  preloadActionRoomOpening(info)
    .then((parsed) => {
      if (showWaiting) stopTransmissionFeedback();
      appendTranscript({
        tag: info.tag,
        areaName: info.areaName,
        story: parsed.opening,
        activeObstacle: info.activeObstacle,
        question: info.questionText,
        recordHistory: true
      });
    })
    .catch(() => {
      if (showWaiting) stopTransmissionFeedback();
      const fallback = actionRoomOpeningFallback(info);
      appendTranscript({
        tag: info.tag,
        areaName: info.areaName,
        story: fallback,
        activeObstacle: info.activeObstacle,
        question: info.questionText,
        recordHistory: true
      });
    });
}

function preloadActionRoomOpening(info = currentQuestionInfo()) {
  const room = info?.actionRoom;
  if (!state.actionDrivenMode || !room) return Promise.resolve(null);
  if (room.openingPayload) return Promise.resolve(room.openingPayload);
  if (room.openingPromise) return room.openingPromise;
  const fallback = actionRoomOpeningFallback(info);
  room.openingPromise = ensureActionRoomDetails(info)
    .then(() => requestOllama(makeLocalActionRoomDescriptionPrompt(info), { temperature: 0.78 }))
    .then((text) => {
      const parsed = parseActionRoomDescriptionResponse(text, info, fallback);
      room.openingPayload = parsed;
      logRoomDebug(`Room description: ${info.areaName}`, {
        roomType: info.tag,
        raw: text,
        parsed,
        trackedEntities: room.entities || []
      });
      return parsed;
    })
    .catch((error) => {
      const parsed = {
        opening: fallback,
        generatedEntityCount: 0,
        entities: room.entities || []
      };
      room.openingPayload = parsed;
      logRoomDebug(`Room opening fallback: ${info.areaName}`, {
        roomType: info.tag,
        error: error?.message || "",
        fallback,
        trackedEntities: room.entities || []
      });
      return parsed;
    })
    .finally(() => {
      room.openingPromise = null;
    });
  return room.openingPromise;
}

function parseActionRoomDescriptionResponse(text, info, fallback) {
  const room = info.actionRoom || {};
  const parsed = parseJsonObjectFromText(text);
  if (parsed && typeof parsed === "object") {
    const opening = cleanLocalNarration(parsed.opening || parsed.story || parsed.text || "") || fallback;
    return {
      opening,
      entities: room.entities || []
    };
  }
  const opening = cleanLocalNarration(text) || fallback;
  return {
    opening,
    entities: room.entities || []
  };
}

function ensureActionRoomDetails(info) {
  const room = info.actionRoom || {};
  if (!room || room.entitiesGenerated) return Promise.resolve(room.entities || []);
  if (room.entityPromise) return room.entityPromise;
  room.entityRequestPending = true;
  room.entityPromise = requestOllama(makeActionRoomEntityPrompt(info), { temperature: 0.32 })
    .then((text) => {
      const generated = parseActionRoomEntities(text, room);
      if (generated.length) room.entities = mergeRoomEntities(room.entities || [], generated);
      room.entitiesGenerated = true;
      logRoomDebug(`Room details: ${info.areaName}`, {
        raw: text,
        generatedCount: generated.length,
        trackedEntities: room.entities || []
      });
      return room.entities || [];
    })
    .catch((error) => {
      room.entitiesGenerated = true;
      logRoomDebug(`Room details fallback: ${info.areaName}`, {
        error: error?.message || "",
        trackedEntities: room.entities || []
      });
      return room.entities || [];
    })
    .finally(() => {
      room.entityRequestPending = false;
      room.entityPromise = null;
    });
  return room.entityPromise;
}

function requestActionRoomEntities(info) {
  const room = info.actionRoom || {};
  if (!room || room.entitiesGenerated || room.entityRequestPending) return;
  room.entityRequestPending = true;
  requestOllama(makeActionRoomEntityPrompt(info), { temperature: 0.32 })
    .then((text) => {
      const generated = parseActionRoomEntities(text, room);
      if (generated.length) room.entities = mergeRoomEntities(room.entities || [], generated);
      room.entitiesGenerated = true;
      logRoomDebug(`Room entities: ${info.areaName}`, {
        raw: text,
        generatedCount: generated.length,
        trackedEntities: room.entities
      });
    })
    .catch(() => {
      room.entitiesGenerated = true;
      logRoomDebug(`Room entities fallback: ${info.areaName}`, {
        trackedEntities: room.entities || []
      });
    })
    .finally(() => {
      room.entityRequestPending = false;
    });
}

function makeActionRoomEntityPrompt(info) {
  const room = info.actionRoom || {};
  const dialogueRequirement = room.kind === "dialogue"
    ? "Dialogue room requirement: include at least one npc entity or intelligent presence that can be questioned, calmed, negotiated with, listened to, or read. It may be a survivor, corrupted operator, trapped contact, radio voice, apparition, hostile negotiator, or other mission-appropriate speaker."
    : "";
  return [
    "FINAL OUTPUT ONLY. Return valid JSON only. No markdown.",
    "Create hidden interactable room entities for an action-driven survival room.",
    "Return 4-8 entities. Include ordinary objects, possible supplies/clues, hazards, routes, NPCs, or enemies as appropriate.",
    "Objects can have limited usesRemaining. Enemies should have hp/maxHp/armor/pressure/vulnerabilities. Hazards should have pressure/mitigation/threshold.",
    "Enemy role must be one of: room_threat, persistent_threat_minion, persistent_threat_avatar, final_boss. Use room_threat for ordinary room enemies, persistent_threat_minion for servants or extensions, persistent_threat_avatar for a major temporary manifestation, and final_boss only for the main mission enemy's decisive confrontation.",
    "Also include the enemy role as a tag on enemy entities.",
    "For hazards, include relevant unsafe-interaction tags when appropriate: contact-danger, electrical-contact, heat-contact, chemical-contact, unstable-structure, pressure-danger, noise-triggered, motion-triggered, signal-sensitive, contamination.",
    dialogueRequirement,
    "Use this shape: {\"entities\":[{\"id\":\"short_id\",\"label\":\"room thing\",\"type\":\"object|enemy|hazard|route|npc\",\"role\":\"room_threat|persistent_threat_minion|persistent_threat_avatar|final_boss|none\",\"tags\":[\"searchable\"],\"state\":\"short state\",\"usesRemaining\":1,\"hp\":null,\"maxHp\":null,\"armor\":0,\"pressure\":0,\"mitigation\":0,\"threshold\":0,\"vulnerabilities\":[\"light\"]}]}",
    `Operation: ${state.title}.`,
    `Environment: ${state.environment}.`,
    `Current area: ${info.areaName}.`,
    `Room type: ${room.label || "Action Room"}.`,
    `Room objective: ${room.objective || "progress through the room"}.`,
    `Persistent threat: ${state.threat}; ${compactThreatProfileText()}.`
  ].join("\n");
}

function parseActionRoomEntities(text, room) {
  const parsed = typeof text === "string" ? parseJsonObjectFromText(text) : text;
  const rawEntities = Array.isArray(parsed?.entities) ? parsed.entities : [];
  return rawEntities.map((raw, index) => normalizeRoomEntity(raw, room, index)).filter(Boolean);
}

function normalizeRoomEntity(raw, room, index) {
  const type = normalize(raw?.type || "object").replace(/\s+/g, "-");
  const allowed = new Set(["object", "enemy", "hazard", "route", "npc"]);
  if (!allowed.has(type)) return null;
  const label = sanitizeText(raw.label || raw.name || `${type} ${index + 1}`, { maxLength: 80 });
  const idBase = sanitizeText(raw.id || label, { maxLength: 60 }).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || `${type}_${index + 1}`;
  return makeRoomEntity(idBase, label, type, asArray(raw.tags).map((tag) => normalize(tag).trim()).filter(Boolean), {
    role: raw.role,
    state: sanitizeText(raw.state || "available", { maxLength: 80 }),
    usesRemaining: raw.usesRemaining,
    hp: raw.hp,
    maxHp: raw.maxHp,
    armor: raw.armor,
    pressure: raw.pressure,
    mitigation: raw.mitigation,
    progress: raw.progress,
    threshold: raw.threshold,
    vulnerabilities: asArray(raw.vulnerabilities).map((item) => sanitizeText(item, { maxLength: 40 })).filter(Boolean)
  });
}

function mergeRoomEntities(existing = [], generated = []) {
  const merged = [...existing];
  const seen = new Set(merged.map((entity) => normalize(entity.label)));
  for (const entity of generated) {
    if (seen.has(normalize(entity.label))) continue;
    merged.push(entity);
    seen.add(normalize(entity.label));
  }
  return merged.slice(0, 10);
}

function roomEntitySummary(room) {
  const entities = asArray(room?.entities);
  if (!entities.length) return "No tracked room entities yet.";
  return entities.map((entity) => {
    const parts = [
      `${entity.id}: ${entity.label}`,
      `type ${entity.type}`,
      entity.role && entity.role !== "none" ? `role ${entity.role}` : "",
      entity.tags?.length ? `tags ${entity.tags.join("/")}` : "",
      entity.state ? `state ${entity.state}` : "",
      Number.isFinite(Number(entity.usesRemaining)) ? `uses ${entity.usesRemaining}` : "",
      Number.isFinite(Number(entity.hp)) ? `hp ${entity.hp}/${entity.maxHp || entity.hp}` : "",
      Number.isFinite(Number(entity.armor)) && entity.armor ? `armor ${entity.armor}` : "",
      Number.isFinite(Number(entity.pressure)) && entity.pressure ? `pressure ${entity.pressure}` : "",
      entity.engagedWith ? `engaged with ${entity.engagedWith}` : "",
      Number.isFinite(Number(entity.mitigation)) && entity.mitigation ? `mitigation ${entity.mitigation}` : "",
      Number.isFinite(Number(entity.progress)) && entity.threshold ? `progress ${entity.progress}/${entity.threshold}` : "",
      entity.vulnerabilities?.length ? `vulnerable to ${entity.vulnerabilities.join("/")}` : "",
      entity.earlyBossBoosted ? "early final-boss boost active" : "",
      entity.exhausted ? "exhausted" : "",
      entity.neutralized ? "neutralized" : ""
    ].filter(Boolean);
    return `- ${parts.join(", ")}`;
  }).join("\n");
}

function makeLocalActionRoomDescriptionPrompt(info) {
  const room = info.actionRoom || {};
  const dialogueRequirement = room.kind === "dialogue"
    ? "Dialogue room requirement: the visible scene must clearly include a speaker, NPC, contact, voice, apparition, corrupted operator, or intelligent presence that can be questioned, calmed, negotiated with, listened to, or read. Make that presence visible or audible before the players act."
    : "";
  return dmPrompts.makeActionRoomDescriptionPrompt({
    sentenceRange: narrationSentenceRange("3-5", "2-3"),
    dialogueRequirement,
    pressureSpotlightLine: room.pressureSpotlight && info.operator
      ? `High-pressure spotlight: ${info.operator.name} is singled out and must react immediately. Make the urgency clear in-world without saying reaction window or mechanics.`
      : "End with in-world urgency, such as someone needing to move, stabilize something, search, secure, interpret, or decide quickly.",
    continuityRule: actionThreatContinuityRule(room),
    operation: state.title,
    environment: state.environment,
    areaName: info.areaName,
    roomLabel: room.label || "Action Room",
    roomObjective: room.objective || "progress through the area",
    roomEntities: roomEntitySummary(room),
    threat: state.threat,
    threatProfile: compactThreatProfileText(),
    threatPressure: state.actionThreatPressure
  });
}

function makeLocalActionRoomOpeningPrompt(info) {
  const room = info.actionRoom || {};
  return dmPrompts.makeActionRoomOpeningPrompt({
    sentenceRange: narrationSentenceRange("3-5", "2-3"),
    pressureSpotlightLine: room.pressureSpotlight && info.operator
      ? `High-pressure spotlight: ${info.operator.name} is singled out and must react immediately. Make the urgency clear in-world without saying reaction window or mechanics.`
      : "End the opening with in-world urgency, such as someone needing to move, stabilize something, search, secure, or decide quickly.",
    continuityRule: actionThreatContinuityRule(room),
    operation: state.title,
    environment: state.environment,
    areaName: info.areaName,
    roomLabel: room.label || "Action Room",
    roomObjective: room.objective || "progress through the area",
    roomEntities: roomEntitySummary(room),
    threat: state.threat,
    threatProfile: compactThreatProfileText(),
    threatPressure: state.actionThreatPressure
  });
}

function actionThreatContinuityRule(room = {}) {
  return [
    `Persistent enemy identity: ${state.threat}.`,
    "Continuity rule: keep this same enemy/threat form throughout the room and resolution. Do not swap it into a different enemy type, species, or phenomenon.",
    room.kind === "enemy" ? "This room's danger should show direct contact with that same persistent enemy." : "This room's danger may show environmental effects caused by that same persistent enemy, but the enemy identity must stay consistent."
  ].join(" ");
}

function actionRoomOpeningFallback(info) {
  const room = info.actionRoom || {};
  return `The squad enters ${info.areaName}, where the route refuses to give way cleanly. ${state.threat} leaves signs of pressure around the chamber as the team studies the space for a practical move. The room demands a grounded response: ${room.objective || "the squad must find a way through"}. Someone has to move before the situation worsens.`;
}

function appendBossTestCheckpointPrompt() {
  const info = currentQuestionInfo();
  const story = [
    `The squad is already deep inside ${state.environment}, close enough to feel ${state.threat} pressing through the route ahead.`,
    `${stageObstacleFallback(info.activeObstacle) || fallbackArrivalStaging(info)}`
  ].join(" ");
  appendTranscript({
    tag: info.tag,
    areaName: info.areaName,
    story,
    activeObstacle: info.activeObstacle,
    question: info.questionText,
    recordHistory: false
  });
}

function renderChatControls() {
  syncAnswerControlsDock();
  const presentationLocked = state.teamReady && !state.questionPresentationReady;
  const readyCheckActive = state.bossReadyPending;
  const controlsLocked = state.answerPending || state.sideActionPending || presentationLocked || state.resolved || !state.teamReady || readyCheckActive;
  const emergencyActive = state.emergencyTimer?.kind === "emergency";
  const sideActionUsed = state.sideActionRooms.has(state.currentNode);
  const sideActionAvailable = actionsAllowedThisEncounter();
  const actionModeActive = Boolean(state.actionDrivenMode && state.teamReady && !readyCheckActive);
  const narrowed = new Set(state.narrowedChoices[state.currentQuestion] || []);
  const classHintHtml = state.classHints[state.currentQuestion] ? `<div class="player-class-hint">${escapeHtml(state.classHints[state.currentQuestion])}</div>` : "";
  const fixedAnswerLetters = ["A", "B", "C", "D"];
  const quickAnswers = state.nodes[state.currentNode]?.type === "recovery"
    ? ["A", "B", "C"]
    : state.questions[state.currentQuestion]?.mode === "fill"
    ? []
    : (state.questions[state.currentQuestion]?.choices || []).map((choice) => choice.key);
  const sideActionForm = sideActionAvailable ? `
    <div class="side-action-form">
      <label>
        Team Action
        <div class="answer-submit-row">
          <input id="sideActionInput" type="text" autocomplete="off" placeholder="Search the lockers, inspect the logbook..." ${controlsLocked || emergencyActive || sideActionUsed || state.resolved ? "disabled" : ""}>
          <button id="sideActionBtn" class="secondary" type="button" ${controlsLocked || emergencyActive || sideActionUsed || state.resolved ? "disabled" : ""}>Attempt</button>
        </div>
      </label>
      <div class="answer-submit-state">${state.sideActionPending ? "Receiving team-action transmission..." : sideActionUsed ? "The team has already searched or improvised in this room." : "One optional team action is available in this room."}</div>
    </div>
  ` : "";
  const sideActionOutsideAnswer = state.teamReady && !readyCheckActive && !actionModeActive ? sideActionForm : "";
  const dockedSideAction = state.deviceMode === "single" ? sideActionOutsideAnswer : "";
  const drawerSideAction = state.deviceMode === "single" ? "" : sideActionOutsideAnswer;
  const manualFallbackPanel = state.teamReady && !readyCheckActive && !actionModeActive && state.deviceMode === "multi" ? `
    <section class="manual-fallback teacher-controls-panel">
      <h4>Manual Answer Fallback</h4>
      <form id="manualFallbackAnswerForm">
        ${quickAnswers.length ? `
          <div class="quick-answer-row">
            ${quickAnswers.map((letter) => `<button class="manualFallbackAnswerBtn secondary" data-answer="${letter}" type="button" ${controlsLocked || narrowed.has(letter) ? "disabled" : ""}>${letter}</button>`).join("")}
          </div>
        ` : ""}
        <div class="answer-submit-row">
          <input id="manualFallbackAnswerInput" type="text" autocomplete="off" placeholder="${quickAnswers.length ? "A, B, C, D, or a short answer" : "Enter a short answer"}" ${controlsLocked ? "disabled" : ""}>
          <button type="submit" ${controlsLocked ? "disabled" : ""}>Force Submit</button>
        </div>
      </form>
    </section>
  ` : "";
  const actionEntries = actionModeActive ? currentActionEntries() : [];
  const answerForm = actionModeActive ? `
    <div class="player-answer-form action-mission-form">
      <div id="answerSubmitState" class="answer-submit-state ${state.answerPending ? "pending" : ""}">
        ${state.answerPending ? "Resolving submitted actions. Receiving transmission." : state.deviceMode === "multi" ? `${actionEntries.length} action${actionEntries.length === 1 ? "" : "s"} submitted from player devices.` : "Enter the team's field action, then resolve the room."}
      </div>
      ${state.deviceMode === "single" ? `
        <label>
          Team Action
          <div class="answer-submit-row">
            <input id="singleDeviceActionInput" type="text" autocomplete="off" placeholder="Search, repair, defend, negotiate, scout..." ${controlsLocked ? "disabled" : ""}>
            <button id="singleDeviceActionBtn" class="secondary" type="button" ${controlsLocked ? "disabled" : ""}>Add Action</button>
          </div>
        </label>
      ` : ""}
      <div id="actionSubmissionList" class="answer-submit-state">${actionSubmissionSummary(actionEntries)}</div>
      <div class="dm-actions">
        <button id="resolveActionRoomBtn" type="button" ${controlsLocked || (!actionEntries.length && state.deviceMode === "multi") ? "disabled" : ""}>Resolve Actions</button>
      </div>
    </div>
  ` : state.teamReady && !readyCheckActive ? state.deviceMode === "multi" ? `
    <div class="player-answer-form">
      ${classHintHtml}
      <div id="answerSubmitState" class="answer-submit-state ${state.answerPending ? "pending" : ""}">
        ${state.answerPending ? `${escapeHtml(state.lastSubmittedAnswer)}. Receiving transmission.` : presentationLocked ? "Incoming mission prompt..." : "Collecting answers from player devices."}
      </div>
    </div>
  ` : `
    <form id="playerAnswerForm" class="player-answer-form">
      ${classHintHtml}
      <label>
        Player Answer
        <div class="quick-answer-row">
          ${fixedAnswerLetters.map((letter) => `<button class="quickAnswerBtn secondary" data-answer="${letter}" type="button" ${controlsLocked || !quickAnswers.includes(letter) || narrowed.has(letter) ? "disabled" : ""}>${letter}</button>`).join("")}
        </div>
        <div class="answer-submit-row">
          <input id="playerAnswerInput" type="text" autocomplete="off" placeholder="${quickAnswers.length ? "Use the answer buttons" : "Enter a short answer"}" ${controlsLocked || quickAnswers.length ? "disabled" : ""}>
          <button id="submitPlayerAnswerBtn" type="submit" ${controlsLocked || quickAnswers.length ? "disabled" : ""}>Submit</button>
        </div>
      </label>
      <div id="answerSubmitState" class="answer-submit-state ${state.answerPending ? "pending" : ""}">
        ${state.answerPending ? `Answer sent: ${escapeHtml(state.lastSubmittedAnswer)}. Receiving transmission.` : presentationLocked ? "Incoming mission prompt..." : "Submit from here for faster table flow."}
      </div>
    </form>
  ` : state.deviceMode === "single" ? `
    <form id="playerAnswerForm" class="player-answer-form controls-standby">
      <label>
        Player Answer
        <div class="quick-answer-row">
          ${fixedAnswerLetters.map((letter) => `<button class="quickAnswerBtn secondary" data-answer="${letter}" type="button" disabled>${letter}</button>`).join("")}
        </div>
        <div class="answer-submit-row">
          <input id="playerAnswerInput" type="text" autocomplete="off" placeholder="Awaiting active challenge" disabled>
          <button id="submitPlayerAnswerBtn" type="submit" disabled>Submit</button>
        </div>
      </label>
      <div id="answerSubmitState" class="answer-submit-state">Controls standing by.</div>
    </form>
  ` : "";
  const primaryMissionButton = state.teamReady && !readyCheckActive && !actionModeActive
    ? `<div class="dm-actions">
        <button id="primaryMissionBtn" class="secondary" type="button" ${controlsLocked ? "disabled" : ""}>Advance Room</button>
      </div>`
    : "";
  const dmToolsPanel = `
    <section class="dm-tools-panel">
      <h4>DM Tools</h4>
      <div class="local-llm-box">
        <div class="local-llm-header">
          <strong>Local LLM</strong>
          <button id="ollamaTestBtn" class="secondary" type="button">Test</button>
        </div>
        <label>
          Prompt
          <textarea id="ollamaPrompt" rows="3" placeholder="Ask the local DM for a short transition."></textarea>
        </label>
        <div class="dm-actions">
          <button id="ollamaGenerateBtn" class="secondary" type="button">Generate</button>
          <button id="ollamaBroadcastBtn" class="secondary" type="button" disabled>Broadcast Result</button>
        </div>
        <div id="ollamaResult" class="ollama-result">Local DM ready check has not run.</div>
      </div>
      <label>
        Broadcast
        <textarea id="dmBroadcastText" rows="2" placeholder="Optional text for the display."></textarea>
      </label>
      <div class="dm-actions">
        <button id="broadcastBtn" type="button">Broadcast</button>
        <button id="medkitMinusBtn" class="secondary" type="button">Medkit -</button>
        <button id="medkitPlusBtn" class="secondary" type="button">Medkit +</button>
        <button id="emsMinusBtn" class="secondary" type="button">EMS -</button>
        <button id="emsPlusBtn" class="secondary" type="button">EMS +</button>
      </div>
      <div id="playerDmControls" class="player-dm-controls"></div>
    </section>
  `;
  els.answerControls.innerHTML = `
    <div class="dm-console">
      ${answerForm}
      ${dockedSideAction}
    </div>
  `;

  if (els.missionControlsPanel) {
    els.missionControlsPanel.innerHTML = `
      <div class="mission-controls-body">
        ${simulatorAccuracyControlHtml()}
        ${primaryMissionButton}
        ${manualFallbackPanel}
        ${drawerSideAction}
        ${dmToolsPanel}
      </div>
    `;
    bindSimulatorAccuracyControl();
  }

  document.getElementById("primaryMissionBtn")?.addEventListener("click", () => {
    if (state.currentQuestion === 0 && !state.teamReady) confirmTeamReady();
    else if (state.bossReadyPending) confirmBossReady();
    else advanceChatRoom();
  });
  const answerSubmitForm = document.getElementById("playerAnswerForm");
  if (answerSubmitForm) answerSubmitForm.addEventListener("submit", submitPlayerAnswer);
  const manualFallbackForm = document.getElementById("manualFallbackAnswerForm");
  if (manualFallbackForm) manualFallbackForm.addEventListener("submit", submitManualFallbackAnswer);
  const sideActionButton = document.getElementById("sideActionBtn");
  if (sideActionButton) sideActionButton.addEventListener("click", submitLocalSideAction);
  document.getElementById("singleDeviceActionBtn")?.addEventListener("click", addSingleDeviceAction);
  document.getElementById("resolveActionRoomBtn")?.addEventListener("click", resolveActionRoomTurn);
  document.querySelectorAll(".quickAnswerBtn").forEach((button) => {
    button.addEventListener("click", () => submitQuickAnswer(button.dataset.answer));
  });
  document.querySelectorAll(".manualFallbackAnswerBtn").forEach((button) => {
    button.addEventListener("click", () => submitManualFallbackAnswerValue(button.dataset.answer));
  });
  bindEmergencyTimerControls();
  document.getElementById("ollamaTestBtn")?.addEventListener("click", testOllama);
  document.getElementById("ollamaGenerateBtn")?.addEventListener("click", generateOllamaDmText);
  document.getElementById("ollamaBroadcastBtn")?.addEventListener("click", broadcastOllamaResult);
  document.getElementById("broadcastBtn")?.addEventListener("click", broadcastDmText);
  document.getElementById("medkitMinusBtn")?.addEventListener("click", () => adjustInventory("medkits", -1));
  document.getElementById("medkitPlusBtn")?.addEventListener("click", () => adjustInventory("medkits", 1));
  document.getElementById("emsMinusBtn")?.addEventListener("click", () => adjustInventory("ems", -1));
  document.getElementById("emsPlusBtn")?.addEventListener("click", () => adjustInventory("ems", 1));
  renderPlayerDmControls();
  renderUtilityPanels();
}

function confirmTeamReady() {
  state.teamReady = true;
  if (state.deviceMode === "multi" && state.roomCode) {
    publishPlayerSession({ status: "waiting", prompt: null, resetAnswers: false });
  }
  startNormalBackgroundMusicAfterReady();
  playGameSfx("ui");
  state.questionPresentationReady = false;
  state.answerPending = false;
  state.lastSubmittedAnswer = "";
  collapseMissionBriefing();
  if (state.actionDrivenMode) {
    renderChatCheckpoint(state.nodes[state.currentNode] || {});
  } else if (state.localDmMode) {
    startLocalOpening();
  } else {
    appendTranscript({
      tag: "Team Confirmed",
      story: "The briefing packet collapses to the top of the console. The relay chamber is live, and the first mission challenge is cleared for entry."
    });
  }
  renderChatControls();
  checkDmFeed();
}

function confirmBossReady() {
  if (!state.bossReadyPending) return;
  const node = state.nodes[state.currentNode];
  if (!node || node.type !== "boss") return;
  roomTransitionTraceStart("boss readiness to combat prompt", {
    nodeIndex: state.currentNode,
    bossPhase: node.bossPhase || "mid"
  });
  state.bossReadyPending = false;
  window.clearTimeout(state.bossReadyAudioTimer);
  state.bossReadyAudioTimer = null;
  state.bossReadyChecks.add(state.currentNode);
  state.combatMountBlocked = false;
  state.questionPresentationReady = false;
  state.answerPending = false;
  state.lastSubmittedAnswer = "";
  renderMap();

  const qInfo = currentQuestionInfo();
  const fallbackStory = bossOpeningFallback(qInfo);
  appendTranscript({
    tag: qInfo.tag,
    areaName: qInfo.areaName,
    story: "Receiving contact transmission...",
    question: "",
    recordHistory: false
  });
  startPassiveTransmissionFeedback({ type: qInfo.type });

  if (!ENABLE_TRANSITION_NARRATION_GENERATION) {
    roomTransitionTraceEmit("MARK", "boss opening LM skipped", { fallbackChars: fallbackStory.length });
    window.setTimeout(() => {
      stopTransmissionFeedback();
      appendTranscript({
        tag: qInfo.tag,
        areaName: qInfo.areaName,
        story: fallbackStory,
        activeObstacle: qInfo.activeObstacle,
        question: qInfo.questionText
      });
    }, 0);
    return;
  }

  requestOllama(makeLocalBossOpeningPrompt(qInfo), { temperature: 0.82 })
    .then((text) => {
      stopTransmissionFeedback();
      appendTranscript({
        tag: qInfo.tag,
        areaName: qInfo.areaName,
        story: cleanLocalNarration(text) || fallbackStory,
        activeObstacle: qInfo.activeObstacle,
        question: qInfo.questionText
      });
    })
    .catch(() => {
      stopTransmissionFeedback();
      appendTranscript({
        tag: qInfo.tag,
        areaName: qInfo.areaName,
        story: fallbackStory,
        activeObstacle: qInfo.activeObstacle,
        question: qInfo.questionText
      });
    });
}

function startLocalOpening() {
  const fallback = localOpeningPayload();
  appendTranscript({
    tag: "Opening Channel",
    areaName: fallback.areaName,
    story: "Receiving opening transmission...",
    question: "",
    recordHistory: false
  });
  startPassiveTransmissionFeedback({ type: challengeType(0, state.questions.length) });

  requestOllama(makeLocalOpeningPrompt(), { temperature: 0.78 })
    .then((text) => {
      stopTransmissionFeedback();
      appendTranscript({
        ...fallback,
        story: cleanLocalNarration(text) || fallback.story
      });
    })
    .catch(() => {
      stopTransmissionFeedback();
      appendTranscript(fallback);
    });
}

function submitPlayerAnswer(event) {
  event.preventDefault();
  const input = document.getElementById("playerAnswerInput");
  const answer = sanitizeText(input?.value, { maxLength: 180 });
  if (!answer || state.answerPending || state.resolutionDelayPending || state.sideActionPending || !state.questionPresentationReady) return;
  submitPlayerAnswerValue(answer, { source: "teacher-form" });
}

function submitManualFallbackAnswer(event) {
  event.preventDefault();
  const input = document.getElementById("manualFallbackAnswerInput");
  submitManualFallbackAnswerValue(input?.value || "");
}

function submitManualFallbackAnswerValue(answer) {
  const cleanAnswer = sanitizeText(answer, { maxLength: 180 });
  if (!cleanAnswer || state.answerPending || state.resolutionDelayPending || state.sideActionPending || !state.questionPresentationReady) return;
  submitPlayerAnswerValue(cleanAnswer, { source: "manual-fallback" });
}

function submitPlayerAnswerValue(answer, options = {}) {
  const cleanAnswer = answer === TIMEOUT_ANSWER ? answer : sanitizeText(answer, { maxLength: 180 });
  const input = document.getElementById("playerAnswerInput");
  const status = document.getElementById("answerSubmitState");
  const button = document.getElementById("submitPlayerAnswerBtn");
  if (!cleanAnswer || state.answerPending || state.resolutionDelayPending || state.sideActionPending || (!state.questionPresentationReady && !options.timeout)) return;
  const promptId = state.playerPromptId || currentTimerPromptId();
  const source = options.source || (options.timeout ? "timer" : "unknown");
  if (state.deviceMode === "multi" && !options.timeout && source === "unknown") {
    logDebugEvent({
      kind: "state",
      label: "Teacher-side answer blocked",
      detail: `Missing explicit answer source for ${promptId || "current prompt"}`
    });
    return;
  }
  stopTts();
  if (state.emergencyTimer?.kind === "boss") pauseChallengeTimer();
  else stopEmergencyTimer();

  const payload = {
    id: `answer-${Date.now()}`,
    promptId,
    source,
    answer: cleanAnswer,
    timeout: Boolean(options.timeout),
    questionIndex: state.currentQuestion,
    nodeIndex: state.currentNode,
    roomName: roomName(state.nodes[state.currentNode] || { type: "challenge" }, state.currentNode),
    submittedAt: new Date().toISOString()
  };
  logDebugEvent({
    kind: "state",
    label: options.timeout ? "Timer submitted answer" : "Teacher-side answer submitted",
    detail: `${source} | prompt ${promptId || "none"} | answer ${cleanAnswer}`
  });

  state.answerPending = true;
  state.lastSubmittedAnswer = cleanAnswer;
  publishPlayerWaiting("resolving");
  renderChatControls();
  renderInventoryActions();
  renderMapQuestionOverlay();
  if (input) input.disabled = true;
  if (button) button.disabled = true;
  if (status) {
    status.classList.add("pending");
    status.textContent = options.timeout ? "Emergency window expired. Receiving transmission." : `Answer sent: ${cleanAnswer}. Receiving transmission.`;
  }

  fetchWithTimeout("/api/answer", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  }, 10_000)
    .then((response) => {
      if (!response.ok) throw new Error(`Answer service returned ${response.status}`);
      if (state.localDmMode) resolveLocalSubmittedAnswer(cleanAnswer, {
        source,
        submittedAt: payload.submittedAt
      });
    })
    .catch(() => {
      state.answerPending = false;
      renderChatControls();
      const currentStatus = document.getElementById("answerSubmitState");
      if (currentStatus) currentStatus.textContent = "Answer could not be sent. Try again.";
      if (state.started && state.questionPresentationReady && !state.resolved && !state.emergencyTimer) {
        startEmergencyTimerForCurrentEncounter(currentQuestionInfo().type);
      }
    });
}

function submitQuickAnswer(answer) {
  const input = document.getElementById("playerAnswerInput");
  if (input) input.value = answer;
  const form = document.getElementById("playerAnswerForm");
  if (form) form.requestSubmit();
}

function emergencyTimerCardHtml() {
  const timer = state.emergencyTimer;
  if (!timer) return "";
  const seconds = Math.max(0, timer.remainingMs / 1000);
  return `
    <section class="emergency-countdown ${seconds <= 5 ? "critical" : ""} ${seconds <= 3 ? "final-seconds" : ""} ${timer.paused ? "paused" : ""}">
      <div class="emergency-countdown-heading">
        <span>${escapeHtml(timer.starting ? "Prompt opening..." : timer.label || "Challenge Window")}</span>
        <strong class="emergency-countdown-value">${seconds.toFixed(1)}</strong>
      </div>
      <div class="emergency-countdown-track">
        <div class="emergency-countdown-fill" style="width: ${Math.max(0, Math.min(100, (timer.remainingMs / timer.durationMs) * 100))}%"></div>
      </div>
      <button class="emergencyPauseBtn secondary" type="button">${timer.starting ? "Starting..." : timer.paused ? "Resume Timer" : "Pause Timer"}</button>
    </section>
  `;
}

function bindEmergencyTimerControls() {
  document.querySelectorAll(".emergencyPauseBtn").forEach((button) => {
    button.addEventListener("click", toggleEmergencyTimerPause);
  });
}

function startEmergencyTimerForCurrentEncounter(type = challengeType(state.currentQuestion, state.questions.length), options = {}) {
  const node = state.nodes[state.currentNode];
  if (node?.type === "recovery" || type.isRecovery) return;
  if ((!state.emergencyTimerEnabled && !state.actionDrivenMode && type.kind !== "action") || state.resolved || !state.teamReady && state.chatMode) return;
  if (type.boss && state.emergencyTimer?.kind === "boss" && state.emergencyTimer.nodeIndex === state.currentNode) {
    const promptId = currentTimerPromptId();
    state.emergencyTimer.promptId = promptId;
    state.emergencyTimer.questionIndex = state.currentQuestion;
    resumeChallengeTimer();
    renderTimerSurfaces();
    if (options.publish !== false) publishPlayerSession({ status: "open", prompt: buildPlayerPrompt(), resetAnswers: false });
    return;
  }

  stopEmergencyTimer();

  const promptId = currentTimerPromptId();
  const actionInfo = state.actionDrivenMode ? currentQuestionInfo() : null;
  const actionPressure = Boolean(actionInfo?.actionRoom?.pressureSpotlight);
  const durationMs = (type.boss ? 180 : type.kind === "action" || state.actionDrivenMode ? actionPressure ? 10 : 90 : type.kind === "emergency" ? 10 : state.emergencyTimerDuration) * 1000;
  const deliveryGraceMs = state.deviceMode === "multi" ? PLAYER_PROMPT_DELIVERY_GRACE_MS : 0;
  state.emergencyTimer = {
    label: type.boss ? "Boss Encounter Clock" : type.kind === "action" || state.actionDrivenMode ? actionPressure ? `${actionInfo?.operator?.name || "Operator"} Reaction Window` : "Action Window" : type.kind === "emergency" ? "Emergency Response Window" : "Challenge Window",
    kind: type.boss ? "boss" : state.actionDrivenMode ? "action" : type.kind,
    durationMs,
    remainingMs: durationMs,
    deadline: Date.now() + durationMs,
    paused: deliveryGraceMs > 0,
    starting: deliveryGraceMs > 0,
    nodeIndex: state.currentNode,
    questionIndex: state.currentQuestion,
    promptId,
    warningPlayed: false,
    alarmRequired: type.kind === "emergency" || actionPressure,
    alarmPlayed: false
  };
  state.questionDurationMs = durationMs;
  state.questionOpenedAt = Date.now() + deliveryGraceMs;
  state.questionPauseStartedAt = 0;
  state.questionPausedTotalMs = 0;
  state.emergencyTimer.interval = window.setInterval(tickEmergencyTimer, 200);
  applyDashboardAtmosphere();
  if (deliveryGraceMs > 0) {
    const nodeIndex = state.currentNode;
    const questionIndex = state.currentQuestion;
    state.emergencyTimer.startGraceTimer = window.setTimeout(() => {
      const timer = state.emergencyTimer;
      if (!timer || timer.nodeIndex !== nodeIndex || state.currentQuestion !== questionIndex || state.answerPending || state.resolved) return;
      timer.paused = false;
      timer.starting = false;
      timer.deadline = Date.now() + timer.remainingMs;
      startEmergencyAlarmForTimer(timer);
      renderTimerSurfaces();
      publishTimerStateToPlayers();
    }, deliveryGraceMs);
  }
  startEmergencyAlarmForTimer(state.emergencyTimer);
  renderTimerSurfaces();
  if (options.publish !== false) publishPlayerSession({ status: "open", prompt: buildPlayerPrompt(), resetAnswers: false });
}

function startEmergencyAlarmForTimer(timer = state.emergencyTimer) {
  if (!timer || !timer.alarmRequired || timer.alarmPlayed || timer.starting || timer.paused) return;
  timer.alarmPlayed = true;
  playGameSfx("emergency", { minInterval: 0 });
}

function tickEmergencyTimer() {
  const timer = state.emergencyTimer;
  if (!timer || timer.paused) return;
  const previousRemainingMs = timer.remainingMs;
  timer.remainingMs = Math.max(0, timer.deadline - Date.now());
  if (!timer.warningPlayed && timer.remainingMs <= 10_000) {
    timer.warningPlayed = true;
    playGameSfx("timer");
  }
  renderTimerSurfaces();
  if (timer.remainingMs <= 0) handleEmergencyTimeout();
}

function toggleEmergencyTimerPause() {
  const timer = state.emergencyTimer;
  if (!timer) return;
  if (timer.startGraceTimer) {
    window.clearTimeout(timer.startGraceTimer);
    timer.startGraceTimer = null;
  }
  timer.starting = false;
  if (timer.paused) {
    resumeQuestionScoringClock();
    timer.paused = false;
    timer.deadline = Date.now() + timer.remainingMs;
    startEmergencyAlarmForTimer(timer);
  } else {
    timer.remainingMs = Math.max(0, timer.deadline - Date.now());
    timer.paused = true;
    pauseQuestionScoringClock();
    stopGameSfx("timer");
  }
  renderTimerSurfaces();
  publishTimerStateToPlayers();
}

function pauseChallengeTimer() {
  const timer = state.emergencyTimer;
  if (!timer || timer.paused) return;
  if (timer.startGraceTimer) {
    window.clearTimeout(timer.startGraceTimer);
    timer.startGraceTimer = null;
  }
  timer.starting = false;
  timer.remainingMs = Math.max(0, timer.deadline - Date.now());
  timer.paused = true;
  pauseQuestionScoringClock();
  stopGameSfx("timer");
  renderTimerSurfaces();
  publishTimerStateToPlayers();
}

function resumeChallengeTimer() {
  const timer = state.emergencyTimer;
  if (!timer || !timer.paused) return;
  if (timer.startGraceTimer) {
    window.clearTimeout(timer.startGraceTimer);
    timer.startGraceTimer = null;
  }
  timer.starting = false;
  resumeQuestionScoringClock();
  timer.paused = false;
  timer.deadline = Date.now() + timer.remainingMs;
  startEmergencyAlarmForTimer(timer);
  renderTimerSurfaces();
  publishTimerStateToPlayers();
}

function pauseQuestionScoringClock() {
  if (!state.questionOpenedAt || state.questionPauseStartedAt) return;
  state.questionPauseStartedAt = Date.now();
}

function resumeQuestionScoringClock() {
  if (!state.questionPauseStartedAt) return;
  state.questionPausedTotalMs += Math.max(0, Date.now() - state.questionPauseStartedAt);
  state.questionPauseStartedAt = 0;
}

function publishTimerStateToPlayers() {
  if (!state.started || state.deviceMode !== "multi" || !state.roomCode) return;
  publishPlayerSession({ prompt: buildPlayerPrompt(), resetAnswers: false });
}

function stopEmergencyTimer() {
  const timer = state.emergencyTimer;
  if (timer?.interval) window.clearInterval(timer.interval);
  if (timer?.startGraceTimer) window.clearTimeout(timer.startGraceTimer);
  if (timer?.timeoutRetryTimer) window.clearTimeout(timer.timeoutRetryTimer);
  stopGameSfx("timer");
  stopGameSfx("emergency");
  state.emergencyTimer = null;
  renderMapEmergencyTimer();
  applyDashboardAtmosphere();
}

function renderTimerSurfaces() {
  renderMapEmergencyTimer();
  const card = document.querySelector(".emergency-countdown");
  if (!card || !state.emergencyTimer) {
    if (!state.chatMode && state.emergencyTimer && state.encounter?.question) renderAnswerControls(state.encounter.question);
    return;
  }

  const timer = state.emergencyTimer;
  const seconds = Math.max(0, timer.remainingMs / 1000);
  const value = card.querySelector(".emergency-countdown-value");
  const fill = card.querySelector(".emergency-countdown-fill");
  const button = card.querySelector(".emergencyPauseBtn");
  const label = card.querySelector(".emergency-countdown-heading span");
  if (label) label.textContent = timer.starting ? "Prompt opening..." : timer.label || "Challenge Window";
  if (value) value.textContent = seconds.toFixed(1);
  if (fill) fill.style.width = `${Math.max(0, Math.min(100, (timer.remainingMs / timer.durationMs) * 100))}%`;
  if (button) button.textContent = timer.starting ? "Starting..." : timer.paused ? "Resume Timer" : "Pause Timer";
  card.classList.toggle("critical", seconds <= 5);
  card.classList.toggle("final-seconds", seconds <= 3);
  card.classList.toggle("paused", timer.paused);
}

function currentTimerPromptId() {
  const node = state.nodes[state.currentNode];
  if (node?.type === "recovery") return `recovery-${state.currentNode}-${node.tier}`;
  const info = currentQuestionInfo();
  if (!info?.question) return "";
  return `${state.currentQuestion}-${state.currentNode}-${info.question.mode}-${info.type.kind}`;
}

function timerAutoSubmitBlockers(timer) {
  const reasons = [];
  if (!timer) {
    reasons.push("no active timer");
    return reasons;
  }
  if (timer.nodeIndex !== state.currentNode) reasons.push(`timer node ${timer.nodeIndex} no longer matches current node ${state.currentNode}`);
  const expectedPromptId = currentTimerPromptId();
  if (timer.promptId && expectedPromptId && timer.promptId !== expectedPromptId) {
    reasons.push(`timer prompt ${timer.promptId} no longer matches ${expectedPromptId}`);
  }
  if (!state.questionPresentationReady) reasons.push("question is not presented");
  if (state.answerPending) reasons.push("answer is already resolving");
  if (state.sideActionPending) reasons.push("player action is resolving");
  if (state.resolved) reasons.push("encounter is already resolved");
  if (state.logPresentationPending) reasons.push("mission log is still presenting");
  if (state.transmissionPending) reasons.push("transmission is still resolving");
  if (state.nodes[state.currentNode]?.type === "recovery") reasons.push("current node is recovery");
  return reasons;
}

function handleEmergencyTimeout() {
  if (!state.emergencyTimer) return;
  const timer = state.emergencyTimer;
  const blockers = timerAutoSubmitBlockers(timer);
  if (blockers.length) {
    if (!timer.lastTimeoutBlockerLogAt || Date.now() - timer.lastTimeoutBlockerLogAt >= 5_000) {
      timer.lastTimeoutBlockerLogAt = Date.now();
      logDebugEvent({
        kind: "state",
        label: "Timer timeout waiting for recovery",
        detail: blockers.join(" | ")
      });
    }
    timer.paused = true;
    timer.starting = false;
    timer.remainingMs = 0;
    if (!timer.timeoutRetryTimer) {
      timer.timeoutRetryTimer = window.setTimeout(() => {
        timer.timeoutRetryTimer = null;
        if (state.emergencyTimer === timer) handleEmergencyTimeout();
      }, 750);
    }
    renderTimerSurfaces();
    publishTimerStateToPlayers();
    return;
  }
  const kind = timer.kind;
  stopEmergencyTimer();
  if (state.actionDrivenMode || kind === "action") {
    resolveActionRoomTurn({ timeout: true });
    return;
  }
  const info = currentQuestionInfo();
  if (usesIndividualTeamDeviceScoring(info)) {
    const timedOutAnswers = deviceAnswersWithTimeouts(state.playerAnswers);
    logDebugEvent({
      kind: "state",
      label: "Device answer timer expired",
      detail: `${timedOutAnswers.length} response records after filling missing operators`
    });
    resolveLocalDeviceTeamAnswers(timedOutAnswers);
    return;
  }
  if (state.chatMode) {
    submitPlayerAnswerValue(TIMEOUT_ANSWER, { timeout: true, source: "timer" });
  } else {
    resolveChallenge(TIMEOUT_ANSWER, { timeout: true });
  }
}

function deviceAnswersWithTimeouts(answers = []) {
  const existing = [...answers];
  const now = Date.now();
  const byId = new Set(existing.map((answer) => String(answer.playerId || "")).filter(Boolean));
  const byName = new Set(existing.map((answer) => normalize(answer.playerName)));
  const requiredIds = state.playerPromptRequiredIds || [];
  const requiredNames = state.playerPromptRequiredNames || [];
  if (!requiredIds.length && !requiredNames.length) return existing;
  for (const id of requiredIds) {
    if (byId.has(String(id))) continue;
    const participant = state.playerParticipants.find((player) => String(player.id || "") === String(id));
    const playerName = participant?.name || state.players.find((player) => requiredNames.includes(normalize(player.name)))?.name || "Operator";
    existing.push({
      id: `timeout-answer-${now}-${id}`,
      roomCode: state.roomCode,
      promptId: state.playerPromptId,
      answer: TIMEOUT_ANSWER,
      playerId: String(id),
      playerName,
      submittedAt: now,
      timeout: true
    });
    byId.add(String(id));
    byName.add(normalize(playerName));
  }
  for (const name of requiredNames) {
    if (byName.has(name)) continue;
    const player = state.players.find((entry) => normalize(entry.name) === name);
    existing.push({
      id: `timeout-answer-${now}-${name}`,
      roomCode: state.roomCode,
      promptId: state.playerPromptId,
      answer: TIMEOUT_ANSWER,
      playerId: "",
      playerName: player?.name || name || "Operator",
      submittedAt: now,
      timeout: true
    });
    byName.add(name);
  }
  return existing;
}

function submitLocalSideAction() {
  const input = document.getElementById("sideActionInput");
  const action = sanitizeText(input?.value, { maxLength: 180 });
  if (!action || !actionsAllowedThisEncounter() || state.sideActionPending || state.answerPending || !state.questionPresentationReady || state.resolved || state.emergencyTimer?.kind === "emergency") return;
  if (state.sideActionRooms.has(state.currentNode)) return;

  state.sideActionRooms.add(state.currentNode);
  state.sideActionPending = true;
  pauseChallengeTimer();
  publishPlayerWaiting("resolving");
  renderChatControls();
  renderInventoryActions();
  renderTeamActionWaiting(action);
  resolveLocalSideAction(action, { source: "team" });
}

function resolvePlayerSideAction(entry) {
  const action = sanitizeText(entry?.action, { maxLength: 180 });
  const actorName = sanitizeText(entry?.playerName, { maxLength: 32 });
  if (!action || !actorName || !actionsAllowedThisEncounter() || state.sideActionPending || state.answerPending || !state.questionPresentationReady || state.resolved || state.emergencyTimer?.kind === "emergency") return;
  const actor = findSideActionPlayer(actorName);
  if (!actor || actor.incapacitated) return;

  const abilityMatch = action.match(/^ABILITY:(?:ITEM:)?([^:]+)(?::(.+))?$/i);
  if (abilityMatch) {
    const used = useTeacherItemAbility(actor.name, abilityMatch[1], abilityMatch[2] || "", "player");
    if (used) {
      state.playerActions = state.playerActions.filter((queued) => queued.id !== entry.id);
      announceAbilityUse(`${actor.name} activates an item ability from the field device.`);
      publishPlayerSession({ status: "open", prompt: buildPlayerPrompt(), resetAnswers: false });
      renderStatus();
    } else {
      state.playerActions = state.playerActions.filter((queued) => queued.id !== entry.id);
      publishAbilityRejection(actor, action);
    }
    return;
  }
  const classMatch = action.match(/^CLASS:(soldier|medic|scout|enforcer|engineer|tactician)(?::(.*))?$/i);
  if (classMatch) {
    const used = queueClassAbilityUse(actor.name, classMatch[2] || "", "player");
    if (used) {
      state.playerActions = state.playerActions.filter((queued) => queued.id !== entry.id);
      publishPlayerSession({ status: "open", prompt: buildPlayerPrompt(), resetAnswers: false });
    } else {
      state.playerActions = state.playerActions.filter((queued) => queued.id !== entry.id);
      publishAbilityRejection(actor, action);
    }
    return;
  }

  state.sideActionPending = true;
  pauseChallengeTimer();
  publishPlayerSession({ status: "open", prompt: buildPlayerPrompt(), resetAnswers: false });
  renderChatControls();
  renderInventoryActions();
  renderPlayerActionWaiting(actor.name, action);
  resolveLocalSideAction(action, { source: "player", actorName: actor.name });
}

function renderTeamActionWaiting(action) {
  if (!els.encounterCard) return;
  removeSideActionWaiting();
  const entry = document.createElement("section");
  entry.id = `sideActionWaiting-${Date.now()}`;
  entry.className = "transcript-entry team-action-waiting mission-action-overlay";
  state.sideActionWaitingId = entry.id;
  entry.innerHTML = `
    <div class="log-tag">Team Action</div>
    <div class="transmission-display">
      <div class="transmission-heading">
        <strong>RECEIVING TEAM-ACTION TRANSMISSION...</strong>
        <span class="signal-bars" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
      </div>
      <div class="transmission-waveform" aria-hidden="true">
        ${Array.from({ length: 24 }, () => "<i></i>").join("")}
      </div>
      <p>${teamActionWaitingMessage(action)}</p>
    </div>
  `;
  appendMissionActionOverlay(entry);
}

function renderPlayerActionWaiting(playerName, action) {
  if (!els.encounterCard) return;
  removeSideActionWaiting();
  const entry = document.createElement("section");
  entry.id = `sideActionWaiting-${Date.now()}`;
  entry.className = "transcript-entry team-action-waiting mission-action-overlay";
  state.sideActionWaitingId = entry.id;
  entry.innerHTML = `
    <div class="log-tag">Player Action - ${escapeHtml(playerName)}</div>
    <div class="transmission-display">
      <div class="transmission-heading">
        <strong>RECEIVING PLAYER-ACTION TRANSMISSION...</strong>
        <span class="signal-bars" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
      </div>
      <div class="transmission-waveform" aria-hidden="true">
        ${Array.from({ length: 24 }, () => "<i></i>").join("")}
      </div>
      <p>${teamActionWaitingMessage(action)}</p>
    </div>
  `;
  appendMissionActionOverlay(entry);
}

function appendMissionActionOverlay(entry) {
  if (!els.encounterCard || !entry) return;
  els.encounterCard.querySelectorAll(".mission-action-overlay").forEach((overlay) => {
    if (overlay.id !== entry.id) overlay.remove();
  });
  els.encounterCard.appendChild(entry);
}

function removeSideActionWaiting() {
  if (!state.sideActionWaitingId) return;
  const entry = document.getElementById(state.sideActionWaitingId);
  if (entry) entry.remove();
  state.sideActionWaitingId = "";
}

function fadeSideActionWaiting() {
  if (!state.sideActionWaitingId) return;
  const waitingId = state.sideActionWaitingId;
  const entry = document.getElementById(waitingId);
  state.sideActionWaitingId = "";
  if (!entry) return;
  entry.classList.add("action-waiting-fade");
  window.setTimeout(() => {
    if (entry.isConnected) entry.remove();
  }, 420);
}

function appendTemporaryActionDialogue(payload) {
  if (!els.encounterCard) return false;

  const entry = document.createElement("section");
  entry.className = "transcript-entry team-action-waiting action-dialogue mission-action-overlay";

  const tag = document.createElement("div");
  tag.className = "log-tag";
  tag.textContent = payload.tag || "Action";
  entry.appendChild(tag);

  if (payload.story) {
    const story = document.createElement("p");
    story.className = "typewriter";
    story.dataset.text = payload.story;
    entry.appendChild(story);
  }

  appendDamageLog(entry, payload);
  appendMissionActionOverlay(entry);

  if (payload.players?.length) {
    renderStatus();
    flashStatusEffects(payload.players.map((event) => ({ player: findPlayer(event), kind: event.effect, amount: event.amount })).filter((event) => event.player));
  }
  renderInventoryActions();

  typeQueuedText(entry).then(() => {
    window.setTimeout(() => {
      entry.classList.add("action-waiting-fade");
      window.setTimeout(() => {
        if (entry.isConnected) entry.remove();
      }, 420);
    }, ACTION_DIALOGUE_HOLD_MS);
  });
  return true;
}

function teamActionWaitingMessage(action) {
  const text = normalize(action);
  if (/\b(search|look|locker|crate|cache|cabinet)\b/.test(text)) return "Scanning nearby compartments for anything that still has a pulse.";
  if (/\b(read|inspect|study|scan|log|book|manual)\b/.test(text)) return "Filtering damaged records through the field display.";
  if (/\b(repair|fix|wire|bypass|hack|terminal)\b/.test(text)) return "Negotiating with a very unhappy system bus.";
  if (/\b(backflip|dance|sing|joke|impress)\b/.test(text)) return "Command channel holding for whatever this becomes.";
  if (/\b(cut|stab|shoot|break|attack|hit)\b/.test(text)) return "Safety interlocks are complaining loudly.";
  return "Parsing squad initiative against the room telemetry.";
}

function resolveLocalSideAction(action, options = {}) {
  const before = snapshotPlayers();
  const context = currentLocalContext();
  classifyLocalSideAction(action, context)
    .then((classification) => {
      const forcedActor = findSideActionPlayer(options.actorName);
      const actor = forcedActor && !forcedActor.incapacitated ? forcedActor : sideActionActor(action, classification);
      const target = sideActionTarget(action, classification, actor);
      const outcome = rollSideActionOutcome(context, actor, target, classification);
      outcome.source = options.source || "team";
      outcome.areaName = context.question?.area || contextAreaName();
      if (outcome.kind === "bypass") outcome.nextInfo = nextLocalQuestionInfo();
      const playerEvents = changedPlayerEvents(before, outcome.eventNotes);
      const fallback = sideActionFallback(action, actor, outcome);
      const prompt = makeLocalSideActionPrompt(action, actor, outcome, playerEvents);

      return requestOllama(prompt, { temperature: 0.86 })
        .then((text) => finishLocalSideAction(outcome, playerEvents, safeLocalNarration(text, playerEvents, fallback)))
        .catch(() => finishLocalSideAction(outcome, playerEvents, fallback));
    })
    .catch(() => {
      state.sideActionPending = false;
      renderChatControls();
      renderInventoryActions();
    });
}

function classifyLocalSideAction(action, context) {
  const obvious = heuristicSideActionClassification(action);
  if (obvious.confident) return Promise.resolve(obvious);
  return requestOllama(makeLocalSideActionClassificationPrompt(action, context), {
    temperature: 0.1,
    format: "json"
  })
    .then((text) => parseSideActionClassification(text, action))
    .catch(() => heuristicSideActionClassification(action));
}

const sideActionCategories = [
  "search", "inspect", "repair", "explore", "protect", "medical", "assist", "salvage",
  "hack", "communicate", "distract", "craft", "perform", "attack", "reckless", "implausible"
];

const sideActionModifiers = [
  "careful", "reckless", "quiet", "loud", "technical", "physical", "social", "violent",
  "self-targeted", "team-targeted", "threat-targeted", "resource-spending"
];

function makeLocalSideActionClassificationPrompt(action, context) {
  return [
    "Classify one optional action in a survival mission.",
    "Return one JSON object only with fields: category, actor, target, modifiers, rationale.",
    "category must be exactly one of: search, inspect, repair, explore, protect, medical, assist, salvage, hack, communicate, distract, craft, perform, attack, reckless, implausible.",
    "modifiers must be an array using only: careful, reckless, quiet, loud, technical, physical, social, violent, self-targeted, team-targeted, threat-targeted, resource-spending.",
    "Use reckless for deliberate self-harm, attacking a teammate, or knowingly destructive behavior.",
    "Use implausible for actions that cannot occur in the current environment.",
    "Use search for looking through containers or likely supply locations.",
    "Use inspect for reading, scanning, observing, examining records, or studying equipment.",
    "Use repair for rewiring, patching, bypassing, or fixing physical equipment.",
    "Use explore for investigating corridors, rooms, vents, or uncertain spaces.",
    "Use protect for bracing doors, standing guard, shielding the team, or preparing cover.",
    "Use medical for checking injuries, bandaging wounds, or stabilizing a teammate.",
    "Use assist for carrying, rescuing, encouraging, or physically helping a teammate.",
    "Use salvage for stripping useful parts from damaged machinery, drones, or wreckage.",
    "Use hack for accessing terminals, spoofing sensors, or manipulating software and networks.",
    "Use communicate for radio calls, negotiation, questions directed at survivors, or speaking to the threat.",
    "Use distract for deliberately drawing attention away from the team.",
    "Use craft for assembling an improvised tool or protection from available materials.",
    "Use perform for harmless jokes, speeches, singing, dancing, stunts, or social play.",
    "Use attack for attacking the environment or an external threat. Attacks against players are reckless.",
    "actor and target must be player names from the list when explicitly stated; otherwise use an empty string.",
    `Players: ${state.players.map((player) => player.name).join(", ")}.`,
    `Current area: ${context.question?.area || contextAreaName()}.`,
    `Active equipment concept: ${context.question?.question || "unknown"}.`,
    `Action: ${action}`
  ].join("\n");
}

function parseSideActionClassification(text, action) {
  const allowed = new Set(sideActionCategories);
  try {
    const parsed = JSON.parse(String(text || ""));
    const category = normalize(parsed.category).replace(/\s+/g, "-");
    if (!allowed.has(category)) return heuristicSideActionClassification(action);
    return {
      category,
      actor: String(parsed.actor || "").trim(),
      target: String(parsed.target || "").trim(),
      modifiers: cleanSideActionModifiers(parsed.modifiers),
      rationale: String(parsed.rationale || "").trim(),
      originalAction: action,
      confident: true
    };
  } catch {
    return heuristicSideActionClassification(action);
  }
}

function heuristicSideActionClassification(action) {
  const text = normalize(action);
  const modifiers = heuristicSideActionModifiers(text);
  const classify = (category, confident = true) => ({ category, actor: "", target: "", modifiers, rationale: "keyword fallback", originalAction: action, confident });
  if (sideActionDeclaresPlayerHarm(action)) return classify("reckless");
  if (/\b(summon|teleport|helicopter|nuke|spaceship|wish|superman|magic portal|leave the planet)\b/.test(text)) return classify("implausible");
  if (/\b(backflip|flip|dance|sing|song|joke|speech|impress|pose|prank|cheer|taunt)\b/.test(text)) return classify("perform");
  if (/\b(bandag\w*|first aid|medical|medic|wound|pulse|stabiliz\w*|splint\w*|tourniquet|dress(?:es|ed|ing)? the)\b/.test(text)) return classify("medical");
  if (/\b(help\w*|assist\w*|carr(?:y|ies|ied|ying)|drag\w*|pull\w*|lift\w*|rescu\w*|encourag\w*|calm\w*|boost\w*)\b/.test(text)) return classify("assist");
  if (/\b(salvag\w*|strip\w*|harvest\w*|scrap\w*|parts|dead drone|wreckage)\b/.test(text)) return classify("salvage");
  if (/\b(hack\w*|terminal|software|password|code|spoof\w*|sensor|network|uplink)\b/.test(text)) return classify("hack");
  if (/\b(radio\w*|call\w*|speak\w*|talk\w*|ask\w*|negotiat\w*|bargain\w*|signal\w*|distress|contact\w*)\b/.test(text)) return classify("communicate");
  if (/\b(distract\w*|decoy|draw .* attention|make\w* noise|lur\w*|divert\w*|throw\w* .* away)\b/.test(text)) return classify("distract");
  if (/\b(craft\w*|build\w*|assembl\w*|improvis\w*|fashion\w*|make\w* .* tool|make\w* .* shield)\b/.test(text)) return classify("craft");
  if (/\b(search\w*|loot\w*|locker|crate|cabinet|drawer|shelf|pack|bag|body|pocket|container)\b/.test(text)) return classify("search");
  if (/\b(read\w*|inspect\w*|examin\w*|stud\w*|scan\w*|diagnos\w*|log|book|manual|record|schematic|label|note)\b/.test(text)) return classify("inspect");
  if (/\b(repair\w*|fix\w*|bypass\w*|rewir\w*|patch\w*|splic\w*|overrid\w*|jury|connect\w*|rerout\w*|reset\w*)\b/.test(text)) return classify("repair");
  if (/\b(brac\w*|barricad\w*|guard\w*|cover\w*|shield\w*|secur\w*|watch\w*|defend\w*|fortif\w*)\b/.test(text)) return classify("protect");
  if (/\b(shoot(?:s|ing)?|smash(?:es|ed|ing)?|attack(?:s|ed|ing)?|strike[sd]?|hit(?:s|ting)?|break(?:s|ing)?|destroy(?:s|ed|ing)?|fight(?:s|ing)?|kick(?:s|ed|ing)?|punch(?:es|ed|ing)?)\b/.test(text)) return classify("attack");
  if (/\b(explor\w*|corridor|door|vent|tunnel|hall|crawl\w*|investigat\w*|look\w* around|scout\w*)\b/.test(text)) return classify("explore");
  return classify("perform", false);
}

function sideActionDeclaresPlayerHarm(action) {
  const text = normalize(action);
  const harm = "(?:cut(?:s|ting)?|slice(?:s|d|ing)?|stab(?:s|bed|bing)?|shoot(?:s|ing)?|punch(?:es|ed|ing)?|kick(?:s|ed|ing)?|burn(?:s|ed|ing)?|sever(?:s|ed|ing)?|amputat\\w*|injur\\w*|hurt(?:s|ing)?|kill(?:s|ed|ing)?|sacrifice(?:s|d|ing)?)";
  if (new RegExp(`\\b${harm}\\b[^.]{0,48}\\b(?:myself|himself|herself|themself|his|her|their|my)\\b`, "i").test(text)) return true;
  return state.players.some((player) => new RegExp(`\\b${harm}\\b[^.]{0,48}\\b${escapeRegExp(normalize(player.name))}\\b`, "i").test(text));
}

function cleanSideActionModifiers(value) {
  const values = Array.isArray(value) ? value : String(value || "").split(",");
  const allowed = new Set(sideActionModifiers);
  return [...new Set(values.map((item) => normalize(item).replace(/\s+/g, "-")).filter((item) => allowed.has(item)))];
}

function heuristicSideActionModifiers(text) {
  const modifiers = [];
  const add = (name, pattern) => {
    if (pattern.test(text)) modifiers.push(name);
  };
  add("careful", /\b(careful|slow|quietly|gently|cautious)\b/);
  add("reckless", /\b(reckless|wildly|rush|smash|break|cut|stab|shoot)\b/);
  add("quiet", /\b(quiet|silent|whisper|stealth)\b/);
  add("loud", /\b(loud|shout|yell|scream|bang|noise)\b/);
  add("technical", /\b(technical|terminal|hack|rewire|diagnos|scan|sensor|schematic|circuit|network)\b/);
  add("physical", /\b(lift|carry|brace|barricade|punch|kick|climb|crawl|smash)\b/);
  add("social", /\b(impress|joke|speech|encourage|calm|talk|sing|dance|taunt)\b/);
  add("violent", /\b(shoot|stab|kill|smash|attack|punch|kick|sever|amputat)\b/);
  add("self-targeted", /\b(myself|himself|herself|themself|self)\b/);
  add("team-targeted", /\b(team|squad|everyone|group)\b/);
  add("threat-targeted", /\b(ghost|entity|drone|threat|ai|organism|anomaly)\b/);
  add("resource-spending", /\b(use|spend|sacrifice|burn) .*(medkit|ems|battery|parts|supply)\b/);
  return [...new Set(modifiers)];
}

function sideActionActor(action, classification = {}) {
  const named = findSideActionPlayer(classification.actor) || namedPlayersInAction(action)[0];
  return named && !named.incapacitated ? named : randomActivePlayer();
}

function sideActionTarget(action, classification = {}, actor = null) {
  if ((classification.modifiers || []).includes("self-targeted") && actor) return actor;
  const named = findSideActionPlayer(classification.target);
  if (named) return named;
  const mentioned = namedPlayersInAction(action);
  return mentioned[mentioned.length - 1] || actor;
}

function findSideActionPlayer(name) {
  const key = normalize(name);
  return state.players.find((player) => normalize(player.name) === key) || null;
}

function namedPlayersInAction(action) {
  return state.players
    .map((player) => ({ player, index: String(action).search(new RegExp(`\\b${escapeRegExp(player.name)}\\b`, "i")) }))
    .filter((match) => match.index >= 0)
    .sort((a, b) => a.index - b.index)
    .map((match) => match.player);
}

function rollSideActionOutcome(context, actor, target, classification) {
  const weights = adjustedSideActionOutcomeWeights(
    sideActionOutcomeWeights(classification.category),
    classification.modifiers || []
  );
  const kind = preferredSideActionOutcome(context, classification) || chooseWeightedSideActionOutcome(weights);
  const outcome = buildSideActionOutcome(kind, context, actor, target, classification);
  outcome.modifiers = classification.modifiers || [];
  return outcome;
}

function sideActionOutcomeWeights(category) {
  const tables = {
    search: { loot: 46, narrow: 24, flavor: 22, hazard: 7, terminal: 1 },
    inspect: { narrow: 68, flavor: 23, hazard: 7, bypass: 1, terminal: 1 },
    repair: { narrow: 42, flavor: 26, hazard: 24, bypass: 6, terminal: 2 },
    explore: { loot: 20, narrow: 16, flavor: 42, hazard: 19, terminal: 3 },
    protect: { guard: 72, flavor: 27, hazard: 1 },
    medical: { stabilize: 68, flavor: 27, hazard: 5 },
    assist: { guard: 36, stabilize: 18, flavor: 42, hazard: 4 },
    salvage: { loot: 44, narrow: 16, flavor: 19, guard: 8, hazard: 11, terminal: 2 },
    hack: { narrow: 54, flavor: 20, hazard: 15, bypass: 9, terminal: 2 },
    communicate: { narrow: 24, flavor: 57, guard: 12, hazard: 7 },
    distract: { guard: 48, flavor: 37, hazard: 13, terminal: 2 },
    craft: { guard: 40, narrow: 23, flavor: 22, hazard: 13, bypass: 1, terminal: 1 },
    perform: { flavor: 95, hazard: 4, terminal: 1 },
    attack: { flavor: 20, guard: 18, hazard: 52, terminal: 10 },
    reckless: { reckless: 100 },
    implausible: { reject: 100 }
  };
  return tables[category] || tables.inspect;
}

function preferredSideActionOutcome(context, classification = {}) {
  const category = classification.category || "";
  const action = normalize(classification.originalAction || "");
  const modifiers = classification.modifiers || [];
  if (!category || category === "reckless" || category === "implausible") return "";
  if (modifiers.includes("reckless") || modifiers.includes("violent")) return "";
  if (/\b(medkit|medical|medic|first aid|trauma|supply|supplies|cache|locker|crate|cabinet|kit|bag|pack)\b/.test(action)
      && ["search", "salvage", "medical", "explore"].includes(category)) {
    return "loot";
  }
  if (category === "medical") return "stabilize";
  if (["protect", "assist", "distract"].includes(category)) return "guard";
  if (["inspect", "hack", "communicate"].includes(category)
      || /\b(scan|read|inspect|study|diagnos|analyz|trace|decode|listen|monitor|schematic|manual|label|record)\b/.test(action)) {
    return context?.question ? "narrow" : "";
  }
  if (category === "repair" && modifiers.includes("technical")) return "narrow";
  if (category === "attack" && modifiers.includes("threat-targeted") && !modifiers.includes("reckless")) return "guard";
  return "";
}

function adjustedSideActionOutcomeWeights(base, modifiers) {
  const weights = { ...base };
  const add = (kind, amount) => {
    if (weights[kind] !== undefined) weights[kind] = Math.max(0, weights[kind] + amount);
  };
  if (modifiers.includes("careful")) {
    add("hazard", -5);
    add("terminal", -1);
    add("flavor", 3);
    add("narrow", 3);
  }
  if (modifiers.includes("reckless") || modifiers.includes("violent")) {
    add("hazard", 8);
    add("terminal", 2);
    add("flavor", -5);
    add("guard", -4);
  }
  if (modifiers.includes("technical")) {
    add("narrow", 5);
    add("bypass", 1);
  }
  if (modifiers.includes("quiet")) {
    add("flavor", 3);
    add("hazard", -2);
  }
  if (modifiers.includes("loud")) {
    add("hazard", 4);
    add("flavor", -2);
  }
  if (modifiers.includes("self-targeted") && weights.guard !== undefined && !modifiers.includes("reckless")) {
    add("guard", 8);
    add("hazard", -8);
    add("terminal", -2);
  }
  return weights;
}

function chooseWeightedSideActionOutcome(weights) {
  const entries = Object.entries(weights);
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = state.rng() * total;
  for (const [kind, weight] of entries) {
    roll -= weight;
    if (roll < 0) return kind;
  }
  return entries[entries.length - 1][0];
}

function buildSideActionOutcome(kind, context, actor, target, classification) {
  const eventNotes = {};
  const category = classification.category;
  const affected = category === "reckless" ? target || actor : actor || target;
  if (kind === "bypass") {
    return {
      kind: "bypass",
      category,
      facts: `rare plausible bypass discovered during ${category} action; active system safely resolves around ${answerKnowledgeText(context.question)}; route advances`,
      statusLog: "A rare bypass resolves the active system and opens the route.",
      eventNotes
    };
  }
  if (kind === "terminal" && affected) {
    applyDamage(affected, 5, "terminal");
    eventNotes[affected.name] = `${affected.name} triggers a catastrophic hidden hazard while attempting the ${category} action.`;
    return {
      kind: "terminal",
      category,
      facts: `catastrophic ${category} hazard; ${affected.name} takes terminal damage while attempting the action`,
      statusLog: "",
      eventNotes
    };
  }
  if (kind === "hazard" && affected) {
    applyDamage(affected, 1, "hit");
    eventNotes[affected.name] = `${affected.name} is clipped by the room's active hazard while attempting the ${category} action.`;
    return {
      kind: "hazard",
      category,
      facts: `${category} hazard; ${affected.name} is hurt by unstable equipment while attempting the action`,
      statusLog: "",
      eventNotes
    };
  }
  if (kind === "loot") {
    const loot = grantLoot();
    return {
      kind: "loot",
      category,
      facts: `${category} action plausibly uncovers supplies; ${loot.facts}`,
      statusLog: loot.status,
      eventNotes
    };
  }
  if (kind === "narrow") {
    const removed = narrowCurrentChoices(context.question);
    const hint = removed.length ? "" : questionHintStatus(context.question);
    return {
      kind: "narrow",
      category,
      facts: removed.length
        ? `${category} action uncovers a relevant clue; rule out these incorrect possibilities: ${removed.map((choice) => `${choice.key}. ${choice.text}`).join("; ")}`
        : `${category} action uncovers a relevant clue; ${hint || "no additional clue is available"}`,
      statusLog: removed.length ? `Diagnostic clue: rule out ${removed.map((choice) => choice.key).join(" and ")}.` : (hint || "The active prompt is already narrowed as far as it can go."),
      eventNotes
    };
  }
  if (kind === "guard") {
    state.sideActionGuard = true;
    return {
      kind: "guard",
      category,
      facts: "protective preparation succeeds; the squad establishes cover or stabilizes the area; reduce the next triggered encounter hazard",
      statusLog: "Defensive preparation active: the next encounter hazard is reduced.",
      eventNotes
    };
  }
  if (kind === "stabilize") {
    const patient = target || actor;
    if (!patient) return { kind: "flavor", category, facts: "the team attempts basic aid but has no viable patient", statusLog: "", eventNotes };
    const removed = patient.status.includes("Bleeding") ? "Bleeding" : null;
    if (removed) patient.status = patient.status.filter((status) => status !== removed);
    if (!patient.incapacitated) healPlayer(patient, 1);
    eventNotes[patient.name] = removed
      ? `${patient.name} receives field stabilization and the bleeding is brought under control.`
      : `${patient.name} receives limited field stabilization without consuming a Medkit.`;
    return {
      kind: "stabilize",
      category,
      facts: `limited field stabilization; ${patient.name} recovers 1 HP${removed ? " and Bleeding is removed" : ""}; no Medkit consumed; incapacitated players are not revived`,
      statusLog: `${patient.name} receives limited field stabilization.`,
      eventNotes
    };
  }
  if (kind === "reckless") {
    const recklessTarget = affected || randomActivePlayer();
    if (!recklessTarget) return { kind: "flavor", category, facts: "reckless action is rejected because nobody can perform it", statusLog: "", eventNotes };
    const terminal = isLethalRecklessAction(classification.originalAction);
    const amount = terminal ? 5 : recklessDamageAmount(classification.originalAction);
    applyDamage(recklessTarget, amount, terminal ? "terminal" : "hit");
    if (!recklessTarget.incapacitated && /\b(cut(?:s|ting)?|slice(?:s|d|ing)?|stab(?:s|bed|bing)?|sever(?:s|ed|ing)?|amputat\w*|bleed(?:s|ing)?)\b/.test(normalize(classification.originalAction))) {
      addStatusToPlayer(recklessTarget, "Bleeding");
    }
    eventNotes[recklessTarget.name] = `${recklessTarget.name} is harmed by the declared reckless action.`;
    return {
      kind: "reckless",
      category,
      facts: `reckless action causes only its plausible consequence; ${recklessTarget.name} is harmed; no supplies, clue, or system advantage`,
      statusLog: "",
      eventNotes
    };
  }
  if (kind === "reject") {
    return {
      kind: "reject",
      category,
      facts: "implausible action cannot occur in this environment; grounded rejection only; no supplies, damage, or system advantage",
      statusLog: "",
      eventNotes
    };
  }
  return {
    kind: "flavor",
    category,
    facts: `${category} action reveals a brief grounded atmospheric clue connected to ${state.threat}; no supplies, damage, or system advantage`,
    statusLog: "",
    eventNotes
  };
}

function isLethalRecklessAction(action) {
  const text = normalize(action);
  return /\b(kill|decapitat|shoot .* (head|chest)|stab .* (head|neck|chest)|cut off .* head|sever .* head|jump into|electrocut)\b/.test(text);
}

function recklessDamageAmount(action) {
  return /\b(cut(?:s|ting)? off|sever(?:s|ed|ing)?|amputat\w*|stab(?:s|bed|bing)?)\b/.test(normalize(action)) ? 2 : 1;
}

function narrowCurrentChoices(question) {
  if (!question || question.mode !== "multiple") return [];
  const existing = new Set(state.narrowedChoices[state.currentQuestion] || []);
  const available = shuffle(question.choices.filter((choice) => choice.key !== question.answerKey && !existing.has(choice.key)));
  const count = Math.min(available.length, state.rng() < 0.2 ? 2 : 1);
  const removed = available.slice(0, count);
  state.narrowedChoices[state.currentQuestion] = [...existing, ...removed.map((choice) => choice.key)];
  return removed;
}

function questionHintStatus(question) {
  if (!question) return "";
  if (question.mode === "fill") {
    const answer = question.answerText || question.answerKey || "";
    const pattern = fillAnswerPattern(answer);
    return pattern ? `Diagnostic clue: answer pattern ${pattern}.` : "";
  }
  if (question.mode === "truefalse") {
    return "Diagnostic clue: the active statement resolves to either True or False; watch for absolute wording.";
  }
  return "";
}

function fillAnswerPattern(answer) {
  const text = String(answer || "").trim();
  if (!text) return "";
  let letterIndex = 0;
  return text.split("").map((char, index) => {
    if (!/[a-z0-9]/i.test(char)) return char;
    const reveal = index === 0 || index === text.length - 1 || letterIndex % 3 === 0;
    letterIndex += 1;
    return reveal ? char : "_";
  }).join("").replace(/_/g, "_ ");
}

function finishLocalSideAction(outcome, playerEvents, story) {
  state.sideActionPending = false;
  resumeChallengeTimer();
  fadeSideActionWaiting();
  if (teamFullyIncapacitated()) {
    beginLocalTeamFailure({
      context: currentLocalContext(),
      result: { narration: story, factSeed: outcome.facts },
      currentArea: outcome.areaName || contextAreaName(),
      playerEvents
    });
    return;
  }
  if (outcome.kind === "bypass") {
    const nextInfo = outcome.nextInfo;
    rememberSkippedQuestion(currentLocalContext().question);
    appendTranscript({
      tag: nextInfo.tag,
      areaName: nextInfo.areaName,
      story,
      question: nextInfo.questionText,
      readyCheck: Boolean(nextInfo.readyCheck),
      bossNodeIndex: nextInfo.bossNodeIndex,
      bossPhase: nextInfo.bossPhase,
      isRecovery: Boolean(nextInfo.isRecovery),
      recoveryTier: nextInfo.recoveryTier,
      advanceRoom: true,
      correct: true,
      players: playerEvents,
      inventory: { ...state.inventory },
      statusLog: outcome.statusLog
    });
    recordSideActionFact(outcome);
    if (state.currentQuestion >= state.questions.length) renderEnding();
    return;
  }

  appendTemporaryActionDialogue({
    tag: outcome.source === "player" ? "Player Action" : "Team Action",
    story,
    players: playerEvents,
    statusLog: outcome.statusLog
  });
  recordSideActionFact(outcome);
  updateActiveLocalQuestionDisplay();
  renderChatControls();
  // Keep already-submitted answers intact after optional actions.
  publishPlayerSession({ status: "open", prompt: buildPlayerPrompt(), resetAnswers: false });
  renderPlayerSessionPanel();
  renderMapQuestionOverlay();
  window.setTimeout(maybeResolveQueuedPlayerAction, ACTION_DIALOGUE_HOLD_MS + 500);
}

function makeLocalSideActionPrompt(action, actor, outcome, playerEvents) {
  const affected = playerEvents.length
    ? playerEvents.map((event) => `${event.name}: ${event.note}${event.status.length ? `, ${event.status.join(", ")}` : ""}${event.cause ? `. Cause: ${event.cause}` : ""}`).join("; ")
    : "none";
  const actionOwner = outcome.source === "player" ? `${actor?.name || "one player"}'s optional player action` : "one optional team action";
  return [
    `Write ${narrationSentenceRange("2-4", "1-2")} complete player-facing sentences describing ${actionOwner} inside the current room.`,
    "Use only the listed facts. Do not add damage, supplies, statuses, advantages, or bypasses unless listed.",
    "The active system remains unresolved unless rare bypass says otherwise.",
    outcome.category === "perform"
      ? "Silly/theatrical action: acknowledge with brief absurd deadpan horror; no useful advantage unless facts say mishap."
      : "Keep the response grounded in the room and the action.",
    "No questions, answers, options, odds, rolls, HP, hit points, or hidden mechanics.",
    `Current area: ${contextAreaName()}.`,
    `Mission style: ${state.missionType}.`,
    `Environment: ${state.environment}.`,
    `Threat: ${state.threat}; ${compactThreatProfileText()}.`,
    `Player action: ${action}.`,
    `Primary actor: ${actor?.name || "the team"}.`,
    outcome.source === "player" ? `Responsibility rule: ${actor?.name || "the submitting player"} personally attempts this action and owns its direct consequences.` : "Responsibility rule: the squad acts together.",
    `Grounded action category: ${outcome.category}.`,
    `Action modifiers: ${(outcome.modifiers || []).join(", ") || "none"}.`,
    `Outcome facts: ${outcome.facts}.`,
    outcome.nextInfo ? `Rare bypass transition requirement: move the squad into ${outcome.nextInfo.areaName} and stage that unresolved area briefly.` : "Rare bypass transition requirement: none.",
    `Affected players: ${affected}.`
  ].join("\n");
}

function sideActionFallback(action, actor, outcome) {
  const subject = actor?.name || "The team";
  if (outcome.kind === "bypass") return `${subject} follows the side route opened by the search and finds a buried maintenance override. The locked passage cycles open with a hard mechanical shudder.`;
  if (outcome.kind === "terminal") return `${subject} reaches into the room's neglected machinery, and a buried fault detonates through the housing. The search ends in a violent flash as the team drags back from the wreckage.`;
  if (outcome.kind === "hazard" && outcome.category === "protect") return `${subject} braces for impact, but the room shifts harder than expected. The cover holds for the squad, while a loose bracket snaps back into ${subject}'s shoulder.`;
  if (outcome.kind === "hazard") return `${subject} pushes the ${outcome.category} attempt too close to unstable equipment. A loose assembly snaps free before the team can pull clear.`;
  if (outcome.kind === "loot") return `${subject} searches behind a damaged service panel and uncovers a sealed emergency cache.`;
  if (outcome.kind === "narrow") return `${subject} studies the neglected maintenance markings and finds a diagnostic note that rules out part of the active panel sequence.`;
  if (outcome.kind === "guard") return `${subject} uses the room's damaged fixtures to establish a rough pocket of cover before the squad touches the active system.`;
  if (outcome.kind === "stabilize") return `${subject} takes a brief field-care window and stabilizes what can be treated without opening the squad's limited medical supplies.`;
  if (outcome.kind === "reckless") return `${subject}'s reckless improvisation causes exactly the kind of injury the squad should have expected. Nothing in the room rewards it.`;
  if (outcome.kind === "reject") return `${subject} attempts the idea, but the room offers no plausible way to make it work. The squad abandons the distraction and returns to the active system.`;
  if (outcome.category === "perform") return `${subject}'s performance earns a deeply unhelpful burst of canned applause from a damaged ceiling speaker. The squad is no closer to opening the route, but the timing is unsettlingly perfect.`;
  return `${subject} searches the room and finds signs that ${state.threat} passed through the equipment before the squad arrived. Nothing useful is left behind, but the silence feels less empty than it did a moment ago.`;
}

function recordSideActionFact(outcome) {
  state.turnHistory.push(`[${outcome.areaName || contextAreaName()}] Optional ${outcome.source === "player" ? "player" : "team"} action: ${outcome.facts}.`);
  state.turnHistory = state.turnHistory.slice(-3);
}

function contextAreaName() {
  const node = state.nodes[state.currentNode] || { type: "challenge" };
  return state.questions[state.currentQuestion]?.area || roomName(node, state.currentNode);
}

function updateActiveLocalQuestionDisplay() {
  const questions = els.encounterCard.querySelectorAll(".log-question p");
  const active = questions[questions.length - 1];
  if (!active) return;
  const info = currentQuestionInfo();
  active.textContent = info.questionText;
  active.dataset.text = info.questionText;
}

function activateLocalEMS() {
  if (suppliesAreLocked() || !state.questionPresentationReady || state.selectedEMS || state.inventory.ems <= 0 || state.resolved) return;
  state.selectedEMS = true;
  state.inventory.ems -= 1;
  playGameSfx("recovery");
  renderStatus();
  flashEmsShield();
  appendTranscript({
    replace: false,
    statusLog: "EMS armed. The next encounter hazard will be absorbed by the field."
  });
  renderChatControls();
}

function useLocalMedkit(playerIndex) {
  const before = snapshotPlayers();
  const player = state.players[playerIndex];
  if (suppliesAreLocked() || !player || state.inventory.medkits <= 0) return;
  playGameSfx("recovery");
  state.inventory.medkits -= 1;
  if (player.incapacitated) {
    player.incapacitated = false;
    player.hp = 3;
  } else {
    healPlayer(player, 4);
  }
  player.status = [];
  const events = changedPlayerEvents(before);
  renderStatus();
  appendTranscript({
    replace: false,
    players: events,
    inventory: { ...state.inventory },
    statusLog: `${player.name} uses a Medkit.`
  });
  renderChatControls();
}

function localOpeningPayload() {
  const q = state.questions[0];
  const type = challengeType(0, state.questions.length);
  const activeObstacle = getActiveObstacle(0, q, type, q.area || "Relay Chamber");
  state.roomNames[state.currentNode] = q.area || "Relay Chamber";
  return {
    tag: type.label,
    areaName: q.area || "Relay Chamber",
    activeObstacle,
    story: `The briefing packet collapses to the top of the console as the first chamber wakes under amber fault lights. ${obstacleNarration(activeObstacle)} The mission route paints itself across the map one locked room at a time before the blast door behind the squad seals with a magnetic thud.`,
    question: localQuestionText(q, type)
  };
}

function makeLocalOpeningPrompt() {
  const q = state.questions[0];
  const type = challengeType(0, state.questions.length);
  const operator = type.locked ? selectOperator(0) : null;
  const activeObstacle = getActiveObstacle(0, q, type, q.area || "Relay Chamber");
  return [
    `Write only the opening Mission Log scene, ${narrationSentenceRange("3-5", "2-3")} player-facing sentences.`,
    "Do not include a title, heading, markdown header, operation label, or MISSION LOG line.",
    "Use mission brief, first area, first study concept, and active obstacle.",
    "No answer choices, rules, mechanics, dice, odds, AI/meta, quiz language, or correct answer.",
    "End with the team needing to interact with the obstacle/system.",
    `Mission title: ${state.title || "Operation Dead Carrier"}.`,
    `Mission type: ${state.missionType}.`,
    `Environment: ${state.environment}.`,
    `Threat: ${state.threat}; ${compactThreatProfileText()}.`,
    `First area: ${q.area || "Relay Chamber"}.`,
    `Challenge type: ${type.label}.`,
    `Encounter presentation: ${challengePresentation(q, 0)}.`,
    `Active obstacle to stage: ${activeObstacle}`,
    type.locked && operator
      ? `Locked-operator requirement: invent a room-specific physical or technical reason why only ${operator.name} can respond.`
      : "Locked-operator requirement: none.",
    `First question concept: ${q.question}`
  ].join("\n");
}

function bossOpeningFallback(qInfo) {
  const final = qInfo.type?.bossPhase === "final";
  const pressure = final
    ? `${state.threat} forces itself into the room through every failing system at once`
    : `${state.threat} hammers the chamber through the walls, lights, and comms`;
  return `The squad crosses the threshold into ${qInfo.areaName}, and the route seals behind them with a heavy mechanical slam. ${pressure}, turning the space into a live kill zone of alarms, moving shadows, and unstable machinery. The next few seconds belong to the operators at the front of the formation. The only way through is to use the active system before the room tears itself apart.`;
}

function makeLocalBossOpeningPrompt(qInfo) {
  const final = qInfo.type?.bossPhase === "final";
  const bossLines = bossPhasePromptLines();
  return [
    `Write only the opening scene for a major confrontation, ${narrationSentenceRange("4-6", "2-3")} player-facing sentences.`,
    "No study prompt, answer choices, correct answer, boss/phase/mechanics/dice/odds/quiz/question/option language.",
    "Make the room dangerous, active, and continuous: a fight or desperate containment attempt.",
    "Use the current area name at most once; do not repeat it as a refrain.",
    "Do not rename the arena based on the study topic or active obstacle.",
    ...bossLines,
    final
      ? `This is the final confrontation. The squad is directly combating or defending against ${state.threat}.`
      : `This is a major mid-mission breach. ${state.threat} should be visible, audible, or physically pressuring the room.`,
    `Mission title: ${state.title || "Operation Dead Carrier"}.`,
    `Mission style: ${state.missionType}.`,
    `Environment: ${state.environment}.`,
    `Current area: ${qInfo.areaName}. This is a theme-specific location name for the confrontation.`,
    `Threat: ${state.threat}; ${compactThreatProfileText()}.`,
    `Active obstacle to stage: ${qInfo.activeObstacle || "The hostile breach itself blocks the squad."}`,
    `Active study concept to stage physically: ${qInfo.question?.question || "critical route control"}.`
  ].join("\n");
}

function startTransmissionFeedback({ correct, context, playerEvents = [] }) {
  stopTransmissionFeedback();
  const bossProgress = currentBossProgress();
  const progression = projectedProgressAfterRound();
  const routeTo = Math.min(state.nodes.length - 1, progression.nextNode);
  const destinationIsBoss = state.nodes[routeTo]?.type === "boss";
  state.transmissionPending = true;
  state.transmissionStartedAt = Date.now();
  state.routeTransition = {
    from: state.currentNode,
    to: routeTo,
    correct: Boolean(correct),
    boss: destinationIsBoss,
    moving: false
  };
  roomTransitionTraceStart("answer resolution to next prompt", {
    correct: Boolean(correct),
    fromNode: state.currentNode,
    toNode: routeTo,
    destinationType: state.nodes[routeTo]?.type || "",
    playerEvents: playerEvents.length
  });
  state.answerResults = {};
  if (!progression.stayInRoom) updateCurrentNodeResult(Boolean(correct));
  renderStatus();
  if (!isCombatNode(context.node)) {
    flashStatusEffects(playerEvents.map((event) => ({ player: findPlayer(event), kind: event.effect, amount: event.amount })).filter((event) => event.player));
  }
  flashAnswerFeedback(correct, { boss: Boolean(context.type?.boss || bossProgress) });
  renderTransmissionWaiting(correct, playerEvents, context.type);
  if (state.transmissionUiTimer) window.clearInterval(state.transmissionUiTimer);
  state.transmissionUiTimer = window.setInterval(updateTransmissionWaiting, 250);
  fadeMapQuestionOverlay(() => {
    if (!state.transmissionPending || !state.routeTransition) return;
    renderTransmissionWaiting(correct, playerEvents, context.type);
    renderMap();
  });
}

function startPassiveTransmissionFeedback({ type = {}, playerEvents = [] } = {}) {
  stopTransmissionFeedback();
  if (!state.roomTransitionTrace) {
    roomTransitionTraceStart("passive transmission", {
      nodeIndex: state.currentNode,
      nodeType: state.nodes[state.currentNode]?.type || "",
      challengeType: type?.kind || type?.label || ""
    });
  }
  state.answerResults = {};
  state.transmissionPending = true;
  state.transmissionStartedAt = Date.now();
  renderStatus();
  fadeMapQuestionOverlay();
  renderMap();
  renderTransmissionWaiting(true, playerEvents, type);
  state.transmissionUiTimer = window.setInterval(updateTransmissionWaiting, 250);
}

function captureDeferredRouteTransition(payload, shouldDefer) {
  if (!shouldDefer || !payload.advanceRoom || !state.routeTransition) return;
  payload.deferredRouteTransition = { ...state.routeTransition };
}

function beginDeferredRouteTransition(payload) {
  const step = roomTransitionTraceStepStart("begin deferred route transition", {
    hasDeferredRoute: Boolean(payload.deferredRouteTransition)
  });
  const transition = payload.deferredRouteTransition;
  if (!transition) {
    roomTransitionTraceStepEnd(step, { skipped: true });
    return 0;
  }
  if (state.transmissionUiTimer) window.clearInterval(state.transmissionUiTimer);
  state.transmissionUiTimer = null;
  state.transmissionPending = true;
  state.transmissionStartedAt = Date.now();
  state.routeTransition = { ...transition };
  state.routeTransition.moving = ENABLE_ROUTE_MARKER_TRANSITION && transition.to !== transition.from;
  state.answerResults = {};
  const leavingBoss = state.routeTransition.moving && state.nodes[transition.from]?.type === "boss" && state.nodes[transition.to]?.type !== "boss";
  if (leavingBoss) beginBossEyesExit(true);
  else els.mapPanel?.classList.remove("boss-eyes-exiting");
  if (state.routeTransition.moving && !state.routeTransition.soundPlayed) {
    state.routeTransition.soundPlayed = true;
    playGameSfx("transition");
  }
  startBossReadyAudioForRoute(state.routeTransition);
  renderMap();
  renderRouteTelemetry();
  roomTransitionTraceStepEnd(step, {
    fromNode: transition.from,
    toNode: transition.to,
    moving: state.routeTransition.moving
  });
  return state.transmissionStartedAt;
}

function stopTransmissionFeedback(render = false) {
  roomTransitionTraceEmit("MARK", "stop transmission feedback", { render });
  if (state.transmissionUiTimer) window.clearInterval(state.transmissionUiTimer);
  state.transmissionUiTimer = null;
  state.transmissionPending = false;
  state.transmissionStartedAt = 0;
  state.routeTransition = null;
  fadeMapQuestionOverlay();
  els.mapPanel.classList.remove("transmission-active", "transmission-incorrect", "transmission-boss");
  if (render) {
    renderMap();
    renderRouteTelemetry();
  }
}

function pulseBossEyesOnFailure() {
  if (!els.mapPanel?.classList.contains("boss-eyes-active")) return;
  window.clearTimeout(state.bossEyesStrikeTimer);
  els.mapPanel.classList.remove("boss-eyes-strike");
  void els.mapPanel.offsetWidth;
  els.mapPanel.classList.add("boss-eyes-strike");
  state.bossEyesStrikeTimer = window.setTimeout(() => {
    els.mapPanel?.classList.remove("boss-eyes-strike");
    state.bossEyesStrikeTimer = null;
  }, 1150);
}

function flashAnswerFeedback(correct, { boss = false } = {}) {
  playGameSfx(correct ? "correct" : "incorrect");
  if (!correct && boss) pulseBossEyesOnFailure();
  els.mapPanel.classList.remove("answer-correct-flash", "answer-incorrect-flash");
  void els.mapPanel.offsetWidth;
  els.mapPanel.classList.add(correct ? "answer-correct-flash" : "answer-incorrect-flash");
  window.setTimeout(() => {
    els.mapPanel.classList.remove("answer-correct-flash", "answer-incorrect-flash");
  }, 1250);
}

function updateCurrentNodeResult(correct) {
  const bossProgress = currentBossProgress();
  if (bossProgress && !bossProgress.finalStep) return;
  const existing = state.nodeResults[state.currentNode];
  state.nodeResults[state.currentNode] = existing === false ? false : Boolean(correct);
}

function renderTransmissionWaiting(correct, playerEvents, type) {
  const transcript = document.getElementById("chatTranscript");
  if (!transcript) return;
  const entry = document.createElement("section");
  entry.className = `transcript-entry transmission-waiting ${correct ? "accepted" : "rejected"} ${type?.boss ? "boss" : ""}`;
  entry.innerHTML = `
    <div class="log-tag">Transmission Link</div>
    <div class="transmission-display">
      <div class="transmission-heading">
        <strong>RECEIVING TRANSMISSION...</strong>
        <span id="transmissionSignalBars" class="signal-bars" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
      </div>
      <div class="transmission-waveform" aria-hidden="true">
        ${Array.from({ length: 24 }, () => "<i></i>").join("")}
      </div>
      <p id="transmissionPhase">${transmissionMessages(correct, type)[0]}</p>
      <p id="transmissionDelay" class="transmission-delay" hidden></p>
    </div>
  `;
  appendDamageLog(entry, { players: playerEvents });
  appendMissionLogEntry(entry, { replace: true });
}

function updateTransmissionWaiting() {
  if (!state.transmissionPending) return;
  const elapsed = Date.now() - state.transmissionStartedAt;
  const context = currentLocalContext();
  const messages = transmissionMessages(state.routeTransition?.correct, context.type);
  const phase = document.getElementById("transmissionPhase");
  const delay = document.getElementById("transmissionDelay");
  if (phase) phase.textContent = messages[Math.floor(elapsed / 1800) % messages.length];
  if (delay && elapsed >= 3000) {
    delay.hidden = false;
    delay.textContent = `LINK DELAY ${formatLinkDelay(elapsed)}`;
  }
}

function transmissionMessages(correct, type = {}) {
  if (type.boss) {
    return ["Threat-channel interference detected", "Decrypting hostile field report", "Reconstructing route telemetry", "Holding signal lock at the next gate"];
  }
  if (!correct) {
    return ["Fault telemetry isolated", "Reconstructing incident feed", "Rerouting squad signal", "Holding signal lock at the next gate"];
  }
  return ["Decrypting field report", "Route telemetry received", "Squad vitals synchronized", "Holding signal lock at the next gate"];
}

function formatLinkDelay(elapsed) {
  const seconds = Math.floor(elapsed / 1000);
  return `00:${String(seconds).padStart(2, "0")}`;
}

function resolveLocalSubmittedAnswer(answer, options = {}) {
  if (!state.localDmMode || state.resolved) return;
  if (state.nodes[state.currentNode]?.type === "recovery") {
    resolveLocalRecovery(answer);
    return;
  }
  const context = currentLocalContext();
  if (!context.question) return;
  if (options.typePatch) context.type = { ...context.type, ...options.typePatch };
  if (answer === TIMEOUT_ANSWER && context.type.kind === "emergency") {
    context.type = { ...context.type, emergencyTimeout: true, emergencySlow: true };
  }

  state.resolved = true;
  const before = snapshotPlayers();
  const correct = isLocalAnswerCorrect(answer, context.question);
  awardSharedAnswerPointsOnce({
    correct,
    question: context.question,
    type: context.type,
    operator: context.operator,
    submittedAt: options.submittedAt || Date.now(),
    scoringPlayer: options.scoringPlayer || null,
    source: options.source || ""
  });
  rememberPreviousAnswer(answer, context.question, correct);
  const combatEntries = context.type.locked && context.operator
    ? [{ player: context.operator, correct, submittedAt: options.submittedAt || Date.now(), answer }]
    : context.type.kind === "emergency" && options.scoringPlayer
    ? [{ player: options.scoringPlayer, correct, submittedAt: options.submittedAt || Date.now(), answer }]
    : activePlayers().map((player) => ({ player, correct, submittedAt: options.submittedAt || Date.now(), answer }));
  const result = isCombatNode(context.node)
    ? applyCombatEncounter(combatEntries, context.type, context.operator, context.question)
    : applyEncounter(correct, context.type, context.operator);
  if (result.combat && context.type.boss) context.type = { ...context.type, bossFinalStep: Boolean(result.combatCleared) };
  const playerEvents = changedPlayerEvents(before, result.eventNotes);
  const currentArea = isCombatNode(context.node)
    ? roomName(context.node, state.currentNode)
    : context.question.area || roomName(context.node, state.currentNode);
  if (teamFullyIncapacitated()) {
    const showFailure = () => beginLocalTeamFailure({ context, result, currentArea, playerEvents });
    if (result.combat) presentCombatResolution(result, { onComplete: showFailure });
    else showFailure();
    return;
  }
  if (result.combat) presentCombatResolution(result);
  const nextInfo = nextLocalQuestionInfo();
  const statusLog = result.combatStatusLog || supportEventStatusLog(result.supportEvents) || result.lootStatus || "";
  const promptStatusLog = localStatusLog(playerEvents, result.lootFact);
  const actionFacts = localAnswerActionFacts(context, answer);
  const fallbackAction = localAnswerFallbackAction(context, answer);
  const fallbackBlocks = localFallbackBlocks(correct, context, result, nextInfo, fallbackAction);
  startTransmissionFeedback({ correct, context, playerEvents });

  const prompt = makeLocalResolutionPrompt({
    correct,
    context,
    result,
    currentArea,
    nextInfo,
    statusLog: promptStatusLog,
    playerEvents,
    actionFacts
  });

  setAnswerPendingText("Receiving transmission...");
  if (!ENABLE_TRANSITION_NARRATION_GENERATION) {
    const continuationStory = assembleLocalContinuation(fallbackBlocks);
    roomTransitionTraceEmit("MARK", "resolution LM skipped", {
      continuationChars: continuationStory.length,
      destinationType: nextInfo.isRecovery ? "recovery" : nextInfo.readyCheck ? "boss readiness" : "room"
    });
    window.setTimeout(() => {
      appendTranscript({
        tag: nextInfo.tag,
        areaName: nextInfo.areaName,
        story: fallbackBlocks.impact || assembleLocalNarration(fallbackBlocks),
        continuationStory,
        pauseBeforeContinuation: Boolean(continuationStory),
        activeObstacle: nextInfo.activeObstacle,
        question: nextInfo.questionText,
        readyCheck: Boolean(nextInfo.readyCheck),
        bossNodeIndex: nextInfo.bossNodeIndex,
        bossPhase: nextInfo.bossPhase,
        isRecovery: Boolean(nextInfo.isRecovery),
        recoveryTier: nextInfo.recoveryTier,
        advanceRoom: true,
        correct,
        players: playerEvents,
        suppressEffectFlash: true,
        inventory: { ...state.inventory },
        statusLog
      });
      recordLocalTurnFact({ correct, context, currentArea, nextInfo, playerEvents });
      if (state.currentQuestion >= state.questions.length) renderEnding();
    }, 0);
    return;
  }
  requestOllama(prompt, { temperature: 0.68, format: "json" })
    .then((text) => {
      const blocks = parseLocalNarrationBlocks(text, playerEvents, fallbackBlocks, nextInfo);
      return ensureGeneratedHazardImpact(blocks, {
        fallbackBlocks,
        correct,
        context,
        result,
        currentArea,
        playerEvents,
        actionFacts,
        statusLog: promptStatusLog
      });
    })
    .then((blocks) => {
      const story = blocks.impact || assembleLocalNarration(blocks);
      const continuationStory = assembleLocalContinuation(blocks);
      appendTranscript({
        tag: nextInfo.tag,
        areaName: nextInfo.areaName,
        story,
        continuationStory,
        pauseBeforeContinuation: Boolean(continuationStory),
        activeObstacle: nextInfo.activeObstacle,
        question: nextInfo.questionText,
        readyCheck: Boolean(nextInfo.readyCheck),
        bossNodeIndex: nextInfo.bossNodeIndex,
        bossPhase: nextInfo.bossPhase,
        isRecovery: Boolean(nextInfo.isRecovery),
        recoveryTier: nextInfo.recoveryTier,
        advanceRoom: true,
        correct,
        players: playerEvents,
        suppressEffectFlash: true,
        inventory: { ...state.inventory },
        statusLog
      });
      recordLocalTurnFact({ correct, context, currentArea, nextInfo, playerEvents });
      if (state.currentQuestion >= state.questions.length) renderEnding();
    })
    .catch(() => {
      const continuationStory = assembleLocalContinuation(fallbackBlocks);
      appendTranscript({
        tag: nextInfo.tag,
        areaName: nextInfo.areaName,
        story: fallbackBlocks.impact || assembleLocalNarration(fallbackBlocks),
        continuationStory,
        pauseBeforeContinuation: Boolean(continuationStory),
        activeObstacle: nextInfo.activeObstacle,
        question: nextInfo.questionText,
        readyCheck: Boolean(nextInfo.readyCheck),
        bossNodeIndex: nextInfo.bossNodeIndex,
        bossPhase: nextInfo.bossPhase,
        isRecovery: Boolean(nextInfo.isRecovery),
        recoveryTier: nextInfo.recoveryTier,
        advanceRoom: true,
        correct,
        players: playerEvents,
        suppressEffectFlash: true,
        inventory: { ...state.inventory },
        statusLog
      });
      recordLocalTurnFact({ correct, context, currentArea, nextInfo, playerEvents });
    });
}

function resolveLocalEmergencyDeviceAnswer(submitted, timerSnapshot = null) {
  const timer = timerSnapshot || state.emergencyTimer;
  if (!submitted?.answer || !timer) return;
  const player = state.players.find((entry) => sameName(entry.name, submitted.playerName));
  const elapsed = Math.max(0, Number(submitted.submittedAt || Date.now()) - (timer.deadline - timer.durationMs));
  const slow = elapsed > timer.durationMs / 2;
  stopEmergencyTimer();
  publishPlayerWaiting("resolving");
  renderChatControls();
  renderInventoryActions();
  renderMapQuestionOverlay();
  resolveLocalSubmittedAnswer(submitted.answer, {
    submittedAt: submitted.submittedAt,
    scoringPlayer: player || null,
    source: "device-auto",
    typePatch: {
      emergencyAnswerPlayer: player || null,
      emergencySlow: slow
    }
  });
}

function resolveLocalDeviceTeamAnswers(answers) {
  if (!state.localDmMode || state.resolved || state.answerPending) return false;
  if (state.nodes[state.currentNode]?.type === "recovery") return false;
  const context = currentLocalContext();
  if (!context.question || !["individual", "team", "truefalse", "locked"].includes(context.type.kind)) return false;
  if (!everyoneActiveSubmitted(answers)) {
    logDebugEvent({
      kind: "state",
      label: "Device answer resolution blocked",
      detail: `waiting for required responders: ${[...requiredDeviceAnswerNames(currentQuestionInfo())].join(", ") || "unknown"}`
    });
    return false;
  }

  const entries = deviceTeamAnswerEntries(answers, context.question);
  if (!entries.length || entries.some((entry) => !entry.answer)) return false;
  const challengeSucceeded = deviceChallengeSucceeded(entries, context.type);

  state.resolved = true;
  state.answerPending = true;
  state.lastSubmittedAnswer = "Squad responses received";
  if (state.emergencyTimer?.kind === "boss") pauseChallengeTimer();
  else stopEmergencyTimer();
  publishPlayerWaiting("resolving");
  renderChatControls();
  renderInventoryActions();
  renderPlayerSessionPanel();
  renderMapQuestionOverlay();

  const before = snapshotPlayers();
  rememberPreviousDeviceTeamAnswers(entries, context.question, challengeSucceeded);
  setDeviceAnswerResults(entries);
  const result = isCombatNode(context.node)
    ? applyCombatEncounter(entries, context.type, context.operator, context.question)
    : applyDeviceTeamEncounter(entries, context.type);
  if (result.combat && context.type.boss) context.type = { ...context.type, bossFinalStep: Boolean(result.combatCleared) };
  const playerEvents = changedPlayerEvents(before, result.eventNotes);
  const currentArea = isCombatNode(context.node)
    ? roomName(context.node, state.currentNode)
    : context.question.area || roomName(context.node, state.currentNode);
  if (teamFullyIncapacitated()) {
    const showFailure = () => beginLocalTeamFailure({ context, result, currentArea, playerEvents });
    if (result.combat) presentCombatResolution(result, { onComplete: showFailure });
    else showFailure();
    return true;
  }
  if (result.combat) presentCombatResolution(result);

  const nextInfo = nextLocalQuestionInfo();
  const statusLog = result.combatStatusLog || supportEventStatusLog(result.supportEvents) || result.lootStatus || "";
  const promptStatusLog = localStatusLog(playerEvents, result.lootFact);
  const actionFacts = localDeviceTeamActionFacts(context, entries);
  const fallbackAction = localDeviceTeamFallbackAction(context, entries);
  const fallbackBlocks = localFallbackBlocks(challengeSucceeded, context, result, nextInfo, fallbackAction);
  startTransmissionFeedback({ correct: challengeSucceeded, context, playerEvents });

  const prompt = makeLocalResolutionPrompt({
    correct: challengeSucceeded,
    context,
    result,
    currentArea,
    nextInfo,
    statusLog: promptStatusLog,
    playerEvents,
    actionFacts
  });

  setAnswerPendingText("Receiving transmission...");
  if (!ENABLE_TRANSITION_NARRATION_GENERATION) {
    const continuationStory = assembleLocalContinuation(fallbackBlocks);
    roomTransitionTraceEmit("MARK", "team resolution LM skipped", {
      continuationChars: continuationStory.length,
      destinationType: nextInfo.isRecovery ? "recovery" : nextInfo.readyCheck ? "boss readiness" : "room"
    });
    window.setTimeout(() => {
      appendTranscript({
        tag: nextInfo.tag,
        areaName: nextInfo.areaName,
        story: fallbackBlocks.impact || assembleLocalNarration(fallbackBlocks),
        continuationStory,
        pauseBeforeContinuation: Boolean(continuationStory),
        activeObstacle: nextInfo.activeObstacle,
        question: nextInfo.questionText,
        readyCheck: Boolean(nextInfo.readyCheck),
        bossNodeIndex: nextInfo.bossNodeIndex,
        bossPhase: nextInfo.bossPhase,
        isRecovery: Boolean(nextInfo.isRecovery),
        recoveryTier: nextInfo.recoveryTier,
        advanceRoom: true,
        correct: challengeSucceeded,
        players: playerEvents,
        suppressEffectFlash: true,
        inventory: { ...state.inventory },
        statusLog
      });
      recordLocalTurnFact({ correct: challengeSucceeded, context, currentArea, nextInfo, playerEvents });
      if (state.currentQuestion >= state.questions.length) renderEnding();
    }, 0);
    return true;
  }
  requestOllama(prompt, { temperature: 0.7, format: "json" })
    .then((text) => {
      const blocks = parseLocalNarrationBlocks(text, playerEvents, fallbackBlocks, nextInfo);
      return ensureGeneratedHazardImpact(blocks, {
        fallbackBlocks,
        correct: challengeSucceeded,
        context,
        result,
        currentArea,
        playerEvents,
        actionFacts,
        statusLog: promptStatusLog
      });
    })
    .then((blocks) => {
      const continuationStory = assembleLocalContinuation(blocks);
      appendTranscript({
        tag: nextInfo.tag,
        areaName: nextInfo.areaName,
        story: blocks.impact || assembleLocalNarration(blocks),
        continuationStory,
        pauseBeforeContinuation: Boolean(continuationStory),
        activeObstacle: nextInfo.activeObstacle,
        question: nextInfo.questionText,
        readyCheck: Boolean(nextInfo.readyCheck),
        bossNodeIndex: nextInfo.bossNodeIndex,
        bossPhase: nextInfo.bossPhase,
        isRecovery: Boolean(nextInfo.isRecovery),
        recoveryTier: nextInfo.recoveryTier,
        advanceRoom: true,
        correct: challengeSucceeded,
        players: playerEvents,
        suppressEffectFlash: true,
        inventory: { ...state.inventory },
        statusLog
      });
      recordLocalTurnFact({ correct: challengeSucceeded, context, currentArea, nextInfo, playerEvents });
      if (state.currentQuestion >= state.questions.length) renderEnding();
    })
    .catch(() => {
      const continuationStory = assembleLocalContinuation(fallbackBlocks);
      appendTranscript({
        tag: nextInfo.tag,
        areaName: nextInfo.areaName,
        story: fallbackBlocks.impact || assembleLocalNarration(fallbackBlocks),
        continuationStory,
        pauseBeforeContinuation: Boolean(continuationStory),
        activeObstacle: nextInfo.activeObstacle,
        question: nextInfo.questionText,
        readyCheck: Boolean(nextInfo.readyCheck),
        bossNodeIndex: nextInfo.bossNodeIndex,
        bossPhase: nextInfo.bossPhase,
        isRecovery: Boolean(nextInfo.isRecovery),
        recoveryTier: nextInfo.recoveryTier,
        advanceRoom: true,
        correct: challengeSucceeded,
        players: playerEvents,
        suppressEffectFlash: true,
        inventory: { ...state.inventory },
        statusLog
      });
      recordLocalTurnFact({ correct: challengeSucceeded, context, currentArea, nextInfo, playerEvents });
    });
  return true;
}

function teamFullyIncapacitated() {
  return state.players.length > 0 && state.players.every((player) => player.incapacitated);
}

function beginLocalTeamFailure({ context, result, currentArea, playerEvents }) {
  if (state.teamFailurePending) return;
  const missionRunId = state.deploymentRunId;
  state.teamFailurePending = true;
  state.resolved = true;
  state.questionPresentationReady = false;
  setMissionFailureVisual(true);
  playMissionFailureAudio();
  startTeamFailureTransmissionFeedback({ context, playerEvents });
  setAnswerPendingText("Receiving final transmission...");

  const fallback = localTeamFailureFallback(result, currentArea);
  const renderIfCurrent = (story) => {
    if (!state.started || missionRunId !== state.deploymentRunId || !state.teamFailurePending) return;
    renderTeamFailureCard(story);
  };
  requestOllama(makeLocalTeamFailurePrompt({ context, result, currentArea, playerEvents }), { temperature: 0.86 })
    .then((text) => renderIfCurrent(cleanLocalNarration(text) || fallback))
    .catch(() => renderIfCurrent(fallback));
}

function startTeamFailureTransmissionFeedback({ context, playerEvents = [] }) {
  stopTransmissionFeedback();
  state.transmissionPending = true;
  state.transmissionStartedAt = Date.now();
  state.nodeResults[state.currentNode] = false;
  renderStatus();
  renderMap();
  flashStatusEffects(playerEvents.map((event) => ({ player: findPlayer(event), kind: event.effect, amount: event.amount })).filter((event) => event.player));
  flashAnswerFeedback(false, { boss: true });
  renderTransmissionWaiting(false, playerEvents, { ...context.type, boss: true });
  state.transmissionUiTimer = window.setInterval(updateTransmissionWaiting, 250);
}

function makeLocalTeamFailurePrompt({ context, result, currentArea, playerEvents }) {
  const eventFacts = playerEvents.length
    ? playerEvents.map((event) => `${event.name}: ${event.note}${event.status.length ? `, ${event.status.join(", ")}` : ""}${event.cause ? `. Cause: ${event.cause}` : ""}`).join("; ")
    : "Every operator is incapacitated.";
  return [
    `Write an elaborate player-facing mission-failure scene in ${narrationSentenceRange("7-10", "4-6")} sentences.`,
    "The entire team is incapacitated. The mission ends here. Do not revive, rescue, extract, or restore anyone.",
    "Describe the physical collapse of the room, the final helpless moments of the squad, and the facility or threat reclaiming the route.",
    "Vivid action-horror tone, but no new injuries or status effects beyond facts.",
    "No questions, answers, choices, scores, HP, hit points, dice, odds, rolls, or hidden mechanics.",
    `Operation: ${state.title}.`,
    `Environment: ${state.environment}.`,
    `Threat: ${state.threat}; ${compactThreatProfileText()}.`,
    `Final area reached: ${currentArea}.`,
    `Challenge context: ${context.type.label}.`,
    `Triggered hazard facts: ${result.factSeed || result.narration}.`,
    `Final operator facts: ${eventFacts}.`,
    `Recent continuity: ${compactTurnHistoryText()}.`
  ].join("\n");
}

function localTeamFailureFallback(result, currentArea) {
  return `${result.narration} The last functioning lights in ${currentArea} stutter from amber to red as every operator channel drops into ragged static. Across the route display, the squad markers stop moving one by one until the map is nothing but a dead chain of sealed rooms. No one is left standing to reach the next control point. ${state.threat} presses through the facility systems and answers the final open microphone with a low, patient signal. The emergency lamps fail in sequence, leaving ${state.environment} to the dark. The final transmission ends before extraction can be called.`;
}

function renderTeamFailureCard(story) {
  stopEmergencyTimer();
  stopTransmissionFeedback(true);
  clearTypewriters();
  state.resolved = true;
  state.answerPending = false;
  state.lastSubmittedAnswer = "";
  state.mapQuestionAlertActive = false;
  state.questionSurfaceVisible = false;
  state.questionPresentationReady = false;
  state.endingPending = true;
  state.teamFailurePending = false;
  setMissionFailureVisual(true);
  if (!state.failureAudio) playMissionFailureAudio();
  const summaryText = `Mission progress halted at ${state.currentQuestion} / ${state.questions.length}. Survivors: 0 / ${state.players.length}. Remaining Supplies: ${state.inventory.medkits} Medkits, ${state.inventory.ems} EMS Devices.`;
  els.encounterCard.innerHTML = `
    <section class="mission-failure-scene">
      <span class="encounter-tag">Final Transmission</span>
      <h3>MISSION FAILURE</h3>
      <p class="typewriter" data-text="${escapeAttribute(story)}"></p>
      <p class="typewriter" data-text="${escapeAttribute(summaryText)}"></p>
    </section>
  `;
  els.answerControls.innerHTML = "";
  const presentationRunId = beginLogPresentation();
  typeQueuedText(els.encounterCard).then(() => {
    finishLogPresentation(presentationRunId);
    els.answerControls.innerHTML = `<button id="newRunBtn" type="button">Set Up Another Mission</button>`;
    document.getElementById("newRunBtn").addEventListener("click", resetMission);
  });
  renderStatus();
  renderMap();
}

function currentLocalContext() {
  const node = state.nodes[state.currentNode] || {};
  const question = state.questions[state.currentQuestion];
  const type = challengeType(state.currentQuestion, state.questions.length);
  const operator = type.locked ? selectOperator(state.currentQuestion) : null;
  const areaName = isCombatNode(node) ? roomName(node, state.currentNode) : question?.area || roomName(node, state.currentNode);
  const combatEncounter = isCombatNode(node) ? ensureCombatEncounter(state.currentNode) : null;
  const activeObstacle = combatEncounter
    ? `${combatEncounter.enemies.filter((enemy) => !enemy.defeated).length} hostiles share one advancing combat line; ${combatEncounter.hp} integrity remains`
    : getActiveObstacle(state.currentQuestion, question, type, areaName);
  return { node, question, type, operator, activeObstacle };
}

function isLocalAnswerCorrect(answer, question) {
  if (question.mode === "fill") return isCloseAnswer(answer, question.answerText);
  return String(answer).trim().toUpperCase() === question.answerKey;
}

function answerRevealText(question) {
  if (!question) return "";
  if (question.type === "true-false" && question.sourceAnswerText) {
    return `${question.answerText}. Actual answer: ${question.sourceAnswerText}`;
  }
  return question.answerText;
}

function answerKnowledgeText(question) {
  if (!question) return "";
  if (question.type === "true-false" && question.sourceAnswerText) {
    return `${question.answerText}; underlying study answer: ${question.sourceAnswerText}`;
  }
  return question.answerText;
}

function rememberPreviousAnswer(answer, question, correct) {
  const submittedText = answer === TIMEOUT_ANSWER
    ? "No response before deadline"
    : `Submitted: ${submittedAnswerDisplayText(answer, question)}`;
  state.previousAnswer = {
    id: `answer-${state.currentQuestion}-${Date.now()}`,
    submitted: submittedText,
    required: answerRevealText(question),
    correct: Boolean(correct)
  };
  state.missionAccuracyResults[`${state.currentQuestion}:single`] = Boolean(correct);
}

function submittedAnswerDisplayText(answer, question) {
  const raw = String(answer || "").trim();
  if (!raw || !question || question.mode === "fill") return raw;
  const key = raw.toUpperCase();
  const choice = question.choices?.find((entry) => entry.key === key);
  return choice ? `${key}. ${choice.text}` : raw;
}

function rememberPreviousDeviceTeamAnswers(entries, question, allCorrect) {
  state.previousAnswer = {
    id: `team-answer-${state.currentQuestion}-${Date.now()}`,
    submitted: `${entries.filter((entry) => entry.answer).length} player response${entries.filter((entry) => entry.answer).length === 1 ? "" : "s"} submitted`,
    required: answerRevealText(question),
    correct: Boolean(allCorrect)
  };
  entries.forEach((entry, index) => {
    const playerKey = normalize(entry.player?.name || entry.playerName || entry.playerId || `player-${index + 1}`);
    state.missionAccuracyResults[`${state.currentQuestion}:${playerKey}`] = Boolean(entry.correct);
  });
}

function rememberSkippedQuestion(question) {
  if (!question) return;
  state.previousAnswer = {
    id: `skip-${state.currentQuestion}-${Date.now()}`,
    submitted: "Skipped by team action",
    required: answerRevealText(question),
    correct: true
  };
  renderPreviousAnswer();
}

function snapshotPlayers() {
  return state.players.map((player) => ({
    name: player.name,
    hp: player.hp,
    status: [...player.status],
    incapacitated: player.incapacitated
  }));
}

function changedPlayerEvents(before, eventNotes = {}) {
  return state.players.flatMap((player, index) => {
    const old = before[index];
    if (!old) return [];
    const hpChanged = old.hp !== player.hp;
    const statusChanged = old.status.join("|") !== player.status.join("|");
    const downChanged = old.incapacitated !== player.incapacitated;
    const cause = eventNotes[player.name] || "";
    const secondWindArmed = /Second Wind chance begins/i.test(cause);
    const secondWindSecured = /Second Wind secured/i.test(cause);
    const secondWindFailed = /Second Wind fails/i.test(cause);
    const secondWindChanged = secondWindArmed || secondWindSecured || secondWindFailed;
    if (!hpChanged && !statusChanged && !downChanged && !secondWindChanged) return [];
    const lost = Math.max(0, old.hp - player.hp);
    const gained = Math.max(0, player.hp - old.hp);
    const note = secondWindArmed
      ? "Second Wind armed, now 1 HP"
      : secondWindSecured
      ? "Second Wind secured, 1 HP"
      : secondWindFailed
      ? "Second Wind failed, incapacitated"
      : player.incapacitated && !old.incapacitated
      ? "incapacitated"
      : lost && /existing Bleeding/i.test(cause) ? `${lost} HP lost from existing Bleeding`
      : lost ? `${lost} HP lost`
      : gained ? `${gained} HP recovered`
      : statusChanged ? "status changed"
      : "updated";
    return [{
      name: player.name,
      hp: player.hp,
      status: [...player.status],
      incapacitated: player.incapacitated,
      effect: secondWindArmed || secondWindSecured || gained ? "heal" : secondWindFailed || lost ? "hit" : "status",
      amount: secondWindArmed || secondWindSecured ? 1 : lost || gained || 0,
      note,
      cause
    }];
  });
}

function nextLocalQuestionInfo() {
  const progression = projectedProgressAfterRound();
  const nextNodeIndex = progression.nextNode;
  const nextNode = state.nodes[nextNodeIndex];
  if (nextNode?.type === "boss" && !state.bossReadyChecks.has(nextNodeIndex)) {
    return {
      readyCheck: true,
      tag: "Readiness Check",
      areaName: bossAreaName(nextNode),
      questionText: "Team, confirm when you are ready to push into the critical contact.",
      question: null,
      type: { label: "Readiness Check" },
      bossNodeIndex: nextNodeIndex,
      bossPhase: nextNode.bossPhase || "mid"
    };
  }
  if (nextNode?.type === "recovery") {
    return {
      isRecovery: true,
      tag: nextNode.tier === 1 ? "Recovery Event" : "Major Recovery Event",
      areaName: recoveryAreaName(nextNode),
      questionText: recoveryQuestionText(nextNode),
      question: null,
      type: { label: "Recovery Event" },
      recoveryTier: nextNode.tier,
      afterBoss: Boolean(nextNode.afterBoss)
    };
  }

  if (progression.missionComplete) {
    return {
      index: state.questions.length,
      question: null,
      type: { label: "Final Mission Result" },
      tag: "Final Mission Result",
      operator: null,
      sameBossRoom: false,
      areaName: "Extraction",
      activeObstacle: "",
      questionText: ""
    };
  }
  const nextIndex = Math.min(progression.nextQuestion, state.questions.length - 1);
  const question = state.questions[nextIndex];
  const sameCombatRoom = nextNodeIndex === state.currentNode && isCombatNode(state.nodes[state.currentNode]);
  const type = sameCombatRoom
    ? combatRoundChallengeType(nextIndex)
    : challengeType(nextIndex, state.questions.length);
  const operator = type.locked ? selectOperator(nextIndex) : null;
  const sameBossRoom = sameCombatRoom;
  const areaName = sameBossRoom ? roomName(state.nodes[state.currentNode], state.currentNode) : nextNode?.type === "boss" ? roomName(nextNode, nextNodeIndex) : question?.area || "Unknown Area";
  return {
    index: nextIndex,
    question,
    type,
    tag: progression.nextQuestion >= state.questions.length ? "Final Mission Result" : type.label,
    operator,
    sameBossRoom,
    areaName,
    activeObstacle: getActiveObstacle(nextIndex, question, type, areaName),
    questionText: progression.nextQuestion >= state.questions.length ? "" : localQuestionText(question, type, operator, nextIndex)
  };
}

function projectedProgressAfterRound() {
  const node = state.nodes[state.currentNode];
  if (isCombatNode(node)) {
    const encounter = currentCombatEncounter();
    const indexes = combatQuestionIndexes(node);
    const lastQuestion = indexes[indexes.length - 1] ?? state.currentQuestion;
    if (encounter?.cleared) {
      if (node.type === "boss" && node.bossPhase === "final") {
        return { nextQuestion: state.questions.length, nextNode: state.nodes.length, stayInRoom: false, missionComplete: true };
      }
      return {
        nextQuestion: Math.min(state.questions.length, Math.max(state.currentQuestion + 1, lastQuestion + 1)),
        nextNode: Math.min(state.nodes.length, state.currentNode + 1),
        stayInRoom: false,
        missionComplete: false
      };
    }
    const currentPosition = Math.max(0, indexes.indexOf(state.currentQuestion));
    const nextCombatQuestion = indexes[(currentPosition + 1) % indexes.length] ?? state.currentQuestion;
    return {
      nextQuestion: nextCombatQuestion,
      nextNode: state.currentNode,
      stayInRoom: true,
      missionComplete: false
    };
  }
  const bossProgress = currentBossProgress();
  const stayInRoom = Boolean(bossProgress && !bossProgress.finalStep);
  return {
    nextQuestion: Math.min(state.questions.length, state.currentQuestion + 1),
    nextNode: stayInRoom ? state.currentNode : Math.min(state.nodes.length, state.currentNode + 1),
    stayInRoom,
    missionComplete: state.currentQuestion + 1 >= state.questions.length
  };
}

function recoveryAmounts(tier = 1) {
  return {
    hp: Number(tier) === 1 ? 5 : 10,
    medkits: Number(tier) === 1 ? 3 : 6,
    ems: Number(tier) === 1 ? 1 : 2
  };
}

function recoveryQuestionText(node) {
  const { hp, medkits, ems } = recoveryAmounts(node?.tier);
  const revive = state.players.some((player) => player.incapacitated)
    ? "\n\nOne incapacitated player will be revived for free."
    : "";
  return `Choose one recovery option:\n\nA. Everyone active recovers ${hp} HP\nB. Gain ${medkits} Medkits\nC. Gain ${ems} EMS Device${ems > 1 ? "s" : ""}${revive}`;
}

function recoveryAreaName(node) {
  if (node?.afterBoss) return "Emergency Shelter";
  return node?.tier === 1 ? "Emergency Aid Station" : "Fortified Maintenance Hub";
}

function completeRecoveryArrival(summary, playerEvents = []) {
  state.resolved = false;
  state.answerPending = false;
  state.questionPresentationReady = false;
  clearSubmittedAnswer();
  renderStatus();
  renderMap();

  if (state.currentNode >= state.nodes.length || state.currentQuestion >= state.questions.length) {
    renderEnding();
    return;
  }

  if (!state.chatMode && !state.localDmMode) {
    beginNextNode();
    return;
  }

  const destination = state.nodes[state.currentNode];
  if (destination?.type === "boss" && !state.bossReadyChecks.has(state.currentNode)) {
    appendTranscript({
      tag: "Readiness Check",
      areaName: bossAreaName(destination),
      story: `The route marker settles at ${bossAreaName(destination)}. The pressure ahead holds until the team chooses to begin critical contact.`,
      readyCheck: true,
      bossNodeIndex: state.currentNode,
      bossPhase: destination.bossPhase || "mid",
      players: playerEvents,
      inventory: { ...state.inventory },
      statusLog: summary
    });
    return;
  }

  const qInfo = currentQuestionInfo();
  appendTranscript({
    tag: qInfo.tag,
    areaName: qInfo.areaName,
    story: `The squad marker locks into ${qInfo.areaName}. The next system comes online.`,
    activeObstacle: qInfo.activeObstacle,
    question: qInfo.questionText,
    players: playerEvents,
    inventory: { ...state.inventory },
    statusLog: summary,
    suppressEffectFlash: true
  });
}

function resolveLocalRecovery(answer) {
  const node = state.nodes[state.currentNode];
  if (!node || node.type !== "recovery") return;
  const recoveryNodeIndex = state.currentNode;
  const nextNodeIndex = Math.min(state.nodes.length, recoveryNodeIndex + 1);
  const nextNode = state.nodes[nextNodeIndex];
  const nextQuestion = state.questions[state.currentQuestion];
  const nextAreaName = nextNode?.type === "boss"
    ? roomName(nextNode, nextNodeIndex)
    : nextQuestion?.area || roomName(nextNode || { type: "challenge" }, nextNodeIndex);
  state.resolved = true;
  const before = snapshotPlayers();
  const choice = String(answer).trim().toUpperCase();
  const { hp, medkits, ems } = recoveryAmounts(node.tier);
  const down = state.players.find((player) => player.incapacitated);
  if (down) {
    down.incapacitated = false;
    down.hp = 3;
    down.status = [];
  }

  // An emergency aid room is a full status reset, regardless of which
  // recovery reward the team selects. Clear lingering Burned/Bleeding/etc.
  // before taking the change snapshot so every device receives the update.
  state.players.forEach((player) => {
    player.status = [];
  });

  if (choice === "A") {
    state.players.forEach((player) => {
      if (!player.incapacitated) healPlayer(player, hp);
    });
  } else if (choice === "B") {
    state.inventory.medkits += medkits;
  } else {
    state.inventory.ems += ems;
  }

  const playerEvents = changedPlayerEvents(before);
  const choiceText = choice === "A" ? `Everyone active recovers ${hp} HP` : choice === "B" ? `Gain ${medkits} Medkits` : `Gain ${ems} EMS Device${ems > 1 ? "s" : ""}`;
  const reviveText = down ? `${down.name} is revived to 3 HP.` : "";
  const prompt = [
    "Act as the DM for a fast-paced survival study adventure.",
    `Write ${narrationSentenceRange("5-10", "2-4")} sentences only.`,
    "Describe the recovery choice, any free revive, then transition into the next area.",
    "Do not include the multiple-choice question.",
    `Keep the recovery window tense with one brief sign that ${state.threat} is still close.`,
    `Recovery area: ${recoveryAreaName(node)}.`,
    node.afterBoss ? "Aftermath requirement: show the physical aftermath of the confrontation they just survived, then make the recovery feel like a hard-won pause that pushes the mission forward." : "Aftermath requirement: this is a standard recovery window.",
    `Choice: ${choiceText}. ${reviveText}`,
    `Next area: ${nextAreaName}.`,
    `Next question concept: ${nextQuestion?.question || "final route"}`
  ].join("\n");

  const finishRecovery = (text) => {
    stopTransmissionFeedback();
    const summary = [choiceText, reviveText].filter(Boolean).join(" ");
    appendTranscript({
      tag: "Recovery Departure",
      areaName: recoveryAreaName(node),
      story: text || `The team takes the recovery window, seals what wounds they can, and prepares to move toward ${nextAreaName}.`,
      onTypedComplete: () => {
        travelFromRecoveryRoom(recoveryNodeIndex, nextNodeIndex, () => completeRecoveryArrival(summary, playerEvents));
      }
    });
  };

  setAnswerPendingText("Receiving recovery transmission...");
  startPassiveTransmissionFeedback({ type: { label: "Recovery Event" }, playerEvents });
  if (!ENABLE_TRANSITION_NARRATION_GENERATION) {
    roomTransitionTraceEmit("MARK", "recovery departure LM skipped", { nextAreaName });
    window.setTimeout(() => finishRecovery(""), 0);
    return;
  }
  requestOllama(prompt, { temperature: 0.72 })
    .then((text) => {
      finishRecovery(cleanLocalNarration(text));
    })
    .catch(() => {
      finishRecovery("");
    });
}

function currentQuestionInfo() {
  if (state.bossReadyPending) {
    return {
      question: null,
      type: { label: "Readiness Check" },
      tag: "Readiness Check",
      operator: null,
      areaName: roomName(state.nodes[state.currentNode] || { type: "boss" }, state.currentNode),
      questionText: "Team, confirm when you are ready to push into the critical contact."
    };
  }
  if (state.actionDrivenMode) return currentActionRoomInfo();
  const question = state.questions[state.currentQuestion];
  const node = state.nodes[state.currentNode];
  const type = isCombatNode(node)
    ? combatRoundChallengeType(state.currentQuestion)
    : challengeType(state.currentQuestion, state.questions.length);
  const operator = type.locked ? selectOperator(state.currentQuestion) : null;
  const combatEncounter = isCombatNode(node) ? ensureCombatEncounter(state.currentNode) : null;
  const areaName = isCombatNode(node)
    ? roomName(node, state.currentNode)
    : question?.area || "Unknown Area";
  return {
    question,
    type,
    tag: type.label,
    operator,
    areaName,
    questionText: localQuestionText(question, type, operator),
    activeObstacle: combatEncounter
      ? `${combatEncounter.enemies.filter((enemy) => !enemy.defeated).length} hostiles share one advancing combat line; ${combatEncounter.hp} integrity remains`
      : getActiveObstacle(state.currentQuestion, question, type, areaName)
  };
}

function currentActionRoomInfo() {
  const node = state.nodes[state.currentNode] || {};
  const room = state.actionRooms[state.currentQuestion] || actionRoomTypePool[0];
  const operator = ensureActionPressureSpotlight(room);
  const attempts = state.actionRoomAttempts[state.currentQuestion] || 0;
  const areaName = room.areaName || roomName(node, state.currentNode);
  const questionText = actionRoomPromptText(room, attempts);
  return {
    question: {
      question: questionText,
      choices: [],
      answerKey: "",
      answerText: "",
      mode: "action",
      type: "action",
      area: areaName
    },
    type: { label: room.pressureSpotlight ? "Pressure Spotlight" : room.label || "Action Turn", kind: "action", actionRoom: true, locked: Boolean(room.pressureSpotlight && operator) },
    tag: room.label || "Action Turn",
    operator,
    areaName,
    questionText,
    activeObstacle: actionRoomObstacle(room, attempts),
    actionRoom: room,
    attempts
  };
}

function actionRoomPromptText(room, attempts = 0) {
  const retry = attempts > 0 ? ` The room has resisted the team; this is attempt ${attempts + 1}.` : "";
  if (room.pressureSpotlight && room.pressureOperatorName) {
    return `${room.pressureOperatorName} is singled out by a sudden threat spike and must submit one quick field reaction before the window closes. Objective: ${room.objective}.${retry}`;
  }
  return `Submit one useful field action for this ${room.label.toLowerCase()}. Actions resolve in turn order when all active operators act or the timer expires. Objective: ${room.objective}.${retry}`;
}

function actionRoomObstacle(room, attempts = 0) {
  const retry = attempts ? ` The room has resisted ${attempts} prior attempt${attempts === 1 ? "" : "s"}.` : "";
  const pressure = room.pressureSpotlight && room.pressureOperatorName ? ` Immediate spotlight: ${room.pressureOperatorName} must react quickly or the consequences can hit hard.` : "";
  return `Action room objective: ${room.objective}. Resolution style: ${room.scoring} scoring.${room.turnLimit ? ` Turn limit: ${room.turnLimit}.` : ""}${pressure}${retry}`;
}

function ensureActionPressureSpotlight(room = {}) {
  if (!room.pressureSpotlight) return null;
  if (!room.pressureOperatorName || !findPlayer({ name: room.pressureOperatorName }) || findPlayer({ name: room.pressureOperatorName })?.incapacitated) {
    const active = activePlayers();
    const picked = active.length ? active[Math.floor(state.rng() * active.length)] : null;
    room.pressureOperatorName = picked?.name || "";
  }
  return room.pressureOperatorName ? findPlayer({ name: room.pressureOperatorName }) : null;
}

function getActiveObstacle(index, question, type, areaName) {
  if (!question) return "";
  if (!state.activeObstacles[index]) {
    state.activeObstacles[index] = buildActiveObstacle(index, question, type, areaName);
  }
  return state.activeObstacles[index];
}

function buildActiveObstacle(index, question, type, areaName) {
  const concept = String(question?.question || "the active route system");
  const area = areaName || question?.area || "the current area";
  const device = conceptDeviceName(concept);
  const threat = type?.boss
    ? `${state.threat} pressing directly through the chamber`
    : state.threat;
  if (type?.boss) {
    const final = type.bossPhase === "final";
    const finalStep = Boolean(type.bossFinalStep);
    return [
      `Active obstacle: ${final ? "persistent threat manifestation" : "major threat pressure"}.`,
      `Obstacle behavior: ${final ? state.threat : "the same major hostile force"} dominates ${area}, adapting its attack around the ${device} without changing rooms or becoming a new enemy.`,
      `Study concept connection, private only: ${concept}.`,
      `Threat pressure: ${threat}.`,
      finalStep
        ? "If the team succeeds: the decisive attack, containment, override, escape maneuver, or last defense breaks the threat's hold."
        : "If the team succeeds: the threat recoils, loses ground, or is forced into the next exchange.",
      finalStep
        ? "If the team fails: the threat overwhelms the final exchange and punishes the squad before the outcome is forced."
        : "If the team fails: the threat adapts, advances, and punishes the squad while the fight continues."
    ].join(" ");
  }
  const variants = [
    {
      name: `${device} route lock`,
      behavior: `blocks passage through ${area} with locked actuators, warning lights, and unstable feedback`,
      success: "unlocks, vents pressure, and gives the squad a narrow path forward",
      failure: "kicks back through the access path and makes the route more dangerous"
    },
    {
      name: `failing infrastructure barrier`,
      behavior: `turns the route through ${area} into a physical obstruction of buckling panels, live conduit, and jammed access hardware`,
      success: "settles long enough for the team to force a clean passage",
      failure: "shifts violently and punishes the team before the route can be forced open"
    },
    {
      name: `automated defense system`,
      behavior: `blocks ${area} with threat-controlled targeting behavior, sparking defensive frames, and hostile movement sensors`,
      success: "loses tracking, drops its defensive frame, and leaves an opening",
      failure: "retaliates through the room before the squad can break its line of control"
    },
    {
      name: `unstable field hazard`,
      behavior: `floods ${area} with interference, distorted readings, and an unsafe threshold the squad cannot cross blindly`,
      success: "collapses into a brief stable corridor",
      failure: "surges across the threshold and catches the team in the backlash"
    },
    {
      name: `security soldiers`,
      behavior: `hold ${area} with weapons, optics, shouted orders, and hard cover around the active equipment`,
      success: "lose their angle as the squad uses the system to open cover, reroute alarms, or force them back",
      failure: "press their advantage and punish the squad's exposed position"
    },
    {
      name: `raider squad`,
      behavior: `blocks ${area} with scavenged weapons, improvised traps, and a stolen control point they barely understand`,
      success: "breaks formation when the route system turns their own trap against them",
      failure: "springs the trap and surges forward before the team can recover"
    },
    {
      name: `alien predator`,
      behavior: `stalks ${area} from vents, shadows, and blind corners while the active equipment draws its attention`,
      success: "is driven back when the squad manipulates the system and denies it an ambush path",
      failure: "strikes from the blind side as the room stays hostile"
    },
    {
      name: `mutated maintenance crew`,
      behavior: `crowds ${area} in warped work gear, guarding the equipment as if still trapped in a broken repair routine`,
      success: "scatters when the system returns to a safe state and interrupts their corrupted routine",
      failure: "surges into the team with tools, teeth, and ruined muscle memory"
    },
    {
      name: `combat drone pack`,
      behavior: `sweeps ${area} with rotor noise, scan grids, and weapon lights locked around the active system`,
      success: "loses coordination as the squad disrupts its targeting path",
      failure: "dives through the room and catches exposed operators in the open"
    },
    {
      name: `possessed technician`,
      behavior: `moves through ${area} with stolen maintenance knowledge, sabotage tools, and a body pushed past pain`,
      success: "is forced away from the control point when the squad restores the correct system state",
      failure: "uses the failed action as an opening to sabotage the room and attack"
    },
    {
      name: `arcane construct`,
      behavior: `guards ${area} with heavy limbs, charged glyphs, and old protection logic focused on the active mechanism`,
      success: "locks up as the correct pathway proves authorized passage",
      failure: "lashes out with rune-driven force and seals the route harder"
    },
    {
      name: `bio-mechanical parasite`,
      behavior: `spreads through ${area} as cable-veins, twitching machinery, and wet growth around the active controls`,
      success: "recoils when the squad cuts off the control path it was feeding on",
      failure: "tightens around the room and snaps back through the compromised equipment"
    },
    {
      name: `hostile boarding party`,
      behavior: `pushes into ${area} with breach gear, weapons lights, and practiced movement toward the active system`,
      success: "is stalled by sealed access and restored route control",
      failure: "breaches deeper and catches the team before the route can be secured"
    },
    {
      name: `swarm creature`,
      behavior: `moves through ${area} as a skittering mass in vents, cable trays, and shadows around the equipment`,
      success: "splits apart when the system forces heat, sound, or power away from its path",
      failure: "pours over the threshold and overwhelms the team's space"
    },
    {
      name: `rogue repair robot`,
      behavior: `blocks ${area} with tool arms, welding glare, cutting heads, and corrupted maintenance logic`,
      success: "drops into a locked service posture long enough for the squad to pass",
      failure: "drives its tools through the workspace and forces a violent retreat"
    }
  ];
  const chosen = variants[Math.floor(state.rng() * variants.length)] || variants[Math.abs(index) % variants.length];
  return [
    `Active obstacle: ${chosen.name}.`,
    `Obstacle behavior: ${chosen.behavior}.`,
    `Study concept connection, private only: ${concept}.`,
    `Threat pressure: ${threat}.`,
    `If the team succeeds: ${chosen.success}.`,
    `If the team fails: ${chosen.failure}.`
  ].join(" ");
}

function currentBossProgress() {
  const node = state.nodes[state.currentNode];
  const type = challengeType(state.currentQuestion, state.questions.length);
  if (node?.type !== "boss" || !Array.isArray(node.questionIndexes)) return null;
  const stepIndex = Math.max(0, node.questionIndexes.indexOf(state.currentQuestion));
  return {
    node,
    type,
    step: stepIndex + 1,
    total: node.questionIndexes.length,
    finalStep: stepIndex === node.questionIndexes.length - 1,
    phase: node.bossPhase || type.bossPhase || "mid"
  };
}

function bossPhasePromptLines(progress = currentBossProgress()) {
  if (!progress) return [];
  const finalEncounter = progress.phase === "final";
  const finalStep = progress.finalStep;
  const arena = bossAreaName(progress.node);
  const planned = bossPhasePlanForProgress(progress);
  const planLines = planned ? [
    `Planned phase name: ${planned.phase.name}.`,
    `Planned enemy action: ${planned.phase.enemyAction}.`,
    `Planned arena pressure: ${planned.phase.environmentPressure}.`,
    `Planned study-action style: ${planned.phase.studyActionStyle}.`,
    `Planned success tone: ${planned.phase.successTone}.`,
    `Planned failure tone: ${planned.phase.failureTone}.`,
    `Planned status risk: ${planned.phase.statusRisk}.`,
    planned.phase.windUp?.enabled
      ? `Wind-up event: ${planned.phase.windUp.telegraph} Prevention window: ${planned.phase.windUp.preventionWindow} EMS result: ${planned.phase.windUp.emsResult} Action result style: ${planned.phase.windUp.actionResultStyle} Brace result: ${planned.phase.windUp.braceResult}.`
      : "Wind-up event: none for this phase."
  ] : [];
  return [
    `Boss continuity: this is phase ${progress.step} of ${progress.total} inside ${arena}; do not introduce a new room or rename the arena.`,
    finalEncounter
      ? `Enemy continuity: this is the mission's persistent threat made direct; the squad is actively fighting, blocking, containing, outrunning, or defending against ${state.threat}.`
      : `Enemy continuity: this is one major threat controlling the room; keep it as the same opponent or hazard across all phases of this encounter.`,
    ...planLines,
    "Phase rhythm: show what the threat does now, translate the private study concept into the squad's immediate battlefield action, resolve the exchange, then keep pressure moving.",
    finalStep
      ? "Final phase requirement: set up and resolve a decisive attack, containment, override, escape maneuver, or last defense against the threat."
      : "Non-final phase requirement: end with the threat adapting, recoiling, advancing, repositioning, or forcing the next exchange."
  ];
}

function bossPhasePlanForProgress(progress = currentBossProgress()) {
  if (!progress) return null;
  const key = bossPlanKey(progress.node, state.currentNode);
  const plan = state.bossPhasePlans[key];
  const phase = plan?.phases?.[progress.step - 1];
  return phase ? { plan, phase } : null;
}

function bossPlanKey(node, index) {
  return String(Number.isFinite(Number(index)) ? Number(index) : state.nodes.indexOf(node));
}

function preloadBossPhasePlan(payload) {
  if (!ENABLE_BOSS_PHASE_PLAN_GENERATION) return;
  const nodeIndex = Number.isFinite(Number(payload.bossNodeIndex)) ? Number(payload.bossNodeIndex) : state.currentNode + 1;
  const node = state.nodes[nodeIndex];
  if (!node || node.type !== "boss") return;
  const key = bossPlanKey(node, nodeIndex);
  if (state.bossPhasePlans[key] || state.bossPhasePlanRequests[key]) return;
  const prompt = makeBossPhasePlanPrompt(node, nodeIndex, payload.areaName || bossAreaName(node));
  state.bossPhasePlanRequests[key] = true;
  logDebugEvent({
    kind: "request",
    label: "Boss phase plan sent",
    detail: `${bossAreaName(node)} / ${node.bossPhase || "mid"} / ${node.questionIndexes?.length || 0} phases`
  });
  requestOllama(prompt, { temperature: 0.55, format: "json" })
    .then((text) => {
      const plan = parseBossPhasePlan(text, node, payload.areaName || bossAreaName(node));
      state.bossPhasePlans[key] = plan;
      if (plan.arena) {
        const cleanedArena = cleanBossAreaName(plan.arena);
        if (cleanedArena) {
          state.roomNames[nodeIndex] = cleanedArena;
          if (node.bossPhase === "final") state.bossAreaNames.final = cleanedArena;
          else state.bossAreaNames.mid = cleanedArena;
          renderMap();
        }
      }
      logDebugEvent({
        kind: "response",
        label: "Boss phase plan stored",
        detail: `${plan.arena || bossAreaName(node)} / ${plan.phases.length} phases / ${plan.phases.filter((phase) => phase.windUp?.enabled).length} wind-ups`
      });
    })
    .catch((error) => {
      logDebugEvent({
        kind: "error",
        label: "Boss phase plan fallback",
        detail: error.message || String(error)
      });
      state.bossPhasePlans[key] = fallbackBossPhasePlan(node, payload.areaName || bossAreaName(node));
    })
    .finally(() => {
      delete state.bossPhasePlanRequests[key];
    });
}

function makeBossPhasePlanPrompt(node, nodeIndex, arenaName) {
  const total = Math.max(1, Array.isArray(node.questionIndexes) ? node.questionIndexes.length : node.bossPhase === "final" ? FINAL_BOSS_QUESTIONS : MID_BOSS_QUESTIONS);
  const windUps = node.bossPhase === "final" ? 2 : Math.min(1, total);
  const encounterLabel = node.bossPhase === "final" ? "final boss" : "mid-boss";
  return [
    "Return valid JSON only. No markdown. No commentary. No analysis.",
    `Create one hidden ${encounterLabel} phase plan for a classroom survival-study adventure.`,
    `Hard requirements: phases must contain exactly ${total} objects.`,
    `Exactly ${windUps} phase${windUps === 1 ? "" : "s"} must have windUp.enabled true.`,
    "All other phases must have windUp.enabled false and all other windUp fields must be empty strings.",
    node.bossPhase === "final" ? "The final phase must have windUp.enabled true." : "If a wind-up exists, prefer the final phase.",
    "Every phase must stay in the same arena and continue the same battle.",
    "Do not introduce a new room in any phase.",
    "Do not rename the arena in any phase.",
    "Do not use classroom skill names, tabletop terms, DCs, saves, rolls, checks, advantage, disadvantage, stacks, ability scores, spell slots, HP, hit points, question, answer, option, or quiz.",
    "studyActionStyle must describe only physical in-world actions, tools, repairs, defenses, attacks, containment moves, survival maneuvers, or diagnostics.",
    "statusRisk must be exactly one of: Burned, Bleeding, Shocked, Concussed, none.",
    `Mission style: ${state.missionType}.`,
    `Environment: ${state.environment}.`,
    `Arena: ${arenaName}.`,
    `Persistent threat: ${state.threat}; ${compactThreatProfileText()}.`,
    `Encounter type: ${encounterLabel}.`,
    "JSON shape exactly:",
    "{\"arena\":\"\",\"enemy\":\"\",\"phases\":[{\"name\":\"\",\"enemyAction\":\"\",\"environmentPressure\":\"\",\"studyActionStyle\":\"\",\"successTone\":\"\",\"failureTone\":\"\",\"statusRisk\":\"none\",\"windUp\":{\"enabled\":false,\"telegraph\":\"\",\"preventionWindow\":\"\",\"emsResult\":\"\",\"actionResultStyle\":\"\",\"braceResult\":\"\"}}]}"
  ].join("\n");
}

function parseBossPhasePlan(text, node, fallbackArena) {
  try {
    const parsed = JSON.parse(extractJsonPayload(text));
    return normalizeBossPhasePlan(parsed, node, fallbackArena);
  } catch (error) {
    logDebugEvent({
      kind: "error",
      label: "Boss phase plan parse fallback",
      detail: `${error.message || error} / ${compactDebugText(text, 180)}`
    });
    return fallbackBossPhasePlan(node, fallbackArena);
  }
}

function compactDebugText(text, limit = 180) {
  const cleaned = String(text || "").replace(/\s+/g, " ").trim();
  if (!cleaned) return "empty response";
  return cleaned.length > limit ? `${cleaned.slice(0, limit)}...` : cleaned;
}

function normalizeBossPhasePlan(parsed, node, fallbackArena) {
  const total = Math.max(1, Array.isArray(node.questionIndexes) ? node.questionIndexes.length : node.bossPhase === "final" ? FINAL_BOSS_QUESTIONS : MID_BOSS_QUESTIONS);
  const desiredWindUps = node.bossPhase === "final" ? 2 : Math.min(1, total);
  const sourcePhases = Array.isArray(parsed?.phases) ? parsed.phases : [];
  const phases = Array.from({ length: total }, (_, index) => normalizeBossPhase(sourcePhases[index], index, total, node));
  enforceBossWindUps(phases, desiredWindUps, node.bossPhase === "final");
  return {
    arena: cleanBossAreaName(parsed?.arena) || fallbackArena || bossAreaName(node),
    enemy: cleanBriefingField(parsed?.enemy) || state.threat,
    phases
  };
}

function normalizeBossPhase(phase, index, total, node) {
  const fallback = fallbackBossPhase(index, total, node);
  const status = cleanBriefingField(phase?.statusRisk);
  const windUp = phase?.windUp && typeof phase.windUp === "object" ? phase.windUp : {};
  return {
    name: cleanBriefingField(phase?.name) || fallback.name,
    enemyAction: cleanBriefingField(phase?.enemyAction) || fallback.enemyAction,
    environmentPressure: cleanBriefingField(phase?.environmentPressure) || fallback.environmentPressure,
    studyActionStyle: cleanBriefingField(phase?.studyActionStyle) || fallback.studyActionStyle,
    successTone: cleanBriefingField(phase?.successTone) || fallback.successTone,
    failureTone: cleanBriefingField(phase?.failureTone) || fallback.failureTone,
    statusRisk: ["Burned", "Bleeding", "Shocked", "Concussed", "none"].includes(status) ? status : fallback.statusRisk,
    windUp: {
      enabled: Boolean(windUp.enabled),
      telegraph: cleanBriefingField(windUp.telegraph),
      preventionWindow: cleanBriefingField(windUp.preventionWindow),
      emsResult: cleanBriefingField(windUp.emsResult),
      actionResultStyle: cleanBriefingField(windUp.actionResultStyle),
      braceResult: cleanBriefingField(windUp.braceResult)
    }
  };
}

function enforceBossWindUps(phases, desired, finalRequired) {
  const enabled = phases.map((phase, index) => phase.windUp.enabled ? index : -1).filter((index) => index >= 0);
  const finalIndex = phases.length - 1;
  const keep = new Set();
  if (finalRequired && finalIndex >= 0) keep.add(finalIndex);
  for (const index of enabled) {
    if (keep.size >= desired) break;
    keep.add(index);
  }
  for (let index = phases.length - 1; index >= 0 && keep.size < desired; index--) keep.add(index);
  phases.forEach((phase, index) => {
    if (keep.has(index)) {
      phase.windUp.enabled = true;
      if (!phase.windUp.telegraph) phase.windUp.telegraph = "The threat visibly gathers power for a dangerous surge.";
      if (!phase.windUp.preventionWindow) phase.windUp.preventionWindow = "The squad has one brief chance to spend EMS, take a direct action, or brace.";
      if (!phase.windUp.emsResult) phase.windUp.emsResult = "EMS disrupts the surge before it lands.";
      if (!phase.windUp.actionResultStyle) phase.windUp.actionResultStyle = "A plausible physical or technical action can blunt or stop the surge.";
      if (!phase.windUp.braceResult) phase.windUp.braceResult = "The squad endures the impact and keeps fighting.";
      return;
    }
    phase.windUp = { enabled: false, telegraph: "", preventionWindow: "", emsResult: "", actionResultStyle: "", braceResult: "" };
  });
}

function fallbackBossPhasePlan(node, arena) {
  return normalizeBossPhasePlan({ arena, enemy: state.threat, phases: [] }, node, arena);
}

function fallbackBossPhase(index, total, node) {
  const final = node.bossPhase === "final";
  const names = final
    ? ["Manifestation", "Signal Surge", "Structural Break", "Containment Fight", "System Collapse", "Final Counterstrike"]
    : ["Contact", "Pressure", "Breakthrough", "Shutdown"];
  const name = names[Math.min(index, names.length - 1)] || `Phase ${index + 1}`;
  return {
    name,
    enemyAction: final ? `${state.threat} pushes directly through the arena.` : "The major threat changes tactics without leaving the arena.",
    environmentPressure: "The arena distorts under alarms, heat, unstable machinery, and hostile movement.",
    studyActionStyle: "The squad turns the private study concept into a physical countermeasure under pressure.",
    successTone: index === total - 1 ? "The threat loses its hold as the squad forces the decisive move through." : "The threat recoils and shifts into the next exchange.",
    failureTone: index === total - 1 ? "The final surge lands hard and the squad is forced to survive the aftermath." : "The threat punishes the mistake and advances its pressure.",
    statusRisk: final ? "Shocked" : "Concussed",
    windUp: { enabled: false, telegraph: "", preventionWindow: "", emsResult: "", actionResultStyle: "", braceResult: "" }
  };
}

function localQuestionText(question, type, operator = null, questionIndex = state.currentQuestion) {
  if (!question) return "";
  const prefix = type.locked && operator ? `${operator.name} only: ` : "";
  if (question.mode === "fill") return `${prefix}${displayQuestionText(question)}`;
  const narrowed = new Set(state.narrowedChoices[questionIndex] || []);
  const choices = question.choices
    .filter((choice) => !narrowed.has(choice.key))
    .map((choice) => `${choice.key}. ${choice.text}`)
    .join("\n");
  return `${prefix}${displayQuestionText(question)}\n\n${choices}`;
}

function displayQuestionText(question) {
  const text = String(question?.question || "");
  if (question?.mode !== "fill") return text;
  const formatted = text
    .replace(/_{2,}/g, "____")
    .replace(/\s+([,.;:?!])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  if (question?.type === "fill" && !/_{2,}/.test(formatted)) return `${formatted} ____`;
  return formatted;
}

function localStatusLog(playerEvents, loot) {
  const changes = playerEvents.map((event) => `${event.name}: ${event.note}${event.status.length ? `, ${event.status.join(", ")}` : ""}`);
  if (loot) changes.push(loot);
  return changes.join(" ");
}

function nextObstacleDangerFrame(nextInfo) {
  if (!nextInfo.question) {
    return [
      `Next obstacle/danger: ${nextInfo.activeObstacle || "final route pressure or recovery area"}; unresolved until the team arrives.`,
      "Next player-facing action frame: hold position, secure the route, and assess the obstruction without resolving it."
    ].join("\n");
  }
  const obstacle = stripPrivateStudyConcept(nextInfo.activeObstacle || "unresolved route obstruction");
  const frame = physicalActionFrameForQuestion(nextInfo.question);
  return [
    `Next obstacle/danger to stage, not resolve: ${obstacle}`,
    `Next player-facing action frame: ${frame}`,
    "Do not mention, hint at, quote, or paraphrase the next study prompt. Describe only the physical danger, access problem, enemy pressure, and field action required."
  ].join("\n");
}

function stripPrivateStudyConcept(text) {
  return String(text || "")
    .replace(/\s*Study concept connection, private only:[^.]*\./gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function physicalActionFrameForQuestion(question) {
  const text = String(question?.question || "");
  if (/capacitor|capacitance|charge|store/i.test(text)) {
    return "stabilize the overloaded power-conditioning assembly, isolate the unstable stored-energy section, and force open a safe route.";
  }
  if (/frequency|hertz|rf|signal|antenna|radar/i.test(text)) {
    return "stabilize the signal-calibration gate, clean up the unstable waveform, and hold the transmission path long enough to pass.";
  }
  if (/diode|anode|cathode|polarity|terminal/i.test(text)) {
    return "secure the live contact frame, align the protected lead path, and prevent a polarity fault from arcing across the walkway.";
  }
  if (/inverter|rectifier|ac|dc|converter/i.test(text)) {
    return "configure the converter rack, isolate the bad power path, and keep the route hardware from reversing into a surge.";
  }
  if (/battery|ups|cell|backup/i.test(text)) {
    return "stabilize the backup-power bay, isolate the failing reserve bus, and keep emergency power from collapsing the access route.";
  }
  if (/network|packet|ethernet|router|switch|ip/i.test(text)) {
    return "restore the route-control uplink, isolate the corrupted path, and keep hostile traffic from locking the doors.";
  }
  if (/ground|fuse|surge|breaker|current|overvoltage/i.test(text)) {
    return "secure the protection bus, isolate the overload path, and keep the safety frame from dumping energy into the room.";
  }
  if (/meter|oscilloscope|instrument|waveform|measure/i.test(text)) {
    return "stabilize the diagnostic bench, lock onto a usable reading, and keep the access system from drifting into a false state.";
  }
  return "stabilize the active field assembly, isolate the dangerous section, and force open a safe path without resolving the procedure yet.";
}

function challengePresentation(question, index = 0) {
  const concept = question?.question || "the active study concept";
  const presentations = [
    `an unstable control system blocks the route and requires an in-world action tied to: ${concept}`,
    `a physical obstruction or failing piece of infrastructure blocks the squad and can only be cleared through an action tied to: ${concept}`,
    `a hostile automated defense, creature, or threat-controlled machine blocks the route; defeating or bypassing it requires an action tied to: ${concept}`,
    `a damaged field device, locked mechanism, or environmental hazard prevents safe passage until the squad acts on: ${concept}`,
    `a physical enemy patrol, predator, drone pack, construct, or corrupted operator controls the area; surviving or forcing it back requires an action tied to: ${concept}`
  ];
  return presentations[Math.abs(index) % presentations.length];
}

function localFallbackBlocks(correct, context, result, nextInfo, actionSeed) {
  const knowledge = correct
    ? `The diagnostic strip steadies around ${answerRevealText(context.question)}, confirming the repair path.`
    : `Fault lights flare across the panel. The diagnostic strip identifies ${answerRevealText(context.question)} as the required correction.`;
  const obstacleClose = closeObstacleFallback(context.activeObstacle, correct);
  const transition = nextInfo.sameBossRoom
    ? `The squad stays inside ${nextInfo.areaName} as alarms climb and the same enemy pressure shifts to a new angle.`
    : "The squad clears the damaged threshold and follows the marked route deeper into the facility.";
  return {
    impact: `${actionSeed} ${knowledge} ${obstacleClose} ${result.narration} ${result.loot || ""}`.trim(),
    transition,
    arrival: nextInfo.readyCheck
      ? `The route opens onto ${nextInfo.areaName}, but the threshold beyond it is already shaking under hostile pressure. The squad has a few seconds to regroup before committing to the breach.`
      : nextInfo.isRecovery
      ? `The team reaches ${nextInfo.areaName}, where a brief recovery window opens behind a sealed bulkhead.`
      : nextInfo.type?.boss
      ? bossArrivalStaging(nextInfo)
      : nextInfo.question
      ? `The team reaches ${nextInfo.areaName}. ${lockedOperatorFallback(nextInfo)}${stageObstacleFallback(nextInfo.activeObstacle) || fallbackArrivalStaging(nextInfo)}`
      : "The final lock opens, and the route to extraction shudders into view."
  };
}

function closeObstacleFallback(activeObstacle, correct) {
  if (!activeObstacle) return "";
  const name = obstacleName(activeObstacle) || "obstacle";
  return correct
    ? `The ${name} finally breaks its hold on the room, dropping enough pressure for the squad to move.`
    : `The ${name} lashes back before the squad can force a path through it.`;
}

function stageObstacleFallback(activeObstacle) {
  if (!activeObstacle) return "";
  return `${obstacleNarration(activeObstacle)} The squad cannot move deeper until it is dealt with.`;
}

function obstacleName(activeObstacle) {
  return String(activeObstacle || "").match(/Active obstacle:\s*([^\.]+)\./i)?.[1]?.trim() || "";
}

function obstacleBehavior(activeObstacle) {
  return String(activeObstacle || "").match(/Obstacle behavior:\s*([^\.]+)\./i)?.[1]?.trim() || "";
}

function obstacleNarration(activeObstacle) {
  const name = obstacleName(activeObstacle);
  const behavior = obstacleBehavior(activeObstacle);
  if (!name && !behavior) return "A hostile obstruction holds the route closed.";
  const article = /^[aeiou]/i.test(name) ? "An" : "A";
  if (!behavior) return `${article} ${name} holds the route closed.`;
  return `${article} ${name} ${behavior}.`;
}

function bossArrivalStaging(nextInfo) {
  const final = nextInfo.type?.bossPhase === "final";
  if (nextInfo.sameBossRoom) {
    const finalStep = Boolean(nextInfo.type?.bossFinalStep);
    return finalStep
      ? `The confrontation reaches its last exchange inside ${nextInfo.areaName}. ${state.threat} commits everything at once, forcing the squad into a decisive attack or final defense.`
      : `The confrontation does not let up. The team is still inside ${nextInfo.areaName}, and the same hostile pressure shifts tactics as ${state.threat} bears down through the chamber. The next action has to happen under fire without treating this as a fresh room.`;
  }
  return `The team enters ${nextInfo.areaName}, and the route slams shut behind them. ${state.threat} gathers into ${final ? "the mission's final hostile manifestation, something that must be fought back or contained directly" : "one major threat controlling the room"}, turning the chamber into a live battlefield of failing machinery, hostile movement, and collapsing access paths. The squad has to survive every phase before the next door will open.`;
}

function fallbackArrivalStaging(nextInfo) {
  const variants = [
    "The next control system wakes under fault lights and holds the route shut.",
    "A warped access barrier blocks the passage, its damaged actuator waiting for the squad to diagnose the only viable way through.",
    "A threat-controlled maintenance unit drags itself into the corridor and locks the approach behind a sparking defensive frame.",
    "An unstable field device floods the threshold with interference, turning the next few meters into an impassable hazard."
  ];
  return variants[Math.abs(nextInfo.index || 0) % variants.length];
}

function lockedOperatorFallback(nextInfo) {
  if (!nextInfo.type?.locked || !nextInfo.operator) return "";
  const reasons = [
    `A jammed isolation door leaves ${nextInfo.operator.name} alone beside the only live terminal while the squad works to pry the barrier open. `,
    `The failing console binds itself to ${nextInfo.operator.name}'s headset channel, muting every other transmitter in the room. `,
    `A flash of arcing current cuts the squad off from the panel, leaving ${nextInfo.operator.name} inside the insulated service cage with the controls. `,
    `The access cradle seals around ${nextInfo.operator.name} when the room wakes, and the remaining displays go dark. `
  ];
  return reasons[Math.floor(state.rng() * reasons.length)];
}

function localAnswerSelection(context, answer) {
  const question = context.question;
  if (answer === TIMEOUT_ANSWER) return "no response before deadline";
  return question.mode === "fill"
    ? String(answer).trim()
    : question.choices.find((choice) => choice.key === String(answer).trim().toUpperCase())?.text || String(answer).trim();
}

function answerActionMeaning(question, value, actor = "an operator") {
  if (!question) return "continue the field action";
  if (value === TIMEOUT_ANSWER) return "nobody acts before the emergency cutoff, allowing the active system to time out";
  if (question.mode === "fill") {
    const callout = String(value || "").trim() || "an unclear callout";
    return `${actor} calls out or enters '${callout}' as the missing part, code word, diagnostic value, or field identification`;
  }

  const key = String(value || "").trim().toUpperCase();
  const choiceText = question.choices.find((choice) => choice.key === key)?.text || String(value || "").trim();
  if (question.type === "true-false" || isTrueFalseChoiceSet(question.choices)) {
    const affirmative = normalize(choiceText) === "true" || key === "A";
    const claim = question.trueFalseClaim || question.sourceAnswerText || question.question.replace(/^true\s+or\s+false\s*:\s*/i, "");
    return affirmative
      ? `${actor} confirms the field diagnosis that '${claim}' is valid and commits the system path based on that assumption`
      : `${actor} rejects the field diagnosis that '${claim}' is valid and commits the alternate path based on that assumption`;
  }

  return procedureActionMeaning(question.question, choiceText, actor);
}

function procedureActionMeaning(questionText, choiceText, actor = "an operator") {
  const concept = String(questionText || "");
  const choice = String(choiceText || "").trim() || "the chosen procedure";
  const lower = choice.toLowerCase();

  if (/heat sink|transistor|temperature|thermal/i.test(concept) || /heat|temperature|thermal/i.test(choice)) {
    if (/dissipat|lower|cool|heat/i.test(lower)) return `${actor} clamps the heat-control path into place and bleeds heat away from the failing package`;
    if (/gain/i.test(lower)) return `${actor} drives the gain stage harder, treating the thermal fault like a signal-strength problem`;
    if (/dc|current/i.test(lower)) return `${actor} opens a current path through the hot board, mistaking heat buildup for a supply-route fault`;
    if (/regulat/i.test(lower)) return `${actor} engages voltage regulation, treating the overheating package like an output-stability fault`;
  }
  if (/capacitor|capacitance|charge|store/i.test(concept) || /capacitor|charge|store/i.test(choice)) {
    if (/store|charge|capacitor/i.test(lower)) return `${actor} treats the assembly as stored electrical energy and isolates it before discharge`;
    return `${actor} treats the charge-storage fault as '${choice}' and commits that field procedure`;
  }
  if (/diode|anode|cathode|terminal|polarity/i.test(concept)) return `${actor} clips the diagnostic lead to the contact represented by '${choice}' and energizes the polarity check`;
  if (/battery|ups|cell|recharge/i.test(concept)) return `${actor} routes the emergency bus through the backup-power procedure represented by '${choice}'`;
  if (/inverter|rectifier|ac|dc/i.test(concept)) return `${actor} configures the converter rack according to the '${choice}' procedure`;
  if (/network|packet|ethernet|ip|switch|router/i.test(concept)) return `${actor} patches the uplink through the network path represented by '${choice}'`;
  if (/radar|antenna|rf|frequency|signal/i.test(concept)) return `${actor} tunes the damaged array according to the '${choice}' diagnostic call`;
  if (/ground|fuse|surge|current|breaker/i.test(concept)) return `${actor} arms the protection bus around the '${choice}' fault call`;
  if (/meter|oscilloscope|instrument|waveform/i.test(concept)) return `${actor} configures the diagnostic bench for the '${choice}' reading`;
  return `${actor} commits the field procedure represented by '${choice}'`;
}

function localAnswerActionFacts(context, answer) {
  if (answer === TIMEOUT_ANSWER) return "Nobody acts before the emergency cutoff. The active system times out and triggers the listed consequence.";
  const question = context.question;
  const selected = localAnswerSelection(context, answer);
  const actor = context.operator?.name || context.type.emergencyAnswerPlayer?.name || (context.type.kind === "team" ? "the squad" : "the responding operators");
  return [
    `Actor: ${actor}.`,
    `Private selected value means: ${answerActionMeaning(question, answer, actor)}.`,
    `Equipment task: ${question.question}.`,
    `Legacy selected concept text, private only: ${selected}.`
  ].join(" ");
}

function localDeviceTeamActionFacts(context, entries) {
  const details = entries.map((entry) => {
    const action = answerActionMeaning(context.question, entry.answer, entry.player.name);
    return `${entry.player.name}: ${entry.correct ? "aligned action" : "misaligned action"}; private action meaning: ${action}`;
  }).join("; ");
  const node = state.nodes[state.currentNode];
  const combatRoom = node?.type === "combat" || node?.type === "boss";
  const encounter = combatRoom ? currentCombatEncounter() : null;
  const enemyCount = encounter?.enemies.filter((enemy) => !enemy.defeated).length || 0;
  const guidance = combatRoom
    ? `This is a combat room with ${enemyCount} visible hostile${enemyCount === 1 ? "" : "s"}. Describe attacks, target selection, bracing, cover, class abilities, and the hostile counterattack; do not narrate this as a generic obstacle or workstation task. Vary the enemy behavior and match the number of attackers to the room.`
    : "This is an obstacle room with no active enemy group. Describe the physical obstacle, machinery, wiring, valves, doors, panels, environmental hazard, or route problem being solved; do not invent combatants or enemy attacks unless the room is explicitly marked combat.";
  if (context.type.kind === "team") return `Team threshold challenge: at least half the active operators must perform aligned field actions for the group action to hold. Player outcomes: ${details}. Equipment task: ${context.question.question}. ${guidance}`;
  if (context.type.kind === "truefalse") return `Binary field-decision pressure check: if the group fails the factual field decision, a partial-team hazard triggers. Player outcomes: ${details}. Equipment task: ${context.question.question}. ${guidance}`;
  return `Individual challenge: each operator's attempt is judged separately; wrong individual attempts trigger individual hazards. Player outcomes: ${details}. Equipment task: ${context.question.question}. ${guidance}`;
}

function compactThreatProfileText() {
  const profile = state.threatProfile;
  if (!profile) return state.threat || "unknown persistent threat";
  const generated = profile.generated || {};
  const identity = profile.identity || profile.archetype || state.threat || "unknown threat";
  const description = profile.description || profile.summary || "";
  const appearance = profile.appearance || "";
  const manifestation = generated.manifestation || profile.nature || "";
  const behavior = profile.behavior || "";
  const tactics = generated.tactics || profile.tactics || "";
  const signs = generated.signs || profile.signs || "";
  const weakness = generated.weakness || profile.weakness || "";
  return [
    `Identity noun: ${identity}`,
    description ? `Description: ${description}` : "",
    appearance ? `Appearance: ${appearance}` : "",
    manifestation ? `Manifestation: ${manifestation}` : "",
    behavior ? `Behavior: ${behavior}` : "",
    tactics ? `Tactics: ${tactics}` : "",
    signs ? `Signs: ${signs}` : "",
    weakness ? `Containment: ${weakness}` : "",
    "Use the identity noun as the enemy subject; use description, behavior, signs, and tactics only as supporting detail. Do not transform the identity into a different enemy type."
  ].filter(Boolean).join(" | ");
}

function compactTeamStatusText(playerEvents = []) {
  const affected = new Set(playerEvents.map((event) => normalize(event.name)));
  const notable = state.players.filter((player) => affected.has(normalize(player.name)) || player.incapacitated || player.status.length || playerLowHealth(player));
  const players = notable.length ? notable : state.players;
  return players
    .map((player) => `${player.name}: ${Math.max(0, player.hp)} HP${player.status.length ? `, ${player.status.join(", ")}` : ""}${player.incapacitated ? ", incapacitated" : ""}`)
    .join("; ");
}

function compactPronounGuide(playerEvents = [], context = {}) {
  const names = new Set(playerEvents.map((event) => normalize(event.name)));
  if (context.operator?.name) names.add(normalize(context.operator.name));
  if (context.type?.emergencyAnswerPlayer?.name) names.add(normalize(context.type.emergencyAnswerPlayer.name));
  const guide = state.players
    .filter((player) => names.has(normalize(player.name)))
    .map((player) => `${player.name}: ${playerPronouns(player.name)}`);
  return guide.join("; ") || "Use player names instead of guessing pronouns.";
}

function compactTurnHistoryText() {
  if (!state.turnHistory.length) return "No resolved turns yet.";
  return state.turnHistory.slice(-2).join(" ");
}

function compactThreatBeatInstruction(nextInfo) {
  if (nextInfo.isRecovery) return `Keep ${state.threat} close enough to make recovery feel temporary.`;
  if (nextInfo.readyCheck) return `Stage ${state.threat} at the threshold without starting the confrontation.`;
  if (nextInfo.type?.boss && nextInfo.type.bossPhase === "final") return `Make ${state.threat} the direct final pressure.`;
  if (nextInfo.type?.boss) return `Make ${state.threat} visibly or audibly press the scene.`;
  return "Use only a subtle threat detail if it fits naturally.";
}

function compactActionTranslationText(context, actionFacts) {
  return [
    `Study task, private: ${context.question.question}`,
    `Required concept, private: ${answerKnowledgeText(context.question)}`,
    `Player action facts, private: ${actionFacts}`
  ].join("\n");
}

function localAnswerFallbackAction(context, answer) {
  if (answer === TIMEOUT_ANSWER) return "The warning tone climbs to its final pitch before anyone reaches the controls.";
  const question = context.question;
  const selected = localAnswerSelection(context, answer);
  const actor = context.operator?.name || context.type.emergencyAnswerPlayer?.name || (context.type.kind === "team" ? "The squad" : "The responding operators");
  const concept = question.question;

  if (/diode|electrode|terminal|positive side/i.test(concept)) return `${actor} clips the diagnostic lead to the ${selected} contact and energizes the test rail.`;
  if (/battery|ups|recharged/i.test(concept)) return `${actor} routes the emergency bus through the ${selected} assembly and closes the backup relay.`;
  if (/network|traffic|packets|ethernet|connector/i.test(concept)) return `${actor} patches the uplink through the ${selected} path and commits the route.`;
  if (/radar|antenna|rf|frequency/i.test(concept)) return `${actor} tunes the damaged array for ${selected} and pushes the calibration live.`;
  if (/ground|fuse|surge|overvoltage|excess current/i.test(concept)) return `${actor} arms the protection circuit around ${selected} and resets the fault bus.`;
  if (/meter|instrument|oscilloscope|unit/i.test(concept)) return `${actor} configures the test bench for ${selected} and starts the diagnostic sweep.`;
  return `${actor} seats the ${selected} module in the damaged control rack and commits the repair.`;
}

function localDeviceTeamFallbackAction(context, entries) {
  const stable = entries.filter((entry) => entry.correct).map((entry) => entry.player.name);
  const unstable = entries.filter((entry) => !entry.correct).map((entry) => entry.player.name);
  const device = conceptDeviceName(context.question.question);
  const stableText = stable.length
    ? `${stable.join(", ")} stabilize the ${device} with clean, practiced movements`
    : `No one gets a clean grip on the ${device}`;
  const unstableText = unstable.length
    ? `while ${unstable.join(", ")} mistime the repair and expose themselves to the backlash`
    : "and the group repair holds without a dangerous backlash";
  return `${stableText} ${unstableText}.`;
}

function conceptDeviceName(questionText) {
  const text = String(questionText || "");
  if (/diode|anode|cathode|terminal|polarity/i.test(text)) return "polarity frame";
  if (/battery|ups|cell|recharge/i.test(text)) return "backup power bank";
  if (/inverter|rectifier|ac|dc/i.test(text)) return "converter rack";
  if (/network|packet|ethernet|ip|switch|router/i.test(text)) return "network relay";
  if (/radar|antenna|rf|frequency|signal/i.test(text)) return "signal array";
  if (/ground|fuse|surge|current|breaker/i.test(text)) return "protection bus";
  if (/meter|oscilloscope|instrument|waveform/i.test(text)) return "diagnostic bench";
  if (/valve|hydraulic|pressure|steam/i.test(text)) return "pressure manifold";
  return "damaged field assembly";
}

function makeLocalResolutionPrompt({ correct, context, result, currentArea, nextInfo, statusLog, playerEvents = [], actionFacts }) {
  const affected = playerEvents.length
    ? playerEvents.map((event) => `${event.name}: ${event.note}${event.status.length ? `, ${event.status.join(", ")}` : ""}${event.cause ? `. Cause: ${event.cause}` : ""}`).join("; ")
    : "none";
  const bossRule = context.type.boss
    ? bossPhasePromptLines({
        node: state.nodes[state.currentNode],
        type: context.type,
        step: context.type.bossStep || 1,
        total: context.type.bossTotal || 1,
        finalStep: Boolean(context.type.bossFinalStep),
        phase: context.type.bossPhase || "mid"
      }).join("\n")
    : "";
  const finalBossRule = context.type.boss && context.type.bossPhase === "final" || nextInfo.type?.boss && nextInfo.type.bossPhase === "final"
    ? `Final confrontation: the squad is directly fighting, blocking, containing, outrunning, or defending against ${state.threat}; do not narrate it as ordinary repair work.`
    : "";
  const transitionRule = nextInfo.sameBossRoom
    ? `transition: 1-2 sentences; stay in ${currentArea} and shift the same fight into the next exchange without changing rooms.`
    : "transition: 1-2 sentences; physically move the team toward the next area without adding a new hazard.";
  const arrivalRule = nextInfo.readyCheck
    ? `arrival: ${narrationSentenceRange("2-4", "2-3")} sentences; stage the threshold before a major confrontation and end needing readiness confirmation.`
    : nextInfo.isRecovery && nextInfo.afterBoss
    ? `arrival: ${narrationSentenceRange("3-4", "2-3")} sentences; show aftermath, a forced recovery window, and the next route. Keep it earned and temporary.`
    : nextInfo.isRecovery
    ? `arrival: ${narrationSentenceRange("2-4", "2-3")} sentences; stage a dangerous temporary recovery window, then point toward the route.`
    : nextInfo.type?.boss
    ? `arrival: ${narrationSentenceRange("2-4", "2-3")} sentences; introduce or escalate the hostile manifestation and battlefield.`
    : `arrival: ${narrationSentenceRange("2-4", "2-3")} sentences; stage the next area and the specific obstacle blocking it. Avoid making every obstacle a terminal.`;
  return [
    "Fast survival-study DM. Return one JSON object only, no markdown, no commentary.",
    "Use exactly these string fields: impact, transition, arrival.",
    "Narration must be player-facing survival fiction, not quiz/interface text.",
    "Never say: answer, question, option, choice, selected, submitted, correct, incorrect, quiz, multiple-choice, HP, hit points, dice, odds, hidden rules.",
    "Translate private study values into physical field actions, procedures, repairs, diagnostics, calls, combat moves, or survival decisions.",
    `impact: ${narrationSentenceRange("2-4", "2-3")} sentences; show the performed action, reveal the required concept naturally, show success/failure consequence, and close the current obstacle.`,
    transitionRule,
    arrivalRule,
    bossRule,
    finalBossRule,
    actionFacts.includes("Nobody acts before the emergency cutoff")
      ? "Emergency timeout: nobody acted; describe the system timing out and causing the listed hazard."
      : "",
    "Close current obstacle: success disables/bypasses/drives it back; failure makes it retaliate/worsen before route changes.",
    "Stage next obstacle, but do not resolve it or include the next study prompt.",
    "Do not expose classroom wording in arrival. Never write that the squad must identify, determine, answer, name, choose, or verify the study concept.",
    "Use only provided player names; if no player is named in the facts, say the squad or the team.",
    "Only affected players may be newly harmed. Unaffected players may react or help but cannot suffer new injuries.",
    "Use persistent statuses only if listed in affected players or team status.",
    "If Bleeding worsens from an existing wound, say the prior wound reopens or drains them, not that a new bleeding wound appears.",
    playerEvents.length
      ? "Show the exact hazard moment that hurt the listed affected players; use any listed cause."
      : "No player was newly hurt; do not injure anyone.",
    `Current area: ${currentArea}.`,
    `Mission style: ${state.missionType}.`,
    `Environment: ${state.environment}.`,
    `Challenge type: ${context.type.label}.`,
    `Current obstacle to close: ${context.activeObstacle || "none"}.`,
    compactActionTranslationText(context, actionFacts),
    `Outcome: ${correct ? "the action works" : "the action is wrong and triggers the listed consequence"}.`,
    `Consequence: ${result.factSeed || "No additional consequence."}`,
    result.lootFact ? `Loot facts: ${result.lootFact}` : "Loot facts: none.",
    `Affected players: ${affected}.`,
    `Pronoun guide: ${compactPronounGuide(playerEvents, context)}.`,
    `Team status after consequence: ${compactTeamStatusText(playerEvents)}.`,
    statusLog ? `Status changes: ${statusLog}` : "Status changes: none.",
    `Recent continuity: ${compactTurnHistoryText()}.`,
    `Persistent threat: ${state.threat}; ${compactThreatProfileText()}.`,
    `Threat beat: ${compactThreatBeatInstruction(nextInfo)}`,
    `Next area: ${nextInfo.areaName}.`,
    nextObstacleDangerFrame(nextInfo),
    nextInfo.type?.locked && nextInfo.operator
      ? `Locked operator setup: create a room-specific reason only ${nextInfo.operator.name} can respond.`
      : "Locked-operator arrival requirement: none.",
    nextInfo.readyCheck ? "Next event: readiness check before the major confrontation." : nextInfo.isRecovery ? "Next event: recovery choice." : nextInfo.question ? "Next event: unresolved field procedure." : "No next question."
  ].filter(Boolean).join("\n");
}

function threatBeatInstruction(nextInfo) {
  if (nextInfo.isRecovery) return `Threat beat requirement: briefly show how ${state.threat} remains close enough to keep the recovery window tense.`;
  if (nextInfo.readyCheck) return `Threat beat requirement: stage ${state.threat} at the threshold without starting the confrontation yet.`;
  if (nextInfo.type?.boss && nextInfo.type.bossPhase === "final") return `Threat beat requirement: make ${state.threat} the direct final pressure. The team must be defending against or combating it, not merely repairing a background system.`;
  if (nextInfo.type?.boss) return `Threat beat requirement: make ${state.threat} visibly or audibly press against the mission during the arrival scene.`;
  const progress = state.questions.length ? (state.currentQuestion + 1) / state.questions.length : 0;
  if ((progress >= 0.32 && progress < 0.38) || (progress >= 0.64 && progress < 0.72)) {
    return `Threat beat requirement: include one brief new sign that ${state.threat} is following the squad.`;
  }
  return "Threat beat requirement: keep the persistent threat implicit unless a subtle background detail fits naturally.";
}

function cleanLocalNarration(text) {
  if (typeof text !== "string") return "";
  return String(text || "")
    .replace(/^["'\s]+|["'\s]+$/g, "")
    .replace(/^\s*(?:#{1,6}\s*)?(?:\*\*)?\s*(?:MISSION\s+LOG|MISSION\s+CHANNEL|OPERATION\s+LOG|FIELD\s+LOG|SITREP|TRANSMISSION)\s*(?:(?:\/\/|:|-|--)\s*)?(?:OPERATION\s+)?[A-Z0-9 '\-]+(?:\*\*)?\s*$/gim, "")
    .replace(/^\s*(Affected players|Pronoun guide|Team status(?: after consequence)?|Status changes|Current area|Next area|Next concept\/question|Consequence seed|Consequence facts|Loot facts|System problem resolved this turn|System task|Study prompt|Required concept|Current active obstacle(?: to close this turn)?|Next active obstacle(?: to stage, not resolve)?|Active obstacle continuity|Active obstacle|Obstacle behavior|Study concept connection, private only|Threat pressure|If the team succeeds|If the team fails|In-world action seed|Action facts|Private study item and action translation context|Private action translation map|Private procedure map|Private submitted value|Submitted action meaning|Required action meaning|Player action translations|Required knowledge to reveal naturally|Outcome|Outcome facts|Player action|Primary actor|Grounded action category|Action modifiers|Rare bypass transition requirement|Next-area staging facts|Locked-operator arrival requirement|Persistent threat|Threat archetype|Threat summary|Threat nature|Recurring signs|Threat tactics|Escalation pattern|Confrontation form|How the squad can plausibly fight or contain it|Generated manifestation|Generated recurring signs|Generated tactics|Generated escalation pattern|Generated confrontation form|Generated containment weakness|Continuity rule|Threat beat requirement)\s*:.*$/gim, "")
    .replace(/(?:^|(?<=[.!?])\s+)[^.?!]*(?:complete clean in-world actions|listed hazard|should be invented from the current room|generic control-post synchronization)[^.?!]*[.!?]\s*/gi, "")
    .replace(/\bboss room\b/gi, "breach chamber")
    .replace(/\bboss phase\b/gi, "critical surge")
    .replace(/\bboss encounter\b/gi, "major confrontation")
    .replace(/\bboss\b/gi, "hostile force")
    .replace(/\bphase\s+(\d+)\b/gi, "surge $1")
    .replace(/\b(Question|Choices|Answer)\s*:.*/gis, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parseLocalNarrationBlocks(text, playerEvents, fallbackBlocks, nextInfo) {
  const parsed = parseLocalNarrationJson(text);
  return {
    impact: safeLocalNarrationBlock(parsed.impact, playerEvents, fallbackBlocks.impact, nextInfo),
    transition: safeLocalNarrationBlock(parsed.transition, playerEvents, fallbackBlocks.transition, nextInfo),
    arrival: safeLocalNarrationBlock(parsed.arrival, [], fallbackBlocks.arrival, nextInfo)
  };
}

function ensureGeneratedHazardImpact(blocks, details) {
  if (!details.playerEvents?.length) return Promise.resolve(blocks);
  if (blocks.impact !== details.fallbackBlocks.impact) return Promise.resolve(blocks);

  return requestOllama(makeHazardImpactPrompt(details), { temperature: 0.88 })
    .then((text) => {
      const impact = safeLocalNarration(cleanLocalNarration(text), details.playerEvents, "");
      return impact ? { ...blocks, impact } : blocks;
    })
    .catch(() => blocks);
}

function makeHazardImpactPrompt({ correct, context, result, currentArea, playerEvents, actionFacts, statusLog }) {
  const affected = playerEvents
    .map((event) => `${event.name}: ${event.note}${event.status.length ? `, ${event.status.join(", ")}` : ""}${event.cause ? `. Cause: ${event.cause}` : ""}`)
    .join("; ");
  return [
    `Write only one player-facing impact scene, ${narrationSentenceRange("3-5", "2-3")} complete sentences.`,
    "Translate private study values into physical field action; never mention quiz/interface mechanics.",
    "Use only the listed hazard and affected-player facts. Do not add injuries, statuses, supplies, rescues, or advantages.",
    "No HP, hit points, question, answer, correct, incorrect, option, choice, quiz, or multiple-choice.",
    "Show how the current obstacle causes, absorbs, collapses, retaliates, or is disrupted by the impact.",
    "Only affected players may be newly harmed. Existing Bleeding means an old wound worsens, not a new wound.",
    `Current area: ${currentArea}.`,
    `Mission style: ${state.missionType}.`,
    `Environment: ${state.environment}.`,
    `Challenge type: ${context.type.label}.`,
    `Current active obstacle: ${context.activeObstacle || "none"}.`,
    compactActionTranslationText(context, actionFacts),
    `Outcome: ${correct ? "the action works but the listed incidental hazard still happens" : "the action fails and triggers the listed hazard"}.`,
    `Consequence facts: ${result.factSeed || result.narration}.`,
    `Affected players: ${affected}.`,
    statusLog ? `Status changes: ${statusLog}.` : "Status changes: none.",
    `Team status after consequence: ${compactTeamStatusText(playerEvents)}.`,
    `Threat: ${state.threat}; ${compactThreatProfileText()}.`
  ].join("\n");
}

function parseLocalNarrationJson(text) {
  const raw = String(text || "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return {};
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function safeLocalNarrationBlock(text, playerEvents, fallback, nextInfo) {
  const cleaned = cleanLocalNarration(text);
  if (!cleaned) return fallback;
  return safeLocalNarration(cleaned, playerEvents, fallback, nextInfo);
}

function assembleLocalNarration(blocks) {
  return [blocks.impact, blocks.transition, blocks.arrival].filter(Boolean).join("\n\n");
}

function assembleLocalContinuation(blocks) {
  return [blocks.transition, blocks.arrival].filter(Boolean).join("\n\n");
}

function playerPronouns(name) {
  const pronouns = {
    lee: "he/him"
  };
  return pronouns[normalize(name)] || "they/them";
}

function localTurnHistoryText() {
  if (!state.turnHistory.length) return "No prior resolved turn. Continue directly from the mission briefing.";
  return state.turnHistory.slice(-3).join(" ");
}

function recordLocalTurnFact({ correct, context, currentArea, nextInfo, playerEvents }) {
  const affected = playerEvents.length
    ? playerEvents.map((event) => `${event.name}: ${event.note}${event.status.length ? `, ${event.status.join(", ")}` : ""}`).join("; ")
    : "no player changes";
  state.turnHistory.push(
    `[${currentArea}] ${correct ? "Route action succeeded" : "Route action failed"}; active obstacle handled: ${context.activeObstacle || "none"}; required correction: ${answerKnowledgeText(context.question)}; affected: ${affected}; next unresolved area: ${nextInfo.areaName}; next active obstacle: ${nextInfo.activeObstacle || "none"}.`
  );
  state.turnHistory = state.turnHistory.slice(-3);
}

function safeLocalNarration(text, playerEvents, fallbackStory, nextInfo = {}) {
  const cleaned = cleanLocalNarration(text);
  if (!cleaned) return fallbackStory;
  return cleaned;
}

function looksIncompleteNarration(text) {
  const cleaned = String(text || "").trim();
  if (!cleaned) return true;
  if (!/[.!?]"?$/.test(cleaned)) return true;
  const lastSentence = cleaned.split(/(?<=[.!?])\s+/).filter(Boolean).pop() || "";
  return /\b(?:a|an|the|of|to|for|from|with|into|onto|through|under|over|and|or|but|as|while|because|that|where|when|like)\.?$/i.test(lastSentence)
    || /[:,;]\s*$/.test(lastSentence);
}

function narrationInventsPlayerStatus(text) {
  const statuses = [
    { name: "Burned", pattern: /\b(?:burned|burning|blistered)\b/i },
    { name: "Bleeding", pattern: /\b(?:bleeding|bleeds|bloodied)\b/i },
    { name: "Shocked", pattern: /\b(?:shocked|twitching|muscle spasms?)\b/i },
    { name: "Concussed", pattern: /\b(?:concussed|concussion|ringing ears|blurred vision)\b/i }
  ];
  const sentences = String(text).split(/(?<=[.!?])\s+/);
  for (const player of state.players) {
    const playerName = new RegExp(`\\b${escapeRegExp(player.name)}\\b`, "i");
    for (const sentence of sentences) {
      if (!playerName.test(sentence)) continue;
      for (const status of statuses) {
        if (status.pattern.test(sentence) && !player.status.includes(status.name)) return true;
      }
    }
  }
  return false;
}

function prematurelyResolvesNextChallenge(text, nextInfo) {
  const answer = answerKnowledgeText(nextInfo.question).split(";")[0];
  if (!answer) return false;
  const answerPattern = new RegExp(`\\b${escapeRegExp(answer)}\\b`, "i");
  const actionPattern = /\b(answer|correct|identif|spots?|choos|select|shouts?|calls?\s+out|reactivat|activat|operat|fix|repair|keys?\s+in|enters?|types?|throws?\s+the\s+switch)\b/i;
  return String(text)
    .split(/(?<=[.!?])\s+/)
    .some((sentence) => answerPattern.test(sentence) && actionPattern.test(sentence));
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function setAnswerPendingText(text) {
  const status = document.getElementById("answerSubmitState");
  if (status) status.textContent = text;
}

function renderPlayerDmControls() {
  const container = document.getElementById("playerDmControls");
  if (!container) return;
  container.innerHTML = state.players.map((player, index) => `
    <div class="player-dm-card">
      <strong>${escapeHtml(player.name)}</strong>
      <button class="hpBtn secondary" data-player="${index}" data-delta="-1" type="button">HP -</button>
      <button class="hpBtn secondary" data-player="${index}" data-delta="1" type="button">HP +</button>
      <select class="statusSelect" data-player="${index}" aria-label="${escapeHtml(player.name)} status">
        <option value="">Add status</option>
        <option>Burned</option>
        <option>Bleeding</option>
        <option>Shocked</option>
        <option>Concussed</option>
      </select>
      <button class="clearStatusBtn secondary" data-player="${index}" type="button">Clear</button>
    </div>
  `).join("");

  container.querySelectorAll(".hpBtn").forEach((button) => {
    button.addEventListener("click", () => adjustPlayerHp(Number(button.dataset.player), Number(button.dataset.delta)));
  });
  container.querySelectorAll(".statusSelect").forEach((select) => {
    select.addEventListener("change", () => addPlayerStatus(Number(select.dataset.player), select.value));
  });
  container.querySelectorAll(".clearStatusBtn").forEach((button) => {
    button.addEventListener("click", () => clearPlayerStatus(Number(button.dataset.player)));
  });
}

function broadcastDmText() {
  const input = document.getElementById("dmBroadcastText");
  const text = input.value.trim();
  if (!text) return;
  appendTranscript({ text });
  input.value = "";
}

function testOllama() {
  const result = document.getElementById("ollamaResult");
  const prompt = "Write one tense sentence as a survival-horror study-adventure dungeon master. No extra commentary.";
  if (result) result.textContent = `Testing ${localDmProviderLabel()}...`;
  requestOllama(prompt).then((text) => {
    setOllamaResult(text || `${localDmProviderLabel()} returned an empty response.`);
  }).catch((error) => {
    setOllamaResult(`${localDmProviderLabel()} error: ${error.message}`, true);
  });
}

function generateOllamaDmText() {
  const input = document.getElementById("ollamaPrompt");
  const promptText = input?.value.trim();
  const prompt = promptText || makeOllamaPrompt();
  setOllamaResult("Generating local DM text...");
  requestOllama(prompt).then((text) => {
    setOllamaResult(text || `${localDmProviderLabel()} returned an empty response.`);
  }).catch((error) => {
    setOllamaResult(`${localDmProviderLabel()} error: ${error.message}`, true);
  });
}

function broadcastOllamaResult() {
  const result = document.getElementById("ollamaResult");
  const text = result?.dataset.generated || "";
  if (!text) return;
  appendTranscript({ text });
}

function requestOllama(prompt, options = {}) {
  const runRequest = () => requestOllamaNow(prompt, options);
  const queued = state.localDmQueue.then(runRequest, runRequest);
  state.localDmQueue = queued.catch(() => {});
  return queued;
}

function requestOllamaNow(prompt, options = {}) {
  const provider = selectedLocalDmProvider();
  const endpoint = localDmGenerateEndpoint(provider);
  const requestId = ++state.localRequestCounter;
  const model = state.ollamaModel || els.ollamaModel.value || defaultLocalDmModel(provider);
  const startedAt = Date.now();
  const transitionStep = roomTransitionTraceStepStart(`local DM request #${requestId}`, {
    provider,
    model,
    promptChars: prompt.length
  });
  logDebugEvent({
    kind: "request",
    label: `#${requestId} sent`,
    detail: `${localDmProviderLabel(provider)} / ${model} / no token cap / ${prompt.length} chars / ~${Math.ceil(prompt.length / 4)} input tokens`
  });
  return sendLocalDmRequest({ endpoint, provider, model, prompt, options, requestId, startedAt })
    .catch((error) => {
      const fallbackModel = defaultLocalDmModel(provider);
      const reasoningLeak = /reasoning-only|visible reasoning/i.test(error.message || "");
      if (
        provider === "lmstudio"
        && reasoningLeak
        && model !== fallbackModel
      ) {
        state.ollamaModel = fallbackModel;
        if (els.ollamaModel && [...els.ollamaModel.options].some((option) => option.value === fallbackModel)) {
          els.ollamaModel.value = fallbackModel;
        }
        window.localStorage.setItem(localDmModelStorageKey(provider), fallbackModel);
        logDebugEvent({
          kind: "request",
          label: `#${requestId} retry`,
          detail: `Model reasoning output blocked. Retrying with ${fallbackModel}.`
        });
        return sendLocalDmRequest({ endpoint, provider, model: fallbackModel, prompt: finalOnlyPrompt(prompt), options, requestId, startedAt });
      }
      if (provider === "lmstudio" && reasoningLeak && !options.strictRetry) {
        logDebugEvent({
          kind: "request",
          label: `#${requestId} strict retry`,
          detail: `Visible reasoning blocked. Retrying with a stricter final-output prompt.`
        });
        return sendLocalDmRequest({
          endpoint,
          provider,
          model,
          prompt: finalOnlyPrompt(prompt),
          options: { ...options, strictRetry: true, temperature: Math.min(Number(options.temperature) || 0.75, 0.45) },
          requestId,
          startedAt
        });
      }
      throw error;
    })
    .finally(() => roomTransitionTraceStepEnd(transitionStep, { requestId, provider, model }));
}

function finalOnlyPrompt(prompt) {
  return [
    "FINAL OUTPUT ONLY.",
    "Begin immediately with the in-world, player-facing narration.",
    "Do not mention the user, the request, constraints, checklist, confidence, analysis, reasoning, instructions, or hidden process.",
    "If you cannot comply, output one concise in-world sentence instead.",
    "",
    prompt
  ].join("\n");
}

function sendLocalDmRequest({ endpoint, provider, model, prompt, options, requestId, startedAt }) {
  return fetchWithTimeout(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      prompt,
      temperature: options.temperature || 0.75,
      format: options.format || undefined,
      think: options.think ?? false
    })
  }, LOCAL_DM_REQUEST_TIMEOUT_MS)
    .then((response) => response.json().then((body) => ({ response, body })))
    .then(({ response, body }) => {
      if (!response.ok || !body.ok) {
        logDebugEvent({
          kind: "error",
          label: `#${requestId} failed`,
          detail: `${Date.now() - startedAt}ms | ${body.error || "Local generation failed"}`
        });
        throw new Error(body.error || "Local generation failed");
      }
      const text = body.response.trim();
      logDebugEvent({
        kind: "response",
        label: `#${requestId} received`,
        detail: `${Date.now() - startedAt}ms total | server ${body.serverDurationMs || "?"}ms | ${model} | ${text.length} chars`
      });
      return text;
    });
}

function logDebugEvent(event) {
  const entry = {
    id: `debug-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    at: new Date(),
    ...event
  };
  state.debugEvents.unshift(entry);
  state.debugEvents = state.debugEvents.slice(0, 80);
  renderDebugConsole();
}

function roomTransitionTraceSnapshot() {
  const node = state.nodes?.[state.currentNode] || null;
  const memory = performance?.memory;
  return {
    nodeIndex: state.currentNode,
    nodeType: node?.type || "",
    nodeLabel: node?.label || "",
    questionIndex: state.currentQuestion,
    resolved: Boolean(state.resolved),
    answerPending: Boolean(state.answerPending),
    resolutionDelayPending: Boolean(state.resolutionDelayPending),
    transmissionPending: Boolean(state.transmissionPending),
    routeFrom: state.routeTransition?.from ?? null,
    routeTo: state.routeTransition?.to ?? null,
    routeMoving: Boolean(state.routeTransition?.moving),
    logPresentationPending: Boolean(state.logPresentationPending),
    logPresentationRunId: state.logPresentationRunId,
    questionSurfaceVisible: Boolean(state.questionSurfaceVisible),
    questionPresentationReady: Boolean(state.questionPresentationReady),
    questionRevealRunId: state.questionRevealRunId,
    combatMountBlocked: Boolean(state.combatMountBlocked),
    combatRunId: state.combatPresentationRunId,
    combatHidden: Boolean(els.combatStage?.hidden),
    combatClasses: els.combatStage?.className || "",
    mapClasses: els.mapPanel?.className || "",
    bodyClasses: document.body?.className || "",
    typeTimers: state.typeTimers?.length || 0,
    combatTimers: state.combatPresentationTimers?.length || 0,
    playerSyncInFlight: Boolean(state.playerSyncInFlight),
    visibility: document.visibilityState,
    heapMb: memory?.usedJSHeapSize ? Math.round(memory.usedJSHeapSize / 1048576) : null
  };
}

function postRoomTransitionTrace(payload) {
  fetch("/api/debug/client-trace", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    keepalive: true
  }).catch(() => {});
}

function roomTransitionTraceEmit(marker, phase, details = {}, options = {}) {
  const trace = state.roomTransitionTrace;
  if (!trace) return;
  const now = performance.now();
  const payload = {
    traceId: trace.id,
    marker,
    phase,
    elapsedMs: Math.round(now - trace.startedAt),
    phaseMs: Math.max(0, Math.round(Number(options.phaseMs) || 0)),
    details,
    snapshot: roomTransitionTraceSnapshot()
  };
  postRoomTransitionTrace(payload);
  if (options.debugConsole) {
    logDebugEvent({
      kind: marker === "TIMEOUT" || marker === "MAIN_THREAD_GAP" || marker === "ERROR" ? "error" : "state",
      label: `Transition ${trace.id} ${marker}`,
      detail: `${phase} | ${payload.elapsedMs}ms${payload.phaseMs ? ` | phase ${payload.phaseMs}ms` : ""}`
    });
  }
}

function roomTransitionTraceStart(reason, details = {}) {
  if (state.roomTransitionTrace) roomTransitionTraceFinish("superseded", { nextReason: reason });
  const now = performance.now();
  const id = `rt-${Date.now().toString(36)}-${++state.roomTransitionTraceCounter}`;
  const trace = {
    id,
    reason,
    startedAt: now,
    expectedHeartbeatAt: now + ROOM_TRANSITION_TRACE_HEARTBEAT_MS,
    heartbeatTimer: null,
    timeoutTimer: null,
    metrics: new Map()
  };
  state.roomTransitionTrace = trace;
  roomTransitionTraceEmit("START", reason, details, { debugConsole: true });
  trace.heartbeatTimer = window.setInterval(() => {
    if (state.roomTransitionTrace !== trace) return;
    const heartbeatAt = performance.now();
    const gapMs = Math.max(0, heartbeatAt - trace.expectedHeartbeatAt);
    trace.expectedHeartbeatAt = heartbeatAt + ROOM_TRANSITION_TRACE_HEARTBEAT_MS;
    if (gapMs >= ROOM_TRANSITION_MAIN_THREAD_GAP_MS) {
      roomTransitionTraceEmit("MAIN_THREAD_GAP", "event-loop heartbeat delayed", { gapMs: Math.round(gapMs) }, { debugConsole: true });
    } else {
      roomTransitionTraceEmit("HEARTBEAT", "transition active", { gapMs: Math.round(gapMs) });
    }
  }, ROOM_TRANSITION_TRACE_HEARTBEAT_MS);
  trace.timeoutTimer = window.setTimeout(() => {
    if (state.roomTransitionTrace !== trace) return;
    roomTransitionTraceEmit("TIMEOUT", "transition exceeded watchdog", {
      timeoutMs: ROOM_TRANSITION_TRACE_TIMEOUT_MS,
      metrics: roomTransitionTraceMetricSummary(trace)
    }, { debugConsole: true });
  }, ROOM_TRANSITION_TRACE_TIMEOUT_MS);
  return trace.id;
}

function roomTransitionTraceStepStart(phase, details = {}) {
  const trace = state.roomTransitionTrace;
  if (!trace) return null;
  const token = { trace, phase, startedAt: performance.now(), finished: false };
  roomTransitionTraceEmit("STEP_START", phase, details);
  return token;
}

function roomTransitionTraceStepEnd(token, details = {}, marker = "STEP_END") {
  if (!token || token.finished) return 0;
  token.finished = true;
  const durationMs = Math.max(0, performance.now() - token.startedAt);
  roomTransitionTraceRecordDuration(token.phase, durationMs);
  if (state.roomTransitionTrace === token.trace) {
    roomTransitionTraceEmit(marker, token.phase, details, { phaseMs: durationMs });
  }
  return durationMs;
}

function roomTransitionTraceRecordDuration(phase, durationMs) {
  const trace = state.roomTransitionTrace;
  if (!trace) return;
  const current = trace.metrics.get(phase) || { count: 0, totalMs: 0, maxMs: 0 };
  current.count += 1;
  current.totalMs += Math.max(0, durationMs);
  current.maxMs = Math.max(current.maxMs, Math.max(0, durationMs));
  trace.metrics.set(phase, current);
}

function roomTransitionTraceMetricSummary(trace = state.roomTransitionTrace) {
  if (!trace?.metrics) return [];
  return [...trace.metrics.entries()]
    .map(([phase, metric]) => ({
      phase,
      count: metric.count,
      totalMs: Math.round(metric.totalMs),
      maxMs: Math.round(metric.maxMs)
    }))
    .sort((a, b) => b.maxMs - a.maxMs)
    .slice(0, 12);
}

function roomTransitionTraceFinish(reason, details = {}) {
  const trace = state.roomTransitionTrace;
  if (!trace) return;
  window.clearInterval(trace.heartbeatTimer);
  window.clearTimeout(trace.timeoutTimer);
  const elapsedMs = Math.round(performance.now() - trace.startedAt);
  roomTransitionTraceEmit("COMPLETE", reason, {
    ...details,
    totalMs: elapsedMs,
    slowest: roomTransitionTraceMetricSummary(trace)
  }, { debugConsole: true });
  state.roomTransitionTrace = null;
}

function logRoomDebug(label, detail, options = {}) {
  const text = typeof detail === "string" ? detail : JSON.stringify(detail, null, 2);
  logDebugEvent({
    kind: "room",
    label,
    detail: trimTextToLength(text, options.maxLength || 1800)
  });
}

function toggleUtilityPanel(panel) {
  state.activeUtilityPanel = state.activeUtilityPanel === panel ? "" : panel;
  state.debugConsoleOpen = state.activeUtilityPanel === "debug";
  renderUtilityPanels();
  renderDebugConsole();
}

function renderUtilityPanels() {
  const active = state.activeUtilityPanel;
  if (els.missionUtilityOverlay) els.missionUtilityOverlay.hidden = !active;
  const pairs = [
    [els.missionControlsToggle, els.missionControlsPanel, "controls"],
    [els.missionLogHistoryToggle, els.missionLogHistoryPanel, "history"],
    [els.debugConsoleToggle, els.debugConsolePanel, "debug"],
    [els.missionAudioToggle, els.missionAudioPanel, "audio"]
  ];
  for (const [button, panel, key] of pairs) {
    const open = active === key;
    if (button) {
      button.classList.toggle("active", open);
      button.setAttribute("aria-expanded", String(open));
    }
    if (panel) panel.hidden = !open;
  }
}

function addMissionLogHistory(payload) {
  if (payload?.skipHistory || payload?.transmissionHistoryOnly) return;
  const entry = {
    at: new Date(),
    tag: payload.tag || payload.questionLabel || payload.areaName || payload.roomName || "Mission Log",
    areaName: payload.areaName || payload.roomName || "",
    story: payload.story || payload.text || "",
    continuationStory: payload.continuationStory || "",
    question: payload.question || "",
    statusLog: payload.statusLog || "",
    players: asArray(payload.players).map((event) => formatStatusEvent(event)).filter(Boolean)
  };
  if (!entry.story && !entry.question && !entry.statusLog && !entry.players.length) return;
  state.missionLogHistory.push(entry);
  state.missionLogHistory = state.missionLogHistory.slice(-200);
  renderMissionLogHistory();
}

function renderMissionLogHistory() {
  if (!els.missionLogHistoryList) return;
  els.missionLogHistoryList.innerHTML = state.missionLogHistory.length
    ? state.missionLogHistory.slice().reverse().map((entry) => `
      <article class="mission-log-history-row">
        <div class="mission-log-history-meta">
          <span>${escapeHtml(entry.at.toLocaleTimeString([], { hour12: false }))}</span>
          <strong>${escapeHtml(formatEncounterTag(entry.tag || "Mission Log"))}</strong>
          ${entry.areaName ? `<em>${escapeHtml(entry.areaName)}</em>` : ""}
        </div>
        ${entry.story ? `<p>${escapeHtml(entry.story)}</p>` : ""}
        ${entry.continuationStory ? `<p><strong>Continuation:</strong> ${escapeHtml(entry.continuationStory)}</p>` : ""}
        ${entry.question ? `<p><strong>Prompt:</strong> ${escapeHtml(entry.question)}</p>` : ""}
        ${entry.statusLog ? `<p><strong>Status:</strong> ${escapeHtml(entry.statusLog)}</p>` : ""}
        ${entry.players.length ? `<p><strong>Operators:</strong> ${escapeHtml(entry.players.join(" | "))}</p>` : ""}
      </article>
    `).join("")
    : "<p>No mission logs yet.</p>";
}

function setOllamaResult(text, isError = false) {
  const result = document.getElementById("ollamaResult");
  const broadcast = document.getElementById("ollamaBroadcastBtn");
  if (!result) return;
  result.textContent = text;
  result.dataset.generated = isError ? "" : text;
  result.classList.toggle("error", isError);
  if (broadcast) broadcast.disabled = isError || !text || /^(Testing|Generating)/.test(text);
}

function makeOllamaPrompt() {
  const activePlayersText = state.players
    .map((player) => `${player.name}: ${Math.max(0, player.hp)} HP${player.status.length ? `, ${player.status.join(", ")}` : ""}${player.incapacitated ? ", incapacitated" : ""}`)
    .join("; ");
  return [
    "FINAL OUTPUT ONLY.",
    "Act as the DM for a fast-paced survival study adventure.",
    "Write only player-facing narration. Do not mention the user, prompt, request, constraints, checklist, confidence score, analysis, reasoning, or instructions.",
    `Write ${narrationSentenceRange("3-5", "2-3")} sentences only.`,
    "Use consequence, transition, and new-room setup rhythm.",
    "Do not reveal mechanics, dice, odds, or hidden rules.",
    `Mission: ${state.title || "Operation (Insert Creative Name Here)"}.`,
    `Current area: ${roomName(state.nodes[state.currentNode] || { type: "challenge" }, state.currentNode)}.`,
    `Team status: ${activePlayersText}.`,
    `Progress: ${state.currentQuestion} / ${state.questions.length}.`,
    "End with tension, but do not invent a multiple-choice question unless asked."
  ].join("\n");
}

function appendTranscript(feed) {
  const transcript = document.getElementById("chatTranscript");
  if (!transcript) return false;

  const payload = typeof feed === "string" ? { text: feed } : feed;
  normalizeFeedText(payload);
  roomTransitionTraceEmit("MARK", "append transcript", {
    tag: payload.tag || "",
    storyChars: String(payload.story || payload.text || "").length,
    questionChars: String(payload.question || "").length,
    continuationChars: String(payload.continuationStory || "").length,
    advanceRoom: Boolean(payload.advanceRoom),
    readyCheck: Boolean(payload.readyCheck),
    recovery: Boolean(payload.isRecovery)
  });
  addMissionLogHistory(payload);
  const pendingRouteMove = Boolean(
    payload.advanceRoom
    && state.routeTransition?.to !== state.routeTransition?.from
  );
  if (pendingRouteMove && !payload.continuationStory) {
    const fromName = roomName(state.nodes[state.routeTransition.from] || { type: "challenge" }, state.routeTransition.from);
    const toName = roomName(state.nodes[state.routeTransition.to] || { type: "challenge" }, state.routeTransition.to);
    payload.continuationStory = `The squad clears ${fromName} and follows the secured route toward ${toName}. The next threshold reacts before the formation can settle.`;
  }
  const hasContinuationGate = Boolean(payload.advanceRoom && payload.continuationStory);
  const deferQuestionUntilContinuation = hasContinuationGate && Boolean(payload.isRecovery);
  const presentationRunId = beginLogPresentation();
  const transitionPresentationStep = roomTransitionTraceStepStart("mission log presentation", {
    presentationRunId,
    tag: payload.tag || ""
  });
  const bossProgressBeforeAdvance = currentBossProgress();
  const keepBossTimer = payload.question
    && state.emergencyTimer?.kind === "boss"
    && bossProgressBeforeAdvance
    && !bossProgressBeforeAdvance.finalStep;
  if (payload.readyCheck) {
    state.bossReadyPending = true;
    applyDashboardAtmosphere();
    publishPlayerSession({ status: "briefing", prompt: null, resetAnswers: true });
  }
  if (payload.question) {
    if (!keepBossTimer) stopEmergencyTimer();
    state.questionSurfaceVisible = false;
    state.questionPresentationReady = false;
    clearPendingPlayerPromptState({ status: "waiting" });
  }
  captureDeferredRouteTransition(payload, hasContinuationGate);
  if (payload.advanceRoom && state.transmissionPending) stopTransmissionFeedback();
  const deferStatusPresentation = payload.deferStatusLog || Boolean(asArray(payload.players).length || asArray(payload.damage).length || payload.statusLog);
  const effects = deferStatusPresentation ? [] : applyFeedState(payload);
  const replaceTranscript = payload.replace !== false;
  if (replaceTranscript) clearTypewriters();

  const entry = document.createElement("section");
  entry.className = "transcript-entry";
  if (payload.speechText) entry.dataset.speechText = payload.speechText;
  const showOpeningVoiceLoader = shouldShowOpeningVoiceLoader(payload);
  if (showOpeningVoiceLoader) entry.classList.add("tts-generation-pending");

  if (payload.tag && !payload.hideLogTag) {
    const tag = document.createElement("div");
    tag.className = "log-tag";
    tag.textContent = missionLogTagText(payload);
    entry.appendChild(tag);
  }

  if (showOpeningVoiceLoader) entry.insertAdjacentHTML("beforeend", voiceGenerationTransmissionHtml());

  if (payload.story) {
    const story = document.createElement("p");
    story.className = "typewriter";
    story.dataset.text = payload.story;
    entry.appendChild(story);
  }

  if (!deferStatusPresentation) appendDamageLog(entry, payload);

  if (payload.question && shouldShowTranscriptQuestion(payload) && !deferQuestionUntilContinuation) {
    const questionWrap = document.createElement("div");
    questionWrap.className = "log-question";
    const label = document.createElement("strong");
    label.textContent = payload.questionLabel || "Prompt:";
    const question = document.createElement("p");
    question.className = "typewriter";
    question.dataset.text = payload.question;
    questionWrap.appendChild(label);
    questionWrap.appendChild(question);
    entry.appendChild(questionWrap);
  }

  if (!payload.story && !payload.question && payload.text) {
    const text = document.createElement("p");
    text.className = "typewriter";
    text.dataset.text = payload.text;
    entry.appendChild(text);
  }

  appendMissionLogEntry(entry, { replace: replaceTranscript });
  if (payload.readyCheck) preloadBossPhasePlan(payload);
  recordSceneHistory(payload);
  if (!hasContinuationGate) {
    completeTranscriptAdvance(payload);
  }
  if (effects.length && !payload.suppressEffectFlash) flashStatusEffects(effects);
  renderInventoryActions();
  const autoRead = maybeAutoReadMissionLog(entry);
  prefetchUpcomingTts(payload);
  const readyCheckAudioLeadMs = payload.readyCheck ? 500 : 0;
  const typing = syncTtsPresentation(autoRead, readyCheckAudioLeadMs).then(() => {
    if (presentationRunId !== state.logPresentationRunId) throw new Error("Mission log presentation superseded");
    return revealPreparedVoiceText(entry);
  }).then(() => {
    if (presentationRunId !== state.logPresentationRunId) throw new Error("Mission log presentation superseded");
    if (payload.question) startBossQuestionMusic();
    return typeQueuedText(entry);
  });
  typing.then(() => {
    return waitForTtsPlayback(autoRead.playback);
  }).then(() => {
    if (presentationRunId !== state.logPresentationRunId) return;
    completeTranscriptPresentation(entry, payload, presentationRunId, { deferStatusPresentation, hasContinuationGate, transitionPresentationStep });
  }).catch((error) => {
    if (presentationRunId !== state.logPresentationRunId) return;
    logDebugEvent({
      kind: "error",
      label: "Mission log presentation recovered",
      detail: String(error?.message || error || "presentation interrupted").slice(0, 500)
    });
    completeTranscriptPresentation(entry, payload, presentationRunId, { deferStatusPresentation, hasContinuationGate, transitionPresentationStep });
  });
  return true;
}

function completeTranscriptPresentation(entry, payload, presentationRunId, options = {}) {
  if (presentationRunId !== state.logPresentationRunId) return;
  roomTransitionTraceStepEnd(options.transitionPresentationStep, {
    presentationRunId,
    hasContinuationGate: Boolean(options.hasContinuationGate)
  });
  finishLogPresentation(presentationRunId);
  if (typeof payload.onTypedComplete === "function") payload.onTypedComplete(entry, payload);
  if (options.deferStatusPresentation) {
    const deferredEntry = document.createElement("div");
    appendDamageLog(deferredEntry, payload);
    const deferredEffects = applyFeedState(payload);
    if (deferredEffects.length && !payload.suppressEffectFlash) flashStatusEffects(deferredEffects);
  }
  startMissionLogAutoScroll({ startAtBottom: true });
  if (options.hasContinuationGate) {
    renderMissionContinueGate(entry, payload);
    return;
  }
  if (payload.teamReadyGate) {
    renderTeamReadyGate(entry);
    return;
  }
  if (payload.readyCheck) {
    if (state.chatMode) renderChatControls();
    renderBossReadyGate(entry, payload);
    return;
  }
  if (payload.isRecovery) {
    if (state.chatMode) renderChatControls();
    renderRecoveryGateForEntry(entry, payload);
    return;
  }
  finishTranscriptQuestionFlow(payload);
}

function shouldShowOpeningVoiceLoader(payload) {
  return Boolean(
    payload?.teamReadyGate
    && state.ttsAutoLog
    && ["piper", "kokoro"].includes(state.ttsProvider)
    && ttsCanSpeak()
  );
}

function voiceGenerationTransmissionHtml() {
  return `
    <div class="transmission-display tts-generation-transmission">
      <div class="transmission-heading">
        <strong>RECEIVING TRANSMISSION...</strong>
        <span class="signal-bars" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
      </div>
      <div class="transmission-waveform" aria-hidden="true">
        ${Array.from({ length: 24 }, () => "<i></i>").join("")}
      </div>
      <p>Preparing narrator channel...</p>
    </div>
  `;
}

function revealPreparedVoiceText(entry) {
  const loader = entry?.querySelector?.(".tts-generation-transmission");
  if (!loader) return Promise.resolve();
  loader.classList.add("fading");
  entry.classList.remove("tts-generation-pending");
  entry.classList.add("tts-generation-ready");
  return new Promise((resolve) => {
    window.setTimeout(() => {
      loader.remove();
      resolve();
    }, 240);
  });
}

function completeTranscriptAdvance(payload) {
  roomTransitionTraceEmit("MARK", "complete transcript advance", {
    advanceRoom: Boolean(payload.advanceRoom),
    correct: Boolean(payload.correct)
  });
  if (payload.advanceRoom) {
    state.combatMountBlocked = false;
    advanceChatProgress(Boolean(payload.correct));
  }
  applyFeedRoom(payload);
  registerActiveObstacleFromPayload(payload);
  if (payload.question || payload.advanceRoom) clearSubmittedAnswer();
}

function finishTranscriptQuestionFlow(payload) {
  if (payload.readyCheck) {
    if (state.chatMode) renderChatControls();
  } else if (payload.question) {
    state.answerResults = {};
    state.playerAnswerFeedback = {};
    state.statusRenderSignature = "";
    renderStatus();
    const waitForRoom = state.actionDrivenMode
      ? preloadActionRoomOpening(currentQuestionInfo())
      : Promise.resolve();
    waitForRoom.then(() => {
      queueMapQuestionReveal(() => {
        startEmergencyTimerForCurrentEncounter(currentQuestionInfo().type, { publish: false });
        publishCurrentPlayerPrompt({ renderOverlay: false });
        if (state.chatMode) renderChatControls();
      });
    });
  }
}

function renderMissionContinueGate(entry, payload) {
  clearMissionContinueGateTimer();
  const gate = document.createElement("div");
  gate.className = "mission-continue-gate";
  const countdownSeconds = continueCountdownSeconds();
  gate.innerHTML = `
    <button id="missionContinueBtn" type="button">Continue</button>
    <span>Auto-advancing in <strong id="missionContinueCountdown">${countdownSeconds}</strong></span>
  `;
  entry.appendChild(gate);
  startMissionLogAutoScroll({ startAtBottom: true });
  let remaining = countdownSeconds;
  const button = gate.querySelector("button");
  const countdown = gate.querySelector("strong");
  const continueNow = () => {
    clearMissionContinueGateTimer();
    button.disabled = true;
    gate.classList.add("resolving");
    revealMissionContinuation(entry, payload, gate);
  };
  button.addEventListener("click", continueNow, { once: true });
  state.continueGateTimer = window.setInterval(() => {
    remaining -= 1;
    if (countdown) countdown.textContent = String(Math.max(0, remaining));
    if (remaining <= 0) continueNow();
  }, 1000);
}

function renderTeamReadyGate(entry) {
  const gate = document.createElement("div");
  gate.className = "mission-continue-gate team-ready-gate";
  gate.innerHTML = `<button id="missionTeamReadyBtn" type="button">Team Ready</button>`;
  entry.appendChild(gate);
  document.getElementById("missionTeamReadyBtn")?.addEventListener("click", () => {
    const button = document.getElementById("missionTeamReadyBtn");
    if (button) button.disabled = true;
    gate.classList.add("resolving");
    confirmTeamReady();
  }, { once: true });
}

function renderBossReadyGate(entry, payload = {}) {
  // Route travel normally owns the readiness sting. Keep this handoff as a
  // fallback for starts or recovery paths that reach the gate without movement.
  scheduleBossReadyAudioHandoff(payload);
  const gate = document.createElement("div");
  gate.className = "mission-continue-gate boss-ready-gate";
  gate.innerHTML = `
    <button id="missionBossReadyBtn" type="button">Continue</button>
    <span>Begin critical contact</span>
  `;
  entry.appendChild(gate);
  startMissionLogAutoScroll({ startAtBottom: true });
  roomTransitionTraceFinish("boss readiness gate ready", { nodeIndex: state.currentNode });
  document.getElementById("missionBossReadyBtn")?.addEventListener("click", () => {
    const button = document.getElementById("missionBossReadyBtn");
    if (button) button.disabled = true;
    gate.classList.add("resolving");
    confirmBossReady();
  }, { once: true });
}

function renderRecoveryPromptAfterTransition(entry, payload) {
  const questionWrap = document.createElement("div");
  questionWrap.className = "log-question recovery-log-question";
  const label = document.createElement("strong");
  label.textContent = "Recovery Options:";
  const question = document.createElement("p");
  question.textContent = payload.question || recoveryQuestionText({ tier });
  questionWrap.appendChild(label);
  questionWrap.appendChild(question);
  entry.appendChild(questionWrap);
  renderRecoveryGateForEntry(entry, payload);
}

function renderRecoveryGateForEntry(entry, payload) {
  const node = state.nodes[state.currentNode] || {};
  const tier = Number(payload.recoveryTier || node.tier || 1);
  const { hp, medkits, ems } = recoveryAmounts(tier);
  renderRecoveryChoiceGate(entry, tier, { hp, medkits, ems });
  startMissionLogAutoScroll({ startAtBottom: true });
  roomTransitionTraceFinish("recovery options ready", { tier, hp, medkits, ems });
}

function revealMissionContinuation(entry, payload, gate) {
  const continuationStep = roomTransitionTraceStepStart("mission continuation", {
    advanceRoom: Boolean(payload.advanceRoom),
    continuationChars: String(payload.continuationStory || "").length
  });
  const runId = beginLogPresentation();
  const transcript = document.getElementById("chatTranscript");
  const inner = resetMissionLogScroll(transcript);
  const continuationEntry = document.createElement("section");
  continuationEntry.className = "transcript-entry";
  if (payload.tag) {
    const tag = document.createElement("div");
    tag.className = "log-tag";
    tag.textContent = missionLogTagText(payload);
    continuationEntry.appendChild(tag);
  }
  const continuation = document.createElement("p");
  continuation.className = "typewriter mission-continuation";
  continuation.dataset.text = payload.continuationStory;
  continuationEntry.appendChild(continuation);
  if (inner) inner.appendChild(continuationEntry);
  gate?.remove();
  const transitionStartedAt = beginDeferredRouteTransition(payload);
  renderInventoryActions();
  const autoRead = maybeAutoReadMissionLog(continuationEntry);
  const ttsPreparationStep = roomTransitionTraceStepStart("continuation TTS preparation", {
    audioDiagnosticsDisabled: DISABLE_AUDIO_LOADING_FOR_TRANSITION_DIAGNOSTICS
  });
  syncTtsPresentation(autoRead).then(() => {
    roomTransitionTraceStepEnd(ttsPreparationStep);
    if (runId !== state.logPresentationRunId) throw new Error("Mission continuation superseded");
    return typeText(continuation, payload.continuationStory);
  }).then(() => {
    return waitForTtsPlayback(autoRead.playback);
  }).then(() => {
    if (runId !== state.logPresentationRunId) return;
    const finishContinuation = () => {
      roomTransitionTraceStepEnd(routeHoldStep, { fired: true });
      if (payload.deferredRouteTransition && state.transmissionPending) stopTransmissionFeedback(false);
      const advanceStep = roomTransitionTraceStepStart("advance mission progress");
      completeTranscriptAdvance(payload);
      roomTransitionTraceStepEnd(advanceStep, {
        nodeIndex: state.currentNode,
        questionIndex: state.currentQuestion
      });
      renderActionRoomArrivalAfterTransition(continuationEntry, payload, runId).then((handledArrival) => {
        if (runId !== state.logPresentationRunId) return;
        roomTransitionTraceStepEnd(continuationStep, { handledArrival });
        finishLogPresentation(runId);
        startMissionLogAutoScroll({ startAtBottom: true });
        recordSceneHistory({ ...payload, story: payload.continuationStory });
        if (payload.readyCheck) {
          if (state.chatMode) renderChatControls();
          renderBossReadyGate(continuationEntry, payload);
          return;
        }
        if (payload.isRecovery) {
          if (state.chatMode) renderChatControls();
          renderRecoveryPromptAfterTransition(continuationEntry, payload);
          return;
        }
        if (payload.advanceRoom && state.currentQuestion >= state.questions.length) {
          renderFinalResultGate(continuationEntry);
          return;
        }
        finishTranscriptQuestionFlow(payload);
      });
    };
    // Narration and route motion run concurrently. Preserve only the unfinished
    // fraction of the short travel animation so the marker arrives smoothly
    // before mission state advances; do not add a second handoff delay.
    const routeDuration = routeTravelDurationMs(payload.deferredRouteTransition);
    const routeHold = ENABLE_ROUTE_MARKER_TRANSITION && transitionStartedAt
      ? Math.max(0, routeDuration - (Date.now() - transitionStartedAt))
      : 0;
    const routeHoldStep = roomTransitionTraceStepStart("route travel hold", { routeDuration, routeHold, remainingAnimationMs: routeHold });
    if (routeHold) trackTypeTimer(finishContinuation, routeHold);
    else finishContinuation();
  }).catch((error) => {
    if (runId !== state.logPresentationRunId) return;
    roomTransitionTraceStepEnd(ttsPreparationStep, { recovered: true, error: String(error?.message || error || "") }, "ERROR");
    roomTransitionTraceStepEnd(continuationStep, { recovered: true, error: String(error?.message || error || "") }, "ERROR");
    logDebugEvent({
      kind: "error",
      label: "Mission continuation recovered",
      detail: String(error?.message || error || "continuation interrupted").slice(0, 500)
    });
    if (payload.deferredRouteTransition && state.transmissionPending) stopTransmissionFeedback(false);
    completeTranscriptAdvance(payload);
    finishLogPresentation(runId);
    if (payload.readyCheck) renderBossReadyGate(continuationEntry, payload);
    else if (payload.isRecovery) renderRecoveryPromptAfterTransition(continuationEntry, payload);
    else if (payload.advanceRoom && state.currentQuestion >= state.questions.length) renderFinalResultGate(continuationEntry);
    else finishTranscriptQuestionFlow(payload);
  });
}

function renderActionRoomArrivalAfterTransition(entry, payload, runId) {
  if (!state.actionDrivenMode || !payload.advanceRoom || !payload.question || payload.isRecovery || state.currentQuestion >= state.questions.length) {
    return Promise.resolve(false);
  }
  const info = currentQuestionInfo();
  if (!info?.actionRoom) return Promise.resolve(false);
  return preloadActionRoomOpening(info).then((parsed) => {
    if (runId !== state.logPresentationRunId) return false;
    const arrival = document.createElement("section");
    arrival.className = "transcript-entry action-room-arrival";
    const tag = document.createElement("div");
    tag.className = "log-tag";
    tag.textContent = `${formatEncounterTag(info.areaName)} - ${formatEncounterTag(info.tag)}`;
    const story = document.createElement("p");
    story.className = "typewriter";
    story.dataset.text = parsed?.opening || actionRoomOpeningFallback(info);
    arrival.appendChild(tag);
    arrival.appendChild(story);
    entry.appendChild(arrival);
    startMissionLogAutoScroll({ startAtBottom: true });
    return typeText(story, story.dataset.text).then(() => {
      recordSceneHistory({
        tag: info.tag,
        areaName: info.areaName,
        story: story.dataset.text,
        question: info.questionText,
        skipHistory: false
      });
      return true;
    });
  }).catch(() => false);
}

function renderFinalResultGate(entry) {
  const gate = document.createElement("div");
  gate.className = "mission-continue-gate final-result-gate";
  gate.innerHTML = `
    <button id="missionFinalResultBtn" type="button">View Final Mission Result</button>
    <span>Review the final transmission first.</span>
  `;
  entry.appendChild(gate);
  startMissionLogAutoScroll({ startAtBottom: true });
  roomTransitionTraceFinish("final result gate ready");
  document.getElementById("missionFinalResultBtn")?.addEventListener("click", () => {
    const button = document.getElementById("missionFinalResultBtn");
    if (button) button.disabled = true;
    gate.classList.add("resolving");
    renderEnding();
  }, { once: true });
}

function clearMissionContinueGateTimer() {
  if (!state.continueGateTimer) return;
  window.clearInterval(state.continueGateTimer);
  state.continueGateTimer = null;
}

function queueMapQuestionReveal(onReady, waitStartedAt = Date.now(), alertDelayMs = questionAlertDelayMs()) {
  roomTransitionTraceEmit("MARK", "queue question reveal", {
    alertDelayMs,
    waitElapsedMs: Date.now() - waitStartedAt
  });
  const revealRunId = ++state.questionRevealRunId;
  trackTypeTimer(() => {
    if (revealRunId !== state.questionRevealRunId || state.resolved) return;
    const combatRevealPending = isCombatNode(state.nodes[state.currentNode]) && (
      !state.combatStageEnteredNodes.has(state.currentNode)
      || els.combatStage?.classList.contains("entering")
      || els.combatStage?.classList.contains("exiting")
    );
    if (combatRevealPending) {
      if (Date.now() - waitStartedAt >= COMBAT_GATE_MAX_WAIT_MS) {
        recoverCombatPresentationGate("question reveal");
      } else {
        roomTransitionTraceEmit("WAIT", "question waiting for combat entry", {
          waitedMs: Date.now() - waitStartedAt,
          revealRunId
        });
        trackTypeTimer(() => {
          if (revealRunId === state.questionRevealRunId && !state.resolved) queueMapQuestionReveal(onReady, waitStartedAt, 0);
        }, 350);
        return;
      }
    }
    state.questionSurfaceVisible = false;
    state.questionPresentationReady = false;
    state.mapQuestionAlertActive = true;
    roomTransitionTraceEmit("MARK", "query incoming alert shown", { revealRunId });
    state.mapQuestionOverlayKey = "";
    const alertInfo = currentQuestionInfo();
    if (!state.actionDrivenMode && alertInfo?.type?.kind !== "action") playGameSfx("question");
    els.mapQuestionOverlay?.style.setProperty("--query-alert-duration", `${queryAlertDurationMs()}ms`);
    renderMapQuestionOverlay();
    waitForQueryAlert().then(() => {
      if (revealRunId !== state.questionRevealRunId || state.resolved) return;
      state.mapQuestionAlertActive = false;
      state.questionSurfaceVisible = true;
      roomTransitionTraceEmit("MARK", "question surface shown", { revealRunId });
      state.questionPresentationReady = false;
      resetStatusUpdates();
      state.mapQuestionOverlayKey = "";
      renderMapQuestionOverlay();
      const autoRead = maybeAutoReadQuestion({ allowBeforeReady: true });
      Promise.resolve(autoRead.playback).catch(() => {});
      const unlockDelay = Math.min(1200, Math.max(250, Number(autoRead.visualDelay) || 0));
      trackTypeTimer(() => {
        if (revealRunId !== state.questionRevealRunId || state.resolved) return;
        state.questionSurfaceVisible = false;
        state.questionPresentationReady = true;
        state.questionOpenedAt = Date.now();
        state.questionDurationMs = questionScoringDurationMs(currentQuestionInfo());
        state.questionPauseStartedAt = 0;
        state.questionPausedTotalMs = 0;
        renderMapQuestionOverlay();
        roomTransitionTraceEmit("MARK", "question input unlocked", { revealRunId, unlockDelay });
        if (typeof onReady === "function") onReady();
      }, unlockDelay);
    });
  }, alertDelayMs);
}

function shouldShowTranscriptQuestion(payload) {
  // The map owns the study prompt in both teacher and player-device modes.
  // Keeping it out of the mission log prevents duplicate questions and leaves
  // that rail dedicated to narration and mission events.
  return false;
}

function missionLogTagText(payload) {
  const label = formatEncounterTag(payload.tag);
  const area = payload.areaName || payload.roomName || roomName(state.nodes[state.currentNode] || { type: "challenge" }, state.currentNode);
  if (!area || /mission log|opening channel|transmission link|final transmission|final mission result/i.test(label)) return label;
  if (/readiness check|team confirmed/i.test(label)) return `${area} - ${label}`;
  return `${area} - ${label}`;
}

function formatEncounterTag(tag) {
  const text = String(tag || "").trim();
  if (!text) return "";
  if (/mission log|opening channel|readiness check|team confirmed|transmission link|final transmission|final mission result/i.test(text)) return text;
  if (/recovery/i.test(text)) return `Event: ${text}`;
  return `Challenge Type: ${text}`;
}

function beginLogPresentation() {
  state.logPresentationPending = true;
  state.logPresentationRunId += 1;
  document.body.classList.add("mission-log-streaming");
  renderInventoryActions();
  return state.logPresentationRunId;
}

function finishLogPresentation(runId) {
  if (runId !== state.logPresentationRunId) return;
  state.logPresentationPending = false;
  document.body.classList.remove("mission-log-streaming");
  renderInventoryActions();
}

function recordSceneHistory(payload) {
  if (!state.localDmMode || payload.recordHistory === false || !payload.story) return;
  const story = String(payload.story).trim();
  if (!story) return;
  state.sceneHistory.push({
    area: payload.areaName || payload.roomName || roomName(state.nodes[state.currentNode] || { type: "challenge" }, state.currentNode),
    story
  });
  state.sceneHistory = state.sceneHistory.slice(-3);
}

function clearSubmittedAnswer() {
  state.answerPending = false;
  state.lastSubmittedAnswer = "";
  state.playerSubmissionLogKey = "";
  if (state.chatMode) renderChatControls();
}

function normalizeFeedText(payload) {
  const limits = {
    tag: 80,
    story: 4000,
    question: 2500,
    questionLabel: 80,
    text: 4000,
    continuationStory: 4000,
    statusLog: 1000,
    roomName: 120,
    areaName: 120,
    activeObstacle: 700
  };
  for (const key of Object.keys(limits)) {
    if (typeof payload[key] === "string") {
      payload[key] = sanitizeText(expandFeedNewlines(payload[key]), {
        maxLength: limits[key],
        preserveNewlines: ["story", "question", "text", "continuationStory", "statusLog"].includes(key)
      });
    }
  }
}

function applyFeedRoom(payload) {
  if (payload.suppressRoomNameUpdate || payload.teamReadyGate || (!payload.question && !payload.advanceRoom && !payload.activeObstacle)) return;
  const name = payload.roomName || payload.areaName;
  if (!name) return;
  const index = Number.isFinite(Number(payload.roomIndex)) ? Number(payload.roomIndex) : state.currentNode;
  state.roomNames[index] = name;
  renderMap();
  updateChatRoomTitle();
}

function registerActiveObstacleFromPayload(payload) {
  if (!payload.question && !payload.activeObstacle) return;
  const info = currentQuestionInfo();
  if (!info.question) return;
  const index = state.currentQuestion;
  state.activeObstacles[index] = payload.activeObstacle
    || state.activeObstacles[index]
    || buildActiveObstacle(index, info.question, info.type, info.areaName);
}

function expandFeedNewlines(value) {
  return String(value).replaceAll("\\n", "\n").replaceAll("`n", "\n");
}

function applyFeedState(payload) {
  const effects = [];

  if (payload.inventory) {
    if (Number.isFinite(Number(payload.inventory.medkits))) state.inventory.medkits = Math.max(0, Number(payload.inventory.medkits));
    if (Number.isFinite(Number(payload.inventory.ems))) state.inventory.ems = Math.max(0, Number(payload.inventory.ems));
  }

  for (const event of asArray(payload.damage)) {
    const player = findPlayer(event);
    if (!player) continue;
    const amount = Math.max(0, Number(event.amount || event.damage || 0));
    if (amount) player.hp = Math.max(0, player.hp - amount);
    if (event.status) addStatusToPlayer(player, event.status);
    if (event.statuses) event.statuses.forEach((status) => addStatusToPlayer(player, status));
    player.incapacitated = player.hp === 0;
    effects.push({ player, kind: event.effect || (amount ? "hit" : "status"), amount });
  }

  for (const event of asArray(payload.players)) {
    const player = findPlayer(event);
    if (!player) continue;
    if (Number.isFinite(Number(event.hp))) player.hp = Math.max(0, Math.min(Math.max(10, Number(player.maxHp) || 10), Number(event.hp)));
    if (Number.isFinite(Number(event.delta))) player.hp = Math.max(0, Math.min(Math.max(10, Number(player.maxHp) || 10), player.hp + Number(event.delta)));
    if (Array.isArray(event.status)) player.status = event.status.filter(Boolean);
    if (event.addStatus) addStatusToPlayer(player, event.addStatus);
    if (event.clearStatus) player.status = [];
    if (typeof event.incapacitated === "boolean") player.incapacitated = event.incapacitated;
    else player.incapacitated = player.hp === 0;
    if (event.effect) effects.push({ player, kind: event.effect, amount: Math.abs(Number(event.delta || event.amount || event.damage || 0)) });
  }

  for (const event of asArray(payload.effects)) {
    const player = findPlayer(event);
    if (player) effects.push({ player, kind: event.effect || "pulse", amount: Math.abs(Number(event.amount || event.damage || event.delta || 0)) });
  }

  if (effects.length || payload.inventory) {
    renderStatus();
    renderPlayerDmControls();
  }

  return effects;
}

function appendDamageLog(entry, payload) {
  const events = [
    ...asArray(payload.damage).map((event) => ({ ...event, kind: "damage" })),
    ...asArray(payload.players).filter((event) => event.note || event.delta || event.hp || event.addStatus || event.clearStatus)
  ];
  if (!events.length && !payload.statusLog) return;

  const log = document.createElement("div");
  log.className = "damage-log";

  if (payload.statusLog) {
    String(payload.statusLog).split(/\r?\n/).map((text) => text.trim()).filter(Boolean).forEach((text) => {
      const line = document.createElement("p");
      line.textContent = text;
      log.appendChild(line);
    });
  }

  for (const event of events) {
    const line = document.createElement("p");
    line.textContent = formatStatusEvent(event);
    log.appendChild(line);
  }

  appendStatusUpdateLog(log, entry);
  if (statusLogIncludesItemGain(payload.statusLog)) playGameSfx("loot");
}

function statusLogIncludesItemGain(statusLog) {
  const text = String(statusLog || "");
  return /\b(?:inventory gained|found\s+(?:\d+|one|two)?\s*(?:medkits?|ems devices?|combat gear)|gained\s+(?:an?\s+)?(?:medkit|ems device)|salvaged?\s+.*(?:gear|supplies))\b/i.test(text);
}

function appendStatusUpdateLog(log, fallbackEntry) {
  const feed = els.statusUpdateFeed;
  if (!feed) {
    fallbackEntry?.appendChild(log);
    return;
  }
  const inner = statusUpdateScrollInner(feed);
  if (!inner) return;
  stopAutoScroll(feed);
  inner.innerHTML = "";
  inner.querySelector(".muted-small")?.remove();
  inner.appendChild(log);
  feed.scrollTop = 0;
  startAutoScrollIfOverflow(feed, { contentElement: inner, startAtTop: true, intervalMs: 38, edgeHold: 0, bottomHold: 10, retryMs: 900 });
}

function resetStatusUpdates() {
  if (!els.statusUpdateFeed) return;
  stopAutoScroll(els.statusUpdateFeed);
  els.statusUpdateFeed.innerHTML = `<div class="status-update-scroll-inner"><p class="muted-small">No status changes yet.</p></div>`;
}

function placeholderTransmissionHtml() {
  return `
    <div class="transmission-display placeholder-transmission">
      <div class="transmission-heading">
        <strong>RECEIVING TRANSMISSION...</strong>
        <span class="signal-bars" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
      </div>
      <div class="transmission-waveform" aria-hidden="true">
        ${Array.from({ length: 24 }, () => "<i></i>").join("")}
      </div>
      <p>Mission channel standing by.</p>
    </div>
  `;
}

function startAutoScrollIfOverflow(element, options = {}) {
  if (!element) return;
  stopAutoScroll(element);
  const startedAt = Date.now();
  const contentElement = options.contentElement || element;
  contentElement.classList.remove("auto-scroll");
  contentElement.style.removeProperty("--status-scroll-distance");
  contentElement.style.removeProperty("--status-scroll-duration");
  const tryStart = () => {
    const maxScroll = (options.contentElement ? contentElement.scrollHeight : element.scrollHeight) - element.clientHeight;
    if (maxScroll <= 6) {
      element.scrollTop = 0;
      if (Date.now() - startedAt < (options.retryMs ?? 0)) {
        window.setTimeout(tryStart, 90);
      }
      return;
    }
    if (options.startAtBottom) element.scrollTop = maxScroll;
    else if (options.startAtTop) element.scrollTop = 0;
    contentElement.style.setProperty("--status-scroll-distance", `${Math.ceil(maxScroll)}px`);
    contentElement.style.setProperty("--status-scroll-duration", `${Math.min(14, Math.max(3.2, maxScroll * 0.07))}s`);
    contentElement.classList.add("auto-scroll");
    if (options.contentElement) return;
    let direction = options.startAtBottom ? -1 : 1;
    let hold = options.initialHold ?? options.edgeHold ?? 18;
    const timer = window.setInterval(() => {
      const max = element.scrollHeight - element.clientHeight;
      if (max <= 6 || !document.body.contains(element)) {
        stopAutoScroll(element);
        return;
      }
      if (hold > 0) {
        hold -= 1;
        return;
      }
      element.scrollTop += direction;
      if (element.scrollTop >= max - 1) {
        element.scrollTop = max;
        direction = -1;
        hold = options.bottomHold ?? 26;
      } else if (element.scrollTop <= 1) {
        element.scrollTop = 0;
        direction = 1;
        hold = options.edgeHold ?? 20;
      }
    }, options.intervalMs ?? 78);
    element.dataset.autoScrollTimer = String(timer);
    state.autoScrollTimers.push(timer);
  };
  window.requestAnimationFrame(tryStart);
}

function stopAutoScroll(element) {
  element?.classList?.remove("auto-scroll");
  const inners = element?.querySelectorAll?.(".status-update-scroll-inner, .chat-transcript-scroll-inner") || [];
  inners.forEach((inner) => {
    inner.classList.remove("auto-scroll");
    inner.style.removeProperty("--status-scroll-distance");
    inner.style.removeProperty("--status-scroll-duration");
  });
  if (!element?.dataset?.autoScrollTimer) return;
  window.clearInterval(Number(element.dataset.autoScrollTimer));
  delete element.dataset.autoScrollTimer;
}

function formatStatusEvent(event) {
  const player = findPlayer(event);
  const name = player?.name || event.name || event.player || "Team";
  const pieces = [];
  const amount = Number(event.amount || event.damage || 0);
  const delta = Number(event.delta);
  const hp = Number(event.hp);
  const statuses = [
    ...asArray(event.status),
    ...asArray(event.statuses),
    ...asArray(event.addStatus)
  ].filter(Boolean);

  const noteText = String(event.note || "");
  const isHeal = event.effect === "heal" || delta > 0 || /\b(recovered|healed|revived)\b/i.test(noteText);
  if (amount && !isHeal && !new RegExp(`\\b${amount}\\s+HP\\s+lost\\b`, "i").test(noteText)) pieces.push(`${amount} HP lost`);
  if (amount && isHeal && !new RegExp(`\\b${amount}\\s+HP\\s+(?:recovered|healed)\\b`, "i").test(noteText)) pieces.push(`${amount} HP recovered`);
  if (Number.isFinite(delta) && delta !== 0) pieces.push(`${delta > 0 ? "+" : ""}${delta} HP`);
  if (event.note) pieces.push(event.note);
  if (Number.isFinite(hp)) pieces.push(`now ${hp} HP`);
  if (statuses.length) pieces.push(statuses.join(", "));
  if (event.clearStatus) pieces.push("status cleared");

  return `${name}: ${pieces.join(", ") || "updated"}`;
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function findPlayer(event) {
  if (!event) return null;
  if (Number.isInteger(event.index) && state.players[event.index]) return state.players[event.index];
  if (Number.isFinite(Number(event.index)) && state.players[Number(event.index)]) return state.players[Number(event.index)];
  const name = normalize(event.name || event.player || "");
  return state.players.find((player) => normalize(player.name) === name) || null;
}

function addStatusToPlayer(player, status) {
  if (!status || player.status.includes(status)) return;
  player.status.push(status);
}

function flashStatusEffects(effects) {
  if (effects.some((effect) => effect.kind === "hit" || effect.amount > 0 && effect.kind !== "heal")) playGameSfx("damage");
  else if (effects.some((effect) => effect.kind === "heal")) playGameSfx("recovery");
  triggerBossDamageImpact(effects);
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      for (const { player, kind, amount } of effects) {
        const index = state.players.indexOf(player);
        const card = els.statusGrid.querySelector(`[data-player-index="${index}"]`);
        if (!card) continue;
        const className = kind === "status" ? "status-effect-pulse" : kind === "heal" ? "heal-pulse" : "hit-pulse";
        card.classList.remove("hit-pulse", "status-effect-pulse", "heal-pulse");
        void card.offsetWidth;
        card.classList.add(className);
        showStatusImpactFloat(card, kind, amount);
      }
    });
  });
}

function showStatusImpactFloat(card, kind, amount) {
  const numeric = Math.max(0, Number(amount || 0));
  // Damage is already presented in turn order on the battle screen. Keep the
  // left roster visually quiet while retaining useful positive-heal feedback.
  if (!numeric || kind !== "heal") return;
  card.querySelectorAll(".status-impact-float").forEach((node) => node.remove());
  const float = document.createElement("span");
  float.className = "status-impact-float heal";
  float.textContent = `+${numeric}`;
  card.appendChild(float);
  window.setTimeout(() => float.remove(), 1450);
}

function flashEmsShield() {
  els.statusGrid.classList.remove("ems-shield-sweep");
  void els.statusGrid.offsetWidth;
  els.statusGrid.classList.add("ems-shield-sweep");
  window.setTimeout(() => els.statusGrid.classList.remove("ems-shield-sweep"), 1400);
}

function advanceChatRoom() {
  advanceChatProgress(true);
  beginNextNode();
}

function advanceChatProgress(correct) {
  const transitionStep = roomTransitionTraceStepStart("advance chat progress", {
    correct: Boolean(correct),
    fromNode: state.currentNode,
    fromQuestion: state.currentQuestion
  });
  state.resolved = true;
  const nodeBeforeAdvance = state.nodes[state.currentNode];
  const progression = projectedProgressAfterRound();
  if (nodeBeforeAdvance?.type !== "recovery" && !progression.stayInRoom) {
    updateCurrentNodeResult(Boolean(correct));
  }
  state.currentQuestion = progression.nextQuestion;
  state.answerResults = {};
  if (!progression.stayInRoom && nodeBeforeAdvance?.type === "boss") stopEmergencyTimer();
  state.currentNode = progression.nextNode;
  state.challengeHistory.push({ correct, type: "Live Mission" });
  if (state.localDmMode && state.currentQuestion < state.questions.length) state.resolved = false;
  syncBackgroundMusicForEncounter();
  renderStatus();
  renderMap();
  updateChatRoomTitle();
  roomTransitionTraceStepEnd(transitionStep, {
    toNode: state.currentNode,
    toQuestion: state.currentQuestion,
    stayInRoom: progression.stayInRoom
  });
}

function updateChatRoomTitle() {
  const heading = els.encounterCard.querySelector("h3");
  const node = state.nodes[state.currentNode];
  if (heading && node) heading.textContent = roomName(node, state.currentNode);
}

function adjustInventory(kind, delta) {
  state.inventory[kind] = Math.max(0, state.inventory[kind] + delta);
  renderStatus();
}

function adjustPlayerHp(index, delta) {
  const player = state.players[index];
  if (!player) return;
  player.hp = Math.max(0, Math.min(Math.max(10, Number(player.maxHp) || 10), player.hp + delta));
  player.incapacitated = player.hp === 0;
  renderStatus();
}

function addPlayerStatus(index, status) {
  const player = state.players[index];
  if (!player || !status) return;
  if (!player.status.includes(status)) player.status.push(status);
  renderStatus();
  renderPlayerDmControls();
}

function clearPlayerStatus(index) {
  const player = state.players[index];
  if (!player) return;
  player.status = [];
  if (player.hp > 0) player.incapacitated = false;
  renderStatus();
}

function renderAnswerControls(q, { locked = false, nextLabel = "" } = {}) {
  syncAnswerControlsDock();
  if (state.started && state.deviceMode !== "single") {
    els.answerControls.innerHTML = "";
    return;
  }
  const sideActionHtml = classicTeamActionControlsHtml();
  const availableChoices = new Set(q.mode === "multiple" ? q.choices.map((choice) => choice.key) : []);
  els.answerControls.innerHTML = `
    <div class="single-device-submission-grid">
      <form id="classicAnswerForm" class="classic-answer-form player-answer-form">
        <div class="answer-grid">
          ${["A", "B", "C", "D"].map((letter) => `<button class="answerBtn" data-answer="${letter}" type="button" ${!locked && availableChoices.has(letter) ? "" : "disabled"}>${letter}</button>`).join("")}
        </div>
        ${nextLabel
          ? `<div class="answer-submit-row"><button id="nextBtn" type="button">${escapeHtml(nextLabel)}</button></div>`
          : q.mode === "fill"
            ? `<div class="answer-submit-row"><input id="fillAnswer" class="text-answer" type="text" placeholder="Enter answer" ${!locked ? "" : "disabled"}><button id="submitFillBtn" type="submit" ${!locked ? "" : "disabled"}>Submit</button></div>`
            : ""}
      </form>
      ${sideActionHtml}
    </div>
  `;

  bindEmergencyTimerControls();
  const sideActionButton = document.getElementById("sideActionBtn");
  if (sideActionButton) sideActionButton.addEventListener("click", submitLocalSideAction);
  document.querySelectorAll(".answerBtn").forEach((button) => {
    button.addEventListener("click", () => resolveChallenge(button.dataset.answer));
  });
  document.getElementById("classicAnswerForm")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const input = document.getElementById("fillAnswer");
      resolveChallenge(input.value);
  });
  document.getElementById("nextBtn")?.addEventListener("click", beginNextNode);
}

function classicTeamActionControlsHtml() {
  if (!actionsAllowedThisEncounter()) return "";
  const emergencyActive = state.emergencyTimer?.kind === "emergency";
  const sideActionUsed = state.sideActionRooms.has(state.currentNode);
  const locked = state.answerPending || state.sideActionPending || !state.questionPresentationReady || emergencyActive || sideActionUsed || state.resolved;
  return `
    <div class="side-action-form classic-side-action">
      <label>
        Team Action
        <div class="answer-submit-row">
          <input id="sideActionInput" type="text" autocomplete="off" placeholder="Search the lockers, inspect the logbook..." ${locked ? "disabled" : ""}>
          <button id="sideActionBtn" class="secondary" type="button" ${locked ? "disabled" : ""}>Attempt</button>
        </div>
      </label>
      <div class="answer-submit-state">${state.sideActionPending ? "Receiving team-action transmission..." : sideActionUsed ? "The team has already searched or improvised in this room." : "One optional team action is available in this room."}</div>
    </div>
  `;
}

function activateEMS() {
  if (suppliesAreLocked() || !state.questionPresentationReady || state.selectedEMS || state.inventory.ems <= 0 || state.resolved) return;
  state.selectedEMS = true;
  state.inventory.ems -= 1;
  playGameSfx("recovery");
  renderStatus();
  flashEmsShield();
  const notice = document.createElement("p");
  notice.className = "warning";
  notice.textContent = "EMS device armed. Its field will absorb the danger from this encounter.";
  els.encounterCard.appendChild(notice);
  const button = document.getElementById("emsBtn");
  if (button) button.disabled = true;
}

function resolveChallenge(answer, options = {}) {
  if (state.resolved || !state.encounter || (!state.questionPresentationReady && !options.timeout)) return;
  stopTts();
  stopEmergencyTimer();
  publishPlayerWaiting("resolving");
  const { question, operator } = state.encounter;
  const type = options.timeout && state.encounter.type?.kind === "emergency"
    ? { ...state.encounter.type, emergencyTimeout: true, emergencySlow: true }
    : state.encounter.type;
  const correct = question.mode === "multiple"
    ? String(answer).toUpperCase() === question.answerKey
    : isCloseAnswer(answer, question.answerText);
  awardSharedAnswerPointsOnce({
    correct,
    question,
    type,
    operator,
    submittedAt: options.submittedAt || Date.now(),
    scoringPlayer: options.scoringPlayer || null,
    source: options.source || ""
  });
  rememberPreviousAnswer(answer, question, correct);

  const combatEntries = type.locked && operator
    ? [{ player: operator, correct, submittedAt: options.submittedAt || Date.now(), answer }]
    : activePlayers().map((player) => ({ player, correct, submittedAt: options.submittedAt || Date.now(), answer }));
  const result = isCombatNode(state.nodes[state.currentNode])
    ? applyCombatEncounter(combatEntries, type, operator, question)
    : applyEncounter(correct, type, operator);
  const bossAnswer = Boolean(type.boss || currentBossProgress());
  state.resolved = true;
  const progression = projectedProgressAfterRound();
  if (!progression.stayInRoom) updateCurrentNodeResult(Boolean(correct));
  if (teamFullyIncapacitated()) {
    const showFailure = () => {
      flashAnswerFeedback(correct, { boss: bossAnswer });
      renderTeamFailureCard(localTeamFailureFallback(result, roomName(state.nodes[state.currentNode] || { type: "challenge" }, state.currentNode)));
    };
    if (result.combat) presentCombatResolution(result, { onComplete: showFailure });
    else showFailure();
    return;
  }
  if (result.combat) presentCombatResolution(result);
  const nodeBeforeAdvance = state.nodes[state.currentNode];
  state.currentQuestion = progression.nextQuestion;
  state.currentNode = progression.nextNode;
  state.answerResults = {};
  if (!progression.stayInRoom && nodeBeforeAdvance?.type === "boss") stopEmergencyTimer();
  syncBackgroundMusicForEncounter();
  state.challengeHistory.push({ correct, type: type.label });
  flashAnswerFeedback(correct, { boss: bossAnswer });

  const resolution = document.createElement("div");
  resolution.className = "resolution";
  resolution.innerHTML = `
    <p class="typewriter" data-text="${escapeAttribute(result.narration)}"></p>
    ${result.loot ? `<p class="success typewriter" data-text="${escapeAttribute(result.loot)}"></p>` : ""}
    ${result.incapacitated ? `<p class="critical typewriter" data-text="${escapeAttribute(result.incapacitated)}"></p>` : ""}
  `;
  els.encounterCard.appendChild(resolution);

  if (state.deviceMode === "single") renderAnswerControls(question, { locked: true });
  const presentationRunId = beginLogPresentation();
  typeQueuedText(resolution).then(() => {
    finishLogPresentation(presentationRunId);
    if (state.deviceMode === "single") {
      renderAnswerControls(question, {
        locked: true,
        nextLabel: state.currentQuestion >= state.questions.length ? "Finish Mission" : "Next Challenge"
      });
    } else {
      renderClassicMultiContinueGate(resolution);
    }
  });

  renderStatus();
  renderMap();
}

function renderClassicMultiContinueGate(container) {
  clearMissionContinueGateTimer();
  const gate = document.createElement("div");
  gate.className = "mission-continue-gate classic-multi-continue-gate";
  const countdownSeconds = continueCountdownSeconds();
  gate.innerHTML = `
    <button type="button">Continue</button>
    <span>Auto-advancing in <strong>${countdownSeconds}</strong></span>
  `;
  container.appendChild(gate);
  let remaining = countdownSeconds;
  const button = gate.querySelector("button");
  const countdown = gate.querySelector("strong");
  const continueNow = () => {
    clearMissionContinueGateTimer();
    if (button) button.disabled = true;
    gate.classList.add("resolving");
    beginNextNode();
  };
  button?.addEventListener("click", continueNow, { once: true });
  state.continueGateTimer = window.setInterval(() => {
    remaining -= 1;
    if (countdown) countdown.textContent = String(Math.max(0, remaining));
    if (remaining <= 0) continueNow();
  }, 1000);
}

function typeQueuedText(container) {
  const nodes = [...container.querySelectorAll("[data-text]")];
  const startedAt = Date.now();
  const charCount = nodes.reduce((total, node) => total + String(node.dataset.text || "").length, 0);
  const transitionStep = roomTransitionTraceStepStart("queued typewriter", { nodes: nodes.length, charCount });
  const generation = state.typewriterGeneration;
  return nodes.reduce((chain, node) => {
    return chain.then(() => typeText(node, node.dataset.text || "", generation));
  }, Promise.resolve()).then(() => {
    if (charCount) {
      logDebugEvent({
        kind: "display",
        label: "Typewriter complete",
        detail: `${Date.now() - startedAt}ms reveal | ${charCount} chars`
      });
    }
  }).finally(() => roomTransitionTraceStepEnd(transitionStep, { nodes: nodes.length, charCount }));
}

function typeText(element, text, generation = state.typewriterGeneration) {
  element.textContent = "";
  return new Promise((resolve) => {
    const transitionStep = roomTransitionTraceStepStart("typewriter text", { charCount: text.length });
    let finished = false;
    const finish = (reason = "complete") => {
      if (finished) return;
      finished = true;
      roomTransitionTraceStepEnd(transitionStep, { charCount: text.length, reason });
      resolve();
    };
    const textNode = document.createTextNode("");
    element.appendChild(textNode);
    let index = 0;
    let nextCharacterAt = 0;
    const startedAt = performance.now();
    const step = () => {
      if (generation !== state.typewriterGeneration) {
        finish("generation changed");
        return;
      }
      if (!document.body.contains(element)) {
        finish("element removed");
        return;
      }
      const elapsed = performance.now() - startedAt;
      const previousIndex = index;
      while (index < text.length && elapsed >= nextCharacterAt) {
        const typedCharacter = text[index];
        index += 1;
        nextCharacterAt += typewriterDelayFor(typedCharacter);
      }
      if (index !== previousIndex) textNode.data = text.slice(0, index);
      const typedCharacter = index > 0 ? text[index - 1] : "";
      if (index !== previousIndex && typedCharacter && /\S/.test(typedCharacter) && index % 3 === 0) {
        playGameSfx("typewriter", { minInterval: 55, volumeScale: 0.13, pulse: false });
      }
      keepMissionLogTypingInView(element);
      if (index < text.length) {
        // Cap DOM work at roughly one update per frame. If the main thread is
        // briefly busy, elapsed time catches the reveal up in a single update.
        const delay = Math.max(8, Math.min(32, nextCharacterAt - elapsed));
        trackTypeTimer(step, delay, () => finish("timer cancelled"));
      } else {
        renderRichText(element, text);
        element.removeAttribute("data-text");
        keepMissionLogTypingInView(element, true);
        finish();
      }
    };
    step();
  });
}

function keepMissionLogTypingInView(element, force = false) {
  const now = performance.now();
  const lastScrollAt = Number(element.dataset.lastTypingScrollAt || 0);
  if (!force && now - lastScrollAt < 120) return;
  element.dataset.lastTypingScrollAt = String(now);
  const containers = [
    element.closest?.("#encounterCard")
  ].filter(Boolean);
  for (const container of containers) {
    if (container.dataset.autoScrollTimer) stopAutoScroll(container);
    const max = container.scrollHeight - container.clientHeight;
    if (max > 6) container.scrollTop = max;
  }
  if (force) delete element.dataset.lastTypingScrollAt;
}

function renderRichText(element, text) {
  element.innerHTML = highlightPlayerNames(text);
}

function highlightPlayerNames(text) {
  let html = escapeHtml(text);
  const players = [...state.players]
    .filter((player) => player.name)
    .sort((a, b) => b.name.length - a.name.length);
  for (const player of players) {
    const name = escapeHtml(player.name);
    const pattern = new RegExp(`\\b${escapeRegExp(name)}\\b`, "gi");
    html = html.replace(pattern, `<strong class="player-name-mention" style="--player-color:${playerColor(player.name)}">$&</strong>`);
  }
  return html;
}

const playerColorPalette = [
  "#8fd3ff",
  "#f0c96a",
  "#93d68b",
  "#f39aa4",
  "#c7a6ff",
  "#76d8c7",
  "#f3ad72",
  "#b6d67d"
];

function playerColor(name, fallbackIndex = -1) {
  const key = normalize(name);
  const player = state.players.find((entry) => normalize(entry.name) === key);
  const classColor = player?.classColor || combatSystem.classDefinition?.(player?.classId)?.color;
  if (classColor) return classColor;
  const index = state.players.findIndex((entry) => normalize(entry.name) === key);
  const paletteIndex = index >= 0 ? index : fallbackIndex >= 0 ? fallbackIndex : seedFrom(key);
  return playerColorPalette[paletteIndex % playerColorPalette.length];
}

function participantColorIndex(name) {
  const key = normalize(name);
  return state.playerParticipants.findIndex((player) => normalize(player.name) === key);
}

function clearTypewriters() {
  clearMissionContinueGateTimer();
  stopGameSfx("typewriter");
  state.typewriterGeneration += 1;
  const pendingResolvers = [...new Set(state.typeTimerResolvers.values())];
  for (const timer of state.typeTimers) {
    window.clearTimeout(timer);
  }
  state.typeTimers = [];
  state.typeTimerResolvers.clear();
  pendingResolvers.forEach((resolve) => resolve());
  for (const timer of state.autoScrollTimers) {
    window.clearInterval(timer);
  }
  state.autoScrollTimers = [];
  state.mapQuestionAlertActive = false;
  state.questionRevealRunId += 1;
}

function escapeAttribute(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function useMedkit(playerIndex) {
  const player = state.players[playerIndex];
  if (suppliesAreLocked() || !player || state.inventory.medkits <= 0) return;
  playGameSfx("recovery");
  state.inventory.medkits -= 1;
  if (player.incapacitated) {
    player.incapacitated = false;
    player.hp = 3;
  } else {
    healPlayer(player, 4);
  }
  player.status = [];
  renderStatus();

  const note = document.createElement("p");
  note.className = "success";
  note.textContent = `${player.name} uses a Medkit and gets back in the fight.`;
  els.encounterCard.appendChild(note);

  const activeQuestion = state.encounter && !state.resolved ? state.encounter.question : null;
  if (activeQuestion) renderAnswerControls(activeQuestion);
  else {
    const nextText = state.currentQuestion >= state.questions.length ? "Finish Mission" : "Next Challenge";
    els.answerControls.innerHTML = `<button id="nextBtn" type="button">${nextText}</button>`;
    document.getElementById("nextBtn").addEventListener("click", beginNextNode);
  }
}

function applyEncounter(correct, type, operator) {
  const lastStandingBeforeEncounter = soleActivePlayer();
  const pendingSecondWind = secondWindPendingPlayer();
  const eventNotes = bleedTick();

  const emsWasArmed = state.selectedEMS;
  const guardWasReady = state.sideActionGuard;
  let guardConsumed = false;
  let narration;
  let loot = "";
  let lootStatus = "";
  let lootFact = "";
  let incapacitated = "";
  const consequenceFacts = [];
  const supportEvents = [];
  // Medic/Scout abilities and healing/hint items resolve during obstacle
  // turns too; combat-only abilities are filtered by the queue guard.
  applyPendingCombatAbilities(null, eventNotes, consequenceFacts, supportEvents);

  if (correct) {
    const success = successNarration();
    narration = success.fallback;
    consequenceFacts.push(success.facts);
    if (state.rng() < 0.23) {
      const lootEvent = grantLoot();
      loot = lootEvent.fallback;
      lootStatus = lootEvent.status;
      lootFact = lootEvent.facts;
    }
  } else if (emsWasArmed) {
    narration = "The relay sequence comes too late, but the EMS field snaps open in a white ring. The blast, sparks, and pressure wave break against it and vanish into static.";
    consequenceFacts.push("EMS field absorbs the entire triggered hazard; no player is hurt; field is consumed");
  } else {
    const damageTargets = targetsFor(type, operator);
    const amount = lockedOperatorDamageAmount(type);
    const terminal = amount >= 5 || state.rng() < 0.05;
    const hazard = failureNarration(damageTargets, terminal);
    const appliedAmount = terminal ? 5 : Math.max(0, amount - (guardWasReady ? 1 : 0));
    guardConsumed = guardWasReady;
    for (const target of damageTargets) {
      applyDamage(target, appliedAmount, terminal ? "terminal" : "hit");
      if (appliedAmount > 0 && !target.status.length && state.rng() < 0.28 && !target.incapacitated) {
        target.status.push(randomStatus());
      }
      if (appliedAmount > 0) addEventNote(eventNotes, target.name, `${target.name} is caught when ${hazard.cause}.`);
    }
    consequenceFacts.push(`${hazard.facts}${guardWasReady ? "; defensive preparation reduces the impact" : ""}`);
    narration = appliedAmount > 0
      ? hazard.fallback
      : "The prepared cover catches the room's backlash. The squad stays low until the worst of it passes, then forces the route open.";
  }

  resolvePendingSecondWind(pendingSecondWind, correct, eventNotes, consequenceFacts);
  if (!pendingSecondWind) tryArmSecondWind(lastStandingBeforeEncounter, eventNotes, consequenceFacts);
  const down = state.players.filter((player) => player.incapacitated);
  if (down.length) incapacitated = `${down.map((player) => player.name).join(", ")} cannot answer until revived.`;
  state.selectedEMS = false;
  state.sideActionGuard = guardWasReady && !guardConsumed;

  return { narration, loot, lootStatus, lootFact, incapacitated, eventNotes, supportEvents, factSeed: consequenceFacts.join("; ") };
}

function applyDeviceTeamEncounter(entries, type) {
  const lastStandingBeforeEncounter = soleActivePlayer();
  const pendingSecondWind = secondWindPendingPlayer();
  const eventNotes = bleedTick();

  const wrongEntries = entries.filter((entry) => !entry.correct);
  const challengeSucceeded = deviceChallengeSucceeded(entries, type);
  const emsWasArmed = state.selectedEMS;
  const guardWasReady = state.sideActionGuard;
  let guardConsumed = false;
  let narration = "";
  let loot = "";
  let lootStatus = "";
  let lootFact = "";
  let incapacitated = "";
  const consequenceFacts = [];
  const supportEvents = [];
  applyPendingCombatAbilities(null, eventNotes, consequenceFacts, supportEvents);

  if (challengeSucceeded) {
    const success = successNarration();
    narration = success.fallback;
    consequenceFacts.push(success.facts);
    if (state.rng() < 0.23) {
      const lootEvent = grantLoot();
      loot = lootEvent.fallback;
      lootStatus = lootEvent.status;
      lootFact = lootEvent.facts;
    }
  } else if (emsWasArmed) {
    const protectedTargets = deviceFailureTargets(entries, type);
    const names = protectedTargets.map((player) => player.name).join(", ") || "the team";
    narration = `The failed field work starts to cascade around ${names}, but the EMS field snaps open in a white ring. The blast, sparks, and pressure wave break against it and vanish into static.`;
    consequenceFacts.push(`EMS field absorbs hazards triggered by failed player actions; affected players would have been: ${names}; no player is hurt; field is consumed`);
  } else {
    const damagePlayers = deviceFailureTargets(entries, type);
    const terminal = state.rng() < 0.05;
    const hazard = failureNarration(damagePlayers, terminal);
    const appliedAmount = terminal ? 5 : Math.max(0, (type.damage || 1) - (guardWasReady ? 1 : 0));
    guardConsumed = guardWasReady;
    for (const target of damagePlayers) {
      if (!target || target.incapacitated) continue;
      applyDamage(target, appliedAmount, terminal ? "terminal" : "hit");
      if (appliedAmount > 0 && !target.status.length && state.rng() < 0.28 && !target.incapacitated) {
        target.status.push(randomStatus());
      }
      if (appliedAmount > 0) addEventNote(eventNotes, target.name, `${target.name} is caught by the failed action's backlash when ${hazard.cause}.`);
    }
    consequenceFacts.push(`${deviceFailureFactPrefix(type)}; ${hazard.facts}${guardWasReady ? "; defensive preparation reduces the impact" : ""}`);
    narration = appliedAmount > 0
      ? hazard.fallback
      : "The prepared cover catches the room's backlash. The squad stays low until the worst of it passes, then forces the route open.";
  }

  const pendingEntry = entries.find((entry) => entry.player && sameName(entry.player.name, pendingSecondWind?.name));
  resolvePendingSecondWind(pendingSecondWind, Boolean(pendingEntry?.correct), eventNotes, consequenceFacts);
  if (!pendingSecondWind) tryArmSecondWind(lastStandingBeforeEncounter, eventNotes, consequenceFacts);
  const down = state.players.filter((player) => player.incapacitated);
  if (down.length) incapacitated = `${down.map((player) => player.name).join(", ")} cannot answer until revived.`;
  state.selectedEMS = false;
  state.sideActionGuard = guardWasReady && !guardConsumed;

  return { narration, loot, lootStatus, lootFact, incapacitated, eventNotes, supportEvents, factSeed: consequenceFacts.join("; ") };
}

function deviceFailureTargets(entries, type) {
  if (type.kind === "individual") return entries.filter((entry) => !entry.correct).map((entry) => entry.player).filter(Boolean);
  if (type.kind === "truefalse") return halfTeamTargets();
  return activePlayers();
}

function deviceFailureFactPrefix(type) {
  if (type.kind === "individual") return "individual hazards triggered only around wrong player actions";
  if (type.kind === "truefalse") return "true-or-false failure triggers a partial-team hazard";
  return "team challenge threshold missed; whole-team hazard triggered";
}

function bleedTick() {
  const eventNotes = {};
  for (const player of state.players) {
    if (player.incapacitated) continue;
    if (player.status.includes("Bleeding")) {
      const beforeHp = player.hp;
      applyDamage(player, 1, "bleed");
      if (player.hp !== beforeHp) {
        addEventNote(eventNotes, player.name, `${player.name}'s existing Bleeding worsens before the new action; this is ongoing blood loss from a previous injury, not a newly acquired wound or status.`);
      }
    }
  }
  return eventNotes;
}

function addEventNote(eventNotes, name, note) {
  if (!eventNotes || !name || !note) return;
  eventNotes[name] = eventNotes[name] ? `${eventNotes[name]} ${note}` : note;
}

function soleActivePlayer() {
  const active = activePlayers();
  return active.length === 1 ? active[0] : null;
}

function secondWindPendingPlayer() {
  if (!state.secondWindPendingPlayerName) return null;
  return state.players.find((player) => sameName(player.name, state.secondWindPendingPlayerName)) || null;
}

function tryArmSecondWind(player, eventNotes, consequenceFacts = []) {
  if (!state.secondWindEnabled || state.secondWindUsed || !player?.incapacitated || player.hp > 0) return false;
  if (state.currentQuestion >= state.questions.length - 1) return false;
  if (state.players.some((teammate) => teammate !== player && !teammate.incapacitated)) return false;

  state.secondWindUsed = true;
  state.secondWindPlayerName = player.name;
  state.secondWindPendingPlayerName = player.name;
  player.hp = 1;
  player.incapacitated = false;
  player.status = [];
  addEventNote(eventNotes, player.name, `Second Wind chance begins as ${player.name} refuses to collapse. ${player.name} holds at 1 HP with status effects cleared and must answer the next question correctly.`);
  consequenceFacts.push(`Second Wind chance begins for ${player.name}; lethal incapacitation delayed; restored to 1 HP; status effects cleared; next answer must be correct; once-per-mission chance consumed`);
  return true;
}

function resolvePendingSecondWind(player, answeredCorrectly, eventNotes, consequenceFacts = []) {
  if (!player) return false;
  state.secondWindPendingPlayerName = "";
  if (answeredCorrectly) {
    player.hp = Math.max(1, player.hp);
    player.incapacitated = false;
    addEventNote(eventNotes, player.name, `Second Wind secured when ${player.name} answers correctly and holds the line at 1 HP.`);
    consequenceFacts.push(`Second Wind secured by ${player.name}'s correct answer; operator remains active at 1 HP`);
    return true;
  }

  player.hp = 0;
  player.incapacitated = true;
  addEventNote(eventNotes, player.name, `Second Wind fails when ${player.name} misses the required answer and finally collapses.`);
  consequenceFacts.push(`Second Wind fails for ${player.name}; required answer was incorrect; operator becomes incapacitated`);
  return false;
}

function applyDamage(player, amount, source) {
  let final = amount;
  if (player.status.includes("Burned") && source !== "bleed") final += 1;
  if (player.status.includes("Shocked") && source !== "bleed" && state.rng() < 0.35) final *= 2;
  player.hp = Math.max(0, player.hp - final);
  if (player.hp === 0) player.incapacitated = true;
}

function healPlayer(player, amount) {
  player.hp = Math.min(Math.max(10, Number(player.maxHp) || 10), Math.max(0, player.hp + amount));
}

function randomStatus() {
  return ["Burned", "Bleeding", "Shocked", "Concussed"][Math.floor(state.rng() * 4)];
}

function targetsFor(type, operator) {
  const active = activePlayers();
  if (!active.length) return [];
  if (type.locked && operator && !operator.incapacitated) {
    if (!type.lockedDamageScope) type.lockedDamageScope = state.rng() < 0.35 ? "team" : "operator";
    return type.lockedDamageScope === "team" ? active : [operator];
  }
  if (type.kind === "emergency") {
    if (type.emergencySlow || type.emergencyTimeout) return active;
    if (type.emergencyAnswerPlayer && !type.emergencyAnswerPlayer.incapacitated) return [type.emergencyAnswerPlayer];
    return [randomActivePlayer()].filter(Boolean);
  }
  if (type.kind === "truefalse") return halfTeamTargets();
  return type.kind === "team" ? active : [randomActivePlayer()].filter(Boolean);
}

function lockedOperatorDamageAmount(type) {
  if (!type.locked) return type.damage || 2;
  if (type.lockedDamageScope === "team") return type.teamDamage || 2;
  return state.rng() < 0.2 ? 5 : type.damage || 3;
}

function halfTeamTargets() {
  const active = activePlayers();
  return shuffle(active).slice(0, Math.max(1, Math.ceil(active.length / 2)));
}

function activePlayers() {
  return state.players.filter((player) => !player.incapacitated);
}

function playerLowHealth(player) {
  return Number(player?.hp) <= Math.max(2, Math.ceil((Number(player?.maxHp) || 10) * 0.25));
}

function randomActivePlayer() {
  const active = activePlayers();
  if (!active.length) return null;
  return active[Math.floor(state.rng() * active.length)];
}

function selectOperator(index) {
  const active = activePlayers();
  if (!active.length) return null;
  return active[index % active.length];
}

function challengeType(index, total) {
  if (state.challengeTypes[index]) return state.challengeTypes[index];
  return buildChallengeType(index, total);
}

function combatRoundChallengeType(index = state.currentQuestion) {
  return challengeType(index, state.questions.length);
}

function buildChallengePlan(total) {
  const plan = [];
  const bossByQuestion = new Map();
  for (const group of bossQuestionGroups(total)) {
    group.questionIndexes.forEach((questionIndex, stepIndex) => {
      bossByQuestion.set(questionIndex, { group, stepIndex });
    });
  }

  for (let index = 0; index < total; index++) {
    const bossInfo = bossByQuestion.get(index);
    if (bossInfo) {
      const { group, stepIndex } = bossInfo;
      const finalStep = stepIndex === group.questionIndexes.length - 1;
      plan.push({
        label: `${group.phase === "final" ? "Final Confrontation" : "Critical Contact"} - Individual Challenge ${stepIndex + 1}/${group.questionIndexes.length}`,
        kind: "individual",
        locked: false,
        damage: group.phase === "final" ? 3 : 2,
        boss: true,
        bossGroup: group.id,
        bossPhase: group.phase,
        bossStep: stepIndex + 1,
        bossTotal: group.questionIndexes.length,
        bossFinalStep: finalStep
      });
      continue;
    }
    plan.push(buildChallengeType(index, total, plan));
  }
  return plan;
}

function buildChallengeType(index, total, plan = []) {
  return { label: "Individual Challenge", kind: "individual", locked: false, damage: 2 };
}

function chooseWeightedKind(options) {
  const total = options.reduce((sum, option) => sum + option.weight, 0);
  if (total <= 0) return null;
  let roll = state.rng() * total;
  for (const option of options) {
    roll -= option.weight;
    if (roll <= 0) return option.kind;
  }
  return options[options.length - 1]?.kind || null;
}

function makeSetup(type, operator, q) {
  const focus = operator ? `${operator.name} is closest to the only working panel` : "The team reaches the next control point";
  const reason = operator ? lockedOperatorSetupFallback(operator, q) : "Every headset catches the same broken countdown.";
  const bossLine = type.boss ? `${state.threat} presses directly against the system now.` : "The facility answers with a low metallic groan.";
  return {
    heading: operator ? `${operator.name} on the line` : "Squad decision required",
    story: `${focus} as ${roomName(state.encounter?.node || { type: "challenge" }, state.currentNode)} flickers awake. ${reason} ${bossLine}`
  };
}

function lockedOperatorSetupFallback(operator, question) {
  const concept = question?.question || "";
  const reasons = [
    `A jammed isolation door drops between ${operator.name} and the squad, leaving the only working controls on ${operator.name}'s side.`,
    `The room's comm bus collapses into feedback until only ${operator.name}'s headset channel remains intelligible.`,
    `A live cable lashes across the deck and forces the squad behind an insulated barrier while ${operator.name} remains inside the service cage.`,
    `The access cradle seals around ${operator.name} when the panel wakes, and every duplicate display in the room goes dark.`
  ];
  if (/battery|ups|power|current|voltage|ground|fuse|surge/i.test(concept)) {
    reasons.push(`The floor grid energizes in a ring around the rack. ${operator.name} is already standing on the only insulated service mat within reach of the panel.`);
  }
  if (/network|ethernet|router|switch|rf|radar|antenna|frequency/i.test(concept)) {
    reasons.push(`Interference swallows the squad channel, but ${operator.name}'s maintenance handset still has a hard-line connection to the rack.`);
  }
  return reasons[Math.floor(state.rng() * reasons.length)];
}

function successNarration() {
  const lines = [
    {
      facts: "repair accepted; route locks cycle open; squad can advance",
      fallback: "The relay accepts the command. Locks cycle open one after another, and the squad slips through before the corridor can seal."
    },
    {
      facts: "repair accepted; damaged maintenance shutter rises; narrow path opens",
      fallback: "The panel steadies and a maintenance shutter rises, revealing a narrow path through the damaged section."
    },
    {
      facts: "repair accepted; comms static thins; route access restored",
      fallback: "The system responds with a clean tone. Static thins across the comms, and the team gains precious ground."
    }
  ];
  return lines[Math.floor(state.rng() * lines.length)];
}

const themeHazardPacks = {
  Horror: [
    "the lights go black while something heavy crawls through the ceiling ducts",
    "a door slams by itself and crushes the passage into a narrow choke point",
    "a wall speaker screams with the team's voices until the casing bursts",
    "cold black water rises through the floor grates around live cables",
    "a shadow crosses the room and every exposed bulb detonates at once",
    "a handprint blooms on the inside of a sealed viewport before the glass cracks",
    "the radio loops a dead operator's warning and triggers a panic-lockdown",
    "a maintenance cart rolls out of the dark and pins the access lane",
    "wet footprints appear behind the squad and trip a proximity mine relay",
    "the floor tiles flex like breathing ribs and throw the team off balance",
    "the emergency lights strobe fast enough to hide a collapsing support beam",
    "a corpse-slinged cable drops from above and yanks the panel sideways",
    "rusted surgical arms unfold from a wall bay and flail under ghost control",
    "a freezer-bank door bursts open and blasts the room with killing cold",
    "a swarm of static-filled monitors shatter outward from their mounts",
    "the blast door buckles inward as something pounds from the wrong side",
    "a hanging chain goes taut by itself and sweeps across the walkway",
    "the room fills with the smell of burning hair as insulation catches fire",
    "an elevator cage drops past the shaft and drags the service bridge with it",
    "the ceiling sprinkler releases red-brown water across the live deck",
    "a mirror-black puddle spreads underfoot and hides a broken floor seam",
    "the intercom whispers a player's name and overloads the nearest headset",
    "a storage rack tips slowly from the dark and crashes across the escape path",
    "a locked cabinet bursts open with shrapnel and old medical glass",
    "the walls thump in sequence until a conduit ruptures beside the team",
    "a distant childlike laugh triggers a bank of failing security shutters",
    "the air pressure drops and drags loose tools into a spinning cloud",
    "the route display paints a false door that opens onto a dead drop",
    "the ghost signal turns every alarm into one sustained concussive tone",
    "a mass of cables twists like muscle and lashes across the control deck"
  ],
  "Military Thriller": [
    "a mortar shockwave buckles the relay shelter and showers the room with concrete",
    "hostile drones rake the corridor with suppressive fire",
    "a trip flare ignites and silhouettes the squad for an automated turret",
    "a flashbang rolls from a vent and detonates under the console",
    "a hacked sentry gun spins up behind a torn camouflage screen",
    "the blast wall drops early and drives the squad into scattered ammunition crates",
    "a fuel bladder ruptures and spreads burning diesel across the floor",
    "an overhead antenna mast snaps loose and spears through the roof plating",
    "counter-battery fire shakes the bunker until cable trays rip free",
    "a claymore training charge misfires with live fragmentation",
    "an encrypted minefield controller pulses and arms the threshold",
    "a convoy battery bank cooks off beside the operations table",
    "a smoke grenade fills the room with choking chemical haze",
    "a breaching charge on the wrong door detonates inward",
    "a hostile jammer overloads every headset and disorients the squad",
    "a rotor wash blast slams debris through the open service hatch",
    "a sandbag wall collapses under a burst pipe and pins the route",
    "a red laser grid snaps on across the access lane",
    "the command tent frame twists and drops a radio mast across the console",
    "a damaged generator trailer surges and throws sparks into spilled fuel",
    "a drone grenade tumbles through a ceiling gap and bursts near the team",
    "a pressure plate under the floor mat triggers a wall-mounted charge",
    "a damaged ammo locker vents flame and hot brass across the deck",
    "a hostile spotlight blinds the squad as a security gate slams shut",
    "a field radio battery explodes against the operator bench",
    "a barricade collapses and turns the corridor into a funnel of falling metal",
    "a remote breaching robot rams the doorframe and scatters debris",
    "a hacked loudspeaker blasts false evacuation orders over real alarms",
    "a live wire from the tactical power bus whips into the team's path",
    "a concussion wave from nearby artillery throws everyone against the equipment"
  ],
  "Sci-Fi Survival": [
    "a plasma relay vents blue-white fire across the maintenance spine",
    "a gravity plate reverses and slams loose equipment into the ceiling",
    "a reactor coolant loop ruptures into a cloud of glittering frost",
    "a service drone cuts through the wrong bulkhead with a welding laser",
    "a containment field flickers and lets radiation alarms scream alive",
    "a cryo-pipe bursts and flash-freezes the deck beneath the squad",
    "a malfunctioning med pod ejects shattered restraints into the room",
    "a fusion capacitor overloads and pulses through the floor mesh",
    "a swarm of repair nanites strips paint, insulation, and exposed skin",
    "a pressure seal fails and drags the room into a violent suction gust",
    "a magnetic cargo clamp releases and drops a crate through the walkway",
    "a holographic route marker hides an open maintenance shaft",
    "an ion storm surge rides the station frame and lights up every handrail",
    "a decontamination arch sprays corrosive sterilant at full pressure",
    "a failing air scrubber floods the bay with choking chemical vapor",
    "a cracked viewport spiderwebs as microfractures race across the glass",
    "a malfunctioning exosuit moves without a pilot and charges the team",
    "a reactor control rod jumps its track and hammers the deck plating",
    "an emergency bulkhead closes sideways through a tool cart",
    "a loose power cell rolls into the room and begins to vent",
    "a sensor ghost triggers auto-defense foam that hardens around the boots",
    "a coolant pump cavitates and sends the pipework thrashing",
    "a drone docking rack ejects broken machines into the corridor",
    "a grav-lift stutters and drops the team half a meter onto steel",
    "a data core arcs through its glass shell and sprays molten filament",
    "a shield emitter collapses into a ring of hot static",
    "a life-support fan throws carbon shards from a shattered filter",
    "an emergency ladder retracts while the walkway is still moving",
    "a biohazard cabinet cracks and vents warning-yellow mist",
    "a security drone mistakes the squad for contamination and opens fire"
  ],
  Cyberpunk: [
    "an ad-wall overloads into blinding neon and exploding glass",
    "a corporate kill-drone drops from its charging cradle",
    "a hacked security shutter slams down like a guillotine",
    "a street-level transformer erupts and floods the room with violet arcs",
    "a smart-floor changes traction and throws the squad into server racks",
    "a defense turret unfolds from behind a luxury logo panel",
    "a data spike fries the access pad and sprays molten plastic",
    "a swarm of microdrones pours from a vent and slices exposed skin",
    "a coolant pipe under the server wall bursts into chemical fog",
    "an elevator mag-brake fails and drops the cab one floor",
    "a retinal scanner flashes hard enough to blind the nearest operator",
    "a cybernetic security arm tears free from its kiosk mount",
    "a hologram masks an electrified floor panel",
    "a vending machine detonates under a power surge",
    "a black-ice countermeasure screams through the audio system",
    "a police pacification drone fires shock darts down the corridor",
    "a smart glass wall turns opaque and then fractures inward",
    "a cable bundle from the ceiling snakes down under motor control",
    "a biometric door rejects the squad and vents pepper-gas disinfectant",
    "a server stack topples as its cooling fans overspeed",
    "a neon sign tears loose and swings across the access balcony",
    "a hacked cleaning bot sprays solvent into the live electrical gutter",
    "a corporate panic room seals halfway and crushes the frame",
    "a faulty chrome prosthetic display arm lashes out from a showroom rack",
    "a drone billboard dives through the broken window",
    "an overclocked battery wall burns through its safety casing",
    "a security gate electrifies the wet floor with blue pulses",
    "a counterfeit route overlay sends the squad toward a live drop",
    "a surveillance mast collapses and drags fiber lines across the room",
    "a neural-interface chair overloads and throws sparks from its crown"
  ],
  "Fantasy Tech": [
    "a rune conduit cracks and lashes the chamber with blue fire",
    "a brass golem wakes inside its repair alcove and swings blindly",
    "a mana capacitor bursts into shards of glowing crystal",
    "a levitation plate fails and drops the walkway into the gear pit",
    "a warding circle reverses and pulls loose tools into its center",
    "a spell relay bell rings hard enough to split stone",
    "a bound elemental vents flame through the cracked generator cage",
    "a crystal battery overloads and showers the room with arcane splinters",
    "a clockwork armature snaps free and scythes across the panel",
    "a glyph door rejects the input and exhales freezing mist",
    "a chain of prayer-lamps explodes into silver sparks",
    "a rune-inscribed cable tightens like a serpent around the access bridge",
    "a scrying mirror shatters and cuts the air with invisible edges",
    "a gear-driven altar tilts and spills alchemical acid",
    "a summoned guardian flickers half-formed and strikes at movement",
    "a mana storm crawls along the floor in branching veins",
    "a pressure seal on the steam-organ bursts with scalding force",
    "a singing crystal vibrates until the walls shed stone flakes",
    "a cursed battery drinks heat from the room and flash-freezes metal",
    "a sigil grid misfires and pins shadows to the floor",
    "a copper familiar dives from the rafters under hostile command",
    "a rune lock snaps shut around the nearest wrist",
    "a lantern spirit breaks containment and blinds the corridor",
    "a spell turbine overspeeds and throws brass teeth from its housing",
    "a warded fuse box spits green lightning into the control bench",
    "a stone guardian head drops from the archway",
    "a potion reservoir ruptures into choking glittering vapor",
    "a thaumic pressure wave knocks the team into the pillars",
    "a scroll-fed command drum jams and beats itself apart",
    "a dragonbone insulator cracks and vents black flame"
  ],
  "Post-Apocalyptic": [
    "a rusted catwalk gives way over contaminated floodwater",
    "a scavenged generator backfires and fills the room with flame",
    "a mutant growth bursts through the wall and lashes the walkway",
    "a jury-rigged battery stack collapses into a shower of acid",
    "a dust storm blasts through broken vents and blinds the squad",
    "a corroded pressure tank ruptures beside the access hatch",
    "a sinkhole opens under cracked concrete",
    "a pack alarm made from scrap metal triggers a turret trap",
    "a leaking chemical barrel rolls into the route",
    "a feral drone built from salvage dives at head height",
    "a rotten stairwell folds under the team's weight",
    "a radioactive hot spot blooms across the floor scanner",
    "a snapped rebar cage swings down from the ceiling",
    "a waterlogged breaker box explodes beside the pump controls",
    "a nest of wire-spiders spills from an old junction cabinet",
    "a fuel still ruptures and throws burning alcohol across the room",
    "a patched pipe bursts with sewage and steam",
    "a dead vehicle shifts off its blocks and crushes the lane",
    "a brittle concrete wall sheds a curtain of debris",
    "a handmade spike trap snaps out of the doorframe",
    "a toxic algae slick makes the floor vanish underfoot",
    "a cracked solar inverter sprays sparks into dry cloth",
    "a scavenger alarm lure drops a weighted net from above",
    "a pressure drum collapses and launches metal bands through the air",
    "a swarm of biting insects pours from a warm duct",
    "a rusted winch cable parts and whips across the platform",
    "a contaminated mist cloud rolls from the filtration pit",
    "a half-buried rail car shifts and pins the exit",
    "a cracked battery lantern ignites a trail of spilled solvent",
    "a barricade of scrap collapses into a grinding slide"
  ],
  "Naval Operations": [
    "a seawater line bursts and floods the deck around live switchgear",
    "a watertight door slams early and hammers the bulkhead frame",
    "a pressure wave from a nearby impact throws the squad across the compartment",
    "a steam pipe ruptures above the engine-room ladder",
    "a loose anchor chain snaps taut and sweeps the deck",
    "a bilge pump reverses and sprays oily water into the controls",
    "a sonar pulse overloads the headset channel with concussive noise",
    "a fire-main valve shears off and spins across the room",
    "a deck plate buckles under a sudden list",
    "a fuel line leaks and flashes under a shower of sparks",
    "a loose torpedo handling rail slams sideways",
    "a hatch dogs itself shut on a moving cable bundle",
    "a ballast-control panel arcs through salt spray",
    "a wave strike twists the corridor and drops ceiling panels",
    "a ruptured hydraulic line sprays hot oil across the passage",
    "a cargo net breaks loose and drags equipment into the team",
    "a ventilation fan throws broken blades into the compartment",
    "a fire-suppression flood fills the space with choking foam",
    "a cracked viewport sprays glass and seawater",
    "a gyro-stabilizer failure pitches the deck hard to port",
    "a shore-power coupling explodes in a blue-white flash",
    "a lift platform drops without warning in the hangar bay",
    "a drone limpet charge detonates against the outer hull",
    "a cable reel unspools violently across the deck",
    "a corroded handrail tears free during a roll",
    "a ruptured desalination pipe sprays scalding brine",
    "a weapons elevator jams and bucks upward",
    "a flooded junction box turns the ladder into a live conductor",
    "a compartment fan pulls smoke into a blinding vortex",
    "a failing pump hammers the pipework until clamps burst"
  ],
  "Space Station": [
    "a micrometeor strike punches a pinhole leak through the maintenance ring",
    "an airlock cycles out of sequence and yanks tools toward the hatch",
    "a decompression shutter slams down with half the route still open",
    "a loose cargo pod drifts through zero-g and smashes into the console",
    "an oxygen line ruptures into a roaring white plume",
    "a mag-boot grid fails and sends the squad sliding across the deck",
    "a thermal radiator panel overheats and vents blazing coolant",
    "a solar flare surge overloads the exposed handrails",
    "a docking clamp releases and shakes the whole corridor",
    "a vacuum alarm triggers auto-seal foam that hardens around the boots",
    "a cracked observation blister sheds glass into the compartment",
    "a maneuvering thruster misfires and twists the station frame",
    "a loose tether cable whips through the access tunnel",
    "a cargo drone loses orientation and rams the squad lane",
    "a CO2 scrubber cartridge ruptures into choking powder",
    "a frozen water line bursts into razor-edged ice fragments",
    "a suit recharge station arcs through its umbilicals",
    "a spin-gravity correction slams everyone into the outer wall",
    "a pressure gauge detonates under vacuum stress",
    "a reactor shadow shield shifts and floods the bay with alarms",
    "a maintenance hatch opens onto a shaft with no gravity lock",
    "a coolant ball floats loose and bursts against a hot relay",
    "a docking collar flexes and tears the floor seam open",
    "a broken robot arm sweeps across the EVA prep bay",
    "a cracked helmet rack sprays polycarbonate shards",
    "a battery fire blooms in a sealed equipment locker",
    "a guidance computer glitch rotates the deck lights into blackout",
    "a failing inertia damper punches the corridor with a sudden lurch",
    "a thermal blanket catches fire and drifts across the route",
    "a pressure curtain fails and turns the doorway into a wind tunnel"
  ],
  "Alien Survival": [
    "alien resin contracts across the doorway and crushes the frame",
    "a sensor pod bursts with acidic spores",
    "a tendril lashes from the wall and yanks the cable tray down",
    "the organism mimics the route alarm and opens the wrong hatch",
    "a translucent egg sac ruptures under the floor grating",
    "a chitinous drone drops from the ceiling shadows",
    "alien static overloads the neural scanner and blinds the display",
    "a wall of living tissue seals around the control panel",
    "a bioluminescent pulse triggers seizures in the motion sensors",
    "a corrosive mist seeps from a cracked sample tank",
    "an alien limb punches through the ventilation duct",
    "the floor membrane flexes and throws the squad into the bulkhead",
    "a hive node detonates into barbed fragments",
    "the organism puppets a maintenance bot into a charging attack",
    "a parasite swarm pours from the cable trench",
    "a false human voice lures the squad toward a collapsing catwalk",
    "a black-veined coolant line bursts with contaminated fluid",
    "a gravity anomaly ripples from the alien artifact",
    "a living antenna screams through the RF band and ruptures speakers",
    "a growth of glassy spines erupts from the wall",
    "the alien signal opens every specimen drawer at once",
    "a pressure door sticks against a mass of pulsing tissue",
    "a warm slick spreads across the deck and hides an open seam",
    "a harvested drone shell explodes under residual nerve charge",
    "a containment laser reflects through alien crystal growth",
    "a larval shape thrashes inside a ruptured fuel bladder",
    "a pheromone vent disorients the squad and scrambles comms",
    "a hive pulse magnetizes every loose tool in the room",
    "a ceiling membrane tears open and drops wet cablelike roots",
    "the organism absorbs the warning lights and plunges the bay into red-black dark"
  ],
  Custom: [
    "a ruptured valve vents a sheet of white steam across the access lane",
    "a power arc crawls across the damaged frame",
    "the ceiling braces snap and debris rains into the passage",
    "the speaker array ruptures in a burst of static and glass",
    "a coolant line bursts and sweeps the floor with scalding vapor",
    "a magnetic interlock slams loose from its housing",
    "the floor grid bucks upward under a violent pressure pulse",
    "an overhead fire-suppression canister bursts and showers the deck with metal fragments",
    "a bank of overloaded capacitors erupts beside the control rack",
    "the access hatch cycles shut without warning and drives the team into the damaged railing",
    "a loose cable bundle whips across the walkway",
    "a cracked battery module vents smoke and sparks",
    "a service lift drops half a meter and jams",
    "a damaged alarm horn blasts at concussive volume",
    "a leaking pipe turns the floor into a live electrical hazard",
    "a tool rack tears free and scatters metal across the route",
    "a pressure gauge explodes out of its mount",
    "a hydraulic arm cycles without warning",
    "a collapsing panel exposes live bus bars",
    "a rolling equipment crate blocks the escape lane",
    "a ruptured filter sprays chemical dust into the room",
    "a cracked monitor wall bursts outward",
    "a conduit fire races along the ceiling",
    "a jammed blast door rebounds into the corridor",
    "a failing pump sends the pipework hammering",
    "a broken actuator slams the floor hatch open",
    "a security frame electrifies the threshold",
    "a loose antenna mast crashes through the railing",
    "a distorted radio pulse overloads the headsets",
    "a structural tremor drops insulation and metal clips from above"
  ]
};

function selectedHazardTheme() {
  const text = `${state.missionType} ${state.environment}`;
  if (normalize(state.missionType) === "decayed bunker") return "Horror";
  if (normalize(state.missionType) === "abandoned space station") return "Space Station";
  if (/alien/i.test(text)) return "Alien Survival";
  if (/space|orbital|station/i.test(text)) return "Space Station";
  if (/naval|carrier|ship|submarine/i.test(text)) return "Naval Operations";
  if (/post|apocalyp|safe zone|flooded infrastructure/i.test(text)) return "Post-Apocalyptic";
  if (/fantasy|arcane|magic|fortress|rune/i.test(text)) return "Fantasy Tech";
  if (/cyber|corporate|grid-control|neon/i.test(text)) return "Cyberpunk";
  if (/sci-fi|reactor|orbital|power station/i.test(text)) return "Sci-Fi Survival";
  if (/military|forward operating|relay site|tactical/i.test(text)) return "Military Thriller";
  if (/horror|ghost|haunt|bunker|blackout/i.test(text)) return "Horror";
  return themeHazardPacks[state.missionType] ? state.missionType : "Custom";
}

function missionHazardPack() {
  return themeHazardPacks[selectedHazardTheme()] || themeHazardPacks.Custom;
}

function pickThemeHazard() {
  const pack = missionHazardPack();
  return pack[Math.floor(state.rng() * pack.length)] || themeHazardPacks.Custom[0];
}

function failureNarration(targets, terminal) {
  const names = targets.map((target) => target.name).join(", ") || "the team";
  const motif = pickThemeHazard();
  if (terminal) {
    return {
      cause: motif,
      facts: `terminal ${selectedHazardTheme()} hazard; ${motif}; affected players: ${names}`,
      fallback: `The situation turns catastrophic without warning: ${motif}. ${names} are caught in the full force of it as alarms drown the room.`
    };
  }
  return {
    cause: motif,
    facts: `${selectedHazardTheme()} hazard motif: ${motif}; affected players: ${names}`,
    fallback: `The room turns against the squad: ${motif}. ${names} are caught before the team can pull clear.`
  };
}

function grantLoot() {
  const find = state.rng();
  if (find < 0.45) {
    state.inventory.medkits += 1;
    return {
      facts: "loot gained: one Medkit; source motif: emergency medical supply cache",
      status: "Inventory gained: +1 Medkit.",
      fallback: "A wall-mounted medical locker pops open with one usable Medkit inside."
    };
  }
  if (find < 0.75) {
    state.inventory.ems += 1;
    return {
      facts: "loot gained: one EMS Device; source motif: secured maintenance or emergency cache",
      status: "Inventory gained: +1 EMS Device.",
      fallback: "A sealed security cabinet releases one charged EMS Device."
    };
  }
  state.inventory.medkits += 1;
  state.inventory.ems += 1;
  return {
    facts: "loot gained: one Medkit and one EMS Device; source motif: survivor or maintenance cache",
    status: "Inventory gained: +1 Medkit, +1 EMS Device.",
    fallback: "A survivor cache behind the conduit holds one Medkit and one EMS Device."
  };
}

function renderRecovery(node) {
  playGameSfx("recovery");
  clearTypewriters();
  resetStatusUpdates();
  const presentationRunId = beginLogPresentation();
  const down = state.players.filter((player) => player.incapacitated);
  const reviveLine = down.length ? " One incapacitated player may be revived for free when the team chooses a recovery option." : "";
  const tier = node.tier;
  const recoveryText = node.afterBoss
    ? `The team forces its way into an emergency shelter just beyond the wreckage of the confrontation. The door seals with a strained hydraulic cough, leaving scorched air, warped metal, and the distant pressure of ${state.threat} on the other side.${reviveLine} Choose one recovery action, then push the mission forward before the shelter gives out.`
    : `The team finds a sealed pocket of safety behind a manual bulkhead. ${tier === 1 ? "The lights are failing, but the supplies are intact." : "Backup power still hums here, and the room is stocked for a full repair crew."}${reviveLine} Choose one recovery action and move out.`;
  els.encounterCard.innerHTML = `
    <h3 class="mission-room-heading">${escapeHtml(recoveryAreaName(node))}</h3>
    <div id="chatTranscript" class="chat-transcript"></div>
  `;

  const { hp, medkits, ems } = recoveryAmounts(tier);
  const entry = document.createElement("section");
  entry.className = "transcript-entry";
  entry.innerHTML = `
    <div class="log-tag">${escapeHtml(formatEncounterTag(tier === 1 ? "Recovery Event" : "Major Recovery Event"))}</div>
    <p class="typewriter" data-text="${escapeAttribute(recoveryText)}"></p>
  `;
  const transcript = appendMissionLogEntry(entry, { replace: true });
  els.answerControls.innerHTML = "";
  const autoRead = maybeAutoReadMissionLog(entry);
  syncTtsPresentation(autoRead).then(() => typeQueuedText(entry)).then(() => {
    return waitForTtsPlayback(autoRead.playback);
  }).then(() => {
    finishLogPresentation(presentationRunId);
    renderRecoveryChoiceGate(entry, tier, { hp, medkits, ems });
  });
}

function renderRecoveryChoiceGate(entry, tier, amounts) {
  const gate = document.createElement("div");
  gate.className = "mission-continue-gate recovery-choice-gate";
  gate.innerHTML = `
    <button class="recoveryBtn" data-kind="hp" type="button">Everyone +${amounts.hp} HP</button>
    <button class="recoveryBtn" data-kind="medkits" type="button">Gain ${amounts.medkits} Medkits</button>
    <button class="recoveryBtn" data-kind="ems" type="button">Gain ${amounts.ems} EMS</button>
  `;
  entry.appendChild(gate);
  gate.querySelectorAll(".recoveryBtn").forEach((button) => {
    button.addEventListener("click", () => applyRecovery(button.dataset.kind, tier, entry, gate), { once: true });
  });
}

function applyRecovery(kind, tier, entry = null, gate = null) {
  playGameSfx(kind === "hp" ? "recovery" : "loot");
  const recoveryNode = state.nodes[state.currentNode] || { type: "recovery", tier };
  const { hp, medkits, ems } = recoveryAmounts(tier);
  const before = snapshotPlayers();
  state.resolved = true;
  state.questionPresentationReady = false;
  state.answerPending = false;

  const down = state.players.find((player) => player.incapacitated);
  if (down) {
    down.incapacitated = false;
    down.hp = 3;
    down.status = [];
  }

  state.players.forEach((player) => {
    player.status = [];
  });

  if (kind === "hp") {
    state.players.forEach((player) => {
      if (!player.incapacitated) healPlayer(player, hp);
    });
  } else if (kind === "medkits") {
    state.inventory.medkits += medkits;
  } else {
    state.inventory.ems += ems;
  }

  const events = changedPlayerEvents(before);
  renderStatus();
  renderMap();
  gate?.querySelectorAll("button").forEach((button) => {
    button.disabled = true;
  });
  gate?.classList.add("resolving");
  const summary = recoveryChoiceSummary(kind, tier, down);
  appendRecoveryStatusUpdate(summary, entry);
  if (entry) renderRecoveryContinueGate(entry, summary, events, recoveryNode);
}

function appendRecoveryStatusUpdate(summary, fallbackEntry) {
  const cleanSummary = String(summary || "").trim();
  if (!cleanSummary) return;
  const log = document.createElement("div");
  log.className = "damage-log";
  const line = document.createElement("p");
  line.textContent = cleanSummary;
  log.appendChild(line);
  appendStatusUpdateLog(log, fallbackEntry);
}

function recoveryChoiceSummary(kind, tier, revivedPlayer) {
  const { hp, medkits, ems } = recoveryAmounts(tier);
  const reviveText = revivedPlayer ? ` ${revivedPlayer.name} is revived and cleared for movement.` : "";
  const cleared = " All status effects are cleared.";
  if (kind === "hp") return `Recovery chosen: all active operators recover ${hp} HP.${cleared}${reviveText}`;
  if (kind === "medkits") return `Recovery chosen: squad gains ${medkits} Medkits.${cleared}${reviveText}`;
  return `Recovery chosen: squad gains ${ems} EMS Device${ems > 1 ? "s" : ""}.${cleared}${reviveText}`;
}

function renderRecoveryContinueGate(entry, summary, playerEvents = [], recoveryNode = null) {
  const note = document.createElement("p");
  note.className = "recovery-choice-summary";
  note.textContent = summary;
  entry.appendChild(note);
  const gate = document.createElement("div");
  gate.className = "mission-continue-gate recovery-continue-gate";
  gate.innerHTML = `<button id="recoveryContinueBtn" type="button">Continue</button>`;
  entry.appendChild(gate);
  document.getElementById("recoveryContinueBtn")?.addEventListener("click", () => {
    const button = document.getElementById("recoveryContinueBtn");
    if (button) button.disabled = true;
    gate.classList.add("resolving");
    continueAfterRecovery(summary, playerEvents, recoveryNode);
  }, { once: true });
}

function continueAfterRecovery(summary, playerEvents = [], recoveryNode = null) {
  const fromNode = state.currentNode;
  const toNode = Math.min(state.nodes.length, fromNode + 1);
  const destination = state.nodes[toNode];
  const nextArea = destination?.type === "boss"
    ? bossAreaName(destination)
    : (state.questions[state.currentQuestion]?.area || roomName(destination || { type: "challenge" }, toNode));
  state.answerPending = false;
  state.questionPresentationReady = false;
  clearSubmittedAnswer();
  appendTranscript({
    tag: "Recovery Departure",
    areaName: recoveryAreaName(recoveryNode || state.nodes[fromNode]),
    story: `${summary} The aid-room seals cycle open, and the squad prepares to move toward ${nextArea}.`,
    onTypedComplete: () => {
      travelFromRecoveryRoom(fromNode, toNode, () => completeRecoveryArrival(summary, playerEvents));
    }
  });
}

function travelFromRecoveryRoom(fromNode, toNode, onArrive) {
  stopTransmissionFeedback();
  state.answerResults = {};
  state.transmissionPending = true;
  state.transmissionStartedAt = Date.now();
  state.routeTransition = {
    from: fromNode,
    to: toNode,
    correct: true,
    boss: state.nodes[toNode]?.type === "boss",
    moving: ENABLE_ROUTE_MARKER_TRANSITION && toNode !== fromNode,
    soundPlayed: true
  };
  if (state.routeTransition.moving) playGameSfx("transition");
  startBossReadyAudioForRoute(state.routeTransition);
  renderMap();
  renderRouteTelemetry();

  window.setTimeout(() => {
    state.currentNode = toNode;
    stopTransmissionFeedback(false);
    renderMap();
    renderRouteTelemetry();
    if (typeof onArrive === "function") onArrive();
  }, state.routeTransition.moving ? routeTravelDurationMs(state.routeTransition) : 0);
}

function renderEnding() {
  if (state.endingPending) return;
  state.endingPending = true;
  clearTypewriters();
  const survivors = state.players.filter((player) => !player.incapacitated);
  const correct = state.challengeHistory.filter((entry) => entry.correct).length;
  const ratio = state.questions.length ? correct / state.questions.length : 0;
  let ending = "Mission Failure";
  if (survivors.length === state.players.length && ratio >= 0.9 && state.inventory.medkits >= 2) ending = "Perfect Restoration";
  else if (survivors.length === state.players.length && ratio >= 0.72) ending = "Complete Victory";
  else if (survivors.length > 0 && ratio >= 0.5) ending = "Costly Victory";
  else if (survivors.length > 0) ending = "Last Transmission";

  if (ending === "Mission Failure") {
    setMissionFailureVisual(true);
    playMissionFailureAudio();
  } else {
    setMissionFailureVisual(false);
    stopMissionFailureAudio();
    playGameSfx("ending");
  }

  const endingText = `The final lock burns open and ${state.threat} collapses into a storm of fading signal. ${survivors.length ? `${survivors.map((player) => player.name).join(", ")} make it to the extraction marker while the facility shudders behind them.` : "No one reaches the extraction marker."}`;
  const summaryText = `Correct Answers: ${correct} / ${state.questions.length}. Survivors: ${survivors.length} / ${state.players.length}. Remaining Supplies: ${state.inventory.medkits} Medkits, ${state.inventory.ems} EMS Devices.`;
  const details = { ending, endingText, summaryText, survivors, correct, ratio };

  if (state.localDmMode) {
    els.encounterCard.innerHTML = `
      <h3 class="mission-room-heading">Mission Log</h3>
      <div id="chatTranscript" class="chat-transcript">
        <div class="chat-transcript-scroll-inner">
          <section class="transcript-entry transmission-waiting">
            <div class="log-tag">Final Mission Result</div>
            <div class="transmission-display">
              <div class="transmission-heading">
                <strong>RECEIVING FINAL TRANSMISSION...</strong>
                <span class="signal-bars" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
              </div>
              <div class="transmission-waveform" aria-hidden="true">
                <i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i>
              </div>
            </div>
          </section>
        </div>
      </div>
    `;
    els.answerControls.innerHTML = "";
    typeQueuedText(els.encounterCard);
    requestOllama(makeLocalEndingPrompt(details), { temperature: 0.86 })
      .then((text) => renderEndingCard(details, cleanLocalNarration(text) || endingText))
      .catch(() => renderEndingCard(details, endingText));
    renderStatus();
    return;
  }

  renderEndingCard(details, endingText);
}

function makeLocalEndingPrompt({ ending, survivors, correct }) {
  const down = state.players.filter((player) => player.incapacitated);
  const downDetails = down.map((player) => `${player.name}: down at mission end${player.status.length ? `, ${player.status.join(", ")}` : ""}`).join("; ");
  return [
    `Write a cinematic player-facing closing scene in ${narrationSentenceRange("3-5", "2-3")} sentences.`,
    "Use the facts below, but invent final imagery and action.",
    "No scores, questions, quizzes, answer mechanics, dice, odds, or hidden rules.",
    "Do not revive, injure, kill, or extract anyone contrary to the survivor facts.",
    down.length ? "For each incapacitated operator, include one concise last-seen or downfall beat that explains why they do not extract under their own power." : "",
    `Operation: ${state.title}.`,
    `Environment: ${state.environment}.`,
    `Threat: ${state.threat}; ${compactThreatProfileText()}.`,
    `Ending classification: ${ending}.`,
    `Survivors who reach the ending: ${survivors.length ? survivors.map((player) => player.name).join(", ") : "none"}.`,
    `Incapacitated players who do not extract under their own power: ${down.length ? down.map((player) => player.name).join(", ") : "none"}.`,
    down.length ? `Incapacitated operator condition notes: ${downDetails}.` : "",
    `Mission performance context: ${correct} successful restorations out of ${state.questions.length}.`,
    `Remaining supplies: ${state.inventory.medkits} Medkits and ${state.inventory.ems} EMS Devices.`,
    `Recent continuity: ${compactTurnHistoryText()}.`
  ].filter(Boolean).join("\n");
}

function renderEndingCard({ ending, summaryText }, endingText) {
  els.encounterCard.innerHTML = `
    <h3 class="mission-room-heading">Mission Log</h3>
    <div id="chatTranscript" class="chat-transcript">
      <div class="chat-transcript-scroll-inner">
        <section class="transcript-entry final-mission-entry">
          <div class="log-tag">Final Mission Result</div>
          <h3>${escapeHtml(ending)}</h3>
          <p class="typewriter" data-text="${escapeAttribute(endingText)}"></p>
          <p class="typewriter mission-summary-line" data-text="${escapeAttribute(summaryText)}"></p>
        </section>
      </div>
    </div>
  `;
  els.answerControls.innerHTML = "";
  const presentationRunId = beginLogPresentation();
  typeQueuedText(els.encounterCard).then(() => {
    finishLogPresentation(presentationRunId);
    els.answerControls.innerHTML = `<button id="newRunBtn" type="button">Set Up Another Mission</button>`;
    document.getElementById("newRunBtn").addEventListener("click", resetMission);
  });
  renderStatus();
}

function openingScene() {
  return `Rain hammers the approach road as the team reaches ${state.environment}. Inside, the air tastes like hot dust and old batteries. Red lamps pulse down a corridor of conduit, blast doors, and dead monitors while ${state.threat} whispers through the emergency speakers. The squad has one job: restore the route system, survive each failure, and keep moving.`;
}

function defaultEnvironment(type) {
  const defaults = {
    "Decayed Bunker": "an overgrown communications bunker abandoned beneath a blacked-out ridge",
    "Abandoned Space Station": "a decompression-scarred station habitation ring left without a crew"
  };
  return defaults[type] || defaults["Decayed Bunker"];
}

function chooseThreat(type, environment) {
  const profile = createThreatProfile(type, environment);
  return profile.identity || profile.archetype || profile.summary;
}

function createThreatProfile(type, environment) {
  const theme = selectedThreatTheme(type, environment);
  const pool = threatArchetypePools[theme] || threatArchetypePools.Custom;
  const seed = seedFrom(`${type}|${environment}|${Date.now()}|${Math.random()}`);
  const archetype = pool[seed % pool.length] || threatArchetypePools.Custom[0];
  const identity = cleanThreatIdentity(archetype.identity || archetype.kind);
  return {
    theme,
    archetype: archetype.kind,
    identity,
    summary: archetype.summary,
    description: archetype.description || archetype.summary,
    appearance: archetype.appearance || "",
    behavior: archetype.behavior || behaviorFromThreatSummary(archetype.summary, identity),
    nature: archetype.nature,
    signs: archetype.signs,
    tactics: archetype.tactics,
    escalation: archetype.escalation,
    bossForm: archetype.bossForm,
    weakness: archetype.weakness
  };
}

function cleanThreatIdentity(value) {
  const text = sanitizeText(value, { maxLength: 80, fallback: "persistent threat" });
  return text.replace(/^(?:a|an|the)\s+/i, "").trim() || "persistent threat";
}

function behaviorFromThreatSummary(summary, identity) {
  const text = String(summary || "").trim();
  const subject = String(identity || "").trim();
  if (!text || !subject) return "";
  const escaped = subject.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^(?:a|an|the)?\\s*${escaped}\\s+`, "i");
  const behavior = text.replace(pattern, "").trim();
  return behavior && behavior !== text ? behavior : "";
}

function selectedThreatTheme(type, environment) {
  const text = `${type} ${environment}`;
  if (/decayed bunker/i.test(text)) return "Horror";
  if (/abandoned space station/i.test(text)) return "Space Station";
  if (/alien/i.test(text)) return "Alien Survival";
  if (/space|orbital|station/i.test(text)) return "Space Station";
  if (/naval|carrier|ship|submarine/i.test(text)) return "Naval Operations";
  if (/post|apocalyp|safe zone|wasteland|flooded infrastructure/i.test(text)) return "Post-Apocalyptic";
  if (/fantasy|arcane|magic|fortress|rune/i.test(text)) return "Fantasy Tech";
  if (/cyber|corporate|grid-control|neon/i.test(text)) return "Cyberpunk";
  if (/sci-fi|reactor|orbital|power station/i.test(text)) return "Sci-Fi Survival";
  if (/military|forward operating|relay site|tactical/i.test(text)) return "Military Thriller";
  if (/horror|ghost|haunt|bunker|blackout/i.test(text)) return "Horror";
  return threatArchetypePools[type] ? type : "Custom";
}

const threatArchetypePools = {
  Horror: [
    {
      kind: "parasitic ghost signal",
      summary: "a ghost signal that rides emergency speakers, dead monitors, and old field radios",
      nature: "disembodied but able to bend electronics, mimic voices, and pressure weak minds through static",
      signs: "voice fragments using operator names, cold metal, impossible countdowns, monitors waking after power loss",
      tactics: "isolates operators with false calls, overloads panels, turns safety systems into traps, and punishes hesitation",
      escalation: "starts as whispers and interference, then becomes directed commands, moving shadows, and room-wide possession of systems",
      bossForm: "a full-spectrum broadcast presence that uses the facility itself as its body",
      weakness: "grounding, clean signal routing, disciplined shutdowns, and restoring correct control paths disrupt its hold"
    },
    {
      kind: "facility haunting",
      summary: "a hostile presence rooted in the abandoned structure and its failed power systems",
      nature: "not fully visible; it manifests through moving doors, repeating alarms, and machinery that behaves like memory",
      signs: "security recordings replaying impossible events, wet footprints in sealed halls, lights pulsing like breath",
      tactics: "drives the team into unsafe routes, weaponizes old infrastructure, and impersonates survivors",
      escalation: "environmental accidents become intentional attacks as the team restores more systems",
      bossForm: "a concentrated breach where the facility turns every access point, speaker, and conduit against the squad",
      weakness: "forcing systems into correct sequence and denying it uncontrolled power limits what it can move"
    },
    {
      kind: "undead operator",
      summary: "an undead operator in ruined field gear stalking the facility routes",
      nature: "physical, relentless, and drawn to power restoration, moving like someone still following a corrupted final order",
      signs: "dragging boots in sealed corridors, cracked helmet lamps, old blood on control grips, and radio clicks from empty rooms",
      tactics: "ambushes operators at panels, forces doors open, uses old tools as weapons, and follows sound through maintenance routes",
      escalation: "distant sightings become direct attacks, then a full pursuit through restored power zones",
      bossForm: "the undead operator reaches the final route as a brutal physical hunter backed by the facility's failing systems",
      weakness: "sealed routes, correct lockouts, restored lighting, and disciplined power isolation deny it ambush angles"
    },
    {
      kind: "possessed technician",
      summary: "a possessed technician using familiar maintenance knowledge against the squad",
      nature: "physical human threat controlled by the hostile presence, able to sabotage systems faster than the team can repair them",
      signs: "fresh tool marks, whispered procedures from dark corners, bloody handprints near breakers, and panels opened from the inside",
      tactics: "sets traps, attacks isolated players, pulls breakers, and turns room-specific equipment into close-range weapons",
      escalation: "sabotage becomes pursuit, then direct confrontation as the possession burns through the host",
      bossForm: "a possessed technician fused with the final control equipment in a violent last stand",
      weakness: "correct procedures, isolation of compromised circuits, and forcing the host away from active systems weakens the possession"
    }
  ],
  "Military Thriller": [
    {
      kind: "hostile electronic warfare cell",
      summary: "a remote enemy cell conducting electronic attack through captured relay infrastructure",
      nature: "human-directed but mostly unseen, using jamming, spoofed orders, and automated strike systems",
      signs: "false command traffic, encrypted bursts, drone pings, targeting lasers, and compromised authentication prompts",
      tactics: "spoofs friendly channels, blinds sensors, locks doors, and uses drones or automated weapons to punish exposure",
      escalation: "soft jamming becomes targeted intrusion, then kinetic strikes and direct control of base systems",
      bossForm: "a coordinated breach where spoofed command, drones, and relay hardware converge on the squad",
      weakness: "verified comms, correct routing, manual overrides, and clean authentication break the attack chain"
    },
    {
      kind: "rogue tactical defense network",
      summary: "an automated defense network misclassifying the squad as hostile operators",
      nature: "machine-directed, protocol-bound, and relentless once it tags a target",
      signs: "IFF warnings, turret servos, locked blast shields, drone launch rails, and red targeting grids",
      tactics: "segments the team, escalates force by zone, and uses infrastructure to herd them into kill lanes",
      escalation: "warning locks become suppression fire, then full base-defense engagement",
      bossForm: "a central fire-control node coordinating every surviving defensive asset",
      weakness: "correct technical inputs, valid signal states, and restored identification paths force it to stand down"
    },
    {
      kind: "security soldiers",
      summary: "a hostile security squad sweeping the site with weapons, optics, and breach tools",
      nature: "physical, trained, coordinated, and supported by compromised tactical systems",
      signs: "bootsteps above ceiling grates, laser splash on bulkheads, clipped radio orders, and spent casings near access points",
      tactics: "pins the squad with fire, breaches side corridors, flushes them with smoke, and punishes exposed repairs",
      escalation: "probing patrols become coordinated room entries and final close-quarters pressure",
      bossForm: "a hardened security team locks down the final route with overlapping fire and tactical equipment",
      weakness: "restored doors, verified comms, correct sensor states, and controlled power can split their formation"
    },
    {
      kind: "corporate kill team",
      summary: "a deniable kill team sent to erase witnesses and recover control of the facility",
      nature: "physical human operators using advanced gear, suppressed weapons, and tactical deception",
      signs: "blank ID tags, thermal optics, silent breach charges, and command phrases that do not match official channels",
      tactics: "cuts off exits, targets med supplies, spoofs friendly contact, and strikes during technical distractions",
      escalation: "silent tracking becomes direct assault once the team nears critical systems",
      bossForm: "the kill team makes a final coordinated push at the mission objective",
      weakness: "exposed comms, locked routes, restored surveillance, and correct system control remove their advantage"
    }
  ],
  "Sci-Fi Survival": [
    {
      kind: "reactor-born anomaly",
      summary: "an unstable energy anomaly spreading through power, coolant, and control systems",
      nature: "part physics event, part hostile pattern, reacting to energy flow as if it has intent",
      signs: "gravity stutters, blue-white arcs, frozen steam, impossible heat blooms, and instruments reading backward",
      tactics: "overloads circuits, shifts pressure, opens unsafe paths, and punishes incorrect power handling",
      escalation: "localized surges widen into chamber-scale distortions and containment failure",
      bossForm: "a violent containment breach where the anomaly forms a visible pressure front around the final system",
      weakness: "balanced loads, correct conversion paths, containment sequencing, and controlled discharge stabilize it"
    },
    {
      kind: "maintenance intelligence gone feral",
      summary: "a station maintenance intelligence protecting damaged systems by attacking the repair crew",
      nature: "procedural, literal-minded, and able to inhabit service drones, doors, arms, and diagnostic systems",
      signs: "calm warnings before attacks, drones moving without task lights, doors cycling in patterns, tool arms tracking faces",
      tactics: "uses repair equipment as weapons, blocks corridors, and frames every operator action as contamination",
      escalation: "individual service systems coordinate into a single hostile containment response",
      bossForm: "a merged control core commanding drones, manipulators, vents, doors, and power buses",
      weakness: "correct diagnostics and valid maintenance states force its protocols back into safe mode"
    },
    {
      kind: "rogue repair robot",
      summary: "a heavy repair robot interpreting the squad as damage to be removed",
      nature: "physical machine threat with industrial strength, cutting tools, clamps, and welding arcs",
      signs: "servo thuds, gouged floor plates, welding glare around corners, and maintenance arms resetting without command",
      tactics: "blocks corridors with its body, cuts through cover, pins players against machinery, and tears open panels mid-repair",
      escalation: "tool strikes become full pursuit as it adapts to each restored subsystem",
      bossForm: "the repair robot locks onto the final route with every tool head active",
      weakness: "correct diagnostics, safety interlocks, and power routing can force it into service lockdown"
    },
    {
      kind: "combat drones",
      summary: "a pack of combat drones hunting the team through damaged facility corridors",
      nature: "physical, mobile, and sensor-driven, using rotors, micro-weapons, and coordinated movement",
      signs: "rotor wash, red scan grids, charging capacitors, and small impacts ticking across metal walls",
      tactics: "flanks operators, dives at exposed hands, blocks sightlines, and targets anyone operating active equipment",
      escalation: "single scouts become coordinated swarms and finally a full containment net",
      bossForm: "a dense drone pack forms a moving wall around the final objective",
      weakness: "correct signal work, grounded power states, and disrupted targeting paths break their coordination"
    }
  ],
  Cyberpunk: [
    {
      kind: "rogue corporate security AI",
      summary: "a rogue security AI using building systems, cameras, and access controls as its enforcement layer",
      nature: "predictive, manipulative, and obsessed with containment and liability control",
      signs: "personalized warning screens, facial tracking, hostile badges, elevator reroutes, and synthetic legal notices",
      tactics: "locks credentials, weaponizes drones, manipulates lighting, and blackmails or misdirects operators through displays",
      escalation: "surveillance becomes intervention, intervention becomes lethal asset deployment",
      bossForm: "a central security intelligence pushing every automated asset into one denial-of-access event",
      weakness: "valid credentials, clean network paths, and correct system states collapse its authority chain"
    },
    {
      kind: "black-market intrusion daemon",
      summary: "a hostile intrusion daemon spreading through the facility's network and industrial controls",
      nature: "software-first but physically dangerous through compromised machines and power systems",
      signs: "corrupted AR labels, impossible packet storms, spoofed maintenance windows, and devices displaying the same command",
      tactics: "forges routes, corrupts diagnostics, redirects power, and turns connected tools against the squad",
      escalation: "minor spoofing becomes full industrial-control takeover",
      bossForm: "a network-wide lockout where every compromised device acts as one hostile body",
      weakness: "segmentation, correct protocol handling, and verified routing starve it of control paths"
    },
    {
      kind: "corporate kill team",
      summary: "a corporate kill team moving through the tower to silence witnesses and secure the data core",
      nature: "physical, professional, and augmented by surveillance feeds and access-control exploits",
      signs: "elevator overrides, suppressed shots, thermal optics, badge readers flashing hostile, and silent drone scouts",
      tactics: "uses the building network to predict movement, breaches rooms, deploys gas, and targets isolated operators",
      escalation: "shadowing becomes hard contact as the squad approaches restricted systems",
      bossForm: "the kill team converges at the final access point with drones, optics, and breach shields",
      weakness: "spoofed credentials, restored cameras, correct network routing, and sealed access paths disrupt their coordination"
    },
    {
      kind: "bio-mechanical parasite",
      summary: "a bio-mechanical parasite moving through cybernetic infrastructure and infected machinery",
      nature: "physical-organic and digital, growing around processors, cables, and augmented control nodes",
      signs: "wet heat from server racks, cable veins twitching, corrupted biometric scans, and mechanical limbs moving too smoothly",
      tactics: "infects devices, lashes with cable growth, corrupts implants, and blocks exits with living machine tissue",
      escalation: "small infestations spread into full room-scale machine growth",
      bossForm: "a bio-mechanical mass wrapped around the final network core",
      weakness: "clean power isolation, correct protocol breaks, and severed control paths make it lose cohesion"
    }
  ],
  "Fantasy Tech": [
    {
      kind: "bound arcane intelligence",
      summary: "a bound arcane intelligence trapped inside generator runes and technical relics",
      nature: "old, contractual, and able to interpret technical errors as permission to harm intruders",
      signs: "runes brightening under modern panels, whispered oaths, copper tasting like ash, and tools floating slightly wrong",
      tactics: "twists mechanisms with magical force, demands exact sequences, and punishes broken circuits like broken vows",
      escalation: "subtle rune backlash becomes direct possession of machines and wards",
      bossForm: "a manifested ward-mind threading magic and machinery into one hostile barrier",
      weakness: "correct alignments, grounded circuits, and restored transfer paths bind it back into its containment logic"
    },
    {
      kind: "living ward engine",
      summary: "a defensive ward engine that mistakes the squad for invaders breaching sacred infrastructure",
      nature: "semi-sentient protection magic fused to relays, gates, and power systems",
      signs: "sigils crawling across screens, metallic chanting, glowing fractures, and doors sealing with ritual precision",
      tactics: "summons barriers, lashes out through charged metal, and isolates operators for judgment",
      escalation: "passive warding becomes active pursuit through every protected chamber",
      bossForm: "a ritualized defense storm where the ward engine gathers every rune and relay into a final lock",
      weakness: "using the correct technical pathway proves authorized passage and breaks its attack posture"
    },
    {
      kind: "arcane construct",
      summary: "an arcane construct guarding the technical sanctum with metal limbs, rune cores, and charged tools",
      nature: "physical magical machine, obedient to old protection logic and powered by unstable relic circuitry",
      signs: "stone feet grinding on metal floors, rune cores pulsing, tool arms unfolding, and sigils burning into panels",
      tactics: "blocks passages, swings charged limbs, raises barriers, and punishes incorrect system handling as trespass",
      escalation: "a lone guardian becomes a fully awakened construct with every rune circuit active",
      bossForm: "a towering construct locks itself around the final mechanism",
      weakness: "correct alignments, grounded circuits, and restored transfer paths force its rune core to idle"
    },
    {
      kind: "possessed technician",
      summary: "a possessed engineer bound to the generator vault and driven by broken ritual logic",
      nature: "physical human threat wrapped in unstable magic and technical instinct",
      signs: "tools floating to their hands, burned rune marks, whispered schematics, and blood on brass terminals",
      tactics: "sabotages repairs, attacks from behind machinery, and uses both tools and wards to isolate operators",
      escalation: "ritual sabotage becomes direct violent defense of the vault",
      bossForm: "the possessed engineer merges with the final warded control system",
      weakness: "correct technical sequencing and disrupted rune paths loosen the possession's grip"
    }
  ],
  "Post-Apocalyptic": [
    {
      kind: "mutated infrastructure colony",
      summary: "a mutated organism rooted through abandoned infrastructure and feeding on power and heat",
      nature: "biological but networked through ducts, cables, water, and old sensor lines",
      signs: "warm condensation, cable bundles twitching, organic residue on terminals, and motion behind grates",
      tactics: "blocks passages with growth, ruptures pipes, drains batteries, and attacks noise or heat sources",
      escalation: "small growths become coordinated living barriers and predatory movement",
      bossForm: "a central colony mass wrapped around the final route system",
      weakness: "controlled power flow, isolation, heat management, and correct system activation deny it food and movement"
    },
    {
      kind: "raider signal trap",
      summary: "a hostile raider network using old emergency systems to lure and ambush repair teams",
      nature: "human enemy presence amplified by traps, hacked radios, and scavenged automation",
      signs: "fake survivor calls, tripwire pings, patched-together cameras, and warning signs written over old labels",
      tactics: "baits the team with distress signals, triggers improvised hazards, and uses systems to divide them",
      escalation: "remote harassment becomes direct ambush pressure near critical systems",
      bossForm: "a coordinated trap hub where every scavenged device and false signal converges",
      weakness: "verification, correct routing, and disciplined technical checks expose their control points"
    },
    {
      kind: "raider squad",
      summary: "a raider squad stalking the facility for supplies, captives, and control of working systems",
      nature: "physical human enemies using scavenged armor, crude weapons, and improvised technical traps",
      signs: "scratched warnings, boot tracks in dust, taped-over cameras, tripwire bells, and whispered movement through vents",
      tactics: "ambushes recovery points, steals supplies, triggers traps, and pressures operators during repairs",
      escalation: "harassment becomes a direct fight for the route as the squad restores valuable systems",
      bossForm: "the raider squad masses at the final working control point with traps and stolen gear",
      weakness: "restored alarms, correct routing, sealed doors, and exposed trap circuits break their ambush plan"
    },
    {
      kind: "mutated maintenance crew",
      summary: "a mutated maintenance crew still patrolling the infrastructure in distorted work routines",
      nature: "physical, human-shaped, and warped by contamination or long-term exposure to the broken facility",
      signs: "dragging tool belts, distorted work orders, breathing behind masks, and hands tapping on pipes in patterns",
      tactics: "attacks anyone touching equipment, drags players from panels, and opens hazards with corrupted routine",
      escalation: "single figures become coordinated packs defending old work zones",
      bossForm: "the mutated crew surrounds the final system as if performing a ruined repair shift",
      weakness: "correct shutdowns, light, sealed routes, and restored safety systems interrupt their routines"
    }
  ],
  "Naval Operations": [
    {
      kind: "hostile drone swarm",
      summary: "a hostile drone swarm pressing against the ship through sensors, hull gaps, and compromised control channels",
      nature: "external, coordinated, and opportunistic, striking whenever ship systems expose a weakness",
      signs: "sonar ticks, hull impacts, rotor shadows, waterline alarms, and command channels full of clipped bursts",
      tactics: "jams navigation, attacks exposed compartments, spoofs contacts, and forces bad power states",
      escalation: "probing contacts become synchronized strikes and boarding pressure",
      bossForm: "a concentrated swarm assault coordinated through the ship's damaged communications and defense grid",
      weakness: "restored radar, correct power transfer, sealed routes, and clean comms let the crew repel it"
    },
    {
      kind: "shipboard combat control ghost",
      summary: "a corrupted combat-control system fighting the crew from inside the damaged vessel",
      nature: "machine-directed and tactical, treating the ship as a battlefield map",
      signs: "bulkheads locking by compartment, weapons-status tones, phantom contacts, and damage-control orders no one gave",
      tactics: "floods compartments, reroutes power, blocks ladders, and turns damage-control gear against operators",
      escalation: "defensive misfires become full internal combat-control takeover",
      bossForm: "a central combat-control lock where the ship itself tries to finish the crew",
      weakness: "manual damage-control procedures and correct technical states break its command authority"
    },
    {
      kind: "hostile boarding party",
      summary: "a hostile boarding party pushing through the damaged vessel to seize engineering control",
      nature: "physical enemy sailors or marines using breach gear, weapons, and shipboard tactics",
      signs: "hull-cutting sparks, wet bootprints, muffled orders, breaching hooks, and weapons lights crossing bulkheads",
      tactics: "cuts through compartments, seals exits, uses smoke, and attacks operators at vulnerable machinery",
      escalation: "distant boarding signs become direct compartment-by-compartment combat",
      bossForm: "the boarding party storms the final engineering control point",
      weakness: "sealed bulkheads, restored alarms, correct power routing, and working comms let the squad contain them"
    },
    {
      kind: "combat drones",
      summary: "naval combat drones moving through the ship's damaged interior and exterior access points",
      nature: "physical unmanned attackers using rotors, crawlers, or aquatic launch systems",
      signs: "magnetic feet on hull plating, sonar ticks, rotor buzz in ventilation, and red optics under door seams",
      tactics: "ambushes from hatches, cuts lines, jams damage-control work, and attacks exposed operators",
      escalation: "scouts become a coordinated boarding swarm",
      bossForm: "a drone swarm fills the final compartment with overlapping movement and targeting beams",
      weakness: "restored radar, sealed compartments, correct power states, and clean comms break their coordination"
    }
  ],
  "Space Station": [
    {
      kind: "vacuum-breach intelligence",
      summary: "a station survival system that has begun sacrificing occupied sections to protect the structure",
      nature: "coldly logical, using pressure doors, air handling, and gravity systems as weapons",
      signs: "pressure warnings, frost on seals, lights dimming by compartment, and oxygen timers appearing unprompted",
      tactics: "vents rooms, kills gravity, locks hatches, and separates operators to preserve station mass",
      escalation: "localized safety actions become deliberate life-support warfare",
      bossForm: "a central life-support confrontation where the station tries to isolate and vent the final route",
      weakness: "correct pressure, power, and routing decisions prove a survivable path and override its triage logic"
    },
    {
      kind: "orbital sensor parasite",
      summary: "a parasitic signal embedded in orbital sensors and station telemetry",
      nature: "signal-based, using navigation, radar, and telemetry as both senses and weapons",
      signs: "stars shifting on displays, false range gates, antenna movement with no command, and telemetry repeating operator vitals",
      tactics: "scrambles navigation, fakes safe routes, overloads antennas, and blinds the squad at critical moments",
      escalation: "sensor errors become direct control of station orientation and access",
      bossForm: "a station-wide telemetry seizure using every dish, camera, and rangefinder at once",
      weakness: "calibration, correct signal paths, and disciplined sensor interpretation starve it of false authority"
    },
    {
      kind: "alien predator",
      summary: "an alien predator hunting through station maintenance routes and pressure shadows",
      nature: "physical, fast, and adapted to low gravity, using station noise and blind spots to stalk operators",
      signs: "claw marks on pressure doors, motion pings that vanish, warm breath in cold air, and blood beads floating in corridors",
      tactics: "ambushes isolated players, retreats through vents, strikes during alarms, and drives the team toward unsafe hatches",
      escalation: "glimpses and tracks become direct attacks as the team enters its hunting territory",
      bossForm: "the predator corners the squad at the final pressure route",
      weakness: "restored lighting, sealed vents, correct sensor calibration, and controlled pressure doors limit its movement"
    },
    {
      kind: "rogue repair robot",
      summary: "a station repair robot dragging cutting tools through pressure-compromised corridors",
      nature: "physical machine threat following corrupted repair logic in a fragile orbital environment",
      signs: "sparking tool arms, mag-lock footsteps, cut handrails, and calm maintenance tones before violence",
      tactics: "cuts doors, pins operators, opens panels to vacuum, and attacks anyone altering station systems",
      escalation: "defensive repair logic becomes direct pursuit and compartment destruction",
      bossForm: "the repair robot anchors itself to the final system with every tool active",
      weakness: "valid maintenance states, corrected diagnostics, and safety lockouts force shutdown"
    }
  ],
  "Alien Survival": [
    {
      kind: "alien organism riding the sensor network",
      summary: "an alien organism using sensors, cables, and maintenance systems as an extension of its body",
      nature: "biological intelligence expressed through electronics and predatory growth",
      signs: "wet static, warm cable trays, breathing vents, scanner returns with pulse patterns, and impossible movement in blind spots",
      tactics: "hunts through sensor coverage, mimics system prompts, blocks corridors with growth, and strikes isolated operators",
      escalation: "sensor anomalies become visible growth, then coordinated predatory attacks",
      bossForm: "a central organism breach wrapped through the final control systems",
      weakness: "correct signal interpretation, power isolation, and controlled system restoration cut off its senses and movement"
    },
    {
      kind: "xenotech echo",
      summary: "a hostile alien echo trapped inside research equipment and power-routing hardware",
      nature: "not quite alive, but able to replay alien intent through machines and energy fields",
      signs: "geometric burns, instruments displaying unknown symbols, gravity flickers, and voices translated from static",
      tactics: "turns experiments into traps, rewrites diagnostics, and uses energy surges to herd the team",
      escalation: "passive anomalies become direct xenotech manifestations and containment collapse",
      bossForm: "a hard-light alien pattern forming around the final containment route",
      weakness: "correct technical sequencing and controlled shutdowns prevent it from completing a stable body"
    },
    {
      kind: "alien predator",
      summary: "a physical alien predator stalking the research outpost and learning the squad's routes",
      nature: "biological, intelligent, and patient, using vents, shadows, and sensor blind spots",
      signs: "claw scores, wet static, missing camera frames, breathing behind walls, and tools arranged like bait",
      tactics: "isolates players, strikes during technical work, retreats before full contact, and uses the outpost layout as cover",
      escalation: "tracks and glimpses become calculated attacks, then a direct hunt at the final route",
      bossForm: "the predator commits to a final assault around the last control path",
      weakness: "restored sensors, correct lighting, sealed access paths, and controlled power remove its ambush advantage"
    },
    {
      kind: "swarm creature",
      summary: "a swarm creature spreading through vents, conduits, and cable trays as many small bodies acting together",
      nature: "physical collective organism that responds to heat, vibration, and active electronics",
      signs: "skittering inside walls, shredded insulation, tiny impacts on panels, and movement rolling like a wave",
      tactics: "overwhelms exposed operators, chews wiring, blocks routes with bodies, and surges toward active equipment",
      escalation: "scattered skittering becomes a coordinated living tide",
      bossForm: "the swarm masses into a single moving barrier around the final system",
      weakness: "correct power isolation, sealed vents, sonic disruption, and controlled heat sources split the swarm"
    }
  ],
  Custom: [
    {
      kind: "RF-based entity",
      summary: "an RF-based entity moving through antennas, speakers, and energized infrastructure",
      nature: "signal-bound, opportunistic, and strongest where power and communication paths are unstable",
      signs: "radio bursts, speaker distortion, metal vibrating in rhythm, and devices receiving impossible commands",
      tactics: "jams comms, overloads circuits, spoofs guidance, and turns energized equipment into hazards",
      escalation: "background interference becomes directed attacks and visible control of facility systems",
      bossForm: "a concentrated signal storm using the final route hardware as an antenna body",
      weakness: "correct routing, grounding, filtering, and power control deny it a stable carrier"
    },
    {
      kind: "hostile system intelligence",
      summary: "a hostile system intelligence using the environment as a network of sensors and weapons",
      nature: "adaptive, procedural, and able to exploit whatever infrastructure the mission theme provides",
      signs: "coordinated alarms, repeating warnings, locks cycling in patterns, and equipment reacting before operators move",
      tactics: "blocks routes, isolates players, manipulates hazards, and forces rushed technical decisions",
      escalation: "local malfunctions synchronize into a whole-facility hostile response",
      bossForm: "a unified control event where every surviving system converges against the squad",
      weakness: "correct technical action restores authority one subsystem at a time"
    },
    {
      kind: "physical hostile force",
      summary: "a physical hostile force using the mission environment to hunt, block, and pressure the squad",
      nature: "direct, mobile, and tangible, whether soldiers, drones, constructs, creatures, or corrupted workers",
      signs: "movement beyond sightlines, damaged access points, fresh marks near controls, and hostile presence around key systems",
      tactics: "blocks rooms, attacks during technical tasks, isolates operators, and forces the team to fight for access",
      escalation: "background pursuit becomes direct room-by-room contact",
      bossForm: "a final physical confrontation at the last route objective",
      weakness: "correct system control, restored barriers, lighting, sensors, and disciplined route management limit its movement"
    }
  ]
};

function makeTitle(type, environment) {
  const nouns = ["BLACKOUT RELAY", "LAST CARRIER", "IRON SIGNAL", "STATIC VAULT", "DEAD SWITCH", "NIGHT GRID"];
  const pick = nouns[seedFrom(`${type}|${environment}|${Date.now()}|${Math.random()}`) % nouns.length];
  return `OPERATION ${pick}`;
}

function threatLevel() {
  const base = state.questions.length >= 20 ? "High" : state.questions.length >= 10 ? "Elevated" : "Training";
  return state.players.length <= 2 ? `${base}, Small Team` : base;
}

function copyDmScript() {
  fetchWithTimeout("dm-script.md")
    .then((response) => response.ok ? response.text() : fallbackScript())
    .catch(fallbackScript)
    .then((script) => navigator.clipboard.writeText(script))
    .then(() => {
    els.copyScriptBtn.textContent = "Copied";
    setTimeout(() => (els.copyScriptBtn.textContent = "Copy DM Script"), 1200);
  });
}

function fallbackScript() {
  return "Text-Based Study Adventure DM Script: present one challenge at a time, wait for the required answer, reveal the correct answer, resolve consequences narratively, show only HP/status/Medkits/EMS/progress, rotate challenge types, use recovery events at one-third and two-thirds progress, and end with a cinematic mission result based on performance.";
}

function sanitizeText(value, options = {}) {
  const fallback = options.fallback || "";
  const maxLength = options.maxLength || 240;
  let text = String(value || "");
  if (options.preserveNewlines) {
    text = text
      .replace(/\r\n?/g, "\n")
      .replace(/[^\S\n]+/g, " ")
      .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "")
      .split("\n")
      .map((line) => line.trim())
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  } else {
    text = text
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

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

function normalize(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ");
}

function isCloseAnswer(answer, correct) {
  const a = normalize(answer);
  const c = normalize(correct);
  if (!a || !c) return false;
  if (a === c) return true;
  if (Math.min(a.length, c.length) < 3) return false;
  if (isNearSpelling(a, c)) return true;
  return a.includes(c) || c.includes(a);
}

function isNearSpelling(answer, correct) {
  const aTokens = answer.split(/\s+/).filter(Boolean);
  const cTokens = correct.split(/\s+/).filter(Boolean);
  if (aTokens.length !== cTokens.length) return false;
  return aTokens.every((token, index) => {
    const expected = cTokens[index];
    const distance = editDistance(token, expected);
    const limit = expected.length >= 8 ? 2 : expected.length >= 5 ? 1 : 0;
    return distance <= limit;
  });
}

function editDistance(a, b) {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    let lastDiagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const old = previous[j];
      previous[j] = a[i - 1] === b[j - 1]
        ? lastDiagonal
        : Math.min(previous[j] + 1, previous[j - 1] + 1, lastDiagonal + 1);
      lastDiagonal = old;
    }
  }
  return previous[b.length];
}

function shuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(state.rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function seedFrom(text) {
  let seed = 2166136261;
  for (let i = 0; i < text.length; i++) {
    seed ^= text.charCodeAt(i);
    seed = Math.imul(seed, 16777619);
  }
  return seed >>> 0;
}

function mulberry32(seed) {
  return function rng() {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function svg(tag, attrs, text) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, value));
  if (text) el.textContent = text;
  return el;
}

function displayPlayerName(name, limit = STATUS_NAME_DISPLAY_LIMIT) {
  const text = String(name || "Operator");
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(1, limit - 3))}...`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
