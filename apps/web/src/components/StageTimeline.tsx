import type { Tournament } from '../services/api';

type StepState = 'pending' | 'active' | 'done' | 'locked';
export type Step = { title: string; sub: string; state: StepState };

const tag: Record<StepState, string> = {
  pending: 'NON INIZIATA',
  active: 'ATTIVA',
  done: 'COMPLETATA',
  locked: 'BLOCCATA',
};

export function plannedSteps(
  mode: 'QUICK_HIGH_SCORE' | 'GROUPS',
  turns: number,
  qualifiers: number,
  groups: number,
  perGroup: number,
): Step[] {
  return mode === 'QUICK_HIGH_SCORE'
    ? [
        {
          title: 'Qualifica',
          sub: `${turns} ${turns === 1 ? 'turno' : 'turni'} · tutti i giocatori`,
          state: 'pending',
        },
        { title: 'Classifica', sub: `Top ${qualifiers} per punteggio totale`, state: 'pending' },
        { title: 'Finale', sub: 'Finale unica tra i qualificati', state: 'pending' },
      ]
    : [
        { title: 'Gironi', sub: `${groups} gironi · Hi-Score`, state: 'pending' },
        { title: 'Qualificati', sub: `${perGroup} per girone`, state: 'pending' },
        { title: 'Finale', sub: 'Eliminazione diretta', state: 'pending' },
      ];
}

export function tournamentSteps(t: Tournament): Step[] {
  const c = t.tournamentConfiguration;
  const steps = plannedSteps(
    t.mode === 'GROUPS' ? 'GROUPS' : 'QUICK_HIGH_SCORE',
    t.scoringConfiguration.turns,
    c.qualifiers,
    c.groupCount,
    c.qualifiersPerGroup,
  );
  if (['draft', 'registration', 'ready'].includes(t.status)) return steps;
  const stages = t.stages.filter((s) => s.status !== 'invalidated').reverse();
  const first = stages.find((s) => s.kind === 'qualification' || s.kind === 'group');
  const middle = stages.find((s) => s.kind === 'semifinal' || s.kind.startsWith('elimination_'));
  const final = stages.find((s) => s.kind === 'final');
  const state = (stage: typeof first): StepState =>
    !stage ? 'locked' : stage.status === 'open' ? 'active' : 'done';
  const finished = t.status === 'completed';
  steps[0]!.state = state(first);
  steps[1]!.state =
    t.mode === 'GROUPS'
      ? middle
        ? state(middle)
        : first?.status === 'finalized'
          ? final
            ? 'done'
            : 'active'
          : 'locked'
      : first?.status === 'finalized'
        ? 'done'
        : 'locked';
  steps[2]!.state = finished ? 'done' : state(final);
  return steps;
}

export function StageTimeline({ steps, title = 'Stato' }: { steps: Step[]; title?: string }) {
  return (
    <section className="timeline-section" aria-label={title}>
      <h2>{title}</h2>
      <ol className="timeline">
        {steps.map((s, i) => (
          <li key={s.title} className={`step-${s.state}`}>
            <span className="timeline-dot">{i + 1}</span>
            <span className="timeline-text">
              <strong>{s.title}</strong>
              <span>{s.sub}</span>
            </span>
            <span className="timeline-tag">{tag[s.state]}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
