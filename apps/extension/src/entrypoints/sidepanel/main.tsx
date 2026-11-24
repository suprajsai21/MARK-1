import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { browser } from 'wxt/browser';
import { App, type PanelState } from './App.js';
import './sidepanel.css';

async function requestPanelState(type: 'GET_STATE' | 'SIGN_IN' | 'SIGN_OUT'): Promise<unknown> {
  try { return await browser.runtime.sendMessage({ type }); }
  catch { return { ok: false, code: 'BACKGROUND_UNAVAILABLE' }; }
}

function SidepanelRoot() {
  const [state, setState] = useState<PanelState>({ kind: 'accessUnknown', message: 'Could not verify your purchase. Access remains blocked.' });
  useEffect(() => {
    void requestPanelState('GET_STATE').then((response) => {
      if (response && typeof response === 'object' && 'state' in response) setState((response as { state: PanelState }).state);
    });
  }, []);
  return <App state={state} onSignIn={() => requestPanelState('SIGN_IN')} onSignOut={() => requestPanelState('SIGN_OUT')} onRetry={() => requestPanelState('GET_STATE')} />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SidepanelRoot />
  </StrictMode>,
);
