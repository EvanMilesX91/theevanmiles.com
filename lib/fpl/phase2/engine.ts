import { fetchPhaseOneOfficialData, runPhaseOne, type FetchLike, type PhaseOneOfficialData, type SquadLedger } from '../phase1';
import { loadLineupObservations, assessRole } from './lineups';
import { loadForwardMinutes } from './forward-minutes';
import { loadShadowLineups } from './predicted-lineups';
import { projectMinutes, assessSustainability } from './player-model';
import { calculateInjuryImpacts, buildTeamRatings } from './team-model';
import { projectPlayer } from './xpts';
import { writePhaseTwoSnapshot } from './store';
import type { AvailabilityConsensus, AvailabilityObservation, MinutesProjection, ModelLearningAdjustment, PhaseTwoSnapshot, PlayerProjection, ShadowLineupSignal } from './types';

export interface RunPhaseTwoOptions {
  fetcher?: FetchLike;
  persist?: boolean;
  root?: string;
  ledger?: SquadLedger;
  officialData?: PhaseOneOfficialData;
  now?: Date;
  lineupUrl?: string;
  learningAdjustment?: ModelLearningAdjustment;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const round = (value: number, digits = 2) => Number(value.toFixed(digits));

export function buildAvailabilityConsensus(
  official: PhaseOneOfficialData['bootstrap']['elements'][number],
  independent?: AvailabilityObservation,
  shadow?: ShadowLineupSignal,
): AvailabilityConsensus {
  const officialFlag = ['i', 's', 'u', 'd'].includes(official.status) || (official.chance_of_playing_next_round !== null && official.chance_of_playing_next_round < 100);
  const shadowFlag = Boolean(shadow && (['i', 's', 'u', 'n'].includes(shadow.listedStatus) || shadow.contradiction));
  const flaggedSources = [officialFlag ? 'official FPL' : null, independent ? independent.source : null, shadowFlag ? shadow?.source : null].filter((value): value is string => Boolean(value));
  const availableSources = [!officialFlag ? 'official FPL' : null, shadow?.prediction === 'starter' && !shadowFlag ? shadow.source : null].filter((value): value is string => Boolean(value));
  const conflict = flaggedSources.length > 0 && shadow?.prediction === 'starter' && !shadowFlag;
  const level: AvailabilityConsensus['level'] = conflict ? 'conflict' : flaggedSources.length >= 2 ? 'confirmed' : flaggedSources.length === 1 ? 'single_source' : 'clear';
  return { playerId: official.id, level, flaggedSources, availableSources,
    decisionEffect: level === 'confirmed' ? 'minutes_and_team' : level === 'single_source' || level === 'conflict' ? 'confidence_only' : 'none',
    explanation: level === 'confirmed' ? `${flaggedSources.join(' + ')} agree on an availability concern.` : level === 'conflict' ? `${flaggedSources.join(' + ')} flag a concern while ${availableSources.join(' + ')} indicate availability.` : level === 'single_source' ? `${flaggedSources[0]} is the only current flag; no full minutes penalty is applied from the independent feed alone.` : 'No current availability flag from the monitored sources.' };
}

function calibrateMinutes(minutes: MinutesProjection, fixtures: number, adjustment?: ModelLearningAdjustment): MinutesProjection {
  if (!adjustment?.active || adjustment.minutesBiasCorrection === 0) return minutes;
  const next = clamp(minutes.expectedMinutesPerFixture - adjustment.minutesBiasCorrection, 0, 90);
  const futureBase = minutes.futureExpectedMinutesPerFixture ?? minutes.expectedMinutesPerFixture;
  const future = clamp(futureBase - adjustment.minutesBiasCorrection, 0, 90);
  const nextScale = minutes.expectedMinutesPerFixture ? next / minutes.expectedMinutesPerFixture : 1;
  const futureScale = futureBase ? future / futureBase : 1;
  const horizon = (count: number) => {
    const games = Math.min(count, fixtures);
    return round(games ? next + future * Math.max(0, games - 1) : 0);
  };
  return {
    ...minutes,
    startProbability: round(clamp(minutes.startProbability * nextScale, 0, 0.98), 3),
    appearanceProbability: round(clamp(minutes.appearanceProbability * nextScale, 0, 0.99), 3),
    expectedMinutesPerFixture: round(next),
    futureStartProbability: round(clamp((minutes.futureStartProbability ?? minutes.startProbability) * futureScale, 0, 0.98), 3),
    futureAppearanceProbability: round(clamp((minutes.futureAppearanceProbability ?? minutes.appearanceProbability) * futureScale, 0, 0.99), 3),
    futureExpectedMinutesPerFixture: round(future),
    expectedMinutes1: horizon(1), expectedMinutes3: horizon(3), expectedMinutes6: horizon(6),
    evidence: [...minutes.evidence, `Calibration correction: ${adjustment.minutesBiasCorrection > 0 ? '-' : '+'}${Math.abs(adjustment.minutesBiasCorrection).toFixed(1)} expected minutes from ${adjustment.evaluatedGameweeks} completed Gameweeks.`],
  };
}

function applyPromotedShadowLineup(minutes: MinutesProjection, signal: ShadowLineupSignal | undefined, adjustment?: ModelLearningAdjustment): MinutesProjection {
  if (!signal || signal.contradiction || !adjustment?.shadowLineupPromoted) return minutes;
  const weight = 0.15;
  const predictedStart = signal.prediction === 'starter' ? 0.95 : 0.15;
  const startProbability = clamp(minutes.startProbability * (1 - weight) + predictedStart * weight, 0, 0.98);
  const expectedTarget = signal.prediction === 'starter' ? 78 : 20;
  const expected = clamp(minutes.expectedMinutesPerFixture * (1 - weight) + expectedTarget * weight, 0, 90);
  const delta = expected - minutes.expectedMinutesPerFixture;
  return {
    ...minutes,
    startProbability: round(startProbability, 3),
    appearanceProbability: round(Math.max(startProbability, minutes.appearanceProbability * (1 - weight) + (signal.prediction === 'starter' ? 0.97 : 0.65) * weight), 3),
    expectedMinutesPerFixture: round(expected),
    expectedMinutes1: round(expected), expectedMinutes3: round(minutes.expectedMinutes3 + delta), expectedMinutes6: round(minutes.expectedMinutes6 + delta),
    evidence: [...minutes.evidence, `${signal.source} ${signal.prediction} call received a capped 15% weight after passing the four-Gameweek shadow accuracy gate.`],
  };
}

function calibratePoints(projection: PlayerProjection, adjustment?: ModelLearningAdjustment): PlayerProjection {
  if (!adjustment?.active || adjustment.pointsBiasCorrection === 0) return projection;
  const fixtures = projection.fixtures.map((fixture) => ({
    ...fixture,
    xPts: round(Math.max(0, fixture.xPts - adjustment.pointsBiasCorrection)),
    floor: round(Math.max(0, fixture.floor - adjustment.pointsBiasCorrection)),
    ceiling: round(Math.max(0, fixture.ceiling - adjustment.pointsBiasCorrection)),
    explanation: `${fixture.explanation} Calibration bias correction ${adjustment.pointsBiasCorrection > 0 ? '-' : '+'}${Math.abs(adjustment.pointsBiasCorrection).toFixed(2)} points.`,
  }));
  const sum = (count: number, key: 'xPts' | 'floor' | 'ceiling') => round(fixtures.slice(0, count).reduce((total, fixture) => total + fixture[key], 0));
  const first = fixtures[0];
  return {
    ...projection, fixtures, xPts1: sum(1, 'xPts'), xPts3: sum(3, 'xPts'), xPts6: sum(6, 'xPts'), floor1: sum(1, 'floor'), ceiling1: sum(1, 'ceiling'),
    oneLineReason: first ? `${first.xPts} calibrated xPts in GW${first.gameweek}: ${first.expectedMinutes} expected minutes, ${projection.sustainability.label} returns, ${first.home ? 'home' : 'away'} vs ${first.opponent}.` : projection.oneLineReason,
  };
}

export async function runPhaseTwo(options: RunPhaseTwoOptions = {}): Promise<PhaseTwoSnapshot> {
  const root = options.root ?? process.cwd();
  const persist = options.persist ?? process.env.VERCEL !== '1';
  const officialData = options.officialData ?? await fetchPhaseOneOfficialData(options.fetcher);
  const phaseOne = await runPhaseOne({ fetcher: options.fetcher, persist, root, ledger: options.ledger, officialData, now: options.now });
  const [lineup, forwardMinutes, shadowLineups] = await Promise.all([
    loadLineupObservations({
      root,
      currentGameweek: officialData.currentGameweek,
      bootstrap: officialData.bootstrap,
      fixtures: officialData.fixtures,
      url: options.lineupUrl,
      fetcher: options.fetcher,
      now: options.now,
    }),
    loadForwardMinutes({ nextGameweek: officialData.nextGameweek, fetcher: options.fetcher, now: options.now }),
    loadShadowLineups({ bootstrap: officialData.bootstrap, fetcher: options.fetcher, now: options.now }),
  ]);
  const officialById = new Map(officialData.bootstrap.elements.map((player) => [player.id, player]));
  const forwardById = new Map(forwardMinutes.signals.map((signal) => [signal.playerId, signal]));
  const availabilityById = new Map(lineup.availability.map((signal) => [signal.playerId, signal]));
  const shadowById = new Map(shadowLineups.signals.map((signal) => [signal.playerId, signal]));
  const consensusById = new Map(officialData.bootstrap.elements.map((official) => [official.id, buildAvailabilityConsensus(official, availabilityById.get(official.id), shadowById.get(official.id))]));
  const confirmedIndependent = lineup.availability.filter((signal) => consensusById.get(signal.playerId)?.level === 'confirmed');
  const injuryImpacts = calculateInjuryImpacts(officialData.bootstrap, confirmedIndependent, options.now);
  const teamRatings = buildTeamRatings(officialData.bootstrap, officialData.fixtures, injuryImpacts);
  const projections = phaseOne.players.map((player) => {
    const official = officialById.get(player.id);
    if (!official) throw new Error(`Missing official player ${player.id}.`);
    const role = assessRole(player, lineup.observations, officialData.currentGameweek);
    const consensus = consensusById.get(player.id)!;
    const rawMinutes = projectMinutes(player, official, role, player.nextFixtures.length, Math.max(1, officialData.currentGameweek), forwardById.get(player.id), consensus.level === 'confirmed' ? availabilityById.get(player.id) : undefined, options.now);
    const shadowAdjusted = applyPromotedShadowLineup(rawMinutes, shadowById.get(player.id), options.learningAdjustment);
    const minutes = calibrateMinutes(shadowAdjusted, player.nextFixtures.length, options.learningAdjustment);
    const sustainability = assessSustainability(player, official);
    const projected = projectPlayer({ player, official, officialTeams: officialData.bootstrap.teams, teamRatings, minutes, role, sustainability });
    const calibrated = calibratePoints(projected, options.learningAdjustment);
    const confidence = consensus.level === 'single_source' || consensus.level === 'conflict' ? Math.max(20, calibrated.confidence - 8) : calibrated.confidence;
    return { ...calibrated, confidence, shadowLineup: shadowById.get(player.id) ?? null, availabilityConsensus: consensus };
  }).sort((a, b) => b.xPts6 - a.xPts6);
  const snapshot: PhaseTwoSnapshot = {
    schemaVersion: 2, modelVersion: 'phase2-transparent-v2', generatedAt: (options.now ?? new Date()).toISOString(),
    currentGameweek: officialData.currentGameweek, nextGameweek: officialData.nextGameweek,
    sourceHealth: [...officialData.sourceHealth, lineup.health, forwardMinutes.health, shadowLineups.health, {
      key: 'availability_consensus', status: [...consensusById.values()].some((item) => item.level === 'conflict') ? 'degraded' : 'healthy',
      retrievedAt: (options.now ?? new Date()).toISOString(), records: [...consensusById.values()].filter((item) => item.level !== 'clear').length,
      message: `${[...consensusById.values()].filter((item) => item.level === 'confirmed').length} confirmed multi-source flags; ${[...consensusById.values()].filter((item) => item.level === 'single_source').length} single-source flags affect confidence only; ${[...consensusById.values()].filter((item) => item.level === 'conflict').length} conflicts are surfaced.`,
    }], phaseOne, teamRatings, injuryImpacts, projections,
    roleChanges: projections.filter((projection) => (projection.role.change === 'confirmed' || projection.role.change === 'possible') && (projection.role.latestGameweek ?? 0) >= officialData.currentGameweek - 2),
    shadowLineups: shadowLineups.signals,
    modelNotes: [
      'xPts are transparent model estimates, not official FPL projections.',
      'Expected minutes combine official availability, season starts, last-five minutes and a capped independent benchmark; model disagreement lowers confidence rather than being hidden.',
      'Team ratings blend actual goals with official FPL strength priors, shrink small samples toward league average, and apply capped injury effects.',
      'Role changes require confirmed-lineup evidence: two matching starts for confirmed, one for possible.',
      'Predicted lineups run in shadow mode and cannot affect selection until at least four completed Gameweeks meet the promotion accuracy gate.',
      'Independent injury and predicted-lineup reports require source consensus before they can change expected minutes or team-strength injury multipliers; single-source reports only lower confidence.',
      'Ranges express model and minutes uncertainty; they are not calibrated betting intervals.',
      options.learningAdjustment?.active ? options.learningAdjustment.reason : 'Automatic bias correction remains locked until four effective calibration Gameweeks exist.',
    ],
  };
  if (persist) await writePhaseTwoSnapshot(snapshot, root);
  return snapshot;
}
