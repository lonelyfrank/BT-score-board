import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { cloudApi } from '../services/api';
import { ErrorMessage } from './ui';
import { Qr, shareLink } from './Qr';

/**
 * Above the scoring screens in cloud mode: who holds the match, passing it on, and the link that
 * lets the others follow it (read-only, no rights in it).
 */
export function ScorerBar({ tournamentId }: { tournamentId: string }) {
  const queries = useQueryClient();
  const [open, setOpen] = useState<'pass' | 'follow' | null>(null);
  const [note, setNote] = useState('');
  const candidates = useQuery({
    queryKey: ['scorer-candidates', tournamentId],
    queryFn: () => cloudApi!.scorerCandidates(tournamentId),
    enabled: open === 'pass',
  });
  const pass = useMutation({
    mutationFn: (accountId: string) => cloudApi!.transferScorer(tournamentId, accountId),
    onSuccess: () => queries.invalidateQueries(),
  });
  const link = `${location.origin}/segui/${tournamentId}`;
  return (
    <div className="scorer-bar">
      <span>Sei il segnapunti di questa partita.</span>
      <button
        type="button"
        className="btn sm"
        onClick={() => setOpen(open === 'follow' ? null : 'follow')}
      >
        Fai seguire
      </button>
      <button
        type="button"
        className="btn sm ghost"
        onClick={() => setOpen(open === 'pass' ? null : 'pass')}
      >
        Passa il segnapunti
      </button>
      {open === 'follow' && (
        <div className="follow-share">
          <Qr value={link} label="QR per seguire la partita" />
          <p className="hint">
            Chi apre il link vede la partita in diretta, senza poterla modificare. Serve un account
            collegato a un giocatore della partita.
          </p>
          <button
            type="button"
            className="btn sm"
            onClick={() =>
              void shareLink('Segui la partita', link).then((r) =>
                setNote(
                  r === 'copied' ? 'Link copiato.' : r === 'failed' ? 'Copia il link a mano.' : '',
                ),
              )
            }
          >
            Condividi il link
          </button>
          {note && <p role="status">{note}</p>}
        </div>
      )}
      {open === 'pass' && (
        <div className="follow-share">
          <p className="hint">
            Il nuovo segnapunti prende il tuo posto e tu non potrai più registrare. L’operazione è
            tracciata.
          </p>
          {candidates.data?.length === 0 && (
            <p>Nessun altro giocatore con un account in questa partita.</p>
          )}
          {candidates.data?.map((c) => (
            <button
              type="button"
              key={c.id}
              className="btn sm"
              disabled={pass.isPending}
              onClick={() => {
                if (window.confirm(`Passare il segnapunti a ${c.username}?`)) pass.mutate(c.id);
              }}
            >
              {c.username}
            </button>
          ))}
          <ErrorMessage error={candidates.error ?? pass.error} />
        </div>
      )}
    </div>
  );
}
