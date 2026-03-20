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

function readTimestampMs(payload: Record<string, unknown>, keys: string[]): number | undefined {
  const value = readNumber(payload, keys);
  if (!value || !Number.isFinite(value)) return undefined;
  if (value < 1_000_000_000_000) return Math.floor(value * 1000);
  return Math.floor(value);
}

function readString(payload: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

export function normalizePumpPortalPayload(payload: Record<string, unknown>, eventType: UnifiedTokenEvent["eventType"]): UnifiedTokenEvent | null {
  const mintAddress =
    (typeof payload.mint === "string" && payload.mint) ||
    (typeof payload.mintAddress === "string" && payload.mintAddress) ||
    (typeof payload.tokenAddress === "string" && payload.tokenAddress) ||
    (typeof payload.address === "string" && payload.address) ||
    (typeof payload.ca === "string" && payload.ca) ||
    "";

  if (!mintAddress) return null;

  const symbol =
    readString(payload, ["symbol", "tokenSymbol", "ticker", "baseSymbol", "baseTokenSymbol"]) ??
    (readString(payload, ["name", "tokenName"]) ? readString(payload, ["name", "tokenName"]) : undefined);
  const name =
    readString(payload, ["name", "tokenName", "baseName", "baseTokenName", "projectName"]) ??
    symbol;
  const uri = readString(payload, ["uri", "tokenUri", "image", "imageUrl"]);
  const metadataUri = readString(payload, ["metadataUri", "metadataURI", "metaUri", "metadata_url"]);
  const creator = readString(payload, ["creator", "creatorAddress", "dev", "deployer", "owner"]);
  const signature = readString(payload, ["signature", "sig", "txSignature", "txHash"]);
  const trader =
    readString(payload, ["traderPublicKey", "trader", "user", "wallet", "owner", "buyer", "seller"]);
  const txType = typeof payload.txType === "string" ? payload.txType.toLowerCase() : "";
  const isBuy = txType.includes("buy");
  const isSell = txType.includes("sell");
  const buysDelta = isBuy ? 1 : 0;
  const sellsDelta = isSell ? 1 : 0;
  const priceUsd = readNumber(payload, ["priceUsd", "price", "usdPrice"]);
  const usdAmount = readNumber(payload, ["usdAmount", "volumeUsd", "amountUsd", "notionalUsd"]);
  const tokenAmount = readNumber(payload, ["tokenAmount", "amountTokens", "tokensOut", "tokensIn"]);
  const solAmount = readNumber(payload, ["solAmount", "amountSol", "solIn", "solOut"]);
  const tokenCreatedAt = readTimestampMs(payload, ["tokenCreatedAt", "createdAt", "createdTimestamp", "mintedAt", "time"]);
  const pairCreatedAt = readTimestampMs(payload, ["pairCreatedAt", "poolCreatedAt", "liquidityCreatedAt", "pairCreatedTimestamp"]);
  const eventTimestamp =
    readTimestampMs(payload, ["timestamp", "time", "blockTime", "createdAt", "tokenCreatedAt"]) ??
    Date.now();

  return {
    eventId: `${eventType}:${mintAddress}:${signature ?? eventTimestamp}`,
    source: "pumpportal",
    eventType,
    mintAddress,
    symbol,
    name,
    uri,
    metadataUri,
    creator,
    signature,
    timestamp: eventTimestamp,
    tokenCreatedAt,
    pairCreatedAt,
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
    trader,
  };
}
