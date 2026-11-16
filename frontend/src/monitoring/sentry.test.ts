import { describe, expect, it } from 'vitest';
import type { ErrorEvent } from '@sentry/react';
import { sanitizeSentryEvent } from './sentry';

describe('Sentry privacy boundary', () => {
  it('removes synthetic vault content from every common event surface', () => {
    const secret = 'synthetic private memory value';
    const event = {
      event_id: 'sample-event',
      message: secret,
      exception: { values: [{ type: 'TypeError', value: secret, stacktrace: { frames: [{ filename: secret }] } }] },
      breadcrumbs: [{ message: secret, data: { input: secret } }],
      request: { url: `https://example.test/?q=${encodeURIComponent(secret)}`, headers: { Authorization: secret }, data: secret },
      user: { email: secret },
      extra: { text: secret },
      contexts: { vault: { mnemonic: secret } },
      tags: { prompt: secret },
      fingerprint: [secret],
    } as unknown as ErrorEvent;
    const clean = sanitizeSentryEvent(event);
    const serialized = JSON.stringify(clean);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain('synthetic%20private');
    expect(clean.exception?.values?.[0]?.type).toBe('TypeError');
    expect(clean.message).toBeUndefined();
    expect(clean.request).toBeUndefined();
  });
});
