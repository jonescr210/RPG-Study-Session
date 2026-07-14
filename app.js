const sharedData = window.StudyAdventureShared || {};
const dmPrompts = window.StudyAdventurePrompts || {};
const actionRooms = window.StudyAdventureActionRooms || {};
const ttsModule = window.StudyAdventureTts || {};
const playerSessionApi = {
  fetchHostInfo: () => fetch("/api/host-info", { cache: "no-store" }).then((response) => response.ok ? response.json() : null),
  publishSession: (payload) => fetch("/api/player-session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  }).catch(() => null),
  fetchSession: () => fetch(`/api/player-session?ts=${Date.now()}`, { cache: "no-store" }).then((response) => response.ok ? response.json() : null),
  fetchAnswers: (roomCode, promptId) => fetch(`/api/player-answers?roomCode=${encodeURIComponent(roomCode)}&promptId=${encodeURIComponent(promptId || "")}&ts=${Date.now()}`, { cache: "no-store" }).then((response) => response.ok ? response.json() : null),
  joinPlayer: (roomCode, name, options = {}) => fetch("/api/player-join", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ roomCode, name, simulated: Boolean(options.simulated) })
  }).then((response) => response.json()).catch(() => null),
  submitAnswer: (payload) => fetch("/api/player-answer", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  }).then((response) => response.json()).catch(() => null),
  submitAction: (payload) => fetch("/api/player-action", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  }).then((response) => response.json()).catch(() => null),
  ...(window.StudyAdventurePlayerSession || {})
};

const AUDIO_EFFECT_SELECTIONS_STORAGE_KEY = "studyAdventureAudioEffectSelections";
const FINAL_SUBMISSION_HOLD_MS = 800;
const DEPLOYMENT_ROSTER_REVEAL_DELAY_MS = 1450;
const DEPLOYMENT_ROSTER_STAGGER_MS = 160;
const GAME_SFX_EVENTS = [
  { id: "ui", label: "UI / Button" },
  { id: "typewriter", label: "Text Typewriter" },
  { id: "question", label: "Query Incoming" },
  { id: "submitted", label: "Player Submitted" },
  { id: "correct", label: "Correct Answer" },
  { id: "incorrect", label: "Incorrect Answer" },
  { id: "damage", label: "Damage Taken" },
  { id: "loot", label: "Item Found" },
  { id: "timer", label: "Timer Tick" },
  { id: "emergency", label: "Emergency Alert" },
  { id: "transition", label: "Room Transition" },
  { id: "recovery", label: "Recovery Room" },
  { id: "boss", label: "Boss Encounter" },
  { id: "failure", label: "Mission Failure" },
  { id: "ending", label: "Mission Ending" }
];

function readStoredAudioEffectSelections() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(AUDIO_EFFECT_SELECTIONS_STORAGE_KEY) || "{}");
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
  missionType: "Horror",
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
  bossAreaNames: { mid: "", final: "" },
  bossPhasePlans: {},
  bossPhasePlanRequests: {},
  bossTestMode: false,
  bossTestPromptStarted: false,
  actionDrivenMode: false,
  actionRooms: [],
  actionThreatPressure: 0,
  actionRoomAttempts: {},
  actionReceiptLogKey: "",
  actionTurnOrder: [],
  actionResolutionQueue: null,
  actionContinueGateTimer: null,
  activeObstacles: {},
  nodeResults: {},
  encounter: null,
  challengeTypes: [],
  recoveryUsed: new Set(),
  rng: mulberry32(8128),
  selectedEMS: false,
  challengeHistory: [],
  typeTimers: [],
  autoScrollTimers: [],
  chatMode: false,
  localDmMode: false,
  deviceMode: "multi",
  localDmProvider: window.localStorage.getItem("studyAdventureLocalDmProvider") || "lmstudio",
  ollamaModel: "google/gemma-4-e4b",
  feedLastId: "",
  feedPollTimer: null,
  playerPollTimer: null,
  roomCode: "",
  playerPromptId: "",
  playerPromptRequiredIds: [],
  playerPromptRequiredNames: [],
  playerAnswers: [],
  playerActions: [],
  playerSubmissionLogKey: "",
  resolutionDelayPending: false,
  resolutionDelayPromptId: "",
  resolutionDelayTimer: null,
  processedPlayerActionIds: new Set(),
  simulatorAutoAnswer: window.localStorage.getItem("studyAdventureSimulatorAutoAnswer") === "true",
  simulatorAutoAnswerPromptId: "",
  simulatorAutoAnswerTimers: [],
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
  bossEyesStrikeTimer: null,
  answerPending: false,
  lastSubmittedAnswer: "",
  previousAnswerFlashId: "",
  answerResults: {},
  sceneHistory: [],
  turnHistory: [],
  endingPending: false,
  sideActionRooms: new Set(),
  sideActionPending: false,
  sideActionWaitingId: "",
  narrowedChoices: {},
  sideActionGuard: false,
  previousAnswer: null,
  emergencyTimerEnabled: true,
  emergencyTimerDuration: 60,
  fastMode: window.localStorage.getItem("studyAdventureFastMode") === "true",
  teacherTextSize: window.localStorage.getItem("studyAdventureTeacherTextSize") || "normal",
  sfxPreset: window.localStorage.getItem("studyAdventureSfxPreset") || "subtle",
  youtubeMusicUrl: window.localStorage.getItem("studyAdventureYoutubeMusicUrl") || "",
  youtubeBossMusicUrl: window.localStorage.getItem("studyAdventureYoutubeBossMusicUrl") || "",
  backgroundMusicLoaded: false,
  backgroundMusicMode: "normal",
  backgroundMusicVideoId: "",
  backgroundMusicFadeTimer: null,
  backgroundMusicTransitionRunId: 0,
  backgroundMusicCurrentVolume: 72,
  backgroundMusicFadingOutForBossReady: false,
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
  ttsAudio: null,
  ttsAudioUrl: "",
  ttsVoiceURI: "",
  ttsRate: 1,
  ttsTextDelayMs: 1000,
  ttsLastPlaybackPromise: Promise.resolve(),
  ttsPlaybackResolve: null,
  ttsPlaybackToken: 0
};

const TIMEOUT_ANSWER = "player failed to submit";
const TWO_BOSS_MIN_QUESTIONS = 18;
const MID_BOSS_QUESTIONS = 4;
const FINAL_BOSS_QUESTIONS = 6;
const ROUTE_TRAVEL_MS = 4600;
const QUESTION_SET_STORAGE_KEY = "studyAdventureQuestionSets";
const SELECTED_QUESTION_SETS_KEY = "studyAdventureSelectedQuestionSets";
const MUSIC_PRESET_STORAGE_KEY = "studyAdventureMusicPresets";
const STATUS_NAME_DISPLAY_LIMIT = 14;
const PLAYER_ACTION_COOLDOWN_MS = 120000;
const ACTION_DIALOGUE_HOLD_MS = 12000;
const PLAYER_PROMPT_DELIVERY_GRACE_MS = 3000;
const GENERATED_ENVIRONMENT_NOTE = "Let the local DM create a custom mission location and persistent enemy.";
const BACKGROUND_MUSIC_VOLUME = 72;
const BACKGROUND_MUSIC_DUCK_VOLUME = 38;

function isFastMode() {
  return Boolean(state.fastMode);
}

function narrationSentenceRange(normalRange, fastRange) {
  return isFastMode() ? fastRange : normalRange;
}

function questionAlertDelayMs() {
  return isFastMode() ? 900 : 3000;
}

