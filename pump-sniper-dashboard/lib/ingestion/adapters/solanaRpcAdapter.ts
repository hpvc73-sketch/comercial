import { DataSource, SourceAdapter, SourceHealth, UnifiedTokenEvent } from "../types";

const BASE58_RE = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;

export class SolanaRpcAdapter implements SourceAdapter {
  readonly source: DataSource;
  private ws: WebSocket | null = null;
  private connected = false;
  private lastEventAt?: number;
  private warning?: string;
  private requestId = 1;
  private reconnectTimer?: NodeJS.Timeout;
  private httpFallbackTimer?: NodeJS.Timeout;

  constructor(private rpcHttpUrl: string | undefined, private pumpProgramId: string, source: DataSource = "solana-rpc") {
    this.source = source;
  }

  start(onEvent: (event: UnifiedTokenEvent) => void): void {
    if (!this.rpcHttpUrl) {
      this.warning = "SOLANA_RPC_URL não configurado (obrigatório).";
      return;
    }
    if (this.ws || this.httpFallbackTimer) return;
    this.connectWs(onEvent);
  }

  stop(): void {
    this.ws?.close();
    this.ws = null;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.httpFallbackTimer) clearInterval(this.httpFallbackTimer);
  }

  getHealth(): SourceHealth {
    return {
      source: this.source,
      connected: this.connected,
      lastEventAt: this.lastEventAt,
      warning: this.warning,
      enabled: Boolean(this.rpcHttpUrl),
    };
  }

  private connectWs(onEvent: (event: UnifiedTokenEvent) => void) {
    const wsUrl = this.rpcHttpUrl?.replace(/^https:/, "wss:").replace(/^http:/, "ws:");
    if (!wsUrl) return;

    this.log(`a tentar ligação WS RPC: ${wsUrl}`);
    this.ws = new WebSocket(wsUrl);

    this.ws.addEventListener("open", () => {
      this.connected = true;
      this.warning = undefined;
      this.subscribeLogs();
      this.log("ligação WS RPC estabelecida com sucesso");
      onEvent({ eventId: `health:${Date.now()}:${this.source}`, source: this.source, eventType: "health", timestamp: Date.now() });
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
          eventId: `${this.source}-discovered:${mintAddress}:${Date.now()}`,
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
          eventId: `${this.source}-confirmed:${mintAddress}:${Date.now()}`,
          source: this.source,
          eventType: "confirmed",
          mintAddress,
          timestamp: Date.now(),
          confirmationStatus: "confirmed",
        });

        if (isLiquidity) {
          onEvent({
            eventId: `${this.source}-liquidity:${mintAddress}:${Date.now()}`,
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
      this.ws = null;
      this.log("WS RPC fechado; fallback para HTTP e reconexão automática");
      this.startHttpFallback(onEvent);
      this.scheduleReconnect(onEvent);
    });

    this.ws.addEventListener("error", () => {
      this.warning = "Erro no websocket Solana RPC";
      this.log("erro na ligação WS RPC");
    });
  }

  private subscribeLogs() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(
      JSON.stringify({
        jsonrpc: "2.0",
        id: this.requestId++,
        method: "logsSubscribe",
        params: [{ mentions: [this.pumpProgramId] }, { commitment: "confirmed" }],
      }),
    );
  }

  private startHttpFallback(onEvent: (event: UnifiedTokenEvent) => void) {
    if (!this.rpcHttpUrl || this.httpFallbackTimer) return;

    this.warning = "WS indisponível; a usar HTTP fallback";
    this.httpFallbackTimer = setInterval(async () => {
      try {
        const res = await fetch(this.rpcHttpUrl as string, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: this.requestId++, method: "getSlot", params: [{ commitment: "confirmed" }] }),
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        this.connected = true;
        this.lastEventAt = Date.now();
        onEvent({ eventId: `health:http:${Date.now()}:${this.source}`, source: this.source, eventType: "health", timestamp: Date.now() });
      } catch (error) {
        this.connected = false;
        this.warning = `HTTP fallback falhou: ${(error as Error).message}`;
      }
    }, 5000);
    this.httpFallbackTimer.unref();
  }

  private scheduleReconnect(onEvent: (event: UnifiedTokenEvent) => void) {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      if (this.httpFallbackTimer) {
        clearInterval(this.httpFallbackTimer);
        this.httpFallbackTimer = undefined;
      }
      this.connectWs(onEvent);
    }, 3000);
    this.reconnectTimer.unref();
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

  private log(message: string) {
    console.info(`[${this.source}] ${message}`);
  }
}
