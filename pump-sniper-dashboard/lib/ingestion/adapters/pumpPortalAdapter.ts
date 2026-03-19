import { normalizePumpPortalPayload } from "../normalizer";
import { SourceAdapter, SourceHealth, UnifiedTokenEvent } from "../types";

export class PumpPortalAdapter implements SourceAdapter {
  readonly source = "pumpportal" as const;
  private readonly staleMs = Number(process.env.PUMPPORTAL_STALE_MS ?? 20_000);
  private readonly watchdogIntervalMs = Number(process.env.PUMPPORTAL_WATCHDOG_INTERVAL_MS ?? 5_000);
  private ws: WebSocket | null = null;
  private connected = false;
  private lastEventAt?: number;
  private lastMessageAt?: number;
  private lastRealEventAt?: number;
  private warning?: string;
  private reconnectTimer?: NodeJS.Timeout;
  private subscribedMints = new Set<string>();
  private heartbeatTimer?: NodeJS.Timeout;
  private watchdogTimer?: NodeJS.Timeout;
  private reconnectCount = 0;
  private reconnecting = false;

  start(onEvent: (event: UnifiedTokenEvent) => void): void {
    if (this.ws && this.ws.readyState !== WebSocket.CLOSED) return;
    this.reconnecting = false;
    this.ws = new WebSocket("wss://pumpportal.fun/api/data");

    this.ws.addEventListener("open", () => {
      this.connected = true;
      this.warning = undefined;
      this.lastMessageAt = Date.now();
      this.lastRealEventAt = Date.now();
      this.ws?.send(JSON.stringify({ method: "subscribeNewToken" }));
      this.ws?.send(JSON.stringify({ method: "subscribeMigration" }));
      for (const mint of this.subscribedMints) {
        this.ws?.send(JSON.stringify({ method: "subscribeTokenTrade", keys: [mint] }));
      }
      onEvent({ eventId: `health:opened:${Date.now()}`, source: this.source, eventType: "health", timestamp: Date.now(), warning: "websocket opened" });
      onEvent({ eventId: `health:${Date.now()}`, source: this.source, eventType: "health", timestamp: Date.now() });
      onEvent({
        eventId: `health:stream:${Date.now()}`,
        source: this.source,
        eventType: "health",
        timestamp: Date.now(),
        warning: this.reconnectCount > 0 ? "stream reconnected; subscription restored" : "stream connected",
      });
      this.startHeartbeat(onEvent);
      this.startWatchdog(onEvent);
      onEvent({
        eventId: `health:subscriptions:${Date.now()}`,
        source: this.source,
        eventType: "health",
        timestamp: Date.now(),
        warning: `subscriptions restored (${this.subscribedMints.size} tracked mints)`,
      });
    });

    this.ws.addEventListener("message", (message) => {
      this.lastMessageAt = Date.now();
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
      this.lastRealEventAt = Date.now();
      onEvent(normalized);
      onEvent({
        eventId: `health:last-real-event:${Date.now()}`,
        source: this.source,
        eventType: "health",
        timestamp: Date.now(),
        warning: `lastRealEventAt=${this.lastRealEventAt}`,
      });
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
      this.clearTimers();
      this.ws = null;
      onEvent({
        eventId: `health:disconnect:${Date.now()}`,
        source: this.source,
        eventType: "health",
        timestamp: Date.now(),
        warning: "websocket closed",
      });
      this.scheduleReconnect(onEvent);
    });

    this.ws.addEventListener("error", () => {
      this.warning = "Erro no websocket PumpPortal";
      onEvent({
        eventId: `health:error:${Date.now()}`,
        source: this.source,
        eventType: "health",
        timestamp: Date.now(),
        warning: "websocket error",
      });
      this.scheduleReconnect(onEvent);
    });
  }

  stop(): void {
    this.clearTimers();
    this.ws?.close();
    this.ws = null;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
  }

  registerMint(mintAddress: string): void {
    if (!mintAddress || this.subscribedMints.has(mintAddress)) return;
    this.subscribedMints.add(mintAddress);
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ method: "subscribeTokenTrade", keys: [mintAddress] }));
    console.debug(`Subscribed to trades immediately for mint: ${mintAddress}`);
  }

  getHealth(): SourceHealth {
    return {
      source: this.source,
      connected: this.connected,
      lastEventAt: this.lastRealEventAt ?? this.lastEventAt,
      warning: this.warning,
    };
  }

  private scheduleReconnect(onEvent: (event: UnifiedTokenEvent) => void) {
    if (this.reconnectTimer || this.reconnecting) return;
    this.reconnecting = true;
    onEvent({
      eventId: `health:reconnect-scheduled:${Date.now()}`,
      source: this.source,
      eventType: "health",
      timestamp: Date.now(),
      warning: "reconnect scheduled",
    });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.reconnectCount += 1;
      onEvent({
        eventId: `health:reconnect-started:${Date.now()}`,
        source: this.source,
        eventType: "health",
        timestamp: Date.now(),
        warning: "reconnect started",
      });
      if (this.ws && this.ws.readyState !== WebSocket.CLOSED) {
        try {
          this.ws.close();
        } catch {
          // ignore close errors
        }
      }
      this.ws = null;
      this.start(onEvent);
    }, 3000);
    this.reconnectTimer.unref();
  }

  private startHeartbeat(onEvent: (event: UnifiedTokenEvent) => void) {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      this.ws.send(JSON.stringify({ method: "ping" }));
      onEvent({ eventId: `health:heartbeat:${Date.now()}`, source: this.source, eventType: "health", timestamp: Date.now() });
    }, 15_000);
    this.heartbeatTimer.unref();
  }

  private startWatchdog(onEvent: (event: UnifiedTokenEvent) => void) {
    if (this.watchdogTimer) clearInterval(this.watchdogTimer);
    this.watchdogTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      const baseline = this.lastRealEventAt ?? this.lastMessageAt ?? Date.now();
      const ageMs = Date.now() - baseline;
      onEvent({
        eventId: `health:watchdog:${Date.now()}`,
        source: this.source,
        eventType: "health",
        timestamp: Date.now(),
        warning: `lastRealEventAt=${baseline} ageMs=${ageMs}`,
      });
      if (ageMs > this.staleMs) {
        this.warning = "PumpPortal stream stale, forcing reconnect";
        onEvent({
          eventId: `health:stale:${Date.now()}`,
          source: this.source,
          eventType: "health",
          timestamp: Date.now(),
          warning: "PumpPortal stream stale, forcing reconnect",
        });
        this.clearTimers();
        try {
          this.ws.close();
        } catch {
          // ignore close errors
        }
        this.ws = null;
        this.connected = false;
        this.scheduleReconnect(onEvent);
      }
    }, this.watchdogIntervalMs);
    this.watchdogTimer.unref();
  }

  private clearTimers() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.watchdogTimer) clearInterval(this.watchdogTimer);
    this.heartbeatTimer = undefined;
    this.watchdogTimer = undefined;
  }
}
