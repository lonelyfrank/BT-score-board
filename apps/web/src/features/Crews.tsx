import { useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Crown, Share2, Download, Users } from 'lucide-react';
import { api, localData, type Player } from '../services/api';
import { useCanManage } from '../services/me';
import { BT_PLAY_SPACE_ID } from '../../../../packages/domain/src/playspaces/playspaces';
import { SpaceSelect } from './PlaySpaces';
import { canShareFiles, downloadFile, shareFile } from '../services/device';
import { tournamentPath } from '../services/session';
import { games, type GameMode } from '../services/rules';
import {
  AddButton,
  Avatar,
  Empty,
  ErrorMessage,
  Header,
  Loading,
  Modal,
  Switch,
} from '../components/ui';
import { FxName, LevelChip, recordValue, useProgression } from '../components/Progression';
import { useKnowsMe } from '../components/WhoAmI';
import type { Crew } from '../../../../packages/domain/src/index.js';
import type {
  BackupFile,
  BackupSummary,
  MergeReport,
} from '../../../../packages/local-store/src/index.js';

/** A titled card, as in the settings. */
function Panel({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <>
      <h2 className="set-h" id={id}>
        {title}
      </h2>
      <section className="card pad" aria-labelledby={id}>
        {children}
      </section>
    </>
  );
}
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const day = (iso: string) =>
  new Date(iso).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' });

/** Every player, inactive ones included: crews and merges show them all. */
function usePlayers() {
  return useQuery({ queryKey: ['players', 'all'], queryFn: () => api.players('', 0) });
}
function useCrews() {
  return useQuery({ queryKey: ['crews'], queryFn: () => localData!.crews(), enabled: !!localData });
}

/** bt-compagnia-<name>-YYYY-MM-DD.json */
function packageName(crew: Crew, at: string) {
  const slug =
    crew.name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'compagnia';
  return `bt-compagnia-${slug}-${at.slice(0, 10)}.json`;
}

export function Crews() {
  const manage = useCanManage();
  const crews = useCrews();
  const players = usePlayers();
  const [editing, setEditing] = useState(false);
  if (!localData)
    return (
      <>
        <Header title="Compagnie" />
        <Empty title="Disponibile sul telefono">
          <p>Le compagnie si usano nella versione installata sul telefono.</p>
        </Empty>
      </>
    );
  return (
    <>
      <Header
        title="Compagnie"
        subtitle="Partite e livelli condivisi con gli amici"
        back="/giocatori"
        action={
          manage ? (
            <AddButton label="Nuova compagnia" onClick={() => setEditing(true)} />
          ) : undefined
        }
      />
      <main className="lists">
        <ErrorMessage error={crews.error} retry={() => void crews.refetch()} />
        {crews.isPending && <Loading />}
        {crews.data?.length === 0 && (
          <Empty title="Nessuna compagnia">
            <p>
              Crea una compagnia con gli amici con cui giochi: le partite giocate tra voi si
              condividono con un file da mandare in chat, senza server.
            </p>
          </Empty>
        )}
        <ul className="roster crew-rows">
          {crews.data?.map((c) => (
            <li key={c.id}>
              <Link to={`/compagnie/${c.id}`} className="btn">
                <span className="crew-icon" aria-hidden="true">
                  <Users />
                </span>
                <span>
                  <span>{c.name}</span>
                  <small>{count(c.memberIds.length, 'membro', 'membri')}</small>
                </span>
                <span />
                <ChevronRight aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
        <ReceivePanel />
        <Panel id="how-title" title="Come funziona">
          <p>
            Ognuno tiene i dati sul proprio telefono. Chi ha segnato una serata manda il pacchetto
            della compagnia; gli altri lo uniscono. Ogni partita ha un identificativo unico: unire
            due volte lo stesso pacchetto non duplica nulla e nessun dato viene perso.
          </p>
          <p>
            Il livello di ciascuno viaggia con il pacchetto, quindi è lo stesso in ogni compagnia.
            Le partite giocate fuori dalla compagnia restano solo sul tuo telefono.
          </p>
        </Panel>
      </main>
      {editing && players.data && (
        <CrewSheet players={players.data.items} close={() => setEditing(false)} />
      )}
    </>
  );
}

/** Picks a received crew package or backup and merges it. */
export function ReceivePanel() {
  const [file, setFile] = useState<{ backup: BackupFile; summary: BackupSummary }>();
  const input = useRef<HTMLInputElement>(null);
  const read = useMutation({
    mutationFn: async (f: File) => localData!.readBackup(await f.text()),
    onSuccess: setFile,
    onSettled: () => {
      if (input.current) input.current.value = '';
    },
  });
  return (
    <Panel id="receive-title" title="Hai ricevuto un pacchetto?">
      <p>
        Apri il file della compagnia (o il backup di un altro telefono) per unirlo ai tuoi dati.
      </p>
      <label className="btn cta file-button">
        Unisci un pacchetto
        <input
          ref={input}
          type="file"
          accept="application/json,.json"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) read.mutate(f);
          }}
        />
      </label>
      <ErrorMessage error={read.error} />
      {file && <MergeFlow {...file} close={() => setFile(undefined)} />}
    </Panel>
  );
}

