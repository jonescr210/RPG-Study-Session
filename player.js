const sharedData = window.StudyAdventureShared || {};
const combatSystem = window.StudyAdventureCombat || {};
const profanitySubstitutions = sharedData.profanitySubstitutions || [];
const PLAYER_NETWORK_TIMEOUT_MS = 8_000;
const PLAYER_SESSION_POLL_MS = 1_000;
const PLAYER_SESSION_HIDDEN_POLL_MS = 4_000;

function fetchWithTimeout(resource, options = {}, timeoutMs = PLAYER_NETWORK_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), Math.max(1, Number(timeoutMs) || PLAYER_NETWORK_TIMEOUT_MS));
  return fetch(resource, { ...options, signal: controller.signal })
    .finally(() => window.clearTimeout(timer));
}

const playerState = {
  roomCode: localStorage.getItem("studyAdventureRoomCode") || "",
  playerId: localStorage.getItem("studyAdventurePlayerId") || "",
  playerName: localStorage.getItem("studyAdventurePlayerName") || "",
  promptId: "",
  promptArmedAt: 0,
  submittedPromptId: "",
  submittedActionPromptId: "",
  queuedActionId: "",
  queuedActionSignature: "",
  pollTimer: null,
  pollInFlight: false,
  sessionRecoveryInFlight: false,
  promptTimer: null,
  actionCooldownTimer: null,
  renderedPromptSignature: "",
  waitingMessage: "",
  lastVitals: null,
  vitalsRenderSignature: "",
  classSelectionSignature: "",
  lastItemNotice: "",
  localActionCooldownUntil: 0,
  hapticsSupported: "vibrate" in navigator && typeof navigator.vibrate === "function",
  hapticsEnabled: localStorage.getItem("studyAdventureHaptics") === "true",
  lastTimerBuzzKey: "",
  lastTimeoutBuzzPromptId: "",
  queryArrivalTimer: null,
  answerConfirmedTimer: null,
  selectedAbilityTargets: {}
};

// The server already enforces a prompt arming window. A second client-side delay
// made every prompt feel late and could leave controls disabled after a stale render.
const PLAYER_PROMPT_ARM_DELAY_MS = 0;

const playerEls = {
  joinCard: document.getElementById("joinCard"),
  missionCard: document.getElementById("missionCard"),
  joinRoomCode: document.getElementById("joinRoomCode"),
  joinPlayerName: document.getElementById("joinPlayerName"),
  joinMissionBtn: document.getElementById("joinMissionBtn"),
  joinStatus: document.getElementById("joinStatus"),
  playerMissionTitle: document.getElementById("playerMissionTitle"),
  playerRoomBadge: document.getElementById("playerRoomBadge"),
  playerIdentity: document.getElementById("playerIdentity"),
  playerHapticsToggle: document.getElementById("playerHapticsToggle"),
  playerHapticsNote: document.getElementById("playerHapticsNote"),
  playerVitals: document.getElementById("playerVitals"),
  playerClassPanel: document.getElementById("playerClassPanel"),
  playerQueuedActionPanel: document.getElementById("playerQueuedActionPanel"),
  playerPromptArea: document.getElementById("playerPromptArea")
};

const roomFromUrl = new URLSearchParams(window.location.search).get("room");
if (roomFromUrl) {
  const urlRoom = roomFromUrl.trim().toUpperCase();
  if (urlRoom !== playerState.roomCode) {
    playerState.playerId = "";
    playerState.submittedPromptId = "";
    playerState.selectedAbilityTargets = {};
  }
  playerState.roomCode = urlRoom;
}
playerEls.joinRoomCode.value = playerState.roomCode;
playerEls.joinPlayerName.value = playerState.playerName;
playerEls.joinMissionBtn.addEventListener("click", joinMission);
playerEls.joinRoomCode.addEventListener("keydown", submitJoinOnEnter);
playerEls.joinPlayerName.addEventListener("keydown", submitJoinOnEnter);
if (playerEls.playerHapticsToggle) {
  if (!playerState.hapticsSupported) {
    playerState.hapticsEnabled = false;
    localStorage.setItem("studyAdventureHaptics", "false");
    playerEls.playerHapticsToggle.disabled = true;
    playerEls.playerHapticsToggle.closest(".player-haptics-toggle")?.classList.add("unsupported");
    if (playerEls.playerHapticsNote) {
      playerEls.playerHapticsNote.textContent = "Vibration is not supported by this mobile browser. Visual alerts will still play.";
    }
  } else if (playerEls.playerHapticsNote) {
    playerEls.playerHapticsNote.textContent = "Uses your phone vibration motor for timers, damage, and status changes.";
  }
  playerEls.playerHapticsToggle.checked = playerState.hapticsEnabled;
  playerEls.playerHapticsToggle.addEventListener("change", () => {
    if (!playerState.hapticsSupported) {
      playerEls.playerHapticsToggle.checked = false;
      playerState.hapticsEnabled = false;
      return;
    }
    playerState.hapticsEnabled = Boolean(playerEls.playerHapticsToggle.checked);
    localStorage.setItem("studyAdventureHaptics", playerState.hapticsEnabled ? "true" : "false");
    if (playerState.hapticsEnabled) vibratePlayer("confirm");
  });
}

if (playerState.roomCode && playerState.playerName) {
  joinMission();
}

function submitJoinOnEnter(event) {
  if (event.key === "Enter") joinMission();
}

function joinMission() {
  const roomCode = playerEls.joinRoomCode.value.trim().toUpperCase();
  const name = sanitizeText(playerEls.joinPlayerName.value, { maxLength: 32 });
  if (!roomCode || !name) {
    playerEls.joinStatus.textContent = "Enter the room code and your name.";
    return;
  }
  playerEls.joinStatus.textContent = "Joining mission...";
  fetchWithTimeout("/api/player-join", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ roomCode, name })
  })
    .then((response) => response.json().then((payload) => ({ ok: response.ok, payload })))
    .then(({ ok, payload }) => {
      if (!ok || !payload.ok) throw new Error(payload.error || "Could not join mission.");
      if (roomCode !== playerState.roomCode) playerState.selectedAbilityTargets = {};
      playerState.roomCode = roomCode;
      playerState.playerId = payload.participant.id;
      playerState.playerName = payload.participant.name;
      localStorage.setItem("studyAdventureRoomCode", playerState.roomCode);
      localStorage.setItem("studyAdventurePlayerId", playerState.playerId);
      localStorage.setItem("studyAdventurePlayerName", playerState.playerName);
      showMissionCard();
      startPolling();
      renderSession(payload.session);
    })
    .catch((error) => {
      playerEls.joinStatus.textContent = error.message || "Could not join mission.";
    });
}

function showMissionCard() {
  playerEls.joinCard.hidden = true;
  playerEls.missionCard.hidden = false;
  playerEls.playerRoomBadge.textContent = playerState.roomCode;
  playerEls.playerIdentity.textContent = `Signed in as ${playerState.playerName}.`;
}

function startPolling() {
  if (playerState.pollTimer) window.clearTimeout(playerState.pollTimer);
  playerState.pollTimer = null;
  pollSession();
}

function scheduleSessionPoll() {
  if (playerState.pollTimer) window.clearTimeout(playerState.pollTimer);
  playerState.pollTimer = window.setTimeout(() => {
    playerState.pollTimer = null;
    pollSession();
  }, document.hidden ? PLAYER_SESSION_HIDDEN_POLL_MS : PLAYER_SESSION_POLL_MS);
}

function pollSession() {
  if (playerState.pollInFlight) return;
  if (document.hidden) {
    scheduleSessionPoll();
    return;
  }
  playerState.pollInFlight = true;
  const playerId = encodeURIComponent(playerState.playerId || "");
  fetchWithTimeout(`/api/player-session?playerId=${playerId}&ts=${Date.now()}`, { cache: "no-store" })
    .then((response) => response.ok ? response.json() : null)
    .then((session) => {
      if (!session) return;
      renderSession(session);
    })
    .catch(() => renderWaiting("Connection lost. Waiting for Mission Control."))
    .finally(() => {
      playerState.pollInFlight = false;
      scheduleSessionPoll();
    });
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stopPromptTimer();
    stopActionCooldownTimer();
    return;
  }
  pollSession();
});

