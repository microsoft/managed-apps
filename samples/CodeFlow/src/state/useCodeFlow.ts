import { useContext, useMemo } from 'react';
import { CodeFlowContext, type CodeFlowContextValue } from './codeFlowContext';
import type { CommentThread } from '../types';

export function useCodeFlow(): CodeFlowContextValue {
  const ctx = useContext(CodeFlowContext);
  if (!ctx) throw new Error('useCodeFlow must be used within CodeFlowProvider');
  return ctx;
}

/** Convenience: threads anchored to a specific file. */
export function useFileThreads(filename: string | undefined): CommentThread[] {
  const { threads } = useCodeFlow();
  return useMemo(
    () => (filename ? threads.filter((t) => t.filename === filename) : []),
    [threads, filename],
  );
}
