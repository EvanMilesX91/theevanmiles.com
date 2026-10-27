import type {
  ConfirmedTransfer,
  OfficialPlayer,
  SquadLedger,
  TransferProposal,
} from './types';

const INITIAL_UPDATED_AT = '2026-10-23T17:30:00.000Z';

export const DEFAULT_OWNER_LEDGER: SquadLedger = {
  schemaVersion: 1,
  managerName: 'Dominika Kuzniar',
  teamName: 'What The Van Vecke',
  lastConfirmedGameweek: 7,
  nextGameweek: 8,
  bank: 0.9,
  freeTransfers: 1,
  squad: [
    { elementId: 1, purchasePrice: 6.0, acquiredGameweek: 1 },
    { elementId: 110, purchasePrice: 4.5, acquiredGameweek: 1 },
    { elementId: 388, purchasePrice: 6.0, acquiredGameweek: 1 },
    { elementId: 204, purchasePrice: 4.5, acquiredGameweek: 1 },
    { elementId: 229, purchasePrice: 6.0, acquiredGameweek: 1 },
    { elementId: 31, purchasePrice: 4.5, acquiredGameweek: 1 },
    { elementId: 176, purchasePrice: 4.0, acquiredGameweek: 7 },
    { elementId: 426, purchasePrice: 12.0, acquiredGameweek: 1 },
    { elementId: 13, purchasePrice: 7.5, acquiredGameweek: 1 },
    { elementId: 124, purchasePrice: 6.1, acquiredGameweek: 7 },
    { elementId: 290, purchasePrice: 4.5, acquiredGameweek: 1 },
    { elementId: 338, purchasePrice: 5.5, acquiredGameweek: 1 },
    { elementId: 411, purchasePrice: 15.5, acquiredGameweek: 1 },
    { elementId: 165, purchasePrice: 7.7, acquiredGameweek: 4 },
    { elementId: 441, purchasePrice: 4.5, acquiredGameweek: 1 },
  ],
  lastConfirmedXi: [1, 388, 229, 204, 31, 426, 13, 124, 290, 411, 165],
  captainId: 411,
  viceCaptainId: 165,
  chips: {
    wildcard: 'available',
    free_hit: 'available',
    triple_captain: 'used',
    bench_boost: 'available',
  },
  confirmedTransfers: [],
  updatedAt: INITIAL_UPDATED_AT,
};

export function cloneLedger(ledger: SquadLedger): SquadLedger {
  return structuredClone(ledger);
}

export function calculateSellingPrice(purchasePrice: number, currentPrice: number): number {
  if (currentPrice <= purchasePrice) return currentPrice;
  const profitTenths = Math.floor((currentPrice * 10 - purchasePrice * 10) / 2);
  return Number((purchasePrice + profitTenths / 10).toFixed(1));
}

export function createTransferProposal(args: {
  ledger: SquadLedger;
  players: OfficialPlayer[];
  outElementId: number;
  inElementId: number;
  gameweek: number;
  now?: Date;
}): TransferProposal {
  const { ledger, players, outElementId, inElementId, gameweek } = args;
  const owned = ledger.squad.find((player) => player.elementId === outElementId);
  if (!owned) throw new Error('Cannot propose selling a player who is not in the confirmed squad.');
  if (ledger.squad.some((player) => player.elementId === inElementId)) throw new Error('Incoming player is already owned.');
  const outgoing = players.find((player) => player.id === outElementId);
  const incoming = players.find((player) => player.id === inElementId);
  if (!outgoing || !incoming) throw new Error('Transfer player is missing from the current official player pool.');
  if (outgoing.element_type !== incoming.element_type) throw new Error('Transfers must preserve the FPL squad position.');
  const sellPrice = calculateSellingPrice(owned.purchasePrice, outgoing.now_cost / 10);
  const buyPrice = incoming.now_cost / 10;
  const projectedBank = Number((ledger.bank + sellPrice - buyPrice).toFixed(1));
  if (projectedBank < 0) throw new Error('Proposed transfer is unaffordable.');
  const projectedHitCost = ledger.freeTransfers > 0 ? 0 : 4;
  const createdAt = (args.now ?? new Date()).toISOString();
  return {
    id: `proposal-${gameweek}-${outElementId}-${inElementId}-${createdAt}`,
    gameweek,
    outElementId,
    inElementId,
    projectedBank,
    projectedHitCost,
    createdAt,
    status: 'proposed',
  };
}

export function confirmTransfer(args: {
  ledger: SquadLedger;
  proposal: TransferProposal;
  players: OfficialPlayer[];
  confirmation: { confirmed: true; reference: string; confirmedAt?: string };
}): SquadLedger {
  if (args.confirmation.confirmed !== true || !args.confirmation.reference.trim()) {
    throw new Error('An explicit confirmation reference is required before changing the ledger.');
  }
  const next = cloneLedger(args.ledger);
  const outgoingIndex = next.squad.findIndex((player) => player.elementId === args.proposal.outElementId);
  const outgoing = args.players.find((player) => player.id === args.proposal.outElementId);
  const incoming = args.players.find((player) => player.id === args.proposal.inElementId);
  if (outgoingIndex < 0 || !outgoing || !incoming) throw new Error('Proposal no longer matches the confirmed squad or current player pool.');
  const sellPrice = calculateSellingPrice(next.squad[outgoingIndex].purchasePrice, outgoing.now_cost / 10);
  const buyPrice = incoming.now_cost / 10;
  next.squad[outgoingIndex] = {
    elementId: incoming.id,
    purchasePrice: buyPrice,
    acquiredGameweek: args.proposal.gameweek,
  };
  next.bank = Number((next.bank + sellPrice - buyPrice).toFixed(1));
  const hitCost = next.freeTransfers > 0 ? 0 : 4;
  next.freeTransfers = Math.max(0, next.freeTransfers - 1);
  const confirmedAt = args.confirmation.confirmedAt ?? new Date().toISOString();
  const transfer: ConfirmedTransfer = {
    id: args.proposal.id.replace('proposal-', 'confirmed-'),
    gameweek: args.proposal.gameweek,
    outElementId: outgoing.id,
    inElementId: incoming.id,
    sellPrice,
    buyPrice,
    hitCost,
    confirmedAt,
    confirmationReference: args.confirmation.reference,
  };
  next.confirmedTransfers.push(transfer);
  next.updatedAt = confirmedAt;
  return next;
}

export function validateLedgerShape(ledger: SquadLedger): string[] {
  const problems: string[] = [];
  if (ledger.squad.length !== 15) problems.push(`Expected 15 players, found ${ledger.squad.length}.`);
  const ids = ledger.squad.map((player) => player.elementId);
  if (new Set(ids).size !== ids.length) problems.push('Confirmed squad contains duplicate player IDs.');
  if (ledger.bank < 0) problems.push('Confirmed bank cannot be negative.');
  if (ledger.freeTransfers < 0 || ledger.freeTransfers > 5) problems.push('Free transfers must be between zero and five.');
  return problems;
}
