/** Minimal capture output; raw page content is never persisted by the adapter. */
export type PageCaptureResult = { question: string; code: 'CAPTURE_OK' | string };

export type IntegrationReadiness = {
  linkMethodVerified: boolean;
  stagingAccessVerified: boolean;
  approvedWorkflowIds: readonly string[];
  allowedActions: readonly ('capture' | 'insert' | 'select' | 'submit')[];
  /** Pointer to secure, access-controlled evidence; never credentials or page content. */
  evidenceReference: string;
};

export type PlatformAdapter = {
  id: string;
  origin: string;
  mode: 'capture' | 'manual';
  pageCapture: () => PageCaptureResult | null;
  pageInsert: (text: string) => boolean;
  /** Missing or incomplete readiness keeps the adapter disabled. */
  readiness?: IntegrationReadiness;
};

export type AdapterRegistry = { adapters: readonly PlatformAdapter[] };
