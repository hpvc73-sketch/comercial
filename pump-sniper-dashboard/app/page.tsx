"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { MonitorState, Signal, TokenSnapshot } from "../lib/monitorTypes";

function fmtUsd(n: number) {
  return n.toLocaleString("pt-PT", { style: "currency", currency: "USD" });
}

function phantomLink(mintAddress: string) {
  return `https://trade.phantom.com/token/${mintAddress}`;
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
  const [freshSignalIds, setFreshSignalIds] = useState<Set<string>>(new Set());
  const seenSignalIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    let mounted = true;
    let polling: ReturnType<typeof setInterval> | null = null;

    const applyState = (incoming: MonitorState) => {
      if (!mounted) return;

      const dedupSignals = Array.from(new Map(incoming.signals.map((signal) => [signal.id, signal])).values()).slice(0, 30);
      const normalized = { ...incoming, signals: dedupSignals };

      const newIds = dedupSignals.filter((signal) => !seenSignalIds.current.has(signal.id)).map((signal) => signal.id);
      dedupSignals.forEach((signal) => seenSignalIds.current.add(signal.id));

      setState(normalized);
      if (newIds.length > 0) {
        setFreshSignalIds((prev) => {
          const next = new Set(prev);
          newIds.forEach((id) => next.add(id));
          return next;
        });

        setTimeout(() => {
          setFreshSignalIds((prev) => {
            const next = new Set(prev);
            newIds.forEach((id) => next.delete(id));
            return next;
          });
        }, 3000);
      }
    };

    fetchState().then((data) => applyState(data)).catch(() => undefined);

    const source = new EventSource("/api/monitor/events");
    source.onopen = () => {
      if (!mounted) return;
      setStatus("connected");
      if (polling) {
        clearInterval(polling);
        polling = null;
      }
    };
    source.onmessage = (ev) => applyState(JSON.parse(ev.data));
    source.onerror = () => {
      if (!mounted) return;
      setStatus("fallback");
      if (!polling) {
        polling = setInterval(async () => {
          try {
            const snapshot = await fetchState();
            applyState(snapshot);
          } catch {
            // keep trying
          }
        }, 900);
      }
    };

    return () => {
      mounted = false;
      source.close();
      if (polling) clearInterval(polling);
    };
  }, []);

  const filteredTokens = useMemo(() => {
    if (!state) return [];
    return state.tokens.filter((token) => token.riskScore !== null && token.riskScore <= riskFilter).slice(0, 30);
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
      }),
    });
  }

  if (!state) return <main style={{ padding: 24 }}>A ligar ao motor de monitorização...</main>;

  const dataBadge = state.dataMode === "live" ? "LIVE REAL DATA" : state.dataMode === "mock" ? "MOCK / DEMO DATA" : "LIVE DATA OFFLINE";

  return (
    <main style={{ padding: 24, maxWidth: 1380, margin: "0 auto", color: "#e2e8f0" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <h1 style={{ marginBottom: 8 }}>Pump Sniper Dashboard</h1>
        <div className={state.dataMode === "live" ? "mode-badge live" : "mode-badge warn"}>{dataBadge}</div>
      </div>
      <p style={{ opacity: 0.85, marginTop: 0 }}>Status stream: {status === "connected" ? "SSE live" : "Fallback polling"}</p>
      {state.dataWarning ? <p className="warning-box">⚠ {state.dataWarning}</p> : null}

      <section style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 12, marginBottom: 18 }}>
        <Card label="Saldo virtual" value={fmtUsd(state.balances.paperUsd)} />
        <Card label="PnL paper diário" value={fmtUsd(state.metrics.realizedPnlPaper)} />
        <Card label="Sinais diários" value={String(state.metrics.totalSignals)} />
        <Card label="Trades paper diários" value={String(state.metrics.paperTrades)} />
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
            <th align="left">Fonte</th>
            <th align="left">Estado</th>
          </tr>
        </thead>
        <tbody>
          {filteredTokens.map((token) => <TokenRow key={token.mintAddress} token={token} />)}
        </tbody>
      </table>

      <section style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 12 }}>
        <SignalsPanel signals={state.signals.slice(0, 30)} freshSignalIds={freshSignalIds} />
        <Panel title="Trades" items={state.tradeHistory.slice(0, 20).map((trade) => `${trade.side.toUpperCase()} ${trade.tokenSymbol} (${trade.tokenName}) PnL ${fmtUsd(trade.pnlUsd)}`)} />
        <Panel title="Logs" items={state.logs.slice(0, 20)} />
      </section>
    </main>
  );
}

