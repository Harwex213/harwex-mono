/**
 * API layer — default interceptors.
 *
 * Demonstrates the three chains: a request interceptor that injects headers,
 * a response interceptor that logs round-trips, and an error interceptor that
 * normalises failures. Call `installDefaultInterceptors()` once at startup.
 */

import { interceptors } from './request';

let installed = false;

export const installDefaultInterceptors = (): void => {
  if (installed) return;
  installed = true;

  interceptors.request.use((config) => {
    config.headers = {
      'Content-Type': 'application/json',
      'X-Client': 'faenwald-battle-prototype',
      ...config.headers,
    };
    // eslint-disable-next-line no-console
    console.debug(`[api] → ${config.method} ${config.url}`);
    return config;
  });

  interceptors.response.use((response) => {
    // eslint-disable-next-line no-console
    console.debug(
      `[api] ← ${response.config.method} ${response.config.url} (${response.status})`,
    );
    return response;
  });

  interceptors.error.use((error) => {
    const message = error instanceof Error ? error.message : String(error);
    // eslint-disable-next-line no-console
    console.error(`[api] ✗ ${message}`);
    return error instanceof Error ? error : new Error(message);
  });
};
