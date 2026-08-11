import { adx, atr, bollinger, ema, rsi } from "./indicators";
import type { ServerCandle } from "./deriv.server";

export type Rb100Strategy = "RB100_RANGE_TRADER" | "RB100_BREAKOUT_RETEST" | "RB100_BREAKOUT_DIRECT";
export type Rb100Reject = "INVALID_RANGE" | "MID_RANGE" | "NO_REJECTION" | "LOW_SCORE" | "HIGH_BREAKOUT_RISK" | "FAKE_BREAKOUT" | "NO_RETEST" | "EXTREME_VOLATILITY";
export interface Rb100Signal { strategy: Rb100Strategy; direction: "CALL" | "PUT"; confidence: number; riskAbs: number; rewardAbs: number; riskPct: number; volatilityPct: number; reason: string; diagnostics: Record<string, number | string>; }
export interface Rb100Decision { signal?: Rb100Signal; rejection?: { reason: Rb100Reject; score: number; diagnostics: Record<string, number | string> }; }
const last = <T,>(x: T[]) => x[x.length - 1]; const num = (x: number | null | undefined) => x ?? NaN;

/** RB100 has two mutually-exclusive modes: mean reversion only at validated
 * boundaries, then breakout/retest once pressure invalidates the range. */
export function generateRb100Signal(m15: ServerCandle[], m5: ServerCandle[], m1: ServerCandle[], ticks: number[] = []): Rb100Decision {
  if (m15.length < 55 || m5.length < 55 || m1.length < 45) return { rejection: { reason: "INVALID_RANGE", score: 0, diagnostics: { detail: "Historique insuffisant" } } };
  const close5=m5.map(x=>x.close), high5=m5.map(x=>x.high), low5=m5.map(x=>x.low), close1=m1.map(x=>x.close), high1=m1.map(x=>x.high), low1=m1.map(x=>x.low);
  const current=last(m1), rangeBars=m5.slice(-30,-1), hi=Math.max(...rangeBars.map(x=>x.high)), lo=Math.min(...rangeBars.map(x=>x.low)), width=hi-lo;
  const atrs=atr(high1,low1,close1,14), a=num(last(atrs)), avg=atrs.slice(-30,-1).filter((x):x is number=>x!==null).reduce((s,x,_,ar)=>s+x/ar.length,0), ratio=a/Math.max(avg,Number.EPSILON);
  const ad=num(last(adx(high5,low5,close5,14).adx)), rr=num(last(rsi(close1,14))), e20=num(last(ema(close1,20))), e50=num(last(ema(close1,50)));
  const bb=bollinger(close1,20,2), bbw=(num(last(bb.upper))-num(last(bb.lower)))/Math.max(current.close,Number.EPSILON);
  const touchesHi=rangeBars.filter(x=>x.high>=hi-a*.25).length, touchesLo=rangeBars.filter(x=>x.low<=lo+a*.25).length;
  const tail=ticks.slice(-30), momentum=tail.length>10?tail.at(-1)!-tail[0]:0, velocity=tail.length>10?momentum/tail.length:0;
  const zone=(current.close-lo)/Math.max(width,Number.EPSILON), rangeValid=touchesHi>=2&&touchesLo>=2&&ad<=22&&width>=a*3;
  const body=Math.abs(current.close-current.open), candleRange=Math.max(current.high-current.low,Number.EPSILON);
  const upBreak=current.close>hi&&body>=candleRange*.55&&momentum>0, downBreak=current.close<lo&&body>=candleRange*.55&&momentum<0;
  const pressure=Math.min(100, Math.round((Math.max(touchesHi,touchesLo)*10)+(ratio>1.3?25:0)+(Math.abs(momentum)>a*.08?25:0)+(ad>22?20:0)));
  const diagnostics={ regime: upBreak||downBreak?"BREAKOUT_CONFIRMED":rangeValid?"RANGE_STABLE":"INVALID_RANGE", rangeHigh:+hi.toFixed(5),rangeLow:+lo.toFixed(5),rangeWidth:+width.toFixed(5),touchesHigh:touchesHi,touchesLow:touchesLo,adx:+ad.toFixed(2),atrRatio:+ratio.toFixed(2),bbWidth:+bbw.toFixed(5),breakoutRisk:pressure,tickMomentum:+momentum.toFixed(5),tickVelocity:+velocity.toFixed(5) };
  if (ratio>1.7) return { rejection:{reason:"EXTREME_VOLATILITY",score:0,diagnostics} };
  const bullishReject=current.close>current.open&&(Math.min(current.open,current.close)-current.low)>=candleRange*.3;
  const bearishReject=current.close<current.open&&(current.high-Math.max(current.open,current.close))>=candleRange*.3;
  // Breakout Retest is deliberately evaluated before Range mode once a close leaves the old range.
  const retestUp=upBreak&&current.low<=hi+a*.25&&bullishReject, retestDown=downBreak&&current.high>=lo-a*.25&&bearishReject;
  const breakoutScore=25+(retestUp||retestDown?20:0)+(Math.abs(momentum)>a*.05?15:0)+15+10+(ratio>=.6?5:0)+5;
  if ((retestUp||retestDown)&&breakoutScore>=82) return { signal:{strategy:"RB100_BREAKOUT_RETEST",direction:retestUp?"CALL":"PUT",confidence:breakoutScore,riskAbs:a*1.1,rewardAbs:a*1.8,riskPct:.25,volatilityPct:a/current.close*100,reason:"RB100 breakout confirmé puis retest",diagnostics:{...diagnostics,boundaryZone:"RETEST"}}};
  const directScore=25+20+(Math.abs(momentum)>a*.12?15:0)+15+10+5+5;
  if ((upBreak||downBreak)&&!retestUp&&!retestDown&&directScore>=90&&ratio<=1.7) return {signal:{strategy:"RB100_BREAKOUT_DIRECT",direction:upBreak?"CALL":"PUT",confidence:directScore,riskAbs:a*1.1,rewardAbs:a*1.8,riskPct:.15,volatilityPct:a/current.close*100,reason:"RB100 breakout direct exceptionnel",diagnostics:{...diagnostics,boundaryZone:"BREAKOUT"}}};
  if (!rangeValid) return {rejection:{reason:upBreak||downBreak?"NO_RETEST":"INVALID_RANGE",score:0,diagnostics}};
  if (pressure>=60) return {rejection:{reason:"HIGH_BREAKOUT_RISK",score:0,diagnostics}};
  if (zone>.25&&zone<.75) return {rejection:{reason:"MID_RANGE",score:0,diagnostics:{...diagnostics,boundaryZone:"MID"}}};
  const buy=zone<=.25&&bullishReject&&rr>45&&momentum>0&&current.close>=e20, sell=zone>=.75&&bearishReject&&rr<55&&momentum<0&&current.close<=e20;
  const score=25+(buy||sell?20:0)+15+15+(Math.abs(momentum)>a*.03?10:0)+5+(ratio>=.6?5:0)+5;
  if (!(buy||sell)) return {rejection:{reason:"NO_REJECTION",score,diagnostics}};
  if(score<78)return {rejection:{reason:"LOW_SCORE",score,diagnostics}};
  return {signal:{strategy:"RB100_RANGE_TRADER",direction:buy?"CALL":"PUT",confidence:score,riskAbs:a*1.25,rewardAbs:Math.max(a*1.63,width*.45),riskPct:.20,volatilityPct:a/current.close*100,reason:`RB100 range ${buy?"BUY borne basse":"SELL borne haute"}`,diagnostics:{...diagnostics,boundaryZone:buy?"LOWER":"UPPER",ema20:e20,ema50:e50}}};
}
