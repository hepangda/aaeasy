import { describe, expect, it } from 'vitest';
import { safeInternalPath } from './navigation';

describe('safeInternalPath', () => {
  it('accepts an application-relative path', () => {
    expect(safeInternalPath('/groups/abc?tab=summary')).toBe('/groups/abc?tab=summary');
  });

  it.each(['https://evil.example', '//evil.example/path', '/\\evil.example/path'])(
    'rejects external redirect %s',
    (value) => expect(safeInternalPath(value)).toBeNull(),
  );
});
