import { useEffect } from "react";
import { type MarketAlert, useMarketAlert } from "@/hooks/use-market-alert";

export interface MarketAlertState {
  activeAlerts: MarketAlert[];
  notifPermission: NotificationPermission;
  requestPermission: () => Promise<boolean>;
}

interface MarketAlertRuntimeProps {
  onChange: (state: MarketAlertState) => void;
}

/** Lazy runtime: the initial page render must not compete with a market-wide candle scan. */
export function MarketAlertRuntime({ onChange }: MarketAlertRuntimeProps) {
  const state = useMarketAlert(true);

  useEffect(() => {
    onChange(state);
  }, [onChange, state.activeAlerts, state.notifPermission, state.requestPermission]);

  return null;
}
