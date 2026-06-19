/**
 * useP2PMultiplayer — Zentraler P2P-Multiplayer Hook
 *
 * Kapselt die gesamte P2P-Logik:
 *   - Automatisches Matchmaking (Advertising + Scanning im Hintergrund)
 *   - Verbindungsaufbau und Handshake
 *   - Echtzeit-Spielzug-Synchronisation
 *   - Leaderboard-Sync beim Verbindungsaufbau
 *   - Reconnect-Logik bei Verbindungsabbruch
 *   - Heartbeat-Monitoring (5s Intervall)
 *
 * Architektur:
 *   Host (X) ←→ Guest (O)
 *   - Host: Startet Advertising, wartet auf Verbindung
 *   - Guest: Scannt, verbindet sich mit erstem gefundenen Host
 *   - Nach Handshake: Beide Seiten sind gleichwertig (Peer-to-Peer)
 *
 * Transport-Auswahl (automatisch):
 *   1. Wi-Fi Direct (niedrige Latenz, ~5ms)
 *   2. BLE (universell, ~50ms)
 */

import {
  useState,
  useEffect,
  useCallback,
  useRef,
  startTransition,
} from 'react';
import type {
  P2PPeer,
  P2PConnectionState,
  P2PRole,
  P2PMessage,
  P2PTransport,
  GameMovePayload,
  HandshakePayload,
  LeaderboardSyncPayload,
  BoardState,
  SkillId,
  GameScore,
} from '../types';
import { P2PTransportManager } from '../utils/p2pTransport';
import { hashBoard, generateUUID } from '../utils/checksum';
import { mergeLeaderboards } from '../engine/leaderboardMerge';

// ----------------------------------------------------------------
// Hook-Interface
// ----------------------------------------------------------------

export interface P2PMultiplayerState {
  connectionState: P2PConnectionState;
  connectedPeer: P2PPeer | null;
  availablePeers: P2PPeer[];
  role: P2PRole;
  transport: P2PTransport;
  latency: number;           // Gemessene RTT in ms
  isMyTurn: boolean;
  syncStatus: 'idle' | 'syncing' | 'synced' | 'error';
}

export interface P2PMultiplayerActions {
  /** Startet Matchmaking (Advertising + Scanning gleichzeitig) */
  startMatchmaking: () => Promise<void>;
  /** Stoppt Matchmaking */
  stopMatchmaking: () => void;
  /** Verbindet mit einem spezifischen Peer */
  connectToPeer: (peer: P2PPeer) => Promise<void>;
  /** Trennt die Verbindung */
  disconnect: () => void;
  /** Sendet einen Spielzug an den Peer */
  sendMove: (cellIndex: number, board: BoardState, skillUsed?: SkillId) => Promise<void>;
  /** Initiiert Leaderboard-Sync */
  syncLeaderboard: (localScores: GameScore[]) => Promise<void>;
}

export interface UseP2PMultiplayerOptions {
  playerId: string;
  playerName: string;
  deviceId: string;
  appVersion?: string;
  onMoveReceived?: (move: GameMovePayload) => void;
  onLeaderboardSynced?: (merged: GameScore[]) => void;
  onPeerConnected?: (peer: P2PPeer) => void;
  onPeerDisconnected?: (peerId: string) => void;
  onError?: (error: Error) => void;
  localScores?: GameScore[];
}

// ----------------------------------------------------------------
// Hook-Implementierung
// ----------------------------------------------------------------