function renderSession(session) {
  if (session.roomCode && session.roomCode !== playerState.roomCode) {
    renderWaiting("This device is joined to a different room code.");
    return;
  }
  if (playerState.playerId && Array.isArray(session.participants) && !session.participants.some((player) => player.id === playerState.playerId)) {
    recoverMissingPlayerSession(session);
    return;
  }
  playerEls.playerMissionTitle.textContent = session.title || "Awaiting Mission";
  playerEls.playerRoomBadge.textContent = playerState.roomCode;
  renderVitals(session);
  renderClassSelection(session);
  renderQueuedActionPanel(session);
  const prompt = session.prompt;
  syncPlayerAtmosphere(session, prompt);
  if (session.status === "lobby") {
    renderWaiting("You are in the squad lobby. Waiting for Mission Control to deploy.");
    return;
  }
  if (!prompt || session.status === "briefing") {
    renderWaiting("Mission briefing in progress.");
    return;
  }
  if (playerState.lastVitals?.incapacitated) {
    renderWaiting("You are incapacitated and cannot answer until revived.");
    return;
  }
  if (prompt.arming) {
    renderWaiting("Prompt locking in...");
    return;
  }
  if (session.status === "resolving" || !prompt.accepting) {
    renderWaiting("Mission Control is resolving the action.");
    return;
  }
  if (playerState.submittedPromptId === prompt.id) {
    renderWaiting("Answer submitted. Awaiting Mission Control.");
    return;
  }
  const lockedOut = prompt.lockedPlayer && !sameName(prompt.lockedPlayer, playerState.playerName);
  if (lockedOut) {
    renderWaiting(`${prompt.lockedPlayer} is the locked operator for this challenge.`);
    return;
  }
  renderPrompt(prompt, true, "", session);
}

function recoverMissingPlayerSession(session) {
  if (playerState.sessionRecoveryInFlight || !playerState.roomCode || !playerState.playerName) return;
  playerState.sessionRecoveryInFlight = true;
  renderWaiting("Reconnecting this device to Mission Control...");
  fetchWithTimeout("/api/player-join", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ roomCode: playerState.roomCode, name: playerState.playerName, reconnect: true })
  })
    .then((response) => response.json().then((payload) => ({ ok: response.ok, payload })))
    .then(({ ok, payload }) => {
      if (!ok || !payload?.ok) {
        if (ok === false && /removed/i.test(String(payload?.error || ""))) renderRemoved();
        else renderWaiting("Mission Control is rebuilding the room. Reconnecting shortly...");
        return;
      }
      playerState.playerId = payload.participant.id;
      localStorage.setItem("studyAdventurePlayerId", playerState.playerId);
      renderSession(payload.session || session);
    })
    .catch(() => renderWaiting("Connection lost. Reconnecting shortly..."))
    .finally(() => {
      playerState.sessionRecoveryInFlight = false;
    });
}

function renderClassSelection(session = {}) {
  if (!playerEls.playerClassPanel) return;
  const participant = (session.participants || []).find((entry) => entry.id === playerState.playerId);
  const lobbyOpen = session.status === "lobby";
  playerEls.playerClassPanel.hidden = !lobbyOpen;
  if (!lobbyOpen) {
    playerState.classSelectionSignature = "";
    return;
  }
  const reserved = new Map((session.participants || [])
    .filter((entry) => entry.classId && entry.id !== playerState.playerId)
    .map((entry) => [entry.classId, entry.name]));
  const signature = JSON.stringify({
    selected: participant?.classId || "",
    reserved: [...reserved.entries()]
  });
  if (playerState.classSelectionSignature === signature) return;
  playerState.classSelectionSignature = signature;
  playerEls.playerClassPanel.innerHTML = `
    <div class="player-class-heading"><span>Choose Class</span><strong>${participant?.classId ? escapeHtml(combatSystem.classDefinition?.(participant.classId)?.label || participant.classId) : "Required"}</strong></div>
    <div class="player-class-grid">
      ${(combatSystem.CLASS_IDS || []).map((classId) => {
        const definition = combatSystem.classDefinition?.(classId) || { label: classId, gear: "", summary: "" };
        const owner = reserved.get(classId);
        const selected = participant?.classId === classId;
        return `<button class="playerClassBtn ${selected ? "selected" : ""}" type="button" data-class-id="${escapeAttribute(classId)}" ${owner ? "disabled" : ""}>
          <strong>${escapeHtml(definition.label)}</strong><span>${escapeHtml(definition.gear)}</span><small>${owner ? `Reserved by ${escapeHtml(owner)}` : escapeHtml(definition.summary)}</small>
        </button>`;
      }).join("")}
    </div>`;
  playerEls.playerClassPanel.querySelectorAll(".playerClassBtn").forEach((button) => {
    button.addEventListener("click", () => selectPlayerClass(button.dataset.classId));
  });
}

function selectPlayerClass(classId) {
  if (!classId || !playerState.playerId) return;
  playerEls.playerClassPanel.querySelectorAll("button").forEach((button) => { button.disabled = true; });
  fetchWithTimeout("/api/player-class", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ roomCode: playerState.roomCode, playerId: playerState.playerId, classId })
  })
    .then((response) => response.json().then((payload) => ({ ok: response.ok, payload })))
    .then(({ ok, payload }) => {
      if (!ok || !payload.ok) throw new Error(payload.error || "Could not reserve class.");
      renderSession(payload.session);
    })
    .catch((error) => {
      playerEls.playerClassPanel.innerHTML = `<p class="field-note">${escapeHtml(error.message || "Could not reserve class.")}</p>`;
    });
}

function renderWaiting(message) {
  if (playerState.waitingMessage === message) return;
  playerState.waitingMessage = message;
  stopPromptTimer();
  stopActionCooldownTimer();
  const activePrompt = playerEls.playerPromptArea.querySelector(".player-prompt");
  if (activePrompt) {
    // Keep the answer surface mounted while Mission Control is briefing or
    // resolving.  Replacing the whole prompt here made the controls jump out
    // of view between every question, which was especially jarring on phones.
    activePrompt.classList.add("player-prompt-paused");
    const status = document.getElementById("playerSubmitStatus");
    if (status) status.textContent = message;
    playerEls.playerPromptArea.querySelectorAll("#playerAnswerControls input, #playerAnswerControls button").forEach((control) => {
      control.disabled = true;
    });
    playerEls.playerPromptArea.querySelectorAll("#playerActionForm input, #playerActionForm button").forEach((control) => {
      control.disabled = true;
    });
    playerState.renderedPromptSignature = `waiting:${message}`;
    return;
  }
  playerState.renderedPromptSignature = `waiting:${message}`;
  const submitted = /^Answer submitted/i.test(message);
  playerEls.playerPromptArea.innerHTML = `
    <div class="player-waiting ${submitted ? "submitted-waiting" : ""}">
      <span class="signal-bars" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
      <p>${escapeHtml(message)}</p>
    </div>
  `;
}

function promptAnswerMode(prompt = {}) {
  if (prompt.actionOnly) return "action";
  return prompt.mode === "multiple" ? "multiple" : "fill";
}

function bindPromptControls(prompt) {
  document.querySelectorAll(".playerChoiceBtn").forEach((button) => {
    if (button.dataset.bound === "true") return;
    button.dataset.bound = "true";
    button.addEventListener("click", () => submitAnswer(button.dataset.answer, button.dataset.promptId));
  });
  const form = document.getElementById("playerFillForm");
  if (form && form.dataset.bound !== "true") {
    form.dataset.bound = "true";
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      submitAnswer(document.getElementById("playerFillInput")?.value.trim() || "", form.dataset.promptId);
    });
  }
  const actionFormEl = document.getElementById("playerActionForm");
  if (actionFormEl && actionFormEl.dataset.bound !== "true") {
    actionFormEl.dataset.bound = "true";
    actionFormEl.addEventListener("submit", (event) => {
      event.preventDefault();
      submitAction(document.getElementById("playerActionInput")?.value.trim() || "", prompt.id);
    });
    document.getElementById("playerAutoActionBtn")?.addEventListener("click", () => {
      const input = document.getElementById("playerActionInput");
      const action = randomPlayerGeneratedAction(currentAutoActionCategory(), {
        name: playerState.playerName || "Operator",
        areaName: prompt.areaName || "the room",
        challengeLabel: prompt.challengeLabel || "Action Room"
      });
      if (input) input.value = action;
      submitAction(action, prompt.id);
    });
  }
}

