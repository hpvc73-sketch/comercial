export type TradingMode = "paper" | "real";

export interface RiskFactors {
  buySpeed: number;
  walletConcentration: number;
  curveBehavior: number;
  earlyVolume: number;
  earlyDumpSignals: number;
}

export interface TokenSnapshot {
  mint: string;
  symbol: string;
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
  tokenMint: string;
  tokenSymbol: string;
  side: "buy" | "sell";
  reason: string;
  confidence: number;
  createdAt: number;
  mode: TradingMode;
}

export interface Position {
  id: string;
  tokenMint: string;
  tokenSymbol: string;
  entryPrice: number;
  quantity: number;
  entryAt: number;
  mode: TradingMode;
  highestPrice: number;
  stopLoss: number;
  takeProfit: number;
  trailingStopPct?: number;
}

export interface TradeResult {
  id: string;
  tokenMint: string;
  tokenSymbol: string;
  side: "buy" | "sell";
  mode: TradingMode;
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
  realTrades: number;
  wins: number;
  losses: number;
  realizedPnlPaper: number;
  realizedPnlReal: number;
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

export interface RealTradingConfig {
  enabled: boolean;
  autoExecute: boolean;
  rpcUrl: string;
  walletPrivateKey: string;
  maxOrderUsd: number;
}

export interface MonitorSettings {
  paperBankrollUsd: number;
  strategy: StrategyConfig;
  realTrading: RealTradingConfig;
  filters: {
    minRisk: number;
    maxRisk: number;
  };
}

export interface MonitorState {
  connected: boolean;
  lastEventAt: number;
  tokens: TokenSnapshot[];
  signals: Signal[];
  positions: Position[];
  tradeHistory: TradeResult[];
  logs: string[];
  metrics: DailyMetrics;
  settings: MonitorSettings;
  balances: {
    paperUsd: number;
  };
}
