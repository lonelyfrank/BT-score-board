import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { ChartNoAxesColumnIncreasing, ChevronUp, Info, Plus, X } from 'lucide-react';
import {
  api,
  ApiError,
  entryMode,
  nickname,
  type EntryMode,
  type Player,
  type Tournament,
} from '../services/api';
import { Avatar, ErrorMessage, Header, Modal, Segmented, Stepper, Tabs } from '../components/ui';
import { DartIcon } from '../components/BrandIcons';
import { AddPlayerSheet } from '../components/PlayerSheets';

const catalog = [
  ['301', 'Classic'],
  ['501', 'Classic'],
  ['701', 'Classic'],
  ['301', 'Master'],
  ['501', 'Master'],
  ['1001', 'Master'],
  ['Cricket', ''],
  ['Around', 'the Clock'],
  ['Shanghai', ''],
  ['Double In', 'Double Out'],
  ['Hi-Score', ''],
  ['Exacta', ''],
];
const MAX_PLAYERS = 4;
export const entryNote: Record<EntryMode, string> = {
  total: 'Un numero per turno: il più veloce al bancone.',
  dart: 'Un valore per ogni freccetta (0 = mancata). Si può cambiare a ogni turno.',
};

/** A free Hi-Score match: a one-off qualification with every player admitted. */
export function Setup() {
  const [category, setCategory] = useState('01');
  const [name, setName] = useState('Partita libera');
  const [selected, setSelected] = useState<Player[]>([]);
  const [turns, setTurns] = useState(3);
  const [darts, setDarts] = useState(3);
  const [entry, setEntry] = useState<EntryMode>(entryMode.get);
  const [picker, setPicker] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [draft, setDraft] = useState<Tournament>();
  const navigate = useNavigate();
  const reason = !name.trim()
    ? 'Inserisci un nome per la partita.'
    : selected.length < 2
      ? 'Servono almeno 2 giocatori.'
      : '';
  const create = useMutation({
    mutationFn: async () => {
      entryMode.set(entry);
      let t = draft
        ? await api.tournament(draft.id)
        : await api.createTournament({
            name: name.trim(),
            mode: 'QUICK_HIGH_SCORE',
            scoringConfiguration: { kind: 'HIGH_SCORE', turns, dartsPerTurn: darts },
            tournamentConfiguration: {
              qualifiers: selected.length,
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
      const match = await api.match(t.matches[0]!.id);
      if (match.status === 'ready') await api.matchCommand(match, 'start');
      navigate(`/partite/${match.id}`);
    },
    onSettled: () => setConfirm(false),
  });
  const move = (index: number) => {
    const next = [...selected];
    [next[index - 1], next[index]] = [next[index]!, next[index - 1]!];
    setSelected(next);
  };
  const modes = catalog.filter(
    ([title]) =>
      category === '01' || (category === 'Speciali' ? !/^\d/.test(title!) : /^\d/.test(title!)),
  );
  return (
    <>
      <Header title="Nuova partita" />
      <main className="content setup-page">
        <Tabs
          label="Categorie modalità"
          tabs={['01', '02', 'Speciali', 'Classiche'].map((id) => ({ id, label: id }))}
          value={category}
          change={setCategory}
        />
        {category === '02' ? (
          <div className="empty dashed">
            <p>Categoria non ancora definita nel catalogo.</p>
          </div>
        ) : (
          <div className="mode-grid" role="radiogroup" aria-label="Modalità di gioco">
            {modes.map(([title, subtitle]) => {
              const available = title === 'Hi-Score';
              return (
                <button
                  type="button"
                  key={`${title}-${subtitle}`}
                  role="radio"
                  aria-checked={available}
                  aria-disabled={!available}
                  disabled={!available}
                  className={available ? 'selected' : ''}
                >
                  <span>
                    {available && <ChartNoAxesColumnIncreasing size={17} strokeWidth={3} />}
                    {title}
                  </span>
                  <small>{available ? 'Disponibile' : 'In arrivo'}</small>
                </button>
              );
            })}
          </div>
        )}
        <p className="note">
          <Info aria-hidden="true" />
          Disponibile ora: Hi-Score. X01, Cricket e le altre modalità arriveranno con il motore di
          gioco.
        </p>
        <fieldset disabled={!!draft || create.isPending}>
          <label className="field heading-field">
            Nome partita
            <input maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <section className="form-section" aria-labelledby="players-title">
            <div className="section-head">
              <h2 id="players-title">Giocatori (2–{MAX_PLAYERS})</h2>
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
                      {[i === 0 ? 'Tira per primo' : '', nickname(p)].filter(Boolean).join(' · ')}
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
              {selected.length < MAX_PLAYERS && (
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
            <h2>Tipo di partita</h2>
            <Segmented
              label="Tipo di partita"
              value="single"
              change={() => {}}
              options={[
                { id: 'single', label: 'Individuale' },
                { id: 'teams', label: 'Squadre · in arrivo', disabled: true },
              ]}
            />
          </section>
          <section className="form-section">
            <h2>Regole Hi-Score</h2>
            <div className="options">
              <Stepper label="Turni per giocatore" value={turns} change={setTurns} max={100} />
              <Stepper label="Freccette per turno" value={darts} change={setDarts} max={12} />
              <div className="settings-row">
                <span>Massimo per freccetta</span>
                <strong>60</strong>
              </div>
              <div className="settings-row">
                <span>Massimo per turno</span>
                <strong className="accent-soft">{darts * 60}</strong>
              </div>
            </div>
            <p className="hint">
              Vince chi totalizza più punti. Set, leg e doppio out non si applicano a Hi-Score.
            </p>
          </section>
          <section className="form-section">
            <h2>Inserimento punteggi</h2>
            <Segmented
              label="Inserimento punteggi"
              value={entry}
              change={setEntry}
              options={[
                { id: 'total', label: 'Totale turno' },
                { id: 'dart', label: 'Per freccetta' },
              ]}
            />
            <p className="hint">{entryNote[entry]}</p>
          </section>
        </fieldset>
        <ErrorMessage error={create.error} />
        {create.error && draft && (
          <p>
            <Link to={`/hiscore/${draft.id}`}>Controlla la partita salvata</Link> prima di
            crearne una nuova.
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
            remaining={MAX_PLAYERS - selected.length}
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
              {name.trim()} · Hi-Score · {turns} {turns === 1 ? 'turno' : 'turni'} · {darts}{' '}
              {darts === 1 ? 'freccetta' : 'freccette'}
            </p>
            <ol className="confirm-order">
              {selected.map((p, i) => (
                <li key={p.id}>
                  <span>{i + 1}</span>
                  {p.displayName}
                </li>
              ))}
            </ol>
            <p className="hint">Dopo l’avvio giocatori e regole non si possono più modificare.</p>
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
