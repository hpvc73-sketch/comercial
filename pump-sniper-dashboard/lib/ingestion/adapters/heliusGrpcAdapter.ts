import { SourceAdapter, SourceHealth, UnifiedTokenEvent } from "../types";
import { SolanaRpcAdapter } from "./solanaRpcAdapter";

// Optional premium adapter placeholder: if HELIUS endpoint exists,
// consume it via websocket logs subscription (same schema as RPC logsSubscribe).
export class HeliusGrpcAdapter implements SourceAdapter {
  readonly source = "helius-grpc" as const;
  private delegate?: SolanaRpcAdapter;

  constructor(private wsEndpoint: string | undefined, private pumpProgramId: string) {
    if (wsEndpoint) this.delegate = new SolanaRpcAdapter(wsEndpoint, pumpProgramId, "helius-grpc");
  }

  start(onEvent: (event: UnifiedTokenEvent) => void): void {
    this.delegate?.start(onEvent);
  }

  stop(): void {
    this.delegate?.stop();
  }

  getHealth(): SourceHealth {
    if (!this.delegate) {
      return {
        source: this.source,
        connected: false,
        warning: "HELIUS_GRPC_WS_URL/HELIUS_API_KEY não configurado",
      };
    }

    const health = this.delegate.getHealth();
    return { ...health, source: this.source };
  }
}