function questionRevealDelayMs() {
  return isFastMode() ? 700 : 1750;
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
  deviceModeSingle: document.getElementById("deviceModeSingle"),
  deviceModeMulti: document.getElementById("deviceModeMulti"),
  dmEngine: document.getElementById("dmEngine"),
  questionSource: document.getElementById("questionSource"),
  difficultyPools: document.getElementById("difficultyPools"),
  bossTestMode: document.getElementById("bossTestMode"),
  actionDrivenMode: document.getElementById("actionDrivenMode"),
  difficultyPoolsGroup: document.getElementById("difficultyPoolsGroup"),
  difficultyQuestionBanks: document.getElementById("difficultyQuestionBanks"),
  easyQuestionsInput: document.getElementById("easyQuestionsInput"),
  mediumQuestionsInput: document.getElementById("mediumQuestionsInput"),
  hardQuestionsInput: document.getElementById("hardQuestionsInput"),
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
  emergencyTimerDuration: document.getElementById("emergencyTimerDuration"),
  emergencyTimerDurationGroup: document.getElementById("emergencyTimerDurationGroup"),
  teacherTextSize: document.getElementById("teacherTextSize"),
  teacherTextSizeGroup: document.getElementById("teacherTextSizeGroup"),
  sfxPreset: document.getElementById("sfxPreset"),
  sfxMappingGrid: document.getElementById("sfxMappingGrid"),
  youtubeMusicUrl: document.getElementById("youtubeMusicUrl"),
  youtubeBossMusicUrl: document.getElementById("youtubeBossMusicUrl"),
  savedMusicPresetsPanel: document.getElementById("savedMusicPresetsPanel"),
  savedMusicPresetsNote: document.getElementById("savedMusicPresetsNote"),
  savedMusicPresetsList: document.getElementById("savedMusicPresetsList"),
  musicPresetNameInput: document.getElementById("musicPresetNameInput"),
  saveMusicPresetBtn: document.getElementById("saveMusicPresetBtn"),
  missionLength: document.getElementById("missionLength"),
  questionBankGroup: document.getElementById("questionBankGroup"),
  questionTips: document.getElementById("questionTips"),
  questionsInput: document.getElementById("questionsInput"),
  notebookPrompt: document.getElementById("notebookPrompt"),
  copyNotebookPromptBtn: document.getElementById("copyNotebookPromptBtn"),
  savedQuestionSetsPanel: document.getElementById("savedQuestionSetsPanel"),
  savedQuestionSetsNote: document.getElementById("savedQuestionSetsNote"),
  savedQuestionSetsList: document.getElementById("savedQuestionSetsList"),
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
  missionMap: document.getElementById("missionMap"),
  mapTitle: document.getElementById("mapTitle"),
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
els.copyScriptBtn.addEventListener("click", copyDmScript);
els.recheckSystemsBtn?.addEventListener("click", checkMissionSystems);
els.sfxPreset?.addEventListener("change", () => {
  state.sfxPreset = els.sfxPreset.value || "subtle";
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
els.difficultyPools.addEventListener("change", syncSetupMode);
els.bossTestMode?.addEventListener("change", updateSetupSummary);
els.actionDrivenMode?.addEventListener("change", () => {
  delete els.missionLength.dataset.manual;
  syncSetupMode();
});
els.deviceModeSingle.addEventListener("change", syncSetupMode);
els.deviceModeMulti.addEventListener("change", syncSetupMode);
els.playersInput.addEventListener("input", updateSetupSummary);
els.questionsInput.addEventListener("input", updateSetupSummary);
els.easyQuestionsInput.addEventListener("input", updateSetupSummary);
els.mediumQuestionsInput.addEventListener("input", updateSetupSummary);
els.hardQuestionsInput.addEventListener("input", updateSetupSummary);
els.missionLength.addEventListener("input", () => {
  if (els.missionLength.value) els.missionLength.dataset.manual = "true";
  else delete els.missionLength.dataset.manual;
  updateSetupSummary();
});
els.missionLength.addEventListener("change", () => {
  clampMissionLengthInput();
  updateSetupSummary();
});
els.missionLength.addEventListener("blur", () => {
  clampMissionLengthInput();
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
initGameAudioControls();
renderSavedMusicPresets();
loadSavedMusicPresetsFromServer();
els.teacherTextSize?.addEventListener("change", () => {
  applyTeacherTextSize(els.teacherTextSize.value);
  window.localStorage.setItem("studyAdventureTeacherTextSize", state.teacherTextSize);
});
els.mapEmergencyPauseBtn?.addEventListener("click", toggleEmergencyTimerPause);
els.missionControlsToggle?.addEventListener("click", () => toggleUtilityPanel("controls"));
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
  els.difficultyPools.checked = false;
  delete els.missionLength.dataset.manual;
  els.missionLength.value = "10";
  els.missionLength.dataset.manual = "true";
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
  if (els.sfxPreset) els.sfxPreset.value = state.sfxPreset;
  if (els.youtubeMusicUrl) els.youtubeMusicUrl.value = state.youtubeMusicUrl;
  if (els.youtubeBossMusicUrl) els.youtubeBossMusicUrl.value = state.youtubeBossMusicUrl;
  loadAudioEffectManifest();
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
  return fetch("/api/music-presets", { cache: "no-store" })
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
      renderSavedMusicPresets();
    })
    .catch(() => {
      state.musicPresetsServerReady = false;
    });
}

function persistMusicPresetsToServer() {
  fetch("/api/music-presets", {
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
  state.youtubeMusicUrl = preset.normalUrl || "";
  state.youtubeBossMusicUrl = preset.bossUrl || "";
  if (els.youtubeMusicUrl) els.youtubeMusicUrl.value = state.youtubeMusicUrl;
  if (els.youtubeBossMusicUrl) els.youtubeBossMusicUrl.value = state.youtubeBossMusicUrl;
  if (els.musicPresetNameInput) els.musicPresetNameInput.value = preset.name;
  window.localStorage.setItem("studyAdventureYoutubeMusicUrl", state.youtubeMusicUrl);
  window.localStorage.setItem("studyAdventureYoutubeBossMusicUrl", state.youtubeBossMusicUrl);
  syncBackgroundMusicPanel();
  setLaunchStatus(`Loaded music preset "${preset.name}".`);
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
  fetch(`audio-effects.json?ts=${Date.now()}`, { cache: "no-store" })
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

function playGameSfx(eventName, options = {}) {
  if (state.sfxPreset === "off") return;
  if (eventName === "ending") stopBackgroundMusic();
  const nowMs = Date.now();
  const minInterval = Number.isFinite(options.minInterval) ? Math.max(0, options.minInterval) : 90;
  if (nowMs - (state.lastSfxAt[eventName] || 0) < minInterval) return;
  const effect = audioEffectForEvent(eventName);
  if (!effect) return;
  state.lastSfxAt[eventName] = nowMs;
  try {
    const key = `${effect.id}:${effect.src}`;
    const audio = state.audioEffectPlayers[key] || new Audio(effect.src);
    state.audioEffectPlayers[key] = audio;
    if (audio.studyAdventureFadeTimer) window.clearInterval(audio.studyAdventureFadeTimer);
    audio.studyAdventureFadeTimer = null;
    audio.pause();
    audio.currentTime = 0;
    const baseVolume = state.sfxPreset === "cinematic" ? 0.92 : 0.48;
    audio.volume = Math.max(0, Math.min(1, baseVolume * (Number.isFinite(options.volumeScale) ? options.volumeScale : 1)));
    audio.play().catch(() => {});
    if (options.pulse !== false) pulseMapAudioReactor(eventName);
  } catch {
    // Custom SFX should never interrupt the game loop.
  }
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
    } catch {
      // Audio cleanup must not interrupt a reset or a new mission.
    }
  });
  state.lastSfxAt = {};
}

function startIntroSequenceAudio() {
  stopIntroSequenceAudio();
  if (state.sfxPreset === "off" || state.teamReady) return;
  const endingEffect = audioEffectForEvent("ending");
  const sources = [...new Set(["audio-effects/ending.wav", endingEffect?.src, "audio-effects/ending.mp3"].filter(Boolean))];
  const runId = ++state.introSequenceAudioRunId;

  const playSource = (index) => {
    if (runId !== state.introSequenceAudioRunId || state.teamReady || index >= sources.length) return;
    const audio = new Audio(sources[index]);
    let advanced = false;
    const tryNextSource = () => {
      if (advanced) return;
      advanced = true;
      if (state.introSequenceAudio === audio) state.introSequenceAudio = null;
      playSource(index + 1);
    };
    audio.loop = true;
    audio.preload = "auto";
    audio.volume = state.sfxPreset === "cinematic" ? 0.72 : 0.42;
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
  if (state.sfxPreset === "off") return;

  const configuredEffect = audioEffectForEvent("failure");
  const sources = [...new Set([
    configuredEffect?.src,
    "audio-effects/failure.wav",
    "audio-effects/failure.mp3"
  ].filter(Boolean))];
  const runId = ++state.failureAudioRunId;

  const playSource = (index) => {
    if (runId !== state.failureAudioRunId || index >= sources.length) return;
    const audio = new Audio(sources[index]);
    let advanced = false;
    const tryNextSource = () => {
      if (advanced) return;
      advanced = true;
      if (state.failureAudio === audio) state.failureAudio = null;
      playSource(index + 1);
    };
    audio.preload = "auto";
    audio.volume = state.sfxPreset === "cinematic" ? 0.96 : 0.58;
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
  try {
    audio.pause();
    audio.currentTime = 0;
    audio.removeAttribute("src");
    audio.load();
  } catch {
    // Failure audio should never interrupt the mission flow.
  }
}

function startNormalBackgroundMusicAfterReady() {
  fadeOutIntroSequenceAudio();
  if (state.youtubeMusicUrl || state.youtubeBossMusicUrl) loadBackgroundMusic("normal", { fadeIn: true });
}

function syncBackgroundMusicPanel() {
  const enabled = Boolean(
    state.youtubeMusicUrl
    || state.youtubeBossMusicUrl
    || els.youtubeMusicUrl?.value?.trim()
    || els.youtubeBossMusicUrl?.value?.trim()
  );
  if (els.backgroundMusicPanel) els.backgroundMusicPanel.hidden = !enabled;
  if (els.backgroundMusicStatus) {
    els.backgroundMusicStatus.textContent = enabled
      ? state.backgroundMusicLoaded ? `${titleCase(state.backgroundMusicMode)} music loaded` : "Ready to load"
      : "Not loaded";
  }
  syncMapAudioReactor();
}

function sendYouTubePlayerCommand(iframe, func, args = []) {
  if (!iframe?.contentWindow) return;
  iframe.contentWindow.postMessage(JSON.stringify({ event: "command", func, args }), "*");
}

function rampBackgroundMusic(iframe, fromVolume, toVolume, durationMs, onComplete) {
  window.clearInterval(state.backgroundMusicFadeTimer);
  state.backgroundMusicFadeTimer = null;
  state.backgroundMusicCurrentVolume = fromVolume;
  sendYouTubePlayerCommand(iframe, "setVolume", [fromVolume]);
  sendYouTubePlayerCommand(iframe, "playVideo");

  const startedAt = performance.now();
  state.backgroundMusicFadeTimer = window.setInterval(() => {
    const progress = Math.min(1, (performance.now() - startedAt) / durationMs);
    const eased = 1 - ((1 - progress) ** 3);
    const volume = fromVolume + ((toVolume - fromVolume) * eased);
    state.backgroundMusicCurrentVolume = volume;
    sendYouTubePlayerCommand(iframe, "setVolume", [Math.round(volume)]);
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

function fadeInBackgroundMusic(iframe, durationMs = 2200, targetVolume = backgroundMusicListeningVolume()) {
  rampBackgroundMusic(iframe, 0, targetVolume, durationMs);
}

function duckBackgroundMusicForTts() {
  state.ttsPlaybackActive = true;
  if (!state.backgroundMusicLoaded || state.backgroundMusicFadingOutForBossReady) return;
  const iframe = els.backgroundMusicEmbed?.querySelector("iframe");
  if (!iframe) return;
  rampBackgroundMusic(iframe, state.backgroundMusicCurrentVolume, BACKGROUND_MUSIC_DUCK_VOLUME, 320);
}

function restoreBackgroundMusicAfterTts() {
  state.ttsPlaybackActive = false;
  if (!state.backgroundMusicLoaded || state.backgroundMusicFadingOutForBossReady) return;
  const iframe = els.backgroundMusicEmbed?.querySelector("iframe");
  if (!iframe) return;
  rampBackgroundMusic(iframe, state.backgroundMusicCurrentVolume, BACKGROUND_MUSIC_VOLUME, 620);
}

function fadeOutBackgroundMusicForBossReady(durationMs = 1200) {
  if (!state.backgroundMusicLoaded) return;
  const iframe = els.backgroundMusicEmbed?.querySelector("iframe");
  if (!iframe) {
    stopBackgroundMusic();
    return;
  }
  state.backgroundMusicFadingOutForBossReady = true;
  if (els.backgroundMusicStatus) els.backgroundMusicStatus.textContent = "Fading out for critical contact...";
  rampBackgroundMusic(iframe, state.backgroundMusicCurrentVolume, 0, durationMs, () => stopBackgroundMusic());
}

function loadBackgroundMusic(mode = desiredBackgroundMusicMode(), options = {}) {
  const requestedMode = mode === "boss" ? "boss" : "normal";
  const normalUrl = els.youtubeMusicUrl?.value?.trim() || state.youtubeMusicUrl;
  const bossUrl = els.youtubeBossMusicUrl?.value?.trim() || state.youtubeBossMusicUrl;
  const url = requestedMode === "boss" ? bossUrl || normalUrl : normalUrl || bossUrl;
  const id = extractYouTubeId(url);
  if (!id) {
    if (els.backgroundMusicStatus) els.backgroundMusicStatus.textContent = "Invalid YouTube URL";
    return;
  }
  state.youtubeMusicUrl = normalUrl;
  state.youtubeBossMusicUrl = bossUrl;
  window.localStorage.setItem("studyAdventureYoutubeMusicUrl", normalUrl);
  window.localStorage.setItem("studyAdventureYoutubeBossMusicUrl", bossUrl);
  if (state.backgroundMusicLoaded && state.backgroundMusicVideoId === id) {
    state.backgroundMusicMode = requestedMode;
    if (els.backgroundMusicPanel) els.backgroundMusicPanel.hidden = false;
    if (els.backgroundMusicStatus) els.backgroundMusicStatus.textContent = `${titleCase(state.backgroundMusicMode)} music loaded`;
    const iframe = els.backgroundMusicEmbed?.querySelector("iframe");
    if (iframe && !state.backgroundMusicFadingOutForBossReady) {
      rampBackgroundMusic(iframe, state.backgroundMusicCurrentVolume, backgroundMusicListeningVolume(), 360);
    }
    syncMapAudioReactor();
    return;
  }

  const previousIframe = els.backgroundMusicEmbed?.querySelector("iframe");
  const transitionRunId = ++state.backgroundMusicTransitionRunId;
  state.backgroundMusicMode = requestedMode;
  if (els.backgroundMusicStatus) {
    els.backgroundMusicStatus.textContent = previousIframe && options.transition
      ? `Transitioning to ${titleCase(requestedMode)} music...`
      : `${titleCase(requestedMode)} music loaded`;
  }

  const mountTrack = (fadeIn = false) => {
    if (transitionRunId !== state.backgroundMusicTransitionRunId) return;
    state.backgroundMusicLoaded = true;
    state.backgroundMusicVideoId = id;
    if (els.backgroundMusicPanel) els.backgroundMusicPanel.hidden = false;
    if (els.backgroundMusicStatus) els.backgroundMusicStatus.textContent = `${titleCase(requestedMode)} music loaded`;
    if (!els.backgroundMusicEmbed) return;
    const src = `https://www.youtube.com/embed/${encodeURIComponent(id)}?autoplay=1&loop=1&playlist=${encodeURIComponent(id)}&controls=1&modestbranding=1&enablejsapi=1`;
    els.backgroundMusicEmbed.innerHTML = `<iframe title="YouTube background music" src="${src}" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>`;
    const iframe = els.backgroundMusicEmbed.querySelector("iframe");
    state.backgroundMusicCurrentVolume = fadeIn ? 0 : backgroundMusicListeningVolume();
    iframe?.addEventListener("load", () => {
      if (transitionRunId === state.backgroundMusicTransitionRunId && state.backgroundMusicVideoId === id) {
        if (fadeIn) {
          fadeInBackgroundMusic(iframe);
        } else {
          sendYouTubePlayerCommand(iframe, "setVolume", [backgroundMusicListeningVolume()]);
        }
      }
    }, { once: true });
    syncMapAudioReactor();
    playGameSfx("ui");
  };

  if (previousIframe && options.transition) {
    rampBackgroundMusic(previousIframe, state.backgroundMusicCurrentVolume, 0, 900, () => mountTrack(true));
  } else {
    mountTrack(Boolean(options.fadeIn));
  }
}

function stopBackgroundMusic() {
  state.backgroundMusicTransitionRunId += 1;
  window.clearInterval(state.backgroundMusicFadeTimer);
  state.backgroundMusicFadeTimer = null;
  if (els.backgroundMusicEmbed) els.backgroundMusicEmbed.innerHTML = "";
  state.backgroundMusicLoaded = false;
  state.backgroundMusicVideoId = "";
  state.backgroundMusicCurrentVolume = 0;
  state.backgroundMusicFadingOutForBossReady = false;
  if (els.backgroundMusicStatus) els.backgroundMusicStatus.textContent = state.youtubeMusicUrl || state.youtubeBossMusicUrl ? "Stopped" : "Not loaded";
  syncMapAudioReactor();
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

function startBossQuestionMusic() {
  const node = state.nodes[state.currentNode];
  const bossActive = node?.type === "boss" || Boolean(currentBossProgress());
  if (!bossActive || state.bossMusicStartedNodes.has(state.currentNode)) return;
  state.bossMusicStartedNodes.add(state.currentNode);
  syncBossEyesVisual();
  if (state.youtubeMusicUrl || state.youtubeBossMusicUrl) {
    fadeOutGameSfx("boss", 480);
    loadBackgroundMusic("boss", state.backgroundMusicLoaded ? { transition: true } : { fadeIn: true });
  }
}

function syncBossEyesVisual() {
  const node = state.nodes[state.currentNode];
  const bossActive = node?.type === "boss" || Boolean(currentBossProgress());
  const revealActive = bossActive && state.bossMusicStartedNodes.has(state.currentNode);
  els.mapPanel?.classList.toggle("boss-eyes-active", revealActive);
}

function desiredBackgroundMusicMode() {
  const node = state.nodes[state.currentNode];
  const bossActive = node?.type === "boss" || Boolean(currentBossProgress());
  if (bossActive && state.bossMusicStartedNodes.has(state.currentNode)) return "boss";
  return "normal";
}

function syncBackgroundMusicForEncounter() {
  if (!state.backgroundMusicLoaded) return;
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

function noTtsRead() {
  return ensureTtsManager()?.noRead() || { visualDelay: 0, playback: Promise.resolve() };
}

function speakText(text, options = {}) {
  return ensureTtsManager()?.speakText(text, options) || Promise.resolve();
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

function delayPresentation(ms) {
  const delay = Math.max(0, Number(ms) || 0);
  if (!delay) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = window.setTimeout(resolve, delay);
    state.typeTimers.push(timer);
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
  return info.question.question;
}

function cleanSpeechText(text) {
  return String(text || "")
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
    stopTts();
    setLaunchStatus("Preparing mission...");
    clampMissionLengthInput();
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
    setLaunchStatus("Launching single-device mission...");
    launchMission(players, config);
  } catch (error) {
    setLaunchStatus(`Launch error: ${error.message || error}`, true);
  }
}

function readMissionConfig() {
  const engine = els.dmEngine.value;
  const chatMode = engine !== "classic";
  const localDmMode = engine === "local";
  const actionDrivenMode = Boolean(els.actionDrivenMode?.checked);
  const questionPool = getSetupStudyQuestions();
  const length = actionDrivenMode ? actionMissionLengthFor() : missionLengthFor(questionPool.length);
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
    sfxPreset: els.sfxPreset?.value || "subtle",
    youtubeMusicUrl: els.youtubeMusicUrl?.value.trim() || state.youtubeMusicUrl || "",
    youtubeBossMusicUrl: els.youtubeBossMusicUrl?.value.trim() || state.youtubeBossMusicUrl || "",
    bossTestMode: Boolean(els.bossTestMode?.checked),
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
  const missionType = els.missionType.value || "Horror";
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

function clampMissionLengthInput() {
  const actionDrivenMode = Boolean(els.actionDrivenMode?.checked);
  const total = getSetupQuestionReport().questions.length;
  const max = actionDrivenMode ? 30 : Math.max(1, total || 1);
  const fallback = actionDrivenMode ? 5 : total || 1;
  const requested = Number(els.missionLength.value);
  const clamped = !Number.isFinite(requested) || requested < 1
    ? fallback
    : Math.max(1, Math.min(max, Math.round(requested)));
  els.missionLength.value = String(clamped);
  els.missionLength.dataset.manual = "true";
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

function positionMissionForBossTest() {
  const groups = bossQuestionGroups(state.questions.length);
  const targetGroup = groups.find((group) => group.phase === "final") || groups.at(-1);
  if (!targetGroup) return;
  const preBossQuestion = Math.max(0, targetGroup.start - 1);
  const preBossNodeIndex = state.nodes.findIndex((node) => node.type === "challenge" && node.questionIndex === preBossQuestion);
  if (preBossNodeIndex >= 0) {
    state.currentQuestion = preBossQuestion;
    state.currentNode = preBossNodeIndex;
  } else {
    const bossNodeIndex = state.nodes.findIndex((node) => node.type === "boss" && node.questionIndex === targetGroup.start);
    if (bossNodeIndex >= 0) {
      state.currentQuestion = targetGroup.start;
      state.currentNode = bossNodeIndex;
    }
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
    detail: `Starting at question ${state.currentQuestion + 1} near ${targetGroup.phase} boss`
  });
}

function launchMission(players, config) {
  try {
    clearFinalSubmissionDelay();
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
    state.players = cleanPlayers.map((name) => ({ name, hp: 5, status: [], incapacitated: false }));
    state.inventory = { medkits: 2, ems: 0 };
    state.missionType = config.missionType;
    state.environment = config.environment;
    state.title = makeTitle(state.missionType, state.environment);
    state.rng = mulberry32(seedFrom(`${state.title}|${cleanPlayers.join(",")}|${config.questions.length}`));
    state.threatProfile = createThreatProfile(state.missionType, state.environment);
    applySetupGeneratedMission(config.generatedMission);
    state.threat = state.threatProfile.identity || state.threatProfile.archetype || state.threatProfile.summary;
    state.currentQuestion = 0;
    state.currentNode = 0;
    state.actionDrivenMode = Boolean(config.actionDrivenMode);
    state.challengeTypes = buildChallengePlan(config.questions.length);
    state.questions = state.actionDrivenMode ? config.questions : config.localDmMode || !config.chatMode ? prepareQuestions(config.questions, state.challengeTypes) : config.questions;
    state.nodes = buildNodes(state.questions.length);
    state.mapLayoutSeed = seedFrom(`${state.title}|${cleanPlayers.join(",")}|${config.questions.length}|${Date.now()}|${Math.random()}`);
    state.mapPositions = generateSprawledRoutePositions(state.nodes.length, state.mapLayoutSeed);
    state.roomNames = {};
    state.bossAreaNames = generatedBossAreaFallbacks(state.missionType, state.environment, state.threat);
    applyGeneratedBossAreas(config.generatedMission?.bossAreas);
    state.bossPhasePlans = {};
    state.bossPhasePlanRequests = {};
    state.bossTestMode = Boolean(config.bossTestMode);
    state.bossTestPromptStarted = false;
    state.actionRooms = state.actionDrivenMode ? buildActionRooms(config.questions.length) : [];
    state.actionThreatPressure = 0;
    state.actionRoomAttempts = {};
    state.actionReceiptLogKey = "";
    state.actionTurnOrder = shuffleForSession(cleanPlayers);
    state.actionResolutionQueue = null;
    state.activeObstacles = {};
    state.nodeResults = {};
    state.recoveryUsed = new Set();
    state.selectedEMS = false;
    state.challengeHistory = [];
    state.feedLastId = "";
    state.playerPromptId = "";
    state.playerPromptRequiredIds = [];
    state.playerPromptRequiredNames = [];
    state.playerAnswers = [];
    state.playerActions = [];
    state.resolutionDelayPending = false;
    state.resolutionDelayPromptId = "";
    state.resolutionDelayTimer = null;
    state.processedPlayerActionIds = new Set();
    state.readinessLogged = false;
    state.currentBriefing = null;
    state.openingLogStory = "";
    state.teamReady = false;
    state.bossReadyPending = false;
    state.bossReadyChecks = new Set();
    state.bossAudioStartedNodes = new Set();
    state.bossMusicStartedNodes = new Set();
    window.clearTimeout(state.bossEyesStrikeTimer);
    state.bossEyesStrikeTimer = null;
    state.answerPending = false;
    state.lastSubmittedAnswer = "";
    state.previousAnswerFlashId = "";
    state.answerResults = {};
    state.sceneHistory = [];
    state.turnHistory = [];
    state.missionLogHistory = [];
    renderMissionLogHistory();
    state.endingPending = false;
    state.sideActionRooms = new Set();
    state.sideActionPending = false;
    state.sideActionWaitingId = "";
    state.narrowedChoices = {};
    state.sideActionGuard = false;
    state.previousAnswer = null;
    state.emergencyTimerEnabled = config.emergencyTimerEnabled;
    state.emergencyTimerDuration = config.emergencyTimerDuration;
    state.sfxPreset = config.sfxPreset || "subtle";
    state.youtubeMusicUrl = config.youtubeMusicUrl || "";
    state.youtubeBossMusicUrl = config.youtubeBossMusicUrl || "";
    window.localStorage.setItem("studyAdventureSfxPreset", state.sfxPreset);
    window.localStorage.setItem("studyAdventureYoutubeMusicUrl", state.youtubeMusicUrl);
    window.localStorage.setItem("studyAdventureYoutubeBossMusicUrl", state.youtubeBossMusicUrl);
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

    if (config.bossTestMode && !state.actionDrivenMode) positionMissionForBossTest();

    if (state.teamReady || !state.chatMode) startNormalBackgroundMusicAfterReady();
    else startIntroSequenceAudio();

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
      state.processedPlayerActionIds = new Set();
      renderPlayerSessionPanel();
    }
    beginNextNode();
    if (state.chatMode) startDmFeed();
  } catch (error) {
    setLaunchStatus(`Deploy error: ${error.message || error}`, true);
    throw error;
  }
}

function resetMission() {
  if (document.body.classList.contains("dashboard-exiting")) return;
  if (document.body.classList.contains("mission-active")) {
    startDashboardToSetupTransition();
    return;
  }
  performMissionReset();
}

function performMissionReset({ preserveTransition = false } = {}) {
  state.started = false;
  clearFinalSubmissionDelay();
  if (!preserveTransition) clearSetupToDeploymentTransition();
  clearTypewriters();
  stopTts();
  stopAllGameSfx();
  stopIntroSequenceAudio();
  stopMissionFailureAudio();
  stopBackgroundMusic();
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
  state.bossAreaNames = { mid: "", final: "" };
  state.bossPhasePlans = {};
  state.bossPhasePlanRequests = {};
  state.bossTestMode = false;
  state.bossTestPromptStarted = false;
  state.actionDrivenMode = false;
  state.actionRooms = [];
  state.actionThreatPressure = 0;
  state.actionRoomAttempts = {};
  state.actionReceiptLogKey = "";
  state.actionTurnOrder = [];
  state.activeObstacles = {};
  state.nodeResults = {};
  state.encounter = null;
  state.challengeTypes = [];
  state.recoveryUsed = new Set();
  state.selectedEMS = false;
  state.feedLastId = "";
  state.roomCode = "";
  state.playerPromptId = "";
  state.playerPromptRequiredIds = [];
  state.playerPromptRequiredNames = [];
  state.playerAnswers = [];
  state.playerActions = [];
  state.resolutionDelayPending = false;
  state.resolutionDelayPromptId = "";
  state.resolutionDelayTimer = null;
  state.processedPlayerActionIds = new Set();
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
  window.clearTimeout(state.bossEyesStrikeTimer);
  state.bossEyesStrikeTimer = null;
  state.answerPending = false;
  state.lastSubmittedAnswer = "";
  state.previousAnswerFlashId = "";
  state.answerResults = {};
  state.sceneHistory = [];
  state.turnHistory = [];
  state.endingPending = false;
  state.sideActionRooms = new Set();
  state.sideActionPending = false;
  state.sideActionWaitingId = "";
  state.narrowedChoices = {};
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
    "situation-boss",
    "situation-emergency",
    "situation-recovery",
    "situation-party-wounded",
    "situation-party-critical",
    "situation-failure"
  );
  delete document.body.dataset.missionTheme;
  setMissionFailureVisual(false);
  stopOpeningWaitCounter();
  els.setupPanel.style.display = "";
  els.joinLobby.hidden = true;
  els.startBtn.disabled = false;
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
  state.feedPollTimer = window.setInterval(checkDmFeed, 300);
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
  state.playerPromptRequiredIds = [];
  state.playerPromptRequiredNames = [];
  state.playerAnswers = [];
  state.playerActions = [];
  state.processedPlayerActionIds = new Set();
  state.playerParticipants = [];
  state.playerJoinUrl = "";
  state.playerJoinUrlReady = false;
  els.joinLobby.hidden = false;
  els.startBtn.disabled = true;
  stopPlayerPolling();
  state.playerPollTimer = window.setInterval(pollPlayerAnswers, 900);
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
      setLaunchStatus(`Launching mission with ${players.length} player${players.length === 1 ? "" : "s"}...`);
      launchMission(players, { ...config, deviceMode: "multi" });
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
      state.playerPollTimer = window.setInterval(pollPlayerAnswers, 900);
      renderJoinLobby();
    })
    .catch(() => {});
}

function startPlayerSession() {
  loadPlayerJoinUrl();
  renderPlayerSessionPanel();
  publishPlayerSession({ status: "briefing", prompt: null, resetAnswers: true });
  stopPlayerPolling();
  state.playerPollTimer = window.setInterval(pollPlayerAnswers, 900);
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
          <span>Connected</span>
          <button class="secondary removePlayerBtn" type="button" data-player-id="${escapeAttribute(player.id)}" data-player-name="${escapeAttribute(player.name)}">Remove</button>
        </div>
      </div>
    `).join("")
    : "<p class=\"muted-small\">No players have joined yet.</p>";
  els.launchFromLobbyBtn.disabled = false;
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
  cancelSimulatorAutoAnswerTimers();
  if (state.roomCode) publishPlayerSession({ status: "ended", prompt: null, resetAnswers: true });
  state.playerAnswers = [];
  state.playerActions = [];
  state.processedPlayerActionIds = new Set();
  state.playerParticipants = [];
  renderPlayerSessionPanel();
}

function stopPlayerPolling() {
  if (state.playerPollTimer) {
    window.clearInterval(state.playerPollTimer);
    state.playerPollTimer = null;
  }
}

function publishPlayerSession(extra = {}) {
  if (!state.roomCode) return Promise.resolve(null);
  const payload = {
    roomCode: state.roomCode,
    status: extra.status || (state.questionPresentationReady ? "open" : "waiting"),
    title: extra.title || state.title,
    players: extra.players || state.players.map((player) => player.name),
    playerStates: extra.playerStates || playerStatePayload(),
    actionCooldownMs: state.actionDrivenMode ? 0 : PLAYER_ACTION_COOLDOWN_MS,
    prompt: extra.prompt === undefined ? buildPlayerPrompt() : extra.prompt,
    resetAnswers: Boolean(extra.resetAnswers)
  };
  return playerSessionApi.publishSession(payload);
}

function publishPlayerVitals() {
  if (!state.roomCode || state.joinLobbyActive || !state.started || state.deviceMode !== "multi") return;
  playerSessionApi.publishSession({
    roomCode: state.roomCode,
    playerStates: playerStatePayload(),
    resetAnswers: false
  });
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
  return state.players.map((player) => ({
    name: player.name,
    hp: Math.max(0, player.hp),
    status: [...player.status],
    incapacitated: Boolean(player.incapacitated)
  }));
}

function buildPlayerPrompt() {
  const node = state.nodes[state.currentNode];
  if (node?.type === "recovery") {
    const hp = node.tier === 1 ? 2 : 4;
    const medkits = node.tier === 1 ? 2 : 3;
    const ems = node.tier === 1 ? 1 : 2;
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
  const promptId = `${state.currentQuestion}-${state.currentNode}-${info.question.mode}-${info.type.kind}`;
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
    bossStep: info.type.bossStep || 0,
    bossTotal: info.type.bossTotal || 0,
    bossPhase: info.type.bossPhase || "",
    lockedPlayer: info.operator?.name || "",
    allowPlayerActions: actionsAllowedThisEncounter(),
    accepting: state.questionPresentationReady && !state.answerPending && !state.resolutionDelayPending && !sideActionBlocksPlayerAnswers() && !state.resolved,
    timer: playerTimerPayload(),
    mode: info.question.mode,
    question: info.question.question,
    choices: info.question.mode === "multiple"
      ? info.question.choices
          .filter((choice) => !(state.narrowedChoices[state.currentQuestion] || []).includes(choice.key))
          .map((choice) => ({ key: choice.key, text: choice.text }))
      : []
  };
}

function publishCurrentPlayerPrompt(options = {}) {
  if (!state.started || !state.teamReady && state.chatMode) return;
  clearFinalSubmissionDelay();
  cancelSimulatorAutoAnswerTimers();
  const prompt = buildPlayerPrompt();
  state.playerSubmissionLogKey = `${prompt?.id || ""}|reset`;
  state.playerAnswers = [];
  state.playerActions = [];
  snapshotPromptRequiredResponders(prompt);
  const publication = publishPlayerSession({ status: "open", prompt, resetAnswers: true });
  if (state.deviceMode === "multi" && state.roomCode) {
    Promise.resolve(publication).then(() => startBossQuestionMusic()).catch(() => {});
  } else {
    startBossQuestionMusic();
  }
  renderStatus();
  if (options.renderOverlay !== false) renderMapQuestionOverlay();
}

function clearFinalSubmissionDelay() {
  if (state.resolutionDelayTimer) window.clearTimeout(state.resolutionDelayTimer);
  state.resolutionDelayTimer = null;
  state.resolutionDelayPending = false;
  state.resolutionDelayPromptId = "";
  document.body.classList.remove("answer-resolution-queued");
}

function queueFinalSubmissionResolution(callback, label = "required responses complete") {
  const promptId = state.playerPromptId || buildPlayerPrompt()?.id || "";
  if (!promptId || state.resolutionDelayPending || state.answerPending || state.resolved) return false;

  state.resolutionDelayPending = true;
  state.resolutionDelayPromptId = promptId;
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
    state.resolutionDelayTimer = null;
    const stillCurrent = state.started
      && state.playerPromptId === promptId
      && state.resolutionDelayPromptId === promptId
      && !state.answerPending
      && !state.resolved;
    state.resolutionDelayPending = false;
    state.resolutionDelayPromptId = "";
    document.body.classList.remove("answer-resolution-queued");
    if (stillCurrent) callback();
  }, FINAL_SUBMISSION_HOLD_MS);
  return true;
}

function clearPendingPlayerPromptState(options = {}) {
  clearFinalSubmissionDelay();
  cancelSimulatorAutoAnswerTimers();
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
  if (state.joinLobbyActive) {
    playerSessionApi.fetchSession()
      .then((session) => {
        state.playerParticipants = session?.participants || [];
        renderJoinLobby();
      })
      .catch(() => {});
    return;
  }
  if (!state.started) return;
  const promptId = state.playerPromptId || buildPlayerPrompt()?.id || "";
  playerSessionApi.fetchAnswers(state.roomCode, promptId)
    .then((payload) => {
      handlePlayerAnswersPayload(payload, promptId);
    })
    .catch(() => {});
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
  state.playerParticipants = payload.participants || [];
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
    renderStatus();
    pulsePlayerSubmissionCards(newlySubmittedNames);
  }
  renderPlayerSessionPanel();
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
  maybeResolvePlayerAction();
  maybeAutoResolveEmergencyAnswer();
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

function actionsAllowedThisEncounter() {
  const node = state.nodes[state.currentNode];
  return Boolean(state.localDmMode && node && node.type !== "recovery" && node.type !== "boss");
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
      playGameSfx("loot");
      outcome.rewardLines.push(`${scoredEntry.playerName}: found 2 Medkits`);
      outcome.rewardFacts.push(`${scoredEntry.playerName} finds two usable medkits in ${target.label}.`);
    } else if (roll < 0.55) {
      state.inventory.medkits += 1;
      playGameSfx("loot");
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
    playGameSfx("loot");
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

function maybeAutoResolveEmergencyAnswer() {
  if (!state.questionPresentationReady || state.answerPending || state.resolutionDelayPending || state.resolved) return;
  const info = currentQuestionInfo();
  const answers = [...state.playerAnswers].sort((a, b) => a.submittedAt - b.submittedAt);
  if (!answers.length) return;
  if (info.type.kind === "emergency") {
    setDeviceAnswerResults(deviceAnswerEntries([answers[0]], info.question));
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
    if (operatorAnswer?.answer) {
      setDeviceAnswerResults(deviceAnswerEntries([operatorAnswer], info.question));
      logDebugEvent({
        kind: "state",
        label: "Auto-resolving locked operator answer",
        detail: `${operatorAnswer.playerName || operatorAnswer.playerId || "unknown"} submitted for ${state.playerPromptId || "current prompt"}`
      });
      queueFinalSubmissionResolution(
        () => submitDeviceAnswer(operatorAnswer.answer),
        `${operatorAnswer.playerName || "locked operator"} response received`
      );
    }
    return;
  }
  if (everyoneActiveSubmitted(answers)) {
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
    && ["individual", "team", "truefalse"].includes(info?.type?.kind)
    && !info.type.locked
    && state.nodes[state.currentNode]?.type !== "recovery";
}

function snapshotPromptRequiredResponders(prompt = null) {
  if (!prompt || prompt.kind === "recovery" || prompt.actionOnly) {
    state.playerPromptRequiredIds = [];
    state.playerPromptRequiredNames = [];
    return;
  }
  const info = currentQuestionInfo();
  if (!info?.question || info.type?.kind === "emergency") {
    state.playerPromptRequiredIds = [];
    state.playerPromptRequiredNames = [];
    return;
  }
  state.playerPromptRequiredIds = [...requiredDeviceAnswerIds(info, { live: true })];
  state.playerPromptRequiredNames = [...requiredDeviceAnswerNames(info, { live: true })];
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
    return [...requiredIds].every((id) => submittedIds.has(id));
  }
  const activeNames = requiredDeviceAnswerNames(info);
  if (!activeNames.size) return false;
  const submitted = new Set(answers.map((answer) => normalize(answer.playerName)));
  return [...activeNames].every((name) => submitted.has(name));
}

function requiredDeviceAnswerIds(info = currentQuestionInfo(), options = {}) {
  if (info?.type?.kind === "emergency") return new Set();
  if (!options.live && state.playerPromptRequiredIds?.length) return new Set(state.playerPromptRequiredIds);
  const activeRoster = new Set(activePlayers().map((player) => normalize(player.name)));
  if (info?.type?.locked && info.operator) {
    const participant = state.playerParticipants.find((player) => sameName(player.name, info.operator.name));
    return participant?.id ? new Set([String(participant.id)]) : new Set();
  }
  const ids = state.playerParticipants
    .filter((player) => activeRoster.has(normalize(player.name)))
    .map((player) => String(player.id || ""))
    .filter(Boolean);
  return new Set(ids);
}

function requiredDeviceAnswerNames(info = currentQuestionInfo(), options = {}) {
  if (info?.type?.kind === "emergency") return new Set();
  if (!options.live && state.playerPromptRequiredNames?.length) return new Set(state.playerPromptRequiredNames);
  if (info?.type?.locked && info.operator) return new Set([normalize(info.operator.name)]);
  const activeRoster = new Set(activePlayers().map((player) => normalize(player.name)));
  const connected = state.playerParticipants
    .map((player) => normalize(player.name))
    .filter((name) => activeRoster.has(name));
  return new Set(connected.length ? connected : [...activeRoster]);
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

function deviceChallengeSucceeded(entries, type) {
  if (type.kind === "individual") return entries.every((entry) => entry.correct);
  const correctCount = entries.filter((entry) => entry.correct).length;
  return correctCount >= Math.ceil(entries.length / 2);
}

function setDeviceAnswerResults(entries) {
  state.answerResults = {};
  for (const entry of entries) {
    if (!entry?.player || !entry.answer) continue;
    state.answerResults[normalize(entry.player.name)] = Boolean(entry.correct);
  }
  renderStatus();
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

function renderSimulatorPanel() {
  if (!els.simulatorPanel) return;
  const hasSimPlayers = simulatedParticipants().length > 0;
  els.simulatorPanel.hidden = !hasSimPlayers;
  if (!hasSimPlayers) {
    els.simulatorPanel.innerHTML = "";
    return;
  }
  const info = currentQuestionInfo();
  const boss = currentBossProgress();
  const canSimulate = state.started
    && state.deviceMode === "multi"
    && state.questionPresentationReady
    && !state.answerPending
    && !state.resolved
    && !state.bossReadyPending
    && state.nodes[state.currentNode]?.type !== "recovery"
    && Boolean(info.question);
  const autoAvailable = canSimulate && !state.actionDrivenMode;
  els.simulatorPanel.innerHTML = `
    <strong>Simulator</strong>
    <p>${boss ? `Critical ${boss.step} / ${boss.total}. ` : ""}${canSimulate ? state.actionDrivenMode ? "Submit sim actions." : "Submit sim answers." : "Waiting."}</p>
    <label class="sim-auto-toggle">
      <input id="simAutoAnswerToggle" type="checkbox" ${state.simulatorAutoAnswer ? "checked" : ""} ${state.actionDrivenMode ? "disabled" : ""}>
      <span>Auto-Answer</span>
    </label>
    <div class="sim-tool-actions">
      <button class="secondary simAnswerBtn" type="button" data-mode="correct" ${canSimulate ? "" : "disabled"}>${state.actionDrivenMode ? "Helpful" : "All Correct"}</button>
      <button class="secondary simAnswerBtn" type="button" data-mode="mixed" ${canSimulate ? "" : "disabled"}>Mixed</button>
      <button class="secondary simAnswerBtn" type="button" data-mode="wrong" ${canSimulate ? "" : "disabled"}>${state.actionDrivenMode ? "Reckless" : "All Wrong"}</button>
    </div>
    <div id="simulatorStatus" class="muted-small"></div>
  `;
  const autoToggle = document.getElementById("simAutoAnswerToggle");
  autoToggle?.addEventListener("change", () => {
    state.simulatorAutoAnswer = Boolean(autoToggle.checked);
    window.localStorage.setItem("studyAdventureSimulatorAutoAnswer", String(state.simulatorAutoAnswer));
    if (!state.simulatorAutoAnswer) cancelSimulatorAutoAnswerTimers();
    else scheduleSimulatorAutoAnswers(info);
  });
  document.querySelectorAll(".simAnswerBtn").forEach((button) => {
    button.addEventListener("click", () => simulateDeviceAnswers(button.dataset.mode || "correct"));
  });
  if (state.simulatorAutoAnswer && autoAvailable) scheduleSimulatorAutoAnswers(info);
}

function cancelSimulatorAutoAnswerTimers() {
  state.simulatorAutoAnswerTimers.forEach((timerId) => window.clearTimeout(timerId));
  state.simulatorAutoAnswerTimers = [];
  state.simulatorAutoAnswerPromptId = "";
}

function scheduleSimulatorAutoAnswers(info = currentQuestionInfo()) {
  if (!state.simulatorAutoAnswer || state.actionDrivenMode || !info.question || !state.playerPromptId) return;
  if (!state.started || state.deviceMode !== "multi" || !state.questionPresentationReady || state.answerPending || state.resolutionDelayPending || state.resolved) return;
  const promptId = state.playerPromptId;
  if (state.simulatorAutoAnswerPromptId === promptId) return;
  cancelSimulatorAutoAnswerTimers();
  state.simulatorAutoAnswerPromptId = promptId;
  const pendingParticipants = simulatedAnswerParticipants(info)
    .filter((participant) => !participantHasCurrentSubmission(participant));
  const status = document.getElementById("simulatorStatus");
  if (!pendingParticipants.length) {
    if (status) status.textContent = "Auto-Answer armed. No simulated players need to answer.";
    return;
  }
  const remainingMs = Number(state.emergencyTimer?.remainingMs || 0);
  const timerSafetyBuffer = state.emergencyTimer?.kind === "emergency" ? 3_000 : 4_500;
  const maxDelay = remainingMs > 0
    ? Math.max(650, Math.min(9_000, remainingMs - timerSafetyBuffer))
    : 9_000;
  if (status) status.textContent = `Auto-Answer armed for ${pendingParticipants.length} sim player${pendingParticipants.length === 1 ? "" : "s"}.`;
  pendingParticipants.forEach((participant, index) => {
    const minimumDelay = Math.min(maxDelay, 450 + index * 160);
    const spread = Math.max(220, maxDelay - minimumDelay);
    const delay = Math.min(maxDelay, minimumDelay + Math.floor(Math.random() * spread));
    const timerId = window.setTimeout(() => {
      submitSimulatorAutoAnswer(participant, promptId, info);
    }, delay);
    state.simulatorAutoAnswerTimers.push(timerId);
  });
}

function submitSimulatorAutoAnswer(participant, promptId, info) {
  if (!state.simulatorAutoAnswer || state.actionDrivenMode) return;
  if (promptId !== state.playerPromptId || !state.questionPresentationReady || state.answerPending || state.resolutionDelayPending || state.resolved) return;
  if (participantHasCurrentSubmission(participant)) return;
  const shouldBeCorrect = Math.random() < 0.5;
  playerSessionApi.submitAnswer({
    roomCode: state.roomCode,
    playerId: participant.id,
    playerName: participant.name,
    promptId,
    answer: simulatedAnswerFor(info.question, shouldBeCorrect)
  })
    .then(() => playerSessionApi.fetchAnswers(state.roomCode, promptId))
    .then((payload) => handlePlayerAnswersPayload(payload, promptId))
    .catch(() => pollPlayerAnswers());
}

function simulateDeviceAnswers(mode) {
  const info = currentQuestionInfo();
  if (!info.question || !state.playerPromptId) return;
  const promptId = state.playerPromptId;
  if (state.actionDrivenMode) {
    simulateDeviceActions(mode, info);
    return;
  }
  const participants = simulatedAnswerParticipants(info);
  const status = document.getElementById("simulatorStatus");
  if (!participants.length) {
    if (status) status.textContent = "No active simulated/connected players match the current roster.";
    return;
  }
  if (status) status.textContent = `Submitting ${participants.length} simulated answer${participants.length === 1 ? "" : "s"}...`;
  const requests = participants.map((participant, index) => {
    const shouldBeCorrect = mode === "correct" || mode === "mixed" && index % 2 === 0;
    return playerSessionApi.submitAnswer({
      roomCode: state.roomCode,
      playerId: participant.id,
      playerName: participant.name,
      promptId,
      answer: simulatedAnswerFor(info.question, shouldBeCorrect)
    });
  });
  Promise.all(requests).then((results) => {
    const accepted = results.filter((result) => result?.ok).length;
    const rejected = results.length - accepted;
    if (status) {
      status.textContent = rejected
        ? `${accepted} simulated answer${accepted === 1 ? "" : "s"} submitted; ${rejected} rejected.`
        : "Simulated answers submitted.";
    }
    return playerSessionApi.fetchAnswers(state.roomCode, promptId);
  })
    .then((payload) => handlePlayerAnswersPayload(payload, promptId))
    .catch(() => pollPlayerAnswers());
}

function simulateDeviceActions(mode, info = currentQuestionInfo()) {
  if (!state.playerPromptId) return;
  const promptId = state.playerPromptId;
  const participants = simulatedAnswerParticipants(info);
  const status = document.getElementById("simulatorStatus");
  if (!participants.length) {
    if (status) status.textContent = "No active simulated/connected players match the current roster.";
    return;
  }
  if (status) status.textContent = `Submitting ${participants.length} simulated action${participants.length === 1 ? "" : "s"}...`;
  const room = info.actionRoom || state.actionRooms[state.currentQuestion] || actionRoomTypePool[0];
  const requests = participants.map((participant, index) => {
    const style = mode === "correct" ? "positive" : mode === "wrong" ? "negative" : ["positive", "negative", "silly"][index % 3];
    return playerSessionApi.submitAction({
      roomCode: state.roomCode,
      playerId: participant.id,
      playerName: participant.name,
      promptId,
      action: simulatedActionFor(room, participant.name, style)
    });
  });
  Promise.all(requests).then((results) => {
    const accepted = results.filter((result) => result?.ok).length;
    const rejected = results.length - accepted;
    if (status) {
      status.textContent = rejected
        ? `${accepted} simulated action${accepted === 1 ? "" : "s"} submitted; ${rejected} rejected.`
        : "Simulated actions submitted.";
    }
    return playerSessionApi.fetchAnswers(state.roomCode, promptId);
  })
    .then((payload) => handlePlayerAnswersPayload(payload, promptId))
    .catch(() => pollPlayerAnswers());
}

function simulatedActionFor(room, name, style) {
  const category = ["positive", "negative", "silly"].includes(style) ? style : "positive";
  return randomGeneratedAction(category, { room, name, rng: state.rng });
}

const generalActionBank = sharedData.generalActionBank || {};

function generatedActionPool(category, context = {}) {
  if (typeof sharedData.generatedGeneralActionPool === "function") {
    return sharedData.generatedGeneralActionPool(category, context);
  }
  const cleanCategory = generalActionBank[category] ? category : "positive";
  const { verbs, targets } = generalActionBank[cleanCategory] || { verbs: ["Search"], targets: ["the room"] };
  const actions = [];
  for (let i = 0; actions.length < 100; i++) {
    const verb = verbs[i % verbs.length];
    const target = targets[Math.floor(i / verbs.length) % targets.length];
    actions.push(`${verb} ${target}`);
  }
  return actions;
}

function randomGeneratedAction(category, context = {}) {
  if (typeof sharedData.randomGeneralAction === "function") {
    return sharedData.randomGeneralAction(category, context);
  }
  const pool = generatedActionPool(category, context);
  const rng = typeof context.rng === "function" ? context.rng : Math.random;
  return pool[Math.floor(rng() * pool.length)] || `${context.name || "Sim"} searches the room carefully`;
}

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
  if (info.type.locked && info.operator) return connected.filter((participant) => sameName(participant.name, info.operator.name)).slice(0, 1);
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

  fetch("/api/player-remove", {
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
  if (!answer || !state.questionPresentationReady || state.answerPending || state.resolutionDelayPending || state.resolved) return;
  if (state.chatMode) submitPlayerAnswerValue(answer, { source: options.source || "device-auto" });
  else {
    publishPlayerWaiting("resolving");
    resolveChallenge(answer);
  }
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
  return fetch(`/api/feed?ts=${Date.now()}`, { cache: "no-store" })
    .then((response) => response.ok ? response : fetch(`dm-feed.json?ts=${Date.now()}`, { cache: "no-store" }))
    .catch(() => fetch(`dm-feed.json?ts=${Date.now()}`, { cache: "no-store" }));
}

function syncSetupMode() {
  const localDmMode = els.dmEngine.value === "local";
  const actionDrivenMode = Boolean(els.actionDrivenMode?.checked);
  const pastedQuestions = els.questionSource.value === "paste";
  const savedQuestions = els.questionSource.value === "saved";
  const usePools = pastedQuestions && els.difficultyPools.checked;
  const deviceMode = selectedDeviceMode();
  syncDeviceModeClass(deviceMode);
  if (deviceMode === "single" && state.joinLobbyActive) closeJoinLobby();
  els.questionBankGroup.hidden = actionDrivenMode || !pastedQuestions || usePools;
  els.difficultyPoolsGroup.hidden = actionDrivenMode || !pastedQuestions;
  els.difficultyQuestionBanks.hidden = actionDrivenMode || !usePools;
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
  return fetch(localDmTagsEndpoint(provider), { cache: "no-store" })
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
  fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model })
  })
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
    fetch("/api/health", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`)))
      .then(() => ({ label: "Game Server", state: "ok", detail: "Linked" }))
      .catch(() => ({ label: "Game Server", state: "bad", detail: "Offline" })),
    fetch(localDmTagsEndpoint(), { cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`)))
      .then((body) => {
        const provider = selectedLocalDmProvider();
        const count = extractLocalDmModelNames(body, provider).length;
        return { label: "Local Narrator", state: count ? "ok" : "warn", detail: count ? `${count} model${count === 1 ? "" : "s"}` : "No models" };
      })
      .catch(() => ({ label: "Local Narrator", state: "bad", detail: `${localDmProviderLabel()} offline` })),
    fetch("/api/tts/status", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`)))
      .then((body) => ({ label: "Voice System", state: body.available ? "ok" : "warn", detail: body.available ? "Piper ready" : "Optional offline" }))
      .catch(() => ({ label: "Voice System", state: "warn", detail: "Optional offline" }))
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
  return fetch("/api/question-sets", { cache: "no-store" })
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
  fetch("/api/question-sets", {
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
  const useDifficulty = Boolean(els.difficultyPools.checked);
  const texts = {
    mainText: els.questionsInput.value.trim(),
    easyText: els.easyQuestionsInput.value.trim(),
    mediumText: els.mediumQuestionsInput.value.trim(),
    hardText: els.hardQuestionsInput.value.trim()
  };
  const sourceText = useDifficulty
    ? [texts.easyText, texts.mediumText, texts.hardText].join("\n\n").trim()
    : texts.mainText;
  const report = useDifficulty
    ? {
        questions: [
          ...parseQuestions(texts.easyText),
          ...parseQuestions(texts.mediumText),
          ...parseQuestions(texts.hardText)
        ]
      }
    : parseQuestionReport(texts.mainText);
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
    useDifficulty,
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

function renderSavedQuestionSets() {
  if (!els.savedQuestionSetsList || !els.savedQuestionSetsNote) return;
  const sets = readSavedQuestionSets();
  const selected = selectedQuestionSetIds();
  els.savedQuestionSetsNote.textContent = sets.length
    ? `${sets.length} saved set${sets.length === 1 ? "" : "s"}. Check one or more, then choose Saved Question Sets as the source.`
    : "No saved sets yet.";
  els.savedQuestionSetsList.innerHTML = sets.length ? sets.map((set) => {
    const count = savedQuestionSetReport(set).questions.length;
    return `
      <div class="saved-question-row">
        <label class="saved-question-check">
          <input class="questionSetUseCheck" type="checkbox" value="${escapeAttribute(set.id)}" ${selected.has(set.id) ? "checked" : ""}>
          <span>
            <strong>${escapeHtml(set.name)}</strong>
            <small>${count} parsed question${count === 1 ? "" : "s"}${set.useDifficulty ? " · difficulty pools" : ""}</small>
          </span>
        </label>
        <div class="saved-question-actions">
          <button class="secondary loadQuestionSetBtn" type="button" data-set-id="${escapeAttribute(set.id)}">Load</button>
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
  els.difficultyPools.checked = Boolean(set.useDifficulty);
  els.questionsInput.value = set.mainText || "";
  els.easyQuestionsInput.value = set.easyText || "";
  els.mediumQuestionsInput.value = set.mediumText || "";
  els.hardQuestionsInput.value = set.hardText || "";
  els.questionSetNameInput.value = set.name;
  delete els.missionLength.dataset.manual;
  syncSetupMode();
  setLaunchStatus(`Loaded "${set.name}" for editing.`);
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

  if (!els.difficultyPools.checked) return getPastedQuestionReport().questions;

  return [
    ...parseQuestions(els.easyQuestionsInput.value).map((question) => ({ ...question, difficulty: "easy" })),
    ...parseQuestions(els.mediumQuestionsInput.value).map((question) => ({ ...question, difficulty: "medium" })),
    ...parseQuestions(els.hardQuestionsInput.value).map((question) => ({ ...question, difficulty: "hard" }))
  ];
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
  if (!els.difficultyPools.checked) return getPastedQuestionReport();

  const reports = [
    parseQuestionReport(els.easyQuestionsInput.value),
    parseQuestionReport(els.mediumQuestionsInput.value),
    parseQuestionReport(els.hardQuestionsInput.value)
  ];
  return {
    questions: reports.flatMap((report) => report.questions),
    rejected: reports.flatMap((report) => report.rejected)
  };
}

function missionLengthFor(total) {
  const requested = Number(els.missionLength.value);
  if (!total) return 0;
  if (!Number.isFinite(requested) || requested < 1) return total;
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
  const normalRooms = Math.max(0, questionCount - bossQuestions);
  const challengeRooms = normalRooms + groups.length;
  const mapNodes = buildNodes(questionCount);
  const recoveryRooms = mapNodes.filter((node) => node.type === "recovery").length;
  const hasMid = groups.some((group) => group.phase === "mid");
  const hasFinal = groups.some((group) => group.phase === "final");
  const bossText = hasMid && hasFinal
    ? `midpoint ${MID_BOSS_QUESTIONS}-question boss + final ${FINAL_BOSS_QUESTIONS}-question boss`
    : hasFinal
    ? `final ${Math.min(FINAL_BOSS_QUESTIONS, questionCount)}-question boss only`
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
  els.missionLength.max = String(actionDrivenMode ? 30 : Math.max(1, total));
  const manualLength = els.missionLength.dataset.manual === "true";
  if (actionDrivenMode && !manualLength) els.missionLength.value = "5";
  if (!actionDrivenMode && total && !manualLength) els.missionLength.value = String(total);
  const length = actionDrivenMode ? actionMissionLengthFor() : missionLengthFor(total);
  const engine = els.dmEngine.options[els.dmEngine.selectedIndex]?.text || "Local Auto DM";
  const structure = missionStructureSummary(length);
  const bossTest = Boolean(els.bossTestMode?.checked);
  if (els.setupModeStatus) els.setupModeStatus.textContent = deviceMode === "single" ? "Single Device" : "Device Lobby";
  if (els.setupRouteStatus) els.setupRouteStatus.textContent = actionDrivenMode ? `${length} Action Rooms` : total ? `${length} ${bossTest ? "Boss Test" : "Randomized"}` : "Awaiting Bank";
  if (els.setupDmStatus) els.setupDmStatus.textContent = `${engine.replace(" Auto", "")}${state.fastMode ? " Fast" : ""}`;

  els.playerCountNote.textContent = deviceMode === "single"
    ? roster.length ? `${roster.length} player${roster.length === 1 ? "" : "s"} ready for teacher-screen input.` : "Add one player per line for Single Device mode."
    : "Players will join by device after setup.";
  const rejected = report.rejected.length;
  const setPrefix = savedSourceActive
    ? selectedSets.length
      ? `${selectedSets.length} saved set${selectedSets.length === 1 ? "" : "s"} selected. `
      : total
      ? "No saved sets selected; using pasted questions. "
      : "No saved sets selected. "
    : "";
  els.questionCountNote.textContent = actionDrivenMode
    ? `Action-driven mission enabled. The route will use ${length} room${length === 1 ? "" : "s"} and resolve progress from player actions instead of study questions.`
    : total
    ? `${setPrefix}${total} question${total === 1 ? "" : "s"} parsed. Mission will use ${length} question${length === 1 ? "" : "s"} across ${structure.challengeRooms} encounter room${structure.challengeRooms === 1 ? "" : "s"} plus ${structure.recoveryRooms} recovery room${structure.recoveryRooms === 1 ? "" : "s"}. Boss plan: ${structure.bossText}.${structure.warning ? ` ${structure.warning}` : ""}${rejected ? ` ${rejected} block${rejected === 1 ? "" : "s"} could not be parsed.` : ""}`
    : `${setPrefix}No questions parsed yet.`;
  els.questionCountNote.classList.toggle("has-errors", rejected > 0);
  renderParseIssues(report.rejected);
  els.preflightSummary.textContent = false && total
    ? `${players.length} players · ${length} challenges · ${engine}`
    : "Add study questions to begin.";
  els.preflightSummary.textContent = actionDrivenMode
    ? `${deviceMode === "single" ? `${roster.length || 0} players` : "Device join lobby"} - ${length} action rooms - ${engine}${state.fastMode ? " - Fast pacing" : ""}`
    : total
    ? `${deviceMode === "single" ? `${roster.length || 0} players` : "Device join lobby"} - ${length} questions - ${structure.challengeRooms} encounter rooms - ${engine}${bossTest ? " - Boss test start" : ""}${state.fastMode ? " - Fast pacing" : ""}`
    : "Add study questions to begin.";
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
  const sources = [
    els.questionsInput,
    els.easyQuestionsInput,
    els.mediumQuestionsInput,
    els.hardQuestionsInput
  ].filter(Boolean);
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
  const picked = [];

  for (let index = 0; index < count; index++) {
    const desired = desiredDifficultyForEncounter(index, count);
    const fallbacks = desired === "hard" ? ["hard", "medium", "easy"] : desired === "easy" ? ["easy", "medium", "hard"] : ["medium", "easy", "hard"];
    const pool = fallbacks.map((name) => pools[name]).find((candidate) => candidate.length);
    const question = pool ? pool.shift() : remaining[0];
    if (!question) break;
    picked.push(question);
    for (const key of Object.keys(pools)) {
      const position = pools[key].indexOf(question);
      if (position >= 0) pools[key].splice(position, 1);
    }
    const remainingPosition = remaining.indexOf(question);
    if (remainingPosition >= 0) remaining.splice(remainingPosition, 1);
  }

  return picked;
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
    if (question.type === "true-false" && challengeTypes[index]?.kind !== "emergency" && !challengeTypes[index]?.boss) {
      challengeTypes[index] = { label: "True / False Challenge", kind: "truefalse", locked: false, damage: 2 };
    }
    if (question.type === "fill" && challengeTypes[index]?.kind === "emergency") {
      challengeTypes[index] = { label: "Individual Challenge", kind: "individual", locked: false, damage: 2 };
    }
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

  for (let i = 0; i < questionCount;) {
    const bossGroup = bossByStart.get(i);
    if (bossGroup) {
      nodes.push({
        type: "boss",
        bossPhase: bossGroup.phase,
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
    nodes.push({ type: "challenge", questionIndex: i, label: String(i + 1) });
    i += 1;
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
  renderMap();
  renderStatus();

  if (state.currentNode >= state.nodes.length) {
    renderEnding();
    return;
  }

  const node = state.nodes[state.currentNode];
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
  return fetch(`dm-briefing.json?ts=${Date.now()}`, { cache: "no-store" })
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
    els.deploymentReadyMessage.hidden = true;
    els.deploymentReadyMessage.classList.remove("visible");
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
    audio.volume = state.sfxPreset === "cinematic" ? 0.9 : 0.52;
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
    const operatorStageStart = 5450;
    const operatorStaggerMs = 280;
    const operatorCount = Math.max(1, state.players.length);
    const operatorStageEnd = operatorStageStart + ((operatorCount - 1) * operatorStaggerMs) + 900;
    const toolsStageStart = operatorStageEnd + 720;
    const onlineStageStart = toolsStageStart + 1250;

    schedule(520, () => {
      document.body.classList.add("dashboard-stage-map", "dashboard-map-boot");
      playGameSfx("submitted");
    });
    schedule(1880, () => {
      document.body.classList.remove("dashboard-map-boot");
      document.body.classList.add("dashboard-stage-map-lock");
    });
    schedule(2780, () => {
      document.body.classList.add("dashboard-stage-telemetry");
      playDashboardPanelCue();
    });
    schedule(3660, () => {
      document.body.classList.add("dashboard-stage-log");
      playDashboardPanelCue();
    });
    schedule(4380, () => {
      document.body.classList.add("dashboard-stage-encounter");
      playDashboardPanelCue();
    });
    schedule(4980, () => {
      document.body.classList.add("dashboard-stage-status");
      playDashboardPanelCue();
    });
    schedule(operatorStageStart, () => document.body.classList.add("dashboard-stage-operators"));
    state.players.forEach((player, index) => {
      schedule(operatorStageStart + index * operatorStaggerMs, playDashboardOperatorCue);
    });
    schedule(operatorStageEnd, () => {
      document.body.classList.add("dashboard-stage-supplies");
      playDashboardPanelCue();
    });
    schedule(toolsStageStart, () => {
      document.body.classList.add("dashboard-stage-tools");
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
    audio.volume = state.sfxPreset === "cinematic" ? 0.88 : 0.5;
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
    audio.volume = state.sfxPreset === "cinematic" ? 0.72 : 0.38;
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
    .map((player, index) => `<div class="deployment-player" style="--roster-delay:${index * 0.16}s"><strong>${escapeHtml(player.name)}</strong><span>5 HP · READY</span></div>`)
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
  const theme = normalize(`${state.missionType} ${state.environment}`);
  if (/fantasy|arcane|magic/.test(theme)) return "arcane";
  if (/naval|carrier|ship|submarine/.test(theme)) return "naval";
  if (/space|alien|orbital|station/.test(theme)) return "scifi";
  if (/horror|ghost|haunt/.test(theme)) return "horror";
  return "military";
}

function applyDashboardAtmosphere() {
  if (!document.body) return;
  const node = state.nodes[state.currentNode];
  const actionPressure = Boolean(state.actionDrivenMode && currentQuestionInfo()?.actionRoom?.pressureSpotlight);
  const roster = state.players.filter(Boolean);
  const partySize = roster.length;
  const lowCount = roster.filter((player) => player.incapacitated || Number(player.hp) <= 2).length;
  const woundedCount = roster.filter((player) => player.incapacitated || Number(player.hp) <= 3).length;
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
    horror: "EMERGENCY SIGNAL RECOVERY",
    military: "TACTICAL UPLINK",
    scifi: "SENSOR CALIBRATION",
    arcane: "WARD CIRCUIT TRACE",
    naval: "COMPARTMENT SONAR LINK"
  };
  return labels[deploymentThemeClass()];
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
    horror: ["Static spike detected beyond mapped rooms.", "A secondary carrier answers with no identifiable source.", "Emergency channel opens, then cuts to silence."],
    military: ["Forward relay responding.", "Route integrity scan in progress.", "Field telemetry packet acknowledged."],
    scifi: ["Hull-adjacent sensor echo detected.", "Maintenance ring pressure nominal.", "Unknown waveform riding the station bus."],
    arcane: ["Outer ward answering unevenly.", "Residual charge detected beneath the route seal.", "A second pattern traces itself and disappears."],
    naval: ["Sonar return crosses an unlisted compartment.", "Bulkhead pressure reports received.", "A contact fades beneath the machinery noise."]
  };
  return fragments[deploymentThemeClass()];
}

function collapseMissionBriefing() {
  els.briefingCard.classList.add("briefing-collapsed");
}

function renderStatus() {
  const playerCards = state.players.map((player, index) => `
    <div class="status-card ${playerStatusClasses(player)} ${playerPromptStatusClasses(player)}" style="--player-color:${playerColor(player.name)}; --turn-rank:${actionTurnRank(player)}; --operator-boot-index:${index}" data-player-index="${index}" data-player-name="${escapeAttribute(player.name)}">
      <div class="status-card-heading">
        <strong title="${escapeAttribute(player.name)}"><span class="player-colored-name">${escapeHtml(displayPlayerName(player.name))}</span></strong>
        ${actionTurnBadge(player)}
        ${lockedOperatorBadge(player)}
        ${answerSubmissionBadge(player)}
        ${answerResultBadge(player)}
      </div>
      <div class="status-vitals">
        <strong>${Math.max(0, player.hp)} HP</strong>
        <span class="${statusCodeClass(player)}" title="${escapeAttribute(player.status.length ? player.status.join(", ") : "No status effects")}">${escapeHtml(statusCodeText(player))}</span>
        ${playerBonusBadge(player)}
      </div>
    </div>
  `).join("");

  els.statusGrid.innerHTML = `
    ${playerCards}
  `;
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
  publishPlayerVitals();
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
  return classes.join(" ");
}

function lockedOperatorBadge(player) {
  if (!state.started || !state.questionPresentationReady || state.answerPending || state.resolved || state.actionDrivenMode) return "";
  const info = currentQuestionInfo();
  if (!info?.type?.locked || !info.operator || !sameName(player.name, info.operator.name)) return "";
  return `<span class="locked-operator-badge" title="Locked operator" aria-label="Locked operator">LOCKED</span>`;
}

function answerSubmissionBadge(player) {
  if (!state.started || state.deviceMode !== "multi" || !state.questionPresentationReady || state.answerPending || state.resolved) return "";
  if (!participantHasCurrentSubmission({ name: player.name })) return "";
  return `<span class="answer-submit-badge" title="Submitted" aria-label="Submitted">Submitted</span>`;
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
  if (player.hp <= 2) return "status-code-low";
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

function renderPreviousAnswer() {
  const previous = state.previousAnswer;
  els.lastAnswerPanel.hidden = !previous;
  if (!previous) return;

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
  else if (player.hp <= 2) classes.push("low-health");

  for (const status of player.status) {
    classes.push(`has-${normalize(status).trim().replace(/\s+/g, "-")}`);
  }

  return classes.join(" ");
}

function setMissionFailureVisual(active) {
  const failed = Boolean(active);
  els.mapPanel?.classList.toggle("mission-failed", failed);
  document.body.classList.toggle("situation-failure", failed);
  if (els.mapFailureOverlay) els.mapFailureOverlay.hidden = !failed;
}

function renderMap() {
  applyDashboardAtmosphere();
  syncEmsFieldVisual();
  els.mapTitle.textContent = state.title || "Awaiting Mission";
  els.missionMap.innerHTML = "";
  if (!state.nodes.length) {
    renderMapQuestionOverlay();
    return;
  }

  const positions = routePositions(state.nodes.length);
  const height = Math.max(510, Math.max(...positions.map((pos) => pos.y)) + 76);
  els.missionMap.setAttribute("viewBox", `0 0 900 ${height}`);
  let activeTransition = null;
  const routeVisible = state.teamReady || state.currentQuestion > 0 || state.currentNode > 0 || state.questionPresentationReady || state.bossReadyPending;
  for (let i = 0; i < positions.length - 1; i++) {
    const transmitting = state.routeTransition?.from === i
      && state.routeTransition?.to === i + 1
      && state.transmissionPending
      && state.routeTransition.moving;
    const line = svg("line", {
      x1: positions[i].x,
      y1: positions[i].y,
      x2: positions[i + 1].x,
      y2: positions[i + 1].y,
      class: `route-line ${i < state.currentNode ? "cleared" : ""}`
    });
    els.missionMap.appendChild(line);
    if (transmitting) {
      activeTransition = {
        from: positions[i],
        to: positions[state.routeTransition.to] || positions[i + 1],
        correct: state.routeTransition.correct
      };
    }
  }

  state.nodes.forEach((node, index) => {
    const pos = positions[index];
    const group = svg("g", {});
    const receiving = state.transmissionPending && state.routeTransition?.to === index;
    const status = index < state.currentNode ? "cleared" : routeVisible && index === state.currentNode ? "current" : receiving ? "receiving" : "base";
    const discovered = index < state.currentNode || (routeVisible && index <= state.currentNode);
    const resultClass = discovered && node.type !== "recovery" && state.nodeResults[index] !== undefined
      ? state.nodeResults[index] ? "correct" : "incorrect"
      : "";
    const typeClass = resultClass || (discovered && node.type === "boss" ? "boss" : discovered && node.type === "recovery" ? "recovery" : "");
    const radius = discovered && node.type === "boss" ? 28 : discovered && node.type === "recovery" ? 24 : 21;
    group.appendChild(svg("circle", { cx: pos.x, cy: pos.y, r: radius, class: `map-node ${typeClass || status} ${status}` }));
    group.appendChild(svg("text", { x: pos.x, y: pos.y + 6, class: "map-label" }, discovered ? node.label : "?"));
    group.appendChild(svg("text", { x: pos.x, y: pos.y + 47, class: "map-room-name" }, roomName(node, index)));
    els.missionMap.appendChild(group);
  });

  if (activeTransition) {
    appendMovingRouteTrail(activeTransition.from, activeTransition.to, activeTransition.correct);
    appendMovingSquadMarker(activeTransition.from, activeTransition.to, activeTransition.correct);
  } else if (state.started && routeVisible && positions[state.currentNode]) {
    appendStationarySquadMarker(positions[state.currentNode]);
  }

  els.mapPanel.classList.toggle("transmission-active", state.transmissionPending);
  els.mapPanel.classList.toggle("transmission-incorrect", Boolean(state.transmissionPending && state.routeTransition && !state.routeTransition.correct));
  els.mapPanel.classList.toggle("transmission-boss", Boolean(state.transmissionPending && state.routeTransition?.boss));
  els.mapPanel.classList.toggle("boss-encounter", state.nodes[state.currentNode]?.type === "boss");
  syncBossEyesVisual();
  renderRouteTelemetry();
  renderMapQuestionOverlay();
}

function appendMovingRouteTrail(from, to, correct) {
  const nearX = from.x + (to.x - from.x) * 0.9;
  const nearY = from.y + (to.y - from.y) * 0.9;
  const animations = [];
  const trail = svg("line", {
    x1: from.x,
    y1: from.y,
    x2: from.x,
    y2: from.y,
    class: `route-trail ${correct ? "correct" : "incorrect"}`
  });
  const duration = `${ROUTE_TRAVEL_MS / 1000}s`;
  animations.push(svg("animate", { attributeName: "x2", from: from.x, to: nearX, dur: duration, begin: "indefinite", fill: "freeze" }));
  animations.push(svg("animate", { attributeName: "y2", from: from.y, to: nearY, dur: duration, begin: "indefinite", fill: "freeze" }));
  animations.forEach((animation) => trail.appendChild(animation));
  els.missionMap.appendChild(trail);
  beginSvgAnimations(animations, 280);
}

function appendMovingSquadMarker(from, to, correct) {
  const marker = svg("g", { class: `squad-marker ${correct ? "correct" : "incorrect"}` });
  const animations = [];
  const halo = svg("circle", {
    cx: from.x,
    cy: from.y,
    r: 14,
    class: "squad-marker-halo"
  });
  const dot = svg("circle", {
    cx: from.x,
    cy: from.y,
    r: 8,
    class: "squad-marker-dot"
  });
  const nearX = to.x;
  const nearY = to.y;
  halo.appendChild(svg("animate", { attributeName: "r", values: "10;26;10", dur: "1.8s", repeatCount: "indefinite" }));
  halo.appendChild(svg("animate", { attributeName: "opacity", values: "0.8;0.12;0.8", dur: "1.8s", repeatCount: "indefinite" }));
  for (const part of [halo, dot]) {
    const duration = `${ROUTE_TRAVEL_MS / 1000}s`;
    const xAnimation = svg("animate", { attributeName: "cx", from: from.x, to: nearX, dur: duration, begin: "indefinite", fill: "freeze" });
    const yAnimation = svg("animate", { attributeName: "cy", from: from.y, to: nearY, dur: duration, begin: "indefinite", fill: "freeze" });
    animations.push(xAnimation, yAnimation);
    part.appendChild(xAnimation);
    part.appendChild(yAnimation);
    marker.appendChild(part);
  }
  els.missionMap.appendChild(marker);
  beginSvgAnimations(animations);
}

function beginSvgAnimations(animations, delay = 0) {
  window.setTimeout(() => {
    window.requestAnimationFrame(() => {
      animations.forEach((animation) => {
        if (typeof animation.beginElement === "function") animation.beginElement();
      });
    });
  }, delay);
}

function appendStationarySquadMarker(pos) {
  const marker = svg("g", { class: "squad-marker stationary" });
  const halo = svg("circle", {
    cx: pos.x,
    cy: pos.y,
    r: 14,
    class: "squad-marker-halo"
  });
  const dot = svg("circle", {
    cx: pos.x,
    cy: pos.y,
    r: 8,
    class: "squad-marker-dot"
  });
  halo.appendChild(svg("animate", { attributeName: "r", values: "10;22;10", dur: "2.2s", repeatCount: "indefinite" }));
  halo.appendChild(svg("animate", { attributeName: "opacity", values: "0.66;0.14;0.66", dur: "2.2s", repeatCount: "indefinite" }));
  marker.appendChild(halo);
  marker.appendChild(dot);
  els.missionMap.appendChild(marker);
}

function renderMapQuestionOverlay() {
  if (!els.mapQuestionOverlay) return;
  const info = currentQuestionInfo();
  const node = state.nodes[state.currentNode];
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
      <p>${escapeHtml(info.question.question)}</p>
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
  if (info.type.locked && info.operator) return count ? `${info.operator.name} submitted` : `Waiting for ${info.operator.name}`;
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
  const corners = [
    { col: 0, row: 0 },
    { col: cols - 1, row: 0 },
    { col: 0, row: rows - 1 },
    { col: cols - 1, row: rows - 1 }
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
    const start = corners[Math.floor(rng() * corners.length)];
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
  return route.map((cell, index) => ({
    x: 78 + cell.col * xGap + (rng() - 0.5) * 28,
    y: 68 + cell.row * yGap + (rng() - 0.5) * 18 + (index % 2 ? 3 : -3)
  }));
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
  state.questionPresentationReady = false;
  const presentationRunId = beginLogPresentation();
  const q = state.questions[state.currentQuestion];
  const type = challengeType(state.currentQuestion, state.questions.length);
  const operator = type.locked ? selectOperator(state.currentQuestion) : null;
  const setup = makeSetup(type, operator, q);
  state.encounter = { node, question: q, type, operator };
  state.resolved = false;
  state.selectedEMS = false;

  const choicesHtml = q.mode === "multiple"
    ? `<div class="choices">${q.choices.map((choice) => `<div class="choice-chip">${choice.key}. ${escapeHtml(choice.text)}</div>`).join("")}</div>`
    : "";

  els.encounterCard.innerHTML = `
    <span class="encounter-tag">${escapeHtml(formatEncounterTag(type.label))}</span>
    <h3>${escapeHtml(setup.heading)}</h3>
    <p class="typewriter" data-text="${escapeAttribute(setup.story)}"></p>
    <div class="question-text pending-content">
      <strong>${q.mode === "fill" ? "Fill in the blank:" : "Question:"}</strong>
      <p>${escapeHtml(q.question)}</p>
      ${choicesHtml}
    </div>
  `;

  els.answerControls.innerHTML = "";
  typeQueuedText(els.encounterCard).then(() => {
    const questionBlock = els.encounterCard.querySelector(".question-text");
    if (questionBlock) questionBlock.classList.remove("pending-content");
    finishLogPresentation(presentationRunId);
    queueMapQuestionReveal(() => {
      startEmergencyTimerForCurrentEncounter(type, { publish: false });
      publishCurrentPlayerPrompt({ renderOverlay: false });
      renderAnswerControls(q);
    });
  });
}

function renderChatCheckpoint(node) {
  clearTypewriters();
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
    appendBossTestCheckpointPrompt();
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
  const controlsLocked = state.answerPending || state.sideActionPending || presentationLocked;
  const emergencyActive = state.emergencyTimer?.kind === "emergency";
  const sideActionUsed = state.sideActionRooms.has(state.currentNode);
  const sideActionAvailable = actionsAllowedThisEncounter();
  const actionModeActive = Boolean(state.actionDrivenMode && state.teamReady && !readyCheckActive);
  const narrowed = new Set(state.narrowedChoices[state.currentQuestion] || []);
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
      <div id="answerSubmitState" class="answer-submit-state ${state.answerPending ? "pending" : ""}">
        ${state.answerPending ? `${escapeHtml(state.lastSubmittedAnswer)}. Receiving transmission.` : presentationLocked ? "Incoming mission prompt..." : "Collecting answers from player devices."}
      </div>
    </div>
  ` : `
    <form id="playerAnswerForm" class="player-answer-form">
      <label>
        Player Answer
        ${quickAnswers.length ? `
          <div class="quick-answer-row">
            ${quickAnswers.map((letter) => `<button class="quickAnswerBtn secondary" data-answer="${letter}" type="button" ${controlsLocked || narrowed.has(letter) ? "disabled" : ""}>${letter}</button>`).join("")}
          </div>
        ` : ""}
        <div class="answer-submit-row">
          <input id="playerAnswerInput" type="text" autocomplete="off" placeholder="${quickAnswers.length ? "A, B, C, D, or a short answer" : "Enter a short answer"}" ${controlsLocked ? "disabled" : ""}>
          <button id="submitPlayerAnswerBtn" type="submit" ${controlsLocked ? "disabled" : ""}>Submit</button>
        </div>
      </label>
      <div id="answerSubmitState" class="answer-submit-state ${state.answerPending ? "pending" : ""}">
        ${state.answerPending ? `Answer sent: ${escapeHtml(state.lastSubmittedAnswer)}. Receiving transmission.` : presentationLocked ? "Incoming mission prompt..." : "Submit from here for faster table flow."}
      </div>
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
    </div>
  `;

  if (els.missionControlsPanel) {
    els.missionControlsPanel.innerHTML = `
      <div class="mission-controls-body">
        ${primaryMissionButton}
        ${manualFallbackPanel}
        ${sideActionOutsideAnswer}
        ${dmToolsPanel}
      </div>
    `;
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
  state.bossReadyPending = false;
  state.bossReadyChecks.add(state.currentNode);
  state.questionPresentationReady = false;
  state.answerPending = false;
  state.lastSubmittedAnswer = "";

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

  fetch("/api/answer", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  })
    .then(() => {
      if (state.localDmMode) resolveLocalSubmittedAnswer(cleanAnswer);
    })
    .catch(() => {
      state.answerPending = false;
      renderChatControls();
      const currentStatus = document.getElementById("answerSubmitState");
      if (currentStatus) currentStatus.textContent = "Answer could not be sent. Try again.";
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
    warningPlayed: false
  };
  if (type.kind === "emergency" || actionPressure) playGameSfx("emergency");
  state.emergencyTimer.interval = window.setInterval(tickEmergencyTimer, 100);
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
      renderTimerSurfaces();
      publishTimerStateToPlayers();
    }, deliveryGraceMs);
  }
  renderTimerSurfaces();
  if (options.publish !== false) publishPlayerSession({ status: "open", prompt: buildPlayerPrompt(), resetAnswers: false });
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
    timer.paused = false;
    timer.deadline = Date.now() + timer.remainingMs;
  } else {
    timer.remainingMs = Math.max(0, timer.deadline - Date.now());
    timer.paused = true;
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
  timer.paused = false;
  timer.deadline = Date.now() + timer.remainingMs;
  renderTimerSurfaces();
  publishTimerStateToPlayers();
}

function publishTimerStateToPlayers() {
  if (!state.started || state.deviceMode !== "multi" || !state.roomCode) return;
  publishPlayerSession({ prompt: buildPlayerPrompt(), resetAnswers: false });
}

function stopEmergencyTimer() {
  const timer = state.emergencyTimer;
  if (timer?.interval) window.clearInterval(timer.interval);
  if (timer?.startGraceTimer) window.clearTimeout(timer.startGraceTimer);
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
    logDebugEvent({
      kind: "state",
      label: "Timer timeout ignored",
      detail: blockers.join(" | ")
    });
    stopEmergencyTimer();
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
  const routeTo = bossProgress && !bossProgress.finalStep
    ? state.currentNode
    : Math.min(state.nodes.length - 1, state.currentNode + 1);
  state.transmissionPending = true;
  state.transmissionStartedAt = Date.now();
  state.routeTransition = {
    from: state.currentNode,
    to: routeTo,
    correct: Boolean(correct),
    boss: Boolean(context.type?.boss),
    moving: false
  };
  updateCurrentNodeResult(Boolean(correct));
  renderStatus();
  flashStatusEffects(playerEvents.map((event) => ({ player: findPlayer(event), kind: event.effect, amount: event.amount })).filter((event) => event.player));
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
  const transition = payload.deferredRouteTransition;
  if (!transition) return 0;
  if (state.transmissionUiTimer) window.clearInterval(state.transmissionUiTimer);
  state.transmissionUiTimer = null;
  state.transmissionPending = true;
  state.transmissionStartedAt = Date.now();
  state.routeTransition = { ...transition };
  state.routeTransition.moving = transition.to !== transition.from;
  if (state.routeTransition.moving && !state.routeTransition.soundPlayed) {
    state.routeTransition.soundPlayed = true;
    playGameSfx("transition");
  }
  renderMap();
  renderRouteTelemetry();
  return state.transmissionStartedAt;
}

function stopTransmissionFeedback(render = false) {
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
  rememberPreviousAnswer(answer, context.question, correct);
  const result = applyEncounter(correct, context.type, context.operator);
  const playerEvents = changedPlayerEvents(before, result.eventNotes);
  const currentArea = context.node?.type === "boss"
    ? roomName(context.node, state.currentNode)
    : context.question.area || roomName(context.node, state.currentNode);
  if (teamFullyIncapacitated()) {
    beginLocalTeamFailure({ context, result, currentArea, playerEvents });
    return;
  }
  const nextInfo = nextLocalQuestionInfo();
  const statusLog = result.lootStatus || "";
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
    typePatch: {
      emergencyAnswerPlayer: player || null,
      emergencySlow: slow
    }
  });
}

function resolveLocalDeviceTeamAnswers(answers) {
  if (!state.localDmMode || state.resolved || state.answerPending) return;
  if (state.nodes[state.currentNode]?.type === "recovery") return;
  const context = currentLocalContext();
  if (!context.question || !["individual", "team", "truefalse"].includes(context.type.kind)) return;
  if (!everyoneActiveSubmitted(answers)) {
    logDebugEvent({
      kind: "state",
      label: "Device answer resolution blocked",
      detail: `waiting for required responders: ${[...requiredDeviceAnswerNames(currentQuestionInfo())].join(", ") || "unknown"}`
    });
    return;
  }

  const entries = deviceTeamAnswerEntries(answers, context.question);
  if (!entries.length || entries.some((entry) => !entry.answer)) return;
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
  const result = applyDeviceTeamEncounter(entries, context.type);
  const playerEvents = changedPlayerEvents(before, result.eventNotes);
  const currentArea = context.node?.type === "boss"
    ? roomName(context.node, state.currentNode)
    : context.question.area || roomName(context.node, state.currentNode);
  if (teamFullyIncapacitated()) {
    beginLocalTeamFailure({ context, result, currentArea, playerEvents });
    return;
  }

  const nextInfo = nextLocalQuestionInfo();
  const statusLog = result.lootStatus || "";
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
  const areaName = node?.type === "boss" ? roomName(node, state.currentNode) : question?.area || roomName(node, state.currentNode);
  const activeObstacle = getActiveObstacle(state.currentQuestion, question, type, areaName);
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
    if (!hpChanged && !statusChanged && !downChanged) return [];
    const lost = Math.max(0, old.hp - player.hp);
    const gained = Math.max(0, player.hp - old.hp);
    const cause = eventNotes[player.name] || "";
    const note = player.incapacitated && !old.incapacitated
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
      effect: gained ? "heal" : lost ? "hit" : "status",
      amount: lost || gained || 0,
      note,
      cause
    }];
  });
}

