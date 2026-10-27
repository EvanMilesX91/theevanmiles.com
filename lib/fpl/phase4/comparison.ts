import type { DecisionPlayer, TransferScenario } from '../phase3';
import type { NotableOmission, PlayerComparison, PlayerCouncil } from './types';

const round = (value: number, digits = 2) => Number(value.toFixed(digits));

export function comparePlayers(selected: DecisionPlayer, alternative: DecisionPlayer, councils: Map<number, PlayerCouncil>): PlayerComparison {
  const selectedCouncil = councils.get(selected.projection.playerId);
  const alternativeCouncil = councils.get(alternative.projection.playerId);
  const xPtsDifference6 = selected.projection.xPts6 - alternative.projection.xPts6;
  const priceDifference = selected.projection.price - alternative.projection.price;
  const reason = priceDifference <= 0 && xPtsDifference6 >= 0
    ? `${selected.projection.playerName} is both cheaper and projects better over six Gameweeks.`
    : `${selected.projection.playerName} costs £${Math.abs(priceDifference).toFixed(1)}m ${priceDifference > 0 ? 'more' : 'less'} and projects ${Math.abs(xPtsDifference6).toFixed(2)} points ${xPtsDifference6 >= 0 ? 'more' : 'fewer'} over six Gameweeks; the whole-squad optimizer prefers the resulting allocation.`;
  const swing = Math.max(0.5, Math.abs(xPtsDifference6) + 0.5);
  return {
    selectedPlayerId: selected.projection.playerId, selectedPlayerName: selected.projection.playerName,
    alternativePlayerId: alternative.projection.playerId, alternativePlayerName: alternative.projection.playerName,
    priceDifference: round(priceDifference, 1),
    xPtsDifference1: round(selected.projection.xPts1 - alternative.projection.xPts1),
    xPtsDifference3: round(selected.projection.xPts3 - alternative.projection.xPts3),
    xPtsDifference6: round(xPtsDifference6),
    councilDifference: round((selectedCouncil?.score ?? 0) - (alternativeCouncil?.score ?? 0), 1),
    decision: selected.projection.playerName, reason,
    whatWouldChange: `${alternative.projection.playerName} would overturn this comparison with roughly ${round(swing)} additional six-Gameweek xPts, materially stronger minutes evidence, or if the released £${Math.max(0, -priceDifference).toFixed(1)}m cannot improve another slot.`,
  };
}

export function buildTransferComparisons(scenario: TransferScenario, players: DecisionPlayer[], councils: PlayerCouncil[]): PlayerComparison[] {
  const byId = new Map(players.map((player) => [player.projection.playerId, player]));
  const councilById = new Map(councils.map((council) => [council.playerId, council]));
  return scenario.moves.flatMap((move) => {
    const incoming = byId.get(move.inPlayerId);
    const outgoing = byId.get(move.outPlayerId);
    return incoming && outgoing ? [comparePlayers(incoming, outgoing, councilById)] : [];
  });
}

export function buildNotableOmissions(args: { players: DecisionPlayer[]; councils: PlayerCouncil[]; selectedIds: Set<number> }): NotableOmission[] {
  const councilById = new Map(args.councils.map((council) => [council.playerId, council]));
  const selected = args.players.filter((player) => args.selectedIds.has(player.projection.playerId));
  return args.players
    .filter((player) => !args.selectedIds.has(player.projection.playerId) && player.projection.minutes.appearanceProbability >= 0.5)
    .sort((a, b) => (councilById.get(b.projection.playerId)?.score ?? 0) - (councilById.get(a.projection.playerId)?.score ?? 0))
    .slice(0, 8)
    .map((player): NotableOmission => {
      const council = councilById.get(player.projection.playerId)!;
      const counterpart = selected.filter((candidate) => candidate.projection.position === player.projection.position)
        .sort((a, b) => Math.abs(a.projection.price - player.projection.price) - Math.abs(b.projection.price - player.projection.price))[0];
      const clubBlocked = selected.filter((candidate) => candidate.projection.teamId === player.projection.teamId).length >= 3;
      const priceGap = counterpart ? player.projection.price - counterpart.projection.price : 0;
      const whyExcluded = clubBlocked
        ? 'The selected squad already uses three players from this club.'
        : counterpart && priceGap > 0 ? `${counterpart.projection.playerName} preserves £${priceGap.toFixed(1)}m for other positions.`
        : 'Another legal whole-squad structure produced a better multi-horizon objective after minutes and risk were considered.';
      return {
        playerId: player.projection.playerId, playerName: player.projection.playerName, price: player.projection.price, xPts3: player.projection.xPts3,
        councilScore: council.score, verdict: council.verdict,
        selectedAlternativeId: counterpart?.projection.playerId ?? null, selectedAlternativeName: counterpart?.projection.playerName ?? null,
        whyExcluded,
        whatWouldChange: counterpart ? `A ${round(Math.max(0.5, counterpart.projection.xPts3 - player.projection.xPts3 + 0.5))}-point improvement over three Gameweeks, stronger minutes evidence, or enough spare budget would reopen the decision.` : 'A legal same-position route and sufficient budget would reopen the decision.',
      };
    });
}
