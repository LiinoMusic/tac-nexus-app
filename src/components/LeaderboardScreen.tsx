/**
 * LeaderboardScreen — Premium Dark Luxury UI
 *
 * Features:
 *   - Animiertes Podium für Top-3 (Gold/Silber/Bronze)
 *   - Scrollbare Rangliste mit Rang-Badges
 *   - Echtzeit P2P-Sync-Indikator mit Latenz-Anzeige
 *   - Score-Breakdown-Modal (Tap auf Eintrag)
 *   - Neue Einträge nach Merge werden hervorgehoben
 *   - 120Hz-optimierte Animationen (CSS will-change + transform)
 */

import React, { useState, useCallback, memo } from 'react';
import type { LeaderboardEntry, GameScore, P2PMultiplayerState } from '../types';
import { formatScore, getRankTitle, calculateScore } from '../engine/scoringEngine';

// ----------------------------------------------------------------
// Design-Token (spiegelt das bestehende CSS-System wider)
// ----------------------------------------------------------------

const TOKEN = {
  bg:      '#0a0a0f',
  bg2:     '#111118',
  bg3:     '#1a1a24',
  bg4:     '#22222e',
  border:  '#2a2a38',
  border2: '#3a3a4a',
  text:    '#e8e8f0',
  text2:   '#9090a0',
  text3:   '#606070',
  accent:  '#6c63ff',
  accent2: '#8b85ff',
  gold:    '#f0c040',
  gold2:   '#c8a030',
  green:   '#40c080',
  red:     '#e05050',
  blue:    '#4080e0',
} as const;

// ----------------------------------------------------------------
// Inline-Styles (kein Tailwind-Dependency für diese Datei)
// ----------------------------------------------------------------