function CrewSheet({
  crew,
  players,
  close,
  initialMembers,
}: {
  crew?: Crew;
  players: Player[];
  close: () => void;
  initialMembers?: string[];
}) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const progression = useProgression();
  const [name, setName] = useState(crew?.name ?? '');
  const [members, setMembers] = useState<string[]>(crew?.memberIds ?? initialMembers ?? []);
  const [autoShare, setAutoShare] = useState(crew?.autoShare ?? true);
  const save = useMutation({
    mutationFn: () =>
      localData!.saveCrew({
        id: crew?.id ?? crypto.randomUUID(),
        name: name.trim(),
        memberIds: members,
        tournamentIds: crew?.tournamentIds ?? [],
        excludedTournamentIds: crew?.excludedTournamentIds ?? [],
        autoShare,
        ...(crew ? { createdAt: crew.createdAt } : {}),
      }),
    onSuccess: (saved) => {
      void client.invalidateQueries();
      close();
      if (!crew) navigate(`/compagnie/${saved.id}`);
    },
  });
  // Members stay listed even when deactivated; others only while active.
  const listed = players.filter((p) => p.status === 'active' || members.includes(p.id));
  return (
    <Modal title={crew ? 'Modifica compagnia' : 'Nuova compagnia'} close={close}>
      <form
        className="sheet-form"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <label className="field">
          Nome
          <input
            value={name}
            maxLength={120}
            placeholder="Es. Gli amici del giovedì"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <fieldset className="crew-members">
          <legend>Membri ({members.length})</legend>
          <div className="check-list">
            {listed.map((p) => (
              <label className="check-row" key={p.id}>
                <input
                  type="checkbox"
                  checked={members.includes(p.id)}
                  onChange={(e) =>
                    setMembers(
                      e.target.checked ? [...members, p.id] : members.filter((id) => id !== p.id),
                    )
                  }
                />
                <span>
                  <FxName name={p.displayName} p={progression.data?.players.get(p.id)} />
                </span>
                <LevelChip p={progression.data?.players.get(p.id)} />
              </label>
            ))}
          </div>
        </fieldset>
        <div className="card">
          <div className="row">
            <span id="auto-share">
              <b className="row-title">Condividi in automatico</b>
              <small className="hint">
                Le partite giocate solo tra membri entrano nella compagnia
              </small>
            </span>
            <Switch checked={autoShare} change={setAutoShare} labelledBy="auto-share" />
          </div>
        </div>
        <ErrorMessage error={save.error} />
        <button className="btn cta" disabled={save.isPending || !name.trim() || members.length < 1}>
          {crew ? 'Salva' : 'Crea compagnia'}
        </button>
      </form>
    </Modal>
  );
}

