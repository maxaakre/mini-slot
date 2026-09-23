import { describe, expect, it } from 'vitest';
import { BONUS_BUY_COST, FREE_SPINS } from '../src/math/config';
import { playWithRetry } from '../src/server/client';
import { MockServer, ServerError, type RoundRequest } from '../src/server/mockServer';

let nextId = 0;
const req = (type: RoundRequest['type'], bet = 100): RoundRequest => ({ requestId: `r${nextId++}`, type, bet });

describe('MockServer', () => {
  it('charges the bet and credits the win', async () => {
    const server = new MockServer({ seed: 1, balance: 1000 });
    const res = await server.play(req('spin'));
    expect(res.cost).toBe(100);
    expect(res.balance).toBe(1000 - 100 + res.win);
  });

  it('rejects bets that are not an allowed level', async () => {
    const server = new MockServer({ seed: 1, balance: 1000 });
    await expect(server.play(req('spin', 30))).rejects.toMatchObject({ code: 'INVALID_BET' });
  });

  it('rejects spins the player cannot afford', async () => {
    const server = new MockServer({ seed: 1, balance: 50 });
    await expect(server.play(req('spin'))).rejects.toMatchObject({ code: 'INSUFFICIENT_FUNDS' });
    expect(server.getSession().balance).toBe(50);
  });

  it('is idempotent: the same request id never charges twice', async () => {
    const server = new MockServer({ seed: 1, balance: 1000 });
    const request = req('spin');
    const first = await server.play(request);
    const second = await server.play(request);
    expect(second).toEqual(first);
    expect(server.getSession().balance).toBe(first.balance);
  });

  it('refuses free spins without a bonus', async () => {
    const server = new MockServer({ seed: 1, balance: 1000 });
    await expect(server.play(req('freeSpin'))).rejects.toMatchObject({ code: 'NO_FREE_SPINS' });
  });

  it('runs a bought bonus to the end', async () => {
    const server = new MockServer({ seed: 5, balance: 100_000 });
    const buy = await server.play(req('buyBonus'));
    expect(buy.cost).toBe(100 * BONUS_BUY_COST);
    expect(buy.freeSpins?.remaining).toBe(FREE_SPINS.awarded);

    // Base spins are blocked while the bonus is running.
    await expect(server.play(req('spin'))).rejects.toMatchObject({ code: 'FREE_SPINS_ACTIVE' });

    let bonusWin = 0;
    let state = buy.freeSpins;
    while (state && state.remaining > 0) {
      const res = await server.play(req('freeSpin'));
      expect(res.cost).toBe(0);
      expect(res.outcome?.multiplier).toBe(FREE_SPINS.winMultiplier);
      bonusWin += res.win;
      if (res.freeSpins) expect(res.freeSpins.totalWin).toBe(bonusWin);
      state = res.freeSpins;
    }
    expect(server.getSession()).toEqual({ balance: 100_000 - buy.cost + bonusWin, freeSpins: null });
  });
});

describe('playWithRetry', () => {
  it('retries a lost response without double charging', async () => {
    const server = new MockServer({ seed: 2, balance: 1000 });
    let calls = 0;
    // The server settles the first call, but its response is "lost".
    const flaky = {
      play: async (request: RoundRequest) => {
        calls++;
        const res = await server.play(request);
        if (calls === 1) throw new ServerError('NETWORK', 'lost');
        return res;
      },
    };
    const res = await playWithRetry(flaky, req('spin'), { retries: 2, backoffMs: 0 });
    expect(calls).toBe(2);
    expect(res.balance).toBe(1000 - 100 + res.win);
    expect(server.getSession().balance).toBe(res.balance);
  });

  it('gives up after the retry limit', async () => {
    const server = new MockServer({ seed: 2, balance: 1000, failureRate: 1 });
    await expect(playWithRetry(server, req('spin'), { retries: 2, backoffMs: 0 })).rejects.toMatchObject({
      code: 'NETWORK',
    });
  });

  it('does not retry business errors', async () => {
    let calls = 0;
    const api = {
      play: async () => {
        calls++;
        throw new ServerError('INSUFFICIENT_FUNDS', 'no');
      },
    };
    await expect(playWithRetry(api, req('spin'), { retries: 3, backoffMs: 0 })).rejects.toThrow();
    expect(calls).toBe(1);
  });
});
