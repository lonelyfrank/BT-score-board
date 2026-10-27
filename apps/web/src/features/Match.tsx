import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, cloudApi, pollInterval } from '../services/api';
import { isResultRecording } from '../services/rules';
import { ErrorMessage, Header, Loading } from '../components/ui';
import { GuidedMatch } from './Guided';
import { Live } from './Live';
import { ResultEntry } from './Result';
import { FollowMatch } from './Follow';
import { ScorerBar } from '../components/ScorerBar';
import { useQueryClient } from '@tanstack/react-query';

/**
 * One address per match. Results recorded from the totem are the norm, followed turn by turn
 * when rounds are tracked; tournaments started before results existed keep their turn-by-turn
 * screen until they end.
 */
export function MatchScreen() {
  const { gameId = '' } = useParams();
  // Same keys as the screens below: they reuse these reads.
  const query = useQuery({
    queryKey: ['match', gameId],
    queryFn: () => api.match(gameId),
    refetchInterval: pollInterval,
  });
  const tournament = useQuery({
    queryKey: ['tournament', query.data?.tournamentId],
    queryFn: () => api.tournament(query.data!.tournamentId),
    enabled: !!query.data,
  });
  const queries = useQueryClient();
  // Cloud: only the scorer's device writes; everyone else follows the match read-only.
  const access = useQuery({
    queryKey: ['match-access', query.data?.tournamentId],
    queryFn: () => cloudApi!.matchAccess(query.data!.tournamentId),
    enabled: !!cloudApi && !!query.data,
  });
  if (query.isPending || (cloudApi && query.data && access.isPending)) return <Loading />;
  if (!query.data)
    return (
      <>
        <Header title="Partita" />
        <main>
          <ErrorMessage error={query.error} retry={() => void query.refetch()} />
        </main>
      </>
    );
  if (cloudApi && access.data && !(access.data.mine && access.data.device !== 'elsewhere')) {
    const elsewhere = access.data.mine && access.data.device === 'elsewhere';
    return (
      <>
        {elsewhere && (
          <div className="scorer-bar" role="alert">
            <span>Questa partita è segnata su un altro tuo dispositivo.</span>
            <button
              type="button"
              className="btn sm"
              onClick={() =>
                void cloudApi!
                  .takeOverScoring(query.data!.tournamentId)
                  .then(() => queries.invalidateQueries())
              }
            >
              Segna da qui
            </button>
          </div>
        )}
        <FollowMatch tournamentId={query.data.tournamentId} />
      </>
    );
  }
  const screen = !isResultRecording(query.data) ? (
    <Live />
  ) : // Rounds tracked: the guided screen follows the turns; otherwise only the final result.
  query.data.tracking !== 'FINAL_ONLY' ? (
    <GuidedMatch key={query.data.id} query={query} tournament={tournament} />
  ) : (
    <ResultEntry key={query.data.id} query={query} tournament={tournament} />
  );
  return (
    <>
      {cloudApi && <ScorerBar tournamentId={query.data.tournamentId} />}
      {screen}
    </>
  );
}
