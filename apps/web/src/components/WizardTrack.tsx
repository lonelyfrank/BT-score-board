import { Check } from 'lucide-react';

export type TrackStep = { label: string; chip?: { key: string; value: string } };

/**
 * The steps of a wizard as numbered circles: the ones done are links back to correct them, and
 * under them the choices made so far, each one tappable too.
 */
export function WizardTrack({
  steps,
  step,
  go,
  saved = true,
}: {
  steps: TrackStep[];
  step: number;
  go: (step: number) => void;
  saved?: boolean;
}) {
  const chips = steps.slice(0, step - 1).filter((s) => s.chip);
  return (
    <div className="wz-track">
      <ol aria-label={`Passo ${step} di ${steps.length}`}>
        {steps.map((s, i) => {
          const n = i + 1;
          const done = n < step;
          const cur = n === step;
          return (
            <li key={s.label} className={done ? 'done' : cur ? 'on' : ''}>
              {done ? (
                <button
                  type="button"
                  aria-label={`Passo ${n}: ${s.label} (fatto, tocca per correggere)`}
                  onClick={() => go(n)}
                >
                  <Check aria-hidden="true" strokeWidth={3.2} />
                </button>
              ) : (
                <span
                  aria-current={cur ? 'step' : undefined}
                  aria-label={`Passo ${n}: ${s.label}${cur ? ' (attuale)' : ''}`}
                >
                  {n}
                </span>
              )}
            </li>
          );
        })}
      </ol>
      <div className="wz-track-now">
        <span>
          Passo {step} di {steps.length} · {steps[step - 1]?.label}
        </span>
        {saved && (
          <span className="saved">
            <Check aria-hidden="true" strokeWidth={2.6} />
            Bozza salvata
          </span>
        )}
      </div>
      {chips.length > 0 ? (
        <div className="wz-chips" aria-label="Scelte fatte: tocca per correggere">
          {steps.slice(0, step - 1).map((s, i) =>
            s.chip ? (
              <button
                type="button"
                key={s.label}
                aria-label={`${s.label}: ${s.chip.value}, tocca per correggere`}
                onClick={() => go(i + 1)}
              >
                <small>{s.chip.key}</small>
                {s.chip.value}
              </button>
            ) : null,
          )}
        </div>
      ) : (
        <p className="hint">Le tue scelte appariranno qui: toccale per correggerle.</p>
      )}
    </div>
  );
}
