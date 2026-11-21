import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import { createChromeSecretStore } from '../../background/storage.js';
import { GeminiProvider } from '../../provider/gemini.js';
import { SettingsPanel } from './features/settings/SettingsPanel.js';

export type PanelState =
  | { kind: 'signedOut' }
  | { kind: 'noEntitlement' }
  | { kind: 'accessUnknown'; message?: string }
  | { kind: 'ready'; entitled: true }
  | { kind: 'questionReview' }
  | { kind: 'generating' }
  | { kind: 'answerReview' }
  | { kind: 'error'; message?: string }
  | { kind: 'loading' };

type AppProps = {
  state: PanelState;
  /** Must resolve only after OAuth and entitlement have been checked by trusted code. */
  onSignIn?: () => Promise<unknown>;
  onSignOut?: () => Promise<unknown>;
  onRetry?: () => Promise<unknown>;
};

const STATE_COPY: Record<PanelState['kind'], string> = {
  signedOut: 'Sign in to MARK-1 to continue.',
  noEntitlement: 'Your account has no access yet. Purchase MARK-1 to unlock access.',
  accessUnknown: 'We could not verify your purchase. Access remains blocked.',
  ready: 'Ready. Open an authorized practice page to begin.',
  questionReview: 'Review the captured question before generating an answer.',
  generating: 'Generating an answer...',
  answerReview: 'Answer ready. Review it before you use it.',
  error: 'Something went wrong. Try again.',
  loading: 'Loading your account...',
};

export function App({ state, onSignIn, onSignOut, onRetry }: AppProps): JSX.Element {
  const [current, setCurrent] = useState<PanelState>(state);
  const [accessGranted, setAccessGranted] = useState(state.kind === 'ready' && state.entitled === true);
  const [tabUrl, setTabUrl] = useState<string | null>(null);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [approved, setApproved] = useState(false);
  const secretStore = createChromeSecretStore({
    get: (keys) => chrome.storage.local.get(keys),
    set: (items) => chrome.storage.local.set(items),
    remove: (keys) => chrome.storage.local.remove(keys),
  });
  const provider = new GeminiProvider({ model: 'gemini-2.5-flash', fetch: fetch.bind(globalThis) });

  useEffect(() => {
    setCurrent(state);
    setAccessGranted(state.kind === 'ready' && state.entitled === true);
    void chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
      setTabUrl(tabs[0]?.url ?? null);
    });
    void chrome.runtime.sendMessage({ type: 'GET_STATE' })
      .then((result: unknown) => {
        const next = panelStateFromAuthResponse(result);
        setCurrent(next);
        setAccessGranted(next.kind === 'ready' && next.entitled === true);
      })
      .catch(() => {
        setAccessGranted(false);
        setCurrent({ kind: 'accessUnknown', message: 'Could not verify your account. Access is blocked until verification succeeds.' });
      });
  }, [state]);

  const signIn = async () => {
    setCurrent({ kind: 'loading' });
    try {
      // A successful OAuth response is not proof of purchase. Trusted background
      // code must verify entitlement before the UI can enter the ready state.
      const response = await onSignIn?.();
      const result = panelStateFromAuthResponse(response);
      setCurrent(result);
      setAccessGranted(result.kind === 'ready' && result.entitled === true);
    } catch {
      setAccessGranted(false);
      setCurrent({ kind: 'error', message: 'Sign-in or entitlement verification failed. Access is blocked; try again.' });
    }
  };

  const signOut = async () => {
    setCurrent({ kind: 'loading' });
    try {
      const response = await onSignOut?.();
      const result = panelStateFromAuthResponse(response);
      setCurrent(result);
      setAccessGranted(false);
    } catch {
      setCurrent({ kind: 'error', message: 'Could not confirm sign-out. Close and reopen the panel to refresh account state.' });
    }
  };

  const retry = async () => {
    setCurrent({ kind: 'loading' });
    try {
      const response = await onRetry?.();
      const result = panelStateFromAuthResponse(response);
      setCurrent(result);
      setAccessGranted(result.kind === 'ready' && result.entitled === true);
    } catch {
      setCurrent({ kind: 'error', message: 'Could not verify your account. Access remains blocked.' });
    }
  };

  const capture = async () => {
    if (!tabUrl) return;
    const result = await chrome.runtime.sendMessage({ type: 'CAPTURE_QUESTION', pageUrl: tabUrl });
    if (result?.ok && typeof result.prompt === 'string') {
      setQuestion(result.prompt);
      setCurrent({ kind: 'questionReview' });
    } else {
      setCurrent({ kind: 'error', message: 'No authorized practice adapter is available for this page. Paste the question manually.' });
    }
  };

  const generate = async () => {
    setCurrent({ kind: 'generating' });
    try {
      const generated = await provider.generateWithStore({ store: secretStore, prompt: question, signal: new AbortController().signal });
      setAnswer(generated.answer);
      setApproved(false);
      setCurrent({ kind: 'answerReview' });
    } catch (error) {
      setCurrent({ kind: 'error', message: error instanceof Error ? error.message : 'PROVIDER_UNAVAILABLE' });
    }
  };

  return (
    <main>
      <header>
        <h1>MARK-1</h1>
      </header>
      <p role="status">{STATE_COPY[current.kind]}</p>

      {current.kind === 'signedOut' && (
        <button type="button" onClick={() => void signIn()}>
          Sign in
        </button>
      )}
      {current.kind === 'noEntitlement' && (
        <>
          <p>Your account does not have an active MARK-1 purchase. Access is blocked. Purchase access, then retry verification.</p>
          <button type="button" onClick={() => void retry()}>Retry verification</button>
        </>
      )}
      {current.kind === 'accessUnknown' && (
        <>
          <p>{current.message ?? STATE_COPY.accessUnknown}</p>
          <button type="button" onClick={() => void retry()}>Retry verification</button>
        </>
      )}
      {current.kind === 'ready' && (
        <button type="button" onClick={() => void signOut()}>Sign out</button>
      )}

      {(current.kind === 'ready' || current.kind === 'questionReview') && (
        <section aria-label="Question">
          <button type="button" onClick={() => void capture()}>Capture from current page</button>
          <label>
            Or paste a practice question
            <textarea value={question} onChange={(event) => setQuestion(event.currentTarget.value)} />
          </label>
          <button type="button" disabled={question.trim().length < 12} onClick={() => setCurrent({ kind: 'questionReview' })}>Review question</button>
          {current.kind === 'questionReview' && (
            <>
              <pre>{question}</pre>
              <button type="button" onClick={() => void generate()}>Confirm and generate</button>
            </>
          )}
        </section>
      )}

      {current.kind === 'generating' && <button type="button" onClick={() => setCurrent(accessGranted ? { kind: 'ready', entitled: true } : { kind: 'error', message: 'Access is blocked until entitlement is verified.' })}>Cancel</button>}

      {current.kind === 'answerReview' && (
        <section aria-label="Answer review">
          <pre>{answer}</pre>
          <label>
            <input type="checkbox" checked={approved} onChange={(event) => setApproved(event.currentTarget.checked)} />
            I approve this answer for insertion
          </label>
          <p>This fills the focused editor only. It does not submit your work.</p>
          <button type="button" disabled={!approved} onClick={async () => {
            if (!tabUrl) return;
            const result = await chrome.runtime.sendMessage({ type: 'INSERT_ANSWER', pageUrl: tabUrl, answer });
            setCurrent(result?.ok && accessGranted ? { kind: 'ready', entitled: true } : { kind: 'error', message: 'Access is blocked until entitlement is verified.' });
          }}>Insert into focused editor</button>
        </section>
      )}

      {(current.kind === 'ready' || current.kind === 'signedOut') && (
        <SettingsPanel store={secretStore} provider={provider} />
      )}

      {current.kind === 'error' && (
        <>
          <button type="button" onClick={() => void retry()}>Try again</button>
          <p>{current.message ?? STATE_COPY.error}</p>
        </>
      )}
    </main>
  );
}

