import { UnifiedTokenEvent } from "./types";

function readNumber(payload: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

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
  const isBuy = txType.includes("buy");
  const isSell = txType.includes("sell");
  const buysDelta = isBuy ? 1 : 0;
  const sellsDelta = isSell ? 1 : 0;
  const priceUsd = readNumber(payload, ["priceUsd", "price", "usdPrice"]);
  const usdAmount = readNumber(payload, ["usdAmount", "volumeUsd", "amountUsd", "notionalUsd"]);
  const tokenAmount = readNumber(payload, ["tokenAmount", "amountTokens", "tokensOut", "tokensIn"]);
  const solAmount = readNumber(payload, ["solAmount", "amountSol", "solIn", "solOut"]);

  return {
    eventId: `${eventType}:${mintAddress}:${payload.signature ?? payload.timestamp ?? Date.now()}`,
    source: "pumpportal",
    eventType,
    mintAddress,
    symbol,
    name,
    timestamp: Date.now(),
    discoveryStatus: eventType === "migrated" ? "migrated" : eventType === "discovered" ? "discovered" : undefined,
    confirmationStatus: "unconfirmed",
    priceUsd,
    volumeUsd: usdAmount,
    tradeUsd: usdAmount,
    tradeTokenAmount: tokenAmount,
    tradeSolAmount: solAmount,
    tradeSide: isBuy ? "buy" : isSell ? "sell" : undefined,
    buysDelta,
    sellsDelta,
    trader:
      (typeof payload.traderPublicKey === "string" && payload.traderPublicKey) ||
      (typeof payload.user === "string" && payload.user) ||
      undefined,
  };
}
