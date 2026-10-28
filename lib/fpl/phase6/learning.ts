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
  const active = effectiveGameweeks >= minimumGameweeks && forwardGameweeks >= 3 && summary.challenger.status === 'promote' && Boolean(summary.forwardAggregate);
  const shadowAccuracy = summary.aggregate?.shadowLineupAccuracy ?? null;
  const shadowContradictions = summary.aggregate?.shadowLineupContradictions ?? 0;
  const priceAccuracy = summary.priceModel.precision;
  return {
    active,
    evaluatedGameweeks,
    effectiveGameweeks,
    forwardGameweeks,
    historicalGameweeks,
    minimumGameweeks,
    pointsBiasCorrection: active ? clamp(summary.forwardAggregate!.selectedXiBias, -0.75, 0.75) : 0,
    minutesBiasCorrection: active ? clamp(summary.forwardAggregate!.minutesBias, -8, 8) : 0,
    priceDirectionalAccuracy: summary.priceModel.status === 'calibrated' ? priceAccuracy : null,
    priceRiseThreshold: summary.priceModel.riseThreshold,
    priceFallThreshold: summary.priceModel.fallThreshold,
    shadowLineupPromoted: forwardGameweeks >= minimumGameweeks && shadowAccuracy !== null && shadowAccuracy >= 80 && shadowContradictions === 0,
    reason: active
      ? `Promoted capped corrections after the forward-only challenger beat the uncorrected model out of sample across ${forwardGameweeks} Gameweeks.`
      : `Learning remains locked: ${effectiveGameweeks.toFixed(1)}/${minimumGameweeks} effective Gameweeks, ${forwardGameweeks} forward, and challenger status ${summary.challenger.status}. Historical/replay evidence is diagnostic only.`,
    shadowLineupPromotion: forwardGameweeks < minimumGameweeks || shadowAccuracy === null ? 'locked' : shadowAccuracy >= 80 && shadowContradictions === 0 ? 'eligible' : 'rejected',
    priceModelStatus: summary.priceModel.status,
  };
}
