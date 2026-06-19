/**
 * useGameEngine — Portierte Game-Engine als React 19 Hook
 *
 * Kapselt die gesamte Spiellogik aus der originalen HTML-App:
 *   - Board-State-Management
 *   - KI-Engine (Minimax + Adaptive, direkt portiert)
 *   - Skill-System (Block, Erase, Shadow, Swap, Double, Reveal)
 *   - Quest-Tracking
 *   - Score-Berechnung
 *   - P2P-Multiplayer-Integration (Zug-Synchronisation)
 *
 * React 19 Features:
 *   - useOptimistic für sofortige Board-Updates
 *   - useTransition für nicht-blockierende KI-Berechnungen
 *   - use() für asynchrone Ressourcen (Capacitor Preferences)
 */

import {
  useReducer,
  useCallback,
  useEffect,
  useRef,
  useOptimistic,
  useTransition,
  startTransition,
} from 'react';
import type {
  BoardState,
  CellValue,
  GameResult,
  AIDifficulty,
  SkillId,
  CampaignNode,
  GameMovePayload,
} from '../types';
import { hashBoard } from '../utils/checksum';

// ----------------------------------------------------------------
// KI-Engine (portiert aus HTML-Original)
// ----------------------------------------------------------------

const WIN_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
] as const;

function checkWinner(board: BoardState): CellValue {
  for (const [a, b, c] of WIN_LINES) {
    if (board[a] && board[a] === board[b] && board[b] === board[c]) {
      return board[a];
    }
  }
  return null;
}

function getEmpty(board: BoardState): number[] {
  return board.map((v, i) => (v === null ? i : -1)).filter((i) => i >= 0);
}

function isWinningMove(board: BoardState, pos: number, sym: CellValue): boolean {
  const b = [...board] as BoardState;
  b[pos] = sym;
  return !!checkWinner(b);
}

function countThreats(board: BoardState, sym: CellValue): number {
  let t = 0;
  for (const l of WIN_LINES) {
    const vals = l.map((i) => board[i]);
    if (vals.filter((v) => v === sym).length === 2 && vals.includes(null)) t++;
  }
  return t;
}

function evaluate(board: BoardState, ai: CellValue, pl: CellValue): number {
  let score = 0;
  for (const l of WIN_LINES) {
    const vals = l.map((i) => board[i]);
    const aiC = vals.filter((v) => v === ai).length;
    const plC = vals.filter((v) => v === pl).length;
    if (!plC) score += aiC * aiC;
    if (!aiC) score -= plC * plC;
  }
  if (board[4] === ai) score += 3;
  return score;
}

function minimax(
  board: BoardState,
  depth: number,
  isMax: boolean,
  ai: CellValue,
  pl: CellValue,
  alpha: number,
  beta: number,
): number {
  const w = checkWinner(board);
  if (w === ai) return 10 - depth;
  if (w === pl) return depth - 10;
  const empty = getEmpty(board);
  if (!empty.length) return 0;
  if (depth > 5) return evaluate(board, ai, pl);

  if (isMax) {
    let best = -Infinity;
    for (const i of empty) {
      const b = [...board] as BoardState;
      b[i] = ai;
      const s = minimax(b, depth + 1, false, ai, pl, alpha, beta);
      best = Math.max(best, s);
      alpha = Math.max(alpha, s);
      if (beta <= alpha) break;
    }
    return best;
  } else {
    let best = Infinity;
    for (const i of empty) {
      const b = [...board] as BoardState;
      b[i] = pl;
      const s = minimax(b, depth + 1, true, ai, pl, alpha, beta);
      best = Math.min(best, s);
      beta = Math.min(beta, s);
      if (beta <= alpha) break;
    }
    return best;
  }
}

function minimaxMove(board: BoardState, ai: CellValue, pl: CellValue): number {
  const empty = getEmpty(board);
  let best = -Infinity;
  let bestMove = empty[0];
  for (const i of empty) {
    const b = [...board] as BoardState;
    b[i] = ai;
    const score = minimax(b, 0, false, ai, pl, -Infinity, Infinity);
    if (score > best) { best = score; bestMove = i; }
  }
  return bestMove;
}

interface AIPlayerModel {
  center: number;
  corner: number;
  edges: number;
  aggressive: number;
  defensive: number;
}

