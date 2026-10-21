import { seededBracket } from '../../../../packages/domain/src/tournaments/schedule.js';
import type { Tournament } from '../services/api';

type StepState = 'active' | 'done' | 'locked';
export type Step = { title: string; sub: string; state: StepState };

const tag: Record<StepState, string> = {
  active: 'ATTIVA',
  done: 'CONFERMATA',
  locked: 'BLOCCATA',
};
const letter = (i: number) => String.fromCharCode(65 + i);

export const knockoutTitle = (kind: string) =>
  kind === 'final'
    ? 'Finale'
    : kind === 'semifinal'
      ? 'Semifinali'
      : kind === 'elimination_8'
        ? 'Quarti di finale'
        : kind === 'elimination_16'
          ? 'Ottavi di finale'
          : `Eliminazione · ${kind.slice(12)}`;

/** Seed labels in the domain's order: every group winner, then every runner-up, and so on. */
export function seedLabels(t: Tournament) {
  const c = t.tournamentConfiguration;
  return Array.from({ length: c.qualifiersPerGroup }, (_, k) =>
    Array.from({ length: c.groupCount }, (_, g) => `${k + 1}° ${letter(g)}`),
  ).flat();
}
/** First knockout round as the domain will pair it (byes shown as "bye"). */
export function plannedPairs(t: Tournament) {
  const seeds = seedLabels(t);
  return seeds.length >= 2 ? seededBracket(seeds) : [];
}

/** Group stage, every knockout round (planned until generated), final. */
export function groupSteps(t: Tournament): Step[] {
  const stages = t.stages.filter((s) => s.status !== 'invalidated');
  const group = stages.find((s) => s.kind === 'group');
  const groupMatches = t.matches.filter(
    (m) => m.stageId === group?.id && m.matchType !== 'tiebreak' && m.status !== 'cancelled',
  );
  const played = groupMatches.filter((m) => m.status === 'completed').length;
  const state = (s?: { status: string }): StepState =>
    !s ? 'locked' : s.status === 'open' ? 'active' : 'done';
  const steps: Step[] = [
    {
      title: 'Gironi',
      sub: group
        ? `${played}/${groupMatches.length} incontri ${group.status === 'finalized' ? 'confermati' : 'giocati'}`
        : `${t.tournamentConfiguration.groupCount} gironi · tutti contro tutti`,
      state: state(group),
    },
  ];
  const knockout = stages.filter((s) => !['group', 'qualification'].includes(s.kind));
  if (knockout.length) {
    for (const s of knockout)
      steps.push({
        title: knockoutTitle(s.kind),
        sub: `${t.matches.filter((m) => m.stageId === s.id && m.matchType !== 'tiebreak').length} incontri · eliminazione diretta`,
        state: t.status === 'completed' ? 'done' : state(s),
      });
  } else {
    // Planned rounds, from the number of qualifiers.
    const pairs = plannedPairs(t);
    for (let size = pairs.length * 2; size >= 2; size /= 2)
      steps.push({
        title: knockoutTitle(
          size === 2 ? 'final' : size === 4 ? 'semifinal' : `elimination_${size}`,
        ),
        sub:
          size === pairs.length * 2
            ? pairs.map((p) => p.map((x) => x ?? 'bye').join(' – ')).join(' · ')
            : 'Eliminazione diretta',
        state: 'locked',
      });
  }
  return steps;
}

export function StageTimeline({ steps }: { steps: Step[] }) {
  return (
    <ol
      className="tl"
      aria-label="Fasi del torneo"
      style={{ gridTemplateColumns: `repeat(${Math.min(steps.length, 4)}, minmax(0, 1fr))` }}
    >
      {steps.map((s, i) => (
        <li
          key={`${s.title}-${i}`}
          className={s.state === 'done' ? 'done' : s.state === 'active' ? 'on' : ''}
          aria-label={`${s.title}: ${tag[s.state].toLowerCase()} · ${s.sub}`}
        >
          <b>{s.title}</b>
          <small>{s.state === 'locked' ? 'in attesa' : s.sub}</small>
        </li>
      ))}
    </ol>
  );
}