function syncPlayerAtmosphere(session = {}, prompt = null) {
  const resolving = session.status === "resolving" || Boolean(prompt && !prompt.accepting);
  document.body.classList.toggle("player-boss-active", Boolean(prompt?.boss));
  document.body.classList.toggle("player-emergency-active", prompt?.timer?.kind === "emergency");
  document.body.classList.toggle("player-action-active", Boolean(prompt?.actionOnly));
  document.body.classList.toggle("player-briefing-active", session.status === "briefing" || session.status === "lobby");
  document.body.classList.toggle("player-resolving", resolving);
}

function triggerPlayerQueryArrival(prompt = {}) {
  window.clearTimeout(playerState.queryArrivalTimer);
  document.body.classList.remove("player-query-arrival");
  void document.body.offsetWidth;
  document.body.classList.add("player-query-arrival");
  playerState.queryArrivalTimer = window.setTimeout(() => {
    document.body.classList.remove("player-query-arrival");
    playerState.queryArrivalTimer = null;
  }, prompt.boss ? 1250 : 900);
}

function triggerPlayerAnswerConfirmed() {
  window.clearTimeout(playerState.answerConfirmedTimer);
  document.body.classList.remove("player-answer-confirmed");
  void document.body.offsetWidth;
  document.body.classList.add("player-answer-confirmed");
  playerState.answerConfirmedTimer = window.setTimeout(() => {
    document.body.classList.remove("player-answer-confirmed");
    playerState.answerConfirmedTimer = null;
  }, 1250);
}

function renderQueuedActionPanel(session = {}) {
  const panel = playerEls.playerQueuedActionPanel;
  if (!panel) return;
  const prompt = session.prompt;
  const available = Boolean(session.allowQueuedPlayerActions && !prompt?.actionOnly);
  if (!available) {
    panel.hidden = true;
    panel.innerHTML = "";
    playerState.queuedActionSignature = "hidden";
    return;
  }

  const queued = Array.isArray(session.queuedActions)
    ? session.queuedActions.find((entry) => entry.playerId === playerState.playerId || sameName(entry.playerName, playerState.playerName))
    : null;
  const cooldown = actionCooldownInfo(session);
  const incapacitated = Boolean(playerState.lastVitals?.incapacitated);
  const enabled = !queued && !incapacitated && cooldown.remainingMs <= 0;
  const statusText = queued
    ? "Action queued. It will deploy at the next safe opening."
    : incapacitated
      ? "Incapacitated players cannot queue actions."
      : cooldown.remainingMs > 0
        ? `Action recharging: ${formatCooldown(cooldown.remainingMs)} remaining.`
        : "Queue an action before or after answering. It will not count as an answer.";
  const signature = JSON.stringify({ available, queued: queued?.id || "", enabled, incapacitated, cooling: cooldown.remainingMs > 0 });
  if (playerState.queuedActionSignature === signature) return;
  playerState.queuedActionSignature = signature;
  playerState.queuedActionId = queued?.id || "";
  panel.hidden = false;
  panel.innerHTML = `
    <form id="playerQueuedActionForm" class="player-action-form player-queued-action-form">
      <label>
        Queue Player Action
        <div class="player-action-row">
          <input id="playerQueuedActionInput" type="text" maxlength="180" autocomplete="off" placeholder="Search, inspect, brace, help..." ${enabled ? "" : "disabled"}>
          <button type="submit" ${enabled ? "" : "disabled"}>Queue</button>
        </div>
        <button id="playerQueuedAutoActionBtn" class="player-auto-action-btn" type="button" ${enabled ? "" : "disabled"}>Act for me!</button>
      </label>
      <div id="playerQueuedActionStatus" class="player-submit-status">${escapeHtml(statusText)}</div>
    </form>
  `;
  document.getElementById("playerQueuedActionForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    submitQueuedAction(document.getElementById("playerQueuedActionInput")?.value.trim() || "");
  });
  document.getElementById("playerQueuedAutoActionBtn")?.addEventListener("click", () => {
    const action = randomPlayerGeneratedAction(currentAutoActionCategory(), {
      name: playerState.playerName || "Operator",
      areaName: prompt?.areaName || "the active area",
      challengeLabel: prompt?.challengeLabel || "Mission"
    });
    const input = document.getElementById("playerQueuedActionInput");
    if (input) input.value = action;
    submitQueuedAction(action);
  });
}

