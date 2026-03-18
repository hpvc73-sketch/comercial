export type DataSource = "pumpportal" | "solana-rpc" | "helius-grpc";
export type DiscoveryStatus = "discovered" | "migrated" | "stale";
export type ConfirmationStatus = "unconfirmed" | "confirmed";

export interface UnifiedTokenEvent {
  eventId: string;
  source: DataSource;
  eventType: "discovered" | "trade" | "migrated" | "confirmed" | "health";
  mintAddress?: string;
  symbol?: string;
  name?: string;
  timestamp: number;
  discoveryStatus?: DiscoveryStatus;
  confirmationStatus?: ConfirmationStatus;
  priceUsd?: number;
  volumeUsd?: number;
  buysDelta?: number;
  sellsDelta?: number;
  trader?: string;
  warning?: string;
}

export interface SourceHealth {
  source: DataSource;
  connected: boolean;
  lastEventAt?: number;
  warning?: string;
}

export interface SourceAdapter {
  readonly source: DataSource;
  start(onEvent: (event: UnifiedTokenEvent) => void): void;
  stop(): void;
  registerMint?(mintAddress: string): void;
  getHealth(): SourceHealth;
}
