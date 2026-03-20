# SNIPER_DEBUG_EXPORT

## Relevant file paths
- `pump-sniper-dashboard/lib/ingestion/adapters/pumpPortalAdapter.ts` (websocket connection, token discovery subscription, trade subscription)
- `pump-sniper-dashboard/lib/ingestion/normalizer.ts` (trade parsing / payload normalization)
- `pump-sniper-dashboard/lib/monitorEngine.ts` (token registry ingestion flow + metrics calculation)
- `pump-sniper-dashboard/lib/ingestion/liveStateStore.ts` (in-memory token store)
- `pump-sniper-dashboard/app/api/monitor/events/route.ts` (SSE stream to dashboard)
- `pump-sniper-dashboard/app/api/monitor/state/route.ts` (snapshot API)
- `pump-sniper-dashboard/app/api/monitor/settings/route.ts` (settings API)

## Core functions

### File: `pump-sniper-dashboard/lib/ingestion/adapters/pumpPortalAdapter.ts`
```ts
start(onEvent: (event: UnifiedTokenEvent) => void): void {
  if (this.ws) return;
  this.ws = new WebSocket("wss://pumpportal.fun/api/data");

  this.ws.addEventListener("open", () => {
    this.connected = true;
    this.warning = undefined;
    this.ws?.send(JSON.stringify({ method: "subscribeNewToken" }));
    this.ws?.send(JSON.stringify({ method: "subscribeMigration" }));
    for (const mint of this.subscribedMints) {
      this.ws?.send(JSON.stringify({ method: "subscribeTokenTrade", keys: [mint] }));
    }
    onEvent({ eventId: `health:${Date.now()}`, source: this.source, eventType: "health", timestamp: Date.now() });
    onEvent({
      eventId: `health:stream:${Date.now()}`,
      source: this.source,
      eventType: "health",
      timestamp: Date.now(),
      warning: this.reconnectCount > 0 ? "stream reconnected; subscription restored" : "stream connected",
    });
    this.startHeartbeat(onEvent);
  });

  this.ws.addEventListener("message", (message) => {
    const raw = typeof message.data === "string" ? message.data : "";
    if (!raw) return;
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }

    const txType = typeof payload.txType === "string" ? payload.txType.toLowerCase() : "";
    const eventType: UnifiedTokenEvent["eventType"] = txType.includes("migr")
      ? "migrated"
      : txType.includes("buy") || txType.includes("sell")
        ? "trade"
        : "discovered";
    const normalized = normalizePumpPortalPayload(payload, eventType);
    if (!normalized || !normalized.mintAddress) return;

    if (eventType === "discovered" && normalized.mintAddress) {
      this.registerMint(normalized.mintAddress);
    }
    this.lastEventAt = Date.now();
    onEvent(normalized);
    if (eventType === "discovered") {
      onEvent({
        eventId: `health:new-token:${normalized.mintAddress}:${Date.now()}`,
        source: this.source,
        eventType: "health",
        timestamp: Date.now(),
        warning: `new token appended to live state: ${normalized.mintAddress}`,
      });
    }
  });

  this.ws.addEventListener("close", () => {
    this.connected = false;
    this.warning = "PumpPortal websocket offline";
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.ws = null;
    onEvent({
      eventId: `health:disconnect:${Date.now()}`,
      source: this.source,
      eventType: "health",
      timestamp: Date.now(),
      warning: "stream disconnected",
    });
    this.scheduleReconnect(onEvent);
  });

  this.ws.addEventListener("error", () => {
    this.warning = "Erro no websocket PumpPortal";
  });
}

registerMint(mintAddress: string): void {
  if (!mintAddress || this.subscribedMints.has(mintAddress)) return;
  this.subscribedMints.add(mintAddress);
  if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
  this.ws.send(JSON.stringify({ method: "subscribeTokenTrade", keys: [mintAddress] }));
  console.debug(`Subscribed to trades immediately for mint: ${mintAddress}`);
}
```

