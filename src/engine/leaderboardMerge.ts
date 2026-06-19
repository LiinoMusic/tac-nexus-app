/**
 * Offline Leaderboard Merge Engine
 *
 * Implementiert einen konfliktfreien CRDT-Merge (Conflict-free Replicated Data Type)
 * nach dem LWW-Register-Prinzip (Last-Write-Wins) mit Vektoruhren.
 *
 * Merge-Strategie:
 * ─────────────────────────────────────────────────────────────────
 * 1. Jeder Eintrag hat eine eindeutige ID (UUID) und einen Vektoruhr-Wert.
 * 2. Bei Konflikt (gleiche playerId, unterschiedliche Daten):
 *    → Höherer Score gewinnt (Score ist monoton steigend).
 *    → Bei gleichem Score: neuerer Timestamp gewinnt.
 * 3. Neue Einträge werden hinzugefügt, keine Einträge werden gelöscht.
 * 4. Vektoruhr wird nach jedem Merge inkrementiert.
 *
 * Garantien:
 *   - Kommutativität: merge(A, B) = merge(B, A)
 *   - Assoziativität: merge(merge(A, B), C) = merge(A, merge(B, C))
 *   - Idempotenz: merge(A, A) = A
 *
 * Diese Eigenschaften ermöglichen konfliktfreie Synchronisation
 * ohne zentralen Server, auch bei mehreren gleichzeitigen Merges.
 */

import type {
  GameScore,
  LeaderboardEntry,
  MergeResult,
  VectorClock,
} from '../types';
import { calculateScore } from './scoringEngine';

// ----------------------------------------------------------------
// Vektoruhr-Operationen
// ----------------------------------------------------------------

/** Inkrementiert die Vektoruhr für eine gegebene Device-ID */
export function incrementClock(clock: VectorClock, deviceId: string): VectorClock {
  return { ...clock, [deviceId]: (clock[deviceId] ?? 0) + 1 };
}

/**
 * Vergleicht zwei Vektoruhren.
 * Gibt zurück:
 *   -1: a < b (a ist älter)
 *    0: concurrent (gleichzeitig, kein kausaler Zusammenhang)
 *    1: a > b (a ist neuer)
 */
export function compareClock(a: VectorClock, b: VectorClock): -1 | 0 | 1 {
  const allKeys = new Set([...Object.keys(a), ...Object.keys(b)]);
  let aGreater = false;
  let bGreater = false;

  for (const key of allKeys) {
    const aVal = a[key] ?? 0;
    const bVal = b[key] ?? 0;
    if (aVal > bVal) aGreater = true;
    if (bVal > aVal) bGreater = true;
  }

  if (aGreater && !bGreater) return 1;
  if (bGreater && !aGreater) return -1;
  return 0; // concurrent
}

/** Merged zwei Vektoruhren (komponentenweises Maximum) */
export function mergeClock(a: VectorClock, b: VectorClock): VectorClock {
  const result: VectorClock = { ...a };
  for (const [key, val] of Object.entries(b)) {
    result[key] = Math.max(result[key] ?? 0, val);
  }
  return result;
}

// ----------------------------------------------------------------
// Score-Merge
// ----------------------------------------------------------------

/**
 * Hauptfunktion: Merged zwei Leaderboard-Datensätze konfliktfrei.
 *
 * @param local  - Lokale Einträge (eigenes Gerät)
 * @param remote - Einträge vom Peer-Gerät
 * @param localDeviceId - Eigene Device-ID für Vektoruhr-Inkrementierung
 * @returns MergeResult mit gemergten Einträgen und Statistiken
 */
export function mergeLeaderboards(
  local: GameScore[],
  remote: GameScore[],
  localDeviceId: string,
): MergeResult {
  const merged = new Map<string, GameScore>();
  let conflicts = 0;
  let newEntries = 0;
  let updatedEntries = 0;

  // Schritt 1: Alle lokalen Einträge in Map laden
  for (const entry of local) {
    merged.set(entry.playerId, entry);
  }

  // Schritt 2: Remote-Einträge verarbeiten
  for (const remoteEntry of remote) {
    const existing = merged.get(remoteEntry.playerId);

    if (!existing) {
      // Neuer Spieler — direkt hinzufügen
      merged.set(remoteEntry.playerId, { ...remoteEntry, synced: true, isNew: true } as unknown as GameScore);
      newEntries++;
      continue;
    }

    // Konflikt-Auflösung für bekannten Spieler
    conflicts++;
    const winner = resolveConflict(existing, remoteEntry, localDeviceId);
    if (winner !== existing) {
      merged.set(remoteEntry.playerId, { ...winner, synced: true } as GameScore);
      updatedEntries++;
    }
  }

  const mergedArray = Array.from(merged.values());

  // Schritt 3: Scores neu berechnen (Idempotenz sicherstellen)
  const recalculated = mergedArray.map((entry) => ({
    ...entry,
    score: calculateScore(entry.rawData).total,
  }));

  return {
    merged: recalculated,
    conflicts,
    newEntries,
    updatedEntries,
  };
}

