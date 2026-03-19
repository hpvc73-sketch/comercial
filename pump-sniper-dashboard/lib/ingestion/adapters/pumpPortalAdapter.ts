import { normalizePumpPortalPayload } from "../normalizer";
import { SourceAdapter, SourceHealth, UnifiedTokenEvent } from "../types";

type PumpPortalConnectionState = "idle" | "connecting" | "connected" | "stale" | "reconnecting" | "stopped" | "errored";

export class PumpPortalAdapter implements SourceAdapter {
  readonly source = "pumpportal" as const;
  private readonly staleMs = Number(process.env.PUMPPORTAL_STALE_MS ?? 15_000);
  private readonly watchdogIntervalMs = Number(process.env.PUMPPORTAL_WATCHDOG_INTERVAL_MS ?? 3_000);
  private readonly reconnectBackoffBaseMs = Number(process.env.PUMPPORTAL_RECONNECT_BACKOFF_MS ?? 2_000);
  private readonly reconnectBackoffMaxMs = Number(process.env.PUMPPORTAL_MAX_BACKOFF_MS ?? 10_000);

  private ws: WebSocket | null = null;
  private wsGeneration = 0;
  private connected = false;
  private state: PumpPortalConnectionState = "idle";
  private warning?: string;

  private lastEventAt?: number;
  private lastMessageAt?: number;
  private lastRealEventAt?: number;
  private lastConnectAt?: number;

  private reconnectTimer?: NodeJS.Timeout;
  private heartbeatTimer?: NodeJS.Timeout;
  private watchdogTimer?: NodeJS.Timeout;

  private reconnectCount = 0;
  private reconnectAttempt = 0;
  private currentReconnectReason?: string;
  private subscribedMints = new Set<string>();
  private stopped = false;
  private onEventCallback?: (event: UnifiedTokenEvent) => void;

  start(onEvent: (event: UnifiedTokenEvent) => void): void {
    this.onEventCallback = onEvent;
    this.stopped = false;
    if (this.state === "connected" || this.state === "connecting" || this.state === "reconnecting") return;
    this.connect("start");
  }

  stop(): void {
    this.stopped = true;
    this.transitionTo("stopped", "stop requested");
    this.fullTeardown("stop", true);
  }

