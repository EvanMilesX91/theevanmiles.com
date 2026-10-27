import type { MonitoredPlayer, PlayerChange, ProactiveAlert, SquadLedger } from './types';

const playerEvidence = (player: MonitoredPlayer) => [
  `£${player.price.toFixed(1)}m; monitoring score ${player.signalScore.toFixed(1)}; position rank ${player.positionRank}`,
  `Last five: ${player.rolling5.points} points, ${player.rolling5.minutes} minutes, ${player.rolling5.expectedGoalInvolvements.toFixed(2)} xGI`,
  `Transfer balance this Gameweek: ${player.transferBalance >= 0 ? '+' : ''}${player.transferBalance.toLocaleString('en-GB')}`,
];

function bestReplacement(player: MonitoredPlayer, players: MonitoredPlayer[], ledger: SquadLedger): MonitoredPlayer | null {
  const budget = (player.sellingPrice ?? player.price) + ledger.bank;
  return players
    .filter((candidate) => !candidate.owned && candidate.eligible && candidate.position === player.position && candidate.price <= budget)
    .sort((a, b) => b.signalScore - a.signalScore || b.valueSignal - a.valueSignal)[0] ?? null;
}

export function generateProactiveAlerts(args: {
  players: MonitoredPlayer[];
  ledger: SquadLedger;
  changes: PlayerChange[];
}): ProactiveAlert[] {
  const alerts: ProactiveAlert[] = [];
  const owned = args.players.filter((player) => player.owned);
  for (const player of owned) {
    const replacement = bestReplacement(player, args.players, args.ledger);
    if (!player.eligible || player.status === 'u') {
      alerts.push({
        kind: 'mandatory_sell', severity: 'critical', playerId: player.id, playerName: player.name,
        replacementId: replacement?.id ?? null, replacementName: replacement?.name ?? null, confidence: 98,
        reason: `${player.name} is not selectable or has an unavailable official status, so the squad slot has zero dependable utility.`,
        evidence: playerEvidence(player),
      });
      continue;
    }
    if (player.price >= 9 && player.rolling5.pointsPerAppearance < 4 && player.rolling5.minutes >= 300) {
      alerts.push({
        kind: 'premium_underperformer', severity: 'high', playerId: player.id, playerName: player.name,
        replacementId: replacement?.id ?? null, replacementName: replacement?.name ?? null, confidence: 82,
        reason: `${player.name} is consuming premium budget while returning fewer than four points per appearance across the five-Gameweek window.`,
        evidence: playerEvidence(player),
      });
    }
    if (player.rolling3.minutes < 120 && player.seasonMinutes > 0) {
      alerts.push({
        kind: 'minutes_risk', severity: 'high', playerId: player.id, playerName: player.name,
        replacementId: replacement?.id ?? null, replacementName: replacement?.name ?? null, confidence: 86,
        reason: `${player.name} has played only ${player.rolling3.minutes} minutes in the last three Gameweeks.`,
        evidence: playerEvidence(player),
      });
    }
    if (replacement && replacement.signalScore - player.signalScore >= 10) {
      alerts.push({
        kind: 'replacement_edge', severity: 'medium', playerId: player.id, playerName: player.name,
        replacementId: replacement.id, replacementName: replacement.name, confidence: 72,
        reason: `${replacement.name} leads ${player.name} by ${(replacement.signalScore - player.signalScore).toFixed(1)} monitoring-score points at an affordable price.`,
        evidence: [...playerEvidence(player), ...playerEvidence(replacement)],
      });
    }
    if (player.transferBalance < -150_000) {
      alerts.push({
        kind: 'price_risk', severity: 'medium', playerId: player.id, playerName: player.name,
        replacementId: replacement?.id ?? null, replacementName: replacement?.name ?? null, confidence: 65,
        reason: `${player.name} has a transfer balance of ${player.transferBalance.toLocaleString('en-GB')}; check the official predictor before delaying a planned sale.`,
        evidence: playerEvidence(player),
      });
    }
  }

  const changedIds = new Set(args.changes.filter((change) => change.kind === 'signal_rising' || change.kind === 'rank_rising' || change.kind === 'minutes_rising').map((change) => change.playerId));
  args.players
    .filter((player) => !player.owned && player.eligible && player.rolling3.minutes >= 180 && (player.signalScore >= 72 || changedIds.has(player.id)))
    .sort((a, b) => b.signalScore - a.signalScore)
    .slice(0, 8)
    .forEach((player) => alerts.push({
      kind: 'buy_watch', severity: 'low', playerId: player.id, playerName: player.name,
      replacementId: null, replacementName: null, confidence: 68,
      reason: `${player.name} has entered the proactive watchlist before an owned-player comparison is requested.`,
      evidence: playerEvidence(player),
    }));

  const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  return alerts.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity] || b.confidence - a.confidence);
}
