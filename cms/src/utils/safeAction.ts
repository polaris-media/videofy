/**
 * Utility for wrapping server actions to return errors as data instead of throwing.
 * This bypasses Next.js error sanitization, making errors visible in the client.
 *
 * Usage:
 *   const result = await safeAction(() => myServerAction(args));
 *   if (!result.ok) {
 *     console.error(result.error); // Full error message visible!
 *   }
 */

export type SafeResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; stack?: string; details?: unknown };

export async function safeAction<T>(fn: () => Promise<T>): Promise<SafeResult<T>> {
  try {
    const data = await fn();
    return { ok: true, data };
  } catch (error) {
    console.error('=== SAFE ACTION ERROR ===');
    console.error('Error:', error);
    console.error('=========================');

    if (error instanceof Error) {
      return {
        ok: false,
        error: error.message,
        stack: error.stack,
        details: 'cause' in error ? error.cause : undefined,
      };
    }

    return {
      ok: false,
      error: String(error),
    };
  }
}

/**
 * Creates a wrapped version of a server action that returns SafeResult
 */
export function wrapAction<TArgs extends unknown[], TReturn>(
  action: (...args: TArgs) => Promise<TReturn>
): (...args: TArgs) => Promise<SafeResult<TReturn>> {
  return async (...args: TArgs) => {
    return safeAction(() => action(...args));
  };
}
