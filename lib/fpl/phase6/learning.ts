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
  const active = evaluatedGameweeks >= minimumGameweeks && Boolean(summary.aggregate);
  const shadowAccuracy = summary.aggregate?.shadowLineupAccuracy ?? null;
  const shadowContradictions = summary.aggregate?.shadowLineupContradictions ?? 0;
  const priceAccuracy = summary.aggregate?.priceDirectionalAccuracy ?? null;
  return {
    active,
    evaluatedGameweeks,
    minimumGameweeks,
    pointsBiasCorrection: active ? clamp(summary.aggregate!.selectedXiBias, -0.75, 0.75) : 0,
    minutesBiasCorrection: active ? clamp(summary.aggregate!.minutesBias, -8, 8) : 0,
    priceDirectionalAccuracy: priceAccuracy,
    shadowLineupPromoted: evaluatedGameweeks >= minimumGameweeks && shadowAccuracy !== null && shadowAccuracy >= 80 && shadowContradictions === 0,
    reason: active
      ? `Applied capped corrections from ${evaluatedGameweeks} completed Gameweeks; positive bias is subtracted from future projections.`
      : `Learning locked until ${minimumGameweeks} completed Gameweeks are available (${evaluatedGameweeks}/${minimumGameweeks}).`,
    shadowLineupPromotion: evaluatedGameweeks < minimumGameweeks || shadowAccuracy === null ? 'locked' : shadowAccuracy >= 80 && shadowContradictions === 0 ? 'eligible' : 'rejected',
    priceModelStatus: evaluatedGameweeks >= minimumGameweeks && priceAccuracy !== null ? 'calibrated' : 'collecting',
  };
}
