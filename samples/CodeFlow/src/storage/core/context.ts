import { createContext } from 'react';
import type { StorageProvider } from './types';

export const StorageContext = createContext<StorageProvider | null>(null);
