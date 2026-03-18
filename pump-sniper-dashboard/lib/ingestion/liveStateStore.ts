import { ConfirmationStatus, DataSource, DiscoveryStatus } from "./types";

export interface LiveTokenState {
  mintAddress: string;
  symbol: string;
  name: string;
  source: DataSource;
  discoveryStatus: DiscoveryStatus;
  confirmationStatus: ConfirmationStatus;
  createdAt: number;
  updatedAt: number;
  priceUsd: number;
  volumeUsd: number;
  buys: number;
  sells: number;
  traders: Set<string>;
  buyTimestamps: number[];
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
      updatedAt: defaults.timestamp,
      priceUsd: defaults.priceUsd ?? 0,
      volumeUsd: defaults.volumeUsd ?? 0,
      buys: 0,
      sells: 0,
      traders: new Set<string>(),
      buyTimestamps: [],
    };

    this.tokens.set(mintAddress, token);
    return token;
  }

  all(): LiveTokenState[] {
    return Array.from(this.tokens.values());
  }
}
