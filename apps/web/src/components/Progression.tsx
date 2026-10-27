import { useQuery } from '@tanstack/react-query';
import { Crown } from 'lucide-react';
import { localData } from '../services/api';
import {
  recordSpecs,
  type PlayerProgression,
  type RecordHolding,
} from '../../../../packages/domain/src/index.js';
import { games, type GameMode } from '../services/rules';

/** Levels and records of every player on this device (standalone only). */
export function useProgression() {
  return useQuery({
    queryKey: ['progression'],
    queryFn: () => localData!.progression(),
    enabled: !!localData,
  });
}

/** A name with the effect earned by level or record. */
export function FxName({ name, p }: { name: string; p?: PlayerProgression }) {
  const effect = p?.cosmetics.nameEffect ?? 'none';
  return (
    <span className={`fx-name fx-${effect}`} data-text={name}>
      {name}
    </span>
  );
}

/** Compact level pill, with the record crown when the player holds one. */
export function LevelChip({ p }: { p?: PlayerProgression }) {
  if (!p) return null;
  const level = p.progress.level;
  return (
    <span
      className={`level-chip tier-${tier(level.level)}`}
      title={`${level.title} · ${p.xp.toLocaleString('it-IT')} XP`}
    >
      {p.records.length > 0 && <Crown aria-label="Detentore di record" />}
      Lv {level.level}
    </span>
  );
}
const tier = (level: number) =>
  level >= 12 ? 4 : level >= 10 ? 3 : level >= 7 ? 2 : level >= 4 ? 1 : 0;

/** What a record value means, with its unit. */
export function recordValue(r: Pick<RecordHolding, 'value' | 'spec'>) {
  return r.spec.direction === 'min' && r.spec.metric === 'round per chiudere'
    ? `${r.value} round`
    : r.spec.metric === 'distanza dall’obiettivo'
      ? r.value === 0
        ? 'centrato'
        : `a ${r.value} dall’obiettivo`
      : `${r.value} punti`;
}

/** Level, progress towards the next one, badges and records: the head of a player's profile. */
export function ProgressPanel({ p }: { p: PlayerProgression }) {
  const { level, next, into, span, ratio } = p.progress;
  const b = p.breakdown;
  const bests = (Object.entries(p.bests) as [GameMode, { value: number }][]).filter(
    ([game]) => recordSpecs[game],
  );
  return (
    <section className={`progress-panel tier-${tier(level.level)}`} aria-label="Livello">
      <div className="progress-head">
        <span className="level-medal" aria-hidden="true">
          <b>{level.level}</b>
        </span>
        <span>
          <strong>{level.title}</strong>
          <small>
            {p.xp.toLocaleString('it-IT')} XP
            {next
              ? ` · ${(span - into).toLocaleString('it-IT')} al livello ${next.level} (${next.title})`
              : ' · livello massimo'}
          </small>
        </span>
      </div>
      <div
        className="xp-bar"
        role="progressbar"
        aria-label="Avanzamento verso il prossimo livello"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(ratio * 100)}
      >
        <span style={{ width: `${Math.max(2, ratio * 100)}%` }} />
      </div>
      {p.records.length > 0 && (
        <ul className="badge-list" aria-label="Record detenuti">
          {p.records.map((r) => (
            <li key={r.game} className="record-badge">
              <Crown aria-hidden="true" />
              <span>
                <strong>{r.spec.title}</strong>
                <small>{recordValue(r)}</small>
              </span>
            </li>
          ))}
        </ul>
      )}
      <dl className="xp-breakdown" aria-label="Da dove arrivano gli XP">
        <div>
          <dt>XP partite</dt>
          <dd>{b.participation + b.wins}</dd>
        </div>
        <div>
          <dt>XP tornei</dt>
          <dd>{b.tournaments}</dd>
        </div>
        <div>
          <dt>XP record pers.</dt>
          <dd>{b.personalBest}</dd>
        </div>
        {b.elsewhere > 0 && (
          <div>
            <dt>XP altri telefoni</dt>
            <dd>{b.elsewhere}</dd>
          </div>
        )}
      </dl>
      {bests.length > 0 && (
        <p className="hint">
          Migliori personali:{' '}
          {bests
            .map(
              ([game, best]) =>
                `${games[game].label} ${recordValue({ value: best.value, spec: recordSpecs[game]! })}`,
            )
            .join(' · ')}
        </p>
      )}
    </section>
  );
}