function nextLocalQuestionInfo() {
  const bossProgress = currentBossProgress();
  const nextNodeIndex = bossProgress && !bossProgress.finalStep ? state.currentNode : state.currentNode + 1;
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

  const nextIndex = Math.min(state.currentQuestion + 1, state.questions.length - 1);
  const question = state.questions[nextIndex];
  const type = challengeType(nextIndex, state.questions.length);
  const operator = type.locked ? selectOperator(nextIndex) : null;
  const sameBossRoom = bossProgress && !bossProgress.finalStep;
  const areaName = sameBossRoom ? roomName(state.nodes[state.currentNode], state.currentNode) : question?.area || "Unknown Area";
  return {
    index: nextIndex,
    question,
    type,
    tag: state.currentQuestion + 1 >= state.questions.length ? "Final Mission Result" : type.label,
    operator,
    sameBossRoom,
    areaName,
    activeObstacle: getActiveObstacle(nextIndex, question, type, areaName),
    questionText: state.currentQuestion + 1 >= state.questions.length ? "" : localQuestionText(question, type, operator, nextIndex)
  };
}

function recoveryQuestionText(node) {
  const hp = node.tier === 1 ? 2 : 4;
  const medkits = node.tier === 1 ? 2 : 3;
  const ems = node.tier === 1 ? 1 : 2;
  const revive = state.players.some((player) => player.incapacitated)
    ? "\n\nOne incapacitated player will be revived for free."
    : "";
  return `Choose one recovery option:\n\nA. Everyone active recovers ${hp} HP\nB. Gain ${medkits} Medkits\nC. Gain ${ems} EMS Device${ems > 1 ? "s" : ""}${revive}`;
}

