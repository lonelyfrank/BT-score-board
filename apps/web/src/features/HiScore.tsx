import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ChevronDown, Lock, Pause, Play, SlidersHorizontal, UserMinus } from 'lucide-react';
import { CrownIcon } from '../components/BrandIcons';
import {
  Avatar,
  Empty,
  ErrorMessage,
  Header,
  Loading,
  ReadOnlyNote,
  Modal,
  StatusChip,
  Tabs,
  useAzione,
  useTab,
  type Tone,
} from '../components/ui';
import type { Tournament } from '../services/api';
import { isResultRecording } from '../services/rules';
import {
  ActionsMenu,
  NightExtras,
  BackupLink,
  BoardCard,
  DecisionSheet,
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

function QualificationRanking({
  t,
  table,
  cut,
  turns,
  heats = [],
}: {
  t: Tournament;
  table: Table;
  cut: number;
  turns: number;
  /** Physical heats of the qualification: shown, never used to rank. */
  heats?: TMatch['heats'];
}) {
  const results = isResultRecording(t);
  const heatOf = (entry: string) =>
    heats.length > 1
      ? heats.find((h) => h.status !== 'cancelled' && h.entryIds.includes(entry))?.number
      : undefined;
  // The cut line goes under the last qualifying place (after a whole tied group).
  const lineAfter = table.rows.reduce((last, r, i) => (r.placement <= cut ? i : last), -1);
  return (
    <ol className="list board" aria-label="Classifica di qualifica">
      {table.rows.map((r, i) => {
        // Everyone is level at 0 before playing: not a tie worth flagging.
        const tied = r.tied && (results ? r.recorded : r.turns > 0);
        const waiting = results && !r.recorded;
        return (
          <li key={r.tournamentEntryId}>
            <div className={`rk ${waiting ? 'wait' : ''}`}>
              <span
                className={`n ${tied ? 'tie' : !waiting && r.placement <= 4 ? `r${r.placement}` : ''}`}
              >
                {waiting ? '·' : r.placement}
              </span>
              <Avatar name={entryName(t, r.tournamentEntryId)} size="md" />
              <span className="nm">
                <b>
                  {entryName(t, r.tournamentEntryId)}
                  {r.placement === 1 && !r.tied && !waiting && (
                    <CrownIcon className="inline-crown" role="img" aria-label="Primo" />
                  )}
                  {tied && <span className="tag">PARI</span>}
                </b>
                <small>
                  {heatOf(r.tournamentEntryId) !== undefined &&
                    `M${heatOf(r.tournamentEntryId)} · `}
                  {results
                    ? r.recorded
                      ? 'punteggio registrato'
                      : 'in attesa del totem'
                    : `${r.turns}/${turns} turni · best ${r.bestTurn}`}
                  {i > 0 && r.gapToLeader > 0 && r.recorded ? ` · −${r.gapToLeader}` : ''}
                </small>
              </span>
              <strong>{waiting ? '–' : r.total}</strong>
            </div>
            {i === lineAfter && i < table.rows.length - 1 && (
              <div className="cut" aria-hidden="true">
                <i />
                FINALE · TOP {cut}
                <i />
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
    <article className="now board">
      <div className="board-head">
        <h3 className="field-l">
          {isResultRecording(t)
            ? 'Spareggio · nuova partita Hi-Score'
            : `Spareggio · ${turns} ${turns === 1 ? 'turno' : 'turni'}`}
        </h3>
        <StatusChip tone={match.status === 'active' ? 'live' : 'neutral'}>
          {match.status === 'active' ? 'IN CORSO' : 'PRONTO'}
        </StatusChip>
      </div>
      <p className="board-players">
        {match.participants.map((p) => entryName(t, p.tournamentEntryId)).join(' vs ')}
      </p>
      <Link className="btn cta" to={`/partite/${match.id}`}>
        Gioca lo spareggio
      </Link>
    </article>
  );
}

export function HiScoreDetail() {
  const { id = '' } = useParams();
  const { query, mutation, tables, command, error, retry, operate } = useTournament(id);
  const direct =
    !!query.data &&
    !query.data.stages.some((s) => s.kind === 'qualification') &&
    query.data.stages.length > 0;
  const [tab, setTab] = useTab(direct ? 'final' : 'qualification');
  const [tie, setTie] = useState<{ table: Table; group: Row[]; title: string } | null>(null);
  const [decision, setDecision] = useState<{ table: Table; group: Row[]; title: string } | null>(
    null,
  );
  const [early, setEarly] = useState(false);
  const [earlyReason, setEarlyReason] = useState('');
  const [leaving, setLeaving] = useState('');
  const [azione, consumeAzione] = useAzione();
  if (query.isPending) return <Loading />;
  const t = query.data;
  if (!t)
    return (
      <>
        <Header title="Hi-Score Nights" back="/hiscore" />
        <main>
          <ErrorMessage error={query.error} retry={retry} />
        </main>
      </>
    );
  const cut = t.tournamentConfiguration.qualifiers;
  const turns = t.scoringConfiguration.turns;
  const results = isResultRecording(t);
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
  // A player is done when the totem's total is recorded (or every turn, legacy entry).
  const finished = (m: TMatch, entry: string) =>
    results ? (m.result?.scores[entry] ?? null) !== null : completedTurns(m, entry) >= turns;
  const excluded = qual?.excludedEntryIds ?? [];
  const players = (qualMatch?.participants ?? []).filter(
    (p) => !excluded.includes(p.tournamentEntryId),
  );
  const done = qualMatch
    ? players.filter((p) => finished(qualMatch, p.tournamentEntryId)).length
    : 0;
  const incomplete = qualMatch
    ? players.filter((p) => !finished(qualMatch, p.tournamentEntryId))
    : [];
  const stillIn = t.entries.filter((e) => e.status === 'registered' || e.status === 'qualified');
  // Opened from the management page: the first player still in, or the early-close dialog.
  const leave = leaving || (azione === 'ritira' ? (stillIn[0]?.id ?? '') : '');
  const closeLeave = () => {
    setLeaving('');
    consumeAzione();
  };
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
              ? results
                ? `Mancano ${players.length - done} punteggi dal totem.`
                : `Mancano ${players.length - done} prove: tutti i turni devono essere completati.`
              : 'Pronta per la conferma.';
  const needsFinal = qual?.status === 'finalized' && !finalStage;
  const toConfirm = finalMatch?.status === 'completed' && active;
  const seedOf = (entry: string) =>
    qualTable?.rows.find((r) => r.tournamentEntryId === entry)?.placement;
  const finalists = finalMatch
    ? [...finalMatch.participants]
        .sort((a, b) => a.playingOrder - b.playingOrder)
        .map((p) => p.tournamentEntryId)
    : (
        qualTable?.rows.filter((r) => qual?.qualifiedEntryIds.includes(r.tournamentEntryId)) ?? []
      ).map((r) => r.tournamentEntryId);
  const finalScore = (entry: string) =>
    finalTable?.rows.find((r) => r.tournamentEntryId === entry)?.total;
  const leaderFinal = t.status === 'completed' || toConfirm ? finalTable?.rows[0] : undefined;
  const [finalTag, finalTone] =
    t.status === 'completed'
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
  const playedHeats = qualMatch?.heats.filter((h) => h.status === 'completed').length ?? 0;
  const allHeats = qualMatch?.heats.filter((h) => h.status !== 'cancelled').length ?? 0;
  const subtitle = isDraft(t)
    ? `Iscrizioni aperte · ${t.entries.length} giocatori`
    : qual?.status === 'finalized' || direct
      ? `${direct ? 'Finale diretta' : 'Qualifica chiusa'} · ${t.entries.length} giocatori`
      : allHeats > 1
        ? `Qualifica · ${playedHeats} manche su ${allHeats} giocate`
        : `Qualifica · ${t.entries.length} giocatori`;
  const finalAction =
    needsFinal && operate ? (
      <button
        type="button"
        className="btn cta"
        disabled={!active || mutation.isPending}
        onClick={() => command('finals/generate')}
      >
        GENERA FINALE
      </button>
    ) : finalMatch && playable(finalMatch) ? (
      <Link className="btn cta" to={`/partite/${finalMatch.id}`}>
        GIOCA LA FINALE
      </Link>
    ) : toConfirm && operate ? (
      <button
        type="button"
        className="btn cta"
        disabled={!!finalTie || !!finalTiebreak || mutation.isPending}
        onClick={() => command('complete')}
      >
        CONFERMA RISULTATO FINALE
      </button>
    ) : null;
  return (
    <>
      <Header
        title={t.name}
        subtitle={subtitle}
        back="/hiscore"
        backLabel="Indietro a Hi-Score Nights"
        action={
          <ActionsMenu
            actions={[
              {
                icon: <SlidersHorizontal aria-hidden="true" />,
                label: 'Gestione del torneo',
                hint: 'Ruoli, condivisione, luogo e serata',
                to: `/gestione/${t.id}`,
              },
              ...(operate && (active || paused)
                ? [
                    {
                      icon: paused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />,
                      label: paused ? 'Riprendi torneo' : 'Metti in pausa il torneo',
                      hint: paused
                        ? 'Si torna a registrare punteggi'
                        : 'Nessun punteggio finché non riprendi',
                      run: () => command(paused ? 'resume' : 'pause'),
                      disabled: mutation.isPending,
                    },
                  ]
                : []),
              ...(operate && results && active && stillIn.length > 1 && !isDraft(t)
                ? [
                    {
                      icon: <UserMinus aria-hidden="true" />,
                      label: 'Ritira un giocatore…',
                      hint: 'Esce dalla fase: i punteggi restano nello storico',
                      run: () => setLeaving(stillIn[0]!.id),
                    },
                  ]
                : []),
              ...(operate &&
              qualMatch?.status === 'active' &&
              incomplete.length > 0 &&
              active &&
              !results
                ? [
                    {
                      icon: <Lock aria-hidden="true" />,
                      label: 'Chiudi qualifica in anticipo…',
                      hint: 'Chi non ha completato i turni viene escluso',
                      run: () => setEarly(true),
                    },
                  ]
                : []),
            ]}
          />
        }
      />
      <div className="toolbar">
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
      </div>
      <main className="tournament">
        <ErrorMessage error={error} retry={retry} />
        {!operate && <ReadOnlyNote status={t.status} />}
        {tab === 'qualification' && (
          <>
            {isDraft(t) && operate && (
              <DraftPanel t={t} busy={mutation.isPending} command={command} />
            )}
            {isDraft(t) && t.entries.length > 1 && t.entries.length < cut && (
              <p className="hint">
                Con meno di {cut} iscritti non c’è qualifica: all’avvio tutti giocano direttamente
                la finale.
              </p>
            )}
            {direct && (
              <div className="empty">
                <p>
                  Nessuna qualifica: con {t.entries.length} iscritti (meno di {cut}) tutti giocano
                  direttamente la finale.
                </p>
                <button type="button" className="btn cta" onClick={() => setTab('final')}>
                  VAI ALLA FINALE
                </button>
              </div>
            )}
            {qualMatch && (
              <div className="card progress-card">
                <div className="sec-h">
                  <h3>Qualifica</h3>
                  <span>
                    {done}/{players.length} prove complete
                    {allHeats > 1 && ` · manche ${playedHeats}/${allHeats}`}
                  </span>
                </div>
                <span className="pips" aria-hidden="true">
                  {allHeats > 1 ? (
                    qualMatch.heats
                      .filter((h) => h.status !== 'cancelled')
                      .map((h) => (
                        <i
                          key={h.id}
                          className={
                            h.status === 'completed' ? 'done' : h.status === 'active' ? 'on' : ''
                          }
                        />
                      ))
                  ) : (
                    <i
                      className="done"
                      style={{
                        flex: 'none',
                        width: `${players.length ? (done / players.length) * 100 : 0}%`,
                      }}
                    />
                  )}
                </span>
              </div>
            )}
            {qualMatch && playable(qualMatch) && (
              <BoardCard t={t} match={qualMatch} title="Qualifica" />
            )}
            {operate && qualTie && qualTable && (
              <TieAlert
                action={{
                  label: 'Spareggio sul totem',
                  disabled: !active || mutation.isPending,
                  run: () =>
                    setTie({ table: qualTable, group: qualTie, title: 'Spareggio · Qualifica' }),
                }}
                secondary={{
                  label: 'Decido io',
                  disabled: !active || mutation.isPending,
                  run: () =>
                    setDecision({
                      table: qualTable,
                      group: qualTie,
                      title: 'Decisione · Qualifica',
                    }),
                }}
              >
                <strong>Parità sulla soglia.</strong> {names(t, qualTie)} a {qualTie[0]!.total} per
                il {qualTie[0]!.placement}° posto: decide uno spareggio sul totem o l’organizzatore.
              </TieAlert>
            )}
            {qualTiebreak && <TiebreakCard t={t} match={qualTiebreak} />}
            {qualTable ? (
              <QualificationRanking
                t={t}
                table={qualTable}
                cut={cut}
                turns={turns}
                heats={qualMatch?.heats}
              />
            ) : (
              !isDraft(t) && <Loading />
            )}
          </>
        )}
        {tab === 'final' &&
          (!finalStage && !needsFinal ? (
            <div className="empty">
              <Lock aria-hidden="true" />
              <h2>Finale non ancora disponibile</h2>
              <p>Si sblocca dopo la conferma della qualifica.</p>
            </div>
          ) : (
            <>
              {operate && finalTie && finalTable && (
                <TieAlert
                  action={{
                    label: 'Spareggio sul totem',
                    disabled: mutation.isPending,
                    run: () =>
                      setTie({ table: finalTable, group: finalTie, title: 'Spareggio · Finale' }),
                  }}
                  secondary={{
                    label: 'Decido io',
                    disabled: mutation.isPending,
                    run: () =>
                      setDecision({
                        table: finalTable,
                        group: finalTie,
                        title: 'Decisione · Finale',
                      }),
                  }}
                >
                  <strong>Parità decisiva.</strong> {names(t, finalTie)} hanno {finalTie[0]!.total}{' '}
                  punti per il 1° posto: decide uno spareggio sul totem o l’organizzatore.
                </TieAlert>
              )}
              <div className="sec-h">
                <h2>{direct ? 'Finale diretta' : 'Finalisti'}</h2>
                <StatusChip tone={finalTone as Tone}>{finalTag}</StatusChip>
              </div>
              <ol className="list" aria-label="Finalisti">
                {finalists.map((entry, i) => {
                  const best = leaderFinal?.tournamentEntryId === entry && !leaderFinal.tied;
                  const score = finalMatch ? finalScore(entry) : undefined;
                  return (
                    <li key={entry} className={`rk seeded ${best ? 'gold' : ''}`}>
                      <span className="seed">
                        {direct ? i + 1 : `SEED ${seedOf(entry) ?? i + 1}`}
                      </span>
                      <Avatar name={entryName(t, entry)} size="md" />
                      <span className="nm">
                        <b>{entryName(t, entry)}</b>
                        <small>
                          {score !== undefined && finalMatch?.status !== 'ready'
                            ? `finale ${score}`
                            : direct
                              ? 'in finale'
                              : `${seedOf(entry) ?? '—'}° in qualifica`}
                        </small>
                      </span>
                      <strong className="muted">
                        {qualTable?.rows.find((r) => r.tournamentEntryId === entry)?.total ?? ''}
                      </strong>
                    </li>
                  );
                })}
              </ol>
              {finalTiebreak && <TiebreakCard t={t} match={finalTiebreak} />}
              <p className="hint">
                {direct
                  ? 'Unica partita Hi-Score fra tutti gli iscritti.'
                  : results
                    ? `Finale nuova tra i ${cut}: i punti della qualifica non si sommano. La decisione dell’organizzatore resta nello storico.`
                    : `Prova nuova da ${finalTurns} ${finalTurns === 1 ? 'turno' : 'turni'}: i punti della qualifica non si sommano.`}
              </p>
            </>
          ))}
        {tab === 'results' &&
          (t.results.length ? (
            <>
              <Podium t={t} />
              <ResultsTable t={t} />
              <NightExtras t={t} />
              {sharedPlaces && (
                <p className="hint">
                  Gli esclusi dalla finale condividono lo stesso piazzamento: il backend non li
                  ordina tra loro.
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
        {decision && (
          <DecisionSheet
            t={t}
            targetId={decision.table.targetId}
            entries={decision.group.map((r) => r.tournamentEntryId)}
            title={decision.title}
            close={() => setDecision(null)}
            done={() => {
              setDecision(null);
              retry();
            }}
          />
        )}
        {leave && (
          <Modal
            title="Ritirare un giocatore?"
            close={closeLeave}
            footer={
              <>
                <button type="button" className="btn ghost" onClick={closeLeave}>
                  Annulla
                </button>
                <button
                  type="button"
                  className="btn cta"
                  disabled={!earlyReason.trim() || mutation.isPending}
                  onClick={() => {
                    command('entries/withdraw', { entryId: leave, reason: earlyReason.trim() });
                    closeLeave();
                    setEarlyReason('');
                  }}
                >
                  RITIRA GIOCATORE
                </button>
              </>
            }
          >
            <p>
              Il giocatore esce dal torneo: non si qualifica e non viene classificato in questa
              fase. I punteggi già registrati restano nello storico.
            </p>
            <label className="field">
              Giocatore
              <span className="select">
                <select value={leave} onChange={(e) => setLeaving(e.target.value)}>
                  {stillIn.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.displayNameAtRegistration}
                    </option>
                  ))}
                </select>
                <ChevronDown aria-hidden="true" />
              </span>
            </label>
            <label className="field">
              Motivo (obbligatorio)
              <input
                value={earlyReason}
                placeholder="es. ha lasciato il locale"
                onChange={(e) => setEarlyReason(e.target.value)}
              />
            </label>
            <ErrorMessage error={mutation.error} />
          </Modal>
        )}
        {(early || azione === 'chiudi') && qualMatch && (
          <Modal
            title="Chiudere la qualifica in anticipo?"
            close={() => {
              setEarly(false);
              consumeAzione();
            }}
            footer={
              <>
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => {
                    setEarly(false);
                    consumeAzione();
                  }}
                >
                  Annulla
                </button>
                <button
                  type="button"
                  className="btn cta"
                  disabled={!earlyReason.trim() || mutation.isPending}
                  onClick={() => {
                    command('qualification/close-early', {
                      excludedEntryIds: incomplete.map((p) => p.tournamentEntryId),
                      reason: earlyReason.trim(),
                    });
                    setEarly(false);
                    consumeAzione();
                  }}
                >
                  ESCLUDI E CHIUDI
                </button>
              </>
            }
          >
            <p>
              Chi non ha completato i turni viene escluso e non classificato. I punteggi registrati
              restano nello storico.
            </p>
            <div className="card pad">
              <span className="field-l">Verranno esclusi</span>
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
          </Modal>
        )}
      </main>
      {tab === 'qualification' &&
        !isDraft(t) &&
        !direct &&
        (operate || qual?.status === 'finalized') && (
          <div className="actionbar">
            {qual?.status === 'finalized' ? (
              <button type="button" className="btn cta" onClick={() => setTab('final')}>
                VAI ALLA FINALE
              </button>
            ) : (
              <button
                type="button"
                className="btn cta"
                disabled={!canFinalize || mutation.isPending}
                onClick={() => command('qualification/finalize')}
              >
                CONFERMA QUALIFICA
              </button>
            )}
            <p
              role="status"
              className={`form-reason ${canFinalize || qual?.status === 'finalized' ? 'ok' : 'muted'}`}
            >
              {finalizeNote}
            </p>
          </div>
        )}
      {tab === 'final' && finalAction && <div className="actionbar">{finalAction}</div>}
    </>
  );
}
