import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { CrownIcon, TrophyEmblem } from '../components/BrandIcons';
import {
  Avatar,
  Empty,
  ErrorMessage,
  Header,
  Loading,
  Modal,
  PauseButton,
  StatusChip,
  Tabs,
  useTab,
  type Tone,
} from '../components/ui';
import type { Tournament } from '../services/api';
import {
  BackupLink,
  BoardCard,
  DraftPanel,
  Podium,
  ResultsTable,
  TieAlert,
  TieSheet,
  blockingTies,
  entryName,
  isDraft,
  liveStages,
  names,
  playable,
  useTournament,
  type Row,
  type Table,
  type TMatch,
} from './Tournaments';

/** Per-turn values from the cumulative progression of a standing. */
const perTurn = (row: Row) => row.progression.map((v, i) => v - (row.progression[i - 1] ?? 0));

function QualificationRanking({
  t,
  table,
  cut,
  turns,
}: {
  t: Tournament;
  table: Table;
  cut: number;
  turns: number;
}) {
  const max = t.scoringConfiguration.maxTurnScore;
  // The cut line goes under the last qualifying place (after a whole tied group).
  const lineAfter = table.rows.reduce((last, r, i) => (r.placement <= cut ? i : last), -1);
  return (
    <ol className="hs-ranking" aria-label="Classifica di qualifica">
      {table.rows.map((r, i) => {
        const bars = perTurn(r);
        const top = r.placement <= cut && !r.tied;
        return (
          <li key={r.tournamentEntryId}>
            <div className={`hs-row ${r.tied ? 'tie' : top ? 'top' : ''}`}>
              <span className={`rank-badge ${r.tied ? 'tie' : `rank-${r.placement}`}`}>
                {r.placement}
              </span>
              <Avatar name={entryName(t, r.tournamentEntryId)} />
              <span className="hs-name">
                <span>
                  {entryName(t, r.tournamentEntryId)}
                  {r.placement === 1 && !r.tied && (
                    <CrownIcon role="img" aria-label="Primo" aria-hidden={undefined} />
                  )}
                  {r.tied && <b className="tie-tag">PARI</b>}
                </span>
                <small>
                  {r.turns}/{turns} turni · best {r.bestTurn}
                  {i > 0 && r.gapToLeader > 0 ? ` · −${r.gapToLeader}` : ''}
                </small>
              </span>
              <span className="bars" aria-label={`Progressione ${bars.join(', ') || 'nessun turno'}`}>
                {Array.from({ length: Math.min(turns, 6) }, (_, k) => {
                  const v = bars[k];
                  return (
                    <span
                      key={k}
                      className={v === undefined ? 'empty' : k === bars.length - 1 ? 'last' : ''}
                      style={{ height: v === undefined ? 3 : Math.max(3, Math.round((v / max) * 22)) }}
                    />
                  );
                })}
              </span>
              <strong>{r.total}</strong>
            </div>
            {i === lineAfter && i < table.rows.length - 1 && (
              <div className="cut-line" aria-hidden="true">
                <span />
                LINEA FINALE · TOP {cut}
                <span />
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function TiebreakCard({ t, match }: { t: Tournament; match: TMatch }) {
  const turns = match.scoringConfiguration.turns;
  return (
    <article className="tiebreak-card">
      <div>
        <h3>
          Spareggio · {turns} {turns === 1 ? 'turno' : 'turni'}
        </h3>
        <span className="tag">{match.status === 'active' ? 'IN CORSO' : 'PRONTO'}</span>
      </div>
      <p>
        {match.participants.map((p, i) => (
          <span key={p.tournamentEntryId}>
            {i > 0 && <span className="marker"> vs </span>}
            {entryName(t, p.tournamentEntryId)}
          </span>
        ))}
      </p>
      <Link className="primary button" to={`/partite/${match.id}`}>
        Gioca lo spareggio
      </Link>
    </article>
  );
}

export function HiScoreDetail() {
  const { id = '' } = useParams();
  const { query, mutation, tables, command, error, retry } = useTournament(id);
  const [tab, setTab] = useTab('qualification');
  const [tie, setTie] = useState<{ table: Table; group: Row[]; title: string } | null>(null);
  const [early, setEarly] = useState(false);
  const [earlyReason, setEarlyReason] = useState('');
  if (query.isPending) return <Loading />;
  const t = query.data;
  if (!t)
    return (
      <>
        <Header title="Hi-Score Nights" back="/hiscore" />
        <main className="content">
          <ErrorMessage error={query.error} retry={retry} />
        </main>
      </>
    );
  const cut = t.tournamentConfiguration.qualifiers;
  const turns = t.scoringConfiguration.turns;
  const stages = liveStages(t);
  const qual = stages.find((s) => s.kind === 'qualification');
  const finalStage = stages.find((s) => s.kind === 'final');
  const inStage = (stageId?: string, type?: string) =>
    t.matches.filter(
      (m) => m.stageId === stageId && m.status !== 'cancelled' && (!type || m.matchType === type),
    );
  const qualMatch = inStage(qual?.id, 'qualification')[0];
  const finalMatch = inStage(finalStage?.id, 'final')[0];
  const qualTable = tables.find((r) => r.targetId === qualMatch?.id);
  const finalTable = tables.find((r) => r.targetId === finalMatch?.id);
  const qualTiebreak = inStage(qual?.id, 'tiebreak').find(playable);
  const finalTiebreak = inStage(finalStage?.id, 'tiebreak').find(playable);
  const active = t.status === 'active';
  const paused = t.status === 'paused';
  const qualTie =
    qual?.status === 'open' && qualMatch?.status === 'completed' && qualTable && !qualTiebreak
      ? blockingTies(qualTable.rows, cut)[0]
      : undefined;
  const finalTie =
    finalMatch?.status === 'completed' && active && finalTable && !finalTiebreak
      ? blockingTies(finalTable.rows, 1)[0]
      : undefined;
  const completedTurns = (m: TMatch, entry: string) =>
    m.turns.filter((x) => x.participantId === entry && x.status === 'completed').length;
  const players = qualMatch?.participants ?? [];
  const done = qualMatch
    ? players.filter((p) => completedTurns(qualMatch, p.tournamentEntryId) >= turns).length
    : 0;
  const incomplete = qualMatch
    ? players.filter((p) => completedTurns(qualMatch, p.tournamentEntryId) < turns)
    : [];
  const canFinalize =
    active &&
    qual?.status === 'open' &&
    qualMatch?.status === 'completed' &&
    !qualTie &&
    !qualTiebreak;
  const finalizeNote = isDraft(t)
    ? 'Avvia il torneo per iniziare la qualifica.'
    : qual?.status === 'finalized'
      ? 'Qualifica confermata.'
      : paused
        ? 'Torneo in pausa: riprendi per confermare.'
        : qualTie
          ? 'Bloccata finché la parità sulla soglia non è risolta.'
          : qualTiebreak
            ? 'Gioca lo spareggio prima della conferma.'
            : qualMatch?.status !== 'completed'
              ? `Mancano ${players.length - done} prove: tutti i turni devono essere completati.`
              : 'Pronta per la conferma.';
  const needsFinal = qual?.status === 'finalized' && !finalStage;
  const toConfirm = finalMatch?.status === 'completed' && active;
  const [statusText, tone]: [string, Tone] =
    t.status === 'completed'
      ? ['CONCLUSO', 'success']
      : paused
        ? ['IN PAUSA', 'warning']
        : qualTie || finalTie || qualTiebreak || finalTiebreak
          ? ['SPAREGGIO', 'warning']
          : toConfirm
            ? ['DA CONFERMARE', 'warning']
            : finalStage
              ? ['FINALE', 'live']
              : active
                ? ['IN CORSO', 'live']
                : ['ISCRIZIONI', 'neutral'];
  const seedOf = (entry: string) =>
    qualTable?.rows.find((r) => r.tournamentEntryId === entry)?.placement;
  const finalists = finalMatch
    ? [...finalMatch.participants]
        .sort((a, b) => a.playingOrder - b.playingOrder)
        .map((p) => p.tournamentEntryId)
    : (qualTable?.rows.filter((r) => qual?.qualifiedEntryIds.includes(r.tournamentEntryId)) ?? []).map(
        (r) => r.tournamentEntryId,
      );
  const finalScore = (entry: string) =>
    finalTable?.rows.find((r) => r.tournamentEntryId === entry)?.total;
  const leaderFinal = t.status === 'completed' || toConfirm ? finalTable?.rows[0] : undefined;
  const [finalTag, finalTone] = t.status === 'completed'
    ? ['CONFERMATA', 'success']
    : toConfirm
      ? ['GIOCATA', 'warning']
      : finalMatch?.status === 'active'
        ? ['IN CORSO', 'live']
        : finalMatch
          ? ['PRONTA', 'live']
          : ['DA GENERARE', 'live'];
  const finalTurns = (t.tournamentConfiguration.finalScoring ?? t.scoringConfiguration).turns;
  const sharedPlaces = new Set(t.results.map((r) => r.finalPlacement)).size < t.results.length;
  return (
    <>
      <Header
        title="Hi-Score Nights"
        back="/hiscore"
        action={
          <PauseButton
            paused={paused}
            disabled={(!active && !paused) || mutation.isPending}
            toggle={() => command(paused ? 'resume' : 'pause')}
          />
        }
      />
      <main className="content tournament-page">
        <Tabs
          label="Fasi"
          tabs={[
            { id: 'qualification', label: 'Qualifica', attention: !!qualTie },
            { id: 'final', label: 'Finale', attention: needsFinal || toConfirm || !!finalTie },
            { id: 'results', label: 'Risultati' },
          ]}
          value={tab}
          change={setTab}
        />
        <div className="event-heading">
          <TrophyEmblem />
          <div>
            <h2>{t.name}</h2>
            <p>
              {t.entries.length} giocatori · {turns} {turns === 1 ? 'turno' : 'turni'} · Top {cut}{' '}
              in finale
            </p>
          </div>
          <StatusChip tone={tone}>{statusText}</StatusChip>
        </div>
        <ErrorMessage error={error} retry={retry} />
        {tab === 'qualification' && (
          <>
            {isDraft(t) && <DraftPanel t={t} busy={mutation.isPending} command={command} />}
            {qualMatch && (
              <div className="progress-card">
                <div>
                  <h3>Qualifica</h3>
                  <span>
                    {done}/{players.length} prove complete
                  </span>
                </div>
                <div className="progress" aria-hidden="true">
                  <span style={{ width: `${players.length ? (done / players.length) * 100 : 0}%` }} />
                </div>
              </div>
            )}
            {qualMatch && playable(qualMatch) && (
              <BoardCard t={t} match={qualMatch} title="Qualifica" />
            )}
            {qualTie && qualTable && (
              <TieAlert
                action={{
                  label: 'ORGANIZZA SPAREGGIO',
                  disabled: !active || mutation.isPending,
                  run: () =>
                    setTie({ table: qualTable, group: qualTie, title: 'Spareggio · Qualifica' }),
                }}
              >
                <strong>Parità sulla soglia.</strong> {names(t, qualTie)}{' '}
                {qualTie.length === 2 ? 'hanno' : 'hanno tutti'} {qualTie[0]!.total} punti per il{' '}
                {qualTie[0]!.placement}° posto: decide uno spareggio sul bersaglio.
              </TieAlert>
            )}
            {qualTiebreak && <TiebreakCard t={t} match={qualTiebreak} />}
            {qualTable ? (
              <QualificationRanking t={t} table={qualTable} cut={cut} turns={turns} />
            ) : (
              !isDraft(t) && <Loading />
            )}
            {!isDraft(t) && (
              <div className="stage-actions">
                <button
                  className="primary"
                  disabled={!canFinalize || mutation.isPending}
                  onClick={() => command('qualification/finalize')}
                >
                  CONFERMA QUALIFICA
                </button>
                <p
                  role="status"
                  className={`stage-note ${canFinalize || qual?.status === 'finalized' ? 'ok' : ''}`}
                >
                  {finalizeNote}
                </p>
                {qualMatch?.status === 'active' && incomplete.length > 0 && active && (
                  <button onClick={() => setEarly(true)}>Chiudi qualifica in anticipo…</button>
                )}
              </div>
            )}
            {qual?.status === 'finalized' && (
              <button className="primary cta" onClick={() => setTab('final')}>
                VAI ALLA FINALE
              </button>
            )}
          </>
        )}
        {tab === 'final' &&
          (!finalStage && !needsFinal ? (
            <div className="empty locked">
              <Lock aria-hidden="true" />
              <h2>Finale non ancora disponibile</h2>
              <p>Si sblocca dopo la conferma della qualifica.</p>
            </div>
          ) : (
            <article className={`final-card ${finalMatch && playable(finalMatch) ? 'live' : ''}`}>
              <div className="final-head">
                <h2>Finale unica · Top {cut}</h2>
                <StatusChip tone={finalTone as Tone}>{finalTag}</StatusChip>
              </div>
              <p>
                Prova nuova da {finalTurns} {finalTurns === 1 ? 'turno' : 'turni'}: i punti della
                qualifica non si sommano.
              </p>
              <ol className="finalists">
                {finalists.map((entry, i) => {
                  const best = leaderFinal?.tournamentEntryId === entry && !leaderFinal.tied;
                  return (
                    <li key={entry} className={best ? 'best' : ''}>
                      <span>{i + 1}</span>
                      <Avatar name={entryName(t, entry)} />
                      <span>
                        {entryName(t, entry)} <small>· {seedOf(entry) ?? '—'}° in qualifica</small>
                      </span>
                      <strong>{finalMatch ? (finalScore(entry) ?? '—') : '—'}</strong>
                    </li>
                  );
                })}
              </ol>
              {finalTie && finalTable && (
                <TieAlert
                  action={{
                    label: 'ORGANIZZA SPAREGGIO',
                    disabled: mutation.isPending,
                    run: () =>
                      setTie({ table: finalTable, group: finalTie, title: 'Spareggio · Finale' }),
                  }}
                >
                  <strong>Parità decisiva.</strong> {names(t, finalTie)} hanno {finalTie[0]!.total}{' '}
                  punti per il 1° posto: decide uno spareggio sul bersaglio.
                </TieAlert>
              )}
              {finalTiebreak && <TiebreakCard t={t} match={finalTiebreak} />}
              {needsFinal && (
                <button
                  className="primary"
                  disabled={!active || mutation.isPending}
                  onClick={() => command('finals/generate')}
                >
                  GENERA FINALE
                </button>
              )}
              {finalMatch && playable(finalMatch) && (
                <Link className="primary button" to={`/partite/${finalMatch.id}`}>
                  GIOCA LA FINALE
                </Link>
              )}
              {toConfirm && (
                <button
                  className="primary"
                  disabled={!!finalTie || !!finalTiebreak || mutation.isPending}
                  onClick={() => command('complete')}
                >
                  CONFERMA RISULTATO FINALE
                </button>
              )}
            </article>
          ))}
        {tab === 'results' &&
          (t.results.length ? (
            <>
              <Podium t={t} />
              <ResultsTable t={t} />
              {sharedPlaces && (
                <p className="hint">
                  Gli esclusi dalla finale condividono lo stesso piazzamento: il backend non li ordina
                  tra loro.
                </p>
              )}
              <BackupLink />
            </>
          ) : (
            <Empty title="Nessun risultato ufficiale">
              <p>Compare dopo la conferma del risultato della finale.</p>
            </Empty>
          ))}
        {tie && (
          <TieSheet
            t={t}
            table={tie.table}
            group={tie.group}
            title={tie.title}
            busy={mutation.isPending}
            error={mutation.error}
            close={() => setTie(null)}
            create={(entryIds) => {
              command('tiebreaks', { targetId: tie.table.targetId, entryIds });
              setTie(null);
            }}
          />
        )}
        {early && qualMatch && (
          <Modal title="Chiudere la qualifica in anticipo?" close={() => setEarly(false)}>
            <p>
              Chi non ha completato i turni viene escluso e non classificato. I punteggi registrati
              restano nello storico.
            </p>
            <div className="info-box">
              <small>Verranno esclusi</small>
              <strong>
                {incomplete
                  .map(
                    (p) =>
                      `${entryName(t, p.tournamentEntryId)} (${completedTurns(qualMatch, p.tournamentEntryId)}/${turns} turni)`,
                  )
                  .join(' · ')}
              </strong>
            </div>
            <label className="field">
              Motivo (obbligatorio)
              <input
                value={earlyReason}
                placeholder="es. chiusura del locale"
                onChange={(e) => setEarlyReason(e.target.value)}
              />
            </label>
            <ErrorMessage error={mutation.error} />
            <button
              className="primary"
              disabled={!earlyReason.trim() || mutation.isPending}
              onClick={() => {
                command('qualification/close-early', {
                  excludedEntryIds: incomplete.map((p) => p.tournamentEntryId),
                  reason: earlyReason.trim(),
                });
                setEarly(false);
              }}
            >
              ESCLUDI E CHIUDI
            </button>
            <button onClick={() => setEarly(false)}>Annulla</button>
          </Modal>
        )}
      </main>
    </>
  );
}
