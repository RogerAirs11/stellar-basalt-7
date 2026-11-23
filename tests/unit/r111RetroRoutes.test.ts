import { describe, expect, it } from 'vitest';
import { retroHashForHostRoute } from '../../src/web/frontends/retro-astra/transplant/lib/routeBridge';

describe('R111 Retro direct host links', () => {
  it('keeps canonical record and person identities in native routes', () => {
    expect(retroHashForHostRoute('/horse/900000017')).toBe('#/horses/900000017');
    expect(retroHashForHostRoute('/person/900100001')).toBe('#/collections/people?person=900100001');
    expect(retroHashForHostRoute('/stats')).toBe('#/insights');
  });
  it('preserves browse search and frontend-local workspaces', () => {
    expect(retroHashForHostRoute('/browse','?q=DEMO&offset=25')).toBe('#/horses?q=DEMO&offset=25');
    expect(retroHashForHostRoute('/f/retro-astra/collections/breeding')).toBe('#/collections/breeding');
    expect(retroHashForHostRoute('/f/retro-astra/')).toBe('#/');
  });
});
