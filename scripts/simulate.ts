/**
 * Monte Carlo simulation of the game math.
 *
 *   npm run simulate                 # 1M base spins + 100k bought bonuses
 *   npm run simulate -- 5000000 42   # custom spin count and seed
 */
import { BONUS_BUY_COST, FREE_SPINS } from '../src/math/config';
import { playBonus, playSpin } from '../src/math/engine';
import { createRng } from '../src/math/rng';

const spins = Number(process.argv[2] ?? 1_000_000);
const seed = Number(process.argv[3] ?? 1);
const bonusBuys = Math.max(10_000, Math.floor(spins / 10));
const bet = 100; // 1.00 in cents

const rng = createRng(seed);
const started = performance.now();

let baseWin = 0;
let bonusWin = 0;
let hits = 0;
let bonuses = 0;
let maxWin = 0;
// Sum of squares for volatility (standard deviation per spin, in bets).
let sumSquares = 0;

for (let i = 0; i < spins; i++) {
  const outcome = playSpin(rng, bet, 'base');
  let roundWin = outcome.totalWin;
  baseWin += outcome.totalWin;
  if (outcome.freeSpinsAwarded > 0) {
    bonuses++;
    const bonus = playBonus(rng, bet, outcome.freeSpinsAwarded);
    bonusWin += bonus.totalWin;
    roundWin += bonus.totalWin;
  }
  if (roundWin > 0) hits++;
  maxWin = Math.max(maxWin, roundWin);
  sumSquares += (roundWin / bet) ** 2;
}

let boughtWin = 0;
for (let i = 0; i < bonusBuys; i++) {
  boughtWin += playBonus(rng, bet, FREE_SPINS.awarded).totalWin;
}

const wagered = spins * bet;
const rtp = (baseWin + bonusWin) / wagered;
const meanPerSpin = rtp;
const stdDev = Math.sqrt(sumSquares / spins - meanPerSpin ** 2);
const avgBonus = boughtWin / bonusBuys / bet;
const pct = (n: number) => `${(n * 100).toFixed(2)}%`;

console.table({
  'Spins': spins.toLocaleString('en'),
  'Seed': seed,
  'RTP (total)': pct(rtp),
  '  from base game': pct(baseWin / wagered),
  '  from free spins': pct(bonusWin / wagered),
  'Hit rate': pct(hits / spins),
  'Bonus frequency': `1 in ${(spins / Math.max(bonuses, 1)).toFixed(0)}`,
  'Max win': `${(maxWin / bet).toFixed(0)}x`,
  'Std dev per spin': `${stdDev.toFixed(2)} bets`,
  'Avg bonus value': `${avgBonus.toFixed(2)}x`,
  'Bonus buy cost': `${BONUS_BUY_COST}x`,
  'Bonus buy RTP': pct(avgBonus / BONUS_BUY_COST),
  'Time': `${((performance.now() - started) / 1000).toFixed(1)}s`,
});
