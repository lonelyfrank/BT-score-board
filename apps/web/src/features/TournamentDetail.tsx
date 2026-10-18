import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../services/api';
import { ErrorMessage, Header, Loading } from '../components/ui';
import { GroupsDetail } from './Groups';
import { HiScoreDetail } from './HiScore';

/** One address per tournament, whatever the path: the mode decides the page. */
export function TournamentDetail() {
  const { id = '' } = useParams();
  // Same key as the pages below: they reuse this read.
  const query = useQuery({ queryKey: ['tournament', id], queryFn: () => api.tournament(id) });
  if (query.isPending) return <Loading />;
  if (!query.data)
    return (
      <>
        <Header title="Torneo" back="/tornei" />
        <main className="content">
          <ErrorMessage error={query.error} retry={() => void query.refetch()} />
        </main>
      </>
    );
  return query.data.mode === 'GROUPS' ? <GroupsDetail /> : <HiScoreDetail />;
}
