// ai-dvokat: какие ключи строк сервиса (PAGE_STRINGS legal-tools) читает код страниц «Дел» в форке.
// Обращение к строке в коде — `S.ключ`; ключ, выбираемый по данным, записан в коде строкой в кавычках.
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

/**
 * Ключи строк, которые читает код. Прямое обращение — `S.ключ`; ключ, выбираемый по данным (пункт меню, слово
 * состояния, причина паузы), записан в коде строкой в кавычках и узнаётся по перечню известных ключей `known`
 * (файл строк сервиса или снимок для проверок).
 * @param {string[]} [known]
 * @returns {{direct: string[], all: string[]}}
 */
export function usedStringKeys(known = []) {
	/** @type {Set<string>} */
	const direct = new Set();
	/** @type {Set<string>} */
	const quoted = new Set();
	const universe = new Set(known);
	for (const file of caseCodeFiles(['.svelte', '.ts'])) {
		const text = readFileSync(file, 'utf8');
		for (const m of text.matchAll(/(?<![\w.$])S\.([a-z][a-z0-9_]*)/g)) direct.add(m[1]);
		for (const m of text.matchAll(/'([a-z][a-z0-9_]*)'/g)) if (universe.has(m[1])) quoted.add(m[1]);
	}
	return { direct: [...direct].sort(), all: [...new Set([...direct, ...quoted])].sort() };
}
