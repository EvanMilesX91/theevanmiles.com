import type { MonitoredPlayer } from '../phase1';
import type { DecisionPlayer } from '../phase3';
import { COUNCIL_WEIGHTS } from './config';
import type { CouncilLensKey, CouncilOpinion, CouncilRecommendation, PlayerCouncil } from './types';

const round = (value: number, digits = 1) => Number(value.toFixed(digits));
const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, value));

export function councilRecommendation(score: number): CouncilRecommendation {
  if (score >= 80) return 'strong_buy';
  if (score >= 65) return 'buy';
  if (score >= 45) return 'neutral';
  if (score >= 30) return 'avoid';
  return 'strong_avoid';
}

function percentiles(values: Array<{ id: number; value: number }>): Map<number, number> {
  const sorted = [...values].sort((a, b) => a.value - b.value);
  const output = new Map<number, number>();
  let index = 0;
  while (index < sorted.length) {
    let end = index;
    while (end + 1 < sorted.length && Math.abs(sorted[end + 1].value - sorted[index].value) < 1e-9) end += 1;
    const averageRank = (index + end) / 2;
    const percentile = sorted.length === 1 ? 50 : 15 + (averageRank / (sorted.length - 1)) * 70;
    for (let cursor = index; cursor <= end; cursor += 1) output.set(sorted[cursor].id, percentile);
    index = end + 1;
  }
  return output;
}

function opinion(key: CouncilLensKey, name: string, score: number, confidence: number, reason: string, evidence: string[], applicable = true): CouncilOpinion {
  const bounded = round(clamp(score));
  return { key, name, applicable, score: bounded, confidence: Math.round(clamp(confidence)), recommendation: councilRecommendation(bounded), reason, evidence };
}

