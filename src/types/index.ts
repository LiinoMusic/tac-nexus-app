// ============================================================
// TAC·NEXUS — Core Type Definitions
// React 19 / TypeScript / Capacitor Native
// ============================================================

// ------ Board & Game ----------------------------------------

export type CellValue = 'X' | 'O' | null;
export type BoardState = [
  CellValue, CellValue, CellValue,
  CellValue, CellValue, CellValue,
  CellValue, CellValue, CellValue,
];

export type GameResult = 'X' | 'O' | 'draw' | null;
export type GameMode = 'campaign' | 'quick' | 'p2p';
export type AIDifficulty = 0 | 1 | 2 | 3 | 4;
export type SkillId = 'block' | 'erase' | 'shadow' | 'swap' | 'double' | 'reveal';

export interface SkillState {
  uses: number;
}

export interface GameSnapshot {
  board: BoardState;
  currentTurn: 'X' | 'O';
  scores: { X: number; O: number };
  moveCount: number;
  gameActive: boolean;
  activeSkill: SkillId | null;
  hiddenCells: number[];
  blockedCells: number[];
  shadowMove: boolean;
  doubleMove: boolean;
  doubleMoveUsed: boolean;
  swapMode: boolean;
  swapFirst: number | null;
}

// ------ Campaign --------------------------------------------

export type DifficultyLabel = 'easy' | 'medium' | 'hard' | 'boss';

export interface Quest {
  id: string;
  label: string;
}

export interface CampaignNode {
  id: number;
  label: string;
  diff: DifficultyLabel;
  aiLvl: AIDifficulty;
  quests: Quest[];
  reward: number;
  boss: boolean;
}

// ------ Player Profile & State ------------------------------

export interface PlayerProfile {
  prefersCenter: number;
  prefersCorner: number;
  prefersEdge: number;
  aggressive: number;
  defensive: number;
  totalGames: number;
  winStreak: number;
  lossStreak: number;
  avgMovesWin: number;
}

export interface AppState {
  coins: number;
  totalWins: number;
  totalLosses: number;
  totalDraws: number;
  totalMoves: number;
  gamesPlayed: number;
  currentNode: number;
  completedNodes: number[];
  ownedSkills: SkillId[];
  playerProfile: PlayerProfile;
  playerId: string;        // UUID, generiert beim ersten Start
  playerName: string;
  deviceId: string;
}

// ------ Scoring & Leaderboard --------------------------------

export interface GameScore {
  id: string;                // UUID
  playerId: string;
  playerName: string;
  deviceId: string;
  score: number;             // Dynamisch berechneter Score
  rawData: ScoreRawData;
  timestamp: number;         // Unix ms
  version: number;           // Vektoruhr-Komponente für Merge
  synced: boolean;
}

export interface ScoreRawData {
  wins: number;
  losses: number;
  draws: number;
  totalMoves: number;
  avgMovesPerWin: number;
  skillsUsed: number;
  campaignProgress: number;  // 0–1
  maxWinStreak: number;
  opponentStrength: number;  // 0–4 (AI-Level)
  timeBonus: number;         // Sekunden gespart
}

export interface LeaderboardEntry {
  rank: number;
  playerId: string;
  playerName: string;
  score: number;
  wins: number;
  winStreak: number;
  lastSeen: number;
  isLocal: boolean;          // Eigener Eintrag
  isNew: boolean;            // Neu nach Merge
}

// ------ P2P Multiplayer -------------------------------------

export type P2PTransport = 'ble' | 'wifi-direct' | 'multipeer' | 'none';
export type P2PRole = 'host' | 'guest' | 'none';
export type P2PConnectionState =
  | 'idle'
  | 'advertising'
  | 'scanning'
  | 'connecting'
  | 'connected'
  | 'syncing'
  | 'disconnected'
  | 'error';

export interface P2PPeer {
  id: string;
  name: string;
  deviceId: string;
  rssi?: number;             // Signal-Stärke für BLE
  transport: P2PTransport;
  connectedAt?: number;
}

export type P2PMessageType =
  | 'HANDSHAKE'
  | 'HANDSHAKE_ACK'
  | 'GAME_MOVE'
  | 'GAME_STATE_SYNC'
  | 'LEADERBOARD_SYNC_REQUEST'
  | 'LEADERBOARD_SYNC_RESPONSE'
  | 'HEARTBEAT'
  | 'DISCONNECT';

export interface P2PMessage<T = unknown> {
  type: P2PMessageType;
  senderId: string;
  senderName: string;
  timestamp: number;
  payload: T;
  checksum: string;          // CRC32 für Integrität
}

export interface HandshakePayload {
  playerId: string;
  playerName: string;
  deviceId: string;
  appVersion: string;
  capabilities: string[];
}

export interface GameMovePayload {
  cellIndex: number;
  player: 'X' | 'O';
  skillUsed?: SkillId;
  moveNumber: number;
  boardHash: string;         // Konsistenz-Check
}

export interface LeaderboardSyncPayload {
  entries: GameScore[];
  vectorClock: Record<string, number>;
}

// ------ Haptic Feedback -------------------------------------

export type HapticPattern =
  | 'light'
  | 'medium'
  | 'heavy'
  | 'success'
  | 'warning'
  | 'error'
  | 'selection'
  | 'win'
  | 'lose'
  | 'draw'
  | 'skill_activate';

// ------ Vector Clock (CRDT) ---------------------------------

export type VectorClock = Record<string, number>;

export interface MergeResult {
  merged: GameScore[];
  conflicts: number;
  newEntries: number;
  updatedEntries: number;
}
