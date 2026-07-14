const sharedData = window.StudyAdventureShared || {};
const profanitySubstitutions = sharedData.profanitySubstitutions || [];

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
  promptTimer: null,
  actionCooldownTimer: null,
  renderedPromptSignature: "",
  lastVitals: null,
  localActionCooldownUntil: 0,
  hapticsSupported: "vibrate" in navigator && typeof navigator.vibrate === "function",
  hapticsEnabled: localStorage.getItem("studyAdventureHaptics") === "true",
  lastTimerBuzzKey: "",
  lastTimeoutBuzzPromptId: "",
  queryArrivalTimer: null,
  answerConfirmedTimer: null
};

const PLAYER_PROMPT_ARM_DELAY_MS = 1200;

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
  playerQueuedActionPanel: document.getElementById("playerQueuedActionPanel"),
  playerPromptArea: document.getElementById("playerPromptArea")
};

const roomFromUrl = new URLSearchParams(window.location.search).get("room");
if (roomFromUrl) {
  const urlRoom = roomFromUrl.trim().toUpperCase();
  if (urlRoom !== playerState.roomCode) {
    playerState.playerId = "";
    playerState.submittedPromptId = "";
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
  fetch("/api/player-join", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ roomCode, name })
  })
    .then((response) => response.json().then((payload) => ({ ok: response.ok, payload })))
    .then(({ ok, payload }) => {
      if (!ok || !payload.ok) throw new Error(payload.error || "Could not join mission.");
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
  if (playerState.pollTimer) window.clearInterval(playerState.pollTimer);
  playerState.pollTimer = window.setInterval(pollSession, 800);
  pollSession();
}

function pollSession() {
  fetch(`/api/player-session?ts=${Date.now()}`, { cache: "no-store" })
    .then((response) => response.ok ? response.json() : null)
    .then((session) => {
      if (!session) return;
      renderSession(session);
    })
    .catch(() => renderWaiting("Connection lost. Waiting for Mission Control."));
}

function renderSession(session) {
  if (session.roomCode && session.roomCode !== playerState.roomCode) {
    renderWaiting("This device is joined to a different room code.");
    return;
  }
  if (playerState.playerId && Array.isArray(session.participants) && !session.participants.some((player) => player.id === playerState.playerId)) {
    renderRemoved();
    return;
  }
  playerEls.playerMissionTitle.textContent = session.title || "Awaiting Mission";
  playerEls.playerRoomBadge.textContent = playerState.roomCode;
  renderVitals(session);
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

function renderWaiting(message) {
  stopPromptTimer();
  stopActionCooldownTimer();
  playerState.renderedPromptSignature = `waiting:${message}`;
  const submitted = /^Answer submitted/i.test(message);
  playerEls.playerPromptArea.innerHTML = `
    <div class="player-waiting ${submitted ? "submitted-waiting" : ""}">
      <span class="signal-bars" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
      <p>${escapeHtml(message)}</p>
    </div>
  `;
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
  const isNewPrompt = playerState.promptId !== prompt.id;
  if (isNewPrompt) {
    playerState.promptArmedAt = Date.now() + PLAYER_PROMPT_ARM_DELAY_MS;
  }
  const alreadySubmitted = playerState.submittedPromptId === prompt.id;
  const actionSubmitted = playerState.submittedActionPromptId === prompt.id;
  const incapacitated = Boolean(playerState.lastVitals?.incapacitated);
  const promptArmed = Date.now() >= playerState.promptArmedAt;
  const controlsEnabled = enabled && promptArmed && !alreadySubmitted && !incapacitated;
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
    mode: prompt.mode,
    question: prompt.question,
    choices: prompt.choices,
    timer: prompt.timer
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
  playerState.promptId = prompt.id;
  if (isNewPrompt) {
    playerState.lastTimerBuzzKey = "";
    playerState.lastTimeoutBuzzPromptId = "";
  }
  playerState.renderedPromptSignature = signature;
  playerEls.playerPromptArea.innerHTML = `
    <section class="player-prompt ${prompt.boss ? "boss-prompt" : ""}">
      <span>${escapeHtml(prompt.challengeLabel || "Challenge")}</span>
      <h2>${escapeHtml(prompt.areaName || "Active Area")}</h2>
      ${prompt.boss ? `<div class="player-boss-alert">Critical sequence ${Number(prompt.bossStep) || 1} / ${Number(prompt.bossTotal) || 1}</div>` : ""}
      ${timerHtml}
      <p>${escapeHtml(prompt.question || "")}</p>
      ${choices}
      ${prompt.actionOnly ? "" : `<div id="playerSubmitStatus" class="player-submit-status">${alreadySubmitted ? "Answer submitted. Awaiting Mission Control." : incapacitated ? "You are incapacitated and cannot answer until revived." : !promptArmed ? "Prompt locking in..." : note ? escapeHtml(note) : "Submit your answer when ready."}</div>`}
      ${actionForm}
    </section>
  `;
  document.querySelectorAll(".playerChoiceBtn").forEach((button) => {
    button.addEventListener("click", () => submitAnswer(button.dataset.answer, button.dataset.promptId));
  });
  const form = document.getElementById("playerFillForm");
  if (form) {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      submitAnswer(document.getElementById("playerFillInput")?.value.trim() || "", form.dataset.promptId);
    });
  }
  const actionFormEl = document.getElementById("playerActionForm");
  if (actionFormEl) {
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
  playerState.promptTimer = window.setInterval(tick, 100);
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
  const classNames = ["player-vitals"];

  if (incapacitated) classNames.push("downed");
  else if (hp <= 2) classNames.push("low");
  for (const status of statuses) classNames.push(`has-${normalize(status).trim().replace(/\s+/g, "-")}`);

  if (playerEls.playerVitals) {
    playerEls.playerVitals.className = classNames.join(" ");
    const points = Math.max(0, Math.round(Number(vitals.points) || 0));
    playerEls.playerVitals.innerHTML = `<strong>${hp} HP</strong><span>${escapeHtml(statusText)}</span><b class="player-vitals-points">${points} PTS</b>`;
    if (tookDamage) {
      playerEls.playerVitals.classList.remove("damage-flash");
      void playerEls.playerVitals.offsetWidth;
      playerEls.playerVitals.classList.add("damage-flash");
      window.setTimeout(() => playerEls.playerVitals?.classList.remove("damage-flash"), 1500);
      triggerScreenDamageShake();
    }
  }

  if (incapacitated) document.body.classList.add("player-status-downed");
  else if (hp <= 2) document.body.classList.add("player-status-low");
  else if (statuses.includes("Burned")) document.body.classList.add("player-status-burned");
  else if (statuses.includes("Bleeding")) document.body.classList.add("player-status-bleeding");
  else if (statuses.includes("Shocked")) document.body.classList.add("player-status-shocked");
  else if (statuses.includes("Concussed")) document.body.classList.add("player-status-concussed");
  else document.body.classList.add("player-status-ok");

  if (becameIncapacitated) vibratePlayer("downed");
  else if (tookDamage) vibratePlayer(hp <= 2 ? "critical-damage" : "damage");
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
  fetch("/api/player-answer", {
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
  if (!cleanAction || !playerState.promptId || (!actionOnly && playerState.submittedActionPromptId === playerState.promptId)) return;
  const cooldownUntil = Number(form?.dataset.cooldownUntil) || 0;
  const cooldownRemaining = Math.max(0, cooldownUntil - Date.now());
  if (!actionOnly && cooldownRemaining > 0) {
    if (status) status.textContent = `Action recharging: ${formatCooldown(cooldownRemaining)} remaining.`;
    return;
  }
  if (status) status.textContent = "Sending action...";
  fetch("/api/player-action", {
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
      if (!actionOnly) playerState.submittedActionPromptId = playerState.promptId;
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
        if (status) status.textContent = "Action submitted. You can still answer the challenge.";
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
  fetch("/api/player-action", {
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
    window.clearInterval(playerState.pollTimer);
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