/**
 * Only states that trusted background code produced may replace the panel state.
 * Anything malformed, missing, or unexpected is treated as a failure, so the UI
 * never silently upgrades an unverified result into `ready`.
 */
function isVerifiedPanelState(value: unknown): value is PanelState {
  if (!value || typeof value !== 'object' || !('kind' in value)) return false;
  const state = value as { kind?: unknown; entitled?: unknown };
  if (state.kind === 'ready') return state.entitled === true;
  return state.kind === 'signedOut' || state.kind === 'noEntitlement' || state.kind === 'accessUnknown' ||
    state.kind === 'questionReview' || state.kind === 'loading' || state.kind === 'error' ||
    state.kind === 'generating' || state.kind === 'answerReview';
}

function panelStateFromAuthResponse(value: unknown): PanelState {
  if (!value || typeof value !== 'object' || !('ok' in value) || (value as { ok?: unknown }).ok !== true || !('state' in value)) {
    if (value && typeof value === 'object' && 'code' in value && (value as { code?: unknown }).code === 'NOT_SIGNED_IN') {
      return { kind: 'signedOut' };
    }
    return { kind: 'accessUnknown', message: 'Could not verify your account. Access is blocked until verification succeeds.' };
  }
  const state = (value as { state: unknown }).state;
  if (isVerifiedPanelState(state)) return state;
  if (state && typeof state === 'object' && 'kind' in state) {
    const kind = (state as { kind?: unknown }).kind;
    if (kind === 'signedOut') return { kind: 'signedOut' };
    if (kind === 'noEntitlement') return { kind: 'noEntitlement' };
  }
  return { kind: 'accessUnknown', message: 'Could not verify your purchase. Access is blocked.' };
}
