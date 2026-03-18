import { EventEmitter } from "node:events";
import { canTradeByCooldown, computeRiskScore } from "./monitorMath";
import { MonitorSettings, MonitorState, Position, Signal, TokenSnapshot, TradeResult } from "./monitorTypes";
import { EventDeduplicator } from "./ingestion/deduplicator";
import { HealthMonitor } from "./ingestion/healthMonitor";
import { LiveStateStore, LiveTokenState } from "./ingestion/liveStateStore";
import { PumpPortalAdapter } from "./ingestion/adapters/pumpPortalAdapter";
import { SolanaRpcAdapter } from "./ingestion/adapters/solanaRpcAdapter";
import { HeliusGrpcAdapter } from "./ingestion/adapters/heliusGrpcAdapter";
import { SourceAdapter, UnifiedTokenEvent } from "./ingestion/types";

const BLOCKED_ADDRESSES = new Set([
  "11111111111111111111111111111111",
  "ComputeBudget111111111111111111111111111111",
  "SysvarRent111111111111111111111111111111111",
  "SysvarC1ock11111111111111111111111111111111",
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  "ATokenGPvR93Af2U4f2S7jH9MuNoMNFkQJUon2cRPn7A",
]);
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const BUY_WINDOW_MS = 5_000;
const MAX_RECENT_TRADES = 120;
const MIN_UNIQUE_WALLETS_FOR_ENTRY = 20;
const HARD_MAX_TOKEN_AGE_SECONDS = 120;
const FRESH_TOKEN_AGE_SECONDS = 30;

