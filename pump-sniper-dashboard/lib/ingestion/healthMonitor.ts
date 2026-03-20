import { DataSource, SourceHealth } from "./types";

export class HealthMonitor {
  private status = new Map<DataSource, SourceHealth>();

  update(health: SourceHealth) {
    this.status.set(health.source, health);
  }

  snapshot(): SourceHealth[] {
    return Array.from(this.status.values());
  }

  combinedWarning(): string | undefined {
    const offline = this.snapshot().filter((item) => !item.connected);
    if (offline.length === 0) return undefined;
    return `Fontes offline: ${offline.map((entry) => entry.source).join(", ")}`;
  }
}