### File: `pump-sniper-dashboard/lib/ingestion/liveStateStore.ts`
```ts
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
      seenByBotAt: defaults.timestamp,
      tokenCreatedAt: defaults.tokenCreatedAt ?? null,
      pairCreatedAt: defaults.pairCreatedAt ?? null,
      firstTradeAt: null,
      firstTradeConfidence: "unknown",
      tokenAgeSource: defaults.tokenCreatedAt ? "provider" : defaults.pairCreatedAt ? "launch" : "unknown",
      updatedAt: defaults.timestamp,
      priceUsd: defaults.priceUsd ?? null,
      volumeUsd: defaults.volumeUsd ?? null,
      buys: 0,
      sells: 0,
      traders: new Set<string>(),
      buyerWallets: new Set<string>(),
      traderVolumeUsd: new Map<string, number>(),
      buyTimestamps: [],
      sellTimestamps: [],
      recentTrades: [],
      pumpPortalTradeCount: 0,
      parsedTradeCount: 0,
      lifecycle: "discovered",
      detectedAtBySource: new Map<DataSource, number>([[defaults.source, defaults.timestamp]]),
      firstDetectedSource: defaults.source,
      firstDetectedAt: defaults.timestamp,
    };

    this.tokens.set(mintAddress, token);
    return token;
  }

  all(): LiveTokenState[] {
    return Array.from(this.tokens.values());
  }
}
```

### File: `pump-sniper-dashboard/lib/ingestion/normalizer.ts`
```ts
function readNumber(payload: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

function readTimestampMs(payload: Record<string, unknown>, keys: string[]): number | undefined {
  const value = readNumber(payload, keys);
  if (!value || !Number.isFinite(value)) return undefined;
  if (value < 1_000_000_000_000) return Math.floor(value * 1000);
  return Math.floor(value);
}

export function normalizePumpPortalPayload(payload: Record<string, unknown>, eventType: UnifiedTokenEvent["eventType"]): UnifiedTokenEvent | null {
  const mintAddress =
    (typeof payload.mint === "string" && payload.mint) ||
    (typeof payload.mintAddress === "string" && payload.mintAddress) ||
    (typeof payload.ca === "string" && payload.ca) ||
    "";

  if (!mintAddress) return null;

  const symbol = typeof payload.symbol === "string" ? payload.symbol : undefined;
  const name = typeof payload.name === "string" ? payload.name : symbol;
  const txType = typeof payload.txType === "string" ? payload.txType.toLowerCase() : "";
  const isBuy = txType.includes("buy");
  const isSell = txType.includes("sell");
  const buysDelta = isBuy ? 1 : 0;
  const sellsDelta = isSell ? 1 : 0;
  const priceUsd = readNumber(payload, ["priceUsd", "price", "usdPrice"]);
  const usdAmount = readNumber(payload, ["usdAmount", "volumeUsd", "amountUsd", "notionalUsd"]);
  const tokenAmount = readNumber(payload, ["tokenAmount", "amountTokens", "tokensOut", "tokensIn"]);
  const solAmount = readNumber(payload, ["solAmount", "amountSol", "solIn", "solOut"]);
  const tokenCreatedAt = readTimestampMs(payload, ["tokenCreatedAt", "createdAt", "createdTimestamp", "mintedAt", "time"]);
  const pairCreatedAt = readTimestampMs(payload, ["pairCreatedAt", "poolCreatedAt", "liquidityCreatedAt", "pairCreatedTimestamp"]);

  return {
    eventId: `${eventType}:${mintAddress}:${payload.signature ?? payload.timestamp ?? Date.now()}`,
    source: "pumpportal",
    eventType,
    mintAddress,
    symbol,
    name,
    timestamp: Date.now(),
    tokenCreatedAt,
    pairCreatedAt,
    discoveryStatus: eventType === "migrated" ? "migrated" : eventType === "discovered" ? "discovered" : undefined,
    confirmationStatus: "unconfirmed",
    priceUsd,
    volumeUsd: usdAmount,
    tradeUsd: usdAmount,
    tradeTokenAmount: tokenAmount,
    tradeSolAmount: solAmount,
    tradeSide: isBuy ? "buy" : isSell ? "sell" : undefined,
    buysDelta,
    sellsDelta,
    trader:
      (typeof payload.traderPublicKey === "string" && payload.traderPublicKey) ||
      (typeof payload.user === "string" && payload.user) ||
      undefined,
  };
}
```

