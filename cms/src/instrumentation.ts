// Server-side error capture for better debugging in production
// This file is automatically loaded by Next.js

export async function register() {
  // Only run on the server
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    if (process.env.MINIMAL_PREWARM_REMOTION_BUNDLE !== 'false') {
      const { prewarmRemotionBundle } = await import("@/lib/remotionRender");
      prewarmRemotionBundle();
    }

    // Log unhandled rejections with full details
    process.on('unhandledRejection', (reason, promise) => {
      console.error('=== UNHANDLED REJECTION ===');
      console.error('Reason:', reason);
      console.error('Promise:', promise);
      if (reason instanceof Error) {
        console.error('Stack:', reason.stack);
      }
      console.error('===========================');
    });

    // Log uncaught exceptions
    process.on('uncaughtException', (error) => {
      console.error('=== UNCAUGHT EXCEPTION ===');
      console.error('Error:', error.message);
      console.error('Stack:', error.stack);
      console.error('==========================');
    });
  }
}

// This function is called when a Server Component or Route Handler throws
export function onRequestError(
  error: { digest: string } & Error,
  request: {
    path: string;
    method: string;
    headers: Record<string, string>;
  },
  context: {
    routerKind: 'Pages Router' | 'App Router';
    routePath: string;
    routeType: 'render' | 'route' | 'action' | 'middleware';
    renderSource: 'react-server-components' | 'react-server-components-payload' | 'server-rendering';
    revalidateReason: 'on-demand' | 'stale' | undefined;
    renderType: 'dynamic' | 'dynamic-resume' | undefined;
  }
) {
  console.error('=== SERVER ERROR ===');
  console.error('Digest:', error.digest);
  console.error('Message:', error.message);
  console.error('Path:', request.path);
  console.error('Method:', request.method);
  console.error('Route:', context.routePath);
  console.error('Type:', context.routeType);
  console.error('Source:', context.renderSource);
  console.error('Stack:', error.stack);
  console.error('====================');
}
