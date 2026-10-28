'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Activity, AlertTriangle, ArrowRight, BarChart3, Check, ChevronRight,
  Clock3, Database, Layers3, RefreshCw, Search, ShieldCheck, Sparkles, Target,
  TrendingDown, TrendingUp, X,
} from 'lucide-react';
import type { DashboardPlayer } from '@/lib/fpl/phase5';
import type { PhaseSixSnapshot } from '@/lib/fpl/phase6';
import styles from './FplDashboard.module.css';

type Tab = 'overview' | 'squad' | 'transfers' | 'chips' | 'council' | 'context' | 'data';

const tabs: Array<{ id: Tab; label: string }> = [
  { id: 'overview', label: 'Decision' },
  { id: 'squad', label: 'Squad' },
  { id: 'transfers', label: 'Transfers' },
  { id: 'chips', label: 'Chips' },
  { id: 'council', label: 'Council' },
  { id: 'context', label: 'Match Context' },
  { id: 'data', label: 'Data' },
];

const pct = (value: number) => `${Math.round(value * 100)}%`;
const price = (value: number) => `£${value.toFixed(1)}m`;
const signed = (value: number) => `${value > 0 ? '+' : ''}${value.toFixed(2)}`;
const titleCase = (value: string) => value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());

function StatusDot({ status }: { status: string }) {
  return <span className={`${styles.statusDot} ${styles[`status_${status}`] ?? ''}`} aria-hidden="true" />;
}

function LoadingState() {
  return (
    <div className={styles.loadingShell}>
      <div className={styles.loaderMark}><span /><span /><span /></div>
      <p>Compiling the decision room</p>
      <span>Refreshing prices, projections, Council and Red Team…</span>
    </div>
  );
}

function PlayerDrawer({ player, onClose }: { player: DashboardPlayer; onClose: () => void }) {
  return (
    <div className={styles.drawerBackdrop} onMouseDown={onClose} role="presentation">
      <aside className={styles.drawer} onMouseDown={(event) => event.stopPropagation()} aria-label={`${player.name} analysis`}>
        <button className={styles.closeButton} onClick={onClose} aria-label="Close player analysis"><X size={18} /></button>
        <div className={styles.eyebrow}>{player.position} · {player.team}</div>
        <div className={styles.drawerHeading}>
          <div><h2>{player.name}</h2><p>{price(player.price)} · {player.expectedMinutes} expected minutes</p></div>
          <div className={styles.scoreOrb}><strong>{player.council.score}</strong><span>Council</span></div>
        </div>
        <div className={styles.playerStats}>
          <div><span>GW xPts</span><strong>{player.xPts1}</strong></div>
          <div><span>3 GW</span><strong>{player.xPts3}</strong></div>
          <div><span>6 GW</span><strong>{player.xPts6}</strong></div>
          <div><span>Confidence</span><strong>{player.confidence}%</strong></div>
        </div>
        <p className={styles.drawerReason}>{player.oneLineReason}</p>
        {player.council.disagreement && <div className={styles.disagreement}><AlertTriangle size={16} /><span>{player.council.disagreementSummary}</span></div>}

        <section className={styles.drawerSection}>
          <div className={styles.sectionLabel}>For</div>
          {player.council.for.map((reason) => <p className={styles.proLine} key={reason}><Check size={14} />{reason}</p>)}
        </section>
        <section className={styles.drawerSection}>
          <div className={styles.sectionLabel}>Against</div>
          {player.council.against.map((reason) => <p className={styles.conLine} key={reason}><X size={14} />{reason}</p>)}
        </section>
        <section className={styles.drawerSection}>
          <div className={styles.sectionLabel}>Council lenses</div>
          <div className={styles.lensList}>
            {player.council.opinions.map((opinion) => (
              <div className={`${styles.lensRow} ${!opinion.applicable ? styles.notApplicable : ''}`} key={opinion.key}>
                <div><strong>{opinion.name}</strong><span>{opinion.reason}</span></div>
                <div className={styles.lensScore}>{opinion.score}</div>
              </div>
            ))}
          </div>
        </section>
        <section className={styles.drawerSection}>
          <div className={styles.sectionLabel}>Fixtures</div>
          <div className={styles.fixtureStrip}>
            {player.fixtures.slice(0, 6).map((fixture) => (
              <div key={`${fixture.gameweek}-${fixture.opponent}`}><span>GW{fixture.gameweek}</span><strong>{fixture.opponent} {fixture.home ? 'H' : 'A'}</strong><em>{fixture.xPts}</em></div>
            ))}
          </div>
        </section>
        <section className={styles.drawerSection}>
          <div className={styles.sectionLabel}>Value & risk</div>
          <dl className={styles.detailList}>
            <div><dt>Value above replacement</dt><dd>{signed(player.value.valueAboveReplacement6)}</dd></div>
            <div><dt>Six-GW xPts / £m</dt><dd>{player.value.xPtsPerMillion6}</dd></div>
            <div><dt>Start probability</dt><dd>{pct(player.startProbability)}</dd></div>
            <div><dt>Price pressure</dt><dd>{titleCase(player.pricePressure.direction)}</dd></div>
            <div><dt>Role evidence</dt><dd>{titleCase(player.roleChange)}</dd></div>
            <div><dt>Return profile</dt><dd>{titleCase(player.sustainability)}</dd></div>
            <div><dt>Predicted XI shadow</dt><dd>{player.shadowLineupPrediction ? `${titleCase(player.shadowLineupPrediction)} · ${player.shadowLineupConfidence}%${player.shadowLineupContradiction ? ' conflict' : ''}` : 'No signal'}</dd></div>
            <div><dt>Availability consensus</dt><dd>{player.availabilityConsensus ? titleCase(player.availabilityConsensus.level) : 'No signal'}</dd></div>
            <div><dt>Commentary context</dt><dd>{player.commentary ? `${titleCase(player.commentary.status)} · ${player.commentary.confidence}%` : 'No signal'}</dd></div>
          </dl>
          {player.availabilityConsensus && <p className={styles.caveat}>{player.availabilityConsensus.explanation}</p>}
          {player.commentary && <><p className={styles.caveat}>{player.commentary.headline} {titleCase(player.commentary.modelEffect)}.</p><ul className={styles.notesList}>{player.commentary.evidence.slice(0, 6).map((item) => <li key={item}>{item}</li>)}</ul>{player.commentary.sourceUrls?.[0] && <a className={styles.textButton} href={player.commentary.sourceUrls[0]} target="_blank" rel="noreferrer">Open supporting match commentary <ArrowRight size={15} /></a>}</>}
          <p className={styles.caveat}>{player.pricePressure.caveat}</p>
        </section>
      </aside>
    </div>
  );
}

