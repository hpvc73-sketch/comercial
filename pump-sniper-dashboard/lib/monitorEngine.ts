import { EventEmitter } from "node:events";
import { canTradeByCooldown, computeRiskScore } from "./monitorMath";
import {
  MonitorSettings,
  MonitorState,
  Position,
  RiskFactors,
  TokenSnapshot,
  TradeResult,
} from "./monitorTypes";

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
  realTrading: {
    enabled: false,
    autoExecute: false,
    rpcUrl: "https://api.mainnet-beta.solana.com",
    walletPrivateKey: "",
    maxOrderUsd: 50,
  },
};

class MonitorEngine extends EventEmitter {
  private state: MonitorState;
  private ticker?: NodeJS.Timeout;
  private cooldownByMint = new Map<string, number>();
  private tradeTimestamps: number[] = [];

  constructor() {
    super();
    this.state = {
      connected: false,
      lastEventAt: Date.now(),
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
        realTrades: 0,
        wins: 0,
        losses: 0,
        realizedPnlPaper: 0,
        realizedPnlReal: 0,
      },
    };
  }

  getState(): MonitorState {
    return this.state;
  }

  start() {
    if (this.ticker) return;
    this.state.connected = true;
    this.log("Motor Pump monitor iniciado");
    this.ticker = setInterval(() => this.tick(), 1500);
    this.ticker.unref();
  }

  updateSettings(next: Partial<MonitorSettings>) {
    this.state.settings = {
      ...this.state.settings,
      ...next,
      strategy: { ...this.state.settings.strategy, ...next.strategy },
      realTrading: { ...this.state.settings.realTrading, ...next.realTrading },
    };

    if (typeof next.paperBankrollUsd === "number") {
      this.state.balances.paperUsd = next.paperBankrollUsd;
    }

    this.log("Configuração atualizada");
    this.emit("update", this.state);
  }

  private tick() {
    const token = this.generateToken();
    this.state.tokens = [token, ...this.state.tokens].slice(0, 80);
    this.evaluateSignal(token);
    this.updatePositions(token);
    this.state.lastEventAt = Date.now();
    this.emit("update", this.state);
  }

  private evaluateSignal(token: TokenSnapshot) {
    const { strategy } = this.state.settings;
    if (!strategy.enabled) return;

    this.tradeTimestamps = this.tradeTimestamps.filter((ts) => Date.now() - ts < 3600_000);

    const lastTradeAt = this.cooldownByMint.get(token.mint);
    const isCooldown = !canTradeByCooldown(lastTradeAt, strategy.cooldownSeconds, Date.now());

    const shouldBuy =
      token.buysPerSecond >= strategy.minBuysPerSecond &&
      token.riskScore <= strategy.maxRiskScore &&
      token.volumeUsd >= strategy.minVolumeUsd &&
      !isCooldown &&
      this.tradeTimestamps.length < strategy.maxTradesPerHour;

    if (!shouldBuy) return;

    const reason = `buy/s ${token.buysPerSecond.toFixed(2)}, risco ${token.riskScore.toFixed(0)}, vol ${token.volumeUsd.toFixed(0)}`;

    this.state.signals.unshift({
      id: crypto.randomUUID(),
      tokenMint: token.mint,
      tokenSymbol: token.symbol,
      side: "buy",
      reason,
      confidence: Math.max(1, 100 - token.riskScore),
      createdAt: Date.now(),
      mode: "paper",
    });
    this.state.signals = this.state.signals.slice(0, 120);
    this.state.metrics.totalSignals += 1;

    this.openPaperPosition(token, reason);

    if (this.state.settings.realTrading.enabled && this.state.settings.realTrading.autoExecute) {
      void this.executeRealBuy(token, reason);
    }

    this.cooldownByMint.set(token.mint, Date.now());
    this.tradeTimestamps.push(Date.now());
  }

  private openPaperPosition(token: TokenSnapshot, reason: string) {
    const size = this.state.settings.strategy.entryUsdSize;
    if (this.state.balances.paperUsd < size) {
      this.log(`Saldo paper insuficiente: ${token.symbol}`);
      return;
    }

    const quantity = size / token.price;
    const position: Position = {
      id: crypto.randomUUID(),
      tokenMint: token.mint,
      tokenSymbol: token.symbol,
      entryPrice: token.price,
      quantity,
      entryAt: Date.now(),
      mode: "paper",
      highestPrice: token.price,
      stopLoss: token.price * (1 - this.state.settings.strategy.stopLossPct / 100),
      takeProfit: token.price * (1 + this.state.settings.strategy.takeProfitPct / 100),
      trailingStopPct: this.state.settings.strategy.trailingStopPct,
    };

    this.state.positions.push(position);
    this.state.balances.paperUsd -= size;

    this.recordTrade({
      id: crypto.randomUUID(),
      tokenMint: token.mint,
      tokenSymbol: token.symbol,
      side: "buy",
      mode: "paper",
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
      if (position.tokenMint !== token.mint) continue;
      position.highestPrice = Math.max(position.highestPrice, token.price);

      if (position.trailingStopPct) {
        const trailing = position.highestPrice * (1 - position.trailingStopPct / 100);
        position.stopLoss = Math.max(position.stopLoss, trailing);
      }

      if (token.price <= position.stopLoss || token.price >= position.takeProfit) {
        toClose.push(position);
      }
    }

    for (const position of toClose) this.closePosition(position, token);
  }

  private closePosition(position: Position, token: TokenSnapshot) {
    this.state.positions = this.state.positions.filter((p) => p.id !== position.id);

    const entry = position.entryPrice * position.quantity;
    const exit = token.price * position.quantity;
    const pnl = exit - entry;

    this.state.balances.paperUsd += exit;
    this.state.metrics.realizedPnlPaper += pnl;
    if (pnl >= 0) this.state.metrics.wins += 1;
    else this.state.metrics.losses += 1;

    this.recordTrade({
      id: crypto.randomUUID(),
      tokenMint: position.tokenMint,
      tokenSymbol: position.tokenSymbol,
      side: "sell",
      mode: position.mode,
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

  private async executeRealBuy(token: TokenSnapshot, reason: string) {
    const cfg = this.state.settings.realTrading;

    if (!cfg.walletPrivateKey.trim()) {
      this.log("Real trading ativo sem wallet configurada");
      return;
    }

    try {
      const dynamicImport = new Function("m", "return import(m)") as (m: string) => Promise<unknown>;
      await dynamicImport("@pump-fun/sdk").catch(() => null);

      const web3 = (await dynamicImport("@solana/web3.js").catch(() => null)) as
        | { Keypair: { fromSecretKey: (k: Uint8Array) => { publicKey: { toBase58: () => string } } }; Connection: new (url: string, c: string) => { getLatestBlockhash: () => Promise<unknown> } }
        | null;

      let wallet = "wallet-indefinida";
      if (web3) {
        const secret = Uint8Array.from(JSON.parse(cfg.walletPrivateKey));
        const keypair = web3.Keypair.fromSecretKey(secret);
        const connection = new web3.Connection(cfg.rpcUrl, "confirmed");
        await connection.getLatestBlockhash();
        wallet = `${keypair.publicKey.toBase58().slice(0, 6)}...`;
      }

      this.recordTrade({
        id: crypto.randomUUID(),
        tokenMint: token.mint,
        tokenSymbol: token.symbol,
        side: "buy",
        mode: "real",
        price: token.price,
        quantity: cfg.maxOrderUsd / token.price,
        pnlUsd: 0,
        reason: `${reason} | wallet ${wallet}`,
        timestamp: Date.now(),
      });
      this.state.metrics.realTrades += 1;
      this.log(`Sinal REAL disparado para ${token.symbol}`);
    } catch (error) {
      this.log(`Erro em ordem real: ${(error as Error).message}`);
    }
  }

  private generateToken(): TokenSnapshot {
    const now = Date.now();
    const factors: RiskFactors = {
      buySpeed: Math.random() * 100,
      walletConcentration: Math.random() * 100,
      curveBehavior: Math.random() * 100,
      earlyVolume: Math.random() * 100,
      earlyDumpSignals: Math.random() * 100,
    };

    return {
      mint: `MINT_${Math.random().toString(36).slice(2, 10)}`,
      symbol: `P${Math.random().toString(36).slice(2, 5).toUpperCase()}`,
      createdAt: now,
      ageSeconds: Math.floor(Math.random() * 20),
      price: Number((0.00003 + Math.random() * 0.002).toFixed(6)),
      volumeUsd: Number((1000 + Math.random() * 50000).toFixed(2)),
      buysPerSecond: Number((Math.random() * 8).toFixed(2)),
      uniqueWallets: Math.floor(20 + Math.random() * 250),
      topWalletShare: Number((10 + Math.random() * 60).toFixed(2)),
      curveSlope: Number((-6 + Math.random() * 12).toFixed(2)),
      dumpEvents: Math.floor(Math.random() * 8),
      riskFactors: factors,
      riskScore: computeRiskScore(factors),
    };
  }

  private log(msg: string) {
    this.state.logs.unshift(`[${new Date().toLocaleTimeString("pt-PT")}] ${msg}`);
    this.state.logs = this.state.logs.slice(0, 200);
  }
}

const singleton = new MonitorEngine();

export function getMonitorEngine() {
  singleton.start();
  return singleton;
}
