import { EventEmitter } from "node:events";
import { canTradeByCooldown, computeRiskScore } from "./monitorMath";
import { MonitorSettings, MonitorState, Position, Signal, TokenSnapshot, TradeResult } from "./monitorTypes";

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

type TokenRuntime = {
  token: TokenSnapshot;
  buyTimestamps: number[];
  knownWallets: Set<string>;
  updatedAt: number;
};

function safeNumber(value: unknown, fallback = 0): number {
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function safeString(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function looksLikeMint(value: string): boolean {
  return value.length >= 32 && value.length <= 64;
}

class MonitorEngine extends EventEmitter {
  private state: MonitorState;
  private ws: WebSocket | null = null;
  private reconnectTimer?: NodeJS.Timeout;
  private heartbeatTimer?: NodeJS.Timeout;

  private tokenRuntime = new Map<string, TokenRuntime>();
  private cooldownByMint = new Map<string, number>();
  private tradeTimestamps: number[] = [];

  constructor() {
    super();
    this.state = {
      connected: false,
      lastEventAt: Date.now(),
      dataMode: "unavailable",
      dataWarning: "A ligar ao feed live de Pump.fun/Solana...",
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
    if (this.ws) return;
    this.connectLiveFeed();
  }

  updateSettings(next: Partial<MonitorSettings>) {
    this.state.settings = {
      ...this.state.settings,
      ...next,
      strategy: { ...this.state.settings.strategy, ...next.strategy },
    };

    if (typeof next.paperBankrollUsd === "number") {
      this.state.balances.paperUsd = next.paperBankrollUsd;
    }

    this.log("Configuração atualizada");
    this.emitUpdate();
  }

  private connectLiveFeed() {
    try {
      this.log("A ligar websocket live: wss://pumpportal.fun/api/data");
      this.state.dataMode = "unavailable";
      this.state.dataWarning = "A ligar ao feed live...";
      this.emitUpdate();

      this.ws = new WebSocket("wss://pumpportal.fun/api/data");

      this.ws.addEventListener("open", () => {
        this.state.connected = true;
        this.state.dataMode = "live";
        this.state.dataWarning = undefined;
        this.log("Feed LIVE ligado.");

        this.ws?.send(JSON.stringify({ method: "subscribeNewToken" }));
        this.ws?.send(JSON.stringify({ method: "subscribeMigration" }));

        this.setupHeartbeat();
        this.emitUpdate();
      });

      this.ws.addEventListener("message", (event) => {
        const raw = typeof event.data === "string" ? event.data : "";
        if (!raw) return;

        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          return;
        }

        this.processLivePayload(payload);
      });

      this.ws.addEventListener("close", () => {
        this.log("Feed LIVE desligado, a tentar reconectar...");
        this.state.connected = false;
        this.state.dataMode = "unavailable";
        this.state.dataWarning = "Sem ligação ao feed live. Nenhum token simulado será criado.";
        this.cleanupConnection();
        this.scheduleReconnect();
        this.emitUpdate();
      });

      this.ws.addEventListener("error", () => {
        this.log("Erro no websocket do feed LIVE.");
      });
    } catch (error) {
      this.log(`Falha ao ligar feed live: ${(error as Error).message}`);
      this.state.dataMode = "unavailable";
      this.state.dataWarning = "Falha de ligação ao feed live. Nenhum token simulado será criado.";
      this.scheduleReconnect();
      this.emitUpdate();
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.connectLiveFeed();
    }, 3000);
    this.reconnectTimer.unref();
  }

  private setupHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);

    this.heartbeatTimer = setInterval(() => {
      const staleMs = Date.now() - this.state.lastEventAt;
      if (staleMs > 20_000) {
        this.state.dataWarning = "Feed live sem eventos recentes. A aguardar novos dados reais.";
        this.emitUpdate();
      }
    }, 5000);
    this.heartbeatTimer.unref();
  }

  private cleanupConnection() {
    this.ws = null;
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }

  private processLivePayload(payload: Record<string, unknown>) {
    const mintAddress = this.extractMintAddress(payload);
    if (!mintAddress) return;

    const symbol = safeString(payload.symbol, safeString(payload.ticker, "UNKNOWN"));
    const name = safeString(payload.name, symbol || "Unknown Token");
    const txType = safeString(payload.txType, safeString(payload.type, ""));

    const runtime = this.getOrCreateTokenRuntime(mintAddress, symbol, name, payload);

    const solAmount = safeNumber(payload.solAmount, safeNumber(payload.sol_amount, 0));
    const usdAmount = safeNumber(payload.usdAmount, solAmount * 170);
    const tokenAmount = safeNumber(payload.tokenAmount, safeNumber(payload.token_amount, 0));
    const wallet = safeString(payload.traderPublicKey, safeString(payload.user, safeString(payload.owner, "")));

    runtime.token.symbol = symbol || runtime.token.symbol;
    runtime.token.name = name || runtime.token.name;

    // price fallback based on trade amounts; keep previous price if cannot infer.
    if (solAmount > 0 && tokenAmount > 0) {
      const price = usdAmount > 0 ? usdAmount / tokenAmount : (solAmount * 170) / tokenAmount;
      if (Number.isFinite(price) && price > 0) runtime.token.price = Number(price.toFixed(8));
    }

    if (usdAmount > 0) runtime.token.volumeUsd = Number((runtime.token.volumeUsd + usdAmount).toFixed(2));

    if (wallet) runtime.knownWallets.add(wallet);
    runtime.token.uniqueWallets = Math.max(runtime.token.uniqueWallets, runtime.knownWallets.size);

    if (txType.toLowerCase().includes("buy")) {
      runtime.buyTimestamps.push(Date.now());
    }

    if (txType.toLowerCase().includes("sell")) {
      runtime.token.dumpEvents += 1;
    }

    const cutoff = Date.now() - 10_000;
    runtime.buyTimestamps = runtime.buyTimestamps.filter((ts) => ts >= cutoff);
    runtime.token.buysPerSecond = Number((runtime.buyTimestamps.length / 10).toFixed(2));

    runtime.token.ageSeconds = Math.max(0, Math.floor((Date.now() - runtime.token.createdAt) / 1000));
    runtime.token.curveSlope = Number((runtime.token.buysPerSecond * 1.4 - runtime.token.dumpEvents * 0.8).toFixed(2));

    runtime.token.riskFactors = {
      buySpeed: Math.max(0, 100 - runtime.token.buysPerSecond * 12),
      walletConcentration: Math.min(100, Math.max(10, 85 - runtime.token.uniqueWallets / 3)),
      curveBehavior: Math.min(100, Math.max(0, 50 - runtime.token.curveSlope * 3)),
      earlyVolume: Math.max(0, 100 - runtime.token.volumeUsd / 400),
      earlyDumpSignals: Math.min(100, runtime.token.dumpEvents * 15),
    };
    runtime.token.riskScore = computeRiskScore(runtime.token.riskFactors);

    runtime.updatedAt = Date.now();
    this.tokenRuntime.set(mintAddress, runtime);

    this.state.tokens = Array.from(this.tokenRuntime.values())
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((item) => item.token)
      .slice(0, 120);

    this.evaluateSignal(runtime.token);
    this.updatePositions(runtime.token);

    this.state.lastEventAt = Date.now();
    this.state.dataMode = "live";
    this.state.dataWarning = undefined;
    this.emitUpdate();
  }

  private getOrCreateTokenRuntime(
    mintAddress: string,
    symbol: string,
    name: string,
    payload: Record<string, unknown>,
  ): TokenRuntime {
    const existing = this.tokenRuntime.get(mintAddress);
    if (existing) return existing;

    const firstPrice = safeNumber(payload.priceUsd, safeNumber(payload.price, 0));
    const now = Date.now();

    const created: TokenRuntime = {
      token: {
        mintAddress,
        symbol: symbol || "UNKNOWN",
        name: name || symbol || "Unknown Token",
        createdAt: now,
        ageSeconds: 0,
        price: firstPrice > 0 ? firstPrice : 0.000001,
        volumeUsd: 0,
        buysPerSecond: 0,
        uniqueWallets: 0,
        topWalletShare: 0,
        curveSlope: 0,
        dumpEvents: 0,
        riskFactors: {
          buySpeed: 50,
          walletConcentration: 50,
          curveBehavior: 50,
          earlyVolume: 50,
          earlyDumpSignals: 50,
        },
        riskScore: 50,
      },
      buyTimestamps: [],
      knownWallets: new Set<string>(),
      updatedAt: now,
    };

    return created;
  }

  private extractMintAddress(payload: Record<string, unknown>): string | null {
    const candidates = [
      safeString(payload.mint),
      safeString(payload.mintAddress),
      safeString(payload.tokenAddress),
      safeString(payload.ca),
      safeString(payload.address),
    ];

    const mint = candidates.find((candidate) => looksLikeMint(candidate));
    return mint || null;
  }

  private evaluateSignal(token: TokenSnapshot) {
    const { strategy } = this.state.settings;
    if (!strategy.enabled) return;

    this.tradeTimestamps = this.tradeTimestamps.filter((ts) => Date.now() - ts < 3600_000);

    const lastTradeAt = this.cooldownByMint.get(token.mintAddress);
    const isCooldown = !canTradeByCooldown(lastTradeAt, strategy.cooldownSeconds, Date.now());

    const shouldBuy =
      token.buysPerSecond >= strategy.minBuysPerSecond &&
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
      reason: `buy/s ${token.buysPerSecond.toFixed(2)}, risco ${token.riskScore.toFixed(0)}, vol ${token.volumeUsd.toFixed(0)}`,
      confidence: Math.max(1, 100 - token.riskScore),
      createdAt: Date.now(),
      buysPerSecond: token.buysPerSecond,
      riskScore: token.riskScore,
      volumeUsd: token.volumeUsd,
    };

    this.state.signals = [signal, ...this.state.signals.filter((entry) => entry.id !== signal.id)].slice(0, 30);
    this.state.metrics.totalSignals += 1;

    this.openPaperPosition(token, signal.reason);

    this.cooldownByMint.set(token.mintAddress, Date.now());
    this.tradeTimestamps.push(Date.now());
  }

  private openPaperPosition(token: TokenSnapshot, reason: string) {
    const size = this.state.settings.strategy.entryUsdSize;
    if (this.state.balances.paperUsd < size) {
      this.log(`Saldo paper insuficiente: ${token.symbol}`);
      return;
    }

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
    const toClose: Position[] = [];

    for (const position of this.state.positions) {
      if (position.mintAddress !== token.mintAddress) continue;
      position.highestPrice = Math.max(position.highestPrice, token.price);

      if (position.trailingStopPct) {
        const trailing = position.highestPrice * (1 - position.trailingStopPct / 100);
        position.stopLoss = Math.max(position.stopLoss, trailing);
      }

      if (token.price <= position.stopLoss || token.price >= position.takeProfit) toClose.push(position);
    }

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