const styles = {
  container: {
    flex: 1,
    backgroundColor: TOKEN.bg,
    display: 'flex' as const,
    flexDirection: 'column' as const,
    minHeight: '100vh',
    fontFamily: "'Segoe UI', system-ui, sans-serif",
    color: TOKEN.text,
  },
  header: {
    display: 'flex' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    padding: '16px 24px',
    borderBottom: `1px solid ${TOKEN.border}`,
    background: TOKEN.bg2,
    position: 'sticky' as const,
    top: 0,
    zIndex: 10,
  },
  title: {
    fontSize: 18,
    fontWeight: 700,
    letterSpacing: 2,
    color: TOKEN.accent2,
  },
  syncBadge: (state: P2PMultiplayerState['connectionState']) => ({
    display: 'flex' as const,
    alignItems: 'center' as const,
    gap: 6,
    padding: '4px 12px',
    borderRadius: 20,
    fontSize: 11,
    fontWeight: 600,
    background:
      state === 'connected'
        ? 'rgba(64,192,128,.12)'
        : state === 'advertising' || state === 'scanning'
        ? 'rgba(108,99,255,.12)'
        : 'rgba(96,96,112,.1)',
    border: `1px solid ${
      state === 'connected'
        ? 'rgba(64,192,128,.3)'
        : state === 'advertising' || state === 'scanning'
        ? 'rgba(108,99,255,.3)'
        : TOKEN.border
    }`,
    color:
      state === 'connected'
        ? TOKEN.green
        : state === 'advertising' || state === 'scanning'
        ? TOKEN.accent2
        : TOKEN.text3,
  }),
  podiumSection: {
    padding: '32px 24px 16px',
    background: `linear-gradient(180deg, ${TOKEN.bg2} 0%, ${TOKEN.bg} 100%)`,
  },
  podiumRow: {
    display: 'flex' as const,
    alignItems: 'flex-end' as const,
    justifyContent: 'center' as const,
    gap: 12,
    marginBottom: 8,
  },
  podiumCard: (rank: 1 | 2 | 3, isLocal: boolean) => {
    const heights = { 1: 120, 2: 90, 3: 75 };
    const colors = {
      1: { bg: 'rgba(240,192,64,.08)', border: 'rgba(240,192,64,.4)', glow: TOKEN.gold },
      2: { bg: 'rgba(192,192,208,.06)', border: 'rgba(192,192,208,.3)', glow: '#c0c0d0' },
      3: { bg: 'rgba(176,112,64,.06)', border: 'rgba(176,112,64,.3)', glow: '#b07040' },
    };
    const c = colors[rank];
    return {
      display: 'flex' as const,
      flexDirection: 'column' as const,
      alignItems: 'center' as const,
      justifyContent: 'flex-end' as const,
      width: rank === 1 ? 110 : 90,
      height: heights[rank],
      background: c.bg,
      border: `1.5px solid ${c.border}`,
      borderRadius: '12px 12px 0 0',
      padding: '10px 8px',
      boxShadow: isLocal ? `0 0 20px ${c.glow}40` : 'none',
      transition: 'box-shadow .3s',
      cursor: 'pointer',
      willChange: 'transform',
    };
  },
  podiumMedal: (rank: 1 | 2 | 3) => {
    const emojis = { 1: '🥇', 2: '🥈', 3: '🥉' };
    return { fontSize: rank === 1 ? 28 : 22, marginBottom: 4 };
  },
  podiumName: {
    fontSize: 11,
    fontWeight: 700,
    color: TOKEN.text2,
    textAlign: 'center' as const,
    maxWidth: 80,
    overflow: 'hidden' as const,
    textOverflow: 'ellipsis' as const,
    whiteSpace: 'nowrap' as const,
  },
  podiumScore: (rank: 1 | 2 | 3) => ({
    fontSize: rank === 1 ? 14 : 12,
    fontWeight: 800,
    color: rank === 1 ? TOKEN.gold : rank === 2 ? '#c0c0d0' : '#b07040',
    marginTop: 2,
  }),
  listSection: {
    flex: 1,
    padding: '0 16px 24px',
    overflowY: 'auto' as const,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: 2,
    color: TOKEN.text3,
    textTransform: 'uppercase' as const,
    padding: '16px 8px 8px',
  },
  entryRow: (isLocal: boolean, isNew: boolean) => ({
    display: 'flex' as const,
    alignItems: 'center' as const,
    gap: 12,
    padding: '12px 16px',
    borderRadius: 12,
    marginBottom: 6,
    background: isLocal
      ? 'rgba(108,99,255,.08)'
      : isNew
      ? 'rgba(64,192,128,.06)'
      : TOKEN.bg3,
    border: `1px solid ${
      isLocal ? 'rgba(108,99,255,.3)' : isNew ? 'rgba(64,192,128,.25)' : TOKEN.border
    }`,
    cursor: 'pointer',
    transition: 'background .15s, transform .1s',
    willChange: 'transform',
  }),
  rankBadge: (rank: number) => {
    const isTop3 = rank <= 3;
    return {
      width: 32,
      height: 32,
      borderRadius: '50%',
      display: 'flex' as const,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      fontSize: isTop3 ? 16 : 12,
      fontWeight: 700,
      background: isTop3 ? 'transparent' : TOKEN.bg4,
      color: rank === 1 ? TOKEN.gold : rank === 2 ? '#c0c0d0' : rank === 3 ? '#b07040' : TOKEN.text3,
      flexShrink: 0,
    };
  },
  entryInfo: {
    flex: 1,
    minWidth: 0,
  },
  entryName: (isLocal: boolean) => ({
    fontSize: 14,
    fontWeight: 700,
    color: isLocal ? TOKEN.accent2 : TOKEN.text,
    overflow: 'hidden' as const,
    textOverflow: 'ellipsis' as const,
    whiteSpace: 'nowrap' as const,
  }),
  entryMeta: {
    fontSize: 11,
    color: TOKEN.text3,
    marginTop: 2,
  },
  entryScore: {
    textAlign: 'right' as const,
    flexShrink: 0,
  },
  entryScoreVal: {
    fontSize: 16,
    fontWeight: 800,
    color: TOKEN.gold,
  },
  entryGrade: (grade: string) => ({
    fontSize: 10,
    fontWeight: 700,
    color:
      grade === 'S' ? TOKEN.gold :
      grade === 'A' ? TOKEN.green :
      grade === 'B' ? TOKEN.accent2 :
      TOKEN.text3,
    marginTop: 2,
  }),
  newBadge: {
    fontSize: 9,
    fontWeight: 700,
    color: TOKEN.green,
    background: 'rgba(64,192,128,.15)',
    border: `1px solid rgba(64,192,128,.3)`,
    borderRadius: 4,
    padding: '1px 5px',
    marginLeft: 6,
  },
  emptyState: {
    textAlign: 'center' as const,
    padding: '48px 24px',
    color: TOKEN.text3,
    fontSize: 14,
  },
  // Sync-Overlay
  syncOverlay: {
    position: 'fixed' as const,
    bottom: 24,
    left: '50%',
    transform: 'translateX(-50%)',
    background: TOKEN.bg2,
    border: `1px solid rgba(108,99,255,.4)`,
    borderRadius: 12,
    padding: '12px 20px',
    display: 'flex' as const,
    alignItems: 'center' as const,
    gap: 10,
    fontSize: 13,
    color: TOKEN.accent2,
    boxShadow: '0 8px 32px rgba(0,0,0,.5)',
    zIndex: 50,
    animation: 'slideUp .3s ease',
  },
  // Score-Breakdown-Modal
  modal: {
    position: 'fixed' as const,
    inset: 0,
    background: 'rgba(0,0,0,.75)',
    display: 'flex' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    zIndex: 100,
    backdropFilter: 'blur(4px)',
  },
  modalCard: {
    background: TOKEN.bg2,
    border: `1px solid ${TOKEN.border2}`,
    borderRadius: 20,
    padding: '32px',
    maxWidth: 380,
    width: '90%',
  },
  breakdownRow: {
    display: 'flex' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    padding: '8px 0',
    borderBottom: `1px solid ${TOKEN.border}`,
    fontSize: 13,
  },
} as const;

