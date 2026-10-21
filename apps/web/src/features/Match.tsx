import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, pollInterval } from '../services/api';
import { isResultRecording } from '../services/rules';
import { ErrorMessage, Header, Loading } from '../components/ui';
import { GuidedMatch } from './Guided';
import { Live } from './Live';
import { ResultEntry } from './Result';

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
  if (query.isPending) return <Loading />;
  if (!query.data)
    return (
      <>
        <Header title="Partita" />
        <main>
          <ErrorMessage error={query.error} retry={() => void query.refetch()} />
        </main>
      </>
    );
  if (!isResultRecording(query.data)) return <Live />;
  // Rounds tracked: the guided screen follows the turns; otherwise only the final result.
  return query.data.tracking !== 'FINAL_ONLY' ? (
    <GuidedMatch key={query.data.id} query={query} tournament={tournament} />
  ) : (
    <ResultEntry key={query.data.id} query={query} tournament={tournament} />
  );
}
