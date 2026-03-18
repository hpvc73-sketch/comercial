import { describe, expect, it } from "vitest";
import { canTradeByCooldown, computeRiskScore } from "./monitorMath";

describe("monitorMath", () => {
  it("computes weighted risk score", () => {
    expect(
      computeRiskScore({
        buySpeed: 20,
        walletConcentration: 40,
        curveBehavior: 30,
        earlyVolume: 10,
        earlyDumpSignals: 50,
      }),
    ).toBe(31.3);
  });

  it("applies cooldown", () => {
    const now = 100_000;
    expect(canTradeByCooldown(undefined, 60, now)).toBe(true);
    expect(canTradeByCooldown(now - 20_000, 30, now)).toBe(false);
    expect(canTradeByCooldown(now - 31_000, 30, now)).toBe(true);
  });
});
