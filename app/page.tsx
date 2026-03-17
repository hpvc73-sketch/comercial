"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { MonitorState } from "../lib/monitorTypes";

function fmtUsd(n: number) {
  return n.toLocaleString("pt-PT", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}

export default function HomePage() {
  const [state, setState] = useState<MonitorState | null>(null);
  const [riskFilter, setRiskFilter] = useState(70);

  useEffect(() => {
    const events = new EventSource("/api/monitor/events");
    events.onmessage = (event) => {
      setState(JSON.parse(event.data));
    };
    return () => events.close();
  }, []);

  const filteredTokens = useMemo(() => {
    if (!state) return [];
    return state.tokens.filter((t) => t.riskScore <= riskFilter).slice(0, 25);
  }, [riskFilter, state]);

  async function updateSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    await fetch("/api/monitor/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        paperBankrollUsd: Number(formData.get("paperBankrollUsd")),
        strategy: {
          entryUsdSize: Number(formData.get("entryUsdSize")),
          maxRiskScore: Number(formData.get("maxRiskScore")),
          takeProfitPct: Number(formData.get("takeProfitPct")),
          stopLossPct: Number(formData.get("stopLossPct")),
          trailingStopPct: Number(formData.get("trailingStopPct")),
          cooldownSeconds: Number(formData.get("cooldownSeconds")),
          maxTradesPerHour: Number(formData.get("maxTradesPerHour")),
          minBuysPerSecond: Number(formData.get("minBuysPerSecond")),
          minVolumeUsd: Number(formData.get("minVolumeUsd")),
        },
        realTrading: {
          enabled: formData.get("realEnabled") === "on",
          autoExecute: formData.get("realAuto") === "on",
          rpcUrl: String(formData.get("rpcUrl")),
          walletPrivateKey: String(formData.get("walletPrivateKey")),
          maxOrderUsd: Number(formData.get("maxOrderUsd")),
        },
      }),
    });
  }

  if (!state) return <main className="p-8 text-white">A ligar ao stream...</main>;

  return (
    <main className="min-h-screen bg-slate-950 p-6 text-slate-100">
      <h1 className="mb-4 text-3xl font-bold">Pump.fun Monitor + Paper/Real Trading</h1>

      <section className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card title="Saldo virtual" value={fmtUsd(state.balances.paperUsd)} />
        <Card title="PnL diário paper" value={fmtUsd(state.metrics.realizedPnlPaper)} />
        <Card title="Sinais hoje" value={String(state.metrics.totalSignals)} />
        <Card title="Taxa acerto" value={`${state.metrics.wins}/${state.metrics.losses}`} />
      </section>

      <section className="mb-6 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <h2 className="mb-3 text-lg font-semibold">Configuração de estratégia</h2>
        <form className="grid grid-cols-2 gap-3 md:grid-cols-5" onSubmit={updateSettings}>
          <Input name="paperBankrollUsd" label="Banca virtual" defaultValue={state.settings.paperBankrollUsd} />
          <Input name="entryUsdSize" label="Entrada $" defaultValue={state.settings.strategy.entryUsdSize} />
          <Input name="maxRiskScore" label="Risco máximo" defaultValue={state.settings.strategy.maxRiskScore} />
          <Input name="takeProfitPct" label="Take profit %" defaultValue={state.settings.strategy.takeProfitPct} />
          <Input name="stopLossPct" label="Stop loss %" defaultValue={state.settings.strategy.stopLossPct} />
          <Input name="trailingStopPct" label="Trailing %" defaultValue={state.settings.strategy.trailingStopPct ?? 0} />
          <Input name="cooldownSeconds" label="Cooldown (s)" defaultValue={state.settings.strategy.cooldownSeconds} />
          <Input name="maxTradesPerHour" label="Trades/hora" defaultValue={state.settings.strategy.maxTradesPerHour} />
          <Input name="minBuysPerSecond" label="Min buys/s" defaultValue={state.settings.strategy.minBuysPerSecond} />
          <Input name="minVolumeUsd" label="Min volume" defaultValue={state.settings.strategy.minVolumeUsd} />

          <Input name="rpcUrl" label="RPC Solana" defaultValue={state.settings.realTrading.rpcUrl} />
          <Input name="walletPrivateKey" label="Wallet key (JSON array)" defaultValue={state.settings.realTrading.walletPrivateKey} />
          <Input name="maxOrderUsd" label="Max ordem real $" defaultValue={state.settings.realTrading.maxOrderUsd} />

          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="realEnabled" defaultChecked={state.settings.realTrading.enabled} /> Ativar real</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="realAuto" defaultChecked={state.settings.realTrading.autoExecute} /> Auto execução real</label>
          <button className="rounded bg-emerald-600 px-3 py-2 font-semibold" type="submit">Guardar</button>
        </form>
      </section>

      <section className="mb-6 flex items-center gap-2 text-sm">
        <label>Filtro risco ≤ {riskFilter}</label>
        <input type="range" min={0} max={100} value={riskFilter} onChange={(e) => setRiskFilter(Number(e.target.value))} />
      </section>

      <section className="mb-6 overflow-auto rounded-lg border border-slate-800 bg-slate-900">
        <table className="w-full text-sm">
          <thead className="bg-slate-800 text-left">
            <tr>
              <th className="p-2">Token</th><th className="p-2">Preço</th><th className="p-2">Volume</th><th className="p-2">Buys/s</th><th className="p-2">Wallets</th><th className="p-2">Concentração</th><th className="p-2">Risco</th>
            </tr>
          </thead>
          <tbody>
            {filteredTokens.map((t) => (
              <tr key={t.mint} className="border-t border-slate-800">
                <td className="p-2 font-semibold">{t.symbol}</td>
                <td className="p-2">{t.price.toFixed(6)}</td>
                <td className="p-2">{fmtUsd(t.volumeUsd)}</td>
                <td className="p-2">{t.buysPerSecond}</td>
                <td className="p-2">{t.uniqueWallets}</td>
                <td className="p-2">{t.topWalletShare.toFixed(1)}%</td>
                <td className="p-2">{t.riskScore.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <Panel title="Histórico de sinais" items={state.signals.slice(0, 15).map((s) => `${s.tokenSymbol} ${s.side.toUpperCase()} • ${s.reason}`)} />
        <Panel title="Logs" items={state.logs.slice(0, 15)} />
      </section>
    </main>
  );
}

function Card({ title, value }: { title: string; value: string }) {
  return <div className="rounded-lg border border-slate-800 bg-slate-900 p-3"><div className="text-xs text-slate-400">{title}</div><div className="text-xl font-bold">{value}</div></div>;
}

function Panel({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <h3 className="mb-2 font-semibold">{title}</h3>
      <ul className="space-y-1 text-xs text-slate-300">{items.map((i, idx) => <li key={`${i}-${idx}`}>{i}</li>)}</ul>
    </div>
  );
}

function Input({ name, label, defaultValue }: { name: string; label: string; defaultValue: string | number }) {
  return (
    <label className="text-xs">
      {label}
      <input className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2 text-xs" name={name} defaultValue={defaultValue} />
    </label>
  );
}