// ----------------------------------------------------------------
// Sub-Komponenten
// ----------------------------------------------------------------

const PodiumCard = memo(function PodiumCard({
  entry,
  rank,
  onClick,
}: {
  entry: LeaderboardEntry;
  rank: 1 | 2 | 3;
  onClick: () => void;
}) {
  const medals = { 1: '🥇', 2: '🥈', 3: '🥉' };
  return (
    <div style={styles.podiumCard(rank, entry.isLocal)} onClick={onClick}>
      <div style={styles.podiumMedal(rank)}>{medals[rank]}</div>
      <div style={styles.podiumName}>{entry.playerName}</div>
      <div style={styles.podiumScore(rank)}>{formatScore(entry.score)}</div>
      {entry.isLocal && (
        <div style={{ fontSize: 9, color: TOKEN.accent2, marginTop: 2 }}>DU</div>
      )}
    </div>
  );
});

const EntryRow = memo(function EntryRow({
  entry,
  onClick,
}: {
  entry: LeaderboardEntry;
  onClick: () => void;
}) {
  const rankEmojis: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' };
  const grade = entry.score >= 50000 ? 'S' : entry.score >= 25000 ? 'A' : entry.score >= 10000 ? 'B' : 'C';

  return (
    <div style={styles.entryRow(entry.isLocal, entry.isNew)} onClick={onClick}>
      <div style={styles.rankBadge(entry.rank)}>
        {entry.rank <= 3 ? rankEmojis[entry.rank] : `#${entry.rank}`}
      </div>
      <div style={styles.entryInfo}>
        <div style={styles.entryName(entry.isLocal)}>
          {entry.playerName}
          {entry.isNew && <span style={styles.newBadge}>NEU</span>}
          {entry.isLocal && (
            <span style={{ fontSize: 10, color: TOKEN.accent2, marginLeft: 6 }}>
              (Du)
            </span>
          )}
        </div>
        <div style={styles.entryMeta}>
          {entry.wins} Siege · Streak {entry.winStreak} · {getRankTitle(entry.score)}
        </div>
      </div>
      <div style={styles.entryScore}>
        <div style={styles.entryScoreVal}>{formatScore(entry.score)}</div>
        <div style={styles.entryGrade(grade)}>Grade {grade}</div>
      </div>
    </div>
  );
});

