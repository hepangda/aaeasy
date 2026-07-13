import { describe, expect, it } from 'vitest';
import { authRedirect, safeInternalPath } from './navigation';

describe('safeInternalPath', () => {
  it('accepts an application-relative path', () => {
    expect(safeInternalPath('/groups/abc?tab=summary')).toBe('/groups/abc?tab=summary');
  });

  it.each(['https://evil.example', '//evil.example/path', '/\\evil.example/path'])(
    'rejects external redirect %s',
    (value) => expect(safeInternalPath(value)).toBeNull(),
  );
});

describe('authRedirect', () => {
  it('prioritizes a claimed share destination', () => {
    expect(authRedirect('/groups/claimed', '/account')).toBe('/groups/claimed');
  });

  it('uses the requested path for ordinary login', () => {
    expect(authRedirect('/', '/groups/original')).toBe('/groups/original');
  });
});
