import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { ChartNoAxesColumnIncreasing, ChevronUp, Info, Plus, X } from 'lucide-react';
import { api, ApiError, nickname, type Player, type Tournament } from '../services/api';
import { HI_SCORE_ROUNDS, gameModes, games, sideOf, type GameMode } from '../services/rules';
import { Avatar, ErrorMessage, Header, Modal } from '../components/ui';
import { DartIcon } from '../components/BrandIcons';
import { AddPlayerSheet } from '../components/PlayerSheets';

/** A free match of any totem game: one result, recorded when the totem shows it. */
export function Setup() {
  const [mode, setMode] = useState<GameMode>('HI_SCORE');
  const [name, setName] = useState('Partita libera');
  const [selected, setSelected] = useState<Player[]>([]);
  const [picker, setPicker] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [draft, setDraft] = useState<Tournament>();
  const navigate = useNavigate();
  const game = games[mode];
  const { min, max } = game.players;
  const reason = !name.trim()
    ? 'Inserisci un nome per la partita.'
    : selected.length < min
      ? `Servono almeno ${min} giocatori.`
      : selected.length > max
        ? `${game.label} si gioca al massimo in ${max}: togli ${selected.length - max} ${selected.length - max === 1 ? 'giocatore' : 'giocatori'}.`
        : '';
  const create = useMutation({
    mutationFn: async () => {
      let t = draft
        ? await api.tournament(draft.id)
        : await api.createTournament({
            name: name.trim(),
            mode: 'SINGLE_MATCH',
            gameMode: mode,
            scoringConfiguration: { kind: 'HIGH_SCORE', turns: HI_SCORE_ROUNDS },
            tournamentConfiguration: { playingOrder: 'registration' },
          });
      setDraft(t);
      for (const [index, player] of selected.entries()) {
        if (!t.entries.some((e) => e.playerId === player.id))
          t = await api.tournamentCommand(t, 'players', { playerId: player.id, seed: index + 1 });
      }
      if (['draft', 'registration', 'ready'].includes(t.status))
        t = await api.tournamentCommand(t, 'start');
      navigate(`/partite/${t.matches[0]!.id}`);
    },
    onSettled: () => setConfirm(false),
  });
  const move = (index: number) => {
    const next = [...selected];
    [next[index - 1], next[index]] = [next[index]!, next[index - 1]!];
    setSelected(next);
  };
  return (
    <>
      <Header title="Nuova partita" />
      <main className="content setup-page">
        <div className="mode-grid totem" role="radiogroup" aria-label="Modalità di gioco del totem">
          {gameModes.map((id) => (
            <button
              type="button"
              key={id}
              role="radio"
              aria-checked={mode === id}
              className={mode === id ? 'selected' : ''}
              disabled={!!draft || create.isPending}
              onClick={() => setMode(id)}
            >
              <span>
                {id === 'HI_SCORE' && <ChartNoAxesColumnIncreasing size={17} strokeWidth={3} />}
                {games[id].label}
              </span>
              <small>
                {games[id].players.min === games[id].players.max
                  ? `${games[id].players.max} giocatori`
                  : `${games[id].players.min}–${games[id].players.max} giocatori`}
              </small>
            </button>
          ))}
        </div>
        <p className="note">
          <Info aria-hidden="true" />
          {game.rules} Il totem calcola i punti: qui si registra solo il risultato finale.
        </p>
        <fieldset disabled={!!draft || create.isPending}>
          <label className="field heading-field">
            Nome partita
            <input maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <section className="form-section" aria-labelledby="players-title">
            <div className="section-head">
              <h2 id="players-title">Giocatori ({min === max ? max : `${min}–${max}`})</h2>
              <span>Ordine = ordine di tiro</span>
            </div>
            <ol className="order-list">
              {selected.map((p, i) => (
                <li key={p.id}>
                  <span className={`order ${i === 0 ? 'first' : ''}`}>{i + 1}</span>
                  <Avatar name={p.displayName} className={i === 0 ? 'ring selected' : 'ring'} />
                  <span className="order-name">
                    <span>{p.displayName}</span>
                    <small>
                      {[i === 0 ? 'Tira per primo' : '', sideOf(mode, i + 1) ?? '', nickname(p)]
                        .filter(Boolean)
                        .join(' · ')}
                    </small>
                  </span>
                  <button
                    type="button"
                    className="mini"
                    aria-label={`Anticipa ${p.displayName}`}
                    disabled={i === 0}
                    onClick={() => move(i)}
                  >
                    <ChevronUp size={18} />
                  </button>
                  <button
                    type="button"
                    className="mini"
                    aria-label={`Rimuovi ${p.displayName}`}
                    onClick={() => setSelected(selected.filter((x) => x.id !== p.id))}
                  >
                    <X size={16} className="accent-soft" />
                  </button>
                </li>
              ))}
              {selected.length < max && (
                <li className="add-row">
                  <button type="button" onClick={() => setPicker(true)}>
                    <Plus aria-hidden="true" className="accent-icon" />
                    Aggiungi giocatore
                  </button>
                </li>
              )}
            </ol>
          </section>
          <section className="form-section">
            <h2>Regole {game.label}</h2>
            <div className="options">
              {game.startingScore !== null && (
                <div className="settings-row">
                  <span>Punteggio di partenza</span>
                  <strong>{game.startingScore}</strong>
                </div>
              )}
              {game.rounds !== null && (
                <div className="settings-row">
                  <span>{mode === 'SHANGHAI' ? 'Numeri' : 'Round'}</span>
                  <strong>{mode === 'SHANGHAI' ? `1–${game.rounds}` : game.rounds}</strong>
                </div>
              )}
              {game.target && (
                <div className="settings-row">
                  <span>Obiettivo casuale</span>
                  <strong>
                    {game.target.min}–{game.target.max}
                  </strong>
                </div>
              )}
              <div className="settings-row">
                <span>Da registrare</span>
                <strong className="accent-soft">
                  {game.scoreRequired ? 'Punteggio finale' : 'Vincitore'}
                </strong>
              </div>
            </div>
            <p className="hint">
              {game.scoreRequired
                ? 'Alla fine si inserisce il totale di ogni giocatore mostrato dal totem.'
                : `Alla fine si tocca il vincitore; ${game.scoreLabel.toLowerCase()} facoltativi.`}
            </p>
          </section>
        </fieldset>
        <ErrorMessage error={create.error} />
        {create.error && draft && (
          <p>
            <Link to="/tornei">Controlla la partita salvata</Link> prima di crearne una nuova.
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
            <DartIcon className="cta-icon" strokeWidth={2} fill="none" />
            {create.isPending ? 'Avvio…' : draft ? 'Riprendi avvio' : 'INIZIA PARTITA'}
          </button>
          {reason && (
            <p className="form-reason" role="status">
              {reason}
            </p>
          )}
        </div>
        {picker && (
          <AddPlayerSheet
            excluded={selected.map((p) => p.id)}
            remaining={max - selected.length}
            add={(p) => setSelected((current) => [...current, p])}
            close={() => setPicker(false)}
          />
        )}
        {confirm && (
          <Modal
            variant="dialog"
            title={<span className="marker">Pronti al bersaglio?</span>}
            close={() => !create.isPending && setConfirm(false)}
          >
            <p>
              {name.trim()} · {game.label}
            </p>
            <ol className="confirm-order">
              {selected.map((p, i) => (
                <li key={p.id}>
                  <span>{i + 1}</span>
                  {p.displayName}
                </li>
              ))}
            </ol>
            <p className="hint">
              Imposta {game.label} sul totem con lo stesso ordine. Dopo l’avvio i giocatori non si
              possono più modificare.
            </p>
            <button className="primary" disabled={create.isPending} onClick={() => create.mutate()}>
              {create.isPending ? 'Avvio…' : 'CONFERMA E INIZIA'}
            </button>
            <button disabled={create.isPending} onClick={() => setConfirm(false)}>
              Modifica
            </button>
          </Modal>
        )}
      </main>
    </>
  );
}