function renderPrompt(prompt, enabled, note, session = {}) {
  playerState.waitingMessage = "";
  const isNewPrompt = playerState.promptId !== prompt.id;
  if (isNewPrompt) {
    playerState.promptArmedAt = Date.now() + PLAYER_PROMPT_ARM_DELAY_MS;
  }
  const alreadySubmitted = playerState.submittedPromptId === prompt.id;
  const actionSubmitted = playerState.submittedActionPromptId === prompt.id;
  const incapacitated = Boolean(playerState.lastVitals?.incapacitated);
  const promptArmed = Date.now() >= playerState.promptArmedAt;
  const controlsEnabled = enabled && promptArmed && !alreadySubmitted && !incapacitated;
  const answerMode = promptAnswerMode(prompt);
  const actionCooldown = actionCooldownInfo(session);
  const actionBaseEnabled = Boolean(prompt.allowPlayerActions && prompt.accepting && promptArmed && (prompt.actionOnly || !actionSubmitted) && !incapacitated);
  const actionEnabled = actionBaseEnabled && actionCooldown.remainingMs <= 0;
  const signature = JSON.stringify({
    id: prompt.id,
    armed: promptArmed,
    enabled: controlsEnabled,
    submitted: alreadySubmitted,
    actionSubmitted,
    actionBaseEnabled,
    actionEnabled,
    actionCooldownUntil: actionCooldown.cooldownUntil,
    actionCooldownMs: actionCooldown.cooldownMs,
    note,
    label: prompt.challengeLabel,
    area: prompt.areaName,
    boss: prompt.boss,
    bossStep: prompt.bossStep,
    bossTotal: prompt.bossTotal,
    combat: prompt.combat,
    classHint: prompt.classHint,
    mode: prompt.mode,
    question: prompt.question,
    choices: prompt.choices,
    // Countdown seconds are updated by the local 200ms timer. Keep them out
    // of the render signature so polling does not rebuild answer controls.
    timer: prompt.timer ? {
      deadline: prompt.timer.deadline,
      durationMs: prompt.timer.durationMs,
      paused: Boolean(prompt.timer.paused),
      starting: Boolean(prompt.timer.starting),
      label: prompt.timer.label || ""
    } : null
  });
  if (playerState.renderedPromptSignature === signature) return;
  const choices = prompt.actionOnly
    ? ""
    : prompt.mode === "multiple"
    ? `<div class="player-choice-grid">${prompt.choices.map((choice) => `<button class="playerChoiceBtn" type="button" data-answer="${choice.key}" data-prompt-id="${escapeAttribute(prompt.id)}" ${controlsEnabled ? "" : "disabled"}>${choice.key}<span>${escapeHtml(choice.text)}</span></button>`).join("")}</div>`
    : `<form id="playerFillForm" class="player-fill-form" data-prompt-id="${escapeAttribute(prompt.id)}"><input id="playerFillInput" type="text" placeholder="Type your answer" ${controlsEnabled ? "" : "disabled"}><button type="submit" ${controlsEnabled ? "" : "disabled"}>Submit</button></form>`;
  const actionForm = prompt.allowPlayerActions && prompt.actionOnly ? `
    <form id="playerActionForm" class="player-action-form" data-action-base-enabled="${actionBaseEnabled ? "true" : "false"}" data-action-only="${prompt.actionOnly ? "true" : "false"}" data-cooldown-until="${actionCooldown.cooldownUntil}" data-cooldown-ms="${actionCooldown.cooldownMs}">
      <label>
        Player Action
        <div class="player-action-row">
          <input id="playerActionInput" type="text" maxlength="180" autocomplete="off" placeholder="Search, inspect, brace, help..." ${actionEnabled ? "" : "disabled"}>
          <button id="playerActionSubmitBtn" type="submit" ${actionEnabled ? "" : "disabled"}>Act</button>
        </div>
        <button id="playerAutoActionBtn" class="player-auto-action-btn" type="button" ${actionEnabled ? "" : "disabled"}>Act for me!</button>
      </label>
      <div id="playerActionStatus" class="player-submit-status">${playerActionStatusText(prompt.actionOnly ? false : actionSubmitted, incapacitated, actionCooldown)}</div>
    </form>
  ` : "";
  const timerHtml = prompt.timer ? `
    <section class="player-countdown ${timerSeconds(prompt.timer) <= 5 ? "critical" : ""}" data-deadline="${Number(prompt.timer.deadline) || 0}" data-duration="${Number(prompt.timer.durationMs) || 30000}" data-remaining="${Number(prompt.timer.remainingMs) || 0}" data-paused="${prompt.timer.paused ? "true" : "false"}">
      <div class="player-countdown-heading">
        <span>${escapeHtml(prompt.timer.starting ? "Prompt opening..." : prompt.timer.label || "Challenge Window")}</span>
        <strong id="playerCountdownValue">${timerSeconds(prompt.timer).toFixed(1)}</strong>
      </div>
      <div class="player-countdown-track">
        <div id="playerCountdownFill" class="player-countdown-fill" style="width:${timerPercent(prompt.timer)}%"></div>
      </div>
    </section>
  ` : "";
  const combatHtml = prompt.combat ? `
    <section class="player-combat-status ${prompt.combat.boss ? "boss" : ""}">
      <div><span>${prompt.combat.boss ? "Boss" : "Hostiles"}</span><strong>${Number(prompt.combat.enemyCount) || 0} active · Round ${Number(prompt.combat.round) || 1}</strong></div>
      <div class="combat-health-track"><i style="width:${Math.max(0, Math.min(100, (Number(prompt.combat.hp) || 0) / Math.max(1, Number(prompt.combat.maxHp) || 1) * 100))}%"></i></div>
      <p>${Number(prompt.combat.hp) || 0} / ${Number(prompt.combat.maxHp) || 0} shared integrity</p>
      <p class="combat-intent">${escapeHtml(prompt.combat.intent || "Enemy intent pending.")}</p>
    </section>` : "";

  const existingPrompt = playerEls.playerPromptArea.querySelector(".player-prompt");
  if (existingPrompt) {
    existingPrompt.className = `player-prompt ${prompt.boss ? "boss-prompt" : ""}`.trim();
    existingPrompt.classList.remove("player-prompt-paused");
    existingPrompt.dataset.answerMode = answerMode;
    existingPrompt.querySelector("[data-prompt-label]")?.replaceChildren(document.createTextNode(prompt.challengeLabel || "Challenge"));
    existingPrompt.querySelector("[data-area-name]")?.replaceChildren(document.createTextNode(prompt.areaName || "Active Area"));
    const bossAlert = existingPrompt.querySelector("[data-prompt-boss-alert]");
    if (bossAlert) bossAlert.innerHTML = prompt.boss && !prompt.combat ? `<div class="player-boss-alert">Critical sequence ${Number(prompt.bossStep) || 1} / ${Number(prompt.bossTotal) || 1}</div>` : "";
    const combatSlot = existingPrompt.querySelector("[data-prompt-combat]");
    if (combatSlot) combatSlot.innerHTML = combatHtml;
    const hintSlot = existingPrompt.querySelector("[data-prompt-class-hint]");
    if (hintSlot) hintSlot.innerHTML = prompt.classHint ? `<div class="player-class-hint">${escapeHtml(prompt.classHint)}</div>` : "";
    const timerSlot = existingPrompt.querySelector("[data-prompt-timer]");
    if (timerSlot) timerSlot.innerHTML = timerHtml;
    existingPrompt.querySelector("[data-prompt-question]")?.replaceChildren(document.createTextNode(prompt.question || ""));
    const answerControls = existingPrompt.querySelector("#playerAnswerControls");
    if (answerControls) {
      if (answerMode === "multiple") {
        answerControls.innerHTML = choices;
      } else if (answerMode === "fill") {
        const fill = answerControls.querySelector("#playerFillForm");
        if (fill) {
          fill.dataset.promptId = prompt.id;
          const input = fill.querySelector("#playerFillInput");
          const submit = fill.querySelector("button[type=submit]");
          if (isNewPrompt && input) input.value = "";
          if (input) input.disabled = !controlsEnabled;
          if (submit) submit.disabled = !controlsEnabled;
        } else {
          answerControls.innerHTML = choices;
        }
      } else {
        answerControls.innerHTML = "";
      }
      answerControls.hidden = answerMode === "action";
    }
    const status = existingPrompt.querySelector("#playerSubmitStatus");
    if (status) status.textContent = prompt.actionOnly
      ? "Choose an action when ready."
      : alreadySubmitted
        ? "Answer submitted. Awaiting Mission Control."
        : incapacitated
          ? "You are incapacitated and cannot answer until revived."
          : !promptArmed
            ? "Prompt locking in..."
            : note || "Submit your answer when ready.";
    const actionSlot = existingPrompt.querySelector("[data-prompt-action]");
    if (actionSlot) actionSlot.innerHTML = actionForm;
    playerState.promptId = prompt.id;
    playerState.renderedPromptSignature = signature;
    bindPromptControls(prompt);
    if (isNewPrompt && prompt.timer) vibratePlayer(prompt.timer.kind === "emergency" ? "emergency-start" : "timer-start");
    if (isNewPrompt) triggerPlayerQueryArrival(prompt);
    startPromptTimer(prompt.timer);
    startActionCooldownTimer();
    return;
  }

  playerState.promptId = prompt.id;
  if (isNewPrompt) {
    playerState.lastTimerBuzzKey = "";
    playerState.lastTimeoutBuzzPromptId = "";
  }
  playerState.renderedPromptSignature = signature;
  playerEls.playerPromptArea.innerHTML = `
    <section class="player-prompt ${prompt.boss ? "boss-prompt" : ""}" data-answer-mode="${answerMode}">
      <span data-prompt-label>${escapeHtml(prompt.challengeLabel || "Challenge")}</span>
      <h2 data-area-name>${escapeHtml(prompt.areaName || "Active Area")}</h2>
      <div data-prompt-boss-alert>${prompt.boss && !prompt.combat ? `<div class="player-boss-alert">Critical sequence ${Number(prompt.bossStep) || 1} / ${Number(prompt.bossTotal) || 1}</div>` : ""}</div>
      <div data-prompt-combat>${combatHtml}</div>
      <div data-prompt-class-hint>${prompt.classHint ? `<div class="player-class-hint">${escapeHtml(prompt.classHint)}</div>` : ""}</div>
      <div data-prompt-timer>${timerHtml}</div>
      <p data-prompt-question>${escapeHtml(prompt.question || "")}</p>
      <div id="playerAnswerControls" class="player-answer-controls" ${answerMode === "action" ? "hidden" : ""}>${choices}</div>
      <div id="playerSubmitStatus" class="player-submit-status">${alreadySubmitted ? "Answer submitted. Awaiting Mission Control." : incapacitated ? "You are incapacitated and cannot answer until revived." : !promptArmed ? "Prompt locking in..." : note ? escapeHtml(note) : prompt.actionOnly ? "Choose an action when ready." : "Submit your answer when ready."}</div>
      <div data-prompt-action>${actionForm}</div>
    </section>
  `;
  bindPromptControls(prompt);
  if (isNewPrompt && prompt.timer) vibratePlayer(prompt.timer.kind === "emergency" ? "emergency-start" : "timer-start");
  if (isNewPrompt) triggerPlayerQueryArrival(prompt);
  startPromptTimer(prompt.timer);
  startActionCooldownTimer();
}

function actionCooldownInfo(session = {}) {
  const participant = Array.isArray(session.participants)
    ? session.participants.find((player) => player.id === playerState.playerId || sameName(player.name, playerState.playerName))
    : null;
  const configuredCooldownMs = Number(session.actionCooldownMs);
  const cooldownMs = Number.isFinite(configuredCooldownMs) ? Math.max(0, configuredCooldownMs) : 120000;
  const participantCooldownUntil = (Number(participant?.lastActionAt) || 0) + cooldownMs;
  const cooldownUntil = Math.max(Number(playerState.localActionCooldownUntil) || 0, participantCooldownUntil);
  return {
    cooldownMs,
    cooldownUntil,
    remainingMs: Math.max(0, cooldownUntil - Date.now())
  };
}

function playerActionStatusText(actionSubmitted, incapacitated, cooldown) {
  if (actionSubmitted) return "Action submitted. Consequences are pending.";
  if (incapacitated) return "Incapacitated players cannot act.";
  if (cooldown.remainingMs > 0) return `Action recharging: ${formatCooldown(cooldown.remainingMs)} remaining.`;
  return "Optional: attempt one personal action this turn.";
}

function startPromptTimer(timer) {
  stopPromptTimer();
  if (!timer) return;
  const tick = () => updatePromptTimer(timer);
  tick();
  playerState.promptTimer = window.setInterval(tick, 200);
}