function TokenRow({ token }: { token: TokenSnapshot }) {
  return (
    <tr style={{ borderTop: "1px solid #1e293b" }}>
      <td>
        <a className="token-link" href={phantomLink(token.mintAddress)} target="_blank" rel="noreferrer">
          <strong>{token.symbol}</strong> <span style={{ opacity: 0.8 }}>({token.name})</span>
        </a>
        <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>
          <a className="mint-link" href={phantomLink(token.mintAddress)} target="_blank" rel="noreferrer">{token.mintAddress}</a>
        </div>
      </td>
      <td>{token.price.toFixed(8)}</td>
      <td>{fmtUsd(token.volumeUsd)}</td>
      <td>{token.buysPerSecond.toFixed(2)}</td>
      <td>{token.uniqueWallets}</td>
      <td>{token.topWalletShare === null ? "N/A" : `${token.topWalletShare.toFixed(1)}%`}</td>
      <td>{token.riskScore === null ? "N/A" : token.riskScore.toFixed(1)}</td>
      <td><span className="badge-source">{token.source}</span><div style={{fontSize:11,opacity:0.8}}>first: {token.firstDetectedSource}</div></td>
      <td><span className={token.confirmationStatus === "confirmed" ? "badge-confirmed" : "badge-unconfirmed"}>{token.discoveryStatus} · {token.confirmationStatus}</span><div style={{fontSize:11,opacity:0.8}}>Δsol-pump: {token.sourceLatencyMs["solana-rpc"] !== undefined && token.sourceLatencyMs["pumpportal"] !== undefined ? `${token.sourceLatencyMs["solana-rpc"] - token.sourceLatencyMs["pumpportal"]}ms` : "N/A"}</div></td>
    </tr>
  );
}

function SignalsPanel({ signals, freshSignalIds }: { signals: Signal[]; freshSignalIds: Set<string> }) {
  return (
    <div style={{ border: "1px solid #334155", borderRadius: 8, padding: 10, background: "#0f172a" }}>
      <h3 style={{ marginTop: 0 }}>Sinais (real tokens only)</h3>
      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
        {signals.map((signal) => {
          const isFresh = freshSignalIds.has(signal.id);
          return (
            <li key={signal.id} className={isFresh ? "signal-item signal-fresh" : "signal-item"}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 6 }}>
                <a className="token-link" href={phantomLink(signal.mintAddress)} target="_blank" rel="noreferrer">
                  <strong>{signal.tokenSymbol}</strong> <span style={{ opacity: 0.8 }}>({signal.tokenName})</span>
                </a>
                <span style={{ opacity: 0.8 }}>{new Date(signal.createdAt).toLocaleTimeString("pt-PT")}</span>
              </div>
              <a className="mint-link" href={phantomLink(signal.mintAddress)} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>
                {signal.mintAddress}
              </a>
              <div style={{ marginTop: 4, fontSize: 13 }}>
                buys/s <strong>{signal.buysPerSecond.toFixed(2)}</strong> · risco <strong>{signal.riskScore === null ? "N/A" : signal.riskScore.toFixed(1)}</strong> · volume <strong>{fmtUsd(signal.volumeUsd)}</strong> · fonte <strong>{signal.source}</strong> · status <strong>{signal.confirmationStatus}</strong>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
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
      <ul>{items.map((item, idx) => <li key={`${item}-${idx}`}>{item}</li>)}</ul>
    </div>
  );
}
