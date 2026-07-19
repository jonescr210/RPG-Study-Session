(function exposeDashboardOptional(root) {
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
  const combatPresentationReady = !isCombatNode(state.nodes[state.currentNode]) || (
    state.combatStageEnteredNodes.has(state.currentNode)
    && !els.combatStage?.classList.contains("entering")
    && !els.combatStage?.classList.contains("exiting")
    && !els.combatStage?.classList.contains("resolving")
  );
  const canSimulate = state.started
    && state.deviceMode === "multi"
    && state.questionPresentationReady
    && !state.answerPending
    && !state.resolved
    && !state.bossReadyPending
    && combatPresentationReady
    && state.nodes[state.currentNode]?.type !== "recovery"
    && Boolean(info.question);
  const autoAvailable = canSimulate && !state.actionDrivenMode;
  els.simulatorPanel.innerHTML = `
    <div class="sim-left">
      <strong>Simulator</strong>
      <div class="sim-tool-actions">
        <button class="secondary simAnswerBtn" type="button" data-mode="correct" ${canSimulate ? "" : "disabled"}>${state.actionDrivenMode ? "Helpful" : "All Correct"}</button>
        <button class="secondary simAnswerBtn" type="button" data-mode="mixed" ${canSimulate ? "" : "disabled"}>Mixed</button>
        <button class="secondary simAnswerBtn" type="button" data-mode="wrong" ${canSimulate ? "" : "disabled"}>${state.actionDrivenMode ? "Reckless" : "All Wrong"}</button>
      </div>
    </div>
    <div class="aware-copy"><label class="sim-auto-toggle"><input id="simAwareAbilitiesToggle" type="checkbox" ${state.simulatorAwareAbilities ? "checked" : ""}><span>Aware bot abilities</span></label><p>When enabled, simulated operators queue a useful class ability or item before answering.</p></div>
    <label class="sim-auto-toggle auto-answer"><input id="simAutoAnswerToggle" type="checkbox" ${state.simulatorAutoAnswer ? "checked" : ""} ${state.actionDrivenMode ? "disabled" : ""}><span>Auto-answer</span><small>Automatic accuracy: ${state.simulatorAutoAnswerAccuracy}%</small></label>
    <div id="simulatorStatus" class="muted-small"></div>
  `;
  const autoToggle = document.getElementById("simAutoAnswerToggle");
  autoToggle?.addEventListener("change", () => {
    state.simulatorAutoAnswer = Boolean(autoToggle.checked);
    window.localStorage.setItem("studyAdventureSimulatorAutoAnswer", String(state.simulatorAutoAnswer));
    if (!state.simulatorAutoAnswer) cancelSimulatorAutoAnswerTimers();
    else scheduleSimulatorAutoAnswers(info);
  });
  const awareToggle = document.getElementById("simAwareAbilitiesToggle");
  awareToggle?.addEventListener("change", () => {
    state.simulatorAwareAbilities = Boolean(awareToggle.checked);
    window.localStorage.setItem("studyAdventureSimulatorAwareAbilities", String(state.simulatorAwareAbilities));
    if (!state.simulatorAwareAbilities) cancelSimulatorAwareAbilityTimers();
    else if (canSimulate) scheduleSimulatorAwareAbilities(info);
  });
  document.querySelectorAll(".simAnswerBtn").forEach((button) => {
    button.addEventListener("click", () => simulateDeviceAnswers(button.dataset.mode || "correct"));
  });
  if (state.simulatorAutoAnswer && autoAvailable) scheduleSimulatorAutoAnswers(info);
  if (state.simulatorAwareAbilities && canSimulate) scheduleSimulatorAwareAbilities(info);
}

function simulatorAwareThreatScore(encounter) {
  if (!encounter) return 0;
  return (encounter.enemies || []).filter((enemy) => !enemy.defeated).reduce((total, enemy) => {
    const tier = combatSystem.enemyTiers?.[enemy.tier] || combatSystem.enemyTiers?.light || {};
    const activations = Math.max(1, Number(enemy.activations) || 1);
    const damage = Number(tier.damage?.[1]) || 2;
    const aoeDamage = Number(tier.aoeDamage?.[1]) || 1;
    return total + activations * (damage + (enemy.aoe ? aoeDamage : 0));
  }, 0);
}

function simulatorAwareAbilityPlan(participant, info = currentQuestionInfo()) {
  const player = state.players.find((entry) => sameName(entry.name, participant?.name));
  if (!player || player.incapacitated) return null;
  const node = state.nodes[state.currentNode] || {};
  const combatRoom = isCombatNode(node);
  const encounter = combatRoom ? currentCombatEncounter() : null;
  const active = state.players.filter((entry) => !entry.incapacitated);
  const target = active.slice().sort((a, b) => {
    const aRatio = (Number(a.hp) || 0) / Math.max(1, Number(a.maxHp) || 1);
    const bRatio = (Number(b.hp) || 0) / Math.max(1, Number(b.maxHp) || 1);
    return aRatio - bRatio;
  })[0] || player;
  const targetRatio = (Number(target.hp) || 0) / Math.max(1, Number(target.maxHp) || 1);
  const threat = simulatorAwareThreatScore(encounter);
  const enemyRatio = encounter ? (Number(encounter.hp) || 0) / Math.max(1, Number(encounter.maxHp) || 1) : 0;
  const aliveEnemies = (encounter?.enemies || []).filter((enemy) => !enemy.defeated).length;
  const hintNeeded = Boolean(
    info?.question
    && (state.simulatorAutoAnswerAccuracy < 75 || info.question.mode === "fill" || info.type?.kind === "locked")
  );
  const candidates = [];
  const addCandidate = (action, label, reason, priority) => candidates.push({ action, label, reason, priority });
  const classId = String(player.classId || "").toLowerCase();
  const classCooldown = classAbilityCooldownState(player);
  const needsHealing = targetRatio <= 0.62;
  const incapacitatedTarget = state.players.find((entry) => entry.incapacitated) || null;

  if (classId === "medic" && combatRoom && incapacitatedTarget && medicReviveCooldownState(player).ready) {
    addCandidate(`CLASS:medic-revive:${incapacitatedTarget.name}`, "Medic revive", `${incapacitatedTarget.name} is incapacitated`, 150);
  }
  const levelSix = levelSixAbilityDefinition(classId);
  if (levelSix && !levelSix.passive && classId !== "medic" && levelSixAbilityCooldownState(player).ready) {
    const shouldUse = classId === "scout"
      ? hintNeeded
      : combatRoom && (classId === "soldier" ? state.simulatorAutoAnswerAccuracy < 80 : classId === "enforcer" ? threat >= 6 : classId === "tactician" ? (needsHealing || threat >= 5) : false);
    if (shouldUse) addCandidate(`ULTIMATE:${classId}`, levelSix.label, "level 6 combat window", 125);
  }

  if (classCooldown.ready) {
    if (classId === "medic" && needsHealing && target) {
      addCandidate(`CLASS:medic:${target.name}`, "Medic heal", `${target.name} is at ${Math.round(targetRatio * 100)}% HP`, 100 + (1 - targetRatio) * 20);
    } else if (classId === "scout" && hintNeeded) {
      addCandidate("CLASS:scout", "Scout hint", "answer confidence is low for this prompt", 60);
    } else if (classId === "enforcer" && combatRoom && (threat >= 4 || targetRatio <= 0.7 || (player.enforcerReserve > 0 && player.hp < player.maxHp))) {
      addCandidate("CLASS:enforcer", "Enforcer shield", `expected incoming threat is ${Math.round(threat)} damage`, 78 + Math.min(12, threat));
    } else if (classId === "engineer" && combatRoom && (threat >= 4 || aliveEnemies > 1)) {
      addCandidate(`CLASS:engineer:${target.name}`, "Engineer disruption", `${aliveEnemies} hostiles or ${Math.round(threat)} expected incoming damage`, 72 + Math.min(12, threat));
    } else if (classId === "soldier" && combatRoom && enemyRatio > 0.15 && enemyRatio < 0.9) {
      addCandidate("CLASS:soldier", "Soldier Double Tap", "the hostile is healthy enough for an empowered strike", 54);
    } else if (classId === "tactician" && combatRoom) {
      const protocol = needsHealing ? "support" : threat >= 5 ? "guard" : enemyRatio <= 0.6 ? "assault" : "guard";
      const reason = protocol === "support" ? `${target.name} needs stabilization` : protocol === "guard" ? `expected threat is ${Math.round(threat)} damage` : "the hostile is in the coordinated-damage window";
      addCandidate(`CLASS:tactician:${protocol}`, `Tactician ${protocol}`, reason, protocol === "support" ? 82 : 58);
    }
  }

  for (const itemId of Array.isArray(player.items) ? player.items : []) {
    const item = itemForPlayer(itemId);
    const ability = itemAbilityDefinition(item);
    if (!item || !ability || !itemAbilityCooldownState(player, item, ability).ready) continue;
    if (ability.effect === "heal" && needsHealing && target) {
      addCandidate(`ABILITY:${item.id}:${target.name}`, `${ability.label} heal`, `${target.name} is the squad's most urgent healing target`, 88 + (1 - targetRatio) * 16);
    } else if (ability.effect === "hint" && hintNeeded) {
      addCandidate(`ABILITY:${item.id}`, `${ability.label} hint`, "the prompt needs extra information before answering", 56);
    } else if (combatRoom && ability.effect === "guard" && threat >= 4) {
      addCandidate(`ABILITY:${item.id}`, `${ability.label} guard`, `expected incoming threat is ${Math.round(threat)} damage`, 68 + Math.min(10, threat));
    } else if (combatRoom && ability.effect === "disrupt" && (threat >= 4 || aliveEnemies > 1)) {
      addCandidate(`ABILITY:${item.id}`, `${ability.label} disrupt`, "multiple hostile activations are active", 67 + Math.min(8, aliveEnemies));
    } else if (combatRoom && ability.effect === "damage" && enemyRatio > 0.2) {
      addCandidate(`ABILITY:${item.id}`, `${ability.label} damage`, "the hostile can still benefit from a bonus strike", 48);
    }
  }
  return candidates.sort((a, b) => b.priority - a.priority)[0] || null;
}

function scheduleSimulatorAwareAbilities(info = currentQuestionInfo()) {
  if (!state.simulatorAwareAbilities || !state.started || state.deviceMode !== "multi" || !state.questionPresentationReady || state.answerPending || state.resolutionDelayPending || state.resolved || !state.playerPromptId) return;
  if (state.bossReadyPending || state.nodes[state.currentNode]?.type === "recovery") return;
  const promptId = state.playerPromptId;
  if (state.simulatorAwareAbilityPromptId === promptId) return;
  cancelSimulatorAwareAbilityTimers();
  state.simulatorAwareAbilityPromptId = promptId;
  const plans = simulatedAnswerParticipants(info)
    .map((participant) => ({ participant, plan: simulatorAwareAbilityPlan(participant, info) }))
    .filter((entry) => entry.plan);
  const status = document.getElementById("simulatorStatus");
  if (!plans.length) {
    if (status) status.textContent = "Aware abilities: no high-value action this turn.";
    return;
  }
  if (status) status.textContent = `Aware abilities: ${plans.length} bot action${plans.length === 1 ? "" : "s"} queued.`;
  plans.forEach(({ participant, plan }, index) => {
    const timerId = window.setTimeout(() => submitSimulatorAwareAbility(participant, promptId, plan), 700 + index * 260);
    state.simulatorAwareAbilityTimers.push(timerId);
  });
}

function submitSimulatorAwareAbility(participant, promptId, plan, attempt = 0) {
  if (!state.simulatorAwareAbilities || promptId !== state.playerPromptId || !state.questionPresentationReady || state.answerPending || state.resolved) return;
  playerSessionApi.submitAction({
    roomCode: state.roomCode,
    playerId: participant.id,
    playerName: participant.name,
    promptId,
    action: plan.action
  }).then((result) => {
    const status = document.getElementById("simulatorStatus");
    if (result?.ok) {
      if (status) status.textContent = `${participant.name}: ${plan.label} queued — ${plan.reason}.`;
      logDebugEvent({ kind: "state", label: "Aware bot ability queued", detail: `${participant.name} | ${plan.action} | ${plan.reason}` });
      return;
    }
    const retryable = !result || /locking|not accepting|no longer active|prompt/i.test(String(result?.error || ""));
    if (retryable && attempt < 2 && promptId === state.playerPromptId && !state.resolved) {
      const timerId = window.setTimeout(() => submitSimulatorAwareAbility(participant, promptId, plan, attempt + 1), 900 + attempt * 350);
      state.simulatorAwareAbilityTimers.push(timerId);
      return;
    }
    if (status) status.textContent = `${participant.name}: ability not queued (${result?.error || "unavailable"}).`;
  }).catch(() => {});
}

function scheduleSimulatorAutoAnswers(info = currentQuestionInfo()) {
  if (!state.simulatorAutoAnswer || state.actionDrivenMode || !info.question || !state.playerPromptId) return;
  if (!state.started || state.deviceMode !== "multi" || !state.questionPresentationReady || state.answerPending || state.resolutionDelayPending || state.resolved) return;
  if (isCombatNode(state.nodes[state.currentNode]) && els.combatStage?.classList.contains("entering")) return;
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
  const isEmergencyPrompt = info.type.kind === "emergency";
  const remainingMs = state.emergencyTimer
    ? Math.max(0, Number(state.emergencyTimer.remainingMs) || 0)
    : isEmergencyPrompt ? 10_000 : 0;
  if (isEmergencyPrompt) {
    // Emergency responses are meant to feel like a last-second scramble. Keep
    // the simulator quiet until the final five seconds instead of letting a
    // bot win the first-response race immediately after the prompt opens.
    const delay = Math.max(0, remainingMs - EMERGENCY_SIM_TARGET_REMAINING_MS);
    if (status) status.textContent = `Auto-Answer armed for ${pendingParticipants.length} sim player${pendingParticipants.length === 1 ? "" : "s"}; emergency response held for the final 5 seconds.`;
    pendingParticipants.forEach((participant, index) => {
      const timerId = window.setTimeout(() => {
        submitSimulatorAutoAnswer(participant, promptId, info, 0);
      }, delay + index * 120);
      state.simulatorAutoAnswerTimers.push(timerId);
    });
    return;
  }
  const timerSafetyBuffer = state.emergencyTimer?.kind === "emergency" ? 3_000 : 4_500;
  const maxDelay = remainingMs > 0
    ? Math.max(650, Math.min(9_000, remainingMs - timerSafetyBuffer))
    : 9_000;
  if (status) status.textContent = `Auto-Answer armed for ${pendingParticipants.length} sim player${pendingParticipants.length === 1 ? "" : "s"}.`;
  pendingParticipants.forEach((participant, index) => {
    const minimumDelay = Math.min(maxDelay, 2_250 + index * 180);
    const spread = Math.max(220, maxDelay - minimumDelay);
    const delay = Math.min(maxDelay, minimumDelay + Math.floor(Math.random() * spread));
    const timerId = window.setTimeout(() => {
      submitSimulatorAutoAnswer(participant, promptId, info, 0);
    }, delay);
    state.simulatorAutoAnswerTimers.push(timerId);
  });
}

function submitSimulatorAutoAnswer(participant, promptId, info, attempt = 0, accuracyDecision = null) {
  if (!state.simulatorAutoAnswer || state.actionDrivenMode) return;
  if (promptId !== state.playerPromptId || !state.questionPresentationReady || state.answerPending || state.resolutionDelayPending || state.resolved) return;
  if (participantHasCurrentSubmission(participant)) return;
  const shouldBeCorrect = typeof accuracyDecision === "boolean"
    ? accuracyDecision
    : Math.random() * 100 < state.simulatorAutoAnswerAccuracy;
  playerSessionApi.submitAnswer({
    roomCode: state.roomCode,
    playerId: participant.id,
    playerName: participant.name,
    promptId,
    answer: simulatedAnswerFor(info.question, shouldBeCorrect)
  })
    .then((result) => {
      if (result?.ok) return playerSessionApi.fetchAnswers(state.roomCode, promptId);
      const retryable = !result || /locking|not accepting|no longer active/i.test(String(result?.error || ""));
      if (retryable && attempt < 4 && promptId === state.playerPromptId && !state.resolved) {
        repairCurrentPromptPublication(promptId).then(() => {
          const timerId = window.setTimeout(() => submitSimulatorAutoAnswer(participant, promptId, info, attempt + 1, shouldBeCorrect), 2_150 + attempt * 250);
          state.simulatorAutoAnswerTimers.push(timerId);
        });
        return null;
      }
      throw new Error(result?.error || "Simulator answer rejected");
    })
    .then((payload) => {
      if (payload) handlePlayerAnswersPayload(payload, promptId);
    })
    .catch(() => pollPlayerAnswers());
}

function submitSimulatorAnswerWithRetry(participant, promptId, answer, attempt = 0) {
  if (promptId !== state.playerPromptId || state.resolved) return Promise.resolve(null);
  return playerSessionApi.submitAnswer({
    roomCode: state.roomCode,
    playerId: participant.id,
    playerName: participant.name,
    promptId,
    answer
  }).then((result) => {
    if (result?.ok) return result;
    const retryable = !result || /locking|not accepting|no longer active/i.test(String(result?.error || ""));
    if (!retryable || attempt >= 5 || promptId !== state.playerPromptId || state.resolved) return result;
    return new Promise((resolve) => {
      repairCurrentPromptPublication(promptId).then(() => {
        window.setTimeout(() => resolve(submitSimulatorAnswerWithRetry(participant, promptId, answer, attempt + 1)), 2_150 + attempt * 200);
      });
    });
  });
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
  repairCurrentPromptPublication(promptId).then(() => Promise.all(participants.map((participant, index) => {
    const shouldBeCorrect = mode === "correct" || mode === "mixed" && index % 2 === 0;
    return submitSimulatorAnswerWithRetry(participant, promptId, simulatedAnswerFor(info.question, shouldBeCorrect));
  }))).then((results) => {
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

function renderItemRewardChoice() {
  const reward = state.pendingRewardChoice;
  if (!reward || !els.itemRewardOverlay) return;
  const player = reward.queue[reward.index];
  if (!player) return finishItemRewardChoice();
  const currentItems = playerItems(player);
  els.itemRewardOverlay.hidden = false;
  els.itemRewardTitle.textContent = `${player.name}: choose equipment`;
  els.itemRewardSubtitle.textContent = `${reward.source}. ${reward.firstBoss ? "Purple-tier reward guaranteed." : "Choose one item or leave the cache."}`;
  els.itemRewardChoices.innerHTML = reward.choices.map((item) => `
    <button class="item-reward-card rarity-${escapeAttribute(item.rarity)}" type="button" data-item-id="${escapeAttribute(item.id)}">
      <span class="item-rarity">${escapeHtml(combatSystem.itemRarity(item.rarity).label)}</span>
      <strong>${escapeHtml(item.name)}</strong>
      <small>${escapeHtml(item.summary)}${item.risk ? " · RISK ITEM" : ""}</small>
    </button>
  `).join("");
  if (currentItems.length >= 2) {
    els.itemRewardChoices.insertAdjacentHTML("beforeend", `<label class="item-replace-select">Replace slot <select id="itemRewardReplaceSlot"><option value="0">${escapeHtml(currentItems[0].name)}</option><option value="1">${escapeHtml(currentItems[1].name)}</option></select></label>`);
  }
  els.itemRewardChoices.insertAdjacentHTML("beforeend", `<button class="item-reward-skip secondary" type="button" data-skip-reward>Leave cache</button>`);
  els.itemRewardContinueBtn.disabled = true;
  els.itemRewardChoices.querySelectorAll("[data-item-id]").forEach((button) => button.addEventListener("click", () => {
    els.itemRewardChoices.querySelectorAll("[data-item-id]").forEach((node) => node.classList.remove("selected"));
    button.classList.add("selected");
    reward.selected = button.dataset.itemId;
    reward.replaceIndex = Number(document.getElementById("itemRewardReplaceSlot")?.value ?? -1);
    els.itemRewardContinueBtn.disabled = false;
  }));
  els.itemRewardChoices.querySelector("[data-skip-reward]")?.addEventListener("click", () => {
    reward.selected = "";
    els.itemRewardContinueBtn.disabled = false;
  });
}

function openItemCodex() {
  if (!els.itemCodexOverlay) return;
  const discovered = new Set(Object.keys(state.itemCodex || {}));
  const list = (combatSystem.items || []).filter((item) => discovered.has(item.id));
  els.itemCodexSummary.textContent = `${list.length} / ${(combatSystem.items || []).length} items discovered`;
  els.itemCodexList.innerHTML = list.length ? list.map((item) => `<article class="codex-item-card rarity-${escapeAttribute(item.rarity)}"><span class="item-rarity">${escapeHtml(combatSystem.itemRarity(item.rarity).label)}</span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.summary)}${item.risk ? " · Risk item" : ""}</small></article>`).join("") : `<p class="muted-small">No equipment discovered yet. Clear hostile rooms to find caches.</p>`;
  els.itemCodexOverlay.hidden = false;
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

  root.StudyAdventureDashboardOptional = Object.freeze({
    renderSimulatorPanel,
    renderItemRewardChoice,
    openItemCodex,
    renderDebugConsole
  });
})(window);
