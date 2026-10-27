import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as phaseOne } from '../../app/api/fpl/phase-one/route';
import { GET as phaseTwo } from '../../app/api/fpl/phase-two/route';
import { GET as phaseThree } from '../../app/api/fpl/phase-three/route';
import { GET as phaseFour } from '../../app/api/fpl/phase-four/route';
import { GET as phaseFive } from '../../app/api/fpl/phase-five/route';
import { GET as phaseSix } from '../../app/api/fpl/phase-six/route';

describe('Private FPL API boundary', () => {
  it.each([
    ['phase one', '/api/fpl/phase-one', phaseOne],
    ['phase two', '/api/fpl/phase-two', phaseTwo],
    ['phase three', '/api/fpl/phase-three', phaseThree],
    ['phase four', '/api/fpl/phase-four', phaseFour],
    ['phase five', '/api/fpl/phase-five', phaseFive],
    ['phase six', '/api/fpl/phase-six', phaseSix],
  ] as const)('blocks unauthenticated access to %s', async (_name, path, handler) => {
    const response = await handler(new NextRequest(`https://theevanmiles.com${path}`));

    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ error: 'Please sign in to the admin area.' });
  });
});
