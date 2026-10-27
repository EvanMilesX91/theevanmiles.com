import { fetchPhaseOneOfficialData, runPhaseOne, type FetchLike, type PhaseOneOfficialData, type SquadLedger } from '../phase1';
import { loadLineupObservations, assessRole } from './lineups';
import { projectMinutes, assessSustainability } from './player-model';
import { calculateInjuryImpacts, buildTeamRatings } from './team-model';
import { projectPlayer } from './xpts';
import { writePhaseTwoSnapshot } from './store';
import type { PhaseTwoSnapshot } from './types';

export interface RunPhaseTwoOptions {
  fetcher?: FetchLike;
  persist?: boolean;
  root?: string;
  ledger?: SquadLedger;
  officialData?: PhaseOneOfficialData;
  now?: Date;
  lineupUrl?: string;
}

export async function runPhaseTwo(options: RunPhaseTwoOptions = {}): Promise<PhaseTwoSnapshot> {
  const root = options.root ?? process.cwd();
  const persist = options.persist ?? process.env.VERCEL !== '1';
  const officialData = options.officialData ?? await fetchPhaseOneOfficialData(options.fetcher);
  const phaseOne = await runPhaseOne({ fetcher: options.fetcher, persist, root, ledger: options.ledger, officialData, now: options.now });
  const lineup = await loadLineupObservations({
    root,
    currentGameweek: officialData.currentGameweek,
    bootstrap: officialData.bootstrap,
    fixtures: officialData.fixtures,
    url: options.lineupUrl,
    fetcher: options.fetcher,
    now: options.now,
  });
  const injuryImpacts = calculateInjuryImpacts(officialData.bootstrap);
  const teamRatings = buildTeamRatings(officialData.bootstrap, officialData.fixtures, injuryImpacts);
  const officialById = new Map(officialData.bootstrap.elements.map((player) => [player.id, player]));
  const projections = phaseOne.players.map((player) => {
    const official = officialById.get(player.id);
    if (!official) throw new Error(`Missing official player ${player.id}.`);
    const role = assessRole(player, lineup.observations, officialData.currentGameweek);
    const minutes = projectMinutes(player, official, role, player.nextFixtures.length, Math.max(1, officialData.currentGameweek));
    const sustainability = assessSustainability(player, official);
    return projectPlayer({ player, official, officialTeams: officialData.bootstrap.teams, teamRatings, minutes, role, sustainability });
  }).sort((a, b) => b.xPts6 - a.xPts6);
  const snapshot: PhaseTwoSnapshot = {
    schemaVersion: 2, modelVersion: 'phase2-transparent-v1', generatedAt: (options.now ?? new Date()).toISOString(),
    currentGameweek: officialData.currentGameweek, nextGameweek: officialData.nextGameweek,
    sourceHealth: [...officialData.sourceHealth, lineup.health], phaseOne, teamRatings, injuryImpacts, projections,
    roleChanges: projections.filter((projection) => (projection.role.change === 'confirmed' || projection.role.change === 'possible') && (projection.role.latestGameweek ?? 0) >= officialData.currentGameweek - 2),
    modelNotes: [
      'xPts are transparent model estimates, not official FPL projections.',
      'Expected minutes combine official availability, season starts and last-five minutes; no current predicted-lineup claim is made without fresh independent evidence.',
      'Team ratings blend actual goals with official FPL strength priors, shrink small samples toward league average, and apply capped injury effects.',
      'Role changes require confirmed-lineup evidence: two matching starts for confirmed, one for possible.',
      'Ranges express model and minutes uncertainty; they are not calibrated betting intervals.',
    ],
  };
  if (persist) await writePhaseTwoSnapshot(snapshot, root);
  return snapshot;
}