function stopPromptTimer() {
  if (playerState.promptTimer) window.clearInterval(playerState.promptTimer);
  playerState.promptTimer = null;
  document.body.classList.remove("player-time-critical", "player-time-final");
}

function startActionCooldownTimer() {
  stopActionCooldownTimer();
  const form = document.getElementById("playerActionForm");
  if (!form) return;
  const tick = () => updateActionCooldown(form);
  tick();
  playerState.actionCooldownTimer = window.setInterval(tick, 250);
}

function stopActionCooldownTimer() {
  if (playerState.actionCooldownTimer) window.clearInterval(playerState.actionCooldownTimer);
  playerState.actionCooldownTimer = null;
}

function updateActionCooldown(form) {
  if (!form || !document.body.contains(form)) {
    stopActionCooldownTimer();
    return;
  }
  const status = document.getElementById("playerActionStatus");
  const input = document.getElementById("playerActionInput");
  const button = form.querySelector("button");
  const baseEnabled = form.dataset.actionBaseEnabled === "true";
  const actionOnly = form.dataset.actionOnly === "true";
  const cooldownUntil = Number(form.dataset.cooldownUntil) || 0;
  const remainingMs = Math.max(0, cooldownUntil - Date.now());
  if (remainingMs > 0) {
    if (status && !status.textContent.startsWith("Action submitted")) {
      status.textContent = `Action recharging: ${formatCooldown(remainingMs)} remaining.`;
    }
    if (input) input.disabled = true;
    if (button) button.disabled = true;
    return;
  }
  if (baseEnabled && (actionOnly || playerState.submittedActionPromptId !== playerState.promptId) && !playerState.lastVitals?.incapacitated) {
    if (input) input.disabled = false;
    if (button) button.disabled = false;
    if (status) status.textContent = actionOnly ? "Submit field actions until the room resolves." : "Optional: attempt one personal action this turn.";
  }
  stopActionCooldownTimer();
}