function recoveryAreaName(node) {
  if (node?.afterBoss) return "Emergency Shelter";
  return node?.tier === 1 ? "Emergency Aid Station" : "Fortified Maintenance Hub";
}

function resolveLocalRecovery(answer) {
  const node = state.nodes[state.currentNode];
  if (!node || node.type !== "recovery") return;
  state.resolved = true;
  const before = snapshotPlayers();
  const choice = String(answer).trim().toUpperCase();
  const hp = node.tier === 1 ? 2 : 4;
  const medkits = node.tier === 1 ? 2 : 3;
  const ems = node.tier === 1 ? 1 : 2;
  const down = state.players.find((player) => player.incapacitated);
  if (down) {
    down.incapacitated = false;
    down.hp = 3;
    down.status = [];
  }

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
  state.currentNode = Math.min(state.nodes.length, state.currentNode + 1);
  state.resolved = false;
  const qInfo = currentQuestionInfo();
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
    `Next area: ${qInfo.areaName}.`,
    `Next question concept: ${qInfo.question?.question || "final route"}`
  ].join("\n");

  setAnswerPendingText("Receiving recovery transmission...");
  startPassiveTransmissionFeedback({ type: { label: "Recovery Event" }, playerEvents });
  requestOllama(prompt, { temperature: 0.72 })
    .then((text) => {
      stopTransmissionFeedback();
      appendTranscript({
        tag: qInfo.tag,
        areaName: qInfo.areaName,
        story: cleanLocalNarration(text) || `The team takes the recovery window and pushes into ${qInfo.areaName}.`,
        activeObstacle: qInfo.activeObstacle,
        question: qInfo.questionText,
        players: playerEvents,
        inventory: { ...state.inventory },
        statusLog: [choiceText, reviveText].filter(Boolean).join(" ")
      });
      renderStatus();
      renderMap();
    })
    .catch(() => {
      stopTransmissionFeedback();
      appendTranscript({
        tag: qInfo.tag,
        areaName: qInfo.areaName,
        story: `The team takes the recovery window, seals what wounds they can, and pushes into ${qInfo.areaName}.`,
        activeObstacle: qInfo.activeObstacle,
        question: qInfo.questionText,
        players: playerEvents,
        inventory: { ...state.inventory },
        statusLog: [choiceText, reviveText].filter(Boolean).join(" ")
      });
      renderStatus();
      renderMap();
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
  const type = challengeType(state.currentQuestion, state.questions.length);
  const operator = type.locked ? selectOperator(state.currentQuestion) : null;
  const node = state.nodes[state.currentNode];
  const areaName = node?.type === "boss"
    ? roomName(node, state.currentNode)
    : question?.area || "Unknown Area";
  return {
    question,
    type,
    tag: type.label,
    operator,
    areaName,
    questionText: localQuestionText(question, type, operator),
    activeObstacle: getActiveObstacle(state.currentQuestion, question, type, areaName)
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
  if (question.mode === "fill") return `${prefix}${question.question}`;
  const narrowed = new Set(state.narrowedChoices[questionIndex] || []);
  const choices = question.choices
    .filter((choice) => !narrowed.has(choice.key))
    .map((choice) => `${choice.key}. ${choice.text}`)
    .join("\n");
  return `${prefix}${question.question}\n\n${choices}`;
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
  const guidance = "Invent the exact physical interaction from the room, threat, and study concept; vary machinery, tools, obstacles, enemies, panels, wiring, valves, antennas, doors, drones, consoles, conduits, relays, meters, or field gear as appropriate. Avoid generic workstation-sync phrasing unless the area explicitly requires it.";
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
  const notable = state.players.filter((player) => affected.has(normalize(player.name)) || player.incapacitated || player.status.length || player.hp <= 2);
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
    });
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
  return fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      prompt,
      temperature: options.temperature || 0.75,
      format: options.format || undefined,
      think: options.think ?? false
    })
  })
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

