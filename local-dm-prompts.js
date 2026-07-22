/*
 * LOCAL MODEL PROMPT CONTRACTS
 * ============================
 * Builds strict prompts for Ollama/LM Studio requests. Prompts request JSON so
 * app.js can validate structured judgments/environment metadata before applying
 * them. Narrative generation is currently disabled during the narration reset;
 * the exported placeholders preserve call-site compatibility while it is rebuilt.
 */
(function exposeStudyAdventurePrompts(root, factory) {
  const prompts = factory();
  if (root) root.StudyAdventurePrompts = prompts;
})(typeof globalThis !== "undefined" ? globalThis : this, function buildStudyAdventurePrompts() {
  function makeActionJudgmentPrompt(context = {}) {
    const {
      operation, environment, areaName, roomLabel, roomObjective, roomEntities,
      threat, threatProfile, timeout, pressureSpotlight, pressureOperatorName,
      activeOperators, actionLines
    } = context;
    return [
      "FINAL OUTPUT ONLY. Return valid JSON only. No markdown or narrative prose.",
      "Judge player field actions for a survival mission room.",
      "Classify each action as helpful, risky, reckless, harmful, brilliant, flavor, or weak.",
      "Score from -5 to 6. Creative but plausible actions may score well; physically unsafe or implausible actions should not.",
      "Resolve targets against existing room entities, enemies, and operators. Do not invent persistent entities.",
      "targetResolution must be matched_existing, matched_enemy, matched_operator, created_one_off, invalid_target, or no_target.",
      "Return: {\"actions\":[{\"playerName\":\"\",\"act\":\"\",\"targetText\":\"\",\"targetResolution\":\"no_target\",\"targetId\":\"nothing\",\"resolvedTargetLabel\":\"nothing\",\"senseRating\":5,\"classification\":\"helpful\",\"score\":2,\"risk\":\"low\",\"reason\":\"\",\"tagsUsed\":[],\"stateChange\":\"\",\"pressureDelta\":0,\"usesDelta\":0,\"entityDamage\":0,\"createsOpening\":false,\"secondaryEffects\":[]}]}",
      `Operation: ${operation}.`,
      `Environment: ${environment}.`,
      `Area: ${areaName}.`,
      `Room type: ${roomLabel}.`,
      `Objective: ${roomObjective}.`,
      `Entities:\n${roomEntities}`,
      `Threat: ${threat}; ${threatProfile}.`,
      timeout ? "The response window expired." : "",
      pressureSpotlight && pressureOperatorName ? `Priority operator: ${pressureOperatorName}.` : "",
      `Active operators: ${activeOperators}.`,
      `Actions: ${actionLines}`
    ].filter(Boolean).join("\n");
  }

  function makeEnvironmentGeneratorPrompt(context = {}) {
    const { missionType, currentEnvironmentIdea, midBossNamingCue, finalBossNamingCue } = context;
    return [
      "FINAL OUTPUT ONLY. Return valid JSON only. No markdown or narrative prose.",
      "Generate mission-setting metadata, not a scene or story.",
      "Return: {\"environment\":\"\",\"threatIdentity\":\"\",\"threatDetails\":{\"manifestation\":\"\",\"signs\":\"\",\"tactics\":\"\",\"escalation\":\"\",\"confrontation\":\"\",\"weakness\":\"\"},\"bossAreas\":{\"mid\":\"\",\"final\":\"\"}}",
      "Keep values concise, concrete, playable, and visually distinct.",
      "Naming cues are private inspiration. Never copy cue words or mention eye color.",
      `Mission style: ${missionType}.`,
      `Mid-boss direction: ${midBossNamingCue}.`,
      `Final-boss direction: ${finalBossNamingCue}.`,
      currentEnvironmentIdea ? `Environment idea to transform: ${currentEnvironmentIdea}.` : "Invent a fresh environment."
    ].join("\n");
  }

  const narrationRemoved = () => "NARRATION DISABLED";

  return {
    makeActionJudgmentPrompt,
    makeEnvironmentGeneratorPrompt,
    makeSingleActionResolutionPrompt: narrationRemoved,
    makeMissionBriefingPrompt: narrationRemoved,
    makeActionRoomDescriptionPrompt: narrationRemoved,
    makeActionRoomOpeningPrompt: narrationRemoved
  };
});
