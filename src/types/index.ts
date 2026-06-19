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
export interface GameScore {
  playerId: string;
  playerName: string;
  score: number;
  timestamp: number;
  checksum: string;
  version: number;
}

export interface LeaderboardEntry extends GameScore {
  rank?: number;
  isLocal?: boolean;
}

// --- P2P Multiplayer ---
export interface GameMovePayload {
  cellIndex: number;
  player: 'X' | 'O';
  moveNumber: number;
  boardHash: string;
}

export interface P2PPeer {
  id: string;
  name: string;
  deviceId: string;
}

export interface P2PMessage {
  type: 'HANDSHAKE' | 'MOVE' | 'SYNC_LEADERBOARD' | 'CHAT' | 'PING';
  payload: any;
  senderId: string;
  timestamp: number;
}

export interface P2PMultiplayerState {
  connectionState: 'idle' | 'searching' | 'connecting' | 'connected' | 'error' | 'scanning' | 'advertising' | 'disconnected' | 'syncing';
  connectedPeer: P2PPeer | null;
  availablePeers: P2PPeer[];
  role: 'host' | 'guest' | 'none' | null;
  transport: 'ble' | 'wifi-direct' | 'none';
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
  | 'draw';

// --- Vector Clock (CRDT) ---
export interface VectorClock {
  [deviceId: string]: number;
}

export interface CRDTEntry<T> {
  value: T;
  clock: VectorClock;
  timestamp: number;
}
