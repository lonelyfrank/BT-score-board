import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { localData } from '../services/api';
import { requestPersistence } from '../services/device';
import { isCriticalRoute, usePwa } from '../services/pwa';

type Problem = { message: string; action: 'retry' | 'reload' } | null;

/** Device-level states that affect every screen: storage availability and app upgrades. */
export function AppStatus() {
  return (
    <>
      <StorageStatus />
      <UpdateToast />
    </>
  );
}

/** Discreet and never on live scoring or setup: the update waits for a safe moment. */
function UpdateToast() {
  const { pathname } = useLocation();
  const pwa = usePwa();
  if (!pwa.canApply || isCriticalRoute(pathname)) return null;
  return (
    <div className="update-toast" role="status">
      <p>Nuova versione disponibile</p>
      <button type="button" className="btn cta sm" onClick={pwa.applyUpdate}>
        Aggiorna
      </button>
    </div>
  );
}

function StorageStatus() {
  const [problem, setProblem] = useState<Problem>(null);
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    if (!localData) return;
    let active = true;
    const open = () =>
      localData!.connect().then(
        () => active && setProblem(null),
        (error: Error) => active && setProblem({ message: error.message, action: 'retry' }),
      );
    void open();
    const stop = localData.subscribe((event) => {
      if (event.type === 'closed')
        setProblem({
          message: 'L’app è stata aggiornata in un’altra scheda. Ricarica per continuare.',
          action: 'reload',
        });
      if (event.type === 'blocked') setBlocked(true);
      if (event.type === 'changed' && event.origin === 'local') void requestPersistence();
    });
    return () => {
      active = false;
      stop();
    };
  }, []);
  if (!problem && !blocked) return null;
  return (
    <div className="app-notice" role="alert">
      <p>
        {problem?.message ??
          'Chiudi le altre schede di BT Darts Score Board per completare l’aggiornamento.'}
      </p>
      {problem && (
        <button
          type="button"
          className="btn sm"
          onClick={() =>
            problem.action === 'reload'
              ? window.location.reload()
              : void localData!.connect().then(
                  () => setProblem(null),
                  (error: Error) => setProblem({ message: error.message, action: 'retry' }),
                )
          }
        >
          {problem.action === 'reload' ? 'Ricarica' : 'Riprova'}
        </button>
      )}
    </div>
  );
}
