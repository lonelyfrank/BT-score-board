import { useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Eye, EyeOff, Fingerprint } from 'lucide-react';
import { cloudApi } from '../services/api';
import { ErrorMessage, Loading, Segmented } from '../components/ui';

type Step = 'login' | 'register' | 'reset';

/**
 * Cloud mode without a session: sign in with a passkey or the password, join with an invite
 * code, or set a new password with a reset code from an admin. The first account, made with
 * the setup code, is the owner's.
 */
export function Login() {
  const api = cloudApi!;
  const info = useQuery({ queryKey: ['session-info'], queryFn: () => api.refreshSession() });
  const firstRun = info.data?.ownerExists === false;
  const [step, setStep] = useState<Step>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [visible, setVisible] = useState(false);
  const current: Step = firstRun ? 'register' : step;
  const submit = useMutation({
    mutationFn: () =>
      current === 'login'
        ? api.login(username, password)
        : current === 'register'
          ? api.register(username, password, code)
          : api.resetPassword(username, code, password),
  });
  const passkey = useMutation({ mutationFn: () => api.passkeyLogin() });
  const busy = submit.isPending || passkey.isPending;
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    passkey.reset();
    submit.mutate();
  };
  // The same shell as the Home, without the navigation bar.
  return (
    <div className="app-shell without-nav">
      <div id="main-content">
        <main className="home login">
          <div className="home-hero" aria-hidden="true" />
          <div className="home-foot" aria-hidden="true" />
          <h1 className="visually-hidden">BT Darts Score Board — accesso</h1>
          <div className="home-body">
            {info.isPending ? (
              <Loading />
            ) : (
              <section className="card pad access" aria-labelledby="login-title">
                <div className="sec-h">
                  <h2 id="login-title">
                    {firstRun
                      ? 'Primo avvio'
                      : current === 'login'
                        ? 'Accedi'
                        : current === 'register'
                          ? 'Crea il tuo account'
                          : 'Nuova password'}
                  </h2>
                </div>
                {firstRun ? (
                  <p className="hint">
                    Crea l’account del proprietario con il codice di configurazione impostato sul
                    server (OWNER_SETUP_CODE). Potrai poi nominare gli admin e invitare i giocatori.
                  </p>
                ) : (
                  <Segmented
                    label="Accesso"
                    small
                    value={step}
                    change={(s) => {
                      setStep(s);
                      submit.reset();
                    }}
                    options={[
                      { id: 'login', label: 'Accedi' },
                      { id: 'register', label: 'Ho un invito' },
                      { id: 'reset', label: 'Password' },
                    ]}
                  />
                )}
                {current === 'login' && (
                  <>
                    <button
                      type="button"
                      className="btn cta"
                      disabled={busy}
                      onClick={() => {
                        submit.reset();
                        passkey.mutate();
                      }}
                    >
                      <Fingerprint aria-hidden="true" />
                      {passkey.isPending ? 'Verifica…' : 'Entra con passkey'}
                    </button>
                    <p className="hint">Oppure con username e password:</p>
                  </>
                )}
                <form className="sheet-form" onSubmit={onSubmit}>
                  <label className="field">
                    Username
                    <input
                      value={username}
                      autoComplete="username"
                      autoCapitalize="none"
                      spellCheck={false}
                      maxLength={24}
                      onChange={(e) => setUsername(e.target.value)}
                    />
                  </label>
                  {current !== 'login' && (
                    <label className="field">
                      {firstRun
                        ? 'Codice di configurazione'
                        : current === 'register'
                          ? 'Codice invito'
                          : 'Codice di reset'}
                      <input
                        value={code}
                        autoComplete="one-time-code"
                        autoCapitalize="characters"
                        spellCheck={false}
                        placeholder={firstRun ? '' : 'XXXX-XXXX-XXXX'}
                        onChange={(e) => setCode(e.target.value)}
                      />
                    </label>
                  )}
                  <label className="field" htmlFor="login-password">
                    {current === 'login' ? 'Password' : 'Nuova password'}
                  </label>
                  <div className="token-row">
                    <input
                      id="login-password"
                      type={visible ? 'text' : 'password'}
                      value={password}
                      autoComplete={current === 'login' ? 'current-password' : 'new-password'}
                      minLength={current === 'login' ? undefined : 8}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                    <button
                      type="button"
                      className="ibtn box"
                      aria-label={visible ? 'Nascondi password' : 'Mostra password'}
                      onClick={() => setVisible(!visible)}
                    >
                      {visible ? <EyeOff /> : <Eye />}
                    </button>
                  </div>
                  {current !== 'login' && <small className="hint">Almeno 8 caratteri.</small>}
                  <button
                    className={current === 'login' ? 'btn' : 'btn cta'}
                    disabled={
                      busy || !username.trim() || !password || (current !== 'login' && !code.trim())
                    }
                  >
                    {submit.isPending
                      ? 'Verifica…'
                      : current === 'login'
                        ? 'Accedi'
                        : current === 'register'
                          ? 'Crea account'
                          : 'Imposta la password'}
                  </button>
                </form>
                {current === 'reset' && (
                  <p className="hint">
                    Hai dimenticato la password? Chiedi a un admin un codice di reset: vale 24 ore.
                  </p>
                )}
                {current === 'register' && !firstRun && (
                  <p className="hint">
                    Il codice invito te lo dà un admin. Se hai già giocato, l’invito collega
                    l’account al tuo storico.
                  </p>
                )}
                <ErrorMessage error={submit.error ?? passkey.error ?? info.error} />
              </section>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
