import { afterEach, describe, expect, it, vi } from 'vitest';
import axios, { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';

function response(
  config: InternalAxiosRequestConfig,
  status: number,
  data: unknown,
): AxiosResponse {
  return {
    data,
    status,
    statusText: String(status),
    headers: {},
    config,
  };
}

function failure(
  config: InternalAxiosRequestConfig,
  status: number,
  data: unknown = { message: 'Request failed' },
): AxiosError {
  return new AxiosError(
    'Request failed',
    'ERR_BAD_REQUEST',
    config,
    undefined,
    response(config, status, data),
  );
}

async function loadClient() {
  vi.resetModules();
  const authTokenModule = await import('../utils/authToken');
  const clientModule = await import('./client');
  const envModule = await import('../config/env');

  return {
    ...clientModule,
    ...authTokenModule,
    apiBaseUrl: envModule.apiBaseUrl,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  axios.defaults.adapter = undefined;
});

describe('auth interceptor', () => {
  it('refreshes once, retries the request, and updates the Authorization header', async () => {
    const { apiClient, authToken, AUTH_TOKEN_REFRESHED_EVENT, apiBaseUrl } = await loadClient();
    authToken.setToken('old-token');

    const protectedHeaders: string[] = [];
    let protectedCalls = 0;
    apiClient.defaults.adapter = async (config) => {
      if (config.url?.endsWith('/protected')) {
        protectedCalls += 1;
        protectedHeaders.push(String(config.headers?.Authorization ?? ''));
        if (protectedCalls === 1) throw failure(config, 401);
        return response(config, 200, { ok: true });
      }
      throw new Error(`Unexpected request: ${config.url}`);
    };

    let refreshCalls = 0;
    let logoutCalls = 0;
    axios.defaults.adapter = async (config) => {
      if (config.url === `${apiBaseUrl}/auth/refresh`) {
        refreshCalls += 1;
        return response(config, 200, { token: 'new-token' });
      }
      if (config.url === `${apiBaseUrl}/auth/logout`) {
        logoutCalls += 1;
        return response(config, 200, {});
      }
      throw new Error(`Unexpected bare request: ${config.url}`);
    };

    const refreshed = vi.fn();
    window.addEventListener(AUTH_TOKEN_REFRESHED_EVENT, refreshed);

    const result = await apiClient.get('/protected');

    expect(result.data).toEqual({ ok: true });
    expect(refreshCalls).toBe(1);
    expect(logoutCalls).toBe(0);
    expect(authToken.getToken()).toBe('new-token');
    expect(protectedHeaders).toEqual(['Bearer old-token', 'Bearer new-token']);
    expect(refreshed).toHaveBeenCalledTimes(1);

    window.removeEventListener(AUTH_TOKEN_REFRESHED_EVENT, refreshed);
  });

  it('shares a single refresh request between concurrent 401 responses', async () => {
    const { authToken, apiBaseUrl } = await loadClient();
    const { apiClient } = await import('./client');
    authToken.setToken('old-token');

    let protectedCalls = 0;
    apiClient.defaults.adapter = async (config) => {
      if (config.url?.endsWith('/protected')) {
        protectedCalls += 1;
        if (protectedCalls <= 2) throw failure(config, 401);
        return response(config, 200, { ok: true });
      }
      throw new Error(`Unexpected request: ${config.url}`);
    };

    let refreshCalls = 0;
    axios.defaults.adapter = async (config) => {
      if (config.url === `${apiBaseUrl}/auth/refresh`) {
        refreshCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return response(config, 200, { token: 'new-token' });
      }
      throw new Error(`Unexpected bare request: ${config.url}`);
    };

    const [first, second] = await Promise.all([
      apiClient.get('/protected'),
      apiClient.get('/protected'),
    ]);

    expect(first.data).toEqual({ ok: true });
    expect(second.data).toEqual({ ok: true });
    expect(refreshCalls).toBe(1);
    expect(authToken.getToken()).toBe('new-token');
  });

  it('keeps the session intact after a transient refresh failure', async () => {
    const { authToken, AUTH_SESSION_EXPIRED_EVENT, apiBaseUrl } = await loadClient();
    const { apiClient } = await import('./client');
    authToken.setToken('old-token');

    apiClient.defaults.adapter = async (config) => {
      if (config.url?.endsWith('/protected')) throw failure(config, 401);
      throw new Error(`Unexpected request: ${config.url}`);
    };

    axios.defaults.adapter = async (config) => {
      if (config.url === `${apiBaseUrl}/auth/refresh`) {
        throw failure(config, 500, { message: 'Refresh service unavailable' });
      }
      throw new Error(`Unexpected bare request: ${config.url}`);
    };

    const expired = vi.fn();
    window.addEventListener(AUTH_SESSION_EXPIRED_EVENT, expired);

    await expect(apiClient.get('/protected')).rejects.toBeTruthy();

    expect(authToken.getToken()).toBe('old-token');
    expect(expired).not.toHaveBeenCalled();

    window.removeEventListener(AUTH_SESSION_EXPIRED_EVENT, expired);
  });

  it('clears the session and emits an expiry event for terminal refresh failures', async () => {
    const { authToken, AUTH_SESSION_EXPIRED_EVENT, apiBaseUrl } = await loadClient();
    const { apiClient } = await import('./client');
    authToken.setToken('old-token');

    apiClient.defaults.adapter = async (config) => {
      if (config.url?.endsWith('/protected')) throw failure(config, 401);
      throw new Error(`Unexpected request: ${config.url}`);
    };

    let logoutCalls = 0;
    axios.defaults.adapter = async (config) => {
      if (config.url === `${apiBaseUrl}/auth/refresh`) {
        throw failure(config, 401, { message: 'Refresh token revoked' });
      }
      if (config.url === `${apiBaseUrl}/auth/logout`) {
        logoutCalls += 1;
        return response(config, 200, {});
      }
      throw new Error(`Unexpected bare request: ${config.url}`);
    };

    const expired = vi.fn();
    window.addEventListener(AUTH_SESSION_EXPIRED_EVENT, expired);

    await expect(apiClient.get('/protected')).rejects.toBeTruthy();

    expect(authToken.getToken()).toBeNull();
    expect(expired).toHaveBeenCalledTimes(1);
    expect(logoutCalls).toBe(1);

    window.removeEventListener(AUTH_SESSION_EXPIRED_EVENT, expired);
  });

  it('does not attempt a refresh for auth handshake endpoints', async () => {
    const { authToken, apiBaseUrl } = await loadClient();
    const { apiClient } = await import('./client');
    authToken.setToken('old-token');

    apiClient.defaults.adapter = async (config) => {
      if (config.url?.endsWith('/auth/login')) throw failure(config, 401);
      throw new Error(`Unexpected request: ${config.url}`);
    };

    let refreshCalls = 0;
    axios.defaults.adapter = async (config) => {
      if (config.url === `${apiBaseUrl}/auth/refresh`) {
        refreshCalls += 1;
        return response(config, 200, { token: 'new-token' });
      }
      throw new Error(`Unexpected bare request: ${config.url}`);
    };

    await expect(apiClient.post('/auth/login', {})).rejects.toBeTruthy();
    expect(refreshCalls).toBe(0);
  });

  it('does not refresh after an explicit logout marker is present', async () => {
    const { authToken, LOGGED_OUT_STORAGE_KEY, apiBaseUrl } = await loadClient();
    const { apiClient } = await import('./client');
    authToken.setToken('old-token');
    window.localStorage.setItem(LOGGED_OUT_STORAGE_KEY, '1');

    apiClient.defaults.adapter = async (config) => {
      if (config.url?.endsWith('/protected')) throw failure(config, 401);
      throw new Error(`Unexpected request: ${config.url}`);
    };

    let refreshCalls = 0;
    axios.defaults.adapter = async (config) => {
      if (config.url === `${apiBaseUrl}/auth/refresh`) {
        refreshCalls += 1;
        return response(config, 200, { token: 'new-token' });
      }
      throw new Error(`Unexpected bare request: ${config.url}`);
    };

    await expect(apiClient.get('/protected')).rejects.toBeTruthy();
    expect(refreshCalls).toBe(0);
  });
});
