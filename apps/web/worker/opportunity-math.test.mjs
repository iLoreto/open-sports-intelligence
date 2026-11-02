import assert from 'node:assert/strict';
import test from 'node:test';
import { calculatePairQuote, estimateModelStake, modeledRoi } from '../src/app/opportunity-math.ts';

test('Kalshi same-market YES and NO quotes show only gross pairing math', () => {
  const pair = calculatePairQuote(0.48, 0.49, 100);
  assert.ok(pair);
  assert.ok(Math.abs(pair.costPerPair - 0.97) < 1e-9);
  assert.ok(Math.abs(pair.grossProfit - 3) < 1e-9);
  const losingPair = calculatePairQuote(0.52, 0.51, 100);
  assert.ok(losingPair && losingPair.grossProfit < 0);
});

test('pair checker refuses absent or invalid quotes and quantity', () => {
  assert.equal(calculatePairQuote(null, 0.49, 100), null);
  assert.equal(calculatePairQuote(0.48, 1.01, 100), null);
  assert.equal(calculatePairQuote(0.48, 0.49, 0), null);
  assert.equal(calculatePairQuote(0.48, 0.49, 2.5), null);
});

test('stake estimates expose both outcomes and model expectation', () => {
  const plan = estimateModelStake(0.49, 0.01, 0.03, 80);
  assert.ok(plan);
  assert.equal(plan.contracts, 160);
  assert.ok(Math.abs(plan.cost - 80) < 1e-9);
  assert.ok(Math.abs(plan.ifWin - 80) < 1e-9);
  assert.ok(Math.abs(plan.ifLose + 80) < 1e-9);
  assert.ok(Math.abs(plan.modelExpected - 4.8) < 1e-9);
  assert.ok(Math.abs(modeledRoi(0.49, 0.01, 0.03) - 0.06) < 1e-9);
});

test('missing fee terms never become a fabricated net estimate', () => {
  assert.equal(estimateModelStake(0.49, null, 0.03, 80), null);
  assert.equal(estimateModelStake(0.49, 0.01, null, 80), null);
  assert.equal(modeledRoi(0.49, null, 0.03), null);
});
