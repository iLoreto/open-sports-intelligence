/** Pure illustration math for the UI. Quotes are not executable orders. */
export function modeledRoi(ask: number, feePerContract: number | null, netEvPerContract: number | null): number | null {
  if (feePerContract === null || netEvPerContract === null || !Number.isFinite(ask) ||
      !Number.isFinite(feePerContract) || !Number.isFinite(netEvPerContract)) return null;
  const cost = ask + feePerContract;
  return cost > 0 ? netEvPerContract / cost : null;
}

/** Assumes the existing 100-contract illustrative fee rate scales linearly. */
export function estimateModelStake(ask: number, feePerContract: number | null,
  netEvPerContract: number | null, budget: number): {
    contracts: number; cost: number; ifWin: number; ifLose: number; modelExpected: number;
  } | null {
  const roi = modeledRoi(ask, feePerContract, netEvPerContract);
  if (roi === null || feePerContract === null || netEvPerContract === null ||
      !Number.isFinite(budget) || budget < 0) return null;
  const unitCost = ask + feePerContract;
  const contracts = Math.min(100000, Math.floor(budget / unitCost));
  const cost = contracts * unitCost;
  return { contracts, cost, ifWin: contracts - cost, ifLose: -cost,
    modelExpected: contracts * netEvPerContract };
}

/** Two opposing contracts in the SAME binary Kalshi market; gross only. */
export function calculatePairQuote(yesAsk: number | null, noAsk: number | null, quantity: number): {
    costPerPair: number; gap: number; totalCost: number; grossProfit: number;
  } | null {
  if (yesAsk === null || noAsk === null || !Number.isFinite(yesAsk) || !Number.isFinite(noAsk) ||
      !(yesAsk > 0 && yesAsk < 1) || !(noAsk > 0 && noAsk < 1) ||
      !Number.isInteger(quantity) || quantity < 1 || quantity > 10000) return null;
  const costPerPair = yesAsk + noAsk;
  const gap = 1 - costPerPair;
  return { costPerPair, gap, totalCost: quantity * costPerPair, grossProfit: quantity * gap };
}