function formatCooldown(ms) {
  const seconds = Math.ceil(Math.max(0, ms) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rem = seconds % 60;
  return `${minutes}:${String(rem).padStart(2, "0")}`;
}

function updatePromptTimer(timer) {
  const value = document.getElementById("playerCountdownValue");
  const fill = document.getElementById("playerCountdownFill");
  const card = document.querySelector(".player-countdown");
  if (!value || !fill || !card) {
    stopPromptTimer();
    return;
  }
  const seconds = timerSeconds(timer);
  const duration = Math.max(1, Number(timer.durationMs) || 30000);
  const remaining = Math.max(0, seconds * 1000);
  const label = card.querySelector(".player-countdown-heading span");
  if (label) label.textContent = timer.starting ? "Prompt opening..." : timer.label || "Challenge Window";
  value.textContent = seconds.toFixed(1);
  fill.style.width = `${Math.max(0, Math.min(100, (remaining / duration) * 100))}%`;
  card.classList.toggle("critical", seconds <= 5);
  card.classList.toggle("final-seconds", seconds <= 3);
  card.classList.toggle("paused", Boolean(timer.paused));
  document.body.classList.toggle("player-time-critical", seconds > 0 && seconds <= 10 && !timer.paused);
  document.body.classList.toggle("player-time-final", seconds > 0 && seconds <= 3 && !timer.paused);
  updateTimerHaptics(timer, seconds);
}

function timerSeconds(timer) {
  if (!timer) return 0;
  if (timer.paused) return Math.max(0, Number(timer.remainingMs) || 0) / 1000;
  const deadline = Number(timer.deadline) || 0;
  if (!deadline) return Math.max(0, Number(timer.remainingMs) || 0) / 1000;
  return Math.max(0, deadline - Date.now()) / 1000;
}

function timerPercent(timer) {
  const duration = Math.max(1, Number(timer?.durationMs) || 30000);
  return Math.max(0, Math.min(100, (timerSeconds(timer) * 1000 / duration) * 100));
}

const playerClassGlyphs = { soldier: "\u2736", medic: "+", scout: "\u224b", enforcer: "\u25a3", engineer: "\u2318", tactician: "\u25c7" };

function playerItemAbility(item) {
  if (!item) return null;
  const stat = Object.keys(item.bonuses || {})[0] || "";
  if (!item.rarity || !["rare", "epic", "legendary"].includes(item.rarity)) return null;
  const abilities = {
    damage: { id: "overdrive", label: "Overdrive", description: "Next correct combat answer gains +4 damage.", effect: "damage", cooldown: 3 },
    damageReduction: { id: "guard-matrix", label: "Guard Matrix", description: "Reduce the next incoming hit by 4.", effect: "guard", cooldown: 3 },
    healing: { id: "field-patch", label: "Field Patch", description: "Restore 4 HP to a selected operator.", effect: "heal", cooldown: 3 },
    hintPower: { id: "signal-burst", label: "Signal Burst", description: "Reveal an extra clue on the current question.", effect: "hint", cooldown: 5 },
    disruption: { id: "pulse-jammer", label: "Pulse Jammer", description: "Disrupt one enemy activation this round.", effect: "disrupt", cooldown: 4 },
    maxHp: { id: "emergency-buffer", label: "Emergency Buffer", description: "Restore 3 HP to a selected operator.", effect: "heal", cooldown: 4 }
  };
  return abilities[stat] || null;
}

function playerClassAbilityPresentation(classId, level = 1) {
  const id = String(classId || "").toLowerCase();
  const upgraded = Number(level) >= 3;
  const names = {
    soldier: ["Heavy Rifle", "Heavy Rifle Overdrive — Double Tap"],
    medic: ["Surgical Kit", "Surgical Kit — Medical Field"],
    scout: ["Spectrum Analyzer", "Spectrum Analyzer — Signal Burst"],
    enforcer: ["Ballistic Shield", "Ballistic Shield — Fatal Redirect"],
    engineer: ["Arc Toolkit", "Arc Toolkit — Protection Bubble"],
    tactician: ["Command Protocol", "Command Protocol — Coordinated Strike"]
  };
  const pair = names[id] || ["Class ability", "Empowered class ability"];
  return { label: upgraded ? pair[1] : pair[0], upgraded };
}

function targetClassDefinition(entry = {}) {
  return combatSystem.classDefinition?.(entry.classId) || { label: entry.classLabel || "Operator", color: entry.classColor || "#9eeeff" };
}

function defaultAbilityTarget(states = []) {
  const active = states.filter((entry) => !entry.incapacitated);
  return active.find((entry) => sameName(entry.name, playerState.playerName))?.name || active[0]?.name || "";
}

function selectedAbilityTarget(key, states = []) {
  const current = playerState.selectedAbilityTargets[key];
  if (current && states.some((entry) => !entry.incapacitated && sameName(entry.name, current))) return current;
  const fallback = defaultAbilityTarget(states);
  if (fallback) playerState.selectedAbilityTargets[key] = fallback;
  return fallback;
}

function playerTargetCardsHtml(states, key, actionWindow) {
  const targets = states.filter((entry) => !entry.incapacitated);
  const selected = selectedAbilityTarget(key, states);
  if (!targets.length) return `<div class="player-target-empty">No operators available.</div>`;
  return `<div class="player-target-picker-device" data-target-picker-key="${escapeAttribute(key)}">
    <div class="player-target-picker-heading"><span>Choose target</span><small>Tap an operator</small></div>
    <div class="player-target-card-grid">
      ${targets.map((entry) => {
        const definition = targetClassDefinition(entry);
        const hp = Math.max(0, Number(entry.hp) || 0);
        const maxHp = Math.max(1, Number(entry.maxHp) || 10);
        const percentage = Math.max(0, Math.min(100, hp / maxHp * 100));
        const selectedClass = sameName(entry.name, selected) ? " selected" : "";
        const incapacitated = Boolean(entry.incapacitated) || hp <= 0;
        const glyph = playerClassGlyphs[String(entry.classId || "").toLowerCase()] || "•";
        return `<button type="button" class="player-target-card${selectedClass}" data-target-select-key="${escapeAttribute(key)}" data-target-name="${escapeAttribute(entry.name)}" aria-pressed="${selectedClass ? "true" : "false"}" ${!actionWindow || incapacitated ? "disabled" : ""} style="--target-color:${escapeAttribute(entry.classColor || definition.color || "#9eeeff")}">
          <span class="player-target-card-top"><i>${glyph}</i><strong>${escapeHtml(entry.name)}</strong><b>${hp}/${maxHp}</b></span>
          <span class="player-target-card-class">${escapeHtml(entry.classLabel || definition.label || "Operator")}</span>
          <span class="player-target-card-health"><i style="width:${percentage}%"></i></span>
        </button>`;
      }).join("")}
    </div>
    <div class="player-target-selected" data-target-selected-for="${escapeAttribute(key)}">Target locked: ${escapeHtml(selected || "None")}</div>
  </div>`;
}

function renderVitals(session) {
  const states = Array.isArray(session.playerStates) ? session.playerStates : [];
  const vitals = states.find((entry) => sameName(entry.name, playerState.playerName));
  document.body.classList.remove(
    "player-status-ok",
    "player-status-low",
    "player-status-downed",
    "player-status-burned",
    "player-status-bleeding",
    "player-status-shocked",
    "player-status-concussed"
  );

  if (!vitals) {
    if (playerEls.playerVitals) {
      playerEls.playerVitals.className = "player-vitals";
      playerEls.playerVitals.innerHTML = "<strong>HP --</strong><span>Awaiting squad telemetry</span>";
    }
    playerState.lastVitals = null;
    playerState.vitalsRenderSignature = "";
    document.body.classList.add("player-status-ok");
    return;
  }

  const hp = Math.max(0, Number(vitals.hp) || 0);
  const statuses = Array.isArray(vitals.status) ? vitals.status.filter(Boolean) : [];
  const incapacitated = Boolean(vitals.incapacitated) || hp <= 0;
  const priorHp = playerState.lastVitals?.hp;
  const priorVitals = playerState.lastVitals;
  const tookDamage = Number.isFinite(priorHp) && hp < priorHp;
  const gainedStatus = priorVitals && statuses.some((status) => !priorVitals.statuses.includes(status));
  const becameIncapacitated = Boolean(priorVitals) && !priorVitals.incapacitated && incapacitated;
  const statusText = incapacitated ? "Incapacitated" : statuses.length ? statuses.join(", ") : "No status effects";
  const vitalsRenderSignature = JSON.stringify({
    hp,
    maxHp: vitals.maxHp,
    statuses,
    incapacitated,
    classId: vitals.classId,
    level: vitals.level,
    xp: vitals.xp,
    points: vitals.points,
    answerStreak: vitals.answerStreak,
    items: vitals.items,
    classCooldowns: vitals.classCooldowns,
    itemNotice: vitals.itemNotice,
    abilityNotice: vitals.abilityNotice,
    abilityUsedThisTurn: Boolean(vitals.abilityUsedThisTurn),
    targetVitals: states.map((entry) => `${entry.name}:${entry.hp}:${entry.maxHp}:${entry.incapacitated ? 1 : 0}`).join("|"),
    promptId: session.prompt?.id || "",
    combat: Boolean(session.prompt?.combat),
    accepting: Boolean(session.prompt?.accepting),
    allowPlayerActions: Boolean(session.prompt?.allowPlayerActions)
  });
  if (vitalsRenderSignature === playerState.vitalsRenderSignature) return;
  playerState.vitalsRenderSignature = vitalsRenderSignature;
  const classNames = ["player-vitals"];

  if (incapacitated) classNames.push("downed");
  else if (hp <= Math.max(2, Math.ceil((Number(vitals.maxHp) || 10) * 0.25))) classNames.push("low");
  for (const status of statuses) classNames.push(`has-${normalize(status).trim().replace(/\s+/g, "-")}`);

  if (playerEls.playerVitals) {
    playerEls.playerVitals.className = classNames.join(" ");
    const classDefinition = combatSystem.classDefinition?.(vitals.classId) || null;
    const itemCards = (Array.isArray(vitals.items) ? vitals.items : []).map((itemId) => combatSystem.itemDefinition?.(itemId)).filter(Boolean);
    playerEls.playerVitals.style.setProperty("--player-class-color", vitals.classColor || classDefinition?.color || "#9eeeff");
    const points = Math.max(0, Math.round(Number(vitals.points) || 0));
    const maxHp = Math.max(10, Number(vitals.maxHp) || 10);
    const level = Math.max(1, Number(vitals.level) || 1);
    const xp = Math.max(0, Number(vitals.xp) || 0);
    const streak = Math.max(0, Number(vitals.answerStreak) || 0);
    playerEls.playerVitals.innerHTML = "";
    const classId = String(vitals.classId || "").toLowerCase();
    const classGlyph = playerClassGlyphs[classId] || "\u2022";
    const cooldowns = vitals.classCooldowns || {};
    const classCooldownInfo = { medic: ["surgical-kit", 2], scout: ["spectrum-analyzer", 5], enforcer: ["shield", 5], engineer: ["arc-disrupt", 3], soldier: ["soldier-double", 2], tactician: ["tactician-command", 1] }[classId];
    const classLast = classCooldownInfo ? Number(cooldowns[classCooldownInfo[0]]) : NaN;
    // The host stores class cooldown markers against the completed combat
    // round, while the published prompt displays the upcoming round.
    const classCurrent = ["soldier", "tactician"].includes(classId)
      ? Math.max(0, Number(session.prompt?.combat?.round || 1) - 1)
      : Number(session.prompt?.questionIndex || 0);
    const classRemaining = Number.isFinite(classLast) ? Math.max(0, classCooldownInfo[1] - (classCurrent - classLast)) : 0;
    const classReady = classId === "enforcer" || (!classRemaining && (level >= 3 || classId !== "soldier") && (classId !== "soldier" || streak >= 3));
    const abilityTurnUsed = Boolean(vitals.abilityUsedThisTurn);
    const combatRoom = Boolean(session.prompt?.combat);
    const abilityWindow = Boolean(session.prompt?.allowPlayerActions && session.prompt?.accepting && !incapacitated);
    const classAbilityAllowed = abilityWindow && (combatRoom || ["medic", "scout"].includes(classId));
    const itemAbilityAllowed = (effect) => abilityWindow && (combatRoom || ["heal", "hint"].includes(effect));
    const targets = states.filter((entry) => !entry.incapacitated);
    const itemHtml = itemCards.length ? itemCards.map((item) => {
      const ability = playerItemAbility(item);
      const key = ability ? `item:${item.id}:${ability.id}` : "";
      const last = key ? Number(cooldowns[key]) : NaN;
      const remaining = ability && Number.isFinite(last) ? Math.max(0, ability.cooldown - (Number(session.prompt?.questionIndex || 0) - last)) : 0;
      const ready = Boolean(ability && !remaining && !abilityTurnUsed && itemAbilityAllowed(ability.effect));
      const targetSelect = ability?.effect === "heal" ? playerTargetCardsHtml(states, `item:${item.id}`, itemAbilityAllowed("heal")) : "";
      return `<div class="player-inventory-row"><div class="player-inventory-copy"><span class="player-inventory-dot rarity-${escapeAttribute(item.rarity)} ${ability ? "has-ability" : ""}" title="${escapeAttribute(ability ? `${item.name}: ${ability.description}` : `${item.name}: ${item.summary}`)}"></span><div><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(ability ? ability.description : item.summary)}</small></div></div>${ability ? `<div class="player-inventory-actions">${targetSelect}<button type="button" class="player-ability-btn" data-player-item="${escapeAttribute(item.id)}" ${ready ? "" : "disabled"}>${escapeHtml(abilityTurnUsed ? "Used this turn" : remaining ? `Recharge ${remaining}` : "Use")}</button></div>` : ""}</div>`;
    }).join("") : "<small>No items equipped</small>";
    const classTargetSelect = ["medic", "engineer"].includes(classId) && classAbilityAllowed ? playerTargetCardsHtml(states, `class:${classId}`, classAbilityAllowed) : "";
    const noticeHtml = vitals.itemNotice ? `<div class="player-item-notice" role="status">${escapeHtml(vitals.itemNotice)}</div>` : "";
    const abilityNoticeHtml = vitals.abilityNotice ? `<div class="player-ability-notice" role="status">${escapeHtml(vitals.abilityNotice)}</div>` : "";
    const manualClass = ["soldier", "medic", "scout", "engineer", "tactician"].includes(classId);
    const targetableClass = ["medic", "engineer"].includes(classId);
    const classAction = manualClass
      ? `<div class="player-class-action-row">${classId === "tactician" ? `<label class="tactician-protocol-picker"><span>Protocol</span><select id="playerTacticianProtocol" ${classReady && !abilityTurnUsed && classAbilityAllowed ? "" : "disabled"}><option value="assault">Assault</option><option value="guard">Guard</option><option value="support">Support</option></select></label>` : ""}${targetableClass ? classTargetSelect : ""}<button type="button" class="player-ability-btn class" id="playerClassAbilityBtn" ${classReady && !abilityTurnUsed && classAbilityAllowed ? "" : "disabled"}>${targetableClass ? "Use ability" : classId === "tactician" ? "Use protocol" : "Use now"}</button></div>`
      : "";
    const abilityPresentation = playerClassAbilityPresentation(classId, level);
    const abilityBadge = abilityTurnUsed ? "USED THIS TURN" : classId === "enforcer" ? (classRemaining ? `AUTO ${classRemaining}` : "AUTO READY") : classRemaining ? `RECHARGE ${classRemaining}` : classReady ? (abilityPresentation.upgraded ? "EMPOWERED READY" : "READY") : level < 3 ? "LV 3 UNLOCK" : "STREAK 3 REQUIRED";
    playerEls.playerVitals.insertAdjacentHTML("beforeend", `<div class="player-vitals-modern"><div class="player-vitals-modern-top"><span class="player-vitals-class-icon" style="--player-class-color:${escapeAttribute(vitals.classColor || classDefinition?.color || "#9eeeff")}">${classGlyph}</span><div><strong>${hp} / ${maxHp} HP</strong><small>${escapeHtml(statusText)}</small></div><b>LV ${level}</b></div><div class="player-vitals-modern-summary"><span>${escapeHtml(vitals.classLabel || "Operator")}</span><span>${xp} XP</span><span>${streak} STK</span><span>${points} PTS</span></div>${noticeHtml}${abilityNoticeHtml}<section class="player-class-loadout"><div class="player-class-loadout-heading${abilityPresentation.upgraded ? " empowered" : ""}"><strong>${escapeHtml(abilityPresentation.label)}</strong><b class="${classReady ? "ready" : "recharging"}">${escapeHtml(abilityBadge)}</b></div><small>${abilityPresentation.upgraded ? "UPGRADED: " : ""}${escapeHtml(classDefinition?.summary || "Ready")}</small>${classAction}</section><section class="player-inventory-panel"><strong>Inventory</strong>${itemHtml}</section></div>`);
    playerEls.playerVitals.querySelector("#playerClassAbilityBtn")?.addEventListener("click", () => {
      const target = selectedAbilityTarget(`class:${classId}`, states);
      const protocol = classId === "tactician" ? (playerEls.playerVitals.querySelector("#playerTacticianProtocol")?.value || "assault") : "";
      const suffix = protocol || target || "";
      submitAction(`CLASS:${classId}${suffix ? `:${suffix}` : ""}`, session.prompt?.id || playerState.promptId);
    });
    playerEls.playerVitals.querySelectorAll("[data-target-select-key]").forEach((button) => button.addEventListener("click", () => {
      const key = button.dataset.targetSelectKey || "";
      const target = button.dataset.targetName || "";
      if (!key || !target || button.disabled) return;
      playerState.selectedAbilityTargets[key] = target;
      const picker = button.closest("[data-target-picker-key]");
      picker?.querySelectorAll("[data-target-select-key]").forEach((candidate) => {
        const isSelected = candidate.dataset.targetName === target;
        candidate.classList.toggle("selected", isSelected);
        candidate.setAttribute("aria-pressed", isSelected ? "true" : "false");
      });
      const confirmation = picker?.querySelector(`[data-target-selected-for="${CSS.escape(key)}"]`);
      if (confirmation) confirmation.textContent = `Target locked: ${target}`;
    }));
    playerEls.playerVitals.querySelectorAll("[data-player-item]").forEach((button) => button.addEventListener("click", () => {
      const itemId = button.dataset.playerItem || "";
      const target = selectedAbilityTarget(`item:${itemId}`, states);
      submitAction(`ABILITY:${itemId}${target ? `:${target}` : ""}`, session.prompt?.id || playerState.promptId);
    }));
    if (tookDamage) {
      playerEls.playerVitals.classList.remove("damage-flash");
      void playerEls.playerVitals.offsetWidth;
      playerEls.playerVitals.classList.add("damage-flash");
      window.setTimeout(() => playerEls.playerVitals?.classList.remove("damage-flash"), 1500);
      triggerScreenDamageShake();
    }
  }

  if (incapacitated) document.body.classList.add("player-status-downed");
  else if (hp <= Math.max(2, Math.ceil((Number(vitals.maxHp) || 10) * 0.25))) document.body.classList.add("player-status-low");
  else if (statuses.includes("Burned")) document.body.classList.add("player-status-burned");
  else if (statuses.includes("Bleeding")) document.body.classList.add("player-status-bleeding");
  else if (statuses.includes("Shocked")) document.body.classList.add("player-status-shocked");
  else if (statuses.includes("Concussed")) document.body.classList.add("player-status-concussed");
  else document.body.classList.add("player-status-ok");

  if (becameIncapacitated) vibratePlayer("downed");
  else if (tookDamage) vibratePlayer(hp <= Math.max(2, Math.ceil((Number(vitals.maxHp) || 10) * 0.25)) ? "critical-damage" : "damage");
  else if (gainedStatus) vibratePlayer("status");

  playerState.lastVitals = { hp, statuses: [...statuses], incapacitated };
}

function vibratePlayer(patternName) {
  if (!playerState.hapticsSupported) {
    triggerHapticVisualFallback(patternName);
    return;
  }
  if (!playerState.hapticsEnabled) return;
  const patterns = {
    confirm: [35],
    "timer-start": [70, 35, 70],
    "emergency-start": [90, 45, 90, 45, 140],
    tick: [28],
    damage: [120, 60, 120],
    "critical-damage": [160, 70, 160, 70, 220],
    status: [90, 50, 180],
    downed: [260, 110, 260, 110, 420],
    timeout: [500]
  };
  try {
    const result = navigator.vibrate(patterns[patternName] || patterns.confirm);
    if (result === false) triggerHapticVisualFallback(patternName);
  } catch {
    triggerHapticVisualFallback(patternName);
  }
}

function updateTimerHaptics(timer, seconds) {
  if (!timer || timer.paused || timer.starting) return;
  const wholeSeconds = Math.ceil(seconds);
  if (wholeSeconds > 0 && wholeSeconds <= 5) {
    const key = `${playerState.promptId}:${wholeSeconds}`;
    if (playerState.lastTimerBuzzKey !== key) {
      playerState.lastTimerBuzzKey = key;
      vibratePlayer("tick");
    }
  }
  if (seconds <= 0.05 && playerState.lastTimeoutBuzzPromptId !== playerState.promptId) {
    playerState.lastTimeoutBuzzPromptId = playerState.promptId;
    vibratePlayer("timeout");
  }
}

function triggerScreenDamageShake() {
  document.body.classList.remove("player-damage-shake");
  void document.body.offsetWidth;
  document.body.classList.add("player-damage-shake");
  window.setTimeout(() => document.body.classList.remove("player-damage-shake"), 720);
}

function triggerHapticVisualFallback(patternName) {
  if (!["timer-start", "emergency-start", "tick", "timeout", "status", "downed"].includes(patternName)) return;
  const bodyClass = patternName === "timeout" || patternName === "downed" ? "player-haptic-alert" : "player-haptic-pulse";
  document.body.classList.remove("player-haptic-pulse", "player-haptic-alert");
  void document.body.offsetWidth;
  document.body.classList.add(bodyClass);
  window.setTimeout(() => document.body.classList.remove(bodyClass), bodyClass === "player-haptic-alert" ? 900 : 420);
}

function submitAnswer(answer, expectedPromptId = playerState.promptId) {
  const cleanAnswer = sanitizeText(answer, { maxLength: 180 });
  const status = document.getElementById("playerSubmitStatus");
  if (!expectedPromptId || expectedPromptId !== playerState.promptId) {
    if (status) status.textContent = "Prompt changed. Wait for the current prompt to lock in.";
    return;
  }
  if (Date.now() < playerState.promptArmedAt) {
    if (status) status.textContent = "Prompt locking in...";
    return;
  }
  if (playerState.lastVitals?.incapacitated) {
    if (status) status.textContent = "You are incapacitated and cannot answer until revived.";
    return;
  }
  if (!cleanAnswer || !playerState.promptId) return;
  if (status) status.textContent = "Sending answer...";
  fetchWithTimeout("/api/player-answer", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      roomCode: playerState.roomCode,
      playerId: playerState.playerId,
      playerName: playerState.playerName,
      promptId: playerState.promptId,
      answer: cleanAnswer,
      clientSentAt: Date.now()
    })
  })
    .then((response) => response.json().then((payload) => ({ ok: response.ok, payload })))
    .then(({ ok, payload }) => {
      if (!ok || !payload.ok) throw new Error(payload.error || "Answer rejected.");
      playerState.submittedPromptId = playerState.promptId;
      triggerPlayerAnswerConfirmed();
      renderWaiting("Answer submitted. Awaiting Mission Control.");
    })
    .catch((error) => {
      if (status) status.textContent = error.message || "Could not send answer.";
    });
}

