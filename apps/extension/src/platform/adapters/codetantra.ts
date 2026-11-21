import type { PlatformAdapter } from '../types.js';

/** CodeTantra's generic integration remains disabled pending verified discovery evidence. */
export function createCodeTantraAdapter(origin: string): PlatformAdapter {
  return {
    id: 'codetantra',
    origin,
    mode: 'manual',
    pageCapture: () => null,
    pageInsert: () => false,
  };
}
