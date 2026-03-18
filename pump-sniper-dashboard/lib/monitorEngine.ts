import { EventEmitter } from "node:events";
import { canTradeByCooldown, computeRiskScore } from "./monitorMath";
import { MonitorSettings, MonitorState, Position, Signal, TokenSnapshot, TradeResult } from "./monitorTypes";
import { EventDeduplicator } from "./ingestion/deduplicator";
import { HealthMonitor } from "./ingestion/healthMonitor";
import { LiveStateStore } from "./ingestion/liveStateStore";
import { PumpPortalAdapter } from "./ingestion/adapters/pumpPortalAdapter";
import { SolanaRpcAdapter } from "./ingestion/adapters/solanaRpcAdapter";
import { HeliusGrpcAdapter } from "./ingestion/adapters/heliusGrpcAdapter";
import { SourceAdapter, UnifiedTokenEvent } from "./ingestion/types";

const DEFAULT_SETTINGS: MonitorSettings = {
  paperBankrollUsd: 5000,
  strategy: {
    enabled: true,
    minBuysPerSecond: 2,
    maxRiskScore: 45,
    minVolumeUsd: 4000,
    entryUsdSize: 100,
    takeProfitPct: 18,
    stopLossPct: 10,
    trailingStopPct: 8,
    cooldownSeconds: 120,
    maxTradesPerHour: 8,
  },
};

class MonitorEngine extends EventEmitter {
  private state: MonitorState;
  private dedup = new EventDeduplicator(45_000);
  private healthMonitor = new HealthMonitor();
  private store = new LiveStateStore();
  private adapters: SourceAdapter[] = [];

  private cooldownByMint = new Map<string, number>();
  private tradeTimestamps: number[] = [];

  private staleTimer?: NodeJS.Timeout;
  private lastDebugLogAt = 0;

  constructor() {
    super();

    this.state = {
      connected: false,
      lastEventAt: Date.now(),
      dataMode: "unavailable",
      dataWarning: "A ligar às fontes live...",
      tokens: [],
      signals: [],
      positions: [],
      tradeHistory: [],
      logs: [],
      settings: DEFAULT_SETTINGS,
      balances: { paperUsd: DEFAULT_SETTINGS.paperBankrollUsd },
      metrics: {
        date: new Date().toISOString().slice(0, 10),
        totalSignals: 0,
        paperTrades: 0,
        wins: 0,
        losses: 0,
        realizedPnlPaper: 0,
      },
    };
  }

  getState(): MonitorState {
    return this.state;
  }

  start() {
    if (this.adapters.length > 0) return;

    const solanaWs = process.env.SOLANA_RPC_WS_URL ?? "wss://api.mainnet-beta.solana.com";
    const heliusWs = process.env.HELIUS_GRPC_WS_URL;

    const pumpPortal = new PumpPortalAdapter();
    const solanaRpc = new SolanaRpcAdapter(solanaWs);
    const helius = new HeliusGrpcAdapter(heliusWs);

    this.adapters = [pumpPortal, solanaRpc, helius];
    this.adapters.forEach((adapter) => adapter.start((event) => this.onUnifiedEvent(event)));

    this.staleTimer = setInterval(() => this.markStaleTokens(), 15_000);
    this.staleTimer.unref();

    this.log("Ingestão multi-source iniciada (pumpportal + solana-rpc + helius-grpc opcional)");
  }

  updateSettings(next: Partial<MonitorSettings>) {
    this.state.settings = {
      ...this.state.settings,
      ...next,
      strategy: { ...this.state.settings.strategy, ...next.strategy },
    };

    if (typeof next.paperBankrollUsd === "number") this.state.balances.paperUsd = next.paperBankrollUsd;

    this.log("Configuração atualizada");
    this.emitUpdate();
  }

  private onUnifiedEvent(event: UnifiedTokenEvent) {
    if (this.dedup.isDuplicate(event.eventId)) return;

    this.adapters.forEach((adapter) => this.healthMonitor.update(adapter.getHealth()));

    if (event.eventType === "health") {
      this.updateHealthState();
      return;
    }

    if (!event.mintAddress) return;

    const token = this.store.getOrCreate(event.mintAddress, {
      source: event.source,
      timestamp: event.timestamp,
      symbol: event.symbol,
      name: event.name,
      discoveryStatus: event.discoveryStatus,
      confirmationStatus: event.confirmationStatus,
      priceUsd: event.priceUsd,
      volumeUsd: event.volumeUsd,
    });

    token.updatedAt = event.timestamp;
    if (event.symbol) token.symbol = event.symbol;
    if (event.name) token.name = event.name;
    token.source = event.source;

    if (event.discoveryStatus) token.discoveryStatus = event.discoveryStatus;
    if (event.eventType === "migrated") token.discoveryStatus = "migrated";

    if (event.confirmationStatus === "confirmed" || event.eventType === "confirmed") token.confirmationStatus = "confirmed";

    if (event.volumeUsd) token.volumeUsd += event.volumeUsd;
    if (event.priceUsd && event.priceUsd > 0) token.priceUsd = event.priceUsd;
    if (event.buysDelta) {
      token.buys += event.buysDelta;
      token.buyTimestamps.push(event.timestamp);
    }
    if (event.sellsDelta) token.sells += event.sellsDelta;
    if (event.trader) {
      token.traders.add(event.trader);
      const current = token.traderVolumeUsd.get(event.trader) ?? 0;
      token.traderVolumeUsd.set(event.trader, current + (event.volumeUsd ?? 0));
    }

    const cutoff = Date.now() - 10_000;
    token.buyTimestamps = token.buyTimestamps.filter((ts) => ts >= cutoff);

    // Register on-chain confirmation watchers for discovered tokens.
    if (token.confirmationStatus !== "confirmed") {
      this.adapters.forEach((adapter) => adapter.registerMint?.(token.mintAddress));
    }

    this.refreshStateFromStore();

    const snapshot = this.state.tokens.find((item) => item.mintAddress === token.mintAddress);
    if (snapshot?.confirmationStatus === "confirmed") {
      this.evaluateSignal(snapshot);
      this.updatePositions(snapshot);
    }

    this.state.lastEventAt = Date.now();
    this.updateHealthState();
    this.emitUpdate();
  }

