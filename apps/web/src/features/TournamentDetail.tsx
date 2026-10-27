import { Navigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../services/api';
import { ErrorMessage, Header, Loading } from '../components/ui';
import { GroupsDetail } from './Groups';
import { HiScoreDetail } from './HiScore';

/** One address per tournament, whatever the path: the mode decides the page. */
import { MoveSpace } from './PlaySpaces';

export function TournamentDetail() {
  const { id = '' } = useParams();
  // Same key as the pages below: they reuse this read.
  const query = useQuery({ queryKey: ['tournament', id], queryFn: () => api.tournament(id) });
  if (query.isPending) return <Loading />;
  if (!query.data)
    return (
      <>
        <Header title="Torneo" back="/tornei" />
        <main>
          <ErrorMessage error={query.error} retry={() => void query.refetch()} />
        </main>
      </>
    );
  // A single match is its own page: the result screen.
  if (query.data.mode === 'SINGLE_MATCH' && query.data.matches[0])
    return <Navigate to={`/partite/${query.data.matches[0].id}`} replace />;
  return (
    <>
      {query.data.mode === 'GROUPS' ? <GroupsDetail /> : <HiScoreDetail />}
      <MoveSpace tournamentId={id} />
    </>
  );
}
