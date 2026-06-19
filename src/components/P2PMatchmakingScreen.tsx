/**
 * P2PMatchmakingScreen — Offline-Multiplayer Lobby
 *
 * Zeigt:
 *   - Aktuellen Verbindungsstatus mit animiertem Radar
 *   - Liste gefundener Peers mit Signal-Stärke (BLE RSSI)
 *   - Transport-Typ-Indikator (BLE / Wi-Fi Direct)
 *   - Verbindungsaufbau-Feedback
 *   - Leaderboard-Sync-Status nach Verbindung
 */

import React, { useEffect, useRef, memo } from 'react';
import type { P2PPeer, P2PMultiplayerState } from '../types';

export interface P2PMultiplayerActions {
  startMatchmaking: () => Promise<void>;
  stopMatchmaking: () => void;
  connectToPeer: (peer: P2PPeer) => Promise<void>;
  disconnect: () => void;
  sendMove: (cellIndex: number, board: any[], skillUsed?: any) => Promise<void>;
  syncLeaderboard: (localScores: any[]) => Promise<void>;
}

const TOKEN = {
  bg: '#0a0a0f', bg2: '#111118', bg3: '#1a1a24', bg4: '#22222e',
  border: '#2a2a38', border2: '#3a3a4a',
  text: '#e8e8f0', text2: '#9090a0', text3: '#606070',
  accent: '#6c63ff', accent2: '#8b85ff',
  gold: '#f0c040', green: '#40c080', red: '#e05050',
} as const;

// ----------------------------------------------------------------
// Radar-Animation (Canvas)
// ----------------------------------------------------------------

const RadarCanvas = memo(function RadarCanvas({
  isActive,
  peersFound,
}: {
  isActive: boolean;
  peersFound: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const angleRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const SIZE = 160;
    canvas.width = SIZE;
    canvas.height = SIZE;
    const cx = SIZE / 2;
    const cy = SIZE / 2;
    const R = SIZE / 2 - 10;

    function draw() {
      ctx?.clearRect(0, 0, SIZE, SIZE);

      // Hintergrund-Kreise
      for (let r = R / 3; r <= R; r += R / 3) {
        ctx?.beginPath();
        ctx?.arc(cx, cy, r, 0, Math.PI * 2);
        if(ctx) ctx.strokeStyle = 'rgba(108,99,255,.15)';
        if(ctx) ctx.lineWidth = 1;
        ctx?.stroke();
      }

      // Kreuz-Linien
      if(ctx) ctx.strokeStyle = 'rgba(108,99,255,.1)';
      if(ctx) ctx.lineWidth = 1;
      ctx?.beginPath(); ctx?.moveTo(cx, cy - R); ctx?.lineTo(cx, cy + R); ctx?.stroke();
      ctx?.beginPath(); ctx?.moveTo(cx - R, cy); ctx?.lineTo(cx + R, cy); ctx?.stroke();

      if (isActive) {
        // Sweep-Linie
        const sweepAngle = angleRef.current;
        const gradient = null;

        // Sweep-Fächer (manuell)
        const SWEEP = Math.PI / 3;
        for (let i = 0; i < 20; i++) {
          const a = sweepAngle - (i / 20) * SWEEP;
          const alpha = (1 - i / 20) * 0.4;
          ctx?.beginPath();
          ctx?.moveTo(cx, cy);
          ctx?.arc(cx, cy, R, a, a + SWEEP / 20);
          ctx?.closePath();
          if(ctx) ctx.fillStyle = `rgba(108,99,255,${alpha})`;
          ctx?.fill();
        }

        // Sweep-Linie (hell)
        ctx?.beginPath();
        ctx?.moveTo(cx, cy);
        ctx?.lineTo(
          cx + Math.cos(sweepAngle) * R,
          cy + Math.sin(sweepAngle) * R,
        );
        if(ctx) ctx.strokeStyle = 'rgba(139,133,255,.9)';
        if(ctx) ctx.lineWidth = 2;
        ctx?.stroke();

        angleRef.current += 0.04;
      }

      // Peer-Blips
      for (let i = 0; i < peersFound; i++) {
        const blipAngle = (i / Math.max(peersFound, 1)) * Math.PI * 2;
        const blipR = R * 0.5 + (i % 3) * (R * 0.15);
        const bx = cx + Math.cos(blipAngle) * blipR;
        const by = cy + Math.sin(blipAngle) * blipR;
        ctx?.beginPath();
        ctx?.arc(bx, by, 4, 0, Math.PI * 2);
        if(ctx) ctx.fillStyle = TOKEN.green;
        ctx?.fill();
        // Ping-Effekt
        ctx?.beginPath();
        ctx?.arc(bx, by, 8, 0, Math.PI * 2);
        if(ctx) ctx.strokeStyle = 'rgba(64,192,128,.4)';
        if(ctx) ctx.lineWidth = 1;
        ctx?.stroke();
      }

      // Zentrum
      ctx?.beginPath();
      ctx?.arc(cx, cy, 4, 0, Math.PI * 2);
      if(ctx) ctx.fillStyle = TOKEN.accent2;
      ctx?.fill();

      animRef.current = requestAnimationFrame(draw);
    }

    draw();
    return () => cancelAnimationFrame(animRef.current);
  }, [isActive, peersFound]);

  return (
    <canvas
      ref={canvasRef}
      style={{ borderRadius: '50%', display: 'block' }}
    />
  );
});

