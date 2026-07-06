(function exposeStudyAdventurePrompts(root, factory) {
  const prompts = factory();
  if (root) {
    root.StudyAdventurePrompts = prompts;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function buildStudyAdventurePrompts() {
  function makeActionJudgmentPrompt(context) {
    const {
      operation,
      environment,
      areaName,
      roomLabel,
      roomObjective,
      roomEntities,
      threat,
      threatProfile,
      timeout,
      pressureSpotlight,
      pressureOperatorName,
      activeOperators,
      actionLines
    } = context || {};

    return [
      "FINAL OUTPUT ONLY. Return valid JSON only. No markdown. No commentary.",
      "Judge player field actions for a survival mission room.",
      "Decide whether each action is helpful, risky, reckless, harmful, brilliant, or flavor based on the current room, threat, and objective.",
      "Do not punish creative actions just because they are unusual. Reckless means physically unsafe, implausible under pressure, exposes the team, harms teammates, or ignores the room danger.",
      "A risky action can still score positive if it directly addresses the objective with a believable method.",
      "Use scores from -5 to 6: brilliant 5-6, helpful 2-4, risky but useful 1-3, flavor 0, weak/vague -1, reckless -2 to -4, harmful -5.",
      "Extract act and targetText from each player's action. Resolve targetText against room entities, active enemies, and active operators.",
      "targetResolution must be exactly one of: matched_existing, matched_enemy, matched_operator, created_one_off, invalid_target, no_target.",
      "Choose a targetId from the room entities when targetResolution is matched_existing or matched_enemy. Repeated searches of exhausted objects should score low or risky unless the action names a different valid target.",
      "Never return empty targetId or resolvedTargetLabel. If no clear target exists, use targetResolution no_target, targetId nothing, and resolvedTargetLabel nothing.",
      "If a plausible non-persistent target exists, use created_one_off and resolvedTargetLabel. If the target is imaginary, hallucinated, a mirage, or nonsensical, use invalid_target and resolvedTargetLabel imaginary target, hallucination, mirage, or nothing.",
      "Rate how much actor + act + target makes sense in this room from 1 to 10 as senseRating. If senseRating is 3 or lower, classification should be flavor, weak, reckless, or harmful and score should be 0 or lower.",
      "Hazard safety tags are binding context. If an action directly performs a tagged unsafe interaction without protection, shutdown, distance, tools, containment, or mitigation, classify it as reckless or harmful with high risk.",
      "If this action causes a different existing room entity to react, include it in secondaryEffects. Examples: an enemy becomes alerted, engaged, distracted, pinned, retreating, wounded, or closing; a hazard escalates or weakens; a route becomes watched or exposed.",
      "If an enemy enters direct combat, attacks, pins, corners, or closes into melee with an operator, set engagedWith to that operator name. If it only notices the squad or moves closer, leave engagedWith as nothing and use stateChange instead.",
      "secondaryEffects may only target existing room entity ids. Do not invent new persistent entities in secondaryEffects.",
      "If a player names an object that is not present, do not invent that object. Map the action to the closest existing entity with a brief correction in reason/stateChange, or score it as weak/no progress if no plausible match exists.",
      "If an action uses a wrong label for a present entity, keep targetId on the real entity and make stateChange describe the adapted real interaction.",
      "Return this exact shape: {\"actions\":[{\"playerName\":\"Name\",\"act\":\"short verb phrase\",\"targetText\":\"target phrase from action or nothing\",\"targetResolution\":\"matched_existing\",\"targetId\":\"entity_id or nothing\",\"resolvedTargetLabel\":\"entity label, one-off label, hallucination, mirage, imaginary target, or nothing\",\"senseRating\":7,\"classification\":\"helpful\",\"score\":3,\"risk\":\"low\",\"reason\":\"short concrete reason\",\"tagsUsed\":[\"searchable\"],\"stateChange\":\"short change\",\"pressureDelta\":0,\"usesDelta\":-1,\"entityDamage\":0,\"createsOpening\":false,\"secondaryEffects\":[{\"targetId\":\"entity_id\",\"stateChange\":\"alerted and closing\",\"pressureDelta\":1,\"entityDamage\":0,\"engagedWith\":\"Name or nothing\"}]}]}",
      `Operation: ${operation}.`,
      `Environment: ${environment}.`,
      `Current area: ${areaName}.`,
      `Room type: ${roomLabel}.`,
      `Room objective: ${roomObjective}.`,
      `Room entities:\n${roomEntities}`,
      `Persistent threat: ${threat}; ${threatProfile}.`,
      timeout ? "Important context: the response window expired before all required actions were submitted." : "",
      pressureSpotlight && pressureOperatorName ? `High-pressure spotlight: ${pressureOperatorName} was singled out for a fast reaction.` : "",
      `Active operators: ${activeOperators}.`,
      `Actions to judge in order: ${actionLines}`
    ].filter(Boolean).join("\n");
  }

  function makeSingleActionResolutionPrompt(context) {
    const {
      sentenceRange,
      playerName,
      operation,
      environment,
      areaName,
      roomObjective,
      relevantTargetLine,
      action,
      rollLine,
      injuryCue,
      secondaryFacts,
      rewardFacts,
      statusContext,
      sequenceContext,
      threat,
      threatProfile
    } = context || {};

    return [
      `Write player-facing narration for one operator action in ${sentenceRange} sentences.`,
      "Resolve only this action. Do not summarize the whole room.",
      `Use third person only. Name ${playerName} directly. Do not write "you" or "your."`,
      `If ${playerName} is hurt or gains a status, explain exactly why before ending.`,
      "Do not mention scores, categories, mechanics, prompts, rules, HP numbers, or hidden state.",
      "",
      `Operation: ${operation}.`,
      `Environment: ${environment}.`,
      `Current area: ${areaName}.`,
      `Room objective: ${roomObjective}.`,
      relevantTargetLine,
      "",
      `Operator: ${playerName}.`,
      `Action: ${action}.`,
      rollLine,
      injuryCue,
      secondaryFacts?.length ? `Approved secondary room state: ${secondaryFacts.join(" ")}` : "",
      rewardFacts?.length ? `Reward facts: ${rewardFacts.join(" ")}` : "",
      `Status context: ${statusContext}`,
      `Sequence context: ${sequenceContext}.`,
      "",
      `Persistent threat: ${threat}. ${threatProfile}`
    ].filter(Boolean).join("\n");
  }

  function makeMissionBriefingPrompt(context) {
    const {
      fieldLength,
      actionDrivenMode,
      missionType,
      environment,
      threat,
      threatProfile,
      teamSize
    } = context || {};

    return [
      "Create a concise survival-mission briefing. Return valid JSON only.",
      "Fields: title, subtitle, situation, objective, route, engagement, threatDetails, bossAreas.",
      "threatDetails object fields: manifestation, signs, tactics, escalation, confrontation, weakness.",
      "bossAreas object fields: mid, final. Each is a short themed location name, 2-5 words, no OPERATION prefix.",
      "Title: fresh 2-4 word military operation name starting with OPERATION.",
      `Each field: ${fieldLength}, immersive, practical, grammatically clean.`,
      "No AI/meta/quiz/dice/odds/answers. The team has not entered the first room.",
      "Situation: overall mission scene, threat, route danger, and stakes. Do not focus on first room, first device, or study material.",
      actionDrivenMode ? "Action-driven mode: never write study concept, study material, classroom, quiz, question, answer, or knowledge check. Use field objective, route objective, survival task, repair, negotiation, escape, hazard, or confrontation language." : "",
      "Make the enemy type clear by behavior and signs, not a proper name.",
      "Threat details must be concrete and reusable for continuity.",
      `Mission style: ${missionType}.`,
      `Environment: ${environment}.`,
      `Threat archetype: ${threat}; ${threatProfile}.`,
      `Team size: ${teamSize}.`
    ].filter(Boolean).join("\n");
  }

  function makeActionRoomDescriptionPrompt(context) {
    const {
      sentenceRange,
      dialogueRequirement,
      pressureSpotlightLine,
      continuityRule,
      operation,
      environment,
      areaName,
      roomLabel,
      roomObjective,
      roomEntities,
      threat,
      threatProfile,
      threatPressure
    } = context || {};

    return [
      "FINAL OUTPUT ONLY. Write player-facing narration only. No markdown. No JSON.",
      `Create the visible room description for one action-driven survival room in ${sentenceRange} sentences.`,
      "Use the supplied room details; do not invent unrelated major objects, enemies, hazards, or exits.",
      "Hint toward the room objective through the physical situation, not by explaining game mechanics.",
      "Do not mention action turn, field action, players choosing actions, scoring, threat pressure, rolls, hidden mechanics, answer choices, quiz, or questions.",
      dialogueRequirement,
      pressureSpotlightLine,
      continuityRule,
      `Operation: ${operation}.`,
      `Environment: ${environment}.`,
      `Current area: ${areaName}.`,
      `Room type: ${roomLabel}.`,
      `Room objective: ${roomObjective}.`,
      `Generated room details:\n${roomEntities}`,
      `Threat: ${threat}; ${threatProfile}.`,
      `Hidden threat pressure for tone only: ${threatPressure}.`
    ].filter(Boolean).join("\n");
  }

  function makeActionRoomOpeningPrompt(context) {
    const {
      sentenceRange,
      pressureSpotlightLine,
      continuityRule,
      operation,
      environment,
      areaName,
      roomLabel,
      roomObjective,
      roomEntities,
      threat,
      threatProfile,
      threatPressure
    } = context || {};

    return [
      "FINAL OUTPUT ONLY. Return valid JSON only. No markdown.",
      "Create the visible opening and hidden interactable entities for one survival mission room.",
      `Return this exact shape: {"opening":"${sentenceRange} player-facing sentences","entities":[{"id":"short_id","label":"specific room thing","type":"object|enemy|hazard|route|npc","role":"room_threat|persistent_threat_minion|persistent_threat_avatar|final_boss|none","tags":["searchable"],"state":"short state","usesRemaining":1,"hp":null,"maxHp":null,"armor":0,"pressure":0,"mitigation":0,"threshold":0,"vulnerabilities":["light"]}]}`,
      "The opening and entities must describe the same physical room. If the opening mentions a switch panel, the entities must include that switch panel; do not create unrelated generic objects.",
      "Do not mention action turn, turn 1, field action, action-driven, players choosing actions, scoring, threat pressure, rolls, hidden mechanics, answer choices, quiz, or questions.",
      pressureSpotlightLine,
      "Entities: return 4-8 specific interactables. Objects can have usesRemaining. Enemies should have role/hp/maxHp/armor/pressure/vulnerabilities and include their role as a tag. Hazards should have pressure/mitigation/threshold.",
      continuityRule,
      `Operation: ${operation}.`,
      `Environment: ${environment}.`,
      `Current area: ${areaName}.`,
      `Room type: ${roomLabel}.`,
      `Room objective: ${roomObjective}.`,
      `Fallback interactables available for inspiration only; replace with more specific matching entities if possible:\n${roomEntities}`,
      `Threat: ${threat}; ${threatProfile}.`,
      `Hidden threat pressure for tone only: ${threatPressure}.`
    ].filter(Boolean).join("\n");
  }

  function makeEnvironmentGeneratorPrompt(context) {
    const { missionType, currentEnvironmentIdea } = context || {};
    return [
      "FINAL OUTPUT ONLY. Return valid JSON only. No markdown. No commentary.",
      "Create one custom survival mission environment and one persistent enemy/boss concept for a classroom action-adventure mission.",
      "The environment should be concrete, playable, and visually distinct. Do not include a full story, first room, study topic, quiz, or question.",
      "The threat must be a persistent enemy or boss the party can understand clearly. It may be physical, human, machine, alien, supernatural, magical, tactical, or environmental depending on the mission style.",
      "Do not give the enemy a proper personal name unless it is a title-like identifier. Create a fresh, specific identity noun that fits the mission style and environment. Do not copy example names or reuse a generic stock enemy.",
      "Return this exact shape: {\"environment\":\"short playable mission location\",\"threatIdentity\":\"short boss/enemy identity noun\",\"threatDetails\":{\"manifestation\":\"how it appears or acts\",\"signs\":\"recurring signs players notice\",\"tactics\":\"how it threatens the squad\",\"escalation\":\"how it gets worse over the mission\",\"confrontation\":\"what the final confrontation looks like\",\"weakness\":\"how the squad can plausibly fight, contain, evade, or defeat it\"},\"bossAreas\":{\"mid\":\"short mid-boss area name\",\"final\":\"short final boss area name\"}}",
      `Mission style: ${missionType}.`,
      currentEnvironmentIdea
        ? `Current environment idea to transform, not merely repeat: ${currentEnvironmentIdea}.`
        : "No current environment idea is provided. Invent a fresh environment for this mission style."
    ].join("\n");
  }

  return {
    makeActionJudgmentPrompt,
    makeSingleActionResolutionPrompt,
    makeMissionBriefingPrompt,
    makeActionRoomDescriptionPrompt,
    makeActionRoomOpeningPrompt,
    makeEnvironmentGeneratorPrompt
  };
});
