# Extractable components

## AppSidebar
- Source: `src/components/app-sidebar.tsx`
- Category: layout
- Description: Persistent app navigation.
- Extractable props: activeItem.
- Hardcoded: navigation labels, icon system, dark shell styling.

## AutoTraderStatusBar
- Source: `src/routes/autotrader.tsx`
- Category: basic
- Description: Mode, balance, P&L and automatic-execution status strip.
- Extractable props: mode, balance, pnl, openTrades, autoEnabled.
- Hardcoded: compact metric styling and status colors.
