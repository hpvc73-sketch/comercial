import { RiskFactors } from "./monitorTypes";

export function computeRiskScore(factors: RiskFactors): number {
  return Number(
    (
      factors.buySpeed * 0.22 +
      factors.walletConcentration * 0.25 +
      factors.curveBehavior * 0.18 +
      factors.earlyVolume * 0.15 +
      factors.earlyDumpSignals * 0.2
    ).toFixed(2),
  );
}

export function canTradeByCooldown(lastTradeAt: number | undefined, cooldownSeconds: number, now: number): boolean {
  if (!lastTradeAt) return true;
  return now - lastTradeAt >= cooldownSeconds * 1000;
}
