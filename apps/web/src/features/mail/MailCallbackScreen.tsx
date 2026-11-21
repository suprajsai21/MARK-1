import React, { useEffect, useState } from 'react';
import type { PortalApi } from '../../api.js';

interface MailCallbackScreenProps {
  api: PortalApi;
  search: string;
  onFinished: (success: boolean) => void;
}

export function MailCallbackScreen({ api, search, onFinished }: MailCallbackScreenProps) {
  const [status, setStatus] = useState<'processing' | 'success' | 'error'>('processing');
  const [message, setMessage] = useState('Completing Google authorization…');

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams(search);
    const code = params.get('code');
    const state = params.get('state');
    const error = params.get('error');

    if (error) {
      setStatus('error');
      setMessage(
        error === 'access_denied'
          ? 'Google authorization was cancelled or denied. No changes were made.'
          : `Google OAuth error: ${error}`,
      );
      return;
    }

    if (!code || !state) {
      setStatus('error');
      setMessage('Missing authorization code or state parameter in callback URL.');
      return;
    }

    api
      .completeMailOAuth({ code, state })
      .then(({ account }) => {
        if (active) {
          setStatus('success');
          setMessage(`Successfully connected ${account.email}!`);
          setTimeout(() => {
            if (active) onFinished(true);
          }, 1500);
        }
      })
      .catch((err) => {
        if (active) {
          setStatus('error');
          setMessage(err instanceof Error ? err.message : 'Failed to complete authorization');
        }
      });

    return () => {
      active = false;
    };
  }, [api, search, onFinished]);

  return (
    <div className="mail-callback-container">
      <div className={`mail-card mail-callback-card status-${status}`}>
        {status === 'processing' && (
          <>
            <div className="mail-spinner" aria-label="Loading spinner" />
            <h3>Authorizing Gmail Account</h3>
            <p>{message}</p>
          </>
        )}

        {status === 'success' && (
          <>
            <div className="mail-status-icon text-success">✓</div>
            <h3>Account Connected</h3>
            <p>{message}</p>
            <p className="mail-text-muted">Returning to dashboard…</p>
          </>
        )}

        {status === 'error' && (
          <>
            <div className="mail-status-icon text-danger">⚠</div>
            <h3>Connection Failed</h3>
            <p role="alert">{message}</p>
            <button
              type="button"
              className="mail-btn mail-btn-primary"
              onClick={() => onFinished(false)}
            >
              Return to Mail Dashboard
            </button>
          </>
        )}
      </div>
    </div>
  );
}
