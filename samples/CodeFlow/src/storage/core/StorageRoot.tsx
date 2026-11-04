import type { ReactNode } from 'react';
import { StorageContext } from './context';
import type { StorageProvider } from './types';

export function StorageRoot({ provider, children }: { provider: StorageProvider; children: ReactNode }) {
  return <StorageContext.Provider value={provider}>{children}</StorageContext.Provider>;
}