// ----------------------------------------------------------------
// Signal-Stärke-Indikator
// ----------------------------------------------------------------

function SignalBars({ rssi }: { rssi?: number }) {
  // RSSI: -40 (stark) bis -90 (schwach)
  const strength = rssi == null ? 3 : rssi > -55 ? 4 : rssi > -65 ? 3 : rssi > -75 ? 2 : 1;
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 16 }}>
      {[1, 2, 3, 4].map((bar) => (
        <div
          key={bar}
          style={{
            width: 3,
            height: 4 + bar * 3,
            borderRadius: 1,
            background: bar <= strength ? TOKEN.green : TOKEN.border2,
          }}
        />
      ))}
    </div>
  );
}

// ----------------------------------------------------------------
// Peer-Karte
// ----------------------------------------------------------------

const PeerCard = memo(function PeerCard({
  peer,
  onConnect,
  isConnecting,
}: {
  peer: P2PPeer;
  onConnect: () => void;
  isConnecting: boolean;
}) {
  const transportLabel = peer.transport === 'ble' ? 'BLE' : 'Wi-Fi Direct';
  const transportColor = peer.transport === 'ble' ? TOKEN.accent2 : TOKEN.green;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '14px 16px',
        background: TOKEN.bg3,
        border: `1px solid ${TOKEN.border}`,
        borderRadius: 12,
        marginBottom: 8,
      }}
    >
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: '50%',
          background: 'rgba(108,99,255,.12)',
          border: `1.5px solid rgba(108,99,255,.3)`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 18,
          flexShrink: 0,
        }}
      >
        📱
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 14,
            fontWeight: 700,
            color: TOKEN.text,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {peer.name}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3 }}>
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              color: transportColor,
              background: `${transportColor}18`,
              border: `1px solid ${transportColor}40`,
              borderRadius: 4,
              padding: '1px 6px',
            }}
          >
            {transportLabel}
          </span>
          <SignalBars rssi={peer.rssi} />
        </div>
      </div>

      <button
        onClick={onConnect}
        disabled={isConnecting}
        style={{
          padding: '8px 16px',
          background: isConnecting ? 'rgba(108,99,255,.3)' : TOKEN.accent,
          border: 'none',
          borderRadius: 8,
          color: '#fff',
          fontSize: 13,
          fontWeight: 600,
          cursor: isConnecting ? 'not-allowed' : 'pointer',
          flexShrink: 0,
          transition: 'background .2s',
        }}
      >
        {isConnecting ? '...' : 'Verbinden'}
      </button>
    </div>
  );
});

// ----------------------------------------------------------------
// Haupt-Komponente
// ----------------------------------------------------------------

export interface P2PMatchmakingScreenProps {
  p2pState: P2PMultiplayerState;
  p2pActions: P2PMultiplayerActions;
  onBack: () => void;
  onGameStart: () => void;
}

