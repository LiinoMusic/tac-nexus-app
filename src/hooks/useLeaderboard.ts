/**
 * useLeaderboard — Persistentes Offline-Leaderboard
 *
 * Verwaltet den lokalen Leaderboard-State mit:
 *   - Capacitor Preferences API für native persistente Speicherung
 *     (iOS: NSUserDefaults / Keychain, Android: SharedPreferences)
 *   - Automatischem Score-Update nach jedem Spielende
 *   - CRDT-Merge bei P2P-Sync
 *   - Optimistischen UI-Updates (React 19 useOptimistic)
 */

import {
  useState,
  useEffect,
  useCallback,
  useOptimistic,
  useTransition,
} from 'react';
import type { GameScore, LeaderboardEntry, AppState } from '../types';
import {
  mergeLeaderboards,
  buildLeaderboard,
  createScoreEntry,
  getPlayerRank,
} from '../engine/leaderboardMerge';
import { calculateScore } from '../engine/scoringEngine';

// Capacitor Preferences (nativer Key-Value-Store)
async function getPreferencesPlugin() {
  try {
    const { Preferences } = await import('@capacitor/preferences');
    return Preferences;
  } catch {
    // Web-Fallback: localStorage
    return {
      get: async ({ key }: { key: string }) => ({
        value: localStorage.getItem(key),
      }),
      set: async ({ key, value }: { key: string; value: string }) => {
        localStorage.setItem(key, value);
      },
    };
  }
}

const STORAGE_KEY = 'tac-nexus-leaderboard-v2';

async function loadScores(): Promise<GameScore[]> {
  const prefs = await getPreferencesPlugin();
  const result = await prefs.get({ key: STORAGE_KEY });
  if (!result.value) return [];
  try {
    return JSON.parse(result.value) as GameScore[];
  } catch {
    return [];
  }
}

async function saveScores(scores: GameScore[]): Promise<void> {
  const prefs = await getPreferencesPlugin();
  await prefs.set({ key: STORAGE_KEY, value: JSON.stringify(scores) });
}

// ----------------------------------------------------------------

export interface UseLeaderboardReturn {
  entries: LeaderboardEntry[];
  localScore: GameScore | null;
  localRank: number;
  totalPlayers: number;
  isLoading: boolean;
  isSyncing: boolean;
  lastSyncTime: number | null;
  /** Aktualisiert den Score des lokalen Spielers nach einem Spiel */
  updateLocalScore: (appState: AppState) => Promise<void>;
  /** Merged Remote-Scores (nach P2P-Sync) */
  mergeRemoteScores: (remoteScores: GameScore[]) => Promise<GameScore[]>;
  /** Gibt alle rohen Score-Einträge zurück (für P2P-Übertragung) */
  getRawScores: () => GameScore[];
}

export function useLeaderboard(
  playerId: string,
  deviceId: string,
): UseLeaderboardReturn {
  const [scores, setScores] = useState<GameScore[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<number | null>(null);
  const [, startTransition] = useTransition();

  // Optimistisches UI-Update (React 19)
  const [optimisticScores, addOptimisticScore] = useOptimistic(
    scores,
    (currentScores: GameScore[], newScore: GameScore) => {
      const existing = currentScores.findIndex(
        (s) => s.playerId === newScore.playerId,
      );
      if (existing === -1) return [...currentScores, newScore];
      const updated = [...currentScores];
      updated[existing] = newScore;
      return updated;
    },
  );

  // ---- Initialisierung ----
  useEffect(() => {
    loadScores().then((loaded) => {
      setScores(loaded);
      setIsLoading(false);
    });
  }, []);

  // ---- Abgeleitete Werte ----
  const entries = buildLeaderboard(optimisticScores, playerId);
  const localScore = optimisticScores.find((s) => s.playerId === playerId) ?? null;
  const localRank = getPlayerRank(optimisticScores, playerId);

  // ---- Score-Update nach Spielende ----
  const updateLocalScore = useCallback(
    async (appState: AppState) => {
      const existing = scores.find((s) => s.playerId === playerId);
      const newEntry = createScoreEntry({
        playerId,
        playerName: appState.playerName,
        deviceId,
        wins: appState.totalWins,
        losses: appState.totalLosses,
        draws: appState.totalDraws,
        totalMoves: appState.totalMoves,
        skillsUsed: appState.ownedSkills.length,
        campaignProgress: appState.currentNode / 10,
        maxWinStreak: appState.playerProfile.winStreak,
        opponentStrength: 2, // Durchschnittlicher AI-Level
        timeBonus: 0,
        existingVersion: existing?.version,
      });

      // Optimistisches Update sofort
      startTransition(() => {
        addOptimisticScore(newEntry);
      });

      // Persistenz im Hintergrund
      const updatedScores = scores.filter((s) => s.playerId !== playerId);
      updatedScores.push(newEntry);
      setScores(updatedScores);
      await saveScores(updatedScores);
    },
    [scores, playerId, deviceId, addOptimisticScore],
  );

  // ---- P2P-Merge ----
  const mergeRemoteScores = useCallback(
    async (remoteScores: GameScore[]): Promise<GameScore[]> => {
      setIsSyncing(true);
      try {
        const result = mergeLeaderboards(scores, remoteScores, deviceId);
        const merged = result.merged;

        startTransition(() => {
          setScores(merged);
        });

        await saveScores(merged);
        setLastSyncTime(Date.now());

        return merged;
      } finally {
        setIsSyncing(false);
      }
    },
    [scores, deviceId],
  );

  const getRawScores = useCallback((): GameScore[] => scores, [scores]);

  return {
    entries,
    localScore,
    localRank,
    totalPlayers: optimisticScores.length,
    isLoading,
    isSyncing,
    lastSyncTime,
    updateLocalScore,
    mergeRemoteScores,
    getRawScores,
  };
}
