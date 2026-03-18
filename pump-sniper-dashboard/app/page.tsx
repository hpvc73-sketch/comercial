"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { MonitorState } from "../lib/monitorTypes";

function fmtUsd(n: number) {
  return n.toLocaleString("pt-PT", { style: "currency", currency: "USD" });
}

async function fetchState(): Promise<MonitorState> {
  const res = await fetch("/api/monitor/state", { cache: "no-store" });
  if (!res.ok) throw new Error("Falha a obter estado");
  return res.json();
}

export default function HomePage() {
  const [state, setState] = useState<MonitorState | null>(null);
  const [riskFilter, setRiskFilter] = useState(70);
  const [status, setStatus] = useState<"connecting" | "connected" | "fallback">("connecting");

  useEffect(() => {
    let mounted = true;
    let polling: ReturnType<typeof setInterval> | null = null;

    fetchState().then((data) => mounted && setState(data)).catch(() => undefined);

    const source = new EventSource("/api/monitor/events");
    source.onopen = () => {
      if (!mounted) return;
      setStatus("connected");
      if (polling) {
        clearInterval(polling);
        polling = null;
      }
    };
    source.onmessage = (ev) => mounted && setState(JSON.parse(ev.data));
    source.onerror = () => {
      if (!mounted) return;
      setStatus("fallback");
      if (!polling) {
        polling = setInterval(async () => {
          try {
            const snapshot = await fetchState();
            if (mounted) setState(snapshot);
          } catch {
            // continue
          }
        }, 2000);
      }
    };

    return () => {
      mounted = false;
      source.close();
      if (polling) clearInterval(polling);
    };
  }, []);

  const filtered = useMemo(() => {
    if (!state) return [];
    return state.tokens.filter((t) => t.riskScore <= riskFilter).slice(0, 30);
  }, [state, riskFilter]);

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);

    await fetch("/api/monitor/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        paperBankrollUsd: Number(fd.get("paperBankrollUsd")),
        strategy: {
          entryUsdSize: Number(fd.get("entryUsdSize")),
          maxRiskScore: Number(fd.get("maxRiskScore")),
          takeProfitPct: Number(fd.get("takeProfitPct")),
          stopLossPct: Number(fd.get("stopLossPct")),
          trailingStopPct: Number(fd.get("trailingStopPct")),
          cooldownSeconds: Number(fd.get("cooldownSeconds")),
          maxTradesPerHour: Number(fd.get("maxTradesPerHour")),
          minBuysPerSecond: Number(fd.get("minBuysPerSecond")),
          minVolumeUsd: Number(fd.get("minVolumeUsd")),
        },
        realTrading: {
          enabled: fd.get("realEnabled") === "on",
          autoExecute: fd.get("realAuto") === "on",
          rpcUrl: String(fd.get("rpcUrl")),
          walletPrivateKey: String(fd.get("walletPrivateKey")),
          maxOrderUsd: Number(fd.get("maxOrderUsd")),
        },
      }),
    });
  }

  if (!state) {
    return <main style={{ padding: 24 }}>A ligar ao motor de monitorização...</main>;
  }

  return (
    <main style={{ padding: 24, maxWidth: 1300, margin: "0 auto" }}>
      <h1 style={{ marginBottom: 8 }}>Pump Sniper Dashboard</h1>
      <p style={{ opacity: 0.85, marginTop: 0 }}>Status: {status === "connected" ? "Tempo real (SSE)" : "Fallback polling"}</p>

      <section style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 12, marginBottom: 18 }}>
        <Card label="Saldo virtual" value={fmtUsd(state.balances.paperUsd)} />
        <Card label="PnL paper diário" value={fmtUsd(state.metrics.realizedPnlPaper)} />
        <Card label="Sinais diários" value={String(state.metrics.totalSignals)} />
        <Card label="Trades reais diários" value={String(state.metrics.realTrades)} />
      </section>

      <form onSubmit={saveSettings} style={{ display: "grid", gridTemplateColumns: "repeat(5,minmax(0,1fr))", gap: 10, marginBottom: 14 }}>
        <Input name="paperBankrollUsd" label="Banca virtual" defaultValue={state.settings.paperBankrollUsd} />
        <Input name="entryUsdSize" label="Entrada $" defaultValue={state.settings.strategy.entryUsdSize} />
        <Input name="maxRiskScore" label="Risco máx." defaultValue={state.settings.strategy.maxRiskScore} />
        <Input name="takeProfitPct" label="Take profit %" defaultValue={state.settings.strategy.takeProfitPct} />
        <Input name="stopLossPct" label="Stop loss %" defaultValue={state.settings.strategy.stopLossPct} />
        <Input name="trailingStopPct" label="Trailing %" defaultValue={state.settings.strategy.trailingStopPct ?? 0} />
        <Input name="cooldownSeconds" label="Cooldown (s)" defaultValue={state.settings.strategy.cooldownSeconds} />
        <Input name="maxTradesPerHour" label="Trades / hora" defaultValue={state.settings.strategy.maxTradesPerHour} />
        <Input name="minBuysPerSecond" label="Min buys/s" defaultValue={state.settings.strategy.minBuysPerSecond} />
        <Input name="minVolumeUsd" label="Volume mínimo" defaultValue={state.settings.strategy.minVolumeUsd} />

        <Input name="rpcUrl" label="RPC URL" defaultValue={state.settings.realTrading.rpcUrl} />
        <Input name="walletPrivateKey" label="Wallet key JSON" defaultValue={state.settings.realTrading.walletPrivateKey} />
        <Input name="maxOrderUsd" label="Ordem real máx $" defaultValue={state.settings.realTrading.maxOrderUsd} />

        <label><input type="checkbox" name="realEnabled" defaultChecked={state.settings.realTrading.enabled} /> Ativar real</label>
        <label><input type="checkbox" name="realAuto" defaultChecked={state.settings.realTrading.autoExecute} /> Auto real</label>
        <button type="submit">Guardar</button>
      </form>

      <div style={{ marginBottom: 10 }}>
        <label>Filtro de risco ≤ {riskFilter} </label>
        <input type="range" min={0} max={100} value={riskFilter} onChange={(e) => setRiskFilter(Number(e.target.value))} />
      </div>

      <table width="100%" cellPadding={6} style={{ borderCollapse: "collapse", marginBottom: 18 }}>
        <thead>
          <tr>
            <th align="left">Token</th>
            <th align="left">Preço</th>
            <th align="left">Volume</th>
            <th align="left">Buys/s</th>
            <th align="left">Wallets</th>
            <th align="left">Concentração</th>
            <th align="left">Risco</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((t) => (
            <tr key={t.mint} style={{ borderTop: "1px solid #1e293b" }}>
              <td>{t.symbol}</td>
              <td>{t.price.toFixed(6)}</td>
              <td>{fmtUsd(t.volumeUsd)}</td>
              <td>{t.buysPerSecond}</td>
              <td>{t.uniqueWallets}</td>
              <td>{t.topWalletShare.toFixed(1)}%</td>
              <td>{t.riskScore.toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <section style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 12 }}>
        <Panel title="Sinais" items={state.signals.slice(0, 15).map((s) => `${s.tokenSymbol} ${s.side.toUpperCase()} - ${s.reason}`)} />
        <Panel title="Trades" items={state.tradeHistory.slice(0, 15).map((t) => `${t.mode.toUpperCase()} ${t.side.toUpperCase()} ${t.tokenSymbol} PnL ${fmtUsd(t.pnlUsd)}`)} />
        <Panel title="Logs" items={state.logs.slice(0, 15)} />
      </section>
    </main>
  );
}

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ border: "1px solid #334155", borderRadius: 8, padding: 10, background: "#0f172a" }}>
      <div style={{ fontSize: 12, opacity: 0.75 }}>{label}</div>
      <strong>{value}</strong>
    </div>
  );
}

function Input({ name, label, defaultValue }: { name: string; label: string; defaultValue: string | number }) {
  return (
    <label style={{ display: "grid", gap: 4 }}>
      <small>{label}</small>
      <input name={name} defaultValue={defaultValue} style={{ padding: 6, borderRadius: 6 }} />
    </label>
  );
}

function Panel({ title, items }: { title: string; items: string[] }) {
  return (
    <div style={{ border: "1px solid #334155", borderRadius: 8, padding: 10, background: "#0f172a" }}>
      <h3>{title}</h3>
      <ul>
        {items.map((item, idx) => (
          <li key={`${item}-${idx}`}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
