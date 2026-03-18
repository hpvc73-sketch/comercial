import { ConfirmationStatus, DataSource, DiscoveryStatus } from "./types";

export interface LiveTokenState {
  mintAddress: string;
  symbol: string;
  name: string;
  source: DataSource;
  discoveryStatus: DiscoveryStatus;
  confirmationStatus: ConfirmationStatus;
  createdAt: number;
  tokenCreatedAt: number | null;
  tokenAgeSource: "provider" | "chain" | "estimated" | "unknown";
  updatedAt: number;
  priceUsd: number | null;
  volumeUsd: number | null;
  buys: number;
  sells: number;
  traders: Set<string>;
  buyerWallets: Set<string>;
  traderVolumeUsd: Map<string, number>;
  buyTimestamps: number[];
  sellTimestamps: number[];
  recentTrades: Array<{
    timestamp: number;
    side: "buy" | "sell";
    wallet?: string;
    usdAmount?: number;
    priceUsd?: number;
    tokenAmount?: number;
    solAmount?: number;
  }>;
  pumpPortalTradeCount: number;
  parsedTradeCount: number;
  lifecycle: "discovered" | "enriched" | "tradable";
  enrichmentWarning?: string;
  detectedAtBySource: Map<DataSource, number>;
  firstDetectedSource: DataSource;
  firstDetectedAt: number;
}

export class LiveStateStore {
  private tokens = new Map<string, LiveTokenState>();

  getOrCreate(mintAddress: string, defaults: Partial<LiveTokenState> & { source: DataSource; timestamp: number }): LiveTokenState {
    const existing = this.tokens.get(mintAddress);
    if (existing) return existing;

    const token: LiveTokenState = {
      mintAddress,
      symbol: defaults.symbol ?? "UNKNOWN",
      name: defaults.name ?? defaults.symbol ?? "Unknown Token",
      source: defaults.source,
      discoveryStatus: defaults.discoveryStatus ?? "discovered",
      confirmationStatus: defaults.confirmationStatus ?? "unconfirmed",
      createdAt: defaults.timestamp,
      tokenCreatedAt: defaults.tokenCreatedAt ?? null,
      tokenAgeSource: defaults.tokenCreatedAt ? "provider" : "unknown",
      updatedAt: defaults.timestamp,
      priceUsd: defaults.priceUsd ?? null,
      volumeUsd: defaults.volumeUsd ?? null,
      buys: 0,
      sells: 0,
      traders: new Set<string>(),
      buyerWallets: new Set<string>(),
      traderVolumeUsd: new Map<string, number>(),
      buyTimestamps: [],
      sellTimestamps: [],
      recentTrades: [],
      pumpPortalTradeCount: 0,
      parsedTradeCount: 0,
      lifecycle: "discovered",
      detectedAtBySource: new Map<DataSource, number>([[defaults.source, defaults.timestamp]]),
      firstDetectedSource: defaults.source,
      firstDetectedAt: defaults.timestamp,
    };

    this.tokens.set(mintAddress, token);
    return token;
  }

  all(): LiveTokenState[] {
    return Array.from(this.tokens.values());
  }
}
