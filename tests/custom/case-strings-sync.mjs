// ai-dvokat: снимок строк для проверок страниц «Дел» (fixtures/case/strings.json) — только ключи, которые читает
// код форка, со значениями из файла строк сервиса. Это не источник строк для юриста: страница получает строки
// ручкой сервиса. Запуск после правки строк или кода:
//   node tests/custom/case-strings-sync.mjs <путь>/tools/src/legal_tools/case/texts/PAGE_STRINGS.json
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { usedStringKeys } from './case-keys.mjs';

const source = process.argv[2] ?? process.env.CASE_PAGE_STRINGS;
if (!source) {
	console.error('нужен путь к PAGE_STRINGS.json сервиса (аргумент или CASE_PAGE_STRINGS)');
	process.exit(2);
}
const all = JSON.parse(readFileSync(source, 'utf8'));
const keys = usedStringKeys();
const missing = keys.filter((k) => !(k in all));
if (missing.length) {
	console.error('в PAGE_STRINGS нет ключей: ' + missing.join(', '));
	process.exit(1);
}
const out = Object.fromEntries(keys.map((k) => [k, all[k]]));
const target = fileURLToPath(new URL('./fixtures/case/strings.json', import.meta.url));
writeFileSync(target, JSON.stringify(out, null, 1) + '\n');
console.log(`${keys.length} ключей → ${target}`);
