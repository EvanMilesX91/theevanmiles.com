import type { MonitoredPlayer, PhaseOneSnapshot, PlayerChange } from './types';

const importance = (value: number) => Math.max(1, Math.min(100, Math.round(value)));

export function detectChanges(previous: PhaseOneSnapshot | null, currentPlayers: MonitoredPlayer[]): PlayerChange[] {
  if (!previous) return [];
  const before = new Map(previous.players.map((player) => [player.id, player]));
  const changes: PlayerChange[] = [];
  for (const player of currentPlayers) {
    const old = before.get(player.id);
    if (!old) {
      changes.push({ playerId: player.id, playerName: player.name, kind: 'new_player', importance: 35, fact: `${player.name} entered the selectable player pool.`, interpretation: 'Evaluate price, role and expected minutes before treating the player as a target.' });
      continue;
    }
    if (player.price !== old.price) {
      const rise = player.price > old.price;
      changes.push({ playerId: player.id, playerName: player.name, kind: rise ? 'price_rise' : 'price_fall', importance: 45, fact: `${player.name} moved from £${old.price.toFixed(1)}m to £${player.price.toFixed(1)}m.`, interpretation: rise ? 'The market is increasing the cost of waiting.' : 'Selling value and replacement affordability may have changed.' });
    }
    if (player.status !== old.status) {
      const improved = player.status === 'a';
      changes.push({ playerId: player.id, playerName: player.name, kind: improved ? 'availability_improved' : 'availability_worsened', importance: improved ? 65 : 90, fact: `${player.name}'s official status changed from ${old.status} to ${player.status}.`, interpretation: improved ? 'Expected minutes should be restored cautiously.' : 'Recalculate the player and the effect on teammates immediately.' });
    }
    if (player.news !== old.news && player.news.trim()) {
      changes.push({ playerId: player.id, playerName: player.name, kind: 'news_changed', importance: 60, fact: `Official news changed: ${player.news}`, interpretation: 'Treat the report as a fact source but keep return dates uncertain unless confirmed.' });
    }
    const signalDelta = player.signalScore - old.signalScore;
    if (Math.abs(signalDelta) >= 5) {
      const rising = signalDelta > 0;
      changes.push({ playerId: player.id, playerName: player.name, kind: rising ? 'signal_rising' : 'signal_falling', importance: importance(35 + Math.abs(signalDelta) * 3), fact: `${player.name}'s monitoring score ${rising ? 'rose' : 'fell'} ${Math.abs(signalDelta).toFixed(1)} points.`, interpretation: rising ? 'The player deserves a fresh comparison against current alternatives.' : 'Do not retain the player purely because of the original selection decision.' });
    }
    const rankDelta = old.globalRank - player.globalRank;
    if (Math.abs(rankDelta) >= 10) {
      const rising = rankDelta > 0;
      changes.push({ playerId: player.id, playerName: player.name, kind: rising ? 'rank_rising' : 'rank_falling', importance: importance(30 + Math.abs(rankDelta)), fact: `${player.name} moved ${Math.abs(rankDelta)} places ${rising ? 'up' : 'down'} the full-pool ranking.`, interpretation: rising ? 'Investigate before the movement becomes obvious from total points.' : 'Check whether role, minutes or fixtures caused the decline.' });
    }
    const minutesDelta = player.minutesTrend - old.minutesTrend;
    if (Math.abs(minutesDelta) >= 20) {
      const rising = minutesDelta > 0;
      changes.push({ playerId: player.id, playerName: player.name, kind: rising ? 'minutes_rising' : 'minutes_falling', importance: importance(45 + Math.abs(minutesDelta)), fact: `${player.name}'s recent minutes trend changed by ${Math.abs(minutesDelta).toFixed(0)} minutes per match.`, interpretation: rising ? 'A more secure role may be emerging.' : 'Expected minutes and transfer value need to be reduced.' });
    }
  }
  return changes.sort((a, b) => b.importance - a.importance);
}
