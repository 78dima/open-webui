// ai-dvokat: какие ключи строк сервиса (PAGE_STRINGS legal-tools) читает код страниц «Дел» в форке.
// Обращение к строке в коде — только `S.ключ` или таблица ключей с пометкой `key:` (ACCESS в MyCases.svelte).
// Этим списком пользуются проверка (case-code.spec.ts) и сборка снимка строк для проверок (case-strings-sync.mjs).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../..', import.meta.url));
export const CASE_CODE_DIRS = ['src/lib/custom/case', 'src/lib/components/custom/case', 'src/routes/case'];

/** @param {string[]} extensions @returns {string[]} */
export function caseCodeFiles(extensions = ['.svelte', '.ts', '.css']) {
	/** @type {string[]} */
	const out = [];
	/** @param {string} dir */
	const walk = (dir) => {
		for (const name of readdirSync(dir)) {
			const path = join(dir, name);
			if (statSync(path).isDirectory()) walk(path);
			else if (extensions.some((e) => name.endsWith(e)) && !name.endsWith('.test.ts')) out.push(path);
		}
	};
	for (const dir of CASE_CODE_DIRS) walk(join(root, dir));
	return out.sort();
}

/** @returns {string[]} */
export function usedStringKeys() {
	/** @type {Set<string>} */
	const keys = new Set();
	for (const file of caseCodeFiles(['.svelte', '.ts'])) {
		const text = readFileSync(file, 'utf8');
		for (const m of text.matchAll(/(?<![\w.$])S\.([a-z][a-z0-9_]*)/g)) keys.add(m[1]);
		for (const m of text.matchAll(/\bkey: '([a-z][a-z0-9_]*)'/g)) keys.add(m[1]);
	}
	return [...keys].sort();
}
