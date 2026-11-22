import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import { createChromeSecretStore } from '../../background/storage.js';
import { GeminiProvider } from '../../provider/gemini.js';
import { SettingsPanel } from './features/settings/SettingsPanel.js';
import { normalizeCapturedPrompt } from './capture-response.js';
import { parseAnswer } from '../../platform/answer-parser.js';

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
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedNotes, setCopiedNotes] = useState(false);
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
    const prompt = normalizeCapturedPrompt(result);
    if (prompt) {
      setQuestion(prompt);
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
    <main className="sidepanel">
      <header className="topbar">
        <div className="brand" aria-label="MARK-1 Learning Assistant">
          <span className="brand-mark" aria-hidden="true">M</span>
          <span><span className="brand-name">MARK-1</span><span className="brand-sub">Learning assistant</span></span>
        </div>
      </header>
      <div className="panel-content">
        <section className="hero" aria-labelledby="hero-title">
          <p className="eyebrow">Your study space</p>
          <h2 id="hero-title">Learn by working it through.</h2>
          <p>Capture a practice question, think it through, then review your answer.</p>
        </section>
        <div className={`status${current.kind === 'error' ? ' error' : ''}`} role={current.kind === 'error' ? 'alert' : 'status'} aria-live={current.kind === 'error' ? 'assertive' : 'polite'}>
          <span className="state-pill"><span className="state-dot" aria-hidden="true" />{current.kind === 'ready' ? 'Access verified' : current.kind === 'loading' ? 'Checking access' : current.kind === 'error' ? 'Needs attention' : 'Study space'}</span>
          <p>{current.kind === 'error' ? current.message ?? STATE_COPY.error : STATE_COPY[current.kind]}</p>
        </div>

      {current.kind === 'signedOut' && (
        <section className="card" aria-labelledby="signin-heading">
          <p className="eyebrow">Start here</p>
          <h3 id="signin-heading" className="card-title">Sign in to MARK-1</h3>
          <p className="helper">Your purchase is verified securely before study tools unlock.</p>
          <button className="action" type="button" onClick={() => void signIn()}>Continue to sign in</button>
        </section>
      )}
      {current.kind === 'noEntitlement' && (
        <section className="card" aria-labelledby="entitlement-heading">
          <p className="eyebrow">Access needed</p>
          <h3 id="entitlement-heading" className="card-title">Your study tools are locked</h3>
          <p className="helper">Connect an active MARK-1 purchase, then check access again.</p>
          <button className="action secondary" type="button" onClick={() => void retry()}>Check access</button>
        </section>
      )}
      {current.kind === 'accessUnknown' && (
        <section className="card" aria-labelledby="verify-heading">
          <p className="eyebrow">Verification paused</p>
          <h3 id="verify-heading" className="card-title">We couldn’t confirm access</h3>
          <p className="helper">{current.message ?? STATE_COPY.accessUnknown}</p>
          <button className="action secondary" type="button" onClick={() => void retry()}>Try verification again</button>
        </section>
      )}
      {current.kind === 'ready' && (
        <>
          <section className="capture-card" aria-labelledby="capture-heading">
            <div className="capture-icon" aria-hidden="true">✳</div>
            <div>
              <p className="eyebrow">Practice mode</p>
              <h3 id="capture-heading" className="card-title">Bring a question into focus</h3>
              <p className="helper">Capture a supported practice prompt, or paste one yourself.</p>
            </div>
            <button className="action capture-action" type="button" onClick={() => void capture()}>
              <span aria-hidden="true">⌕</span> Capture from current page
            </button>
          </section>
          <section className="card" aria-labelledby="question-input-heading">
            <p className="eyebrow">Or use your own prompt</p>
            <h3 id="question-input-heading" className="card-title">Question input</h3>
            <label className="field-label" htmlFor="question-input">Your question</label>
            <textarea id="question-input" className="question-field" value={question} onChange={(event) => setQuestion(event.currentTarget.value)} placeholder="Paste a practice question here…" />
            <div className="button-row">
              <button className="action secondary" type="button" onClick={() => setQuestion('')} disabled={!question}>Clear</button>
              <button className="action" type="button" disabled={!question.trim()} onClick={() => setCurrent({ kind: 'questionReview' })}>Review question</button>
            </div>
          </section>
          <details className="settings-surface">
            <summary>Settings · Gemini and privacy</summary>
            <SettingsPanel store={secretStore} provider={provider} />
          </details>
          <button className="text-button" type="button" onClick={() => void signOut()}>Sign out</button>
        </>
      )}

      {current.kind === 'questionReview' && (
        <section className="card" aria-labelledby="question-review-heading">
          <p className="eyebrow">Step 1 · Check your prompt</p>
          <h3 id="question-review-heading" className="card-title">Question review</h3>
          <label className="field-label" htmlFor="question-review">Edit before continuing</label>
          <textarea id="question-review" className="question-field" value={question} onChange={(event) => setQuestion(event.currentTarget.value)} />
          <div className="button-row">
            <button className="action secondary" type="button" onClick={() => setCurrent({ kind: 'ready', entitled: true })}>Back</button>
            <button className="action" type="button" disabled={question.trim().length < 12} onClick={() => void generate()}>Confirm and generate</button>
          </div>
          <p className="helper">MARK-1 never submits your work.</p>
        </section>
      )}

      {current.kind === 'generating' && (
        <section className="card" role="status" aria-live="polite">
          <p className="eyebrow">Working through it</p>
          <h3 className="card-title">Thinking, one step at a time</h3>
          <p className="helper">Your question is sent only when you ask MARK-1 to generate.</p>
          <div className="button-row"><button className="action secondary" type="button" onClick={() => setCurrent(accessGranted ? { kind: 'ready', entitled: true } : { kind: 'error', message: 'Access is blocked until entitlement is verified.' })}>Cancel</button></div>
        </section>
      )}

      {current.kind === 'answerReview' && (() => {
        const parsed = parseAnswer(answer);
        const codeToInsert = parsed.code || answer;
        return (
          <section className="card" aria-labelledby="answer-review-heading">
            <p className="eyebrow">Step 2 · Your review</p>
            <div className="title-row">
              <h3 id="answer-review-heading" className="card-title">A draft to think through</h3>
              {parsed.hasCodeBlock && <span className="lang-pill">{parsed.language}</span>}
            </div>

            {parsed.hasCodeBlock ? (
              <>
                <div className="code-box">
                  <div className="box-header">
                    <span className="box-title">Solution Code</span>
                    <button
                      type="button"
                      className="copy-pill"
                      onClick={() => {
                        void navigator.clipboard?.writeText(codeToInsert);
                        setCopiedCode(true);
                        setTimeout(() => setCopiedCode(false), 2000);
                      }}
                    >
                      {copiedCode ? '✓ Copied' : '📋 Copy code'}
                    </button>
                  </div>
                  <pre className="answer-field code-text">{codeToInsert}</pre>
                </div>
                {parsed.explanation && (
                  <div className="notes-box">
                    <div className="box-header">
                      <span className="box-title">Approach & Walkthrough</span>
                      <button
                        type="button"
                        className="copy-pill"
                        onClick={() => {
                          void navigator.clipboard?.writeText(parsed.explanation);
                          setCopiedNotes(true);
                          setTimeout(() => setCopiedNotes(false), 2000);
                        }}
                      >
                        {copiedNotes ? '✓ Copied' : '📋 Copy notes'}
                      </button>
                    </div>
                    <pre className="answer-field">{parsed.explanation}</pre>
                  </div>
                )}
              </>
            ) : (
              <pre className="answer-field">{answer}</pre>
            )}

            <label className="approval-row">
              <input type="checkbox" checked={approved} onChange={(event) => setApproved(event.currentTarget.checked)} />
              <span>I reviewed this answer and approve inserting it into the focused editor.</span>
            </label>
            <p className="helper">This only fills the editor you’re focused on. It does not submit or finish your work.</p>
            <div className="button-row">
              <button className="action secondary" type="button" onClick={() => setCurrent({ kind: 'questionReview' })}>Back</button>
              <button
                className="action"
                type="button"
                disabled={!approved}
                onClick={async () => {
                  let inserted = false;
                  if (tabUrl) {
                    try {
                      const result = await chrome.runtime.sendMessage({
                        type: 'INSERT_ANSWER',
                        pageUrl: tabUrl,
                        answer: codeToInsert,
                      });
                      inserted = Boolean(result?.ok);
                    } catch {
                      inserted = false;
                    }
                  }
                  if (inserted && accessGranted) {
                    setCurrent({ kind: 'ready', entitled: true });
                  } else {
                    try {
                      await navigator.clipboard?.writeText(codeToInsert);
                    } catch {
                      // Clipboard fallback ignore
                    }
                    setCurrent({
                      kind: 'error',
                      message: 'Could not auto-insert into editor. We copied the code to your clipboard so you can paste it directly!',
                    });
                  }
                }}
              >
                Insert into editor
              </button>
            </div>
          </section>
        );
      })()}

      {current.kind === 'error' && (
        <section className="card" aria-labelledby="retry-heading">
          <p className="eyebrow">Next step</p>
          <h3 className="card-title" id="retry-heading">Try your last action again</h3>
          <div className="button-row">
            <button className="action secondary" type="button" onClick={() => void retry()}>Try again</button>
            <button className="action" type="button" onClick={() => setCurrent({ kind: 'ready', entitled: true })}>Open study space</button>
          </div>
        </section>
      )}
      </div>
      <footer className="footer">
        <span>Private by default</span>
        <span>Manual review required</span>
      </footer>
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
