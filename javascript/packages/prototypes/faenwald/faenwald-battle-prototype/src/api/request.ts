/**
 * API layer — the `request` function.
 *
 * A tiny axios-style HTTP client with a pluggable transport ("adapter") and
 * request / response / error interceptor chains. The real transport is `fetch`;
 * the mock adapter (see `mock.ts`) swaps it out via `setAdapter` so the whole
 * app can run with canned data and zero backend.
 */

const BASE_URL = 'http://localhost:3000';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

export interface RequestConfig<Body = unknown> {
  url: string;
  method: HttpMethod;
  body?: Body;
  headers: Record<string, string>;
}

export interface ApiResponse<Data = unknown> {
  data: Data;
  status: number;
  config: RequestConfig;
}

export type RequestInterceptor = (
  config: RequestConfig,
) => RequestConfig | Promise<RequestConfig>;

export type ResponseInterceptor = (
  response: ApiResponse,
) => ApiResponse | Promise<ApiResponse>;

export type ErrorInterceptor = (error: unknown) => unknown;

/** The transport that actually performs a request. Replaceable for mocking/tests. */
export type Adapter = (config: RequestConfig) => Promise<ApiResponse>;

class InterceptorManager<Handler> {
  readonly handlers: Handler[] = [];

  /** Register a handler; returns its id so it can later be ejected. */
  use(handler: Handler): number {
    return this.handlers.push(handler) - 1;
  }

  eject(id: number): void {
    delete this.handlers[id];
  }
}

export const interceptors = {
  request: new InterceptorManager<RequestInterceptor>(),
  response: new InterceptorManager<ResponseInterceptor>(),
  error: new InterceptorManager<ErrorInterceptor>(),
};

/** Default transport: real network via fetch. */
const fetchAdapter: Adapter = async (config) => {
  const response = await fetch(`${BASE_URL}${config.url}`, {
    method: config.method,
    headers: config.headers,
    body: config.body === undefined ? undefined : JSON.stringify(config.body),
  });

  if (!response.ok) {
    throw new Error(`Request failed: ${config.method} ${config.url} → ${response.status}`);
  }

  return {
    data: await response.json(),
    status: response.status,
    config,
  };
};

let adapter: Adapter = fetchAdapter;

/** Swap the transport — used by the mock to serve canned data. */
export const setAdapter = (next: Adapter): void => {
  adapter = next;
};

export interface RequestOptions<Body = unknown> {
  url: string;
  method?: HttpMethod;
  body?: Body;
  headers?: Record<string, string>;
}

/**
 * Perform a request, running it through the interceptor pipeline:
 *   request interceptors → adapter → response interceptors
 * Any thrown error is passed through the error interceptors before re-throwing.
 */
export async function request<Data, Body = unknown>(
  options: RequestOptions<Body>,
): Promise<Data> {
  try {
    let config: RequestConfig = {
      method: 'GET',
      headers: {},
      ...options,
    };

    for (const interceptor of interceptors.request.handlers) {
      if (interceptor) config = await interceptor(config);
    }

    let response = await adapter(config);

    for (const interceptor of interceptors.response.handlers) {
      if (interceptor) response = await interceptor(response);
    }

    return response.data as Data;
  } catch (error) {
    let result: unknown = error;
    for (const interceptor of interceptors.error.handlers) {
      if (interceptor) result = interceptor(result);
    }
    throw result;
  }
}