function renderDebugConsole() {
  renderUtilityPanels();
  if (!els.debugConsoleLog) return;
  els.debugConsoleLog.innerHTML = state.debugEvents.length
    ? state.debugEvents.map((event) => `
      <div class="debug-console-row ${escapeAttribute(event.kind || "")}">
        <span>${escapeHtml(event.at.toLocaleTimeString([], { hour12: false }))}</span>
        <strong>${escapeHtml(event.label || "Event")}</strong>
        <p>${escapeHtml(event.detail || "")}</p>
      </div>
    `).join("")
    : "<p>No debug events yet.</p>";
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
  addMissionLogHistory(payload);
  const hasContinuationGate = Boolean(payload.advanceRoom && payload.continuationStory);
  const deferQuestionUntilContinuation = hasContinuationGate && Boolean(payload.isRecovery);
  const presentationRunId = beginLogPresentation();
  const bossProgressBeforeAdvance = currentBossProgress();
  const keepBossTimer = payload.question
    && state.emergencyTimer?.kind === "boss"
    && bossProgressBeforeAdvance
    && !bossProgressBeforeAdvance.finalStep;
  if (payload.readyCheck) {
    state.bossReadyPending = true;
    startBossReadyAudio(payload);
    if (state.backgroundMusicMode === "normal") fadeOutBackgroundMusicForBossReady();
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

  if (payload.tag && !payload.hideLogTag) {
    const tag = document.createElement("div");
    tag.className = "log-tag";
    tag.textContent = missionLogTagText(payload);
    entry.appendChild(tag);
  }

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
  const readyCheckAudioLeadMs = payload.readyCheck ? 500 : 0;
  const typing = delayPresentation(autoRead.visualDelay + readyCheckAudioLeadMs).then(() => {
    if (payload.question) startBossQuestionMusic();
    return typeQueuedText(entry);
  });
  typing.then(() => {
    return waitForTtsPlayback(autoRead.playback);
  }).then(() => {
    if (presentationRunId !== state.logPresentationRunId) return;
    finishLogPresentation(presentationRunId);
    if (typeof payload.onTypedComplete === "function") payload.onTypedComplete(entry, payload);
    if (deferStatusPresentation) {
      const deferredEntry = document.createElement("div");
      appendDamageLog(deferredEntry, payload);
      const deferredEffects = applyFeedState(payload);
      if (deferredEffects.length && !payload.suppressEffectFlash) flashStatusEffects(deferredEffects);
    }
    startMissionLogAutoScroll({ startAtBottom: true });
    if (hasContinuationGate) {
      renderMissionContinueGate(entry, payload);
      return;
    }
    if (payload.teamReadyGate) {
      renderTeamReadyGate(entry);
      return;
    }
    if (payload.readyCheck) {
      if (state.chatMode) renderChatControls();
      renderBossReadyGate(entry);
      return;
    }
    if (payload.isRecovery) {
      if (state.chatMode) renderChatControls();
      renderRecoveryGateForEntry(entry, payload);
      return;
    }
    finishTranscriptQuestionFlow(payload);
  });
  return true;
}

function completeTranscriptAdvance(payload) {
  if (payload.advanceRoom) advanceChatProgress(Boolean(payload.correct));
  applyFeedRoom(payload);
  registerActiveObstacleFromPayload(payload);
  if (payload.question || payload.advanceRoom) clearSubmittedAnswer();
}

function finishTranscriptQuestionFlow(payload) {
  if (payload.readyCheck) {
    if (state.chatMode) renderChatControls();
  } else if (payload.question) {
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

function renderBossReadyGate(entry) {
  const gate = document.createElement("div");
  gate.className = "mission-continue-gate boss-ready-gate";
  gate.innerHTML = `
    <button id="missionBossReadyBtn" type="button">Continue</button>
    <span>Begin critical contact</span>
  `;
  entry.appendChild(gate);
  startMissionLogAutoScroll({ startAtBottom: true });
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
  const hp = tier === 1 ? 2 : 4;
  const medkits = tier === 1 ? 2 : 3;
  const ems = tier === 1 ? 1 : 2;
  renderRecoveryChoiceGate(entry, tier, { hp, medkits, ems });
  startMissionLogAutoScroll({ startAtBottom: true });
}

function revealMissionContinuation(entry, payload, gate) {
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
  delayPresentation(autoRead.visualDelay).then(() => typeText(continuation, payload.continuationStory)).then(() => {
    return waitForTtsPlayback(autoRead.playback);
  }).then(() => {
    if (runId !== state.logPresentationRunId) return;
    const finishContinuation = () => {
      if (payload.deferredRouteTransition && state.transmissionPending) stopTransmissionFeedback(false);
      completeTranscriptAdvance(payload);
      renderActionRoomArrivalAfterTransition(continuationEntry, payload, runId).then((handledArrival) => {
        if (runId !== state.logPresentationRunId) return;
        finishLogPresentation(runId);
        startMissionLogAutoScroll({ startAtBottom: true });
        recordSceneHistory({ ...payload, story: payload.continuationStory });
        if (payload.readyCheck) {
          if (state.chatMode) renderChatControls();
          renderBossReadyGate(continuationEntry);
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
    const routeHold = transitionStartedAt ? Math.max(0, ROUTE_TRAVEL_MS - (Date.now() - transitionStartedAt)) : 0;
    if (routeHold) window.setTimeout(finishContinuation, routeHold);
    else finishContinuation();
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

function queueMapQuestionReveal(onReady) {
  const revealRunId = ++state.questionRevealRunId;
  const alertDelay = window.setTimeout(() => {
    if (revealRunId !== state.questionRevealRunId || state.resolved) return;
    state.questionSurfaceVisible = false;
    state.questionPresentationReady = false;
    state.mapQuestionAlertActive = true;
    state.mapQuestionOverlayKey = "";
    const alertInfo = currentQuestionInfo();
    if (!state.actionDrivenMode && alertInfo?.type?.kind !== "action") playGameSfx("question");
    renderMapQuestionOverlay();
    const revealDelay = window.setTimeout(() => {
      if (revealRunId !== state.questionRevealRunId || state.resolved) return;
      state.mapQuestionAlertActive = false;
      state.questionSurfaceVisible = true;
      state.questionPresentationReady = false;
      resetStatusUpdates();
      state.mapQuestionOverlayKey = "";
      renderMapQuestionOverlay();
      const autoRead = maybeAutoReadQuestion({ allowBeforeReady: true });
      Promise.resolve(autoRead.playback).catch(() => {});
      const unlockDelay = Math.min(1200, Math.max(250, Number(autoRead.visualDelay) || 0));
      const unlockTimer = window.setTimeout(() => {
        if (revealRunId !== state.questionRevealRunId || state.resolved) return;
        state.questionSurfaceVisible = false;
        state.questionPresentationReady = true;
        renderMapQuestionOverlay();
        if (typeof onReady === "function") onReady();
      }, unlockDelay);
      state.typeTimers.push(unlockTimer);
    }, questionRevealDelayMs());
    state.typeTimers.push(revealDelay);
  }, questionAlertDelayMs());
  state.typeTimers.push(alertDelay);
}

function shouldShowTranscriptQuestion(payload) {
  const tag = String(payload.tag || "").toLowerCase();
  if (payload.readyCheck || tag.includes("readiness")) return false;
  if (tag.includes("recovery")) return true;
  if (state.nodes[state.currentNode]?.type === "recovery") return true;
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
  renderInventoryActions();
  return state.logPresentationRunId;
}

function finishLogPresentation(runId) {
  if (runId !== state.logPresentationRunId) return;
  state.logPresentationPending = false;
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
    if (Number.isFinite(Number(event.hp))) player.hp = Math.max(0, Math.min(5, Number(event.hp)));
    if (Number.isFinite(Number(event.delta))) player.hp = Math.max(0, Math.min(5, player.hp + Number(event.delta)));
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
    const line = document.createElement("p");
    line.textContent = payload.statusLog;
    log.appendChild(line);
  }

  for (const event of events) {
    const line = document.createElement("p");
    line.textContent = formatStatusEvent(event);
    log.appendChild(line);
  }

  appendStatusUpdateLog(log, entry);
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
  if (!numeric || !["hit", "heal"].includes(kind)) return;
  card.querySelectorAll(".status-impact-float").forEach((node) => node.remove());
  const float = document.createElement("span");
  float.className = `status-impact-float ${kind === "heal" ? "heal" : "damage"}`;
  float.textContent = kind === "heal" ? `+${numeric}` : `-${numeric}`;
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
  state.resolved = true;
  const bossProgress = currentBossProgress();
  const stayInBossRoom = bossProgress && !bossProgress.finalStep;
  if (state.nodes[state.currentNode]?.type !== "recovery" && (!bossProgress || bossProgress.finalStep)) {
    updateCurrentNodeResult(Boolean(correct));
  }
  state.currentQuestion = Math.min(state.questions.length, state.currentQuestion + 1);
  if (!stayInBossRoom) {
    if (bossProgress) stopEmergencyTimer();
    state.currentNode = Math.min(state.nodes.length, state.currentNode + 1);
  }
  state.challengeHistory.push({ correct, type: "Live Mission" });
  if (state.localDmMode && state.currentQuestion < state.questions.length) state.resolved = false;
  syncBackgroundMusicForEncounter();
  renderStatus();
  renderMap();
  updateChatRoomTitle();
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
  player.hp = Math.max(0, Math.min(5, player.hp + delta));
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

function renderAnswerControls(q) {
  syncAnswerControlsDock();
  const sideActionHtml = classicTeamActionControlsHtml();
  if (q.mode === "multiple") {
    els.answerControls.innerHTML = `
      ${emergencyTimerCardHtml()}
      <div class="answer-grid">
        ${q.choices.map((choice) => `<button class="answerBtn" data-answer="${choice.key}" type="button">${choice.key}</button>`).join("")}
      </div>
      ${sideActionHtml}
    `;
  } else {
    els.answerControls.innerHTML = `
      ${emergencyTimerCardHtml()}
      <input id="fillAnswer" class="text-answer" type="text" placeholder="Enter answer">
      <button id="submitFillBtn" type="button">Submit</button>
      ${sideActionHtml}
    `;
  }

  bindEmergencyTimerControls();
  const sideActionButton = document.getElementById("sideActionBtn");
  if (sideActionButton) sideActionButton.addEventListener("click", submitLocalSideAction);
  document.querySelectorAll(".answerBtn").forEach((button) => {
    button.addEventListener("click", () => resolveChallenge(button.dataset.answer));
  });
  const fillButton = document.getElementById("submitFillBtn");
  if (fillButton) {
    fillButton.addEventListener("click", () => {
      const input = document.getElementById("fillAnswer");
      resolveChallenge(input.value);
    });
  }
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
  rememberPreviousAnswer(answer, question, correct);

  const result = applyEncounter(correct, type, operator);
  const bossAnswer = Boolean(type.boss || currentBossProgress());
  state.resolved = true;
  updateCurrentNodeResult(Boolean(correct));
  if (teamFullyIncapacitated()) {
    flashAnswerFeedback(correct, { boss: bossAnswer });
    renderTeamFailureCard(localTeamFailureFallback(result, roomName(state.nodes[state.currentNode] || { type: "challenge" }, state.currentNode)));
    return;
  }
  const bossProgress = currentBossProgress();
  const stayInBossRoom = bossProgress && !bossProgress.finalStep;
  state.currentQuestion += 1;
  if (!stayInBossRoom) {
    if (bossProgress) stopEmergencyTimer();
    state.currentNode += 1;
  }
  syncBackgroundMusicForEncounter();
  state.challengeHistory.push({ correct, type: type.label });
  flashAnswerFeedback(correct, { boss: bossAnswer });

  const correctness = correct ? `<p class="success">Correct. The answer is ${escapeHtml(answerRevealText(question))}.</p>` : `<p class="critical">Incorrect. The correct answer is ${escapeHtml(answerRevealText(question))}.</p>`;

  const resolution = document.createElement("div");
  resolution.className = "resolution";
  resolution.innerHTML = `
    ${correctness}
    <p class="typewriter" data-text="${escapeAttribute(result.narration)}"></p>
    ${result.loot ? `<p class="success typewriter" data-text="${escapeAttribute(result.loot)}"></p>` : ""}
    ${result.incapacitated ? `<p class="critical typewriter" data-text="${escapeAttribute(result.incapacitated)}"></p>` : ""}
  `;
  els.encounterCard.appendChild(resolution);

  els.answerControls.innerHTML = "";
  const presentationRunId = beginLogPresentation();
  typeQueuedText(resolution).then(() => {
    finishLogPresentation(presentationRunId);
    els.answerControls.innerHTML = `<button id="nextBtn" type="button">${state.currentQuestion >= state.questions.length ? "Finish Mission" : "Next Challenge"}</button>`;
    document.getElementById("nextBtn").addEventListener("click", beginNextNode);
  });

  renderStatus();
  renderMap();
}

function typeQueuedText(container) {
  const nodes = [...container.querySelectorAll("[data-text]")];
  const startedAt = Date.now();
  const charCount = nodes.reduce((total, node) => total + String(node.dataset.text || "").length, 0);
  return nodes.reduce((chain, node) => {
    return chain.then(() => typeText(node, node.dataset.text || ""));
  }, Promise.resolve()).then(() => {
    if (charCount) {
      logDebugEvent({
        kind: "display",
        label: "Typewriter complete",
        detail: `${Date.now() - startedAt}ms reveal | ${charCount} chars`
      });
    }
  });
}

function typeText(element, text) {
  element.textContent = "";
  return new Promise((resolve) => {
    let index = 0;
    const step = () => {
      if (!document.body.contains(element)) {
        resolve();
        return;
      }
      renderRichText(element, text.slice(0, index));
      const typedCharacter = index > 0 ? text[index - 1] : "";
      if (typedCharacter && /\S/.test(typedCharacter) && index % 3 === 0) {
        playGameSfx("typewriter", { minInterval: 55, volumeScale: 0.13, pulse: false });
      }
      keepMissionLogTypingInView(element);
      index += 1;
      if (index <= text.length) {
        const previous = text[index - 2] || "";
        const delay = typewriterDelayFor(previous);
        const timer = window.setTimeout(step, delay);
        state.typeTimers.push(timer);
      } else {
        element.removeAttribute("data-text");
        keepMissionLogTypingInView(element);
        resolve();
      }
    };
    step();
  });
}

function keepMissionLogTypingInView(element) {
  const containers = [
    element.closest?.("#encounterCard")
  ].filter(Boolean);
  for (const container of containers) {
    if (container.dataset.autoScrollTimer) stopAutoScroll(container);
    const max = container.scrollHeight - container.clientHeight;
    if (max > 6) container.scrollTop = max;
  }
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
  const index = state.players.findIndex((player) => normalize(player.name) === key);
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
  for (const timer of state.typeTimers) {
    window.clearTimeout(timer);
  }
  state.typeTimers = [];
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

  const down = state.players.filter((player) => player.incapacitated);
  if (down.length) incapacitated = `${down.map((player) => player.name).join(", ")} cannot answer until revived.`;
  state.selectedEMS = false;
  state.sideActionGuard = guardWasReady && !guardConsumed;

  return { narration, loot, lootStatus, lootFact, incapacitated, eventNotes, factSeed: consequenceFacts.join("; ") };
}

function applyDeviceTeamEncounter(entries, type) {
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

  const down = state.players.filter((player) => player.incapacitated);
  if (down.length) incapacitated = `${down.map((player) => player.name).join(", ")} cannot answer until revived.`;
  state.selectedEMS = false;
  state.sideActionGuard = guardWasReady && !guardConsumed;

  return { narration, loot, lootStatus, lootFact, incapacitated, eventNotes, factSeed: consequenceFacts.join("; ") };
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

function applyDamage(player, amount, source) {
  let final = amount;
  if (player.status.includes("Burned") && source !== "bleed") final += 1;
  if (player.status.includes("Shocked") && source !== "bleed" && state.rng() < 0.35) final *= 2;
  player.hp = Math.max(0, player.hp - final);
  if (player.hp === 0) player.incapacitated = true;
}

function healPlayer(player, amount) {
  player.hp = Math.min(5, Math.max(0, player.hp + amount));
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
        label: finalStep
          ? `${group.phase === "final" ? "Final Confrontation" : "Critical Contact"} - Team Breakthrough`
          : `${group.phase === "final" ? "Final Confrontation" : "Critical Contact"} - Individual Lock ${stepIndex + 1}/${group.questionIndexes.length}`,
        kind: finalStep ? "team" : "individual",
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
  const recent = plan.slice(-2).map((type) => type?.kind);
  const options = [
    { kind: "individual", weight: 34 },
    { kind: "team", weight: 30 },
    { kind: "locked", weight: 22 },
    { kind: "emergency", weight: 14 }
  ].map((option) => {
    let weight = option.weight;
    if (recent.length === 2 && recent.every((kind) => kind === option.kind)) weight = 0;
    if (option.kind === "emergency" && recent.includes("emergency")) weight = 0;
    if (option.kind === "locked" && recent.includes("locked")) weight -= 12;
    return { ...option, weight: Math.max(0, weight) };
  });
  const kind = chooseWeightedKind(options) || "individual";
  if (kind === "locked") return { label: "Locked Operator Challenge", kind: "locked", locked: true, damage: state.rng() < 0.45 ? 4 : 3, teamDamage: 2 };
  if (kind === "emergency") return { label: "Emergency Response Challenge", kind: "emergency", locked: false, damage: 2 };
  if (kind === "team") return { label: "Team Challenge", kind: "team", locked: false, damage: 2 };
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
  playGameSfx("loot");
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

  const hp = tier === 1 ? 2 : 4;
  const medkits = tier === 1 ? 2 : 3;
  const ems = tier === 1 ? 1 : 2;
  const entry = document.createElement("section");
  entry.className = "transcript-entry";
  entry.innerHTML = `
    <div class="log-tag">${escapeHtml(formatEncounterTag(tier === 1 ? "Recovery Event" : "Major Recovery Event"))}</div>
    <p class="typewriter" data-text="${escapeAttribute(recoveryText)}"></p>
  `;
  const transcript = appendMissionLogEntry(entry, { replace: true });
  els.answerControls.innerHTML = "";
  const autoRead = maybeAutoReadMissionLog(entry);
  delayPresentation(autoRead.visualDelay).then(() => typeQueuedText(entry)).then(() => {
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
  const hp = tier === 1 ? 2 : 4;
  const medkits = tier === 1 ? 2 : 3;
  const ems = tier === 1 ? 1 : 2;
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
  const log = document.createElement("div");
  log.className = "damage-log";
  const line = document.createElement("p");
  line.textContent = summary;
  log.appendChild(line);
  appendStatusUpdateLog(log, fallbackEntry);
}

function recoveryChoiceSummary(kind, tier, revivedPlayer) {
  const hp = tier === 1 ? 2 : 4;
  const medkits = tier === 1 ? 2 : 3;
  const ems = tier === 1 ? 1 : 2;
  const reviveText = revivedPlayer ? ` ${revivedPlayer.name} is revived and cleared for movement.` : "";
  if (kind === "hp") return `Recovery chosen: all active operators recover ${hp} HP.${reviveText}`;
  if (kind === "medkits") return `Recovery chosen: squad gains ${medkits} Medkits.${reviveText}`;
  return `Recovery chosen: squad gains ${ems} EMS Device${ems > 1 ? "s" : ""}.${reviveText}`;
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
  state.currentNode = Math.min(state.nodes.length, state.currentNode + 1);
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

  if (state.chatMode || state.localDmMode) {
    appendRecoveryTransitionToNextEncounter(summary, playerEvents, recoveryNode);
    return;
  }

  beginNextNode();
}

function appendRecoveryTransitionToNextEncounter(summary, playerEvents = [], recoveryNode = null) {
  const nextNode = state.nodes[state.currentNode];
  if (nextNode?.type === "boss" && !state.bossReadyChecks.has(state.currentNode)) {
    appendTranscript({
      tag: "Readiness Check",
      areaName: bossAreaName(nextNode),
      story: `${summary} The recovery window collapses behind the squad as the route tightens toward ${bossAreaName(nextNode)}. The pressure ahead is organized, deliberate, and waiting for the team to commit.`,
      readyCheck: true,
      bossNodeIndex: state.currentNode,
      bossPhase: nextNode.bossPhase || "mid",
      players: playerEvents,
      inventory: { ...state.inventory },
      statusLog: summary
    });
    return;
  }

  const qInfo = currentQuestionInfo();
  const prompt = [
    `Write player-facing narration only, ${narrationSentenceRange("4-7", "2-4")} sentences.`,
    "Describe the recovery choice, then transition into the next area.",
    "Do not include the question text or answer choices.",
    "Keep the recovery window tense and temporary.",
    `Operation: ${state.title}.`,
    `Persistent threat: ${state.threat}.`,
    `Recovery area: ${recoveryAreaName(recoveryNode || { tier: 1 })}.`,
    `Recovery result: ${summary}.`,
    `Next area: ${qInfo.areaName}.`,
    `Next encounter pressure: ${qInfo.activeObstacle || "the route ahead is unstable"}`
  ].join("\n");

  setAnswerPendingText("Receiving recovery transmission...");
  startPassiveTransmissionFeedback({ type: { label: "Recovery Event" }, playerEvents });
  requestOllama(prompt, { temperature: 0.72 })
    .then((text) => cleanLocalNarration(text))
    .catch(() => "")
    .then((story) => {
      stopTransmissionFeedback();
      appendTranscript({
        tag: qInfo.tag,
        areaName: qInfo.areaName,
        story: story || `The team takes the recovery window, seals what wounds they can, and pushes into ${qInfo.areaName}.`,
        activeObstacle: qInfo.activeObstacle,
        question: qInfo.questionText,
        players: playerEvents,
        inventory: { ...state.inventory },
        statusLog: summary,
        suppressEffectFlash: true
      });
      renderStatus();
      renderMap();
    });
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
    Horror: "a buried communications bunker under a blacked-out ridge",
    "Military Thriller": "a forward operating relay site under electronic attack",
    "Sci-Fi Survival": "a failing orbital power station",
    Cyberpunk: "a corporate grid-control tower in lockdown",
    "Fantasy Tech": "an arcane generator vault beneath a fortress",
    "Post-Apocalyptic": "a flooded infrastructure hub outside the safe zone",
    "Naval Operations": "a damaged carrier engineering deck during a storm",
    "Space Station": "a decompression-scarred station maintenance ring",
    "Alien Survival": "a research outpost built around an alien signal",
    Custom: "a hostile training facility full of unstable systems"
  };
  return defaults[type] || defaults.Custom;
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
  fetch("dm-script.md")
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
