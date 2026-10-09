import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWaypointSession, isWaypointAuthenticated, isWaypointConfigured, verifyWaypointPassword, waypointOriginAllowed, SESSION_SECONDS } from '../../lib/waypoint/auth';
import { readSmallJson, waypointBackendUrl } from '../../lib/waypoint/backend';

beforeEach(() => {
  vi.stubEnv('WAYPOINT_PASSWORD', 'test-only-password-not-a-real-secret');
  vi.stubEnv('WAYPOINT_SESSION_SECRET', 'test-only-session-secret-long-enough-for-validation');
  vi.stubEnv('WAYPOINT_BACKEND_URL', 'https://waypoint-test.example');
  vi.stubEnv('WAYPOINT_SERVICE_TOKEN', 'test-only-service-token-long-enough-for-validation');
});
afterEach(() => vi.unstubAllEnvs());

describe('private Waypoint sessions', () => {
  it('authenticates a signed session only within its lifetime', () => {
    const now = 1800000000000;
    const token = createWaypointSession(now);
    expect(isWaypointAuthenticated(token, now + 1000)).toBe(true);
    expect(isWaypointAuthenticated(token, now - 1_000)).toBe(false);
    expect(isWaypointAuthenticated(token, now + SESSION_SECONDS * 1000)).toBe(false);
    expect(isWaypointAuthenticated(token + '.extra', now)).toBe(false);
    expect(isWaypointAuthenticated(token.slice(0, -2) + 'xx', now)).toBe(false);
    const [payload, signature] = token.split('.');
    const changed = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), expires: 9999999999 })).toString('base64url');
    expect(isWaypointAuthenticated(`${changed}.${signature}`, now)).toBe(false);
  });

  it('invalidates sessions when the password changes and fails closed without configuration', () => {
    const token = createWaypointSession();
    expect(verifyWaypointPassword('test-only-password-not-a-real-secret')).toBe(true);
    expect(verifyWaypointPassword('wrong')).toBe(false);
    expect(verifyWaypointPassword({ password: 'test' })).toBe(false);
    vi.stubEnv('WAYPOINT_PASSWORD', 'another-test-only-password');
    expect(isWaypointAuthenticated(token)).toBe(false);
    vi.stubEnv('WAYPOINT_SESSION_SECRET', '');
    expect(isWaypointConfigured()).toBe(false);
    expect(isWaypointAuthenticated(token)).toBe(false);
  });

  it('requires an allowed origin for every browser mutation', () => {
    expect(waypointOriginAllowed(new Request('https://www.theevanmiles.com/api/waypoint/auth', { headers: { origin: 'https://www.theevanmiles.com' } }))).toBe(true);
    expect(waypointOriginAllowed(new Request('https://www.theevanmiles.com/api/waypoint/auth'))).toBe(false);
    expect(waypointOriginAllowed(new Request('https://www.theevanmiles.com/api/waypoint/auth', { headers: { origin: 'https://attacker.example' } }))).toBe(false);
    expect(waypointOriginAllowed(new Request('https://www.theevanmiles.com/api/waypoint/auth', { headers: { origin: 'https://www.theevanmiles.com', 'sec-fetch-site': 'cross-site' } }))).toBe(false);
  });
});

describe('backend boundary', () => {
  it('rejects unsafe backend configuration', () => {
    expect(waypointBackendUrl('dashboard').href).toBe('https://waypoint-test.example/api/dashboard');
    for (const url of ['http://remote.example', 'https://user:secret@example.com', 'https://example.com/other', 'https://example.com?token=secret']) {
      vi.stubEnv('WAYPOINT_BACKEND_URL', url);
      expect(() => waypointBackendUrl('dashboard')).toThrow();
    }
  });

  it('limits actual streamed request size and rejects malformed JSON', async () => {
    const request = (body: string) => new Request('https://www.theevanmiles.com', { method: 'POST', body, headers: { 'content-type': 'application/json' } });
    expect(await readSmallJson(request('{"value":1}'))).toEqual({ value: 1 });
    await expect(readSmallJson(request('x'))).rejects.toThrow('valid JSON');
    await expect(readSmallJson(request(JSON.stringify({ value: 'a'.repeat(200) })), 20)).rejects.toThrow('too large');
  });
});
