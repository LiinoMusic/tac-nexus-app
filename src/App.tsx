/**
 * App.tsx — Haupt-App-Komponente
 *
 * Screen-Router, globaler State (Zustand), P2P-Initialisierung,
 * Leaderboard-Integration und Haptic-Feedback-Kontext.
 *
 * Screen-Hierarchie:
 *   HomeScreen
 *   ├── CampaignScreen → GameScreen (vs AI)
 *   ├── QuickGameScreen → GameScreen (vs AI)
 *   ├── P2PMatchmakingScreen → GameScreen (vs Peer)
 *   └── LeaderboardScreen
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AppState, SkillId, GameScore, GameResult } from './types';
import { generateUUID } from './utils/checksum';
import { useP2PMultiplayer } from './hooks/useP2PMultiplayer';
import { useLeaderboard } from './hooks/useLeaderboard';
import { useHapticFeedback } from './hooks/useHapticFeedback';
import { useGameEngine } from './hooks/useGameEngine';
import { LeaderboardScreen } from './components/LeaderboardScreen';
import { P2PMatchmakingScreen } from './components/P2PMatchmakingScreen';
import type { GameMovePayload } from './types';

// ----------------------------------------------------------------
// Globaler App-Store (Zustand + Persist → Capacitor Preferences)
// ----------------------------------------------------------------

interface AppStore extends AppState {
  setCoins: (coins: number) => void;
  addWin: () => void;
  addLoss: () => void;
  addDraw: () => void;
  addMove: () => void;
  setCurrentNode: (node: number) => void;
  addCompletedNode: (node: number) => void;
  addOwnedSkill: (skill: SkillId) => void;
  setPlayerName: (name: string) => void;
}

const useAppStore = create<AppStore>()(
  persist(
    (set) => ({
      coins: 0,
      totalWins: 0,
      totalLosses: 0,
      totalDraws: 0,
      totalMoves: 0,
      gamesPlayed: 0,
      currentNode: 0,
      completedNodes: [],
      ownedSkills: [],
      playerProfile: {
        prefersCenter: 0,
        prefersCorner: 0,
        prefersEdge: 0,
        aggressive: 0,
        defensive: 0,
        totalGames: 0,
        winStreak: 0,
        lossStreak: 0,
        avgMovesWin: 0,
      },
      playerId: generateUUID(),
      playerName: 'Spieler',
      deviceId: generateUUID(),

      setCoins: (coins) => set({ coins }),
      addWin: () =>
        set((s) => ({
          totalWins: s.totalWins + 1,
          gamesPlayed: s.gamesPlayed + 1,
          playerProfile: {
            ...s.playerProfile,
            winStreak: s.playerProfile.winStreak + 1,
            lossStreak: 0,
            totalGames: s.playerProfile.totalGames + 1,
          },
        })),
      addLoss: () =>
        set((s) => ({
          totalLosses: s.totalLosses + 1,
          gamesPlayed: s.gamesPlayed + 1,
          playerProfile: {
            ...s.playerProfile,
            winStreak: 0,
            lossStreak: s.playerProfile.lossStreak + 1,
            totalGames: s.playerProfile.totalGames + 1,
          },
        })),
      addDraw: () =>
        set((s) => ({
          totalDraws: s.totalDraws + 1,
          gamesPlayed: s.gamesPlayed + 1,
          playerProfile: {
            ...s.playerProfile,
            totalGames: s.playerProfile.totalGames + 1,
          },
        })),
      addMove: () => set((s) => ({ totalMoves: s.totalMoves + 1 })),
      setCurrentNode: (node) => set({ currentNode: node }),
      addCompletedNode: (node) =>
        set((s) => ({
          completedNodes: s.completedNodes.includes(node)
            ? s.completedNodes
            : [...s.completedNodes, node],
        })),
      addOwnedSkill: (skill) =>
        set((s) => ({
          ownedSkills: s.ownedSkills.includes(skill)
            ? s.ownedSkills
            : [...s.ownedSkills, skill],
        })),
      setPlayerName: (name) => set({ playerName: name }),
    }),
    {
      name: 'tac-nexus-state-v2',
      // Capacitor Preferences als Storage-Backend
      storage: {
        getItem: async (name) => {
          try {
            const { Preferences } = await import('@capacitor/preferences');
            const { value } = await Preferences.get({ key: name });
            return value ? JSON.parse(value) : null;
          } catch {
            const raw = localStorage.getItem(name);
            return raw ? JSON.parse(raw) : null;
          }
        },
        setItem: async (name, value) => {
          try {
            const { Preferences } = await import('@capacitor/preferences');
            await Preferences.set({ key: name, value: JSON.stringify(value) });
          } catch {
            localStorage.setItem(name, JSON.stringify(value));
          }
        },
        removeItem: async (name) => {
          try {
            const { Preferences } = await import('@capacitor/preferences');
            await Preferences.remove({ key: name });
          } catch {
            localStorage.removeItem(name);
          }
        },
      },
    },
  ),
);

// ----------------------------------------------------------------
// Screen-Typen
// ----------------------------------------------------------------

type Screen =
  | 'home'
  | 'campaign'
  | 'game-ai'
  | 'game-p2p'
  | 'p2p-matchmaking'
  | 'leaderboard'
  | 'shop'
  | 'stats';

// ----------------------------------------------------------------
// App-Komponente
// ----------------------------------------------------------------

export default function App() {
  const appState = useAppStore();
  const [screen, setScreen] = useState<Screen>('home');
  const [pendingP2PMove, setPendingP2PMove] = useState<GameMovePayload | null>(null);
  const haptic = useHapticFeedback();

  // Leaderboard
  const leaderboard = useLeaderboard(appState.playerId, appState.deviceId);

  // P2P-Multiplayer
  const [p2pState, p2pActions] = useP2PMultiplayer({
    playerId: appState.playerId,
    playerName: appState.playerName,
    deviceId: appState.deviceId,
    localScores: leaderboard.getRawScores(),
    onMoveReceived: (move) => {
      setPendingP2PMove(move);
    },
    onLeaderboardSynced: async (merged) => {
      await leaderboard.mergeRemoteScores(merged);
      haptic.trigger('success');
    },
    onPeerConnected: (peer) => {
      haptic.notify('success');
    },
    onPeerDisconnected: () => {
      haptic.notify('warning');
      if (screen === 'game-p2p') setScreen('p2p-matchmaking');
    },
    onError: (err) => {
      console.error('[P2P Error]', err.message);
    },
  });

  // Game-Engine (AI-Modus)
  const gameEngine = useGameEngine({
    ownedSkills: appState.ownedSkills,
    gameMode: screen === 'game-p2p' ? 'p2p' : 'quick',
    pendingP2PMove: screen === 'game-p2p' ? pendingP2PMove : null,
    p2pPlayerSide: p2pState.role === 'host' ? 'X' : p2pState.role === 'guest' ? 'O' : null,
    onGameEnd: (result, state) => {
      // Haptic-Feedback
      if (result === 'X') haptic.trigger('win');
      else if (result === 'O') haptic.trigger('lose');
      else haptic.trigger('draw');

      // App-State aktualisieren
      if (result === 'X') appState.addWin();
      else if (result === 'O') appState.addLoss();
      else appState.addDraw();

      // Leaderboard aktualisieren
      leaderboard.updateLocalScore(appState);
    },
  });

  // Hintergrund-Matchmaking starten wenn App geöffnet wird
  useEffect(() => {
    // Passives Advertising im Hintergrund (findet Peers automatisch)
    // Nur starten wenn nicht bereits verbunden
    if (p2pState.connectionState === 'idle') {
      p2pActions.startMatchmaking();
    }
    return () => {
      p2pActions.stopMatchmaking();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const navigate = useCallback((s: Screen) => {
    haptic.impact('light');
    setScreen(s);
  }, [haptic]);

  // ---- Render ----
  if (screen === 'leaderboard') {
    return (
      <LeaderboardScreen
        entries={leaderboard.entries}
        rawScores={leaderboard.getRawScores()}
        localPlayerId={appState.playerId}
        p2pState={p2pState}
        isSyncing={leaderboard.isSyncing}
        lastSyncTime={leaderboard.lastSyncTime}
        onStartSync={() => {
          if (p2pState.connectedPeer) {
            p2pActions.syncLeaderboard(leaderboard.getRawScores());
          } else {
            p2pActions.startMatchmaking();
          }
        }}
        onBack={() => navigate('home')}
      />
    );
  }

  if (screen === 'p2p-matchmaking') {
    return (
      <P2PMatchmakingScreen
        p2pState={p2pState}
        p2pActions={p2pActions}
        onBack={() => navigate('home')}
        onGameStart={() => {
          gameEngine.startGame(0); // P2P: kein KI-Level relevant
          navigate('game-p2p');
        }}
      />
    );
  }

  // Home-Screen (vereinfacht — vollständige Implementierung folgt dem gleichen Muster)
  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: '#0a0a0f',
        color: '#e8e8f0',
        fontFamily: "'Segoe UI', system-ui, sans-serif",
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 32,
        padding: 40,
      }}
    >
      <div>
        <div
          style={{
            fontSize: 52,
            fontWeight: 800,
            letterSpacing: 4,
            textAlign: 'center',
          }}
        >
          <span style={{ color: '#8b85ff' }}>X</span>{' '}
          <span style={{ color: '#606070', fontSize: 36 }}>vs</span>{' '}
          <span style={{ color: '#f0c040' }}>O</span>
        </div>
        <div
          style={{
            fontSize: 14,
            color: '#606070',
            letterSpacing: 3,
            textTransform: 'uppercase',
            textAlign: 'center',
            marginTop: 8,
          }}
        >
          Tactical Nexus
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          width: 260,
        }}
      >
        <button
          onClick={() => { gameEngine.startGame(2); navigate('game-ai'); }}
          style={btnPrimary}
        >
          Schnellspiel
        </button>
        <button onClick={() => navigate('p2p-matchmaking')} style={btnSecondary}>
          P2P Multiplayer{' '}
          {p2pState.connectionState === 'connected' && (
            <span style={{ color: '#40c080', fontSize: 11 }}>● Verbunden</span>
          )}
        </button>
        <button onClick={() => navigate('leaderboard')} style={btnSecondary}>
          Rangliste{' '}
          {leaderboard.localRank > 0 && (
            <span style={{ color: '#f0c040', fontSize: 11 }}>
              #{leaderboard.localRank}
            </span>
          )}
        </button>
      </div>

      <div style={{ fontSize: 12, color: '#606070', textAlign: 'center' }}>
        {appState.totalWins}W · {appState.totalLosses}L · {appState.totalDraws}D
      </div>
    </div>
  );
}

const btnPrimary: React.CSSProperties = {
  padding: '14px 32px',
  background: '#6c63ff',
  borderRadius: 10,
  fontSize: 15,
  fontWeight: 600,
  color: '#fff',
  border: 'none',
  cursor: 'pointer',
  letterSpacing: 0.5,
};

const btnSecondary: React.CSSProperties = {
  padding: '14px 32px',
  border: '1px solid #3a3a4a',
  borderRadius: 10,
  fontSize: 15,
  color: '#9090a0',
  background: 'none',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
};
