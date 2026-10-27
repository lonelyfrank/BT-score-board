import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, localData, type Summary } from '../services/api';
import { ErrorMessage, Modal } from './ui';

const inProgress = (status: string) => ['active', 'paused'].includes(status);
const started = (status: string) => !['draft', 'registration', 'ready'].includes(status);

/**
 * What an admin can do with a tournament started by mistake or played as a test: cancel it while
 * it is open (it stays in the history but leaves every statistic), then remove it from the lists.
 * A removed tournament is kept: the admin finds it under "Eliminati" and can restore it.
 */
export function TournamentAdminSheet({
  t,
  removed = false,
  close,
}: {
  t: Summary;
  removed?: boolean;
  close: () => void;
}) {
  const client = useQueryClient();
  const done = () => {
    void client.invalidateQueries();
    close();
  };
  const cancel = useMutation({
    mutationFn: async () => api.tournamentCommand(await api.tournament(t.id), 'cancel'),
    onSuccess: done,
  });
  const remove = useMutation({
    mutationFn: (value: boolean) => localData!.removeTournament(t.id, value),
    onSuccess: done,
  });
  const open = !['completed', 'cancelled'].includes(t.status);
  const busy = cancel.isPending || remove.isPending;
  return (
    <Modal title={t.name} subtitle="Gestione del torneo" close={close}>
      <ErrorMessage error={cancel.error ?? remove.error} />
      {removed ? (
        <>
          <p>
            Questo torneo è stato eliminato: non compare nelle liste né nelle statistiche, e solo
            gli admin lo vedono. Ripristinandolo torna com’era.
          </p>
          <button
            type="button"
            className="btn cta"
            disabled={busy}
            onClick={() => remove.mutate(false)}
          >
            Ripristina torneo
          </button>
        </>
      ) : (
        <>
          {open && started(t.status) && (
            <>
              <p>
                {inProgress(t.status) ? 'Il torneo è in corso. ' : ''}Annullarlo lo ferma: resta
                nello storico come “annullato” ma esce dalle statistiche dei giocatori. Non si può
                riattivare.
              </p>
              <button
                key="cancel"
                type="button"
                className="btn danger"
                disabled={busy}
                onClick={() => cancel.mutate()}
              >
                Annulla il torneo
              </button>
            </>
          )}
          {open && !started(t.status) && (
            <>
              <p>Il torneo non è ancora iniziato: puoi annullarlo o eliminarlo direttamente.</p>
              <button
                key="cancel"
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => cancel.mutate()}
              >
                Annulla il torneo
              </button>
            </>
          )}
          {localData && !inProgress(t.status) && (
            <>
              <p>
                Eliminare toglie il torneo da liste, serate, compagnie e statistiche: serve per le
                prove e i tornei di test. Resta ripristinabile da “Eliminati”.
              </p>
              <button
                key="remove"
                type="button"
                className="btn danger"
                disabled={busy}
                onClick={() => remove.mutate(true)}
              >
                Elimina il torneo
              </button>
            </>
          )}
          {inProgress(t.status) && localData && (
            <p className="hint">Per eliminarlo, prima annullalo.</p>
          )}
        </>
      )}
    </Modal>
  );
}