export function CrewDetail() {
  const { id = '' } = useParams();
  const client = useQueryClient();
  const navigate = useNavigate();
  const crews = useCrews();
  const players = usePlayers();
  const progression = useProgression();
  const { me } = useKnowsMe();
  const crew = crews.data?.find((c) => c.id === id);
  // Records are contextual: the crew's tournaments played at one play space, never all mixed.
  const [spaceId, setSpaceId] = useState('');
  const activeSpace = spaceId || crew?.favoritePlaySpaceId || BT_PLAY_SPACE_ID;
  const crewProgression = useQuery({
    queryKey: ['crew-progression', id, activeSpace],
    queryFn: () => localData!.crewProgression(id, activeSpace),
    enabled: !!crew,
  });
  const shared = useQuery({
    queryKey: ['crew-tournaments', id],
    queryFn: () => localData!.crewTournaments(id),
    enabled: !!crew,
  });
  const [editing, setEditing] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [message, setMessage] = useState('');
  const send = useMutation({
    mutationFn: async (mode: 'share' | 'download') => {
      const pack = await localData!.exportCrew(id);
      const name = packageName(crew!, pack.exportedAt);
      const text = JSON.stringify(pack);
      if (mode === 'share' && (await shareFile(name, text)))
        return 'Pacchetto inviato: chi lo riceve lo apre da Compagnie → Unisci un pacchetto.';
      downloadFile(name, text);
      return `Pacchetto salvato come ${name}: mandalo agli altri membri.`;
    },
    onSuccess: setMessage,
  });
  const remove = useMutation({
    mutationFn: () => localData!.deleteCrew(id),
    onSuccess: () => {
      void client.invalidateQueries();
      navigate('/compagnie');
    },
  });
  if (crews.isPending) return <Loading />;
  if (!crew)
    return (
      <>
        <Header title="Compagnia" back="/compagnie" />
        <Empty title="Compagnia non trovata">
          <Link to="/compagnie">Torna alle compagnie</Link>
        </Empty>
      </>
    );
  const byId = new Map(players.data?.items.map((p) => [p.id, p]));
  const name = (playerId: string) => byId.get(playerId)?.displayName ?? 'Giocatore';
  // Global level (all data and cards): the same in every crew.
  const ranking = [...new Set(crew.memberIds)]
    .map((playerId) => ({ playerId, p: progression.data?.players.get(playerId) }))
    .sort((a, b) => (b.p?.xp ?? 0) - (a.p?.xp ?? 0));
  const records = Object.values(crewProgression.data?.records ?? {});
  return (
    <>
      <Header
        title={crew.name}
        subtitle={`${count(crew.memberIds.length, 'membro', 'membri')} · ${count(shared.data?.length ?? 0, 'torneo condiviso', 'tornei condivisi')}`}
        back="/compagnie"
      />
      <main className="lists">
        <Panel id="send-title" title="Condividi con la compagnia">
          <p>
            Dopo una serata manda il pacchetto agli altri membri: contiene solo i tornei della
            compagnia, i giocatori e i livelli dei membri.
          </p>
          <div className="pair">
            {canShareFiles() && (
              <button
                className="btn cta"
                disabled={send.isPending}
                onClick={() => send.mutate('share')}
              >
                <Share2 aria-hidden="true" /> Invia pacchetto
              </button>
            )}
            <button
              className={canShareFiles() ? 'btn' : 'btn cta'}
              disabled={send.isPending}
              onClick={() => send.mutate('download')}
            >
              <Download aria-hidden="true" /> Scarica pacchetto
            </button>
          </div>
          {message && (
            <p className="form-reason ok" role="status">
              {message}
            </p>
          )}
          <ErrorMessage error={send.error} />
        </Panel>

        <Panel id="ranking-title" title="Livelli">
          <ol className="crew-ranking">
            {ranking.map(({ playerId, p }, i) => (
              <li key={playerId}>
                <span className="rank">{i + 1}</span>
                <Avatar name={name(playerId)} avatar={byId.get(playerId)?.avatar} />
                <span>
                  <FxName name={name(playerId)} p={p} />
                  {playerId === me && <i className="me-tag">TU</i>}
                  <small>
                    {p
                      ? `${p.cosmetics.levelTitle} · ${p.xp.toLocaleString('it-IT')} XP`
                      : 'Nessuna partita'}
                  </small>
                </span>
                <LevelChip p={p} />
              </li>
            ))}
          </ol>
          <button onClick={() => setEditing(true)}>Modifica membri</button>
        </Panel>

        <Panel id="records-title" title="Record della compagnia">
          <SpaceSelect
            value={activeSpace}
            change={setSpaceId}
            label="Record nel punto di incontro"
          />
          {records.length === 0 ? (
            <p className="hint">
              Ancora nessun record. Hi-Score e Shanghai premiano il punteggio più alto, Exacta chi
              si avvicina di più all’obiettivo; 301 e 501 chi chiude in meno round, se i round sono
              registrati.
            </p>
          ) : (
            <ul className="record-list">
              {records.map((r) => (
                <li key={r.game}>
                  <Crown aria-hidden="true" />
                  <span>
                    <strong>{games[r.game as GameMode].label}</strong>
                    <small>{r.spec.title}</small>
                  </span>
                  <span>
                    <FxName name={name(r.playerId)} p={progression.data?.players.get(r.playerId)} />
                    <small>
                      {recordValue(r)} · {day(r.achievedAt)}
                    </small>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel id="shared-title" title="Tornei condivisi">
          <p className="hint">
            {crew.autoShare
              ? 'Entrano da soli i tornei giocati solo tra membri. Puoi aggiungerne o escluderne.'
              : 'Condivisione automatica spenta: entrano solo i tornei scelti.'}
          </p>
          <div className="list">
            {shared.data?.map((t) => (
              <Link className="mrow" key={t.id} to={tournamentPath(t)}>
                <span>
                  {t.name} <small>· {day(t.createdAt)}</small>
                </span>
                <ChevronRight aria-hidden="true" />
              </Link>
            ))}
          </div>
          <button className="btn" onClick={() => setChoosing(true)}>
            Scegli i tornei
          </button>
        </Panel>

        <ReceivePanel />

        <Panel id="delete-title" title="Elimina">
          <p className="hint">
            Toglie la compagnia solo da questo telefono: tornei, giocatori e livelli restano, e gli
            altri membri mantengono la loro copia.
          </p>
          <button className="btn danger" onClick={() => setConfirmDelete(true)}>
            Elimina da questo telefono
          </button>
        </Panel>
      </main>
      {editing && players.data && (
        <CrewSheet crew={crew} players={players.data.items} close={() => setEditing(false)} />
      )}
      {choosing && <ChooseTournaments crew={crew} close={() => setChoosing(false)} />}
      {confirmDelete && (
        <Modal
          title="Eliminare la compagnia?"
          variant="dialog"
          tone="danger"
          close={() => setConfirmDelete(false)}
        >
          <p>«{crew.name}» sparirà da questo telefono. I dati delle partite restano.</p>
          <ErrorMessage error={remove.error} />
          <div className="pair">
            <button onClick={() => setConfirmDelete(false)}>Annulla</button>
            <button className="btn cta" disabled={remove.isPending} onClick={() => remove.mutate()}>
              Elimina
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

/** Adds or excludes tournaments by hand, beyond the automatic rule. */
function ChooseTournaments({ crew, close }: { crew: Crew; close: () => void }) {
  const client = useQueryClient();
  const all = useQuery({
    queryKey: ['all-tournaments'],
    queryFn: () => localData!.allTournaments(),
  });
  const shared = useQuery({
    queryKey: ['crew-tournaments', crew.id],
    queryFn: () => localData!.crewTournaments(crew.id),
  });
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const current = selected ?? new Set(shared.data?.map((t) => t.id));
  const save = useMutation({
    mutationFn: async () => {
      const before = new Set(shared.data!.map((t) => t.id));
      // What the automatic rule shares without a choice: shared now and not chosen by hand.
      const automatic = new Set(
        [...before].filter(
          (id) => !crew.tournamentIds.includes(id) && !crew.excludedTournamentIds.includes(id),
        ),
      );
      const ids = all.data!.map((t) => t.id);
      const tournamentIds = ids.filter((id) => current.has(id) && !automatic.has(id));
      const excludedTournamentIds = [
        ...crew.excludedTournamentIds.filter((id) => !current.has(id)),
        ...[...automatic].filter((id) => !current.has(id)),
      ];
      return localData!.saveCrew({
        ...crew,
        tournamentIds,
        excludedTournamentIds: [...new Set(excludedTournamentIds)],
      });
    },
    onSuccess: () => {
      void client.invalidateQueries();
      close();
    },
  });
  return (
    <Modal title="Tornei della compagnia" close={close}>
      {(all.isPending || shared.isPending) && <Loading />}
      <div className="check-list">
        {all.data?.map((t) => (
          <label className="check-row" key={t.id}>
            <input
              type="checkbox"
              checked={current.has(t.id)}
              onChange={(e) => {
                const next = new Set(current);
                if (e.target.checked) next.add(t.id);
                else next.delete(t.id);
                setSelected(next);
              }}
            />
            <span>
              {t.name} <small>· {day(t.createdAt)}</small>
            </span>
          </label>
        ))}
      </div>
      <ErrorMessage error={save.error ?? all.error} />
      <button
        className="btn cta"
        disabled={save.isPending || !all.data || !shared.data}
        onClick={() => save.mutate()}
      >
        Salva
      </button>
    </Modal>
  );
}

function reportLines(r: MergeReport) {
  const lines: string[] = [];
  if (r.players.added)
    lines.push(`${count(r.players.added, 'giocatore nuovo', 'giocatori nuovi')}`);
  if (r.tournaments.added)
    lines.push(`${count(r.tournaments.added, 'torneo nuovo', 'tornei nuovi')}`);
  if (r.tournaments.updated)
    lines.push(`${count(r.tournaments.updated, 'torneo aggiornato', 'tornei aggiornati')}`);
  if (r.players.updated)
    lines.push(`${count(r.players.updated, 'profilo aggiornato', 'profili aggiornati')}`);
  if (r.crews.added) lines.push(`${count(r.crews.added, 'compagnia nuova', 'compagnie nuove')}`);
  if (r.crews.updated)
    lines.push(`${count(r.crews.updated, 'compagnia aggiornata', 'compagnie aggiornate')}`);
  if (r.events.added) lines.push(`${count(r.events.added, 'serata', 'serate')}`);
  if (r.cards) lines.push(`livelli aggiornati per ${count(r.cards, 'giocatore', 'giocatori')}`);
  return lines;
}

/**
 * Merging a crew package or another phone's backup: what would change, then the merge, then
 * the players with the same name to link (or to keep apart).
 */
export function MergeFlow({
  backup,
  summary,
  close,
}: {
  backup: BackupFile;
  summary: BackupSummary;
  close: () => void;
}) {
  const client = useQueryClient();
  const preview = useQuery({
    queryKey: ['merge-preview', backup.exportedAt, backup.source.deviceId],
    queryFn: () => localData!.previewMerge(backup),
    gcTime: 0,
  });
  const merge = useMutation({
    mutationFn: () => localData!.mergeBackup(backup),
    onSuccess: () => void client.invalidateQueries(),
  });
  const done = merge.data;
  const r = done ?? preview.data;
  const title =
    summary.scope === 'crew'
      ? `Pacchetto «${summary.crews[0] ?? 'compagnia'}»`
      : 'Unire il backup?';
  return (
    <Modal title={done ? 'Dati uniti' : title} close={() => !merge.isPending && close()}>
      <p>
        {summary.scope === 'crew' ? 'Inviato' : 'Esportato'} il {day(summary.exportedAt)}.
      </p>
      {preview.isPending && <Loading />}
      <ErrorMessage error={preview.error ?? merge.error} />
      {r && !done && (
        <>
          {r.unchanged ? (
            <p>Hai già tutti questi dati: non c’è niente da unire.</p>
          ) : (
            <>
              <p>Verranno aggiunti:</p>
              <ul>
                {reportLines(r).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              <p className="hint">
                Niente di quello che hai sul telefono viene cancellato. Unire di nuovo lo stesso
                file non duplica nulla.
              </p>
            </>
          )}
          {r.tournaments.diverged.length > 0 && (
            <p className="form-reason warn">
              Segnati su due telefoni diversi: {r.tournaments.diverged.join(', ')}. Resta la tua
              copia.
            </p>
          )}
          <div className="pair">
            <button onClick={close}>{r.unchanged ? 'Chiudi' : 'Annulla'}</button>
            {!r.unchanged && (
              <button className="btn cta" disabled={merge.isPending} onClick={() => merge.mutate()}>
                {merge.isPending ? 'Unione…' : 'Unisci'}
              </button>
            )}
          </div>
        </>
      )}
      {done && (
        <>
          <p className="form-reason ok" role="status">
            {reportLines(done).join(', ') || 'Dati già presenti.'}
          </p>
          <Homonyms groups={done.homonyms} />
          <button className="btn cta" onClick={close}>
            Fatto
          </button>
        </>
      )}
    </Modal>
  );
}

/** Same-name players after a merge: one person on two phones, or two people? */
function Homonyms({ groups }: { groups: MergeReport['homonyms'] }) {
  const client = useQueryClient();
  const [handled, setHandled] = useState<string[]>([]);
  const link = useMutation({
    mutationFn: async (ids: string[]) => {
      for (const other of ids.slice(1)) await localData!.linkPlayers(ids[0]!, other);
    },
    onSuccess: (_, ids) => {
      setHandled((h) => [...h, ids.join()]);
      void client.invalidateQueries();
    },
  });
  const open = groups.filter((g) => !handled.includes(g.players.map((p) => p.id).join()));
  if (!open.length) return null;
  return (
    <section className="homonyms" aria-labelledby="homonyms-title">
      <h3 id="homonyms-title">Stessa persona?</h3>
      <p className="hint">
        Questi nomi compaiono più volte. Se è la stessa persona creata su due telefoni, collegala:
        partite e livelli si sommano. Se sono due persone diverse, lasciale separate.
      </p>
      {open.map((g) => {
        const ids = g.players.map((p) => p.id);
        return (
          <div className="homonym" key={ids.join()}>
            <strong>
              {g.name} <small>× {g.players.length}</small>
            </strong>
            <small>Creati il {g.players.map((p) => day(p.createdAt)).join(' e il ')}</small>
            <div className="pair">
              <button onClick={() => setHandled((h) => [...h, ids.join()])}>Persone diverse</button>
              <button
                className="btn cta"
                disabled={link.isPending}
                onClick={() => link.mutate(ids)}
              >
                Sì, collega
              </button>
            </div>
          </div>
        );
      })}
      <ErrorMessage error={link.error} />
    </section>
  );
}

const onboardingKey = 'bt-crew-onboarding';
const onboarding = {
  dismissed() {
    try {
      return (
        localStorage.getItem(onboardingKey) === 'never' ||
        sessionStorage.getItem(onboardingKey) === 'later'
      );
    } catch {
      return false;
    }
  },
  dismiss(how: 'later' | 'never') {
    try {
      (how === 'never' ? localStorage : sessionStorage).setItem(onboardingKey, how);
    } catch {
      /* Asked again next time. */
    }
  },
};

/**
 * For data created before crews: the players already on the phone have no crew. Asks, in a
 * card on the Home (never a dialog over a match), whether to create one with them.
 */
export function CrewOnboarding() {
  const crews = useCrews();
  const players = useQuery({
    queryKey: ['players', 'all'],
    queryFn: () => api.players('', 0),
    enabled: !!localData,
  });
  const [hidden, setHidden] = useState(onboarding.dismissed);
  const [creating, setCreating] = useState(false);
  const { me } = useKnowsMe();
  const active = players.data?.items.filter((p) => p.status === 'active') ?? [];
  // First the phone must know who owns it: the crew is then offered with them in it.
  if (hidden || !localData || !me || crews.data?.length !== 0 || active.length < 2) return null;
  const later = (how: 'later' | 'never') => {
    onboarding.dismiss(how);
    setHidden(true);
  };
  return (
    <section className="crew-onboarding" aria-labelledby="crew-onboarding-title">
      <Users aria-hidden="true" />
      <h2 id="crew-onboarding-title">Crea la tua compagnia</h2>
      <p>
        Hai già {count(active.length, 'giocatore', 'giocatori')} su questo telefono, ma nessuna
        compagnia. Creane una con loro: vi scambiate partite, statistiche e livelli e unite i dati
        di ogni telefono senza perderne nessuno. I livelli sono già calcolati dalle partite
        registrate.
      </p>
      <div className="pair">
        <button onClick={() => later('later')}>Non ora</button>
        <button className="btn cta" onClick={() => setCreating(true)}>
          Crea compagnia
        </button>
      </div>
      <button className="link-button" onClick={() => later('never')}>
        Non chiedere più
      </button>
      {creating && (
        <CrewSheet
          players={players.data!.items}
          initialMembers={[me, ...active.map((p) => p.id).filter((id) => id !== me)]}
          close={() => setCreating(false)}
        />
      )}
    </section>
  );
}
