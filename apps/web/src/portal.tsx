import { useCallback, useEffect, useState } from 'react';
import type { AccountLink, Customer, PortalApi } from './api.js';
import { ExtensionConsentPage } from './features/auth/ExtensionConsentPage.js';
import { MailDashboard } from './features/mail/MailDashboard.js';
import { MailCallbackScreen } from './features/mail/MailCallbackScreen.js';

type PortalRoute = { pathname: string; search: string };
type PortalNavigate = (url: string) => void;

type Session =
  | { status: 'loading' }
  | { status: 'anonymous' }
  | { status: 'authenticated'; user: Customer; links: AccountLink[] | null };

type Notice = { tone: 'error' | 'info'; text: string } | null;

/**
 * Customer portal foundation: sign in, create an account, and review linked
 * integrations. Linking itself starts inside the integration's own flow; this
 * portal never collects an external website password or session cookie.
 */
export function CustomerPortal({
  api,
  route,
  navigate,
}: {
  api: PortalApi;
  route?: PortalRoute;
  navigate?: PortalNavigate;
}) {
  const current = route ?? (typeof window === 'undefined'
    ? { pathname: '/', search: '' }
    : { pathname: window.location.pathname, search: window.location.search });
  const [session, setSession] = useState<Session>({ status: 'loading' });
  const [notice, setNotice] = useState<Notice>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [recovering, setRecovering] = useState(false);

  const loadLinks = useCallback(async (user: Customer) => {
    try {
      const { links } = await api.links();
      setSession({ status: 'authenticated', user, links });
    } catch (error) {
      // An outage is not an empty account: show the failure instead of implying no links exist.
      setSession({ status: 'authenticated', user, links: null });
      setNotice({ tone: 'error', text: describe(error, 'Could not load your linked integrations. Try again shortly.') });
    }
  }, [api]);

  useEffect(() => {
    let active = true;
    if (current.pathname === '/verify-email' || current.pathname === '/password/reset') {
      return () => {
        active = false;
      };
    }
    api
      .me()
      .then(({ user }) => {
        if (active) void loadLinks(user);
      })
      .catch(() => {
        if (active) setSession({ status: 'anonymous' });
      });
    return () => {
      active = false;
    };
  }, [api, loadLinks]);

  const signIn = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      const { user } = await api.login(email.trim(), password);
      setEmail('');
      setPassword('');
      await loadLinks(user);
    } catch (error) {
      setNotice({ tone: 'error', text: describe(error, 'Sign in failed. Check your email and password.') });
    } finally {
      setBusy(false);
    }
  };

  const createAccount = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      await api.register(email.trim(), password);
      setPassword('');
      setNotice({ tone: 'info', text: 'Check your email for a verification link, then sign in.' });
    } catch (error) {
      setNotice({ tone: 'error', text: describe(error, 'Could not create the account.') });
    } finally {
      setBusy(false);
    }
  };

  const requestReset = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      await api.requestPasswordReset(email.trim());
      setNotice({ tone: 'info', text: 'If that address has an account, a reset link is on its way.' });
    } catch (error) {
      setNotice({ tone: 'error', text: describe(error, 'Could not request a password reset. Try again.') });
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    setBusy(true);
    setNotice(null);
    try {
      await api.logout();
      setSession({ status: 'anonymous' });
    } catch (error) {
      // The server may still hold the session, so do not pretend the customer signed out.
      setNotice({ tone: 'error', text: describe(error, 'Sign out did not complete. Try again.') });
    } finally {
      setBusy(false);
    }
  };

  return (
    <main>
      <header>
        <h1>MARK-1</h1>
        <p>Customer portal</p>
      </header>

      {current.pathname === '/verify-email' && <VerifyEmailScreen api={api} token={tokenFrom(current.search)} />}
      {current.pathname === '/password/reset' && <ResetPasswordScreen api={api} token={tokenFrom(current.search)} />}
      {current.pathname === '/mail/callback' && (
        <MailCallbackScreen
          api={api}
          search={current.search}
          onFinished={() => {
            if (navigate) navigate('/mail');
            else if (typeof window !== 'undefined') window.location.href = '/mail';
          }}
        />
      )}
      {current.pathname.startsWith('/mail') && current.pathname !== '/mail/callback' && session.status === 'authenticated' && (
        <MailDashboard
          api={api}
          onNavigatePortal={() => {
            if (navigate) navigate('/');
            else if (typeof window !== 'undefined') window.location.href = '/';
          }}
        />
      )}
      {current.pathname === '/oauth/authorize' && session.status === 'authenticated' && (
        <ExtensionConsentScreen api={api} search={current.search} {...(navigate ? { navigate } : {})} />
      )}
      {((current.pathname !== '/oauth/authorize' && !isScreenRoute(current.pathname)) ||
        (current.pathname === '/oauth/authorize' && session.status !== 'authenticated')) && (
        <>
          {session.status === 'loading' && <p role="status">Loading your account…</p>}

          {session.status === 'anonymous' && (
            <section aria-labelledby="account-heading">
              <h2 id="account-heading">Your account</h2>
              {recovering ? (
                <form onSubmit={requestReset} aria-label="Password recovery">
                  <p>Enter your email address and we will send a reset link if an account exists.</p>
                  <label htmlFor="recovery-email">Email</label>
                  <input id="recovery-email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
                  <div className="actions">
                    <button type="submit" disabled={busy}>Send reset link</button>
                    <button type="button" className="link" onClick={() => { setRecovering(false); setNotice(null); }}>Back to sign in</button>
                  </div>
                </form>
              ) : (
                <form onSubmit={(event) => {
                  const action = (event.nativeEvent as SubmitEvent).submitter;
                  if (action instanceof HTMLButtonElement && action.value === 'register') {
                    void createAccount(event);
                  } else {
                    void signIn(event);
                  }
                }} aria-label="Your account">
                  <label htmlFor="email">Email</label>
                  <input id="email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
                  <label htmlFor="password">Password</label>
                  <input id="password" type="password" autoComplete="current-password" required minLength={12} value={password} onChange={(event) => setPassword(event.target.value)} />
                  <div className="actions">
                    <button type="submit" value="login" disabled={busy}>Sign in</button>
                    <button type="submit" value="register" disabled={busy}>Create account</button>
                    <button type="button" className="link" onClick={() => { setRecovering(true); setNotice(null); }}>Forgot password?</button>
                  </div>
                </form>
              )}
            </section>
          )}

          {session.status === 'authenticated' && (
            <section aria-labelledby="account-heading">
              <h2 id="account-heading">Your account</h2>
              <p>{session.user.email}</p>
              <button type="button" onClick={signOut} disabled={busy}>Sign out</button>

              <section aria-labelledby="links-heading">
                <h3 id="links-heading">Linked integrations</h3>
                {session.links === null ? (
                  <p>Linked integrations could not be loaded.</p>
                ) : session.links.length === 0 ? (
                  <p>No integrations are linked to this account.</p>
                ) : (
                  <ul>
                    {session.links.map((link) => (
                      <li key={link.linkId}>{link.integrationId}</li>
                    ))}
                  </ul>
                )}
                <p>
                  Unlinking requires confirming the same external identity again through the integration&apos;s
                  verification flow.
                </p>
              </section>

              <section aria-labelledby="mail-portal-heading">
                <h3 id="mail-portal-heading">MARK-1 MAIL</h3>
                <p>Manage multiple individually authorized Gmail mailboxes and synchronization settings.</p>
                <button
                  type="button"
                  onClick={() => {
                    if (navigate) navigate('/mail');
                    else if (typeof window !== 'undefined') window.location.href = '/mail';
                  }}
                >
                  Open MARK-1 MAIL
                </button>
              </section>
            </section>
          )}

          {notice && (
            <p role={notice.tone === 'error' ? 'alert' : 'status'}>{notice.text}</p>
          )}
        </>
      )}
    </main>
  );
}