function submitAction(action, expectedPromptId = playerState.promptId) {
  const cleanAction = sanitizeText(action, { maxLength: 180 });
  const abilityAction = /^(?:ABILITY|CLASS):/i.test(cleanAction);
  const form = document.getElementById("playerActionForm");
  const actionOnly = form?.dataset.actionOnly === "true";
  const status = document.getElementById("playerActionStatus");
  if (!expectedPromptId || expectedPromptId !== playerState.promptId) {
    if (status) status.textContent = "Prompt changed. Wait for the current prompt to lock in.";
    return;
  }
  if (Date.now() < playerState.promptArmedAt) {
    if (status) status.textContent = "Prompt locking in...";
    return;
  }
  if (!cleanAction || !playerState.promptId) return;
  if (!actionOnly && !abilityAction && playerState.submittedActionPromptId === playerState.promptId) {
    if (status) status.textContent = "Action already submitted. You can still use one ability or item this turn.";
    return;
  }
  const cooldownUntil = Number(form?.dataset.cooldownUntil) || 0;
  const cooldownRemaining = Math.max(0, cooldownUntil - Date.now());
  if (!actionOnly && !abilityAction && cooldownRemaining > 0) {
    if (status) status.textContent = `Action recharging: ${formatCooldown(cooldownRemaining)} remaining.`;
    return;
  }
  if (status) status.textContent = "Sending action...";
  fetchWithTimeout("/api/player-action", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      roomCode: playerState.roomCode,
      playerId: playerState.playerId,
      playerName: playerState.playerName,
      promptId: playerState.promptId,
      action: cleanAction,
      clientSentAt: Date.now()
    })
  })
    .then((response) => response.json().then((payload) => ({ ok: response.ok, payload })))
    .then(({ ok, payload }) => {
      if (!ok || !payload.ok) {
        if (payload?.cooldownUntil) {
          playerState.localActionCooldownUntil = Number(payload.cooldownUntil) || playerState.localActionCooldownUntil;
          const form = document.getElementById("playerActionForm");
          if (form) {
            form.dataset.cooldownUntil = String(playerState.localActionCooldownUntil);
            startActionCooldownTimer();
          }
        }
        throw new Error(payload.error || "Action rejected.");
      }
      if (!actionOnly && !abilityAction) playerState.submittedActionPromptId = playerState.promptId;
      playerState.localActionCooldownUntil = actionOnly ? 0 : Number(payload.cooldownUntil) || Date.now() + (Number(payload.cooldownMs) || 120000);
      const input = document.getElementById("playerActionInput");
      const button = document.getElementById("playerActionSubmitBtn");
      const autoButton = document.getElementById("playerAutoActionBtn");
      if (actionOnly) {
        if (input) {
          input.value = "";
          input.disabled = false;
          input.focus();
        }
        if (button) button.disabled = false;
        if (autoButton) autoButton.disabled = false;
        if (form) form.dataset.cooldownUntil = "0";
        if (status) status.textContent = "Action transmitted. You may add another until the room resolves.";
      } else {
        if (input) input.disabled = true;
        if (button) button.disabled = true;
        if (autoButton) autoButton.disabled = true;
        if (status) status.textContent = abilityAction
          ? "Ability request sent. Awaiting Mission Control confirmation."
          : "Action submitted. You can still answer the challenge.";
      }
    })
    .catch((error) => {
      if (status) status.textContent = error.message || "Could not send action.";
    });
}