  private refreshStateFromStore() {
    const tokens = this.store
      .all()
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 120)
      .map<TokenSnapshot>((token) => {
        const buysPerSecond = Number((token.buyTimestamps.length / 10).toFixed(2));
        const curveSlope = Number((buysPerSecond * 1.2 - token.sells * 0.4).toFixed(2));

        const totalTraderVolume = Array.from(token.traderVolumeUsd.values()).reduce((sum, value) => sum + value, 0);
        const topTraderVolume = token.traderVolumeUsd.size > 0 ? Math.max(...token.traderVolumeUsd.values()) : 0;

        const hasConcentrationData = totalTraderVolume > 0 && token.traderVolumeUsd.size >= 2;
        const topWalletShare = hasConcentrationData
          ? Number(((topTraderVolume / totalTraderVolume) * 100).toFixed(2))
          : null;

        const hasRiskInputs = token.volumeUsd > 0 && token.traders.size >= 2 && token.buyTimestamps.length > 0;
        const riskFactors = hasRiskInputs
          ? {
              buySpeed: Math.max(0, 100 - buysPerSecond * 12),
              walletConcentration: topWalletShare ?? 50,
              curveBehavior: Math.min(100, Math.max(0, 50 - curveSlope * 3)),
              earlyVolume: Math.max(0, 100 - token.volumeUsd / 400),
              earlyDumpSignals: Math.min(100, token.sells * 10),
            }
          : null;

        const riskScore = riskFactors ? computeRiskScore(riskFactors) : null;

        return {
          mintAddress: token.mintAddress,
          source: token.source,
          discoveryStatus: token.discoveryStatus,
          confirmationStatus: token.confirmationStatus,
          symbol: token.symbol,
          name: token.name,
          createdAt: token.createdAt,
          ageSeconds: Math.floor((Date.now() - token.createdAt) / 1000),
          price: Number((token.priceUsd || 0).toFixed(8)),
          volumeUsd: Number(token.volumeUsd.toFixed(2)),
          buysPerSecond,
          uniqueWallets: token.traders.size,
          topWalletShare,
          curveSlope,
          dumpEvents: token.sells,
          riskFactors,
          riskScore,
        };
      });

    this.state.tokens = tokens;