### File: `pump-sniper-dashboard/lib/monitorEngine.ts`
```ts
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
    if (!token.tokenCreatedAt || token.pairCreatedAt < token.tokenCreatedAt) token.tokenAgeSource = "launch";
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
    if (token.firstTradeConfidence === "unknown") token.firstTradeConfidence = "live";
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
      const buys15s = token.buyTimestamps.filter((ts) => ts >= now - 15_000).length;
      const buys30s = token.buyTimestamps.filter((ts) => ts >= now - 30_000).length;
      const buysPerSecond15s = buys15s > 0 ? Number((buys15s / 15).toFixed(2)) : null;
      const curveSlope = Number(((buysPerSecond ?? 0) * 1.2 - token.sells * 0.4).toFixed(2));
      const trades5s = token.recentTrades.filter((trade) => trade.timestamp >= now - 5_000);
      const trades15s = token.recentTrades.filter((trade) => trade.timestamp >= now - 15_000);
      const trades30s = token.recentTrades.filter((trade) => trade.timestamp >= now - 30_000);
      const volume5s = trades5s.reduce((sum, trade) => sum + (trade.usdAmount ?? 0), 0);
      const volume15s = trades15s.reduce((sum, trade) => sum + (trade.usdAmount ?? 0), 0);
      const volume30s = trades30s.reduce((sum, trade) => sum + (trade.usdAmount ?? 0), 0);
      const uniqueBuyers30s = new Set(trades30s.filter((t) => t.side === "buy").map((t) => t.wallet).filter(Boolean)).size;
      const uniqueTraders30s = new Set(trades30s.map((t) => t.wallet).filter(Boolean)).size;
      const parsedBuysTotal = token.buyTimestamps.length;
      const parsedSellsTotal = token.sellTimestamps.length;
      const parsedTradesTotal = token.recentTrades.length;

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
      let lifecycle: TokenSnapshot["lifecycle"] = "discovered";
      if (token.rejectionReason) lifecycle = "rejected";
      else if (Date.now() - token.updatedAt > 180_000) lifecycle = "expired";
      else if (token.parsedTradeCount > 0) lifecycle = "enriched";
      else if (token.recentTrades.length > 0) lifecycle = "enriching";

      if (
        lifecycle !== "rejected" &&
        lifecycle !== "expired" &&
        hasRealAge &&
        realTokenAgeSeconds !== null &&
        realTokenAgeSeconds <= HARD_MAX_TOKEN_AGE_SECONDS &&
        token.parsedTradeCount >= 1 &&
        token.volumeUsd !== null &&
        token.priceUsd !== null
      ) {
        lifecycle = "tradable";
      }
      token.lifecycle = lifecycle;
      const sniperReady =
        lifecycle === "tradable" &&
        chosenAgeSource !== "estimated" &&
        realTokenAgeSeconds !== null &&
        realTokenAgeSeconds <= HARD_MAX_TOKEN_AGE_SECONDS;
      const liquidityEstimate = volume30s > 0 ? Number((volume30s / 30).toFixed(2)) : null;
      const sourceConfidence: TokenSnapshot["sourceConfidence"] =
        token.detectedAtBySource.size >= 2 ? "dual-source" : "single-source";
      const signalScore = this.computeSignalScore({
        realTokenAgeSeconds,
        buysPerSecond: buysPerSecond ?? buysPerSecond15s,
        uniqueBuyers30s,
        volume30s,
        hasMetadata: token.symbol !== "UNKNOWN" && token.name !== "Unknown Token",
        sourceConfidence,
      });
      const confidenceLevel = Math.min(100, Math.max(0, signalScore));

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
        volume5s: volume5s > 0 ? Number(volume5s.toFixed(2)) : null,
        volume15s: volume15s > 0 ? Number(volume15s.toFixed(2)) : null,
        volume30s: volume30s > 0 ? Number(volume30s.toFixed(2)) : null,
        volumeUsd: token.volumeUsd !== null ? Number(token.volumeUsd.toFixed(2)) : null,
        buys5s: buysInWindow,
        buys15s,
        buys30s,
        buysPerSecond15s,
        buysPerSecond,
        parsedTradesTotal,
        parsedBuysTotal,
        parsedSellsTotal,
        confidenceLevel,
        signalScore,
        liquidityEstimate,
        rejectionReason: token.rejectionReason,
        sourceConfidence,
        uniqueWallets: token.buyerWallets.size > 0 ? token.buyerWallets.size : null,
        uniqueBuyers30s,
        uniqueTraders30s,
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

private deriveAgeEvidence(token: LiveTokenState): {
  source: TokenSnapshot["ageSource"];
  createdAt: number | null;
} {
  const launchCreatedAt = token.tokenAgeSource === "launch" ? token.tokenCreatedAt : null;
  const source: TokenSnapshot["ageSource"] =
    launchCreatedAt !== null
      ? "launch"
      : token.firstTradeAt !== null && token.firstTradeConfidence === "history"
          ? "first-trade"
          : token.firstTradeAt !== null
            ? "estimated"
          : token.tokenCreatedAt !== null
            ? token.tokenAgeSource
            : "unknown";

  const createdAt =
    source === "launch"
      ? launchCreatedAt
      : source === "first-trade"
          ? token.firstTradeAt
          : source === "on-chain" || source === "provider" || source === "estimated"
            ? token.tokenCreatedAt
            : null;

  return { source, createdAt };
}
```

