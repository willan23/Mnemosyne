/** Optional error reporting. Only structural error metadata may leave the client. */
import type { ErrorEvent } from '@sentry/react';

export function sanitizeSentryEvent(event: ErrorEvent): ErrorEvent {
  // An allowlist avoids missing new SDK fields that might carry vault content.
  return {
    type: undefined,
    event_id: event.event_id,
    timestamp: event.timestamp,
    level: event.level,
    platform: event.platform,
    release: event.release,
    environment: event.environment,
    exception: event.exception ? {
      values: event.exception.values?.map((value) => ({
        type: value.type?.replace(/[^A-Za-z0-9_.]/g, '').slice(0, 80) || 'Error',
      })),
    } : undefined,
  };
}

export async function initSentryIfConfigured(): Promise<boolean> {
  const dsn = (import.meta.env.VITE_SENTRY_DSN || '').toString().trim();
  if (!dsn || typeof window === 'undefined') return false;

  try {
    const Sentry = await import('@sentry/react');
    Sentry.init({
      dsn,
      environment: import.meta.env.MODE,
      release: import.meta.env.VITE_APP_VERSION || undefined,
      sendDefaultPii: false,
      tracesSampleRate: 0,
      beforeBreadcrumb: () => null,
      beforeSend: sanitizeSentryEvent,
    });
    return true;
  } catch {
    return false;
  }
}
