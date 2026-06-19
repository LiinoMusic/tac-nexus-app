/**
 * Dynamische Scoring-Engine
 *
 * Berechnet einen gewichteten Score aus mehreren Faktoren:
 *
 * Score = Σ(Faktor × Gewicht × Multiplikator)
 *
 * Faktoren:
 *   - Siege / Niederlagen / Unentschieden (Basis)
 *   - Züge pro Sieg (Effizienz-Bonus)
 *   - Gegner-Stärke (AI-Level 0–4)
 *   - Skill-Einsatz (Taktik-Bonus)
 *   - Kampagnen-Fortschritt (Progression)
 *   - Siegesserie (Streak-Multiplikator)
 *   - Zeitbonus (Schnelligkeit)
 *
 * Skalierung: 0–999.999 Punkte (6-stellig für Leaderboard-Darstellung)
 */

import type { ScoreRawData } from '../types';

// Gewichtungskonstanten (tunable)
const WEIGHTS = {
  WIN_BASE: 1000,
  LOSS_PENALTY: -200,
  DRAW_BASE: 150,
  EFFICIENCY_MAX: 500,    // Bonus für wenige Züge
  OPPONENT_MULTIPLIER: 0.25, // Pro AI-Level
  SKILL_BONUS: 80,        // Pro Skill-Einsatz
  CAMPAIGN_MULTIPLIER: 2000, // × Fortschritt (0–1)
  STREAK_MULTIPLIER: 150, // Pro Sieg in Folge
  TIME_BONUS_MAX: 300,    // Max Zeitbonus
} as const;

export interface ScoreBreakdown {
  total: number;
  winBase: number;
  efficiencyBonus: number;
  opponentBonus: number;
  skillBonus: number;
  campaignBonus: number;
  streakBonus: number;
  timeBonus: number;
  grade: 'S' | 'A' | 'B' | 'C' | 'D';
}

/**
 * Berechnet den Gesamt-Score aus Rohdaten.
 * Idempotent — gleiche Eingaben → gleicher Score (für CRDT-Merge).
 */
export function calculateScore(data: ScoreRawData): ScoreBreakdown {
  // 1. Basis: Siege / Niederlagen / Unentschieden
  const winBase =
    data.wins * WEIGHTS.WIN_BASE +
    data.losses * WEIGHTS.LOSS_PENALTY +
    data.draws * WEIGHTS.DRAW_BASE;

  // 2. Effizienz-Bonus: weniger Züge = mehr Punkte
  //    Ideal: 3 Züge (Minimum). Maximum: 9 Züge.
  const avgMoves = data.avgMovesPerWin > 0 ? data.avgMovesPerWin : 9;
  const efficiencyRatio = Math.max(0, (9 - avgMoves) / 6); // 0–1
  const efficiencyBonus = Math.round(efficiencyRatio * WEIGHTS.EFFICIENCY_MAX * data.wins);

  // 3. Gegner-Stärke-Bonus
  const opponentBonus = Math.round(
    data.wins * data.opponentStrength * WEIGHTS.WIN_BASE * WEIGHTS.OPPONENT_MULTIPLIER,
  );

  // 4. Skill-Bonus
  const skillBonus = data.skillsUsed * WEIGHTS.SKILL_BONUS;

  // 5. Kampagnen-Fortschritt
  const campaignBonus = Math.round(data.campaignProgress * WEIGHTS.CAMPAIGN_MULTIPLIER);

  // 6. Streak-Bonus (exponentiell begrenzt)
  const streakBonus = Math.round(
    Math.min(data.maxWinStreak, 20) * WEIGHTS.STREAK_MULTIPLIER,
  );

  // 7. Zeitbonus (normalisiert auf 0–300s)
  const timeBonusNorm = Math.max(0, Math.min(1, data.timeBonus / 300));
  const timeBonus = Math.round(timeBonusNorm * WEIGHTS.TIME_BONUS_MAX * data.wins);

  const total = Math.max(
    0,
    winBase + efficiencyBonus + opponentBonus + skillBonus + campaignBonus + streakBonus + timeBonus,
  );

  // Grade-Berechnung
  let grade: ScoreBreakdown['grade'];
  if (total >= 50000) grade = 'S';
  else if (total >= 25000) grade = 'A';
  else if (total >= 10000) grade = 'B';
  else if (total >= 3000) grade = 'C';
  else grade = 'D';

  return {
    total,
    winBase: Math.max(0, winBase),
    efficiencyBonus,
    opponentBonus,
    skillBonus,
    campaignBonus,
    streakBonus,
    timeBonus,
    grade,
  };
}

/** Formatiert einen Score für die UI-Darstellung (z.B. 123456 → "123.456") */
export function formatScore(score: number): string {
  return score.toLocaleString('de-DE');
}

/** Berechnet den Rang-Titel basierend auf dem Score */
export function getRankTitle(score: number): string {
  if (score >= 100000) return 'Legende';
  if (score >= 75000) return 'Großmeister';
  if (score >= 50000) return 'Meister';
  if (score >= 25000) return 'Experte';
  if (score >= 10000) return 'Fortgeschrittener';
  if (score >= 3000) return 'Taktiker';
  if (score >= 1000) return 'Anfänger';
  return 'Neuling';
}
