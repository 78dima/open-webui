import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { readCustomUI } from '../../src/lib/custom/config';
// The exact CUSTOM_UI line written to ~/ai-dvokat/deploy/openwebui.env on 05.11 (ADU-1, p. 4).
const raw = readFileSync(new URL('./stand-flags.json', import.meta.url), 'utf8').trim();

test('stand flags carry only brand and result_card, nothing is coerced', () => {
	expect(raw).not.toContain('\n');
	const value = JSON.parse(raw);
	const flags = readCustomUI(value);
	expect(flags).toEqual(value);
	expect(Object.keys(value).sort()).toEqual(['brand', 'result_card']);
	expect(flags.result_card).toBe(true);
	expect(flags.hello).toBeUndefined();
	expect(flags.legal_tools_base).toBeUndefined();
	expect('hide' in flags).toBe(false);
});
