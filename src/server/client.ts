import { ServerError, type RoundRequest, type RoundResponse } from './mockServer';

export interface GameApi {
  play(request: RoundRequest): Promise<RoundResponse>;
}

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

export function createRequestId(): string {
  return crypto.randomUUID();
}
