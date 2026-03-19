"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MonitorState, Signal, TokenSnapshot } from "../lib/monitorTypes";

function fmtUsd(n: number | null | undefined) {
  if (typeof n !== "number" || Number.isNaN(n)) return "N/A";
  return n.toLocaleString("pt-PT", { style: "currency", currency: "USD" });
}

function fmtNumber(n: number | null | undefined, digits = 2) {
  if (typeof n !== "number" || Number.isNaN(n)) return "N/A";
  return n.toFixed(digits);
}

function phantomLink(mintAddress: string) {
  return `https://trade.phantom.com/token/${mintAddress}`;
}

function isVisibleMainRow(token: TokenSnapshot) {
  const hasUsefulMetric = token.price !== null || token.volumeUsd !== null || token.buysPerSecond !== null || token.uniqueWallets !== null;
  const hasKnownMetadata =
    (token.symbol && token.symbol.toUpperCase() !== "UNKNOWN") ||
    (token.name && token.name.toLowerCase() !== "unknown token");
  const hasKnownAge = token.ageSource !== "unknown" && token.realTokenAgeSeconds !== null;
  const meaningful =
    token.lifecycle === "enriched" ||
    token.lifecycle === "tradable" ||
    token.parsedTradeCount >= 1 ||
    token.parsedTradesTotal >= 1 ||
    (hasKnownMetadata && hasKnownAge && hasUsefulMetric);
  const emptyWeak =
    !hasKnownMetadata &&
    !hasKnownAge &&
    token.price === null &&
    token.volumeUsd === null &&
    token.buysPerSecond === null &&
    token.parsedTradeCount === 0;

  return token.visibleInMain && meaningful && !emptyWeak;
}

async function fetchState(): Promise<MonitorState> {
  const res = await fetch("/api/monitor/state", { cache: "no-store" });
  if (!res.ok) throw new Error("Falha a obter estado");
  return res.json();
}

