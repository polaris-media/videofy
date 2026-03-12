'use client';

import { type FC, useEffect, useState } from 'react';

interface Props {
  error: Error & { digest?: string; cause?: unknown };
  reset: () => void;
}

const ErrorComponent: FC<Props> = ({ error, reset }) => {
  const [showDetails, setShowDetails] = useState(true);

  useEffect(() => {
    // Log full error details to console for debugging
    console.error('=== CLIENT ERROR BOUNDARY ===');
    console.error('Error:', error);
    console.error('Message:', error.message);
    console.error('Digest:', error.digest);
    console.error('Cause:', error.cause);
    console.error('Stack:', error.stack);
    console.error('Name:', error.name);
    console.error('All properties:', Object.getOwnPropertyNames(error).reduce((acc, key) => {
      acc[key] = (error as unknown as Record<string, unknown>)[key];
      return acc;
    }, {} as Record<string, unknown>));
    console.error('=============================');
  }, [error]);

  // Extract as much info as possible from the error
  const errorMessage = error?.message || 'Unknown error';
  const errorDigest = error?.digest || 'No digest available';
  const errorStack = error?.stack || '';
  const errorCause = error?.cause ? JSON.stringify(error.cause, null, 2) : null;

  return (
    <main className="min-h-screen w-full p-4 dark:bg-gray-900 lg:p-8">
      <div className="flex min-h-[75dvh] w-full flex-col items-center justify-center text-center text-white">
        <h1 className="font-bold text-3xl text-red-400">An error occurred!</h1>

        <div className="mt-4 flex gap-2">
          <button
            onClick={reset}
            className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
          >
            Try Again
          </button>
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="rounded bg-gray-600 px-4 py-2 text-white hover:bg-gray-700"
          >
            {showDetails ? 'Hide' : 'Show'} Details
          </button>
        </div>

        {showDetails && (
          <div className="mt-6 w-full max-w-4xl text-left">
            <div className="rounded bg-gray-800 p-4">
              <h2 className="font-bold text-lg text-yellow-400">Error Details</h2>

              <div className="mt-2">
                <span className="text-gray-400">Digest: </span>
                <code className="text-green-400">{errorDigest}</code>
              </div>

              <div className="mt-2">
                <span className="text-gray-400">Message: </span>
                <code className="text-red-300">{errorMessage}</code>
              </div>

              {errorCause && (
                <div className="mt-2">
                  <span className="text-gray-400">Cause: </span>
                  <pre className="mt-1 overflow-auto rounded bg-gray-900 p-2 text-xs text-orange-300">
                    {errorCause}
                  </pre>
                </div>
              )}

              {errorStack && (
                <div className="mt-2">
                  <span className="text-gray-400">Stack trace: </span>
                  <pre className="mt-1 overflow-auto rounded bg-gray-900 p-2 text-xs text-gray-300 max-h-64">
                    {errorStack}
                  </pre>
                </div>
              )}

              <p className="mt-4 text-sm text-gray-500">
                Check the server logs for the full error details (search for digest: {errorDigest})
              </p>
            </div>
          </div>
        )}
      </div>
    </main>
  );
};

export default ErrorComponent;