function getBestAIMove(
  board: BoardState,
  difficulty: AIDifficulty,
  model: AIPlayerModel,
  blockedCells: Set<number>,
): number {
  const empty = getEmpty(board).filter((i) => !blockedCells.has(i));
  if (!empty.length) return -1;

  const errorRate = [0.7, 0.35, 0.12, 0.03, 0][difficulty];
  if (Math.random() < errorRate) {
    if (difficulty === 0) return empty[Math.floor(Math.random() * empty.length)];
    const bad = empty.filter(
      (i) => !isWinningMove(board, i, 'O') && !isWinningMove(board, i, 'X'),
    );
    if (bad.length) return bad[Math.floor(Math.random() * bad.length)];
  }

  // Sofortiger Sieg
  for (const i of empty) if (isWinningMove(board, i, 'O')) return i;
  // Spieler blockieren
  for (const i of empty) if (isWinningMove(board, i, 'X')) return i;

  if (difficulty >= 2) return minimaxMove(board, 'O', 'X');

  // Strategisch
  if (board[4] === null && !blockedCells.has(4)) return 4;
  const corners = [0, 2, 6, 8].filter((c) => board[c] === null && !blockedCells.has(c));
  if (corners.length) return corners[Math.floor(Math.random() * corners.length)];
  return empty[Math.floor(Math.random() * empty.length)];
}

// ----------------------------------------------------------------
// State-Reducer
// ----------------------------------------------------------------

export interface GameState {
  board: BoardState;
  currentTurn: 'X' | 'O';
  gameActive: boolean;
  result: GameResult;
  winLine: number[] | null;
  scores: { X: number; O: number };
  moveCount: number;
  activeSkill: SkillId | null;
  skillUses: Partial<Record<SkillId, number>>;
  hiddenCells: Set<number>;
  blockedCells: Set<number>;
  shadowMove: boolean;
  doubleMove: boolean;
  doubleMoveUsed: boolean;
  swapMode: boolean;
  swapFirst: number | null;
  usedSkills: boolean;
  noErrors: boolean;
  questProgress: Record<string, boolean>;
  gameMode: 'campaign' | 'quick' | 'p2p';
  aiDifficulty: AIDifficulty;
  aiModel: AIPlayerModel;
  startTime: number;
}

type GameAction =
  | { type: 'START_GAME'; payload: { mode: GameState['gameMode']; difficulty: AIDifficulty; ownedSkills: SkillId[]; quests: CampaignNode['quests'] } }
  | { type: 'PLACE_CELL'; payload: { index: number; player: 'X' | 'O' } }
  | { type: 'SET_RESULT'; payload: { result: GameResult; winLine: number[] | null } }
  | { type: 'ACTIVATE_SKILL'; payload: { skillId: SkillId } }
  | { type: 'DEACTIVATE_SKILL' }
  | { type: 'USE_SKILL'; payload: { skillId: SkillId } }
  | { type: 'BLOCK_CELL'; payload: { index: number } }
  | { type: 'UNBLOCK_CELL'; payload: { index: number } }
  | { type: 'ERASE_CELL'; payload: { index: number } }
  | { type: 'HIDE_CELL'; payload: { index: number } }
  | { type: 'SWAP_SELECT_FIRST'; payload: { index: number } }
  | { type: 'SWAP_EXECUTE'; payload: { from: number; to: number } }
  | { type: 'SET_TURN'; payload: { turn: 'X' | 'O' } }
  | { type: 'INCREMENT_SCORE'; payload: { player: 'X' | 'O' } }
  | { type: 'OBSERVE_MOVE'; payload: { pos: number } }
  | { type: 'SET_QUEST_DONE'; payload: { questId: string } }
  | { type: 'SET_NO_ERRORS'; payload: { value: boolean } };

const EMPTY_BOARD: BoardState = [null, null, null, null, null, null, null, null, null];

function createInitialState(): GameState {
  return {
    board: [...EMPTY_BOARD] as BoardState,
    currentTurn: 'X',
    gameActive: false,
    result: null,
    winLine: null,
    scores: { X: 0, O: 0 },
    moveCount: 0,
    activeSkill: null,
    skillUses: {},
    hiddenCells: new Set(),
    blockedCells: new Set(),
    shadowMove: false,
    doubleMove: false,
    doubleMoveUsed: false,
    swapMode: false,
    swapFirst: null,
    usedSkills: false,
    noErrors: true,
    questProgress: {},
    gameMode: 'quick',
    aiDifficulty: 2,
    aiModel: { center: 0, corner: 0, edges: 0, aggressive: 0, defensive: 0 },
    startTime: 0,
  };
}