function describe(error: unknown, fallback: string): string {
  return error instanceof Error && error.message && error.message !== 'Request failed' ? error.message : fallback;
}

/** Routes that render a single-purpose screen instead of the account view. */
function isScreenRoute(pathname: string): boolean {
  return (
    pathname === '/verify-email' ||
    pathname === '/password/reset' ||
    pathname === '/mail' ||
    pathname === '/mail/callback' ||
    pathname.startsWith('/mail/')
  );
}

function tokenFrom(search: string): string | null {
  return new URLSearchParams(search).get('token') || null;
}

function ExtensionConsentScreen({
  api,
  search,
  navigate,
}: {
  api: PortalApi;
  search: string;
  navigate?: PortalNavigate;
}) {
  const params = new URLSearchParams(search);
  const clientId = params.get('client_id');
  const redirectUri = params.get('redirect_uri');
  const codeChallenge = params.get('code_challenge');
  const state = params.get('state') ?? undefined;
  const [validated, setValidated] = useState<{ clientId: string; redirectUri: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  useEffect(() => {
    let active = true;
    if (!clientId || !redirectUri || !codeChallenge || params.get('response_type') !== 'code' ||
      params.get('code_challenge_method') !== 'S256') {
      setNotice({ tone: 'error', text: 'This authorization request is incomplete or invalid.' });
      return () => { active = false; };
    }
    api.oauthConsentInfo({ clientId, redirectUri, codeChallenge, ...(state === undefined ? {} : { state }) })
      .then((result) => {
        if (active && result.consentRequired && result.clientId === clientId && result.redirectUri === redirectUri) {
          setValidated({ clientId: result.clientId, redirectUri: result.redirectUri });
        } else if (active) {
          setNotice({ tone: 'error', text: 'This authorization request could not be validated.' });
        }
      })
      .catch((error) => {
        if (active) setNotice({ tone: 'error', text: describe(error, 'This authorization request could not be validated.') });
      });
    return () => { active = false; };
  }, [api, clientId, redirectUri, codeChallenge, state]);

  const consent = async () => {
    if (!validated || !codeChallenge) return;
    setBusy(true);
    setNotice(null);
    try {
      const { redirectUrl } = await api.authorizeExtension({
        ...validated,
        codeChallenge,
        ...(state === undefined ? {} : { state }),
      });
      const destination = new URL(redirectUrl);
      if (destination.origin !== new URL(validated.redirectUri).origin ||
          destination.protocol !== new URL(validated.redirectUri).protocol) {
        throw new Error('The authorization response destination was not expected.');
      }
      if (navigate) navigate(destination.toString());
      else window.location.assign(destination.toString());
    } catch (error) {
      setNotice({ tone: 'error', text: describe(error, 'Authorization could not be completed.') });
      setBusy(false);
    }
  };

  if (validated) {
    return (
      <>
        <ExtensionConsentPage
          clientDisplayName="A browser extension"
          redirectUri={validated.redirectUri}
          onConsent={() => { void consent(); }}
          onCancel={() => { if (navigate) navigate('/'); else window.location.assign('/'); }}
        />
        {busy && <p role="status">Completing authorization…</p>}
        {notice && <p role="alert">{notice.text}</p>}
      </>
    );
  }
  return <p role={notice ? 'alert' : 'status'}>{notice?.text ?? 'Validating authorization request…'}</p>;
}

/**
 * Verification is a deliberate click: a link scanner or mail proxy that
 * proxy that prefetches the URL must not consume the single-use token.
 */
function VerifyEmailScreen({ api, token }: { api: PortalApi; token: string | null }) {
  const [busy, setBusy] = useState(false);
  const [verified, setVerified] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  if (!token) {
    return <p role="alert">This verification link is missing its token. Open the link from your email again.</p>;
  }

  const confirm = async () => {
    setBusy(true);
    setNotice(null);
    try {
      await api.verifyEmail(token);
      setVerified(true);
    } catch (error) {
      setNotice({ tone: 'error', text: describe(error, 'That verification link is invalid or has expired.') });
    } finally {
      setBusy(false);
    }
  };

  if (verified) {
    return (
      <section aria-labelledby="verify-heading">
        <h2 id="verify-heading">Email verified</h2>
        <p role="status">Your email address is verified. You can sign in now.</p>
        <a href="/">Sign in</a>
      </section>
    );
  }

  return (
    <section aria-labelledby="verify-heading">
      <h2 id="verify-heading">Verify your email</h2>
      <p>Confirm this address to finish setting up your account.</p>
      <button type="button" onClick={confirm} disabled={busy}>Verify email</button>
      {notice && <p role={notice.tone === 'error' ? 'alert' : 'status'}>{notice.text}</p>}
    </section>
  );
}

function ResetPasswordScreen({ api, token }: { api: PortalApi; token: string | null }) {
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [changed, setChanged] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  if (!token) {
    return <p role="alert">This password reset link is missing its token. Request a new one from the sign-in page.</p>;
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setNotice(null);
    if (newPassword !== confirmation) {
      setNotice({ tone: 'error', text: 'The two passwords do not match.' });
      return;
    }
    setBusy(true);
    try {
      await api.resetPassword(token, newPassword);
      setNewPassword('');
      setConfirmation('');
      setChanged(true);
    } catch (error) {
      setNotice({ tone: 'error', text: describe(error, 'That reset link is invalid or has expired. Request a new one.') });
    } finally {
      setBusy(false);
    }
  };

  if (changed) {
    return (
      <section aria-labelledby="reset-heading">
        <h2 id="reset-heading">Password changed</h2>
        <p role="status">Your password has been changed. Sign in with your new password.</p>
        <a href="/">Sign in</a>
      </section>
    );
  }

  return (
    <section aria-labelledby="reset-heading">
      <h2 id="reset-heading">Choose a new password</h2>
      <form onSubmit={submit} aria-label="Choose a new password">
        <label htmlFor="new-password">New password</label>
        <input id="new-password" type="password" autoComplete="new-password" required minLength={12} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
        <label htmlFor="confirm-password">Confirm new password</label>
        <input id="confirm-password" type="password" autoComplete="new-password" required minLength={12} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
        <div className="actions">
          <button type="submit" disabled={busy}>Set new password</button>
        </div>
      </form>
      {notice && <p role={notice.tone === 'error' ? 'alert' : 'status'}>{notice.text}</p>}
    </section>
  );
}
