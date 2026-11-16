import { describe, expect, it } from 'vitest';
import { getApiErrorMessage, isRequestCanceled, isSlotConflictError } from './errors';

describe('isRequestCanceled', () => {
  it.each([{ code: 'ERR_CANCELED' }, { name: 'CanceledError' }, { name: 'AbortError' }])(
    'recognizes an intentional cancellation',
    (error) => {
      expect(isRequestCanceled(error)).toBe(true);
    },
  );

  it('does not treat ordinary failures as cancellations', () => {
    expect(isRequestCanceled(new Error('Request failed'))).toBe(false);
    expect(isRequestCanceled(undefined)).toBe(false);
  });
});

describe('getApiErrorMessage', () => {
  it('returns safe 4xx messages from the server', () => {
    expect(
      getApiErrorMessage(
        { response: { status: 400, data: { message: 'Truck plate is required.' } } },
        'Fallback',
      ),
    ).toBe('Truck plate is required.');
  });

  it('does not expose 5xx bodies or infrastructure messages', () => {
    expect(
      getApiErrorMessage(
        { response: { status: 500, data: { message: 'Database connection failed' } } },
        'Fallback',
      ),
    ).toBe('Fallback');
    expect(getApiErrorMessage(new Error('Network Error'), 'Fallback')).toBe('Fallback');
    expect(getApiErrorMessage(new Error('Request failed with status code 502'), 'Fallback')).toBe(
      'Fallback',
    );
  });

  it('keeps deliberate local messages', () => {
    expect(getApiErrorMessage(new Error('Please choose a date.'), 'Fallback')).toBe(
      'Please choose a date.',
    );
  });
});

describe('isSlotConflictError', () => {
  it('recognizes 409 responses and conflict messages', () => {
    expect(isSlotConflictError({ response: { status: 409 } })).toBe(true);
    expect(isSlotConflictError(new Error('This slot is already booked'))).toBe(true);
  });

  it('ignores unrelated failures', () => {
    expect(isSlotConflictError({ response: { status: 500 } })).toBe(false);
  });
});