export default function HomePage() {
  const [state, setState] = useState<MonitorState | null>(null);
  const [riskFilter, setRiskFilter] = useState(70);
  const [maxAgeFilter, setMaxAgeFilter] = useState(60);
  const [resultCount, setResultCount] = useState(20);
  const [showDiscovered, setShowDiscovered] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [onlyTradable, setOnlyTradable] = useState(false);
  const [onlyEnriched, setOnlyEnriched] = useState(false);
  const [hideExpiredRejected, setHideExpiredRejected] = useState(true);
  const [sourceFilter, setSourceFilter] = useState<"all" | "pumpportal" | "merged" | "helius-enriched">("all");
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
      setStatus("connecting");
      if (polling) {
        clearInterval(polling);
        polling = null;
      }
    };
    source.onmessage = (ev) => {
      const next = JSON.parse(ev.data) as MonitorState;
      if (next.streamStats.receivedSinceStartup > 0) setStatus("connected");
      applyState(next);
    };
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

  const { filteredTokens, hiddenTokens, filteredOut, filterDebug } = useMemo(() => {
    if (!state) {
      return {
        filteredTokens: [],
        hiddenTokens: [],
        filteredOut: 0,
        filterDebug: { risk: 0, state: 0, source: 0, weak: 0 },
      };
    }

    let excludedByRisk = 0;
    let excludedByState = 0;
    let excludedBySource = 0;
    let excludedByWeak = 0;

    const visible: TokenSnapshot[] = [];
    const hidden: TokenSnapshot[] = [];

    for (const token of state.tokens) {
      if (!token.isValidPumpCandidate) continue;
      if (!isVisibleMainRow(token)) {
        excludedByWeak += 1;
        hidden.push(token);
        continue;
      }
      if (hideExpiredRejected && (token.lifecycle === "expired" || token.lifecycle === "rejected")) {
        excludedByState += 1;
        hidden.push(token);
        continue;
      }
      if (!showDiscovered && token.lifecycle === "discovered") {
        excludedByState += 1;
        hidden.push(token);
        continue;
      }
      if (onlyTradable && token.lifecycle !== "tradable") {
        excludedByState += 1;
        hidden.push(token);
        continue;
      }
      if (onlyEnriched && !["enriched", "tradable"].includes(token.lifecycle)) {
        excludedByState += 1;
        hidden.push(token);
        continue;
      }
      if (sourceFilter !== "all" && token.sourceCategory !== sourceFilter) {
        excludedBySource += 1;
        hidden.push(token);
        continue;
      }
      if (token.realTokenAgeSeconds !== null && token.realTokenAgeSeconds > maxAgeFilter) {
        excludedByState += 1;
        hidden.push(token);
        continue;
      }
      if (token.riskScore === null) {
        visible.push(token);
        continue;
      }
      const include = token.riskScore <= riskFilter;
      if (!include) {
        excludedByRisk += 1;
        hidden.push(token);
        continue;
      }
      visible.push(token);
    }

    console.debug(
      `[table-filter] excluded risk=${excludedByRisk} state=${excludedByState} source=${excludedBySource} weak=${excludedByWeak}`,
    );

    return {
      filteredTokens: visible.sort((a, b) => b.lastMetricUpdateAt - a.lastMetricUpdateAt).slice(0, resultCount),
      hiddenTokens: hidden.sort((a, b) => b.lastMetricUpdateAt - a.lastMetricUpdateAt),
      filteredOut: excludedByRisk + excludedByState + excludedBySource + excludedByWeak,
      filterDebug: {
        risk: excludedByRisk,
        state: excludedByState,
        source: excludedBySource,
        weak: excludedByWeak,
      },
    };
  }, [state, riskFilter, maxAgeFilter, resultCount, showDiscovered, hideExpiredRejected, onlyTradable, onlyEnriched, sourceFilter]);

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
      <p style={{ fontSize: 12, opacity: 0.9 }}>
        last token received: <strong>{new Date(state.streamStats.lastTokenReceivedAt).toLocaleTimeString("pt-PT")}</strong> · last live update:{" "}
        <strong>{new Date(state.streamStats.lastLiveUpdateAt).toLocaleTimeString("pt-PT")}</strong> · since startup:{" "}
        <strong>{state.streamStats.receivedSinceStartup}</strong> · last 60s: <strong>{state.streamStats.receivedLast60s}</strong>
      </p>

      <div style={{ display: "flex", gap: 16, marginBottom: 10, fontSize: 13, opacity: 0.9 }}>
        <span>tokens discovered: <strong>{state.tokens.length}</strong></span>
        <span>tokens shown: <strong>{filteredTokens.length}</strong></span>
        <span>tokens filtered out: <strong>{filteredOut}</strong> (risk {filterDebug.risk}, state {filterDebug.state}, source {filterDebug.source}, weak {filterDebug.weak})</span>
      </div>

      <section style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        {state.sourceHealth.map((source) => <SourceHealthBadge key={source.source} source={source} />)}
      </section>

      <section style={{ marginBottom: 12, fontSize: 12, opacity: 0.85 }}>
        <div>env detected: {state.diagnostics.detectedEnv.join(", ") || "none"}</div>
        <div>providers initialized: {state.diagnostics.providersInitialized.join(", ") || "none"}</div>
        <div>providers skipped: {state.diagnostics.providersSkipped.join(", ") || "none"}</div>
      </section>
      <section style={{ border: "1px solid #334155", borderRadius: 8, padding: 12, marginBottom: 12, background: "#0f172a" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 10, alignItems: "end" }}>
          <label style={{ display: "grid", gap: 4 }}>
            <small>source mode</small>
            <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value as "all" | "pumpportal" | "merged" | "helius-enriched")}>
              <option value="all">all</option>
              <option value="pumpportal">pumpportal</option>
              <option value="merged">merged</option>
              <option value="helius-enriched">helius-enriched</option>
            </select>
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            <small>result count</small>
            <select value={resultCount} onChange={(e) => setResultCount(Number(e.target.value))}>
              {[10, 20, 50, 100].map((count) => <option key={count} value={count}>{count}</option>)}
            </select>
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            <small>risk max ≤ {riskFilter}</small>
            <input type="range" min={0} max={100} value={riskFilter} onChange={(e) => setRiskFilter(Number(e.target.value))} />
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            <small>age max {maxAgeFilter}s</small>
            <input type="range" min={10} max={120} step={5} value={maxAgeFilter} onChange={(e) => setMaxAgeFilter(Number(e.target.value))} />
          </label>
        </div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 10, fontSize: 13 }}>
          <label><input type="checkbox" checked={onlyTradable} onChange={(e) => setOnlyTradable(e.target.checked)} /> only tradable</label>
          <label><input type="checkbox" checked={onlyEnriched} onChange={(e) => setOnlyEnriched(e.target.checked)} /> only enriched</label>
          <label><input type="checkbox" checked={!showDiscovered} onChange={(e) => setShowDiscovered(!e.target.checked)} /> hide discovered</label>
          <label><input type="checkbox" checked={hideExpiredRejected} onChange={(e) => setHideExpiredRejected(e.target.checked)} /> hide expired/rejected</label>
          <label><input type="checkbox" checked={showDebug} onChange={(e) => setShowDebug(e.target.checked)} /> show debug</label>
          <span>auto refresh: <strong>{status === "connected" ? "SSE live" : "fallback polling"}</strong></span>
        </div>
      </section>

      <table width="100%" cellPadding={6} style={{ borderCollapse: "collapse", marginBottom: 18 }}>
        <thead>
          <tr>
            <th align="left">Token</th>
            <th align="left">Source</th>
            <th align="left">Age</th>
            <th align="left">Price</th>
            <th align="left">Volume</th>
            <th align="left">Buys/s</th>
            <th align="left">Wallets</th>
            <th align="left">Parsed trades</th>
            <th align="left">Lifecycle</th>
            <th align="left">Status</th>
          </tr>
        </thead>
        <tbody>
          {filteredTokens.map((token) => <TokenRow key={token.mintAddress} token={token} />)}
        </tbody>
      </table>
      {showDebug ? (
        <details style={{ marginBottom: 18 }} open={false}>
          <summary style={{ cursor: "pointer", marginBottom: 8 }}>Discovery / Debug (hidden tokens: {hiddenTokens.length})</summary>
          <ul>
            {hiddenTokens.slice(0, 50).map((token) => (
              <li key={`debug-${token.mintAddress}`}>
                {token.symbol} ({token.mintAddress.slice(0, 6)}...) · lifecycle={token.lifecycle} · reason={token.rejectionReason ?? "filtered"} · ageSource={token.ageSource} · metadata={token.metadataSource} · last={new Date(token.lastMetricUpdateAt).toLocaleTimeString("pt-PT")}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <section style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 12 }}>
        <SignalsPanel signals={state.signals.slice(0, 30)} freshSignalIds={freshSignalIds} />
        <Panel title="Trades" items={state.tradeHistory.slice(0, 20).map((trade) => `${trade.side.toUpperCase()} ${trade.tokenSymbol} (${trade.tokenName}) PnL ${fmtUsd(trade.pnlUsd)}`)} />
        <Panel title="Logs" items={state.logs.slice(0, 20)} />
      </section>
    </main>
  );
}

function TokenRow({ token }: { token: TokenSnapshot }) {
  const rowBg =
    token.freshness === "fresh" ? "#052e16" : token.freshness === "aging" ? "transparent" : token.freshness === "unknown" ? "#111827" : "#3f1d1d";
  return (
    <tr style={{ borderTop: "1px solid #1e293b", background: rowBg }}>
      <td>
        <a className="token-link" href={phantomLink(token.mintAddress)} target="_blank" rel="noreferrer">
          <strong>{token.symbol}</strong> <span style={{ opacity: 0.8 }}>({token.name})</span>
        </a>
        <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>
          <a className="mint-link" href={phantomLink(token.mintAddress)} target="_blank" rel="noreferrer">{token.mintAddress}</a>
        </div>
      </td>
      <td><span className="badge-source">{token.sourceCategory}</span></td>
      <td>
        {formatAge(token.realTokenAgeSeconds, token.realAgeQuality)}
        <div style={{ fontSize: 11, opacity: 0.8 }}>
          <span className="badge-source">{token.ageSource}</span>
        </div>
      </td>
      <td>{fmtNumber(token.price, 8)}</td>
      <td>{fmtUsd(token.volumeUsd)}</td>
      <td>{fmtNumber(token.buysPerSecond, 2)}</td>
      <td>{token.uniqueWallets ?? "N/A"}</td>
      <td>{token.parsedTradeCount}</td>
      <td>
        <strong>{token.lifecycle}</strong>
      </td>
      <td>
        <span className={token.confirmationStatus === "confirmed" ? "badge-confirmed" : "badge-unconfirmed"}>
          {token.confirmationStatus}
        </span>
      </td>
    </tr>
  );
}

function formatAge(seconds: number | null, quality: "exact" | "estimated" | "unknown") {
  if (seconds === null) return "unknown";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rem = seconds % 60;
  const base = rem === 0 ? `${minutes}m` : `${minutes}m ${rem}s`;
  return quality === "estimated" ? `~${base}` : base;
}

function SignalsPanel({ signals, freshSignalIds }: { signals: Signal[]; freshSignalIds: Set<string> }) {
  return (
    <div style={{ border: "1px solid #334155", borderRadius: 8, padding: 10, background: "#0f172a" }}>
      <h3 style={{ marginTop: 0 }}>Sinais (live state)</h3>
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
                <strong>{signal.category}</strong> · buys/s <strong>{fmtNumber(signal.buysPerSecond, 2)}</strong> · price <strong>{fmtNumber(signal.price, 8)}</strong> · risco <strong>{signal.riskScore === null ? "N/A" : signal.riskScore.toFixed(1)}</strong> · volume <strong>{fmtUsd(signal.volumeUsd)}</strong> · parsed trades <strong>{signal.parsedTradeCount}</strong> · fonte <strong>{signal.source}</strong> · status <strong>{signal.confirmationStatus}</strong>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}


function SourceHealthBadge({ source }: { source: MonitorState["sourceHealth"][number] }) {
  return (
    <span className={source.connected ? "badge-confirmed" : "badge-unconfirmed"} title={source.warning ?? ""}>
      {source.source}: {source.connected ? "ONLINE" : "OFFLINE"}
    </span>
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
