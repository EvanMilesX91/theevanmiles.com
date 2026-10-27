import type { OfficialPlayer, Position } from '../phase1';
import type { PlayerProjection } from '../phase2';
import type { DecisionPlayer, NewPlayerAssessment, PricePressure, ReplacementReference, ValueAssessment } from './types';

const round = (value: number, digits = 2) => Number(value.toFixed(digits));
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function replacementByPosition(players: PlayerProjection[]): Map<Position, ReplacementReference> {
  const output = new Map<Position, ReplacementReference>();
  for (const position of ['GK', 'DEF', 'MID', 'FWD'] as Position[]) {
    const peers = players.filter((player) => player.position === position && player.minutes.expectedMinutesPerFixture >= 55 && player.confidence >= 45);
    const prices = peers.map((player) => player.price).sort((a, b) => a - b);
    const median = prices[Math.floor(prices.length / 2)] ?? 5;
    const budget = peers.filter((player) => player.price <= median).sort((a, b) => b.xPts6 - a.xPts6 || a.price - b.price);
    const selected = budget[Math.min(budget.length - 1, 2)] ?? peers.sort((a, b) => b.xPts6 - a.xPts6)[0];
    if (selected) output.set(position, { playerId: selected.playerId, playerName: selected.playerName, price: selected.price, xPts6: selected.xPts6 });
  }
  return output;
}

function pricePressure(player: PlayerProjection, official: OfficialPlayer, scale: number): PricePressure {
  const pressure = round(clamp((official.transfers_in_event - official.transfers_out_event) / Math.max(1, scale) * 100, -100, 100), 1);
  const direction = pressure >= 70 ? 'likely_rise' : pressure >= 35 ? 'rise_watch' : pressure <= -70 ? 'likely_fall' : pressure <= -35 ? 'fall_watch' : 'stable';
  return {
    currentPrice: player.price, netTransfers: official.transfers_in_event - official.transfers_out_event, pressure, direction,
    confidence: direction === 'stable' ? 30 : Math.round(Math.min(60, 35 + Math.abs(pressure) * 0.25)),
    urgency: direction === 'likely_rise' || direction === 'likely_fall' ? 'before_next_price_cycle' : direction === 'rise_watch' || direction === 'fall_watch' ? 'monitor' : 'none',
    source: 'official_transfer_activity_proxy',
    caveat: 'FPL does not publish the price-change threshold. Direction is a relative transfer-pressure estimate, not an official forecast.',
  };
}

function newPlayerAssessment(official: OfficialPlayer): NewPlayerAssessment {
  if (official.minutes >= 450) return { sample: 'established', priorReliance: round(450 / (official.minutes + 450)), confidenceCap: 92, treatment: 'Current-season evidence is large enough to dominate the positional prior.' };
  if (official.minutes >= 90) return { sample: 'limited', priorReliance: round(450 / (official.minutes + 450)), confidenceCap: 72, treatment: 'Underlying rates are shrunk strongly toward position and team priors until the sample grows.' };
  return { sample: 'unproven', priorReliance: round(450 / (official.minutes + 450)), confidenceCap: 55, treatment: 'The player remains in the pool, but no starting role is assumed without lineup or minutes evidence.' };
}

export function buildDecisionPlayers(projections: PlayerProjection[], officials: OfficialPlayer[]): DecisionPlayer[] {
  const officialById = new Map(officials.map((player) => [player.id, player]));
  const replacements = replacementByPosition(projections);
  const transferMagnitudes = officials.map((player) => Math.abs(player.transfers_in_event - player.transfers_out_event)).sort((a, b) => a - b);
  const scale = transferMagnitudes[Math.floor(transferMagnitudes.length * 0.9)] ?? 1;
  return projections.map((projection): DecisionPlayer => {
    const official = officialById.get(projection.playerId);
    if (!official) throw new Error(`Official player ${projection.playerId} missing from Phase 3.`);
    const replacement = replacements.get(projection.position) ?? { playerId: projection.playerId, playerName: projection.playerName, price: projection.price, xPts6: projection.xPts6 };
    const cheaper = projections
      .filter((candidate) => candidate.position === projection.position && candidate.price <= projection.price - 0.5 && candidate.minutes.expectedMinutesPerFixture >= 55)
      .sort((a, b) => b.xPts6 - a.xPts6 || a.price - b.price)[0];
    const saving = cheaper ? projection.price - cheaper.price : 0;
    const sacrificed = cheaper ? projection.xPts6 - cheaper.xPts6 : 0;
    const value: ValueAssessment = {
      xPtsPerMillion1: round(projection.xPts1 / Math.max(3.5, projection.price)),
      xPtsPerMillion3: round(projection.xPts3 / Math.max(3.5, projection.price)),
      xPtsPerMillion6: round(projection.xPts6 / Math.max(3.5, projection.price)),
      replacement, valueAboveReplacement6: round(projection.xPts6 - replacement.xPts6),
      cheaperAlternativeId: cheaper?.playerId ?? null, cheaperAlternativeName: cheaper?.playerName ?? null,
      saving: round(saving, 1), pointsSacrificed6: round(sacrificed),
      marginalXptsPerHalfMillion: cheaper && saving > 0 ? round((sacrificed / saving) * 0.5) : null,
      captainAdjustedValue1: round((projection.xPts1 + Math.max(0, projection.xPts1 - projection.floor1) * 0.2) / Math.max(3.5, projection.price)),
      opportunityCost: cheaper
        ? `${cheaper.playerName} saves £${saving.toFixed(1)}m for ${sacrificed >= 0 ? `${round(sacrificed)} fewer` : `${round(Math.abs(sacrificed))} more`} projected points over six Gameweeks.`
        : 'No reliable same-position option at least £0.5m cheaper is currently available.',
    };
    return { projection, value, pricePressure: pricePressure(projection, official, scale), newPlayer: newPlayerAssessment(official) };
  }).sort((a, b) => b.projection.xPts6 - a.projection.xPts6);
}
