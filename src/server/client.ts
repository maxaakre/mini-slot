import { ServerError, type GameApi, type RoundRequest, type RoundResponse } from './protocol';

export interface RetryOptions {
  retries: number;
  backoffMs: number;
}

/**
 * Sends a round and retries network failures with the same request id.
 * Business errors (e.g. insufficient funds) are never retried.
 */
export async function playWithRetry(
  api: GameApi,
  request: RoundRequest,
  { retries, backoffMs }: RetryOptions,
): Promise<RoundResponse> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await api.play(request);
    } catch (error) {
      const retryable = error instanceof ServerError && error.code === 'NETWORK';
      if (!retryable || attempt >= retries) throw error;
      await new Promise((resolve) => setTimeout(resolve, backoffMs * 2 ** attempt));
    }
  }
}

let fallbackCounter = 0;

/**
 * `crypto.randomUUID` only exists in secure contexts (https or localhost).
 * Opening the dev server on a phone via a LAN IP is plain http, so fall back.
 */
export function createRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  fallbackCounter++;
  return `${Date.now().toString(36)}-${fallbackCounter.toString(36)}-${Math.random().toString(36).slice(2)}`;
}