function submitQueuedAction(action) {
  const cleanAction = sanitizeText(action, { maxLength: 180 });
  const status = document.getElementById("playerQueuedActionStatus");
  if (!cleanAction || playerState.queuedActionId) return;
  if (playerState.lastVitals?.incapacitated) {
    if (status) status.textContent = "You are incapacitated and cannot act until revived.";
    return;
  }
  if (status) status.textContent = "Queueing action...";
  fetchWithTimeout("/api/player-action", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      roomCode: playerState.roomCode,
      playerId: playerState.playerId,
      playerName: playerState.playerName,
      promptId: playerState.promptId,
      action: cleanAction,
      queued: true,
      clientSentAt: Date.now()
    })
  })
    .then((response) => response.json().then((payload) => ({ ok: response.ok, payload })))
    .then(({ ok, payload }) => {
      if (!ok || !payload.ok) throw new Error(payload.error || "Action rejected.");
      playerState.queuedActionId = payload.action?.id || "queued";
      playerState.localActionCooldownUntil = Number(payload.cooldownUntil) || Date.now() + (Number(payload.cooldownMs) || 120000);
      playerState.queuedActionSignature = "";
      if (status) status.textContent = "Action queued. It will deploy at the next safe opening.";
      const input = document.getElementById("playerQueuedActionInput");
      const form = document.getElementById("playerQueuedActionForm");
      if (input) input.disabled = true;
      form?.querySelectorAll("button").forEach((button) => { button.disabled = true; });
      vibratePlayer("confirm");
      pollSession();
    })
    .catch((error) => {
      if (status) status.textContent = error.message || "Could not queue action.";
    });
}

const playerActionCategories = sharedData.playerActionCategories || ["helpful"];
const playerActionVerbs = sharedData.playerActionVerbs || { helpful: ["searches"] };
const playerActionTargets = sharedData.playerActionTargets || ["the room"];
const playerActionMethods = sharedData.playerActionMethods || ["carefully"];

function generatedPlayerActionPool(category, context = {}) {
  if (typeof sharedData.generatedPlayerActionPool === "function") {
    return sharedData.generatedPlayerActionPool(category, context);
  }
  const cleanCategory = playerActionCategories.includes(category) ? category : "helpful";
  const name = sanitizeText(context.name || "Operator", { maxLength: 32 });
  const area = sanitizeText(context.areaName || context.challengeLabel || "the room", { maxLength: 60 });
  const verbs = playerActionVerbs[cleanCategory] || playerActionVerbs.helpful;
  const actions = [];
  for (let index = 0; actions.length < 100; index++) {
    const verb = verbs[index % verbs.length];
    const target = playerActionTargets[Math.floor(index / verbs.length) % playerActionTargets.length];
    const method = playerActionMethods[(index * 5 + cleanCategory.length) % playerActionMethods.length];
    actions.push(`${name} ${verb} the ${target} in ${area} ${method}`);
  }
  return actions;
}

function randomPlayerGeneratedAction(category, context = {}) {
  if (typeof sharedData.randomPlayerGeneratedAction === "function") {
    return sharedData.randomPlayerGeneratedAction(category, context);
  }
  const pool = generatedPlayerActionPool(category, context);
  return pool[Math.floor(Math.random() * pool.length)] || `${context.name || "Operator"} searches the room carefully`;
}

function currentAutoActionCategory() {
  const roll = Math.random();
  if (roll < 0.08) return "brilliant";
  if (roll < 0.58) return "helpful";
  if (roll < 0.78) return "risky";
  if (roll < 0.9) return "flavor";
  if (roll < 0.96) return "weak";
  if (roll < 0.995) return "reckless";
  return "harmful";
}

function renderRemoved() {
  playerState.playerId = "";
  localStorage.removeItem("studyAdventurePlayerId");
  playerEls.joinCard.hidden = false;
  playerEls.missionCard.hidden = true;
  playerEls.joinStatus.textContent = "Mission Control removed this device from the room.";
  if (playerState.pollTimer) {
    window.clearTimeout(playerState.pollTimer);
    playerState.pollTimer = null;
  }
}

function sameName(a, b) {
  return normalize(a) === normalize(b);
}

function normalize(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ");
}

function sanitizeText(value, options = {}) {
  const maxLength = options.maxLength || 240;
  let text = String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  for (const [pattern, replacement] of profanitySubstitutions) {
    text = text.replace(pattern, replacement);
  }

  text = text.slice(0, maxLength).trim();
  return text || options.fallback || "";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}