### File: `pump-sniper-dashboard/app/api/monitor/events/route.ts`
```ts
export async function GET() {
  const engine = getMonitorEngine();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const sendState = () => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(engine.getState())}\n\n`));
      };

      sendState();
      const listener = () => sendState();
      engine.on("update", listener);

      const keepAlive = setInterval(() => {
        controller.enqueue(encoder.encode(`event: ping\ndata: ${Date.now()}\n\n`));
      }, 15000);

      return () => {
        clearInterval(keepAlive);
        engine.off("update", listener);
      };
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
```

### File: `pump-sniper-dashboard/app/api/monitor/state/route.ts`
```ts
export function GET() {
  const engine = getMonitorEngine();
  return NextResponse.json(engine.getState());
}
```

### File: `pump-sniper-dashboard/app/api/monitor/settings/route.ts`
```ts
export async function POST(request: Request) {
  const payload = (await request.json()) as Partial<MonitorSettings>;
  const engine = getMonitorEngine();
  const settings = engine.updateSettings(payload);
  return NextResponse.json(settings);
}
```

## Env vars (PumpPortal, Helius, stream processing)
- `SOLANA_RPC_URL`
- `SOLANA_WS_URL`
- `HELIUS_API_KEY`
- `HELIUS_RPC_URL`
- `HELIUS_WS_URL`
- `HELIUS_GRPC_WS_URL`
- `PUMPFUN_PROGRAM_ID`

## Flow summary (discovery -> UI)
1. PumpPortal websocket connects (`wss://pumpportal.fun/api/data`) and subscribes to `subscribeNewToken` + `subscribeMigration`.
2. Incoming message is normalized (`normalizePumpPortalPayload`) and classified into `discovered` / `trade` / `migrated`.
3. On `discovered`, adapter immediately calls `registerMint(mint)` to subscribe `subscribeTokenTrade` before emitting event.
4. Engine `onUnifiedEvent` deduplicates, validates candidate, gets/creates token in `LiveStateStore`, applies price/volume/trade/wallet updates.
5. Engine `refreshStateFromStore` computes rolling metrics (age, price, volume windows, buys/s, unique wallets, risk, lifecycle, sniper readiness).
6. Engine emits updates; SSE route `/api/monitor/events` streams `engine.getState()` to the dashboard.
7. UI consumes SSE and renders token table, signals, positions, and diagnostics.