  registerMint(mintAddress: string): void {
    if (!mintAddress || this.subscribedMints.has(mintAddress)) return;
    this.subscribedMints.add(mintAddress);
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ method: "subscribeTokenTrade", keys: [mintAddress] }));
    this.emitHealth(`Subscribed to trades immediately for mint: ${mintAddress}`);
  }

  getHealth(): SourceHealth {
    return {
      source: this.source,
      connected: this.connected && this.state === "connected" && this.getLastRealEventAgeSeconds() <= Math.ceil(this.staleMs / 1000),
      state: this.state,
      lastEventAt: this.lastEventAt,
      lastMessageAt: this.lastMessageAt,
      lastRealEventAt: this.lastRealEventAt,
      lastRealEventAgeSeconds: this.getLastRealEventAgeSeconds(),
      wsReadyState: this.ws?.readyState,
      reconnectCount: this.reconnectCount,
      reconnectReason: this.currentReconnectReason,
      fallbackMode: this.state !== "connected",
      warning: this.warning,
    };
  }

  private connect(reason: string) {
    if (this.stopped) return;
    this.fullTeardown(`connect:${reason}`, true);
    this.transitionTo("connecting", reason);

    const generation = ++this.wsGeneration;
    const socket = new WebSocket("wss://pumpportal.fun/api/data");
    this.ws = socket;

    socket.addEventListener("open", () => this.handleOpen(generation));
    socket.addEventListener("message", (message) => this.handleMessage(generation, message));
    socket.addEventListener("close", (event) => this.handleClose(generation, event));
    socket.addEventListener("error", (event) => this.handleError(generation, event));
  }

  private handleOpen(generation: number) {
    if (!this.isCurrentGeneration(generation)) return;
    this.connected = true;
    this.warning = undefined;
    this.lastConnectAt = Date.now();
    this.lastMessageAt = Date.now();
    this.lastRealEventAt = Date.now();
    this.reconnectAttempt = 0;

    this.transitionTo("connected", "websocket opened");

    this.ws?.send(JSON.stringify({ method: "subscribeNewToken" }));
    this.ws?.send(JSON.stringify({ method: "subscribeMigration" }));
    for (const mint of this.subscribedMints) {
      this.ws?.send(JSON.stringify({ method: "subscribeTokenTrade", keys: [mint] }));
    }

    this.emitHealth("websocket opened");
    this.emitHealth(`subscriptions restored (${this.subscribedMints.size} tracked mints)`);

    this.startHeartbeat();
    this.startWatchdog();
  }

  private handleMessage(generation: number, message: MessageEvent) {
    if (!this.isCurrentGeneration(generation)) return;
    this.lastMessageAt = Date.now();

    const raw = typeof message.data === "string" ? message.data : "";
    if (!raw) return;

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      this.emitHealth("malformed payload ignored");
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

    if (eventType === "discovered") this.registerMint(normalized.mintAddress);

    this.lastEventAt = Date.now();
    this.lastRealEventAt = Date.now();
    this.emitEvent(normalized);
    this.emitHealth(`lastRealEventAt=${this.lastRealEventAt}`);
  }

  private handleClose(generation: number, event: CloseEvent) {
    if (!this.isCurrentGeneration(generation)) return;
    this.connected = false;
    this.warning = `websocket closed code=${event.code} reason=${event.reason || "n/a"}`;
    this.emitHealth(this.warning);
    if (this.stopped) {
      this.transitionTo("stopped", "closed after stop");
      return;
    }
    this.forceReconnect("socket close");
  }

  private handleError(generation: number, _event: Event) {
    if (!this.isCurrentGeneration(generation)) return;
    this.connected = false;
    this.warning = "websocket error";
    this.transitionTo("errored", "socket error");
    this.emitHealth("websocket error");
    if (this.stopped) return;
    this.forceReconnect("socket error");
  }

  private forceReconnect(reason: string) {
    if (this.stopped) return;
    this.currentReconnectReason = reason;
    this.transitionTo("reconnecting", reason);
    this.emitHealth(`reconnect scheduled (${reason})`);

    this.fullTeardown(`forceReconnect:${reason}`, false);

    this.reconnectCount += 1;
    this.reconnectAttempt += 1;
    const backoff = Math.min(this.reconnectBackoffMaxMs, this.reconnectBackoffBaseMs * 2 ** Math.max(0, this.reconnectAttempt - 1));

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      if (this.stopped) return;
      this.emitHealth(`reconnect started (${reason})`);
      this.connect(reason);
    }, backoff);
    this.reconnectTimer.unref();
  }

  private startHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        this.forceReconnect("missed heartbeat");
        return;
      }
      try {
        this.ws.send(JSON.stringify({ method: "ping" }));
      } catch {
        this.forceReconnect("heartbeat send failure");
      }
    }, 15_000);
    this.heartbeatTimer.unref();
  }

  private startWatchdog() {
    if (this.watchdogTimer) clearInterval(this.watchdogTimer);
    this.watchdogTimer = setInterval(() => {
      if (!this.ws) {
        this.forceReconnect("invalid readyState");
        return;
      }
      if (this.ws.readyState !== WebSocket.OPEN && this.state === "connected") {
        this.forceReconnect("invalid readyState");
        return;
      }

      const ageMs = Date.now() - (this.lastRealEventAt ?? this.lastMessageAt ?? Date.now());
      if (ageMs > this.staleMs) {
        this.transitionTo("stale", "stale stream");
        this.emitHealth("PumpPortal stream stale, forcing reconnect");
        this.forceReconnect("stale stream");
      }
    }, this.watchdogIntervalMs);
    this.watchdogTimer.unref();
  }

  private fullTeardown(reason: string, keepReconnectTimer: boolean) {
    if (!keepReconnectTimer && this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = undefined;
    }

    const socket = this.ws;
    this.ws = null;

    if (!socket) return;

    try {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close(1000, reason);
      }
    } catch {
      // ignore teardown errors
    }
  }

  private transitionTo(next: PumpPortalConnectionState, reason: string) {
    if (this.state === next) return;
    this.emitHealth(`state ${this.state} -> ${next} (${reason})`);
    this.state = next;
  }

  private emitHealth(warning: string) {
    this.warning = warning;
    this.emitEvent({
      eventId: `health:${this.source}:${Date.now()}`,
      source: this.source,
      eventType: "health",
      timestamp: Date.now(),
      warning,
    });
  }

  private emitEvent(event: UnifiedTokenEvent) {
    this.onEventCallback?.(event);
  }

  private getLastRealEventAgeSeconds() {
    if (!this.lastRealEventAt) return Number.POSITIVE_INFINITY;
    return Math.floor((Date.now() - this.lastRealEventAt) / 1000);
  }

  private isCurrentGeneration(generation: number) {
    return generation === this.wsGeneration;
  }
}
