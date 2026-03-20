import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pump Sniper Dashboard",
  description: "Monitorização Pump.fun em tempo real com paper trading e execução real opcional.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-PT">
      <body style={{ background: "#020617", color: "#e2e8f0" }}>{children}</body>
    </html>
  );
}