export function buildPlayerCouncils(players: DecisionPlayer[], monitoredPlayers: MonitoredPlayer[], captainIds: Set<number>): PlayerCouncil[] {
  const monitored = new Map(monitoredPlayers.map((player) => [player.id, player]));
  const byPosition = new Map<string, DecisionPlayer[]>();
  for (const player of players) byPosition.set(player.projection.position, [...(byPosition.get(player.projection.position) ?? []), player]);
  const metric = (fn: (player: DecisionPlayer) => number) => percentiles(players.map((player) => ({ id: player.projection.playerId, value: fn(player) })));
  const projectionPct = metric((player) => player.projection.xPts3);
  const valuePct = metric((player) => player.value.xPtsPerMillion6 + Math.max(-5, player.value.valueAboveReplacement6) * 0.05);
  const historyPct = percentiles(players.map((player) => ({ id: player.projection.playerId, value: monitored.get(player.projection.playerId)?.totalPoints ?? 0 })));
  const fixturePct = metric((player) => player.projection.fixtures.slice(0, 3).reduce((sum, fixture) => sum + fixture.xPts, 0));
  const captainPct = metric((player) => player.projection.xPts1 + player.projection.ceiling1 * 0.2);

  return players.map((player): PlayerCouncil => {
    const p = player.projection;
    const raw = monitored.get(p.playerId);
    const positionPeers = byPosition.get(p.position) ?? [];
    const ruleValues = positionPeers.map((peer) => ({ id: peer.projection.playerId, value: peer.projection.sustainability.defensiveContributionPointsPer90 + (peer.projection.position === 'DEF' || peer.projection.position === 'GK' ? peer.projection.fixtures[0]?.components.cleanSheet ?? 0 : peer.projection.sustainability.expectedGoalsPer90 * 4 + peer.projection.sustainability.expectedAssistsPer90 * 3) }));
    const rulePct = percentiles(ruleValues).get(p.playerId) ?? 50;
    const floorRatio = p.xPts1 > 0 ? p.floor1 / p.xPts1 : 0;
    const minutesScore = p.minutes.appearanceProbability * 55 + p.minutes.startProbability * 25 + p.minutes.confidence * 0.2;
    const riskScore = p.confidence * 0.55 + floorRatio * 30 + (p.minutes.rotationRisk === 'low' ? 15 : p.minutes.rotationRisk === 'medium' ? 5 : 0);
    const ownership = raw?.ownership ?? 0;
    const contrarianScore = clamp(50 + ((projectionPct.get(p.playerId) ?? 50) - 50) * 0.65 + (25 - Math.min(50, ownership)) * 0.5);
    const newScore = player.newPlayer.sample === 'unproven'
      ? clamp((valuePct.get(p.playerId) ?? 50) * 0.55 + (projectionPct.get(p.playerId) ?? 50) * 0.45)
      : player.newPlayer.sample === 'limited' ? 55 : 50;
    const opinions: CouncilOpinion[] = [
      opinion('projection', 'Projection Analyst', projectionPct.get(p.playerId) ?? 50, p.confidence, `${p.xPts3} xPts over three Gameweeks ranks against the entire current pool.`, [`GW1 xPts: ${p.xPts1}`, `GW3 xPts: ${p.xPts3}`, `GW6 xPts: ${p.xPts6}`]),
      opinion('value', 'Value Analyst', valuePct.get(p.playerId) ?? 50, Math.min(85, p.confidence), `${p.xPts6} six-Gameweek xPts at £${p.price.toFixed(1)}m, measured against positional replacement.`, [`xPts/£m: ${player.value.xPtsPerMillion6}`, `Value above replacement: ${player.value.valueAboveReplacement6}`, player.value.opportunityCost]),
      opinion('historical', 'Historical FPL Analyst', historyPct.get(p.playerId) ?? 50, Math.min(50, 25 + (raw?.seasonMinutes ?? 0) / 30), `Uses demonstrated current-season output and durability; multi-season history is not yet loaded.`, [`Current-season points: ${raw?.totalPoints ?? 0}`, `Minutes: ${raw?.seasonMinutes ?? 0}`, `Starts: ${raw?.seasonStarts ?? 0}`], (raw?.seasonMinutes ?? 0) >= 180),
      opinion('new_player', 'New Player Scout', newScore, player.newPlayer.sample === 'established' ? 45 : Math.min(55, p.confidence), player.newPlayer.treatment, [`Sample classification: ${player.newPlayer.sample}`, `Prior reliance: ${round(player.newPlayer.priorReliance * 100)}%`], player.newPlayer.sample !== 'established'),
      opinion('minutes', 'Minutes & Rotation Analyst', minutesScore, p.minutes.confidence, `${round(p.minutes.startProbability * 100)}% start probability and ${p.minutes.expectedMinutesPerFixture} expected minutes.`, [`Appearance probability: ${round(p.minutes.appearanceProbability * 100)}%`, `Rotation risk: ${p.minutes.rotationRisk}`]),
      opinion('fixtures', 'Fixture Analyst', fixturePct.get(p.playerId) ?? 50, Math.min(82, p.confidence), `Scores the opponent-adjusted xPts in the next three scheduled fixtures.`, p.fixtures.slice(0, 3).map((fixture) => `GW${fixture.gameweek} ${fixture.home ? 'H' : 'A'} vs ${fixture.opponent}: ${fixture.xPts} xPts`)),
      opinion('rules_position', 'Rules & Position Analyst', rulePct, Math.min(80, p.sustainability.confidence), `Measures routes to points created by this season's positional scoring, clean sheets and defensive contributions.`, [`DC points/90 estimate: ${p.sustainability.defensiveContributionPointsPer90}`, `Role: ${p.role.tacticalRole}`, `Listed position: ${p.position}`]),
      opinion('captaincy', 'Captaincy Analyst', captainPct.get(p.playerId) ?? 50, p.confidence, captainIds.has(p.playerId) ? 'Currently reaches the owned captaincy shortlist.' : 'Does not currently improve the owned captaincy shortlist.', [`GW1 xPts: ${p.xPts1}`, `GW1 ceiling: ${p.ceiling1}`]),
      opinion('risk', 'Risk Analyst', riskScore, Math.min(p.minutes.confidence, p.sustainability.confidence), `Rewards secure minutes, model confidence and a resilient points floor.`, [`Projection confidence: ${p.confidence}`, `GW1 range: ${p.floor1}–${p.ceiling1}`, `Availability status: ${raw?.status ?? 'unknown'}`]),
      opinion('contrarian', 'Contrarian Analyst', contrarianScore, 45, `Challenges ownership and reputation by comparing projection rank with ${ownership}% ownership.`, [`Ownership: ${ownership}%`, `Projection percentile: ${round(projectionPct.get(p.playerId) ?? 50)}`]),
    ];
    const score = opinions.reduce((sum, item) => sum + item.score * COUNCIL_WEIGHTS[item.key], 0);
    const confidence = opinions.reduce((sum, item) => sum + item.confidence * COUNCIL_WEIGHTS[item.key], 0);
    const sorted = [...opinions].sort((a, b) => b.score - a.score);
    const disagreementOpinions = opinions.filter((item) => item.applicable && item.confidence >= 50).sort((a, b) => b.score - a.score);
    const highest = disagreementOpinions[0] ?? sorted[0];
    const lowest = disagreementOpinions.at(-1) ?? sorted.at(-1)!;
    const spread = highest.score - lowest.score;
    const disagreement = disagreementOpinions.length >= 2 && p.minutes.appearanceProbability >= 0.5 && (spread >= 45 || (highest.score >= 80 && lowest.score < 40));
    const positives = sorted.filter((item) => item.score >= 65).slice(0, 3).map((item) => `${item.name}: ${item.reason}`);
    const negatives = [...opinions].sort((a, b) => a.score - b.score).filter((item) => item.score < 45).slice(0, 3).map((item) => `${item.name}: ${item.reason}`);
    return {
      playerId: p.playerId, playerName: p.playerName, score: round(score), confidence: Math.round(confidence), verdict: councilRecommendation(score),
      disagreement, disagreementSpread: round(spread),
      disagreementSummary: disagreement ? `${highest.name} scores ${highest.score}, while ${lowest.name} scores ${lowest.score}; upside and risk should not be averaged away.` : null,
      opinions, for: positives.length ? positives : ['No council lens reaches the BUY threshold.'], against: negatives.length ? negatives : ['No council lens reaches the AVOID threshold.'],
    };
  }).sort((a, b) => b.score - a.score);
}
