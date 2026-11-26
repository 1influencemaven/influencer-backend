import {
  bodyParserErrorStatus,
  pickValidationMessage,
} from './global-exception.filter';

describe('pickValidationMessage', () => {
  it('prefers "required" errors over length/format ones', () => {
    expect(
      pickValidationMessage([
        'label must be shorter than or equal to 100 characters',
        'label is required',
      ]),
    ).toBe('label is required');
    expect(
      pickValidationMessage([
        'name must be a string',
        'name should not be empty',
      ]),
    ).toBe('name should not be empty');
  });

  it('falls back to the first message', () => {
    expect(pickValidationMessage(['a is invalid', 'b is invalid'])).toBe(
      'a is invalid',
    );
    expect(pickValidationMessage([])).toBe('Bad Request');
  });
});

describe('bodyParserErrorStatus', () => {
  it('keeps 4xx statuses from body-parser errors', () => {
    expect(
      bodyParserErrorStatus({ type: 'entity.too.large', status: 413 }),
    ).toBe(413);
    expect(
      bodyParserErrorStatus({ type: 'entity.parse.failed', status: 400 }),
    ).toBe(400);
    expect(bodyParserErrorStatus(new Error('boom'))).toBeUndefined();
    expect(bodyParserErrorStatus({ status: 500, type: 'x' })).toBeUndefined();
  });
});
