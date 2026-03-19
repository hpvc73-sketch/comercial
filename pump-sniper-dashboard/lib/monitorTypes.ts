export interface RiskFactors {
  buySpeed: number;
  walletConcentration: number;
  curveBehavior: number;
  earlyVolume: number;
  earlyDumpSignals: number;
}

export type ProviderSource = "pumpportal" | "solana-rpc" | "helius-rpc" | "helius-grpc";

export interface TokenSnapshot {
  mintAddress: string;
  source: ProviderSource;
  firstDetectedSource: ProviderSource;
  sourceLatencyMs: Record<string, number>;
  discoveryStatus: "discovered" | "migrated" | "stale";
  confirmationStatus: "unconfirmed" | "confirmed";
  lifecycle: "discovered" | "enriching" | "enriched" | "tradable" | "rejected" | "expired";
  sniperReady: boolean;
  parsedTradeCount: number;
  isValidPumpCandidate: boolean;
  symbol: string;
  name: string;
  firstSeenTimestamp: number;
  tokenCreatedAt: number | null;
  pairCreatedAt: number | null;
  firstTradeAt: number | null;
  createdAt: number;
  ageSeconds: number | null;
  realTokenAgeSeconds: number | null;
  realAgeQuality: "exact" | "estimated" | "unknown";
  ageSource: "launch" | "first-trade" | "on-chain" | "provider" | "estimated" | "unknown";
  seenByBotAgeSeconds: number;
  freshness: "fresh" | "aging" | "late" | "unknown";
  lastMetricUpdateAt: number;
  price: number | null;
  volume5s: number | null;
  volume15s: number | null;
  volume30s: number | null;
  volumeUsd: number | null;
  buys5s: number;
  buys15s: number;
  buys30s: number;
  buysPerSecond15s: number | null;
  buysPerSecond: number | null;
  parsedTradesTotal: number;
  parsedBuysTotal: number;
  parsedSellsTotal: number;
  confidenceLevel: number;
  signalScore: number;
  liquidityEstimate: number | null;
  rejectionReason?: string;
  sourceConfidence: "single-source" | "dual-source";
  metadataSource: ProviderSource;
  sourceCategory: "pumpportal" | "merged" | "helius-enriched";
  visibleInMain: boolean;
  uniqueWallets: number | null;
  uniqueBuyers30s: number;
  uniqueTraders30s: number;
  dataQuality: "low" | "partial" | "complete";
  topWalletShare: number | null;
  curveSlope: number;
  dumpEvents: number;
  riskFactors: RiskFactors | null;
  riskScore: number | null;
}

export interface Signal {
  id: string;
  category: "discovered" | "watch-candidate" | "trade-ready";
  mintAddress: string;
  source: ProviderSource;
  confirmationStatus: "unconfirmed" | "confirmed";
  tokenSymbol: string;
  tokenName: string;
  side: "buy" | "sell";
  reason: string;
  confidence: number;
  createdAt: number;
  buysPerSecond: number | null;
  riskScore: number | null;
  volumeUsd: number | null;
  price: number | null;
  parsedTradeCount: number;
  score: number;
  suggestedAction: "ignore" | "watch" | "buy";
}

export interface Position {
  id: string;
  mintAddress: string;
  tokenSymbol: string;
  tokenName: string;
  entryPrice: number;
  quantity: number;
  entryAt: number;
  highestPrice: number;
  stopLoss: number;
  takeProfit: number;
  trailingStopPct?: number;
}

export interface TradeResult {
  id: string;
  mintAddress: string;
  tokenSymbol: string;
  tokenName: string;
  side: "buy" | "sell";
  price: number;
  quantity: number;
  pnlUsd: number;
  reason: string;
  timestamp: number;
}

export interface DailyMetrics {
  date: string;
  totalSignals: number;
  paperTrades: number;
  wins: number;
  losses: number;
  realizedPnlPaper: number;
}

export interface StrategyConfig {
  enabled: boolean;
  minBuysPerSecond: number;
  maxRiskScore: number;
  minVolumeUsd: number;
  entryUsdSize: number;
  takeProfitPct: number;
  stopLossPct: number;
  trailingStopPct?: number;
  cooldownSeconds: number;
  maxTradesPerHour: number;
  executionMode?: "disabled" | "paper" | "live_manual_confirm" | "live_auto";
}

export interface MonitorSettings {
  paperBankrollUsd: number;
  strategy: StrategyConfig;
}

export type DataMode = "live" | "mock" | "unavailable";

export interface SourceHealthView {
  source: ProviderSource;
  connected: boolean;
  warning?: string;
  lastEventAt?: number;
}

export interface Diagnostics {
  detectedEnv: string[];
  providersInitialized: string[];
  providersSkipped: string[];
}

export interface MonitorState {
  connected: boolean;
  lastEventAt: number;
  dataMode: DataMode;
  dataWarning?: string;
  sourceHealth: SourceHealthView[];
  diagnostics: Diagnostics;
  tokens: TokenSnapshot[];
  signals: Signal[];
  positions: Position[];
  tradeHistory: TradeResult[];
  logs: string[];
  metrics: DailyMetrics;
  settings: MonitorSettings;
  balances: { paperUsd: number };
  streamStats: {
    receivedSinceStartup: number;
    receivedLast60s: number;
    lastTokenReceivedAt: number;
    lastLiveUpdateAt: number;
  };
}
