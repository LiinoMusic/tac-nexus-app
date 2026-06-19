/**
 * Global Type Definitions for TAC·NEXUS
 */

// --- Board & Game ---
export type CellValue = 'X' | 'O' | null;
export type BoardState = CellValue[];
export type GameResult = 'X' | 'O' | 'draw' | null;
export type AIDifficulty = 0 | 1 | 2 | 3 | 4;

// --- Skills ---
export type SkillId = 'block' | 'erase' | 'shadow' | 'double' | 'swap' | 'reveal';

// --- Campaign ---
export interface CampaignQuest {
  id: string;
  label: string;
  done: boolean;
}

export interface CampaignNode {
  id: number;
  title: string;
  difficulty: AIDifficulty;
  reward: number;
  quests: CampaignQuest[];
}

// --- Player Profile & State ---
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
  playerId: string;
  playerName: string;
  deviceId: string;
}

// --- Scoring & Leaderboard ---
export interface ScoreRawData {
  wins: number;
  losses: number;
  draws: number;
  totalMoves: number;
  avgMovesPerWin: number;
  skillsUsed: number;
  campaignProgress: number;
  maxWinStreak: number;
  opponentStrength: number;
  timeBonus: number;
}

export interface GameScore {
  id?: string;
  playerId: string;
  playerName: string;
  deviceId?: string;
  score: number;
  timestamp: number;
  checksum?: string;
  version: number;
  rawData: ScoreRawData;
  synced?: boolean;
}

export interface LeaderboardEntry {
  rank: number;
  playerId: string;
  playerName: string;
  score: number;
  wins: number;
  winStreak: number;
  lastSeen: number;
  isLocal: boolean;
  isNew: boolean;
  timestamp?: number;
  checksum?: string;
  version?: number;
}

export interface MergeResult {
  merged: GameScore[];
  conflicts: number;
  newEntries: number;
  updatedEntries: number;
}

// --- P2P Multiplayer ---
export interface GameMovePayload {
  cellIndex: number;
  player: 'X' | 'O';
  moveNumber: number;
  boardHash: string;
  skillUsed?: SkillId;
}

export interface P2PPeer {
  id: string;
  name: string;
  deviceId: string;
  transport?: string;
  connectedAt?: number;
  rssi?: number;
}

export type P2PConnectionState = 'idle' | 'searching' | 'connecting' | 'connected' | 'error' | 'scanning' | 'advertising' | 'disconnected' | 'syncing';
export type P2PRole = 'host' | 'guest' | 'none';
export type P2PTransport = 'ble' | 'wifi-direct' | 'none';

export interface HandshakePayload {
  playerId: string;
  playerName: string;
  deviceId: string;
  appVersion: string;
  capabilities: string[];
}

export interface LeaderboardSyncPayload {
  entries: GameScore[];
  vectorClock: Record<string, number>;
}

export interface P2PMessage<T = any> {
  type: 'HANDSHAKE' | 'HANDSHAKE_ACK' | 'GAME_MOVE' | 'LEADERBOARD_SYNC_REQUEST' | 'LEADERBOARD_SYNC_RESPONSE' | 'HEARTBEAT' | 'DISCONNECT' | 'MOVE' | 'SYNC_LEADERBOARD' | 'CHAT' | 'PING';
  payload: T;
  senderId: string;
  senderName?: string;
  timestamp: number;
  checksum?: string;
}

export interface P2PMultiplayerState {
  connectionState: P2PConnectionState;
  connectedPeer: P2PPeer | null;
  availablePeers: P2PPeer[];
  role: P2PRole;
  transport: P2PTransport;
  latency: number;
  isMyTurn: boolean;
  syncStatus: 'idle' | 'syncing' | 'synced' | 'error';
  error?: Error | null;
}

// --- Haptic Feedback ---
export type HapticPattern = 
  | 'selection' 
  | 'light' 
  | 'medium' 
  | 'heavy' 
  | 'success' 
  | 'warning' 
  | 'error' 
  | 'win' 
  | 'lose' 
  | 'draw'
  | 'skill_activate';

// --- Vector Clock (CRDT) ---
export interface VectorClock {
  [deviceId: string]: number;
}

export interface CRDTEntry<T> {
  value: T;
  clock: VectorClock;
  timestamp: number;
}
