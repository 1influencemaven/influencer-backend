import { classifyUnlockerHttpResult } from './unlocker-fetch.util';

describe('unlocker-fetch.util (re-export shim)', () => {
  it('re-exports classifyUnlockerHttpResult', () => {
    expect(
      classifyUnlockerHttpResult({ httpStatus: 200, bodyLength: 1 }),
    ).toBe('ok');
  });
});
