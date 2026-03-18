import { normalizePumpPortalPayload } from "../normalizer";
import { SourceAdapter, SourceHealth, UnifiedTokenEvent } from "../types";

export class PumpPortalAdapter implements SourceAdapter {
  readonly source = "pumpportal" as const;
  private ws: WebSocket | null = null;
  private connected = false;
  private lastEventAt?: number;
  private warning?: string;
  private reconnectTimer?: NodeJS.Timeout;
  private subscribedMints = new Set<string>();

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

      this.lastEventAt = Date.now();
      onEvent(normalized);
      this.registerMint(normalized.mintAddress);
    });

    this.ws.addEventListener("close", () => {
      this.connected = false;
      this.warning = "PumpPortal websocket offline";
      this.ws = null;
      this.scheduleReconnect(onEvent);
    });

    this.ws.addEventListener("error", () => {
      this.warning = "Erro no websocket PumpPortal";
    });
  }

  stop(): void {
    this.ws?.close();
    this.ws = null;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
  }

  registerMint(mintAddress: string): void {
    if (!mintAddress || this.subscribedMints.has(mintAddress)) return;
    this.subscribedMints.add(mintAddress);
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ method: "subscribeTokenTrade", keys: [mintAddress] }));
  }

  getHealth(): SourceHealth {
    return {
      source: this.source,
      connected: this.connected,
      lastEventAt: this.lastEventAt,
      warning: this.warning,
    };
  }

  private scheduleReconnect(onEvent: (event: UnifiedTokenEvent) => void) {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.start(onEvent);
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        for (const mint of this.subscribedMints) this.registerMint(mint);
      }
    }, 3000);
    this.reconnectTimer.unref();
  }
}
