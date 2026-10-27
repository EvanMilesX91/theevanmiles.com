import type { MonitoredPlayer, OfficialPlayer } from '../phase1';
import type { AvailabilityObservation, ForwardMinutesSignal, MinutesProjection, RoleAssessment, SustainablePerformance } from './types';

const round = (value: number, digits = 2) => Number(value.toFixed(digits));
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function availability(player: OfficialPlayer): number {
  if (['u', 'i', 's'].includes(player.status)) return 0;
  if (player.chance_of_playing_next_round !== null) return player.chance_of_playing_next_round / 100;
  return player.status === 'd' ? 0.5 : 1;
}

export function projectMinutes(player: MonitoredPlayer, official: OfficialPlayer, role: RoleAssessment, upcomingFixtures: number, gamesPlayed = Math.max(1, player.rolling5.gameweeks), forward?: ForwardMinutesSignal, independentAvailability?: AvailabilityObservation, now = new Date()): MinutesProjection {
  const available = availability(official);
  if (!available) return { startProbability: 0, appearanceProbability: 0, expectedMinutesPerFixture: 0, futureStartProbability: 0, futureAppearanceProbability: 0, futureExpectedMinutesPerFixture: 0, expectedMinutes1: 0, expectedMinutes3: 0, expectedMinutes6: 0, rotationRisk: 'unavailable', confidence: 98, evidence: [official.news || 'Official FPL status says unavailable.'] };
  const seasonStart = clamp(official.starts / Math.max(gamesPlayed, official.starts, 1), 0, 1);
  const recentStart = player.rolling5.gameweeks ? player.rolling5.startEquivalents / player.rolling5.gameweeks : seasonStart;
  const lastStart = player.rolling1.minutes >= 60 ? 1 : player.rolling1.minutes > 0 ? 0.25 : 0;
  const rawStartProbability = clamp(seasonStart * 0.45 + recentStart * 0.4 + lastStart * 0.15, 0, 0.98);
  let startProbability = rawStartProbability * available;
  const seasonAppearance = clamp((official.minutes > 0 ? Math.max(official.starts, Math.ceil(official.minutes / 90)) : 0) / Math.max(1, gamesPlayed), 0, 1);
  const recentAppearance = player.rolling5.gameweeks ? player.rolling5.appearances / player.rolling5.gameweeks : seasonAppearance;
  let appearanceProbability = clamp(Math.max(rawStartProbability, seasonAppearance * 0.4 + recentAppearance * 0.6) * available, 0, 0.99);
  const conditionalSubProbability = clamp((appearanceProbability - startProbability) / Math.max(0.01, 1 - startProbability), 0, 0.75);
  const startMinutes = clamp(player.rolling5.startEquivalents ? player.rolling5.minutes / player.rolling5.startEquivalents : 78, 55, 90);
  let expected = clamp(startProbability * startMinutes + (1 - startProbability) * conditionalSubProbability * 15, 0, 90);
  const futureStartProbability = startProbability;
  const futureAppearanceProbability = appearanceProbability;
  const futureExpectedMinutesPerFixture = expected;
  const volatility = Math.abs(player.rolling1.minutes - player.rolling5.minutes / Math.max(1, player.rolling5.gameweeks));
  let confidence = Math.round(clamp(45 + official.starts * 3 + player.rolling5.appearances * 4 - (available < 1 ? 20 : 0), 20, 92));
  const evidence = [`Season starts: ${official.starts}; last-five start equivalents: ${player.rolling5.startEquivalents}.`, `Official availability multiplier: ${round(available, 2)}.`];
  if (forward) {
    const disagreement = Math.abs(expected - forward.expectedMinutes);
    const weight = disagreement > 30 ? 0.18 : 0.3;
    const externalStart = clamp((forward.expectedMinutes - (1 - forward.playChance) * 10) / Math.max(60, startMinutes), 0, 0.98);
    startProbability = clamp(startProbability * (1 - weight) + externalStart * weight, 0, 0.98);
    appearanceProbability = clamp(appearanceProbability * (1 - weight) + forward.playChance * weight, startProbability, 0.99);
    expected = clamp(expected * (1 - weight) + forward.expectedMinutes * weight, 0, 90);
    confidence = Math.round(clamp(confidence + (disagreement <= 12 ? 6 : disagreement > 30 ? -10 : -2), 20, 94));
    evidence.push(`${forward.source} GW${forward.gameweek} benchmark: ${round(forward.expectedMinutes)} expected minutes and ${round(forward.playChance * 100)}% play chance; ${round(weight * 100)}% ensemble weight.`);
    if (disagreement > 30) evidence.push(`Independent and internal minutes estimates disagree by ${round(disagreement)} minutes, so confidence is reduced and the external weight is capped.`);
  }
  if (independentAvailability && official.status === 'a') {
    const returnTime = independentAvailability.returnDate ? new Date(independentAvailability.returnDate).getTime() : Number.POSITIVE_INFINITY;
    if (returnTime > now.getTime()) {
      const multiplier = independentAvailability.status === 'suspension' ? 0.65 : independentAvailability.status === 'injury' ? 0.8 : 0.85;
      startProbability *= multiplier;
      appearanceProbability = Math.max(startProbability, appearanceProbability * multiplier);
      expected *= multiplier;
      confidence = Math.round(clamp(confidence - 6, 20, 94));
      evidence.push(`${independentAvailability.source} flags ${independentAvailability.reason}${independentAvailability.returnLabel ? ` (${independentAvailability.returnLabel})` : ''}; next-fixture minutes are conservatively reduced by ${round((1 - multiplier) * 100)}% pending official confirmation.`);
    }
  }
  const rotationRisk = startProbability < 0.55 || volatility > 35 ? 'high' : startProbability < 0.78 || volatility > 22 ? 'medium' : 'low';
  if (role.change === 'possible' || role.change === 'confirmed') evidence.push(`Role evidence is ${role.change}; it changes scoring components, not minutes by itself.`);
  const horizon = (count: number) => {
    const fixtures = Math.min(count, upcomingFixtures);
    return round(fixtures ? expected + futureExpectedMinutesPerFixture * Math.max(0, fixtures - 1) : 0);
  };
  return {
    startProbability: round(startProbability, 3), appearanceProbability: round(appearanceProbability, 3), expectedMinutesPerFixture: round(expected),
    futureStartProbability: round(futureStartProbability, 3), futureAppearanceProbability: round(futureAppearanceProbability, 3), futureExpectedMinutesPerFixture: round(futureExpectedMinutesPerFixture),
    expectedMinutes1: horizon(1), expectedMinutes3: horizon(3), expectedMinutes6: horizon(6), rotationRisk, confidence, evidence,
  };
}

