import { test, expect } from '@playwright/test';
import { readCustomUI } from '../../src/lib/custom/config';

test('custom features require explicit booleans and ignore unknown properties', () => {
  for (const value of [undefined, null, [], true, 'true', 1]) {
    expect(readCustomUI(value)).toEqual({});
  }
  expect(readCustomUI({
    hello: 'true', result_card: 1, brand: true, unknown: true
  })).toEqual({});
  expect(readCustomUI({
    hello: true, result_card: true,
    brand: { name: '  Юрист РФ  ', suffix: false, about: true, community: 'false' }
  })).toEqual({
    hello: true, result_card: true,
    brand: { name: 'Юрист РФ', suffix: false, about: true }
  });
  // Removed 05.11: start, receipt_panel, case and hide are ignored like unknown keys.
  expect(readCustomUI({ start: true, receipt_panel: true, case: true, hide: { arena: true } })).toEqual({});
});

test('legal-tools base cannot send the session token to another origin', () => {
  for (const legal_tools_base of [
    'https://example.org', '//example.org', '/\\example.org', '/legal-tools/../api',
    '/legal-tools/%2e%2e', '/legal-tools?redirect=https://example.org', '/legal-tools#fragment', '', '/'
  ]) {
    expect(readCustomUI({ legal_tools_base }).legal_tools_base).toBeUndefined();
  }
  expect(readCustomUI({ legal_tools_base: '/legal-tools/' }).legal_tools_base).toBe('/legal-tools');
  expect(readCustomUI({ legal_tools_base: '/services/legal-tools' }).legal_tools_base).toBe('/services/legal-tools');
});