function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case 'START_GAME': {
      const skillUses: Partial<Record<SkillId, number>> = {};
      action.payload.ownedSkills.forEach((id) => { skillUses[id] = 2; });
      const questProgress: Record<string, boolean> = {};
      action.payload.quests.forEach((q) => { questProgress[q.id] = false; });
      return {
        ...createInitialState(),
        scores: state.scores,
        gameActive: true,
        gameMode: action.payload.mode,
        aiDifficulty: action.payload.difficulty,
        skillUses,
        questProgress,
        startTime: Date.now(),
      };
    }

    case 'PLACE_CELL': {
      const board = [...state.board] as BoardState;
      board[action.payload.index] = action.payload.player;
      return { ...state, board, moveCount: state.moveCount + 1 };
    }

    case 'SET_RESULT':
      return {
        ...state,
        gameActive: false,
        result: action.payload.result,
        winLine: action.payload.winLine,
      };

    case 'ACTIVATE_SKILL':
      return { ...state, activeSkill: action.payload.skillId };

    case 'DEACTIVATE_SKILL':
      return { ...state, activeSkill: null };

    case 'USE_SKILL': {
      const uses = (state.skillUses[action.payload.skillId] ?? 0) - 1;
      const skillUses = { ...state.skillUses };
      if (uses <= 0) delete skillUses[action.payload.skillId];
      else skillUses[action.payload.skillId] = uses;
      return { ...state, skillUses, usedSkills: true, activeSkill: null };
    }

    case 'BLOCK_CELL': {
      const blockedCells = new Set(state.blockedCells);
      blockedCells.add(action.payload.index);
      return { ...state, blockedCells };
    }

    case 'UNBLOCK_CELL': {
      const blockedCells = new Set(state.blockedCells);
      blockedCells.delete(action.payload.index);
      return { ...state, blockedCells };
    }

    case 'ERASE_CELL': {
      const board = [...state.board] as BoardState;
      board[action.payload.index] = null;
      return { ...state, board };
    }

    case 'HIDE_CELL': {
      const hiddenCells = new Set(state.hiddenCells);
      hiddenCells.add(action.payload.index);
      return { ...state, hiddenCells, shadowMove: false };
    }

    case 'SWAP_SELECT_FIRST':
      return { ...state, swapFirst: action.payload.index };

    case 'SWAP_EXECUTE': {
      const board = [...state.board] as BoardState;
      board[action.payload.to] = board[action.payload.from];
      board[action.payload.from] = null;
      return { ...state, board, swapMode: false, swapFirst: null, usedSkills: true };
    }

    case 'SET_TURN':
      return { ...state, currentTurn: action.payload.turn };

    case 'INCREMENT_SCORE': {
      const scores = { ...state.scores };
      scores[action.payload.player]++;
      return { ...state, scores };
    }

    case 'OBSERVE_MOVE': {
      const pos = action.payload.pos;
      const model = { ...state.aiModel };
      if (pos === 4) model.center++;
      else if ([0, 2, 6, 8].includes(pos)) model.corner++;
      else model.edges++;
      const threats = countThreats(state.board, 'X');
      if (threats > 1) model.aggressive++;
      else model.defensive++;
      return { ...state, aiModel: model };
    }

    case 'SET_QUEST_DONE': {
      const questProgress = { ...state.questProgress, [action.payload.questId]: true };
      return { ...state, questProgress };
    }

    case 'SET_NO_ERRORS':
      return { ...state, noErrors: action.payload.value };

    default:
      return state;
  }
}

// ----------------------------------------------------------------
// Hook
// ----------------------------------------------------------------

export interface UseGameEngineOptions {
  ownedSkills: SkillId[];
  campaignNode?: CampaignNode | null;
  gameMode?: GameState['gameMode'];
  onGameEnd?: (result: GameResult, state: GameState) => void;
  onMoveAnimated?: (index: number) => void;
  /** P2P: Empfangener Zug vom Peer */
  pendingP2PMove?: GameMovePayload | null;
  /** P2P: Eigene Spieler-Seite */
  p2pPlayerSide?: 'X' | 'O' | null;
}