export function useP2PMultiplayer(
  options: UseP2PMultiplayerOptions,
): [P2PMultiplayerState, P2PMultiplayerActions] {
  const {
    playerId,
    playerName,
    deviceId,
    appVersion = '1.0.0',
    onMoveReceived,
    onLeaderboardSynced,
    onPeerConnected,
    onPeerDisconnected,
    onError,
    localScores = [],
  } = options;

  // ---- State ----
  const [connectionState, setConnectionState] = useState<P2PConnectionState>('idle');
  const [connectedPeer, setConnectedPeer] = useState<P2PPeer | null>(null);
  const [availablePeers, setAvailablePeers] = useState<P2PPeer[]>([]);
  const [role, setRole] = useState<P2PRole>('none');
  const [transport, setTransport] = useState<P2PTransport>('none');
  const [latency, setLatency] = useState(0);
  const [isMyTurn, setIsMyTurn] = useState(false);
  const [syncStatus, setSyncStatus] = useState<P2PMultiplayerState['syncStatus']>('idle');

  // ---- Refs (nicht reaktiv, kein Re-Render) ----
  const managerRef = useRef<P2PTransportManager | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const heartbeatSentRef = useRef<number>(0);
  const moveCounterRef = useRef(0);
  const isMatchmakingRef = useRef(false);
  const pendingPeersRef = useRef<Map<string, P2PPeer>>(new Map());

  // ---- Transport-Manager initialisieren ----
  useEffect(() => {
    managerRef.current = new P2PTransportManager();

    managerRef.current.onMessage((peerId, msg) => {
      handleIncomingMessage(peerId, msg);
    });

    managerRef.current.onDisconnect((peerId) => {
      handlePeerDisconnected(peerId);
    });

    return () => {
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Nachrichtenverarbeitung ----
  const handleIncomingMessage = useCallback(
    (peerId: string, msg: P2PMessage) => {
      switch (msg.type) {
        case 'HANDSHAKE':
          handleHandshake(peerId, msg as P2PMessage<HandshakePayload>);
          break;

        case 'HANDSHAKE_ACK':
          handleHandshakeAck(peerId, msg as P2PMessage<HandshakePayload>);
          break;

        case 'GAME_MOVE':
          handleGameMove(msg as P2PMessage<GameMovePayload>);
          break;

        case 'LEADERBOARD_SYNC_REQUEST':
          handleLeaderboardSyncRequest(
            peerId,
            msg as P2PMessage<LeaderboardSyncPayload>,
          );
          break;

        case 'LEADERBOARD_SYNC_RESPONSE':
          handleLeaderboardSyncResponse(
            msg as P2PMessage<LeaderboardSyncPayload>,
          );
          break;

        case 'HEARTBEAT':
          handleHeartbeat(msg);
          break;

        case 'DISCONNECT':
          handlePeerDisconnected(peerId);
          break;

        default:
          console.warn('[P2P] Unknown message type:', msg.type);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [localScores],
  );

  // ---- Handshake ----
  const handleHandshake = useCallback(
    async (peerId: string, msg: P2PMessage<HandshakePayload>) => {
      const peer = pendingPeersRef.current.get(peerId) ?? {
        id: peerId,
        name: msg.payload.playerName,
        deviceId: msg.payload.deviceId,
        transport: managerRef.current?.active?.type ?? 'ble',
        connectedAt: Date.now(),
      };

      setConnectedPeer(peer);
      setRole('host');
      setIsMyTurn(true); // Host spielt X, beginnt

      startTransition(() => {
        setConnectionState('connected');
      });

      // ACK senden
      await managerRef.current?.sendMessage<HandshakePayload>(peerId, {
        type: 'HANDSHAKE_ACK',
        senderId: playerId,
        senderName: playerName,
        timestamp: Date.now(),
        payload: {
          playerId,
          playerName,
          deviceId,
          appVersion,
          capabilities: ['p2p-game', 'leaderboard-sync'],
        },
      });

      onPeerConnected?.(peer);
      startHeartbeat(peerId);

      // Sofortiger Leaderboard-Sync nach Verbindung
      await initLeaderboardSync(peerId);
    },
    [playerId, playerName, deviceId, appVersion, onPeerConnected, localScores],
  );

  const handleHandshakeAck = useCallback(
    (peerId: string, msg: P2PMessage<HandshakePayload>) => {
      const peer = pendingPeersRef.current.get(peerId) ?? {
        id: peerId,
        name: msg.payload.playerName,
        deviceId: msg.payload.deviceId,
        transport: managerRef.current?.active?.type ?? 'ble',
        connectedAt: Date.now(),
      };

      setConnectedPeer(peer);
      setRole('guest');
      setIsMyTurn(false); // Guest spielt O, wartet

      startTransition(() => {
        setConnectionState('connected');
      });

      onPeerConnected?.(peer);
      startHeartbeat(peerId);
    },
    [onPeerConnected],
  );

  // ---- Spielzug-Handling ----
  const handleGameMove = useCallback(
    (msg: P2PMessage<GameMovePayload>) => {
      setIsMyTurn(true);
      onMoveReceived?.(msg.payload);
    },
    [onMoveReceived],
  );

  // ---- Leaderboard-Sync ----
  const initLeaderboardSync = useCallback(
    async (peerId: string) => {
      setSyncStatus('syncing');
      await managerRef.current?.sendMessage<LeaderboardSyncPayload>(peerId, {
        type: 'LEADERBOARD_SYNC_REQUEST',
        senderId: playerId,
        senderName: playerName,
        timestamp: Date.now(),
        payload: {
          entries: localScores,
          vectorClock: {},
        },
      });
    },
    [playerId, playerName, localScores],
  );

  const handleLeaderboardSyncRequest = useCallback(
    async (peerId: string, msg: P2PMessage<LeaderboardSyncPayload>) => {
      // Merge empfangene Einträge mit lokalen
      const result = mergeLeaderboards(localScores, msg.payload.entries, deviceId);

      setSyncStatus('synced');
      onLeaderboardSynced?.(result.merged);

      // Response mit gemergten Daten senden
      await managerRef.current?.sendMessage<LeaderboardSyncPayload>(peerId, {
        type: 'LEADERBOARD_SYNC_RESPONSE',
        senderId: playerId,
        senderName: playerName,
        timestamp: Date.now(),
        payload: {
          entries: result.merged,
          vectorClock: {},
        },
      });
    },
    [localScores, deviceId, playerId, playerName, onLeaderboardSynced],
  );

  const handleLeaderboardSyncResponse = useCallback(
    (msg: P2PMessage<LeaderboardSyncPayload>) => {
      const result = mergeLeaderboards(localScores, msg.payload.entries, deviceId);
      setSyncStatus('synced');
      onLeaderboardSynced?.(result.merged);
    },
    [localScores, deviceId, onLeaderboardSynced],
  );

  // ---- Heartbeat ----
  const startHeartbeat = useCallback((peerId: string) => {
    if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    heartbeatRef.current = setInterval(async () => {
      heartbeatSentRef.current = Date.now();
      await managerRef.current
        ?.sendMessage(peerId, {
          type: 'HEARTBEAT',
          senderId: playerId,
          senderName: playerName,
          timestamp: heartbeatSentRef.current,
          payload: { ping: heartbeatSentRef.current },
        })
        .catch(() => {
          // Heartbeat fehlgeschlagen → Verbindung unterbrochen
          handlePeerDisconnected(peerId);
        });
    }, 5000);
  }, [playerId, playerName]);

  const handleHeartbeat = useCallback((msg: P2PMessage) => {
    const rtt = Date.now() - (msg.payload as { ping: number }).ping;
    setLatency(rtt);
  }, []);

  // ---- Disconnect ----
  const handlePeerDisconnected = useCallback(
    (peerId: string) => {
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }
      setConnectedPeer(null);
      setRole('none');
      setIsMyTurn(false);
      setConnectionState('disconnected');
      onPeerDisconnected?.(peerId);
    },
    [onPeerDisconnected],
  );

  // ---- Cleanup ----
  const cleanup = useCallback(() => {
    if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    managerRef.current?.destroy();
    isMatchmakingRef.current = false;
  }, []);

  // ---- Öffentliche Aktionen ----

  const startMatchmaking = useCallback(async () => {
    if (isMatchmakingRef.current) return;
    isMatchmakingRef.current = true;

    startTransition(() => setConnectionState('advertising'));

    const manager = managerRef.current;
    if (!manager) return;

    try {
      const adapter = await manager.selectBestTransport();
      if (!adapter) {
        setConnectionState('error');
        onError?.(new Error('Kein P2P-Transport verfügbar. Bitte Bluetooth/WLAN aktivieren.'));
        return;
      }

      setTransport(adapter.type);

      // Gleichzeitig Advertising und Scanning starten
      await Promise.all([
        adapter.startAdvertising(deviceId, playerName),
        adapter.startScanning((peer) => {
          pendingPeersRef.current.set(peer.id, peer);
          setAvailablePeers((prev) => {
            const exists = prev.some((p) => p.id === peer.id);
            return exists ? prev : [...prev, peer];
          });
          startTransition(() => setConnectionState('scanning'));
        }),
      ]);
    } catch (err) {
      setConnectionState('error');
      onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  }, [deviceId, playerName, onError]);

  const stopMatchmaking = useCallback(() => {
    isMatchmakingRef.current = false;
    managerRef.current?.active?.stopAdvertising();
    managerRef.current?.active?.stopScanning();
    setConnectionState('idle');
    setAvailablePeers([]);
  }, []);

  const connectToPeer = useCallback(
    async (peer: P2PPeer) => {
      const manager = managerRef.current;
      if (!manager?.active) return;

      startTransition(() => setConnectionState('connecting'));
      pendingPeersRef.current.set(peer.id, peer);

      try {
        await manager.active.connect(peer.id);

        // Handshake initiieren
        await manager.sendMessage<HandshakePayload>(peer.id, {
          type: 'HANDSHAKE',
          senderId: playerId,
          senderName: playerName,
          timestamp: Date.now(),
          payload: {
            playerId,
            playerName,
            deviceId,
            appVersion,
            capabilities: ['p2p-game', 'leaderboard-sync'],
          },
        });
      } catch (err) {
        setConnectionState('error');
        onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    },
    [playerId, playerName, deviceId, appVersion, onError],
  );

  const disconnect = useCallback(() => {
    const peer = connectedPeer;
    if (!peer || !managerRef.current?.active) return;

    managerRef.current
      .sendMessage(peer.id, {
        type: 'DISCONNECT',
        senderId: playerId,
        senderName: playerName,
        timestamp: Date.now(),
        payload: {},
      })
      .finally(() => {
        managerRef.current?.active?.disconnect(peer.id);
        handlePeerDisconnected(peer.id);
      });
  }, [connectedPeer, playerId, playerName, handlePeerDisconnected]);

  const sendMove = useCallback(
    async (cellIndex: number, board: BoardState, skillUsed?: SkillId) => {
      const peer = connectedPeer;
      if (!peer || !managerRef.current) return;

      moveCounterRef.current++;
      setIsMyTurn(false);

      await managerRef.current.sendMessage<GameMovePayload>(peer.id, {
        type: 'GAME_MOVE',
        senderId: playerId,
        senderName: playerName,
        timestamp: Date.now(),
        payload: {
          cellIndex,
          player: role === 'host' ? 'X' : 'O',
          skillUsed,
          moveNumber: moveCounterRef.current,
          boardHash: hashBoard(board),
        },
      });
    },
    [connectedPeer, playerId, playerName, role],
  );

  const syncLeaderboard = useCallback(
    async (scores: GameScore[]) => {
      const peer = connectedPeer;
      if (!peer || !managerRef.current) return;
      setSyncStatus('syncing');
      await initLeaderboardSync(peer.id);
    },
    [connectedPeer, initLeaderboardSync],
  );

  // ---- Return ----
  const state: P2PMultiplayerState = {
    connectionState,
    connectedPeer,
    availablePeers,
    role,
    transport,
    latency,
    isMyTurn,
    syncStatus,
  };

  const actions: P2PMultiplayerActions = {
    startMatchmaking,
    stopMatchmaking,
    connectToPeer,
    disconnect,
    sendMove,
    syncLeaderboard,
  };

  return [state, actions];
}