function Pitch({ data, playerById, onPlayer }: { data: PhaseSixSnapshot; playerById: Map<number, DashboardPlayer>; onPlayer: (player: DashboardPlayer) => void }) {
  const lineup = data.lineup;
  const starters = lineup.starterIds.map((id) => playerById.get(id)).filter((player): player is DashboardPlayer => Boolean(player));
  const groups = (['FWD', 'MID', 'DEF', 'GK'] as const).map((position) => starters.filter((player) => player.position === position));
  return (
    <div className={styles.pitchWrap}>
      <div className={styles.pitch}>
        <div className={styles.pitchCircle} /><div className={styles.pitchHalf} /><div className={styles.boxTop} /><div className={styles.boxBottom} />
        <div className={styles.pitchPlayers}>
          {groups.map((group, index) => (
            <div className={styles.pitchLine} style={{ gridTemplateColumns: `repeat(${Math.max(1, group.length)}, minmax(0, 1fr))` }} key={index}>
              {group.map((player) => (
                <button className={styles.pitchPlayer} onClick={() => onPlayer(player)} key={player.id}>
                  <span className={styles.playerBadges}>
                    {lineup.captainId === player.id && <b>C</b>}
                    {lineup.viceCaptainId === player.id && <b>V</b>}
                  </span>
                  <strong>{player.name}</strong><small>{player.xPts1} xPts</small>
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function FplDashboard() {
  const [data, setData] = useState<PhaseSixSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('overview');
  const [selectedPlayer, setSelectedPlayer] = useState<DashboardPlayer | null>(null);
  const [query, setQuery] = useState('');
  const [compareA, setCompareA] = useState<number | null>(null);
  const [compareB, setCompareB] = useState<number | null>(null);

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const response = await fetch('/api/fpl/phase-six', { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || 'The decision engine did not return a valid response.');
      setData(payload);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to refresh the decision room.');
    } finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, []);

  const playerById = useMemo(() => new Map((data?.players ?? []).map((player) => [player.id, player])), [data]);
  const owned = useMemo(() => (data?.players ?? []).filter((player) => player.owned), [data]);
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return (data?.players ?? []).filter((player) => !normalized || `${player.name} ${player.team} ${player.position}`.toLowerCase().includes(normalized)).sort((a, b) => b.council.score - a.council.score).slice(0, normalized ? 40 : 20);
  }, [data, query]);

  if (loading && !data) return <main className={styles.page}><LoadingState /></main>;
  if (!data) return <main className={styles.page}><div className={styles.errorState}><AlertTriangle /><h1>Decision room unavailable</h1><p>{error}</p><button onClick={load}><RefreshCw size={16} /> Retry refresh</button></div></main>;

  const primary = data.finalCommittee.primaryScenario;
  const captain = playerById.get(data.lineup.captainId);
  const vice = playerById.get(data.lineup.viceCaptainId);
  const bench = data.lineup.benchIds.map((id) => playerById.get(id)).filter((player): player is DashboardPlayer => Boolean(player));
  const healthySources = data.sourceHealth.filter((source) => source.status === 'healthy').length;
  const compareFirst = compareA ? playerById.get(compareA) : null;
  const compareSecond = compareB ? playerById.get(compareB) : null;
  const commentaryInsights = data.commentaryInsights ?? [];
  const recommendedChipAssessment = data.chipPlan.assessments.find((item) => item.chip === data.chipPlan.recommendation.chip);
  const recommendedChipOpportunity = recommendedChipAssessment?.opportunities.find((item) => item.gameweek === data.chipPlan.recommendation.gameweek);

  return (
    <main className={styles.page}>
      <div className={styles.ambientOne} /><div className={styles.ambientTwo} /><div className={styles.gridNoise} />
      <div className={styles.shell}>
        <header className={styles.hero}>
          <div>
            <div className={styles.kicker}><span>EM / FPL</span><i />GW{data.nextGameweek} decision room</div>
            <h1>Build the edge.<br /><em>Explain every call.</em></h1>
            <p>Whole-pool projections, a legal optimizer, ten independent decision lenses and a Red Team that is paid to disagree.</p>
          </div>
          <div className={styles.heroMeta}>
            <div><StatusDot status={data.ledger.stale ? 'degraded' : 'healthy'} /><span>{data.ledger.stale ? 'Ledger needs confirmation' : 'Decision state current'}</span></div>
            <button onClick={load} disabled={loading}><RefreshCw size={15} className={loading ? styles.spinning : ''} /> Refresh</button>
            <small>Snapshot {new Date(data.automation.refreshedAt).toLocaleString('en-IE', { dateStyle: 'medium', timeStyle: 'short' })}</small>
          </div>
        </header>

        <nav className={styles.tabs} aria-label="FPL dashboard sections">
          {tabs.map((item) => <button className={tab === item.id ? styles.activeTab : ''} onClick={() => setTab(item.id)} key={item.id}>{item.label}</button>)}
        </nav>

        {error && <div className={styles.inlineError}><AlertTriangle size={15} /> Latest refresh failed; showing the previous result. {error}</div>}

        {tab === 'overview' && <>
          <section className={`${styles.decisionCard} ${data.finalCommittee.status === 'blocked_pending_ledger' ? styles.waitDecision : styles.goDecision}`}>
            <div className={styles.decisionIcon}>{data.finalCommittee.status === 'blocked_pending_ledger' ? <Clock3 /> : <Sparkles />}</div>
            <div><span>Final Committee</span><h2>{data.finalCommittee.decisionLine}</h2><p>{data.finalCommittee.rationale[2]}</p></div>
            <div className={styles.confidence}><strong>{data.finalCommittee.confidence}</strong><span>confidence</span><small>{data.finalCommittee.probability?.beatRoll3 ?? 50}% beat roll / 3GW</small></div>
          </section>

          <section className={styles.metricGrid}>
            <article><Target /><span>Projected XI</span><strong>{data.lineup.xPts1WithCaptain}</strong><small>GW{data.nextGameweek} incl. captain</small></article>
            <article><BarChart3 /><span>Formation</span><strong>{data.lineup.formation}</strong><small>{data.lineup.validation.pass ? 'Rule check passed' : 'Validation issue'}</small></article>
            <article><Sparkles /><span>Captain</span><strong>{captain?.name ?? '—'}</strong><small>VC · {vice?.name ?? '—'}</small></article>
            <article><Database /><span>Source health</span><strong>{healthySources}/{data.sourceHealth.length}</strong><small>healthy inputs</small></article>
          </section>

          <section className={styles.twoColumn}>
            <article className={styles.panel}>
              <div className={styles.panelHead}><div><span>Provisional action</span><h3>{primary.moves.length ? primary.moves.map((move) => `${move.outPlayerName} → ${move.inPlayerName}`).join(' + ') : 'Roll the transfer'}</h3></div><TrendingUp /></div>
              <div className={styles.gainGrid}>
                <div><span>GW1 gain</span><strong>{signed(primary.netGain1)}</strong></div><div><span>3 GW gain</span><strong>{signed(primary.netGain3)}</strong></div><div><span>6 GW gain</span><strong>{signed(primary.netGain6)}</strong></div>
              </div>
              <p>{data.transferDecision.reason}</p>
              <button className={styles.textButton} onClick={() => setTab('transfers')}>Interrogate the transfer <ArrowRight size={15} /></button>
            </article>
            <article className={styles.panel}>
              <div className={styles.panelHead}><div><span>Red Team</span><h3>{titleCase(data.redTeam.verdict)}</h3></div><ShieldCheck /></div>
              <p className={styles.redTeamLead}>{data.redTeam.strongestObjection}</p>
              <div className={styles.altRoute}><span>Alternative route</span><strong>{data.redTeam.alternativeScenario.moves.length ? data.redTeam.alternativeScenario.moves.map((move) => `${move.outPlayerName} → ${move.inPlayerName}`).join('; ') : 'Roll'}</strong></div>
              <button className={styles.textButton} onClick={() => setTab('transfers')}>Read the challenge <ArrowRight size={15} /></button>
            </article>
          </section>

          <section className={styles.chipDecision}>
            <div className={styles.decisionIcon}><Layers3 /></div>
            <div><span>Chip planner</span><h3>{data.chipPlan.recommendation.headline}</h3><p>{data.chipPlan.recommendation.reason}</p></div>
            <button className={styles.textButton} onClick={() => setTab('chips')}>Open the chip schedule <ArrowRight size={15} /></button>
          </section>

          <section className={styles.panel}>
            <div className={styles.panelHead}><div><span>Evidence chain</span><h3>From source to decision</h3></div><Activity /></div>
            <div className={styles.evidenceChain}>{data.finalCommittee.evidenceChain.map((item, index) => <div key={item.kind}><b>{String(index + 1).padStart(2, '0')}</b><span>{titleCase(item.kind)}</span><p>{item.statement}</p></div>)}</div>
          </section>
        </>}

        {tab === 'squad' && <>
          <section className={styles.squadHeader}><div><span>Optimized XI</span><h2>{data.lineup.formation} · {data.lineup.xPts1WithCaptain} xPts</h2></div><p>Tap any player to inspect the evidence behind their selection.</p></section>
          <section className={styles.squadLayout}>
            <Pitch data={data} playerById={playerById} onPlayer={setSelectedPlayer} />
            <aside className={styles.benchPanel}>
              <div className={styles.sectionLabel}>Bench order</div>
              {bench.map((player, index) => <button onClick={() => setSelectedPlayer(player)} key={player.id}><b>{player.position === 'GK' ? 'GK' : index + 1}</b><span><strong>{player.name}</strong><small>{player.team} · {player.xPts1} xPts</small></span><ChevronRight size={15} /></button>)}
              <div className={styles.captainBlock}><span>Captaincy shortlist</span>{data.lineup.captaincy.slice(0, 4).map((candidate, index) => <div key={candidate.playerId}><b>{index + 1}</b><strong>{candidate.playerName}</strong><span>{candidate.relativeScore}</span></div>)}</div>
            </aside>
          </section>
          <section className={styles.ownedGrid}>{owned.sort((a, b) => b.council.score - a.council.score).map((player) => <button className={styles.playerTile} onClick={() => setSelectedPlayer(player)} key={player.id}><div><span>{player.position} · {player.team}</span><strong>{player.name}</strong></div><div className={styles.tileScore}>{player.council.score}</div><p>{player.oneLineReason}</p>{player.council.disagreement && <em><AlertTriangle size={13} /> Council disagreement</em>}</button>)}</section>
        </>}

        {tab === 'transfers' && <>
          <section className={styles.transferHero}>
            <div><span>Transfer state</span><h2>{titleCase(data.transferDecision.action)}</h2><p>{data.transferDecision.reason}</p></div>
            <div><span>Bank after primary</span><strong>{price(primary.bankAfter)}</strong><small>{primary.hitCost ? `-${primary.hitCost} hit` : 'No hit'}</small></div>
          </section>
          <section className={styles.scenarioGrid}>
            {[primary, data.redTeam.alternativeScenario, data.transferDecision.baseline].filter((item, index, all) => all.findIndex((other) => other.id === item.id) === index).map((scenario, index) => (
              <article className={styles.scenario} key={scenario.id}><div className={styles.scenarioRank}>0{index + 1}</div><span>{index === 0 ? 'Primary model route' : index === 1 ? 'Red Team route' : 'Roll baseline'}</span><h3>{scenario.moves.length ? scenario.moves.map((move) => `${move.outPlayerName} → ${move.inPlayerName}`).join('; ') : 'No transfer'}</h3><div className={styles.scenarioNumbers}><div><span>3 GW</span><strong>{signed(scenario.netGain3)}</strong></div><div><span>6 GW</span><strong>{signed(scenario.netGain6)}</strong></div><div><span>Bank</span><strong>{price(scenario.bankAfter)}</strong></div></div><p>{scenario.explanation}</p></article>
            ))}
          </section>
          {data.transferComparisons.map((comparison) => <section className={styles.comparisonCard} key={`${comparison.selectedPlayerId}-${comparison.alternativePlayerId}`}><div className={styles.versus}><strong>{comparison.selectedPlayerName}</strong><span>instead of</span><strong>{comparison.alternativePlayerName}</strong></div><div className={styles.comparisonNumbers}><span>{signed(comparison.xPtsDifference3)} xPts / 3GW</span><span>{signed(comparison.priceDifference)}m price</span><span>{signed(comparison.councilDifference)} Council</span></div><p>{comparison.reason}</p><small>Decision flips if: {comparison.whatWouldChange}</small></section>)}
          <section className={styles.panel}><div className={styles.panelHead}><div><span>Red Team objections</span><h3>How this plan fails</h3></div><ShieldCheck /></div><div className={styles.objectionList}>{data.redTeam.objections.map((objection) => <article key={objection.question}><b className={styles[`severity_${objection.severity}`]}>{objection.severity}</b><div><strong>{objection.question}</strong><p>{objection.finding}</p><small>{objection.mitigation}</small></div></article>)}</div></section>
        </>}

        {tab === 'chips' && <>
          <section className={styles.transferHero}>
            <div><span>Half {data.chipPlan.currentHalf} chip call</span><h2>{data.chipPlan.recommendation.headline}</h2><p>{data.chipPlan.recommendation.reason}</p></div>
            <div><span>Decision probability</span><strong>{data.chipPlan.recommendation.confidence}%</strong><small>{data.chipPlan.recommendation.inputConfidence}% input confidence · {data.chipPlan.gameweeksRemaining} deadline{data.chipPlan.gameweeksRemaining === 1 ? '' : 's'} before expiry</small></div>
          </section>
          <section className={styles.chipGrid}>
            {data.chipPlan.assessments.map((assessment) => {
              const best = assessment.opportunities.find((item) => item.gameweek === assessment.bestGameweek) ?? assessment.opportunities[0];
              return <article className={`${styles.chipCard} ${assessment.action === 'use_now' ? styles.chipNow : ''}`} key={assessment.chip}>
                <div className={styles.chipCardHead}><div><span>{titleCase(assessment.availability)}</span><h3>{titleCase(assessment.chip)}</h3></div><b>{titleCase(assessment.action)}</b></div>
                <div className={styles.chipMetrics}><div><span>Best week</span><strong>{assessment.bestGameweek ? `GW${assessment.bestGameweek}` : '—'}</strong></div><div><span>Extra xPts</span><strong>{best ? signed(best.projectedGain) : '—'}</strong></div><div><span>Use-now probability</span><strong>{assessment.probabilityUseNow == null ? '—' : `${assessment.probabilityUseNow}%`}</strong></div></div>
                <p>{assessment.reason}</p>
                {best && <><div className={styles.chipPlayers}>{best.players.slice(0, 5).map((player) => <span key={player}>{player}</span>)}</div><small>p10–p90: {signed(best.outcomeRange.p10)} to {signed(best.outcomeRange.p90)} · {assessment.confidence}% input confidence · {best.caveats[0]}</small></>}
              </article>;
            })}
          </section>
          {(data.chipPlan.recommendation.action === 'use_chip' || data.chipPlan.recommendation.action === 'wait_for_final_refresh') && recommendedChipOpportunity?.squad && <section className={styles.panel}>
            <div className={styles.panelHead}><div><span>Exact provisional setup</span><h3>{titleCase(data.chipPlan.recommendation.chip ?? '')} · {recommendedChipOpportunity.squad.formation} · {recommendedChipOpportunity.projectedTotal} xPts</h3></div><Target /></div>
            <div className={styles.chipSquad}>{recommendedChipOpportunity.squad.players.map((player) => <button onClick={() => { const detail = playerById.get(player.id); if (detail) setSelectedPlayer(detail); }} key={player.id}><span>{player.starter ? 'XI' : 'Bench'} · {player.position} · {player.team}</span><strong>{player.name}{recommendedChipOpportunity.squad?.captainId === player.id ? ' (C)' : recommendedChipOpportunity.squad?.viceCaptainId === player.id ? ' (VC)' : ''}</strong><small>{price(player.price)} · {player.xPts} xPts</small></button>)}</div>
            <p className={styles.caveat}>{recommendedChipOpportunity.transfersRequired ?? 0} squad change{recommendedChipOpportunity.transfersRequired === 1 ? '' : 's'} · {recommendedChipOpportunity.squad.bankAfter == null ? 'Current squad bank unchanged' : `${price(recommendedChipOpportunity.squad.bankAfter)} left in the bank`}. This remains provisional until the final team-news refresh, and it does not alter the ledger.</p>
          </section>}
          <section className={styles.twoColumn}>
            <article className={styles.panel}>
              <div className={styles.panelHead}><div><span>Combined strategy</span><h3>Non-colliding chip sequence</h3></div><Target /></div>
              <div className={styles.opportunityList}>{data.chipPlan.sequence.map((step) => <div key={`${step.chip}-${step.gameweek}`}><b>GW{step.gameweek}</b><span><strong>{titleCase(step.chip)}</strong><small>{step.reason}</small></span><em>{step.quality}</em></div>)}</div>
            </article>
            <article className={styles.panel}>
              <div className={styles.panelHead}><div><span>Opportunity calendar</span><h3>Current top windows</h3></div><Sparkles /></div>
              <div className={styles.opportunityList}>{data.chipPlan.assessments.filter((item) => item.availability === 'available').flatMap((item) => item.opportunities.slice(0, 2)).sort((a, b) => a.gameweek - b.gameweek || b.quality - a.quality).map((opportunity) => <div key={`${opportunity.chip}-${opportunity.gameweek}`}><b>GW{opportunity.gameweek}</b><span><strong>{titleCase(opportunity.chip)}</strong><small>{opportunity.explanation}</small></span><em>{opportunity.quality}</em></div>)}</div>
            </article>
            <article className={styles.panel}>
              <div className={styles.panelHead}><div><span>Blank & double scan</span><h3>{data.chipPlan.calendarFlags.length ? `${data.chipPlan.calendarFlags.length} exceptional Gameweek${data.chipPlan.calendarFlags.length === 1 ? '' : 's'} scheduled` : 'No blanks or doubles currently scheduled'}</h3></div><Layers3 /></div>
              {data.chipPlan.calendarFlags.length ? <ul className={styles.notesList}>{data.chipPlan.calendarFlags.map((flag) => <li key={flag.gameweek}>{flag.explanation}</li>)}</ul> : <p>The official schedule is currently normal through GW{data.chipPlan.expiresAfterGameweek}. The scan reruns automatically after postponements or rearrangements.</p>}
              <a className={styles.textButton} href={data.chipPlan.ruleSourceUrl} target="_blank" rel="noreferrer">Official 2026/27 chip rules <ArrowRight size={15} /></a>
            </article>
          </section>
          <section className={styles.twoColumn}>
            <article className={styles.panel}><div className={styles.panelHead}><div><span>Activation gate</span><h3>{titleCase(data.chipPlan.activationGate.status)}</h3></div><ShieldCheck /></div><p>{data.chipPlan.activationGate.reason}</p><small>{data.chipPlan.activationGate.hoursToDeadline == null ? 'Deadline time unavailable' : `${data.chipPlan.activationGate.hoursToDeadline} hours to deadline`} · {data.chipPlan.activationGate.irreversible ? 'Irreversible after activation' : 'Cancelable before the deadline'}</small></article>
            <article className={styles.panel}><div className={styles.panelHead}><div><span>Ledger cross-check</span><h3>{titleCase(data.chipPlan.entryVerification.status)}</h3></div><ShieldCheck /></div><p>{data.chipPlan.entryVerification.message}</p><small>This read-only check never records transfers or chips.</small></article>
          </section>
          <section className={styles.panel}><div className={styles.panelHead}><div><span>Fixture uncertainty</span><h3>{titleCase(data.chipPlan.calendarUncertainty.level)} · {data.chipPlan.calendarUncertainty.unassignedFixtures} unassigned</h3></div><Layers3 /></div><p>{data.chipPlan.calendarUncertainty.explanation}</p></section>
          <section className={styles.panel}><div className={styles.panelHead}><div><span>Method</span><h3>How each chip is valued</h3></div><ShieldCheck /></div><ul className={styles.notesList}>{data.chipPlan.modelNotes.map((note) => <li key={note}>{note}</li>)}</ul></section>
        </>}

        {tab === 'council' && <>
          <section className={styles.councilIntro}><div><span>Decision Council</span><h2>Ten lenses. One accountable verdict.</h2><p>Different evidence is allowed to disagree. Scores are deterministic model views—not simulated personalities.</p></div><div><strong>{data.players.filter((player) => player.council.disagreement).length}</strong><span>material disagreements</span></div></section>
          <div className={styles.searchBox}><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search every available player…" /></div>
          <section className={styles.councilTable}>
            <div className={styles.tableHead}><span>Player</span><span>xPts 3</span><span>Minutes</span><span>Council</span><span>Verdict</span></div>
            {filtered.map((player) => <button onClick={() => setSelectedPlayer(player)} key={player.id}><span><b>{player.name}</b><small>{player.team} · {player.position} · {price(player.price)}</small></span><strong>{player.xPts3}</strong><strong>{player.expectedMinutes}</strong><strong>{player.council.score}</strong><em className={styles[`verdict_${player.council.verdict}`]}>{titleCase(player.council.verdict)}</em></button>)}
          </section>
          <section className={styles.comparePanel}><div><span>Player comparison</span><h3>Put two decisions side by side</h3></div><div className={styles.selectRow}><select value={compareA ?? ''} onChange={(event) => setCompareA(Number(event.target.value) || null)}><option value="">Select player A</option>{data.players.slice().sort((a, b) => a.name.localeCompare(b.name)).map((player) => <option value={player.id} key={player.id}>{player.name} · {player.team}</option>)}</select><span>VS</span><select value={compareB ?? ''} onChange={(event) => setCompareB(Number(event.target.value) || null)}><option value="">Select player B</option>{data.players.slice().sort((a, b) => a.name.localeCompare(b.name)).map((player) => <option value={player.id} key={player.id}>{player.name} · {player.team}</option>)}</select></div>{compareFirst && compareSecond && <div className={styles.compareResult}><div><strong>{compareFirst.name}</strong><span>{compareFirst.xPts3} xPts · {price(compareFirst.price)}</span><em>Council {compareFirst.council.score}</em></div><div className={styles.compareDelta}><span>3GW edge</span><strong>{signed(compareFirst.xPts3 - compareSecond.xPts3)}</strong><small>{price(Math.abs(compareFirst.price - compareSecond.price))} price gap</small></div><div><strong>{compareSecond.name}</strong><span>{compareSecond.xPts3} xPts · {price(compareSecond.price)}</span><em>Council {compareSecond.council.score}</em></div></div>}</section>
          <section><div className={styles.sectionHeading}><span>Notable omissions</span><h3>Why not them?</h3></div><div className={styles.omissionGrid}>{data.notableOmissions.map((omission) => <article key={omission.playerId}><div><span>{price(omission.price)} · {omission.xPts3} xPts</span><strong>{omission.playerName}</strong></div><b>{omission.councilScore}</b><p>{omission.whyExcluded}</p><small>{omission.whatWouldChange}</small></article>)}</div></section>
        </>}

        {tab === 'context' && <>
          <section className={styles.councilIntro}><div><span>Previous four Gameweeks</span><h2>What the scoreline did not say.</h2><p>Live match commentary is reduced to player-level role, threat, creativity, set-piece, defensive and availability signals. Repeat evidence can raise confidence slightly; it never creates xPts by itself.</p></div><div><strong>{commentaryInsights.filter((insight) => insight.status === 'corroborated').length}</strong><span>corroborated signals</span></div></section>
          <section className={styles.metricGrid}>
            <article><Activity /><span>Players flagged</span><strong>{commentaryInsights.length}</strong><small>whole player pool</small></article>
            <article><Check /><span>Corroborated</span><strong>{commentaryInsights.filter((insight) => insight.status === 'corroborated').length}</strong><small>repeat or structured support</small></article>
            <article><Search /><span>Watchlist only</span><strong>{commentaryInsights.filter((insight) => insight.status === 'watch').length}</strong><small>no model adjustment</small></article>
            <article><ShieldCheck /><span>Direct xPts weight</span><strong>0%</strong><small>context, not a shortcut</small></article>
          </section>
          <section className={styles.ownedGrid}>
            {commentaryInsights.slice(0, 36).map((insight) => {
              const player = playerById.get(insight.playerId);
              return <button className={styles.playerTile} disabled={!player} onClick={() => player && setSelectedPlayer(player)} key={insight.playerId}><div><span>{insight.team} · {titleCase(insight.status)}</span><strong>{insight.playerName}</strong></div><div className={styles.tileScore}>{insight.confidence}</div><p>{insight.headline}</p><em>{insight.observations} observations · GW{insight.sampleGameweeks.join(', ')}</em><small>{insight.signals.slice(0, 3).map((signal) => `${titleCase(signal.kind)} ${signal.observations}`).join(' · ')}</small></button>;
            })}
          </section>
          {!commentaryInsights.length && <section className={styles.panel}><div className={styles.panelHead}><div><span>Commentary enrichment</span><h3>No usable signals in the current stored snapshot</h3></div><AlertTriangle /></div><p>The core model remains available. Check the Data tab for the commentary source status, then run the local refresh to retry.</p></section>}
          <section className={styles.panel}><div className={styles.panelHead}><div><span>Guardrails</span><h3>How context reaches a decision</h3></div><ShieldCheck /></div><ul className={styles.notesList}><li>One match creates a watch flag only.</li><li>A repeated signal across two Gameweeks, three separate observations, an official set-piece order or confirmed-lineup positioning is required for corroboration.</li><li>Corroborated context can add at most two projection-confidence points; role agreement can add five role-confidence points.</li><li>Raw commentary is not retained in model snapshots, and no commentary label directly increases projected points.</li></ul></section>
        </>}

        {tab === 'data' && <>
          <section className={styles.dataIntro}><div><span>Pipeline health</span><h2>Show the seams.</h2><p>Current facts, degraded enrichments and model limitations are visible here instead of being hidden behind a single confidence number.</p></div><Database /></section>
          <section className={styles.sourceList}><article><StatusDot status={data.automation.freshness === 'fresh' ? 'healthy' : 'degraded'} /><div><strong>Automated decision snapshot</strong><p>Precomputed by the Phase 6 pipeline; private dashboard reads do not rerun the full model.</p></div><span>{data.automation.ageMinutes} min old</span><b>{data.automation.freshness}</b></article>{data.sourceHealth.map((source) => <article key={source.key}><StatusDot status={source.status} /><div><strong>{titleCase(source.key)}</strong><p>{source.message}{source.key === 'forward_minutes_fpl_cat' && <> <a href="https://fplcat.com/developers" target="_blank" rel="noreferrer">Source methodology</a></>}{source.key === 'predicted_lineups_shadow' && <> <a href="https://touchlinewire.com/docs" target="_blank" rel="noreferrer">Shadow source</a></>}</p></div><span>{source.records.toLocaleString()} records</span><b>{source.status}</b></article>)}</section>
          <section className={styles.calibrationPanel}>
            <div className={styles.calibrationHead}><div><span>Projection calibration</span><h3>{data.calibration.status === 'measured' ? `${data.calibration.evaluatedGameweeks.length} Gameweek${data.calibration.evaluatedGameweeks.length === 1 ? '' : 's'} measured · ${data.calibration.effectiveGameweeks.toFixed(1)} effective` : 'Collecting the first clean sample'}</h3><p>{data.calibration.status === 'measured' ? `Errors use frozen pre-deadline forecasts. Historical backtests count at ${Math.round(data.calibration.historicalWeight * 100)}%; new forward samples count at 100%.` : `GW${data.calibration.pendingGameweeks.join(', GW') || data.nextGameweek} is stored, but no accuracy claim is made until the Gameweek finishes.`}</p></div><Activity /></div>
            <div className={styles.calibrationMetrics}>
              <div><span>XI points MAE</span><strong>{data.calibration.aggregate ? data.calibration.aggregate.selectedXiMeanAbsoluteError.toFixed(2) : '—'}</strong><small>points per player</small></div>
              <div><span>Minutes MAE</span><strong>{data.calibration.aggregate ? data.calibration.aggregate.minutesMeanAbsoluteError.toFixed(1) : '—'}</strong><small>minutes per player</small></div>
              <div><span>Model bias</span><strong>{data.calibration.aggregate ? signed(data.calibration.aggregate.selectedXiBias) : '—'}</strong><small>positive = overprojection</small></div>
              <div><span>XI total</span><strong>{data.calibration.aggregate ? `${data.calibration.aggregate.projectedWithCaptain} / ${data.calibration.aggregate.actualWithCaptain}` : '—'}</strong><small>projected / actual</small></div>
              <div><span>Price calls</span><strong>{data.calibration.priceModel.precision != null ? `${data.calibration.priceModel.precision.toFixed(1)}%` : '—'}</strong><small>{data.calibration.priceModel.status} · ±{data.calibration.priceModel.riseThreshold} threshold</small></div>
              <div><span>Predicted XI</span><strong>{data.calibration.aggregate?.shadowLineupAccuracy != null ? `${data.calibration.aggregate.shadowLineupAccuracy.toFixed(1)}%` : '—'}</strong><small>60+ minute proxy</small></div>
              <div><span>Chip calls</span><strong>{data.calibration.chipModel?.meanAbsoluteError != null ? data.calibration.chipModel.meanAbsoluteError.toFixed(2) : '—'}</strong><small>{data.calibration.chipModel?.evaluatedCalls ?? 0} evaluated · forward-only MAE</small></div>
            </div>
            <div className={styles.calibrationFoot}><span>{data.calibration.trackedGameweeks} forecast{data.calibration.trackedGameweeks === 1 ? '' : 's'} tracked</span><span>{data.calibration.historicalEvaluatedGameweeks.length} historical · {data.calibration.forwardEvaluatedGameweeks.length} forward</span><span>{data.calibration.priceSnapshots} price snapshot{data.calibration.priceSnapshots === 1 ? '' : 's'}</span><span>{data.calibration.backend} storage</span>{data.calibration.latestEvaluation && <span>Latest · GW{data.calibration.latestEvaluation.gameweek}</span>}</div>
          </section>
          {data.calibration.latestReport && <section className={styles.panel}><div className={styles.panelHead}><div><span>Automatic post-Gameweek report</span><h3>{data.calibration.latestReport.headline}</h3></div><BarChart3 /></div><p>{data.calibration.latestReport.diagnosis}</p><ul className={styles.notesList}>{data.calibration.latestReport.lessons.map((lesson) => <li key={lesson}>{lesson}</li>)}</ul><div className={styles.calibrationFoot}>{data.calibration.latestReport.biggestMisses.map((miss) => <span key={miss.playerId}>{miss.playerName} · {signed(miss.pointError)} error</span>)}</div></section>}
          <section className={styles.panel}><div className={styles.panelHead}><div><span>Segmented calibration</span><h3>Where the model is weakest</h3></div><Target /></div><div className={styles.calibrationFoot}>{data.calibration.segments.slice(0, 8).map((segment) => <span key={`${segment.dimension}-${segment.value}`}>{titleCase(segment.dimension)} · {titleCase(segment.value)} · {segment.meanAbsoluteError.toFixed(2)} MAE</span>)}</div><p className={styles.caveat}>Injury adjustment value: {data.calibration.injuryImpact ? signed(data.calibration.injuryImpact.netValue) : 'collecting'} · Challenger: {titleCase(data.calibration.challenger.status)}</p></section>
          <section className={styles.dataColumns}><article className={styles.panel}><div className={styles.panelHead}><div><span>Automation</span><h3>{titleCase(data.automation.freshness)} snapshot</h3></div><RefreshCw /></div><dl className={styles.detailList}><div><dt>Last refresh</dt><dd>{new Date(data.automation.refreshedAt).toLocaleString('en-IE', { dateStyle: 'medium', timeStyle: 'short' })}</dd></div><div><dt>Trigger</dt><dd>{titleCase(data.automation.trigger)}</dd></div><div><dt>Backend</dt><dd>{titleCase(data.automation.backend)}</dd></div><div><dt>Immutable history</dt><dd>{data.automation.immutableSnapshots} snapshots</dd></div><div><dt>Pipeline duration</dt><dd>{(data.automation.durationMs / 1000).toFixed(1)}s</dd></div><div><dt>Deadline mode</dt><dd>{data.operations.deadlineMode ? 'Active' : 'Standby'}</dd></div><div><dt>Hours to deadline</dt><dd>{data.operations.hoursToDeadline == null ? 'Unknown' : data.operations.hoursToDeadline.toFixed(1)}</dd></div><div><dt>Checksum</dt><dd>{data.automation.checksum}</dd></div></dl></article><article className={styles.panel}><div className={styles.panelHead}><div><span>Model learning</span><h3>{data.learning.active ? 'Calibrated corrections active' : 'Promotion gate locked'}</h3></div><Activity /></div><dl className={styles.detailList}><div><dt>Effective evidence</dt><dd>{data.learning.effectiveGameweeks.toFixed(1)}/{data.learning.minimumGameweeks}</dd></div><div><dt>Evaluations</dt><dd>{data.learning.forwardGameweeks} forward · {data.learning.historicalGameweeks} replay/historical</dd></div><div><dt>Challenger</dt><dd>{titleCase(data.calibration.challenger.status)} · forward only</dd></div><div><dt>Points correction</dt><dd>{signed(-data.learning.pointsBiasCorrection)}</dd></div><div><dt>Minutes correction</dt><dd>{signed(-data.learning.minutesBiasCorrection)}</dd></div><div><dt>Predicted XI</dt><dd>{titleCase(data.learning.shadowLineupPromotion)} · forward only</dd></div><div><dt>Price model</dt><dd>{titleCase(data.learning.priceModelStatus)}</dd></div><div><dt>Projection version</dt><dd>{data.modelVersions.projection}</dd></div></dl><p className={styles.caveat}>{data.learning.reason}</p></article><article className={styles.panel}><div className={styles.panelHead}><div><span>Ledger</span><h3>{data.ledger.teamName}</h3></div><Database /></div><dl className={styles.detailList}><div><dt>Manager</dt><dd>{data.ledger.managerName}</dd></div><div><dt>Confirmed next GW</dt><dd>{data.ledger.nextGameweek}</dd></div><div><dt>Official next GW</dt><dd>{data.nextGameweek}</dd></div><div><dt>Bank</dt><dd>{price(data.ledger.bank)}</dd></div><div><dt>Free transfers</dt><dd>{data.ledger.freeTransfers}</dd></div></dl></article><article className={styles.panel}><div className={styles.panelHead}><div><span>Operational alerts</span><h3>{data.operations.alerts.length ? `${data.operations.alerts.length} item${data.operations.alerts.length === 1 ? '' : 's'} need context` : 'All clear'}</h3></div><ShieldCheck /></div><ul className={styles.notesList}>{data.operations.alerts.length ? data.operations.alerts.map((alert) => <li key={alert.key}><b>{alert.severity}</b> · {alert.message}</li>) : <li>No failed sources, stale ledger or deadline warnings.</li>}</ul></article><article className={styles.panel}><div className={styles.panelHead}><div><span>Model notes</span><h3>Known boundaries</h3></div><AlertTriangle /></div><ul className={styles.notesList}>{data.modelNotes.map((note) => <li key={note}>{note}</li>)}</ul></article></section>
        </>}

        <footer className={styles.footer}><span>FPL DECISION ENGINE / PHASE 6 · {data.modelVersions.revision}</span><span>Daily + deadline mode · facts ≠ estimates ≠ decisions</span></footer>
      </div>
      {selectedPlayer && <PlayerDrawer player={selectedPlayer} onClose={() => setSelectedPlayer(null)} />}
    </main>
  );
}