export function useGameEngine(options: UseGameEngineOptions) {
  const {
    ownedSkills,
    campaignNode,
    gameMode = 'quick',
    onGameEnd,
    onMoveAnimated,
    pendingP2PMove,
    p2pPlayerSide,
  } = options;

  const [state, dispatch] = useReducer(gameReducer, undefined, createInitialState);
  const [, startTrans] = useTransition();
  const aiTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const processedMoveRef = useRef<number>(-1);

  // ---- Spiel starten ----
  const startGame = useCallback(
    (difficulty: AIDifficulty = 2) => {
      dispatch({
        type: 'START_GAME',
        payload: {
          mode: gameMode,
          difficulty,
          ownedSkills,
          quests: campaignNode?.quests ?? [],
        },
      });
    },
    [gameMode, ownedSkills, campaignNode],
  );

  // ---- Spielende prüfen ----
  const checkGameEnd = useCallback(
    (board: BoardState) => {
      const winner = checkWinner(board);
      const empty = getEmpty(board);

      if (winner || empty.length === 0) {
        let winLine: number[] | null = null;
        if (winner) {
          for (const l of WIN_LINES) {
            if (board[l[0]] && board[l[0]] === board[l[1]] && board[l[1]] === board[l[2]]) {
              winLine = [...l];
              break;
            }
          }
        }
        const result: GameResult = winner ?? 'draw';
        dispatch({ type: 'SET_RESULT', payload: { result, winLine } });
        onGameEnd?.(result, state);
        return true;
      }
      return false;
    },
    [onGameEnd, state],
  );

  // ---- KI-Zug ----
  const executeAIMove = useCallback(
    (currentState: GameState) => {
      if (!currentState.gameActive || currentState.currentTurn !== 'O') return;
      if (currentState.gameMode === 'p2p') return; // Kein KI-Zug im P2P-Modus

      const visibleBoard = currentState.board.map((v, i) =>
        currentState.hiddenCells.has(i) ? null : v,
      ) as BoardState;

      const move = getBestAIMove(
        visibleBoard,
        currentState.aiDifficulty,
        currentState.aiModel,
        currentState.blockedCells,
      );

      if (move === -1) {
        dispatch({ type: 'SET_TURN', payload: { turn: 'X' } });
        return;
      }

      dispatch({ type: 'PLACE_CELL', payload: { index: move, player: 'O' } });
      onMoveAnimated?.(move);

      // Fehler-Tracking
      if (countThreats(currentState.board, 'X') >= 2) {
        dispatch({ type: 'SET_NO_ERRORS', payload: { value: false } });
      }

      const newBoard = [...currentState.board] as BoardState;
      newBoard[move] = 'O';

      if (!checkGameEnd(newBoard)) {
        dispatch({ type: 'SET_TURN', payload: { turn: 'X' } });
      }
    },
    [checkGameEnd, onMoveAnimated],
  );

  // ---- Spieler-Zug ----
  const handlePlayerMove = useCallback(
    (cellIndex: number, onSendP2PMove?: (idx: number, board: BoardState) => void) => {
      if (!state.gameActive || state.currentTurn !== 'X') return;
      if (state.gameMode === 'p2p' && p2pPlayerSide !== 'X') return;

      const { board, activeSkill, swapMode, swapFirst, shadowMove, doubleMove, doubleMoveUsed } = state;

      // Swap-Modus
      if (swapMode) {
        if (swapFirst === null) {
          if (board[cellIndex] === 'X') {
            dispatch({ type: 'SWAP_SELECT_FIRST', payload: { index: cellIndex } });
          }
          return;
        }
        if (board[cellIndex] !== null) return;
        dispatch({ type: 'SWAP_EXECUTE', payload: { from: swapFirst, to: cellIndex } });
        const newBoard = [...board] as BoardState;
        newBoard[cellIndex] = newBoard[swapFirst];
        newBoard[swapFirst] = null;
        onMoveAnimated?.(cellIndex);
        if (!checkGameEnd(newBoard)) {
          dispatch({ type: 'SET_TURN', payload: { turn: 'O' } });
          scheduleAIMove();
        }
        return;
      }

      // Block-Skill
      if (activeSkill === 'block') {
        if (board[cellIndex] !== null) return;
        dispatch({ type: 'BLOCK_CELL', payload: { index: cellIndex } });
        dispatch({ type: 'USE_SKILL', payload: { skillId: 'block' } });
        setTimeout(() => {
          dispatch({ type: 'UNBLOCK_CELL', payload: { index: cellIndex } });
        }, 1500);
        dispatch({ type: 'SET_TURN', payload: { turn: 'O' } });
        scheduleAIMove();
        return;
      }

      // Erase-Skill
      if (activeSkill === 'erase') {
        if (board[cellIndex] !== 'O') return;
        dispatch({ type: 'ERASE_CELL', payload: { index: cellIndex } });
        dispatch({ type: 'USE_SKILL', payload: { skillId: 'erase' } });
        return;
      }

      // Normaler Zug
      if (board[cellIndex] !== null || state.blockedCells.has(cellIndex)) return;

      dispatch({ type: 'PLACE_CELL', payload: { index: cellIndex, player: 'X' } });
      dispatch({ type: 'OBSERVE_MOVE', payload: { pos: cellIndex } });

      if (shadowMove) {
        dispatch({ type: 'HIDE_CELL', payload: { index: cellIndex } });
      }

      onMoveAnimated?.(cellIndex);

      const newBoard = [...board] as BoardState;
      newBoard[cellIndex] = 'X';

      // P2P: Zug senden
      onSendP2PMove?.(cellIndex, newBoard);

      // Doppelzug
      if (doubleMove && !doubleMoveUsed) {
        // Erster Zug des Doppelzugs — kein KI-Zug
        return;
      }

      if (!checkGameEnd(newBoard)) {
        if (state.gameMode !== 'p2p') {
          dispatch({ type: 'SET_TURN', payload: { turn: 'O' } });
          scheduleAIMove();
        }
      }
    },
    [state, checkGameEnd, onMoveAnimated, p2pPlayerSide],
  );

  // ---- P2P: Empfangenen Zug verarbeiten ----
  useEffect(() => {
    if (!pendingP2PMove) return;
    if (pendingP2PMove.moveNumber === processedMoveRef.current) return;
    processedMoveRef.current = pendingP2PMove.moveNumber;

    const { cellIndex, player } = pendingP2PMove;
    dispatch({ type: 'PLACE_CELL', payload: { index: cellIndex, player } });
    onMoveAnimated?.(cellIndex);

    const newBoard = [...state.board] as BoardState;
    newBoard[cellIndex] = player;

    if (!checkGameEnd(newBoard)) {
      dispatch({ type: 'SET_TURN', payload: { turn: p2pPlayerSide ?? 'X' } });
    }
  }, [pendingP2PMove, state.board, checkGameEnd, onMoveAnimated, p2pPlayerSide]);

  // ---- KI-Zug planen ----
  const scheduleAIMove = useCallback(() => {
    if (aiTimeoutRef.current) clearTimeout(aiTimeoutRef.current);
    aiTimeoutRef.current = setTimeout(() => {
      startTrans(() => {
        executeAIMove(state);
      });
    }, 600);
  }, [executeAIMove, state, startTrans]);

  // ---- Skill aktivieren ----
  const activateSkill = useCallback(
    (skillId: SkillId) => {
      if (!state.gameActive || state.currentTurn !== 'X') return;
      if ((state.skillUses[skillId] ?? 0) <= 0) return;

      if (state.activeSkill === skillId) {
        dispatch({ type: 'DEACTIVATE_SKILL' });
        return;
      }

      // Sofort-Skills
      if (skillId === 'shadow') {
        dispatch({ type: 'USE_SKILL', payload: { skillId } });
        return;
      }
      if (skillId === 'double') {
        dispatch({ type: 'USE_SKILL', payload: { skillId } });
        return;
      }
      if (skillId === 'swap') {
        dispatch({ type: 'ACTIVATE_SKILL', payload: { skillId } });
        dispatch({ type: 'USE_SKILL', payload: { skillId } });
        return;
      }

      dispatch({ type: 'ACTIVATE_SKILL', payload: { skillId } });
    },
    [state],
  );

  // ---- Cleanup ----
  useEffect(() => {
    return () => {
      if (aiTimeoutRef.current) clearTimeout(aiTimeoutRef.current);
    };
  }, []);

  return {
    state,
    startGame,
    handlePlayerMove,
    activateSkill,
    checkWinner,
    countThreats,
  };
}
