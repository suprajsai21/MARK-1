type ExtensionConsentPageProps = {
  clientDisplayName: string;
  redirectUri: string;
  onConsent: () => void;
  onCancel: () => void;
};

/** A deliberately generic consent prompt for an OAuth client extension. */
export function ExtensionConsentPage({
  clientDisplayName,
  redirectUri,
  onConsent,
  onCancel,
}: ExtensionConsentPageProps) {
  return (
    <main>
      <header>
        <h1>MARK-1</h1>
        <p>Secure account authorization</p>
      </header>

      <section aria-labelledby="extension-consent-heading">
        <h2 id="extension-consent-heading">Authorize extension</h2>
        <p>
          <strong>{clientDisplayName}</strong> is requesting access to your MARK-1 identity and account.
        </p>
        <p>
          If you continue, you will grant sign-in identity and basic account access to this extension. No other
          permissions are requested.
        </p>
        <dl>
          <div>
            <dt>Return destination</dt>
            <dd><code>{redirectUri}</code></dd>
          </div>
          <div>
            <dt>Access requested</dt>
            <dd>Identity and account access</dd>
          </div>
        </dl>
        <div className="actions">
          <button type="button" onClick={onConsent}>Authorize</button>
          <button type="button" className="link" onClick={onCancel}>Cancel</button>
        </div>
      </section>
    </main>
  );
}
