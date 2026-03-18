import { normalizePumpPortalPayload } from "../normalizer";
import { SourceAdapter, SourceHealth, UnifiedTokenEvent } from "../types";

export class PumpPortalAdapter implements SourceAdapter {
  readonly source = "pumpportal" as const;
  private ws: WebSocket | null = null;
  private connected = false;
  private lastEventAt?: number;
  private warning?: string;
  private reconnectTimer?: NodeJS.Timeout;

  start(onEvent: (event: UnifiedTokenEvent) => void): void {
    if (this.ws) return;
    this.ws = new WebSocket("wss://pumpportal.fun/api/data");

    this.ws.addEventListener("open", () => {
      this.connected = true;
      this.warning = undefined;
      this.ws?.send(JSON.stringify({ method: "subscribeNewToken" }));
      this.ws?.send(JSON.stringify({ method: "subscribeMigration" }));
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
      const normalized = normalizePumpPortalPayload(payload, txType.includes("migr") ? "migrated" : "discovered");
      if (!normalized) return;

      this.lastEventAt = Date.now();
      onEvent(normalized);

      const tradeEvent = normalizePumpPortalPayload(payload, "trade");
      if (tradeEvent && (tradeEvent.buysDelta || tradeEvent.sellsDelta || tradeEvent.volumeUsd)) {
        onEvent({ ...tradeEvent, eventId: `${tradeEvent.eventId}:trade` });
      }
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
    }, 3000);
    this.reconnectTimer.unref();
  }
}
