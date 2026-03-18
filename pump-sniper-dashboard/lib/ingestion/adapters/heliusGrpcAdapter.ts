import { SourceAdapter, SourceHealth, UnifiedTokenEvent } from "../types";
import { SolanaRpcAdapter } from "./solanaRpcAdapter";

// Optional premium adapter placeholder: if HELIUS_GRPC_WS_URL exists,
// we consume it using websocket-compatible account subscriptions.
export class HeliusGrpcAdapter implements SourceAdapter {
  readonly source = "helius-grpc" as const;
  private delegate?: SolanaRpcAdapter;

  constructor(private wsEndpoint?: string) {
    if (wsEndpoint) this.delegate = new SolanaRpcAdapter(wsEndpoint);
  }

  start(onEvent: (event: UnifiedTokenEvent) => void): void {
    this.delegate?.start((event) => onEvent({ ...event, source: this.source }));
  }

  stop(): void {
    this.delegate?.stop();
  }

  registerMint(mintAddress: string): void {
    this.delegate?.registerMint(mintAddress);
  }

  getHealth(): SourceHealth {
    if (!this.delegate) {
      return {
        source: this.source,
        connected: false,
        warning: "HELIUS_GRPC_WS_URL não configurado",
      };
    }

    const health = this.delegate.getHealth();
    return { ...health, source: this.source };
  }
}
