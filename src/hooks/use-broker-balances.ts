import { useEffect, useState } from "react";
import { api } from "@/lib/api";

export type BrokerBalances = {
  deriv: { balance: number; currency: string } | null;
  kraken: { balance: number; currency: string } | null;
  binance: { balance: number; currency: string } | null;
  oanda: { balance: number; currency: string } | null;
};

/** Polls /api/bot for every broker's live balance — shared by the Dashboard and Portfolio pages. */
export function useBrokerBalances() {
  const [balances, setBalances] = useState<BrokerBalances | null>(null);
  useEffect(() => {
    const refresh = () => {
      api.get<{ brokerBalances?: BrokerBalances }>("/api/bot").then((d) => {
        if (d.brokerBalances) setBalances(d.brokerBalances);
      }).catch(() => {});
    };
    refresh();
    const id = setInterval(refresh, 10_000);
    return () => clearInterval(id);
  }, []);
  return balances;
}
