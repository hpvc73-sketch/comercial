export interface RiskFactors {
  buySpeed: number;
  walletConcentration: number;
  curveBehavior: number;
  earlyVolume: number;
  earlyDumpSignals: number;
}

export interface TokenSnapshot {
  mintAddress: string;
  source: "pumpportal" | "solana-rpc" | "helius-grpc";
  discoveryStatus: "discovered" | "migrated" | "stale";
  confirmationStatus: "unconfirmed" | "confirmed";
  symbol: string;
  name: string;
  createdAt: number;
  ageSeconds: number;
  price: number;
  volumeUsd: number;
  buysPerSecond: number;
  uniqueWallets: number;
  topWalletShare: number;
  curveSlope: number;
  dumpEvents: number;
  riskFactors: RiskFactors;
  riskScore: number;
}

export interface Signal {
  id: string;
  mintAddress: string;
  source: "pumpportal" | "solana-rpc" | "helius-grpc";
  confirmationStatus: "unconfirmed" | "confirmed";
  tokenSymbol: string;
  tokenName: string;
  side: "buy" | "sell";
  reason: string;
  confidence: number;
  createdAt: number;
  buysPerSecond: number;
  riskScore: number;
  volumeUsd: number;
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
}

export interface MonitorSettings {
  paperBankrollUsd: number;
  strategy: StrategyConfig;
}

export type DataMode = "live" | "mock" | "unavailable";

export interface MonitorState {
  connected: boolean;
  lastEventAt: number;
  dataMode: DataMode;
  dataWarning?: string;
  tokens: TokenSnapshot[];
  signals: Signal[];
  positions: Position[];
  tradeHistory: TradeResult[];
  logs: string[];
  metrics: DailyMetrics;
  settings: MonitorSettings;
  balances: { paperUsd: number };
}