const DEFAULT_SETTINGS: MonitorSettings = {
  paperBankrollUsd: 5000,
  strategy: {
    enabled: true,
    minBuysPerSecond: 2.5,
    maxRiskScore: 45,
    minVolumeUsd: 2000,
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
  private streamStallTimer?: NodeJS.Timeout;
  private lastDebugLogAt = 0;
  private heliusRpcUrl?: string;
  private enrichmentInFlight = new Set<string>();
  private lastHeliusPlanWarningAt = 0;
  private streamEventTimestamps: number[] = [];
  private lastStallWarningAt = 0;
  private staleAgeWarned = new Set<string>();
  private lastAgeSourceLog = new Map<string, string>();

  constructor() {
    super();

    this.state = {
      connected: false,
      lastEventAt: Date.now(),
      dataMode: "unavailable",
      dataWarning: "A ligar às fontes live...",
      sourceHealth: [],
      diagnostics: { detectedEnv: [], providersInitialized: [], providersSkipped: [] },
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
      streamStats: {
        receivedSinceStartup: 0,
        receivedLast60s: 0,
        lastTokenReceivedAt: Date.now(),
        lastLiveUpdateAt: Date.now(),
      },
    };
  }

  getState(): MonitorState {
    return this.state;
  }

  start() {
    if (this.adapters.length > 0) return;

    const detectedEnv = ["SOLANA_RPC_URL", "SOLANA_WS_URL", "HELIUS_API_KEY", "HELIUS_RPC_URL", "HELIUS_WS_URL", "HELIUS_GRPC_WS_URL", "PUMPFUN_PROGRAM_ID"]
      .filter((key) => Boolean(process.env[key]));

    const heliusRpcUrl =
      process.env.HELIUS_RPC_URL ??
      (process.env.HELIUS_API_KEY ? `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}` : undefined);
    this.heliusRpcUrl = heliusRpcUrl;

    const solanaRpcUrl =
      process.env.SOLANA_RPC_URL ??
      heliusRpcUrl ??
      "https://mainnet.helius-rpc.com/?api-key=243e2279-93a7-4c94-835d-3d71155b03d0";
    const solanaWsUrl = process.env.SOLANA_WS_URL ?? undefined;

    const heliusWs =
      process.env.HELIUS_WS_URL ??
      process.env.HELIUS_GRPC_WS_URL ??
      (process.env.HELIUS_API_KEY ? `wss://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}` : undefined);

    const pumpProgramId = process.env.PUMPFUN_PROGRAM_ID ?? "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";

    const useHeliusAsPrimary = solanaRpcUrl.includes("helius");

    const pumpPortal = new PumpPortalAdapter();
    const solanaRpc = new SolanaRpcAdapter(solanaRpcUrl, pumpProgramId, useHeliusAsPrimary ? "helius-rpc" : "solana-rpc", solanaWsUrl);

    this.adapters = [pumpPortal, solanaRpc];

    if (process.env.HELIUS_GRPC_WS_URL) {
      const heliusGrpc = new HeliusGrpcAdapter(process.env.HELIUS_GRPC_WS_URL, pumpProgramId);
      this.adapters.push(heliusGrpc);
      this.state.diagnostics.providersInitialized.push("helius-grpc");
    } else {
      this.state.diagnostics.providersSkipped.push("helius-grpc (not configured)");
    }

    this.state.diagnostics.detectedEnv = detectedEnv;
    this.state.diagnostics.providersInitialized.push("pumpportal", useHeliusAsPrimary ? "helius-rpc" : "solana-rpc");

    this.adapters.forEach((adapter) => adapter.start((event) => this.onUnifiedEvent(event)));

    this.staleTimer = setInterval(() => this.markStaleTokens(), 15_000);
    this.staleTimer.unref();
    this.streamStallTimer = setInterval(() => this.detectStreamStall(), 20_000);
    this.streamStallTimer.unref();

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

  private validatePumpCandidate(event: UnifiedTokenEvent): { ok: boolean; reason?: string } {
    const mint = event.mintAddress ?? "";
    if (!BASE58_RE.test(mint)) return { ok: false, reason: "invalid mint" };
    if (BLOCKED_ADDRESSES.has(mint)) {
      if (mint.startsWith("ComputeBudget")) return { ok: false, reason: "program id" };
      if (mint === "11111111111111111111111111111111") return { ok: false, reason: "system account" };
      return { ok: false, reason: "non-pump candidate" };
    }
    if (event.source === "pumpportal") return { ok: true };

    const plausibleBySuffix = mint.endsWith("pump");
    if (!plausibleBySuffix) return { ok: false, reason: "non-pump candidate" };

    return { ok: true };
  }

  private onUnifiedEvent(event: UnifiedTokenEvent) {
    if (this.dedup.isDuplicate(event.eventId)) return;

    this.adapters.forEach((adapter) => this.healthMonitor.update(adapter.getHealth()));

    if (event.eventType === "health") {
      if (event.warning) this.log(event.warning);
      this.updateHealthState();
      return;
    }

    if (!event.mintAddress) return;
    this.streamEventTimestamps.push(Date.now());
    this.streamEventTimestamps = this.streamEventTimestamps.filter((ts) => Date.now() - ts <= 60_000);
    this.state.streamStats.receivedSinceStartup += 1;
    this.state.streamStats.receivedLast60s = this.streamEventTimestamps.length;
    this.state.streamStats.lastLiveUpdateAt = Date.now();
    this.state.streamStats.lastTokenReceivedAt = Date.now();

    const candidate = this.validatePumpCandidate(event);
    if (!candidate.ok) {
      this.log(`rejected: ${candidate.reason} ${event.mintAddress}`);
      return;
    }

    const token = this.store.getOrCreate(event.mintAddress, {
      source: event.source,
      timestamp: event.timestamp,
      tokenCreatedAt: event.tokenCreatedAt,
      pairCreatedAt: event.pairCreatedAt,
      symbol: event.symbol,
      name: event.name,
      discoveryStatus: event.discoveryStatus,
      confirmationStatus: event.confirmationStatus,
      priceUsd: event.priceUsd,
      volumeUsd: event.volumeUsd,
    });
    this.adapters.forEach((adapter) => adapter.registerMint?.(event.mintAddress as string));
    this.enrichFromHeliusIfNeeded(token.mintAddress);

    token.updatedAt = event.timestamp;
    if (event.symbol) token.symbol = event.symbol;
    if (event.name) token.name = event.name;
    token.source = event.source;

    const existingDetectedAt = token.detectedAtBySource.get(event.source);
    if (!existingDetectedAt) token.detectedAtBySource.set(event.source, event.timestamp);

    if (event.timestamp < token.firstDetectedAt) {
      token.firstDetectedAt = event.timestamp;
      token.firstDetectedSource = event.source;
    }
    if (event.tokenCreatedAt && event.tokenCreatedAt > 0) {
      token.tokenCreatedAt = token.tokenCreatedAt ? Math.min(token.tokenCreatedAt, event.tokenCreatedAt) : event.tokenCreatedAt;
      token.tokenAgeSource = "provider";
      this.log(`age-derivation token created at ${new Date(token.tokenCreatedAt).toISOString()} source=provider ${token.mintAddress}`);
    }
    if (event.pairCreatedAt && event.pairCreatedAt > 0) {
      token.pairCreatedAt = token.pairCreatedAt ? Math.min(token.pairCreatedAt, event.pairCreatedAt) : event.pairCreatedAt;
      if (!token.tokenCreatedAt || token.pairCreatedAt < token.tokenCreatedAt) token.tokenAgeSource = "pair";
      this.log(`age-derivation pair created at ${new Date(token.pairCreatedAt).toISOString()} ${token.mintAddress}`);
    }

    if (event.source === "pumpportal" && event.eventType === "discovered") {
      this.log(`token detected via pumpportal: ${token.symbol} ${token.mintAddress}`);
    }
    if (event.source === "solana-rpc" && event.eventType === "confirmed") {
      this.log(`token confirmed via solana logs: ${token.symbol} ${token.mintAddress}`);
      const pumpSeen = token.detectedAtBySource.get("pumpportal");
      const solSeen = token.detectedAtBySource.get("solana-rpc");
      if (pumpSeen && solSeen) {
        this.log(`latency difference (solana-rpc - pumpportal): ${solSeen - pumpSeen}ms for ${token.mintAddress}`);
      }
    }
    if (event.discoveryStatus) token.discoveryStatus = event.discoveryStatus;
    if (event.eventType === "migrated") token.discoveryStatus = "migrated";

    if (event.confirmationStatus === "confirmed" || event.eventType === "confirmed") token.confirmationStatus = "confirmed";

    const tradeUsd = event.tradeUsd ?? event.volumeUsd;
    const tradeSide = event.tradeSide ?? (event.buysDelta ? "buy" : event.sellsDelta ? "sell" : undefined);
    const isPumpPortalTrade = event.source === "pumpportal" && event.eventType === "trade";
    const canUseSecondary = token.pumpPortalTradeCount === 0;

    if (isPumpPortalTrade) token.pumpPortalTradeCount += 1;
    if (event.eventType === "trade") {
      token.firstTradeAt = token.firstTradeAt ? Math.min(token.firstTradeAt, event.timestamp) : event.timestamp;
      this.log(`age-derivation first trade at ${new Date(token.firstTradeAt).toISOString()} ${token.mintAddress}`);
    }
    const ageEvidence = this.deriveAgeEvidence(token);
    const ageLogKey = `${ageEvidence.source}:${ageEvidence.createdAt ?? "na"}`;
    if (this.lastAgeSourceLog.get(token.mintAddress) !== ageLogKey) {
      this.lastAgeSourceLog.set(token.mintAddress, ageLogKey);
      this.log(
        `age-derivation chosen source=${ageEvidence.source} value=${ageEvidence.createdAt ? new Date(ageEvidence.createdAt).toISOString() : "unknown"} ${token.mintAddress}`,
      );
    }

    const shouldApplyMetrics = isPumpPortalTrade || canUseSecondary;
    if (shouldApplyMetrics && event.priceUsd && event.priceUsd > 0) {
      token.priceUsd = event.priceUsd;
      this.log(`price updated ${token.symbol} ${token.mintAddress}: ${event.priceUsd.toFixed(8)}`);
    }
    if (shouldApplyMetrics && typeof tradeUsd === "number" && tradeUsd > 0) {
      token.volumeUsd = (token.volumeUsd ?? 0) + tradeUsd;
      this.log(`volume updated ${token.symbol} ${token.mintAddress}: ${token.volumeUsd.toFixed(2)} USD`);
    }
    if (shouldApplyMetrics && event.buysDelta) {
      token.buys += event.buysDelta;
      token.buyTimestamps.push(event.timestamp);
      this.log(`buy detected ${token.symbol} ${token.mintAddress}`);
    }
    if (shouldApplyMetrics && event.sellsDelta) token.sells += event.sellsDelta;
    if (shouldApplyMetrics && event.sellsDelta) token.sellTimestamps.push(event.timestamp);
    if (shouldApplyMetrics && event.trader) {
      token.traders.add(event.trader);
      if (tradeSide === "buy") {
        const preSize = token.buyerWallets.size;
        token.buyerWallets.add(event.trader);
        if (token.buyerWallets.size > preSize) {
          this.log(`wallet added ${token.symbol} ${token.mintAddress}: ${event.trader}`);
        }
      }
      const current = token.traderVolumeUsd.get(event.trader) ?? 0;
      token.traderVolumeUsd.set(event.trader, current + (tradeUsd ?? 0));
    }

    if (shouldApplyMetrics && tradeSide && (typeof tradeUsd === "number" || event.priceUsd || event.tradeTokenAmount || event.tradeSolAmount)) {
      token.recentTrades.push({
        timestamp: event.timestamp,
        side: tradeSide,
        wallet: event.trader,
        usdAmount: tradeUsd,
        priceUsd: event.priceUsd,
        tokenAmount: event.tradeTokenAmount,
        solAmount: event.tradeSolAmount,
      });
    }

    const cutoff = Date.now() - BUY_WINDOW_MS;
    token.buyTimestamps = token.buyTimestamps.filter((ts) => ts >= cutoff);
    token.sellTimestamps = token.sellTimestamps.filter((ts) => ts >= cutoff);
    token.recentTrades = token.recentTrades.filter((trade) => trade.timestamp >= Date.now() - 300_000).slice(-MAX_RECENT_TRADES);

    this.refreshStateFromStore();

    const snapshot = this.state.tokens.find((item) => item.mintAddress === token.mintAddress);
    if (snapshot) {
      this.upsertSignalForSnapshot(snapshot);
      if (snapshot.confirmationStatus === "confirmed") {
        this.evaluateSignal(snapshot);
        this.updatePositions(snapshot);
      }
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
        const now = Date.now();
        const windowStart = now - BUY_WINDOW_MS;
        const buysInWindow = token.buyTimestamps.filter((ts) => ts >= windowStart).length;
        const buysPerSecondRaw = buysInWindow / (BUY_WINDOW_MS / 1000);
        const buysPerSecond = buysInWindow > 0 ? Number(buysPerSecondRaw.toFixed(2)) : null;
        const curveSlope = Number(((buysPerSecond ?? 0) * 1.2 - token.sells * 0.4).toFixed(2));

        const totalTraderVolume = Array.from(token.traderVolumeUsd.values()).reduce((sum, value) => sum + value, 0);
        const topTraderVolume = token.traderVolumeUsd.size > 0 ? Math.max(...token.traderVolumeUsd.values()) : 0;

        const hasConcentrationData = totalTraderVolume > 0 && token.traderVolumeUsd.size >= 2;
        const topWalletShare = hasConcentrationData
          ? Number(((topTraderVolume / totalTraderVolume) * 100).toFixed(2))
          : null;

        const hasRiskInputs = token.volumeUsd !== null && token.volumeUsd > 0 && token.buyerWallets.size >= 2 && buysPerSecond !== null;
        const riskFactors = hasRiskInputs
          ? {
              buySpeed: Math.max(0, 100 - (buysPerSecond ?? 0) * 12),
              walletConcentration: topWalletShare ?? 50,
              curveBehavior: Math.min(100, Math.max(0, 50 - curveSlope * 3)),
              earlyVolume: Math.max(0, 100 - (token.volumeUsd ?? 0) / 400),
              earlyDumpSignals: Math.min(100, token.sells * 10),
            }
          : null;

        const riskScore = riskFactors ? computeRiskScore(riskFactors) : null;

        const sourceLatencyMs: Record<string, number> = {};
        for (const [source, ts] of token.detectedAtBySource.entries()) {
          sourceLatencyMs[source] = ts - token.firstDetectedAt;
        }

        const preferredSource = token.pumpPortalTradeCount > 0 ? "pumpportal" : token.firstDetectedSource;

        const { source: chosenAgeSource, createdAt: evidenceCreatedAt } = this.deriveAgeEvidence(token);
        const hasRealAge = typeof evidenceCreatedAt === "number";
        const qualitySignals = [
          token.priceUsd !== null,
          token.volumeUsd !== null,
          buysPerSecond !== null,
          token.buyerWallets.size > 0,
        ].filter(Boolean).length;
        const dataQuality: TokenSnapshot["dataQuality"] = qualitySignals >= 4 ? "complete" : qualitySignals >= 2 ? "partial" : "low";

        const realTokenAgeSeconds = hasRealAge ? Math.floor((now - (evidenceCreatedAt as number)) / 1000) : null;
        const seenByBotAgeSeconds = Math.floor((now - token.createdAt) / 1000);
        let freshness: TokenSnapshot["freshness"] = "unknown";
        if (realTokenAgeSeconds !== null) {
          freshness =
            realTokenAgeSeconds <= FRESH_TOKEN_AGE_SECONDS
              ? "fresh"
              : realTokenAgeSeconds <= HARD_MAX_TOKEN_AGE_SECONDS
                ? "aging"
                : "late";
        } else if (token.parsedTradeCount >= 3) {
          freshness = "late";
        }
        const realAgeQuality: TokenSnapshot["realAgeQuality"] =
          chosenAgeSource === "unknown" ? "unknown" : chosenAgeSource === "estimated" ? "estimated" : "exact";
        const lifecycle: TokenSnapshot["lifecycle"] =
          token.parsedTradeCount >= 1 && hasRealAge ? "tradable" : token.parsedTradeCount >= 1 ? "enriched" : "discovered";
        token.lifecycle = lifecycle;
        const sniperReady = lifecycle === "tradable" && realTokenAgeSeconds !== null && realTokenAgeSeconds <= HARD_MAX_TOKEN_AGE_SECONDS;
        if (realTokenAgeSeconds !== null && realTokenAgeSeconds > HARD_MAX_TOKEN_AGE_SECONDS && !this.staleAgeWarned.has(token.mintAddress)) {
          this.staleAgeWarned.add(token.mintAddress);
          this.log(`rejected as stale because of real age ${realTokenAgeSeconds}s source=${chosenAgeSource} ${token.mintAddress}`);
        }

        return {
          mintAddress: token.mintAddress,
          source: preferredSource,
          firstDetectedSource: token.firstDetectedSource,
          sourceLatencyMs,
          discoveryStatus: token.discoveryStatus,
          confirmationStatus: token.confirmationStatus,
          lifecycle,
          sniperReady,
          parsedTradeCount: token.parsedTradeCount,
          isValidPumpCandidate: true,
          symbol: token.symbol,
          name: token.name,
          firstSeenTimestamp: token.createdAt,
          tokenCreatedAt: token.tokenCreatedAt,
          pairCreatedAt: token.pairCreatedAt,
          firstTradeAt: token.firstTradeAt,
          createdAt: token.createdAt,
          ageSeconds: realTokenAgeSeconds,
          realTokenAgeSeconds,
          realAgeQuality,
          ageSource: chosenAgeSource,
          seenByBotAgeSeconds,
          freshness,
          lastMetricUpdateAt: token.updatedAt,
          price: token.priceUsd !== null ? Number(token.priceUsd.toFixed(8)) : null,
          volumeUsd: token.volumeUsd !== null ? Number(token.volumeUsd.toFixed(2)) : null,
          buysPerSecond,
          uniqueWallets: token.buyerWallets.size > 0 ? token.buyerWallets.size : null,
          dataQuality,
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
    this.state.sourceHealth = health.map((entry) => ({
      source: entry.source,
      connected: entry.connected,
      warning: entry.warning,
      lastEventAt: entry.lastEventAt,
    }));
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

  private detectStreamStall() {
    const secondsSinceToken = Math.floor((Date.now() - this.state.streamStats.lastTokenReceivedAt) / 1000);
    const hasAnyConnectedSource = this.state.sourceHealth.some((entry) => entry.connected);
    if (hasAnyConnectedSource && secondsSinceToken > 75 && Date.now() - this.lastStallWarningAt > 60_000) {
      this.lastStallWarningAt = Date.now();
      this.log(`warning: stream connected but no new tokens for ${secondsSinceToken}s`);
    }
  }

  private upsertSignalForSnapshot(token: TokenSnapshot) {
    const hasCoreMetrics = token.price !== null && token.volumeUsd !== null && token.riskScore !== null;
    const category: Signal["category"] =
      token.sniperReady && hasCoreMetrics ? "trade-ready" : token.parsedTradeCount > 0 ? "watch-candidate" : "discovered";

    const reason =
      category === "trade-ready"
        ? "trade-ready metrics satisfied"
        : category === "watch-candidate"
          ? "parsed trades detected, waiting full metrics"
          : "newly discovered token";

    const signal: Signal = {
      id: `${token.mintAddress}:${category}`,
      category,
      mintAddress: token.mintAddress,
      tokenSymbol: token.symbol,
      tokenName: token.name,
      side: "buy",
      reason,
      confidence: category === "trade-ready" ? Math.max(1, 100 - (token.riskScore ?? 100)) : 10,
      createdAt: Date.now(),
      buysPerSecond: token.buysPerSecond,
      riskScore: token.riskScore,
      volumeUsd: token.volumeUsd,
      price: token.price,
      parsedTradeCount: token.parsedTradeCount,
      source: token.source,
      confirmationStatus: token.confirmationStatus,
    };

    this.state.signals = [signal, ...this.state.signals.filter((entry) => entry.id !== signal.id)].slice(0, 30);
  }

  private evaluateSignal(token: TokenSnapshot) {
    const { strategy } = this.state.settings;
    if (!strategy.enabled) return;
    if (token.price === null || token.buysPerSecond === null || token.volumeUsd === null || token.uniqueWallets === null) return;

    this.tradeTimestamps = this.tradeTimestamps.filter((ts) => Date.now() - ts < 3600_000);

    const lastTradeAt = this.cooldownByMint.get(token.mintAddress);
    const isCooldown = !canTradeByCooldown(lastTradeAt, strategy.cooldownSeconds, Date.now());

    const shouldBuy =
      token.sniperReady &&
      token.buysPerSecond >= strategy.minBuysPerSecond &&
      token.riskScore !== null &&
      token.riskScore <= strategy.maxRiskScore &&
      token.confirmationStatus === "confirmed" &&
      token.volumeUsd >= strategy.minVolumeUsd &&
      token.uniqueWallets >= MIN_UNIQUE_WALLETS_FOR_ENTRY &&
      !isCooldown &&
      this.tradeTimestamps.length < strategy.maxTradesPerHour;

    if (!shouldBuy) return;

    const signal: Signal = {
      id: `${token.mintAddress}:trade-ready-action`,
      category: "trade-ready",
      mintAddress: token.mintAddress,
      tokenSymbol: token.symbol,
      tokenName: token.name,
      side: "buy",
      reason: `buy/s ${token.buysPerSecond.toFixed(2)}, risco ${(token.riskScore ?? 0).toFixed(0)}, vol ${token.volumeUsd.toFixed(0)}, wallets ${token.uniqueWallets}`,
      confidence: Math.max(1, 100 - (token.riskScore ?? 100)),
      createdAt: Date.now(),
      buysPerSecond: token.buysPerSecond,
      riskScore: token.riskScore ?? null,
      volumeUsd: token.volumeUsd,
      price: token.price,
      parsedTradeCount: token.parsedTradeCount,
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
    if (token.price === null || token.price <= 0) return;
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
    if (token.price === null || token.price <= 0) return;
    const tokenPrice = token.price;
    const toClose = this.state.positions.filter((position) => {
      if (position.mintAddress !== token.mintAddress) return false;
      position.highestPrice = Math.max(position.highestPrice, tokenPrice);
      if (position.trailingStopPct) {
        const trailing = position.highestPrice * (1 - position.trailingStopPct / 100);
        position.stopLoss = Math.max(position.stopLoss, trailing);
      }
      return tokenPrice <= position.stopLoss || tokenPrice >= position.takeProfit;
    });

    toClose.forEach((position) => this.closePosition(position, token));
  }

  private closePosition(position: Position, token: TokenSnapshot) {
    if (token.price === null) return;
    this.state.positions = this.state.positions.filter((entry) => entry.id !== position.id);

    const entry = position.entryPrice * position.quantity;
    const exitPrice = token.price;
    const exit = exitPrice * position.quantity;
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
      price: exitPrice,
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

  private deriveAgeEvidence(token: LiveTokenState): {
    source: TokenSnapshot["ageSource"];
    createdAt: number | null;
  } {
    const launchCreatedAt = token.tokenAgeSource === "launch" ? token.tokenCreatedAt : null;
    const source: TokenSnapshot["ageSource"] =
      launchCreatedAt !== null
        ? "launch"
        : token.pairCreatedAt !== null
          ? "pair"
          : token.firstTradeAt !== null
            ? "first-trade"
            : token.tokenCreatedAt !== null
              ? token.tokenAgeSource
              : "unknown";

    const createdAt =
      source === "launch"
        ? launchCreatedAt
        : source === "pair"
          ? token.pairCreatedAt
          : source === "first-trade"
            ? token.firstTradeAt
            : source === "on-chain" || source === "provider" || source === "estimated"
              ? token.tokenCreatedAt
              : null;

    return { source, createdAt };
  }

  private async enrichFromHeliusIfNeeded(mintAddress: string) {
    const token = this.store.all().find((entry) => entry.mintAddress === mintAddress);
    if (!token) return;
    if (token.parsedTradeCount > 0) return;
    if (!this.heliusRpcUrl) {
      if (Date.now() - this.lastHeliusPlanWarningAt > 60_000) {
        this.lastHeliusPlanWarningAt = Date.now();
        this.log("Helius enrichment disabled: missing HELIUS_RPC_URL / HELIUS_API_KEY");
      }
      return;
    }
    if (this.enrichmentInFlight.has(mintAddress)) return;
    this.enrichmentInFlight.add(mintAddress);

    try {
      const signatures = await this.callHeliusRpc<{ signature: string }[]>("getSignaturesForAddress", [mintAddress, { limit: 12 }]);
      if (!signatures || signatures.length === 0) {
        token.lifecycle = "discovered";
        return;
      }

      let earliestBlockTimeMs = Number.POSITIVE_INFINITY;
      const wallets = new Set<string>();
      let parsedTrades = 0;

      for (const sig of signatures.slice(0, 8)) {
        const tx = await this.callHeliusRpc<Record<string, unknown> | null>("getTransaction", [
          sig.signature,
          { maxSupportedTransactionVersion: 0, encoding: "jsonParsed" },
        ]);
        if (!tx) continue;

        const blockTime = typeof tx.blockTime === "number" ? tx.blockTime * 1000 : undefined;
        if (blockTime && blockTime < earliestBlockTimeMs) earliestBlockTimeMs = blockTime;

        const meta = (tx.meta as { preTokenBalances?: Array<Record<string, unknown>>; postTokenBalances?: Array<Record<string, unknown>> } | undefined);
        const tokenBalances = [...(meta?.preTokenBalances ?? []), ...(meta?.postTokenBalances ?? [])];
        const touchesMint = tokenBalances.some((entry) => entry?.mint === mintAddress);
        if (!touchesMint) continue;

        parsedTrades += 1;
        for (const balance of tokenBalances) {
          if (balance?.mint !== mintAddress) continue;
          const owner = typeof balance.owner === "string" ? balance.owner : undefined;
          if (owner) wallets.add(owner);
        }
      }

      if (Number.isFinite(earliestBlockTimeMs)) {
        token.tokenCreatedAt = token.tokenCreatedAt ? Math.min(token.tokenCreatedAt, earliestBlockTimeMs) : earliestBlockTimeMs;
        token.tokenAgeSource = "on-chain";
      }
      if (parsedTrades > 0) {
        token.parsedTradeCount = parsedTrades;
        wallets.forEach((wallet) => token.buyerWallets.add(wallet));
        token.lifecycle = "enriched";
        this.log(`helius enriched ${mintAddress}: parsedTrades=${parsedTrades}, wallets=${wallets.size}`);
      } else {
        token.lifecycle = "discovered";
      }
    } catch (error) {
      const message = (error as Error).message ?? "unknown error";
      token.enrichmentWarning = message;
      if (message.includes("429") || message.includes("403")) {
        this.log(`Helius enrichment limited by plan/rate limits (${message}); degrading gracefully.`);
      } else {
        this.log(`Helius enrichment failed for ${mintAddress}: ${message}`);
      }
    } finally {
      this.enrichmentInFlight.delete(mintAddress);
      this.refreshStateFromStore();
      this.emitUpdate();
    }
  }

  private async callHeliusRpc<T>(method: string, params: unknown[]): Promise<T> {
    if (!this.heliusRpcUrl) throw new Error("Helius RPC URL not configured");
    const res = await fetch(this.heliusRpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: crypto.randomUUID(), method, params }),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { result?: T; error?: { message?: string } };
    if (data.error) throw new Error(data.error.message ?? "rpc error");
    if (data.result === undefined) throw new Error("empty rpc result");
    return data.result;
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
