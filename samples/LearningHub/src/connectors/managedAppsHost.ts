import { getContext } from '@microsoft/managed-apps/app';
import type { AppHost } from './host';

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        window.clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/** Host adapter backed by the `@microsoft/managed-apps` SDK (the SDK caches the context). */
export const managedAppsHost: AppHost = {
  async getAppId() {
    const context = await withTimeout(getContext(), 8000, 'The app host didn’t respond.');
    return context.app.appId;
  },
};