    if (tokens.length >= 2 && Date.now() - this.lastDebugLogAt > 20_000) {
      this.lastDebugLogAt = Date.now();
      const [a, b] = tokens;
      this.log(
        `DEBUG metrics ${a.symbol}:${a.mintAddress.slice(0, 6)} risk=${a.riskScore ?? "N/A"} conc=${a.topWalletShare ?? "N/A"} | ${b.symbol}:${b.mintAddress.slice(0, 6)} risk=${b.riskScore ?? "N/A"} conc=${b.topWalletShare ?? "N/A"}`,
      );
    }
  }

  private updateHealthState() {
    const health = this.healthMonitor.snapshot();
    const liveConnected = health.some((entry) => entry.connected && entry.source === "pumpportal");
    const premiumConnected = health.some((entry) => entry.connected && entry.source === "helius-grpc");

    this.state.connected = health.some((entry) => entry.connected);
    this.state.dataMode = liveConnected || premiumConnected ? "live" : "unavailable";
    this.state.dataWarning = this.healthMonitor.combinedWarning();
  }

  private markStaleTokens() {
    const staleCutoff = Date.now() - 120_000;
    for (const token of this.store.all()) {
      if (token.updatedAt < staleCutoff && token.discoveryStatus !== "migrated") {
        token.discoveryStatus = "stale";
      }
    }
    this.refreshStateFromStore();
    this.emitUpdate();
  }

  private evaluateSignal(token: TokenSnapshot) {
    const { strategy } = this.state.settings;
    if (!strategy.enabled) return;

    this.tradeTimestamps = this.tradeTimestamps.filter((ts) => Date.now() - ts < 3600_000);

    const lastTradeAt = this.cooldownByMint.get(token.mintAddress);
    const isCooldown = !canTradeByCooldown(lastTradeAt, strategy.cooldownSeconds, Date.now());

    const shouldBuy =
      token.buysPerSecond >= strategy.minBuysPerSecond &&
      token.riskScore !== null &&
      token.riskScore <= strategy.maxRiskScore &&
      token.volumeUsd >= strategy.minVolumeUsd &&
      !isCooldown &&
      this.tradeTimestamps.length < strategy.maxTradesPerHour;

    if (!shouldBuy) return;

    const signal: Signal = {
      id: crypto.randomUUID(),
      mintAddress: token.mintAddress,
      tokenSymbol: token.symbol,
      tokenName: token.name,
      side: "buy",
      reason: `buy/s ${token.buysPerSecond.toFixed(2)}, risco ${(token.riskScore ?? 0).toFixed(0)}, vol ${token.volumeUsd.toFixed(0)}`,
      confidence: Math.max(1, 100 - (token.riskScore ?? 100)),
      createdAt: Date.now(),
      buysPerSecond: token.buysPerSecond,
      riskScore: token.riskScore ?? null,
      volumeUsd: token.volumeUsd,
      source: token.source,
      confirmationStatus: token.confirmationStatus,
    };

    this.state.signals = [signal, ...this.state.signals.filter((entry) => entry.id !== signal.id)].slice(0, 30);
    this.state.metrics.totalSignals += 1;

    this.openPaperPosition(token, signal.reason);

    this.cooldownByMint.set(token.mintAddress, Date.now());
    this.tradeTimestamps.push(Date.now());
  }

  private openPaperPosition(token: TokenSnapshot, reason: string) {
    const size = this.state.settings.strategy.entryUsdSize;
    if (this.state.balances.paperUsd < size) return;

    const quantity = size / Math.max(token.price, 0.0000001);
    const position: Position = {
      id: crypto.randomUUID(),
      mintAddress: token.mintAddress,
      tokenSymbol: token.symbol,
      tokenName: token.name,
      entryPrice: token.price,
      quantity,
      entryAt: Date.now(),
      highestPrice: token.price,
      stopLoss: token.price * (1 - this.state.settings.strategy.stopLossPct / 100),
      takeProfit: token.price * (1 + this.state.settings.strategy.takeProfitPct / 100),
      trailingStopPct: this.state.settings.strategy.trailingStopPct,
    };

    this.state.positions.push(position);
    this.state.balances.paperUsd -= size;

    this.recordTrade({
      id: crypto.randomUUID(),
      mintAddress: token.mintAddress,
      tokenSymbol: token.symbol,
      tokenName: token.name,
      side: "buy",
      price: token.price,
      quantity,
      pnlUsd: 0,
      reason,
      timestamp: Date.now(),
    });
    this.state.metrics.paperTrades += 1;
  }

  private updatePositions(token: TokenSnapshot) {
    const toClose = this.state.positions.filter((position) => {
      if (position.mintAddress !== token.mintAddress) return false;
      position.highestPrice = Math.max(position.highestPrice, token.price);
      if (position.trailingStopPct) {
        const trailing = position.highestPrice * (1 - position.trailingStopPct / 100);
        position.stopLoss = Math.max(position.stopLoss, trailing);
      }
      return token.price <= position.stopLoss || token.price >= position.takeProfit;
    });

    toClose.forEach((position) => this.closePosition(position, token));
  }

  private closePosition(position: Position, token: TokenSnapshot) {
    this.state.positions = this.state.positions.filter((entry) => entry.id !== position.id);

    const entry = position.entryPrice * position.quantity;
    const exit = token.price * position.quantity;
    const pnl = exit - entry;

    this.state.balances.paperUsd += exit;
    this.state.metrics.realizedPnlPaper += pnl;
    if (pnl >= 0) this.state.metrics.wins += 1;
    else this.state.metrics.losses += 1;

    this.recordTrade({
      id: crypto.randomUUID(),
      mintAddress: position.mintAddress,
      tokenSymbol: position.tokenSymbol,
      tokenName: position.tokenName,
      side: "sell",
      price: token.price,
      quantity: position.quantity,
      pnlUsd: pnl,
      reason: pnl >= 0 ? "Take profit" : "Stop loss",
      timestamp: Date.now(),
    });
  }

  private recordTrade(trade: TradeResult) {
    this.state.tradeHistory.unshift(trade);
    this.state.tradeHistory = this.state.tradeHistory.slice(0, 200);
  }

  private log(message: string) {
    this.state.logs.unshift(`[${new Date().toLocaleTimeString("pt-PT")}] ${message}`);
    this.state.logs = this.state.logs.slice(0, 200);
  }

  private emitUpdate() {
    this.emit("update", this.state);
  }
}

const singleton = new MonitorEngine();

export function getMonitorEngine() {
  singleton.start();
  return singleton;
}
