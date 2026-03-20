export type DataSource = "pumpportal" | "solana-rpc" | "helius-rpc" | "helius-grpc";
export type DiscoveryStatus = "discovered" | "migrated" | "stale";
export type ConfirmationStatus = "unconfirmed" | "confirmed";

export interface UnifiedTokenEvent {
  eventId: string;
  source: DataSource;
  eventType: "discovered" | "trade" | "liquidity" | "migrated" | "confirmed" | "health";
  mintAddress?: string;
  symbol?: string;
  name?: string;
  uri?: string;
  metadataUri?: string;
  creator?: string;
  signature?: string;
  timestamp: number;
  tokenCreatedAt?: number;
  pairCreatedAt?: number;
  discoveryStatus?: DiscoveryStatus;
  confirmationStatus?: ConfirmationStatus;
  priceUsd?: number;
  volumeUsd?: number;
  tradeUsd?: number;
  tradeTokenAmount?: number;
  tradeSolAmount?: number;
  tradeSide?: "buy" | "sell";
  buysDelta?: number;
  sellsDelta?: number;
  trader?: string;
  warning?: string;
}

export interface SourceHealth {
  source: DataSource;
  connected: boolean;
  enabled?: boolean;
  lastEventAt?: number;
  lastMessageAt?: number;
  lastRealEventAt?: number;
  lastRealEventAgeSeconds?: number;
  wsReadyState?: number;
  reconnectCount?: number;
  reconnectReason?: string;
  state?: "idle" | "connecting" | "connected" | "stale" | "reconnecting" | "stopped" | "errored";
  fallbackMode?: boolean;
  warning?: string;
}

export interface SourceAdapter {
  readonly source: DataSource;
  start(onEvent: (event: UnifiedTokenEvent) => void): void;
  stop(): void;
  registerMint?(mintAddress: string): void;
  getHealth(): SourceHealth;
}
