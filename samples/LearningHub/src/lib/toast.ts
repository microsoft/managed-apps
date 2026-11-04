import { createContext, useContext } from 'react';

export interface ToastInput {
  message: string;
  tone?: 'neutral' | 'success' | 'error';
  action?: { label: string; onAction: () => void };
}

export type ShowToast = (toast: ToastInput) => void;

export const ToastContext = createContext<ShowToast>(() => {});

export function useToast(): ShowToast {
  return useContext(ToastContext);
}