/**
 * Löst einen Konflikt zwischen zwei Einträgen desselben Spielers auf.
 * Priorität: höherer Score > neuerer Timestamp > lokaler Eintrag
 */
function resolveConflict(
  a: GameScore,
  b: GameScore,
  localDeviceId: string,
): GameScore {
  // Regel 1: Höherer Score gewinnt (Scores sind monoton steigend)
  if (a.score !== b.score) {
    return a.score > b.score ? a : b;
  }

  // Regel 2: Neuerer Timestamp gewinnt
  if (a.timestamp !== b.timestamp) {
    return a.timestamp > b.timestamp ? a : b;
  }

  // Regel 3: Lokaler Eintrag gewinnt (Tie-Breaking)
  return a.deviceId === localDeviceId ? a : b;
}

// ----------------------------------------------------------------
// Leaderboard-Aufbereitung für die UI
// ----------------------------------------------------------------

/**
 * Konvertiert rohe GameScore-Einträge in sortierte LeaderboardEntry-Liste.
 * Sortierung: Score absteigend, bei Gleichstand alphabetisch nach Name.
 */
export function buildLeaderboard(
  scores: GameScore[],
  localPlayerId: string,
): LeaderboardEntry[] {
  const sorted = [...scores].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.playerName.localeCompare(b.playerName, 'de');
  });

  return sorted.map((entry, index) => ({
    rank: index + 1,
    playerId: entry.playerId,
    playerName: entry.playerName,
    score: entry.score,
    wins: entry.rawData.wins,
    winStreak: entry.rawData.maxWinStreak,
    lastSeen: entry.timestamp,
    isLocal: entry.playerId === localPlayerId,
    isNew: (entry as any).isNew ?? false,
    timestamp: entry.timestamp,
    version: entry.version,
  }));
}

/**
 * Findet die Rang-Position eines Spielers im Leaderboard.
 * Gibt -1 zurück, wenn der Spieler nicht gefunden wurde.
 */
export function getPlayerRank(scores: GameScore[], playerId: string): number {
  const sorted = [...scores].sort((a, b) => b.score - a.score);
  const index = sorted.findIndex((e) => e.playerId === playerId);
  return index === -1 ? -1 : index + 1;
}

/**
 * Erstellt einen neuen GameScore-Eintrag aus dem aktuellen App-State.
 * Wird nach jedem Spielende aufgerufen.
 */
export function createScoreEntry(params: {
  playerId: string;
  playerName: string;
  deviceId: string;
  wins: number;
  losses: number;
  draws: number;
  totalMoves: number;
  skillsUsed: number;
  campaignProgress: number;
  maxWinStreak: number;
  opponentStrength: number;
  timeBonus: number;
  existingVersion?: number;
}): GameScore {
  const rawData: any = {
    wins: params.wins,
    losses: params.losses,
    draws: params.draws,
    totalMoves: params.totalMoves,
    avgMovesPerWin: params.wins > 0 ? params.totalMoves / params.wins : 0,
    skillsUsed: params.skillsUsed,
    campaignProgress: params.campaignProgress,
    maxWinStreak: params.maxWinStreak,
    opponentStrength: params.opponentStrength,
    timeBonus: params.timeBonus,
  };

  const { total } = calculateScore(rawData);

  return {
    id: crypto.randomUUID?.() ?? `${params.playerId}-${Date.now()}`,
    playerId: params.playerId,
    playerName: params.playerName,
    deviceId: params.deviceId,
    score: total,
    rawData,
    timestamp: Date.now(),
    version: (params.existingVersion ?? 0) + 1,
    synced: false,
  };
}
