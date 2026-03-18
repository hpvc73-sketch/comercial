import { SourceAdapter, SourceHealth, UnifiedTokenEvent } from "../types";

type PendingSub = { mintAddress: string; requestId: number };

export class SolanaRpcAdapter implements SourceAdapter {
  readonly source = "solana-rpc" as const;
  private ws: WebSocket | null = null;
  private connected = false;
  private lastEventAt?: number;
  private warning?: string;
  private requestId = 1;
  private pendingByRequest = new Map<number, PendingSub>();
  private mintBySubscription = new Map<number, string>();
  private reconnectTimer?: NodeJS.Timeout;

  constructor(private wsEndpoint: string) {}

  start(onEvent: (event: UnifiedTokenEvent) => void): void {
    if (this.ws || !this.wsEndpoint) {
      if (!this.wsEndpoint) this.warning = "SOLANA_RPC_WS_URL não configurado";
      return;
    }

    this.ws = new WebSocket(this.wsEndpoint);

    this.ws.addEventListener("open", () => {
      this.connected = true;
      this.warning = undefined;
      onEvent({ eventId: `health:${Date.now()}:solana`, source: this.source, eventType: "health", timestamp: Date.now() });
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

      const id = typeof payload.id === "number" ? payload.id : undefined;
      const result = payload.result;

      if (id !== undefined && typeof result === "number") {
        const pending = this.pendingByRequest.get(id);
        if (pending) {
          this.pendingByRequest.delete(id);
          this.mintBySubscription.set(result, pending.mintAddress);
        }
        return;
      }

      const method = typeof payload.method === "string" ? payload.method : "";
      if (method !== "accountNotification") return;

      const params = payload.params as { subscription?: number } | undefined;
      const subId = params?.subscription;
      if (!subId) return;

      const mintAddress = this.mintBySubscription.get(subId);
      if (!mintAddress) return;

      this.lastEventAt = Date.now();
      onEvent({
        eventId: `confirmed:${mintAddress}:${Date.now()}`,
        source: this.source,
        eventType: "confirmed",
        mintAddress,
        timestamp: Date.now(),
        confirmationStatus: "confirmed",
      });
    });

    this.ws.addEventListener("close", () => {
      this.connected = false;
      this.warning = "Solana RPC websocket offline";
      this.ws = null;
      this.scheduleReconnect(onEvent);
    });

    this.ws.addEventListener("error", () => {
      this.warning = "Erro no websocket Solana RPC";
    });
  }

  registerMint(mintAddress: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const id = this.requestId++;
    this.pendingByRequest.set(id, { mintAddress, requestId: id });

    this.ws.send(
      JSON.stringify({
        jsonrpc: "2.0",
        id,
        method: "accountSubscribe",
        params: [mintAddress, { encoding: "jsonParsed", commitment: "confirmed" }],
      }),
    );
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
