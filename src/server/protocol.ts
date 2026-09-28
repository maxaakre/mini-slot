import type { SpinOutcome } from '../math/engine';

/**
 * The contract between the game client and a game server. `MockServer`
 * implements it in the browser; a real backend would implement the same
 * `GameApi` over the network.
 */

export type RoundType = 'spin' | 'freeSpin' | 'buyBonus';

export interface RoundRequest {
  /** Client-generated. Retrying with the same id never charges twice. */
  requestId: string;
  type: RoundType;
  /** Cents. Ignored for free spins, which use the bet that started the bonus. */
  bet: number;
}

export interface FreeSpinsState {
  remaining: number;
  played: number;
  total: number;
  multiplier: number;
  bet: number;
  /** Cents won so far in this bonus. */
  totalWin: number;
}

export interface RoundResponse {
  requestId: string;
  roundId: number;
  type: RoundType;
  /** Cents taken for this round (0 for free spins). */
  cost: number;
  /** Null for a bonus buy, which goes straight into free spins. */
  outcome: SpinOutcome | null;
  /** Cents. */
  win: number;
  /** Balance after the round is settled, in cents. */
  balance: number;
  /**
   * Bonus state after this round. On the last free spin `remaining` is 0,
   * so the client can still show the bonus summary.
   */
  freeSpins: FreeSpinsState | null;
}

/** What a client needs to (re)connect, e.g. mid-bonus after a reload. */
export interface Session {
  /** Cents. */
  balance: number;
  freeSpins: FreeSpinsState | null;
}

export interface GameApi {
  play(request: RoundRequest): Promise<RoundResponse>;
}

export type ServerErrorCode =
  | 'INVALID_BET'
  | 'INSUFFICIENT_FUNDS'
  | 'FREE_SPINS_ACTIVE'
  | 'NO_FREE_SPINS'
  | 'REQUEST_ID_REUSED'
  | 'NETWORK';

export class ServerError extends Error {
  constructor(
    readonly code: ServerErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ServerError';
  }
}
