import type { SourceHealth } from '../phase1';
import type { DecisionPlayer, TransferScenario } from '../phase3';
import type { PlayerCouncil, RedTeamObjection, RedTeamReview } from './types';

function severityRank(severity: RedTeamObjection['severity']): number {
  return { critical: 4, high: 3, medium: 2, low: 1 }[severity];
}

function resultingIds(baseIds: number[], scenario: TransferScenario): Set<number> {
  const ids = new Set(baseIds);
  for (const move of scenario.moves) {
    ids.delete(move.outPlayerId);
    ids.add(move.inPlayerId);
  }
  return ids;
}

export function chooseRedTeamAlternative(primary: TransferScenario, scenarios: TransferScenario[], baseline: TransferScenario): { scenario: TransferScenario; materiallyDifferent: boolean } {
  const primaryPlayers = new Set(primary.moves.flatMap((move) => [move.outPlayerId, move.inPlayerId]));
  const distinct = scenarios.find((scenario) => scenario.id !== primary.id && scenario.moves.length > 0 && scenario.moves.every((move) => !primaryPlayers.has(move.outPlayerId) && !primaryPlayers.has(move.inPlayerId)));
  if (distinct) return { scenario: distinct, materiallyDifferent: true };
  const multi = scenarios.find((scenario) => scenario.id !== primary.id && scenario.moves.length !== primary.moves.length);
  if (multi) return { scenario: multi, materiallyDifferent: true };
  return { scenario: baseline, materiallyDifferent: primary.moves.length > 0 };
}

export function buildRedTeamReview(args: {
  primary: TransferScenario;
  scenarios: TransferScenario[];
  baseline: TransferScenario;
  players: DecisionPlayer[];
  councils: PlayerCouncil[];
  ownedIds: number[];
  sourceHealth: SourceHealth[];
  staleLedger: boolean;
}): RedTeamReview {
  const byId = new Map(args.players.map((player) => [player.projection.playerId, player]));
  const councilById = new Map(args.councils.map((council) => [council.playerId, council]));
  const finalIds = resultingIds(args.ownedIds, args.primary);
  const selected = [...finalIds].map((id) => byId.get(id)).filter((player): player is DecisionPlayer => Boolean(player));
  const starters = args.primary.lineup.starterIds.map((id) => byId.get(id)).filter((player): player is DecisionPlayer => Boolean(player));
  const objections: RedTeamObjection[] = [];
  if (args.staleLedger) objections.push({ severity: 'critical', question: 'Are we optimizing the actual squad?', finding: 'No. The confirmed ledger is behind the official next Gameweek.', evidence: ['The transfer comparison may start from an obsolete squad or bank balance.'], mitigation: 'Confirm the missing Gameweek action, XI, captain and bank before executing any recommendation.' });
  const uncertain = [...starters].sort((a, b) => a.projection.confidence - b.projection.confidence)[0];
  if (uncertain && uncertain.projection.confidence < 70) objections.push({ severity: 'high', question: 'Where is the biggest minutes/model uncertainty?', finding: `${uncertain.projection.playerName} is in the proposed XI at only ${uncertain.projection.confidence}% projection confidence.`, evidence: [`Expected minutes: ${uncertain.projection.minutes.expectedMinutesPerFixture}`, `Rotation risk: ${uncertain.projection.minutes.rotationRisk}`], mitigation: 'Wait for lineup news or start the strongest reliable bench alternative.' });
  const weakest = [...selected].sort((a, b) => (councilById.get(a.projection.playerId)?.score ?? 0) - (councilById.get(b.projection.playerId)?.score ?? 0))[0];
  if (weakest) objections.push({ severity: 'medium', question: 'What is the weakest squad slot?', finding: `${weakest.projection.playerName} has the lowest Council score in the resulting squad.`, evidence: [`Council: ${councilById.get(weakest.projection.playerId)?.score ?? 0}`, `Six-Gameweek xPts: ${weakest.projection.xPts6}`], mitigation: 'Treat this as the next upgrade slot rather than spending points on a marginal immediate move.' });
  const expensive = [...selected].sort((a, b) => b.projection.price - a.projection.price)[0];
  if (expensive && expensive.value.valueAboveReplacement6 < 3) objections.push({ severity: 'medium', question: 'Is the premium spend justified?', finding: `${expensive.projection.playerName} offers only ${expensive.value.valueAboveReplacement6} xPts above positional replacement over six Gameweeks.`, evidence: [expensive.value.opportunityCost], mitigation: 'Compare a downgrade plus an upgrade elsewhere before retaining the premium structure.' });
  const clubCounts = selected.reduce<Map<number, DecisionPlayer[]>>((map, player) => map.set(player.projection.teamId, [...(map.get(player.projection.teamId) ?? []), player]), new Map());
  const concentrated = [...clubCounts.values()].find((players) => players.length === 3);
  if (concentrated) objections.push({ severity: 'low', question: 'Is club concentration creating correlated risk?', finding: `The structure uses three ${concentrated[0].projection.team} players.`, evidence: concentrated.map((player) => player.projection.playerName), mitigation: 'Retain only if the fixture run and team-strength assumptions remain strong.' });
  const degraded = args.sourceHealth.filter((source) => source.status !== 'healthy');
  if (degraded.length) objections.push({ severity: 'medium', question: 'Which evidence could invalidate the recommendation?', finding: `${degraded.length} source/model health checks are degraded or failed.`, evidence: degraded.map((source) => `${source.key}: ${source.message}`).slice(0, 4), mitigation: 'Re-run after team news and independent lineup/price data refresh.' });
  if (args.primary.hitCost > 0 && args.primary.netGain6 < args.primary.hitCost + 2) objections.push({ severity: 'high', question: 'Does the hit have enough margin?', finding: `The ${args.primary.hitCost}-point hit has only ${args.primary.netGain6} net projected points over six Gameweeks.`, evidence: [`GW3 net: ${args.primary.netGain3}`, `GW6 net: ${args.primary.netGain6}`], mitigation: 'Roll or make only the highest-impact free transfer.' });
  const alternative = chooseRedTeamAlternative(args.primary, args.scenarios, args.baseline);
  const strongest = [...objections].sort((a, b) => severityRank(b.severity) - severityRank(a.severity))[0];
  const critical = objections.some((objection) => objection.severity === 'critical');
  const high = objections.filter((objection) => objection.severity === 'high').length;
  return {
    verdict: critical ? 'block' : high ? 'challenge' : 'accept_with_caveats', primaryScenarioId: args.primary.id,
    alternativeScenario: alternative.scenario, materiallyDifferent: alternative.materiallyDifferent,
    objections, strongestObjection: strongest?.finding ?? 'No material objection cleared the Red Team threshold.',
  };
}
