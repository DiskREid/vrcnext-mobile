import { registerPlugin } from '@capacitor/core';
import { isNative } from './native';
export interface StartupReport {
  text: string;
  hasPreviousCrash: boolean;
}
export const diagnostics = registerPlugin<{
  getReport(): Promise<StartupReport>;
  copyReport(): Promise<void>;
  clearReport(): Promise<void>;
  recordWebFailure(options: {
    kind: 'render' | 'runtime' | 'rejection';
    name: string;
  }): Promise<void>;
}>('AppDiagnostics');
const safeNames = new Set([
  'Error',
  'TypeError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'URIError',
  'EvalError',
]);
export function recordWebFailure(kind: 'render' | 'runtime' | 'rejection', error: unknown) {
  if (!isNative) return;
  const name = error instanceof Error && safeNames.has(error.name) ? error.name : 'Unknown';
  void diagnostics.recordWebFailure({ kind, name }).catch(() => {});
}
