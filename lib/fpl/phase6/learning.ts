import type { ModelLearningAdjustment } from '../phase2';
import type { CalibrationDashboardSummary } from './calibration';

export interface ModelLearningProfile extends ModelLearningAdjustment {
  minimumGameweeks: number;
  shadowLineupPromotion: 'locked' | 'eligible' | 'rejected';
  priceModelStatus: 'collecting' | 'calibrated';
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function deriveModelLearning(summary: CalibrationDashboardSummary, minimumGameweeks = 4): ModelLearningProfile {
  const evaluatedGameweeks = summary.evaluatedGameweeks.length;
  const effectiveGameweeks = summary.effectiveGameweeks;
  const forwardGameweeks = summary.forwardEvaluatedGameweeks.length;
  const historicalGameweeks = summary.historicalEvaluatedGameweeks.length;
  const active = effectiveGameweeks >= minimumGameweeks && Boolean(summary.aggregate);
  const shadowAccuracy = summary.aggregate?.shadowLineupAccuracy ?? null;
  const shadowContradictions = summary.aggregate?.shadowLineupContradictions ?? 0;
  const priceAccuracy = summary.aggregate?.priceDirectionalAccuracy ?? null;
  return {
    active,
    evaluatedGameweeks,
    effectiveGameweeks,
    forwardGameweeks,
    historicalGameweeks,
    minimumGameweeks,
    pointsBiasCorrection: active ? clamp(summary.aggregate!.selectedXiBias, -0.75, 0.75) : 0,
    minutesBiasCorrection: active ? clamp(summary.aggregate!.minutesBias, -8, 8) : 0,
    priceDirectionalAccuracy: effectiveGameweeks >= minimumGameweeks ? priceAccuracy : null,
    shadowLineupPromoted: forwardGameweeks >= minimumGameweeks && shadowAccuracy !== null && shadowAccuracy >= 80 && shadowContradictions === 0,
    reason: active
      ? `Applied capped corrections from ${effectiveGameweeks.toFixed(1)} effective Gameweeks (${forwardGameweeks} forward, ${historicalGameweeks} historical at half weight); positive bias is subtracted from future projections.`
      : `Learning gate is ${effectiveGameweeks.toFixed(1)}/${minimumGameweeks} effective Gameweeks: ${forwardGameweeks} forward at full weight and ${historicalGameweeks} historical at half weight.`,
    shadowLineupPromotion: forwardGameweeks < minimumGameweeks || shadowAccuracy === null ? 'locked' : shadowAccuracy >= 80 && shadowContradictions === 0 ? 'eligible' : 'rejected',
    priceModelStatus: effectiveGameweeks >= minimumGameweeks && priceAccuracy !== null ? 'calibrated' : 'collecting',
  };
}
