import { SourceAdapter, SourceHealth, UnifiedTokenEvent } from "../types";

const BASE58_RE = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;

export class SolanaRpcAdapter implements SourceAdapter {
  readonly source = "solana-rpc" as const;
  private ws: WebSocket | null = null;
  private connected = false;
  private lastEventAt?: number;
  private warning?: string;
  private requestId = 1;
  private reconnectTimer?: NodeJS.Timeout;

  constructor(private wsEndpoint: string | undefined, private pumpProgramId: string) {}

  start(onEvent: (event: UnifiedTokenEvent) => void): void {
    if (this.ws || !this.wsEndpoint) {
      if (!this.wsEndpoint) this.warning = "SOLANA_RPC_WS_URL não configurado (obrigatório).";
      return;
    }

    this.ws = new WebSocket(this.wsEndpoint);

    this.ws.addEventListener("open", () => {
      this.connected = true;
      this.warning = undefined;
      this.subscribeLogs();
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

      const method = typeof payload.method === "string" ? payload.method : "";
      if (method !== "logsNotification") return;

      const logs =
        ((payload.params as { result?: { value?: { logs?: string[] } } } | undefined)?.result?.value?.logs as string[] | undefined) ??
        [];

      const detectedMints = this.extractMintCandidates(logs);
      if (detectedMints.length === 0) return;

      this.lastEventAt = Date.now();
      const lowerLogs = logs.join(" ").toLowerCase();

      for (const mintAddress of detectedMints) {
        const isCreate = lowerLogs.includes("initialize") || lowerLogs.includes("create") || lowerLogs.includes("mint");
        const isBuy = lowerLogs.includes("buy");
        const isLiquidity = lowerLogs.includes("liquidity") || lowerLogs.includes("add_liquidity");

        onEvent({
          eventId: `solana-discovered:${mintAddress}:${Date.now()}`,
          source: this.source,
          eventType: isCreate ? "discovered" : "trade",
          mintAddress,
          timestamp: Date.now(),
          discoveryStatus: "discovered",
          confirmationStatus: "confirmed",
          buysDelta: isBuy ? 1 : 0,
          sellsDelta: lowerLogs.includes("sell") ? 1 : 0,
        });

        onEvent({
          eventId: `solana-confirmed:${mintAddress}:${Date.now()}`,
          source: this.source,
          eventType: "confirmed",
          mintAddress,
          timestamp: Date.now(),
          confirmationStatus: "confirmed",
        });

        if (isLiquidity) {
          onEvent({
            eventId: `solana-liquidity:${mintAddress}:${Date.now()}`,
            source: this.source,
            eventType: "liquidity",
            mintAddress,
            timestamp: Date.now(),
            discoveryStatus: "migrated",
            confirmationStatus: "confirmed",
          });
        }
      }
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

  private subscribeLogs() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const id = this.requestId++;
    this.ws.send(
      JSON.stringify({
        jsonrpc: "2.0",
        id,
        method: "logsSubscribe",
        params: [{ mentions: [this.pumpProgramId] }, { commitment: "confirmed" }],
      }),
    );
  }

  private extractMintCandidates(logs: string[]): string[] {
    const values = new Set<string>();
    for (const log of logs) {
      const matches = log.match(BASE58_RE);
      if (!matches) continue;
      for (const candidate of matches) {
        if (candidate.length >= 32 && candidate.length <= 44) values.add(candidate);
      }
    }
    return Array.from(values);
  }

  private scheduleReconnect(onEvent: (event: UnifiedTokenEvent) => void) {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.start(onEvent);
    }, 2500);
    this.reconnectTimer.unref();
  }
}
