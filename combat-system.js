(function exposeStudyAdventureCombat(root, factory) {
  const combat = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = combat;
  if (root) root.StudyAdventureCombat = combat;
})(typeof globalThis !== "undefined" ? globalThis : this, function buildStudyAdventureCombat() {
  const MAX_LEVEL = 6;
  const CLASS_IDS = ["soldier", "medic", "scout", "enforcer", "engineer", "tactician"];
  const LEVELS = [
    { level: 1, xp: 0, maxHp: 10 },
    { level: 2, xp: 20, maxHp: 12 },
    { level: 3, xp: 45, maxHp: 14 },
    { level: 4, xp: 75, maxHp: 16 },
    { level: 5, xp: 110, maxHp: 18 },
    { level: 6, xp: 150, maxHp: 20 }
  ];

  const classes = {
    soldier: {
      id: "soldier", label: "Soldier", gear: "Heavy Rifle",
      summary: "+2 combat damage, plus up to +5 from a correct-answer streak."
    },
    medic: {
      id: "medic", label: "Medic", gear: "Surgical Kit",
      summary: "Heal 4–8 HP from streak strength; recharges after 2 questions."
    },
    scout: {
      id: "scout", label: "Scout", gear: "Spectrum Analyzer",
      summary: "Reveal a question hint every 5 questions; gains a speed bonus when unused."
    },
    enforcer: {
      id: "enforcer", label: "Enforcer", gear: "Ballistic Shield",
      summary: "Passive streak-based protection; fully blocks one enemy phase every 5 questions."
    },
    engineer: {
      id: "engineer", label: "Engineer", gear: "Arc Toolkit",
      summary: "Improves obstacle work and can disrupt an enemy activation every 3 questions."
    },
    tactician: {
      id: "tactician", label: "Tactician", gear: "Adaptive Module",
      summary: "Select Assault, Guard, or Support protocol once per room."
    }
  };

  const enemyTiers = {
    light: { id: "light", label: "Light", hp: [8, 12], damage: [1, 3], aoeDamage: [1, 1] },
    medium: { id: "medium", label: "Medium", hp: [14, 20], damage: [3, 5], aoeDamage: [2, 3] },
    heavy: { id: "heavy", label: "Heavy", hp: [24, 34], damage: [5, 8], aoeDamage: [2, 4] }
  };

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, Number(value) || 0));
  }

  function classDefinition(classId) {
    return classes[String(classId || "").toLowerCase()] || null;
  }

  function levelForXp(xp) {
    const total = Math.max(0, Math.round(Number(xp) || 0));
    return [...LEVELS].reverse().find((entry) => total >= entry.xp) || LEVELS[0];
  }

  function normalizePlayer(player = {}, fallbackClassId = "soldier") {
    const classId = classDefinition(player.classId)?.id || classDefinition(fallbackClassId)?.id || "soldier";
    const levelInfo = levelForXp(player.xp);
    const maxHp = levelInfo.maxHp;
    return {
      ...player,
      classId,
      classGear: classDefinition(classId).gear,
      level: levelInfo.level,
      xp: Math.max(0, Math.round(Number(player.xp) || 0)),
      maxHp,
      hp: clamp(player.hp == null ? maxHp : player.hp, 0, maxHp),
      answerStreak: clamp(player.answerStreak, 0, 999),
      equippedItem: player.equippedItem || null,
      classCooldowns: { ...(player.classCooldowns || {}) }
    };
  }

  function addXp(player, amount) {
    const before = levelForXp(player.xp);
    player.xp = Math.max(0, Math.round(Number(player.xp) || 0) + Math.max(0, Math.round(Number(amount) || 0)));
    const after = levelForXp(player.xp);
    player.level = after.level;
    player.maxHp = after.maxHp;
    const levelsGained = Math.max(0, after.level - before.level);
    if (levelsGained) player.hp = Math.min(player.maxHp, Math.max(0, Number(player.hp) || 0) + levelsGained * 2);
    return { amount: Math.max(0, Math.round(Number(amount) || 0)), leveledUp: after.level > before.level, before, after };
  }

  function recordAnswer(player, correct) {
    player.answerStreak = correct ? Math.max(0, Number(player.answerStreak) || 0) + 1 : 0;
    return player.answerStreak;
  }

  function answerDamage(elapsedMs, durationMs, difficulty = "medium") {
    const ratio = clamp((Number(elapsedMs) || 0) / Math.max(1000, Number(durationMs) || 60000), 0, 1);
    const base = ratio <= 0.25 ? 4 : ratio <= 0.5 ? 3 : ratio <= 0.75 ? 2 : 1;
    const difficultyBonus = String(difficulty).toLowerCase() === "hard" ? 2 : String(difficulty).toLowerCase() === "medium" ? 1 : 0;
    return base + difficultyBonus;
  }

  function classCombatDamage(player) {
    if (player?.classId !== "soldier") return 0;
    return 2 + Math.min(5, Math.max(0, Number(player.answerStreak) || 0));
  }

  function xpForCorrectAnswer({ fast = false, difficulty = "medium", streak = 0 } = {}) {
    return 5 + (fast ? 2 : 0) + (difficulty === "hard" ? 2 : difficulty === "medium" ? 1 : 0) + (streak > 1 ? 1 : 0);
  }

  function rollRange(range, rng = Math.random) {
    const low = Math.floor(Number(range?.[0]) || 0);
    const high = Math.max(low, Math.floor(Number(range?.[1]) || low));
    return low + Math.floor(clamp(rng(), 0, 0.999999) * (high - low + 1));
  }

  function createEnemyGroup(tiers = ["light"], rng = Math.random) {
    const enemies = tiers.map((tierId, index) => {
      const tier = enemyTiers[tierId] || enemyTiers.light;
      const hp = rollRange(tier.hp, rng);
      return { id: `enemy-${index + 1}`, tier: tier.id, label: `${tier.label} Hostile ${index + 1}`, hp, maxHp: hp, defeated: false };
    });
    return { enemies, hp: enemies.reduce((sum, enemy) => sum + enemy.hp, 0), maxHp: enemies.reduce((sum, enemy) => sum + enemy.maxHp, 0) };
  }

  function applyGroupDamage(group, amount) {
    let remaining = Math.max(0, Math.round(Number(amount) || 0));
    const defeated = [];
    for (const enemy of group.enemies) {
      if (enemy.defeated || remaining <= 0) continue;
      const dealt = Math.min(enemy.hp, remaining);
      enemy.hp -= dealt;
      remaining -= dealt;
      if (enemy.hp <= 0) {
        enemy.hp = 0;
        enemy.defeated = true;
        defeated.push(enemy);
      }
    }
    group.hp = group.enemies.reduce((sum, enemy) => sum + enemy.hp, 0);
    return { damage: Math.max(0, Math.round(Number(amount) || 0)) - remaining, defeated, cleared: group.hp <= 0 };
  }

  return {
    MAX_LEVEL, CLASS_IDS, LEVELS, classes, enemyTiers,
    classDefinition, levelForXp, normalizePlayer, addXp, recordAnswer,
    answerDamage, classCombatDamage, xpForCorrectAnswer, rollRange,
    createEnemyGroup, applyGroupDamage
  };
});
