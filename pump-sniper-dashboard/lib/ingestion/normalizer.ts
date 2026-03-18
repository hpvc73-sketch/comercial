import { UnifiedTokenEvent } from "./types";

export function normalizePumpPortalPayload(payload: Record<string, unknown>, eventType: UnifiedTokenEvent["eventType"]): UnifiedTokenEvent | null {
  const mintAddress =
    (typeof payload.mint === "string" && payload.mint) ||
    (typeof payload.mintAddress === "string" && payload.mintAddress) ||
    (typeof payload.ca === "string" && payload.ca) ||
    "";

  if (!mintAddress) return null;

  const symbol = typeof payload.symbol === "string" ? payload.symbol : undefined;
  const name = typeof payload.name === "string" ? payload.name : symbol;
  const txType = typeof payload.txType === "string" ? payload.txType.toLowerCase() : "";
  const buysDelta = txType.includes("buy") ? 1 : 0;
  const sellsDelta = txType.includes("sell") ? 1 : 0;

  return {
    eventId: `${eventType}:${mintAddress}:${payload.signature ?? payload.timestamp ?? Date.now()}`,
    source: "pumpportal",
    eventType,
    mintAddress,
    symbol,
    name,
    timestamp: Date.now(),
    discoveryStatus: eventType === "migrated" ? "migrated" : "discovered",
    confirmationStatus: "unconfirmed",
    priceUsd: Number(payload.priceUsd ?? payload.price ?? 0) || undefined,
    volumeUsd: Number(payload.usdAmount ?? 0) || undefined,
    buysDelta,
    sellsDelta,
    trader:
      (typeof payload.traderPublicKey === "string" && payload.traderPublicKey) ||
      (typeof payload.user === "string" && payload.user) ||
      undefined,
  };
}
