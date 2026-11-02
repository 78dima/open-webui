import { test, expect } from '@playwright/test';
import { readCustomUI } from '../../src/lib/custom/config';

test('custom features require explicit booleans and ignore unknown properties', () => {
  for (const value of [undefined, null, [], true, 'true', 1]) {
    expect(readCustomUI(value)).toEqual({});
  }
  expect(readCustomUI({
    start: 'true', result_card: 1, brand: true, hide: ['arena'], unknown: true
  })).toEqual({});
  expect(readCustomUI({
    hello: true, start: false, result_card: true,
    brand: { name: '  Юрист РФ  ', suffix: false, about: true, community: 'false' },
    hide: { arena: true, temporary_chat: 'true', unknown: true }
  })).toEqual({
    hello: true, start: false, result_card: true,
    brand: { name: 'Юрист РФ', suffix: false, about: true }, hide: { arena: true }
  });
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