// ----------------------------------------------------------------
// Score-Breakdown-Modal
// ----------------------------------------------------------------

function ScoreBreakdownModal({
  entry,
  rawScore,
  onClose,
}: {
  entry: LeaderboardEntry;
  rawScore: GameScore | null;
  onClose: () => void;
}) {
  if (!rawScore) return null;
  const breakdown = calculateScore(rawScore.rawData);

  const rows: [string, number | string][] = [
    ['Siege (Basis)', formatScore(breakdown.winBase)],
    ['Effizienz-Bonus', `+${formatScore(breakdown.efficiencyBonus)}`],
    ['Gegner-Stärke', `+${formatScore(breakdown.opponentBonus)}`],
    ['Skill-Einsatz', `+${formatScore(breakdown.skillBonus)}`],
    ['Kampagnen-Fortschritt', `+${formatScore(breakdown.campaignBonus)}`],
    ['Siegesserie', `+${formatScore(breakdown.streakBonus)}`],
    ['Zeitbonus', `+${formatScore(breakdown.timeBonus)}`],
  ];

  return (
    <div style={styles.modal} onClick={onClose}>
      <div style={styles.modalCard} onClick={(e) => e.stopPropagation()}>
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: TOKEN.text }}>
            {entry.playerName}
          </div>
          <div style={{ fontSize: 13, color: TOKEN.text3, marginTop: 4 }}>
            {getRankTitle(entry.score)} · Rang #{entry.rank}
          </div>
        </div>

        {rows.map(([label, value]) => (
          <div key={label} style={styles.breakdownRow}>
            <span style={{ color: TOKEN.text2 }}>{label}</span>
            <span style={{ color: TOKEN.gold, fontWeight: 700 }}>{value}</span>
          </div>
        ))}

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '16px 0 0',
          }}
        >
          <span style={{ fontSize: 15, fontWeight: 700, color: TOKEN.text }}>
            Gesamt
          </span>
          <span style={{ fontSize: 22, fontWeight: 800, color: TOKEN.gold }}>
            {formatScore(breakdown.total)}
          </span>
        </div>

        <div
          style={{
            textAlign: 'center',
            marginTop: 20,
            fontSize: 32,
            fontWeight: 900,
            color:
              breakdown.grade === 'S'
                ? TOKEN.gold
                : breakdown.grade === 'A'
                ? TOKEN.green
                : TOKEN.accent2,
          }}
        >
          Grade {breakdown.grade}
        </div>

        <button
          onClick={onClose}
          style={{
            width: '100%',
            marginTop: 20,
            padding: '12px',
            background: TOKEN.accent,
            border: 'none',
            borderRadius: 10,
            color: '#fff',
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Schließen
        </button>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------
// Haupt-Komponente
// ----------------------------------------------------------------

export interface LeaderboardScreenProps {
  entries: LeaderboardEntry[];
  rawScores: GameScore[];
  localPlayerId: string;
  p2pState: P2PMultiplayerState;
  isSyncing: boolean;
  lastSyncTime: number | null;
  onStartSync: () => void;
  onBack: () => void;
}

export const LeaderboardScreen = memo(function LeaderboardScreen({
  entries,
  rawScores,
  localPlayerId,
  p2pState,
  isSyncing,
  lastSyncTime,
  onStartSync,
  onBack,
}: LeaderboardScreenProps) {
  const [selectedEntry, setSelectedEntry] = useState<LeaderboardEntry | null>(null);

  const handleEntryClick = useCallback((entry: LeaderboardEntry) => {
    setSelectedEntry(entry);
  }, []);

  const top3 = entries.slice(0, 3);
  const rest = entries.slice(3);

  const syncLabel =
    p2pState.connectionState === 'connected'
      ? `Verbunden · ${p2pState.latency}ms`
      : p2pState.connectionState === 'advertising'
      ? 'Suche Spieler...'
      : p2pState.connectionState === 'scanning'
      ? 'Scanne...'
      : 'Offline';

  const syncDot =
    p2pState.connectionState === 'connected'
      ? TOKEN.green
      : p2pState.connectionState === 'advertising' || p2pState.connectionState === 'scanning'
      ? TOKEN.accent2
      : TOKEN.text3;

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
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

        <div style={styles.title}>RANGLISTE</div>

        <button
          onClick={onStartSync}
          style={styles.syncBadge(p2pState.connectionState)}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: syncDot,
              display: 'inline-block',
              animation:
                p2pState.connectionState === 'advertising' ||
                p2pState.connectionState === 'scanning'
                  ? 'pulse 1.5s infinite'
                  : 'none',
            }}
          />
          {syncLabel}
        </button>
      </div>

      {/* Podium — Top 3 */}
      {top3.length > 0 && (
        <div style={styles.podiumSection}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: 2,
              color: TOKEN.text3,
              textTransform: 'uppercase',
              marginBottom: 16,
              textAlign: 'center',
            }}
          >
            Top 3 — Bestenliste
          </div>
          <div style={styles.podiumRow}>
            {top3[1] && (
              <PodiumCard
                entry={top3[1]}
                rank={2}
                onClick={() => handleEntryClick(top3[1])}
              />
            )}
            {top3[0] && (
              <PodiumCard
                entry={top3[0]}
                rank={1}
                onClick={() => handleEntryClick(top3[0])}
              />
            )}
            {top3[2] && (
              <PodiumCard
                entry={top3[2]}
                rank={3}
                onClick={() => handleEntryClick(top3[2])}
              />
            )}
          </div>
        </div>
      )}

      {/* Vollständige Liste */}
      <div style={styles.listSection}>
        {entries.length === 0 ? (
          <div style={styles.emptyState}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>🏆</div>
            <div>Noch keine Einträge.</div>
            <div style={{ marginTop: 8, fontSize: 12 }}>
              Spiele eine Runde, um in der Rangliste zu erscheinen.
            </div>
          </div>
        ) : (
          <>
            {top3.length > 0 && (
              <div style={styles.sectionLabel}>Alle Spieler</div>
            )}
            {entries.map((entry) => (
              <EntryRow
                key={entry.playerId}
                entry={entry}
                onClick={() => handleEntryClick(entry)}
              />
            ))}
          </>
        )}

        {lastSyncTime && (
          <div
            style={{
              textAlign: 'center',
              fontSize: 11,
              color: TOKEN.text3,
              marginTop: 16,
            }}
          >
            Zuletzt synchronisiert:{' '}
            {new Date(lastSyncTime).toLocaleTimeString('de-DE')}
          </div>
        )}
      </div>

      {/* Sync-Overlay */}
      {isSyncing && (
        <div style={styles.syncOverlay}>
          <span style={{ fontSize: 16 }}>⟳</span>
          Synchronisiere Rangliste...
        </div>
      )}

      {/* Score-Breakdown-Modal */}
      {selectedEntry && (
        <ScoreBreakdownModal
          entry={selectedEntry}
          rawScore={
            rawScores.find((s) => s.playerId === selectedEntry.playerId) ?? null
          }
          onClose={() => setSelectedEntry(null)}
        />
      )}

      {/* CSS-Animationen */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
        @keyframes slideUp {
          from { transform: translate(-50%, 20px); opacity: 0; }
          to { transform: translate(-50%, 0); opacity: 1; }
        }
      `}</style>
    </div>
  );
});