export function assessSustainability(player: MonitoredPlayer, official: OfficialPlayer): SustainablePerformance {
  const minutes = Math.max(1, official.minutes);
  const per90 = 90 / minutes;
  const rawXg90 = Number(official.expected_goals || 0) * per90;
  const rawXa90 = Number(official.expected_assists || 0) * per90;
  const rateWeight = clamp(minutes / (minutes + 450), 0, 0.85);
  const xgPrior = player.position === 'FWD' ? 0.38 : player.position === 'MID' ? 0.2 : player.position === 'DEF' ? 0.06 : 0;
  const xaPrior = player.position === 'FWD' ? 0.14 : player.position === 'MID' ? 0.17 : player.position === 'DEF' ? 0.08 : 0;
  const xg90 = rawXg90 * rateWeight + xgPrior * (1 - rateWeight);
  const xa90 = rawXa90 * rateWeight + xaPrior * (1 - rateWeight);
  const goalPoints = player.position === 'FWD' ? 4 : player.position === 'MID' ? 5 : 6;
  const observed = official.total_points * per90;
  const appearance = minutes >= 180 ? 2 : 1.3;
  const attack = xg90 * goalPoints + xa90 * 3;
  const cleanRate = clamp(official.clean_sheets * per90 * rateWeight + 0.25 * (1 - rateWeight), 0, 0.7);
  const clean = player.position === 'GK' || player.position === 'DEF' ? cleanRate * 4 : player.position === 'MID' ? cleanRate : 0;
  const bonusRaw = official.bonus * per90;
  const bonusPrior = player.position === 'FWD' ? 0.35 : player.position === 'MID' ? 0.3 : 0.25;
  const sampleWeight = clamp(minutes / 900, 0, 1);
  const bonus = bonusRaw * sampleWeight * 0.65 + bonusPrior * (1 - sampleWeight * 0.65);
  const dcThreshold = player.position === 'DEF' ? 10 : 12;
  const dcRate = official.defensive_contribution / Math.max(1, official.starts);
  const dcPoints = player.position === 'GK' || player.position === 'FWD' ? 0 : clamp(dcRate / dcThreshold, 0, 1) * 2;
  const sustainable = appearance + attack + clean + bonus + dcPoints;
  const gap = observed - sustainable;
  const confidence = Math.round(clamp(25 + minutes / 18, 25, 88));
  const label = minutes < 180 ? 'insufficient_sample' : gap > 1.5 ? 'overperforming' : gap < -1 ? 'underperforming' : 'sustainable';
  return { observedPointsPer90: round(observed), sustainablePointsPer90: round(sustainable), expectedGoalsPer90: round(xg90, 3), expectedAssistsPer90: round(xa90, 3), regressedBonusPer90: round(bonus), defensiveContributionPointsPer90: round(dcPoints), regressionGap: round(gap), label, confidence };
}
