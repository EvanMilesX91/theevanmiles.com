import type { CouncilLensKey } from './types';

export const COUNCIL_WEIGHTS: Record<CouncilLensKey, number> = {
  projection: 0.25,
  value: 0.17,
  minutes: 0.15,
  fixtures: 0.10,
  historical: 0.08,
  rules_position: 0.07,
  captaincy: 0.07,
  new_player: 0.04,
  risk: 0.04,
  contrarian: 0.03,
};
