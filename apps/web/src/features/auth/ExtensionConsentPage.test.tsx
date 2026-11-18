import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ExtensionConsentPage } from './ExtensionConsentPage.js';

afterEach(cleanup);

describe('extension OAuth consent page', () => {
  it('shows the requesting extension, redirect destination, and limited access summary', () => {
    render(
      <ExtensionConsentPage
        clientDisplayName="Study Helper Extension"
        redirectUri="https://extension.example.test/oauth/callback"
        onConsent={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Authorize extension' })).toBeTruthy();
    expect(screen.getByText('Study Helper Extension')).toBeTruthy();
    expect(screen.getByText('https://extension.example.test/oauth/callback')).toBeTruthy();
    expect(screen.getByText(/identity and account access/i)).toBeTruthy();
  });

  it('does not authorize until the customer explicitly clicks authorize', () => {
    const onConsent = vi.fn();
    const onCancel = vi.fn();

    render(
      <ExtensionConsentPage
        clientDisplayName="A browser extension"
        redirectUri="https://extension.example.test/callback"
        onConsent={onConsent}
        onCancel={onCancel}
      />,
    );

    expect(onConsent).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Authorize' }));

    expect(onConsent).toHaveBeenCalledOnce();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('cancels when the customer explicitly declines authorization', () => {
    const onConsent = vi.fn();
    const onCancel = vi.fn();

    render(
      <ExtensionConsentPage
        clientDisplayName="A browser extension"
        redirectUri="https://extension.example.test/callback"
        onConsent={onConsent}
        onCancel={onCancel}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConsent).not.toHaveBeenCalled();
  });
});
