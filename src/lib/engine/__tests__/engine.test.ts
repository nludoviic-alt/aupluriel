import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateMarketData } from '../data-quality-guard.js';
import { analyzeMarketRegime } from '../market-regime-analyst.js';
import { evaluateRisk } from '../risk-manager.js';
import { CircuitBreaker } from '../circuit-breaker.js';
import { evaluateExit } from '../exit-engine.js';
import { EngineOrchestrator } from '../orchestrator.js';

test('Data Quality Guard - validates candles', () => {
  const result = validateMarketData('1HZ75V', []);
  assert.equal(result.status, 'INVALID');
});

test('Market Regime Analyst - classifies trending bull', () => {
  const candles = [
    { open: 100, high: 102, low: 99, close: 100 },
    { open: 100, high: 103, low: 100, close: 101 },
    { open: 101, high: 104, low: 101, close: 102 },
    { open: 102, high: 105, low: 102, close: 103 },
    { open: 103, high: 106, low: 103, close: 105 },
  ];
  const regime = analyzeMarketRegime(candles);
  assert.equal(regime.regime, 'TRENDING_BULL');
});

test('Risk Manager - approves valid signal', () => {
  const signal = {
    id: 'sig-1',
    symbol: '1HZ75V',
    action: 'BUY' as const,
    confidence: 85,
    tfAgreement: 4,
    entryPrice: 100,
  };
  const params = {
    maxDailyDrawdown: 100,
    maxOpenPositions: 3,
    minConfidence: 75,
    minTfAgreement: 4,
    stake: 10,
  };
  const res = evaluateRisk(signal, params, 0, 0);
  assert.equal(res.approved, true);
});

test('Circuit Breaker - trips after 3 consecutive losses', () => {
  const cb = new CircuitBreaker(3, 60000);
  assert.equal(cb.isTripped(), false);
  cb.recordTrade(-10);
  cb.recordTrade(-10);
  assert.equal(cb.isTripped(), false);
  cb.recordTrade(-10);
  assert.equal(cb.isTripped(), true);
});

test('Exit Engine - evaluates take profit', () => {
  const pos = {
    id: 'p-1',
    symbol: '1HZ75V',
    entryPrice: 100,
    currentPrice: 110,
    action: 'BUY' as const,
    takeProfit: 105,
    openedAt: Date.now(),
  };
  const res = evaluateExit(pos);
  assert.equal(res.shouldExit, true);
  assert.equal(res.reason, 'TAKE_PROFIT_HIT');
});

test('Engine Orchestrator - processes signal cleanly', () => {
  const orch = new EngineOrchestrator();
  const nowSec = Math.floor(Date.now() / 1000);
  const candles = [
    { epoch: nowSec - 200, open: 100, high: 102, low: 99, close: 100 },
    { epoch: nowSec - 150, open: 100, high: 103, low: 100, close: 101 },
    { epoch: nowSec - 100, open: 101, high: 104, low: 101, close: 102 },
    { epoch: nowSec - 50, open: 102, high: 105, low: 102, close: 103 },
    { epoch: nowSec, open: 103, high: 106, low: 103, close: 105 },
  ];
  const output = orch.processSignal({
    symbol: '1HZ75V',
    candles,
    signal: {
      id: 's-1',
      symbol: '1HZ75V',
      action: 'BUY',
      confidence: 85,
      tfAgreement: 4,
      entryPrice: 105,
    },
    riskParams: {
      maxDailyDrawdown: 100,
      maxOpenPositions: 3,
      minConfidence: 75,
      minTfAgreement: 4,
      stake: 10,
    },
    openPositionsCount: 0,
    dailyDrawdown: 0,
  });

  assert.equal(output.status, 'EXECUTED');
});