export const P2PMatchmakingScreen = memo(function P2PMatchmakingScreen({
  p2pState,
  p2pActions,
  onBack,
  onGameStart,
}: P2PMatchmakingScreenProps) {
  const { connectionState, connectedPeer, availablePeers, transport, syncStatus } = p2pState;
  const isSearching = connectionState === 'advertising' || connectionState === 'scanning';
  const isConnected = connectionState === 'connected';
  const isConnecting = connectionState === 'connecting';

  // Automatisch zum Spiel navigieren nach erfolgreicher Verbindung + Sync
  useEffect(() => {
    if (isConnected && syncStatus === 'synced') {
      const timer = setTimeout(onGameStart, 1500);
      return () => clearTimeout(timer);
    }
  }, [isConnected, syncStatus, onGameStart]);

  const statusMessages: Record<string, string> = {
    idle: 'Bereit zum Suchen',
    advertising: 'Sende Signal aus...',
    scanning: 'Suche Spieler in der Nähe...',
    connecting: 'Verbinde...',
    connected: 'Verbunden!',
    syncing: 'Synchronisiere Daten...',
    disconnected: 'Verbindung getrennt',
    error: 'Verbindungsfehler',
  };

  return (
    <div
      style={{
        flex: 1,
        backgroundColor: TOKEN.bg,
        display: 'flex',
        flexDirection: 'column',
        minHeight: '100vh',
        fontFamily: "'Segoe UI', system-ui, sans-serif",
        color: TOKEN.text,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 24px',
          borderBottom: `1px solid ${TOKEN.border}`,
          background: TOKEN.bg2,
        }}
      >
        <button
          onClick={onBack}
          style={{
            background: 'none',
            border: `1px solid ${TOKEN.border2}`,
            borderRadius: 8,
            padding: '8px 16px',
            color: TOKEN.text2,
            fontSize: 13,
            cursor: 'pointer',
          }}
        >
          ← Zurück
        </button>
        <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: 2, color: TOKEN.accent2 }}>
          P2P MULTIPLAYER
        </div>
        <div style={{ width: 80 }} />
      </div>

      {/* Radar-Bereich */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: '40px 24px 24px',
          gap: 16,
        }}
      >
        <RadarCanvas isActive={isSearching || isConnected} peersFound={availablePeers.length} />

        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: TOKEN.text, marginBottom: 4 }}>
            {isConnected && connectedPeer
              ? `Verbunden mit ${connectedPeer.name}`
              : statusMessages[connectionState] ?? connectionState}
          </div>
          {isConnected && (
            <div style={{ fontSize: 12, color: TOKEN.text3 }}>
              Transport: {transport === 'ble' ? 'Bluetooth LE' : 'Wi-Fi Direct'} ·{' '}
              {p2pState.latency}ms
            </div>
          )}
          {syncStatus === 'syncing' && (
            <div style={{ fontSize: 12, color: TOKEN.accent2, marginTop: 4 }}>
              ⟳ Rangliste wird synchronisiert...
            </div>
          )}
          {syncStatus === 'synced' && (
            <div style={{ fontSize: 12, color: TOKEN.green, marginTop: 4 }}>
              ✓ Rangliste synchronisiert
            </div>
          )}
        </div>

        {/* Aktions-Buttons */}
        {!isSearching && !isConnected && (
          <button
            onClick={p2pActions.startMatchmaking}
            style={{
              padding: '14px 40px',
              background: TOKEN.accent,
              border: 'none',
              borderRadius: 12,
              color: '#fff',
              fontSize: 15,
              fontWeight: 600,
              cursor: 'pointer',
              marginTop: 8,
            }}
          >
            Spieler suchen
          </button>
        )}

        {isSearching && (
          <button
            onClick={p2pActions.stopMatchmaking}
            style={{
              padding: '12px 32px',
              background: 'none',
              border: `1px solid ${TOKEN.border2}`,
              borderRadius: 10,
              color: TOKEN.text2,
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            Abbrechen
          </button>
        )}

        {isConnected && (
          <button
            onClick={p2pActions.disconnect}
            style={{
              padding: '10px 24px',
              background: 'none',
              border: `1px solid rgba(224,80,80,.3)`,
              borderRadius: 8,
              color: TOKEN.red,
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            Trennen
          </button>
        )}
      </div>

      {/* Peer-Liste */}
      {availablePeers.length > 0 && !isConnected && (
        <div style={{ padding: '0 16px', flex: 1 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: 2,
              color: TOKEN.text3,
              textTransform: 'uppercase',
              marginBottom: 12,
            }}
          >
            Gefundene Spieler ({availablePeers.length})
          </div>
          {availablePeers.map((peer) => (
            <PeerCard
              key={peer.id}
              peer={peer}
              isConnecting={isConnecting}
              onConnect={() => p2pActions.connectToPeer(peer)}
            />
          ))}
        </div>
      )}

      {/* Hinweis */}
      {!isSearching && !isConnected && availablePeers.length === 0 && (
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '0 32px',
            gap: 12,
            color: TOKEN.text3,
            fontSize: 13,
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: 36 }}>📡</div>
          <div>
            Beide Spieler müssen die App geöffnet haben und sich in Reichweite
            befinden (BLE: ~10m, Wi-Fi Direct: ~200m).
          </div>
          <div style={{ fontSize: 11, color: TOKEN.text3, marginTop: 4 }}>
            Kein Internet erforderlich — 100% offline.
          </div>
        </div>
      )}

      <style>{`
        @keyframes radarPulse {
          0% { transform: scale(1); opacity: 1; }
          100% { transform: scale(2); opacity: 0; }
        }
      `}</style>
    </div>
  );
});
