import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { Trophy, ChartNoAxesColumnIncreasing } from 'lucide-react';
import { api, ApiError, type Player, type Tournament } from '../services/api';
import { Header, Stepper, ErrorMessage, Tabs, Modal } from '../components/ui';
import { DartIcon, TrophyEmblem } from '../components/BrandIcons';
import { StageTimeline, plannedSteps } from '../components/StageTimeline';
import { PlayerPicker } from './Players';

const catalog = [
  ['301', 'Classic'],
  ['501', 'Classic'],
  ['701', 'Classic'],
  ['301', 'Master'],
  ['501', 'Master'],
  ['1001', 'Master'],
  ['Cricket', ''],
  ['Around the Clock', ''],
  ['Shanghai', ''],
  ['Double In', 'Double Out'],
  ['Hi-Score', ''],
  ['Exacta', ''],
];
export function Setup({ tournament = false }: { tournament?: boolean }) {
  const [selected, setSelected] = useState<Player[]>([]);
  const [turns, setTurns] = useState(tournament ? 8 : 3);
  const [mode, setMode] = useState<'QUICK_HIGH_SCORE' | 'GROUPS'>('QUICK_HIGH_SCORE');
  const [name, setName] = useState(tournament ? 'BiteTrouble Open' : 'Partita libera');
  const [qualifiers, setQualifiers] = useState(4);
  const [groups, setGroups] = useState(2);
  const [perGroup, setPerGroup] = useState(2);
  const [category, setCategory] = useState('01');
  const [confirm, setConfirm] = useState(false);
  const [draft, setDraft] = useState<Tournament>();
  const navigate = useNavigate();
  const reason = !name.trim()
    ? 'Inserisci il nome del torneo.'
    : selected.length < 2
      ? 'Seleziona almeno 2 giocatori.'
      : tournament && mode === 'QUICK_HIGH_SCORE' && qualifiers > selected.length
        ? 'I finalisti non possono superare gli iscritti.'
        : mode === 'GROUPS' &&
            (selected.length < groups * Math.max(2, perGroup) || groups * perGroup < 2)
          ? 'Ogni girone deve avere almeno 2 giocatori e abbastanza iscritti per i qualificati.'
          : '';
  const create = useMutation({
    mutationFn: async () => {
      let t = draft
        ? await api.tournament(draft.id)
        : await api.createTournament({
            name: name.trim(),
            mode,
            scoringConfiguration: { kind: 'HIGH_SCORE', turns, dartsPerTurn: 3, maxDartScore: 60 },
            tournamentConfiguration: {
              qualifiers: tournament ? qualifiers : selected.length,
              groupCount: groups,
              qualifiersPerGroup: perGroup,
              tiePolicy: 'PLAYOFF',
              playingOrder: 'registration',
            },
          });
      setDraft(t);
      for (const [index, player] of selected.entries()) {
        if (!t.entries.some((e) => e.playerId === player.id))
          t = await api.tournamentCommand(t, 'players', { playerId: player.id, seed: index + 1 });
      }
      if (['draft', 'registration', 'ready'].includes(t.status))
        t = await api.tournamentCommand(t, 'start');
      if (!tournament) {
        const match = await api.match(t.matches[0]!.id);
        if (match.status === 'ready') await api.matchCommand(match, 'start');
        navigate(`/partite/${match.id}`);
      } else navigate(mode === 'QUICK_HIGH_SCORE' ? `/hiscore/${t.id}` : `/tornei/${t.id}`);
    },
    onSettled: () => setConfirm(false),
  });
  const subtitles: Record<string, string> = { 'Around the Clock': 'the Clock' };
  return (
    <>
      <Header
        title={tournament ? 'Nuovo torneo' : 'Nuova partita'}
        decor={tournament ? <Trophy strokeWidth={1.8} /> : undefined}
      />
      <main className={`content setup-page ${tournament ? 'with-graffiti' : ''}`}>
        {!tournament && (
          <>
            <Tabs
              tabs={['01', '02', 'Speciali', 'Classiche'].map((id) => ({ id, label: id }))}
              value={category}
              change={setCategory}
            />
            {category === '02' ? (
              <div className="empty">
                <h2>Catalogo “02” non ancora disponibile</h2>
                <p>Le modalità di questa categoria arriveranno dal catalogo del backend.</p>
              </div>
            ) : (
              <div className="mode-grid" role="radiogroup" aria-label="Modalità di gioco">
                {catalog
                  .filter(
                    ([title]) =>
                      category === '01' ||
                      (category === 'Speciali' ? !/^\d/.test(title!) : /^\d/.test(title!)),
                  )
                  .map(([title, subtitle]) => {
                    const available = title === 'Hi-Score';
                    return (
                      <button
                        type="button"
                        key={`${title}-${subtitle}`}
                        role="radio"
                        aria-checked={available}
                        aria-description={available ? undefined : 'Non ancora disponibile'}
                        disabled={!available}
                        className={available ? 'selected' : ''}
                      >
                        <span>
                          {available && <ChartNoAxesColumnIncreasing size={18} strokeWidth={3} />}
                          {title === 'Around the Clock' ? 'Around' : title}
                        </span>
                        <small>{subtitles[title!] ?? subtitle}</small>
                      </button>
                    );
                  })}
              </div>
            )}
            <p className="hint">
              Disponibile ora: Hi-Score. Le altre modalità sono in preparazione.
            </p>
          </>
        )}
        {tournament && (
          <>
            <div className="event-heading">
              <TrophyEmblem />
              <div>
                <h2>{name || 'Il tuo torneo'}</h2>
                <p>{selected.length} giocatori · Hi-Score</p>
              </div>
            </div>
            <label className="field">
              Nome torneo
              <input
                maxLength={120}
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={!!draft}
              />
            </label>
            <div className="choice-group" role="radiogroup" aria-label="Formato torneo">
              <button
                role="radio"
                aria-checked={mode === 'GROUPS'}
                disabled={!!draft}
                onClick={() => setMode('GROUPS')}
              >
                A gironi
              </button>
              <button
                role="radio"
                aria-checked={mode === 'QUICK_HIGH_SCORE'}
                disabled={!!draft}
                onClick={() => setMode('QUICK_HIGH_SCORE')}
              >
                <ChartNoAxesColumnIncreasing size={18} strokeWidth={3} aria-hidden="true" />
                Hi-Score
              </button>
            </div>
            <p className="description">
              {mode === 'GROUPS'
                ? 'I giocatori vengono divisi in gironi; i migliori di ogni girone accedono alla fase a eliminazione.'
                : `Un solo girone di qualifica. I ${qualifiers} migliori punteggi accedono alla finale.`}
            </p>
          </>
        )}
        <fieldset disabled={!!draft || create.isPending}>
          <PlayerPicker selected={selected} change={setSelected} max={tournament ? 256 : 4} />
          {!tournament && (
            <section className="form-section">
              <h2>Tipo di partita</h2>
              <div className="segmented" role="radiogroup" aria-label="Tipo di partita">
                <button type="button" role="radio" aria-checked="true">
                  Individuale
                </button>
                <button type="button" role="radio" aria-checked="false" disabled>
                  Squadre · presto
                </button>
              </div>
            </section>
          )}
          <section className={tournament ? 'settings-card' : 'form-section'}>
            <h2>{tournament ? 'Impostazioni' : 'Opzioni'}</h2>
            <div className="options">
              <Stepper label="Turni per giocatore" value={turns} change={setTurns} max={100} />
              {tournament &&
                (mode === 'QUICK_HIGH_SCORE' ? (
                  <Stepper
                    label="Migliori alla finale"
                    value={qualifiers}
                    change={setQualifiers}
                    min={2}
                    max={64}
                  />
                ) : (
                  <>
                    <Stepper
                      label="Numero gironi"
                      value={groups}
                      change={setGroups}
                      min={1}
                      max={16}
                    />
                    <Stepper
                      label="Qualificati per girone"
                      value={perGroup}
                      change={setPerGroup}
                      max={16}
                    />
                  </>
                ))}
              <div className="settings-row">
                <span>Modalità di gioco</span>
                <strong>Hi-Score</strong>
              </div>
            </div>
            {!tournament && (
              <p className="hint">
                3 dardi per turno · massimo 180 punti. Set, leg e doppio out non si applicano a
                Hi-Score.
              </p>
            )}
          </section>
        </fieldset>
        <ErrorMessage error={create.error} />
        {create.error && (
          <p>
            <Link to={draft ? `/tornei/${draft.id}` : '/tornei'}>Controlla il torneo salvato</Link>{' '}
            prima di creare una nuova partita.
          </p>
        )}
        <div className="cta-block">
          <button
            className="primary cta"
            disabled={
              !!reason ||
              create.isPending ||
              (!draft && create.error instanceof ApiError && create.error.uncertain)
            }
            onClick={() => setConfirm(true)}
          >
            {tournament ? (
              <Trophy className="cta-icon" fill="currentColor" />
            ) : (
              <DartIcon className="cta-icon" strokeWidth={2} fill="none" />
            )}
            {create.isPending
              ? 'Avvio…'
              : draft
                ? 'Riprendi avvio'
                : tournament
                  ? 'AVVIA TORNEO'
                  : 'INIZIA PARTITA'}
          </button>
          {reason && (
            <p className="form-reason" role="status">
              {reason}
            </p>
          )}
        </div>
        {tournament && (
          <>
            <StageTimeline steps={plannedSteps(mode, turns, qualifiers, groups, perGroup)} />
            <div className="graffiti" aria-hidden="true">
              Good
              <br />
              darts
              <br />
              good
              <br />
              friends
            </div>
          </>
        )}
        {confirm && (
          <Modal
            title="Pronti al bersaglio?"
            close={() => {
              if (!create.isPending) setConfirm(false);
            }}
          >
            <p>
              {name} · Hi-Score · {turns} turni
            </p>
            <ol>
              {selected.map((p) => (
                <li key={p.id}>{p.displayName}</li>
              ))}
            </ol>
            <p className="hint">L’ordine mostrato è l’ordine di tiro.</p>
            <button className="primary" disabled={create.isPending} onClick={() => create.mutate()}>
              {create.isPending ? 'Avvio…' : 'Conferma e inizia'}
            </button>
          </Modal>
        )}
      </main>
    </>
  );
}
