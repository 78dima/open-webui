// ai-dvokat: правила кода страниц «Дел» (вариант «Г»), которые держатся проверкой, а не вниманием:
// данные в разметку — только текстом; слова — только ключами строк сервиса; внешних адресов нет; значки — из спрайта.
import { test, expect } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { caseCodeFiles, usedStringKeys } from './case-keys.mjs';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const read = (file: string) => readFileSync(file, 'utf8');
const strings = JSON.parse(read(here('./fixtures/case/strings.json')));
const short = (file: string) => file.slice(file.indexOf('/src/') + 1);

test('данные сервиса попадают в разметку только текстом: ни {@html}, ни innerHTML', () => {
	// в данных — распознанный текст документов; тот же запрет, что test_scripts_never_build_markup_from_strings в legal-tools
	const files = caseCodeFiles(['.svelte', '.ts']);
	expect(files.length).toBeGreaterThan(8);
	const bad = /\{@html|innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function\(|DOMParser|srcdoc/;
	expect(files.filter((f) => bad.test(read(f))).map(short)).toEqual([]);
});

test('каждое слово страницы — ключ строк сервиса; снимок строк для проверок совпадает с файлом строк', () => {
	const used = usedStringKeys(Object.keys(strings));
	expect(used.direct.length).toBeGreaterThan(40);
	expect(used.direct.filter((k) => !(k in strings))).toEqual([]);
	expect(Object.keys(strings).filter((k) => !used.all.includes(k))).toEqual([]);
	// рядом лежит рабочая копия сервиса (или задан CASE_PAGE_STRINGS) — снимок сверяется с настоящим файлом строк
	const source =
		process.env.CASE_PAGE_STRINGS ??
		here('../../../ai-dvokat-case-ui/tools/src/legal_tools/case/texts/PAGE_STRINGS.json');
	test.skip(!existsSync(source), 'нет файла строк сервиса: CASE_PAGE_STRINGS=<путь к PAGE_STRINGS.json>');
	const real = JSON.parse(read(source));
	const full = usedStringKeys(Object.keys(real));
	expect(Object.fromEntries(full.all.map((k) => [k, real[k]]))).toEqual(strings);
});

test('русские слова в компонентах — только в комментариях: фраз для юриста в коде нет', () => {
	const stripped = (text: string) =>
		text
			.replace(/<!--[\s\S]*?-->/g, '')
			.replace(/\/\*[\s\S]*?\*\//g, '')
			.replace(/^\s*\/\/.*$/gm, '')
			.replace(/\s\/\/ .*$/gm, '');
	const found = caseCodeFiles(['.svelte', '.ts'])
		.map((f) => [short(f), stripped(read(f)).match(/[А-Яа-яЁё][А-Яа-яЁё ]*/g) ?? []] as const)
		.filter(([, words]) => words.length)
		// единственное исключение — нормализация «ё» в поиске по названию
		.map(([f, words]) => [f, words.filter((w) => !(f.endsWith('mycases.ts') && ['ё', 'е'].includes(w)))] as const)
		.filter(([, words]) => words.length);
	expect(found).toEqual([]);
});

test('внешних адресов в коде и стилях нет; шрифт лежит рядом вместе с лицензией', () => {
	const files = caseCodeFiles(['.svelte', '.ts', '.css']);
	const withUrl = files.filter((f) =>
		/https?:\/\/|\/\/fonts\.|googleapis|gstatic/.test(read(f).replace(/<!--[\s\S]*?-->|\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, ''))
	);
	expect(withUrl.map(short)).toEqual([]);
	const css = read(here('../../src/lib/custom/case/case.css'));
	const fonts = [...css.matchAll(/url\('\.\/fonts\/([^']+)'\)/g)].map((m) => m[1]);
	expect(fonts).toHaveLength(4);
	for (const f of [...fonts, 'OFL.txt']) expect(existsSync(here(`../../src/lib/custom/case/fonts/${f}`)), f).toBe(true);
	expect(read(here('../../src/lib/custom/case/fonts/OFL.txt'))).toContain('SIL OPEN FONT LICENSE Version 1.1');
});

test('стили «Г» не выходят за корневой класс и не задевают чат', () => {
	const css = read(here('../../src/lib/custom/case/case.css')).replace(/\/\*[\s\S]*?\*\//g, '');
	const selectors = [...css.matchAll(/(^|\})\s*([^{}@]+)\{/g)].flatMap((m) => m[2].split(',').map((s) => s.trim()));
	expect(selectors.length).toBeGreaterThan(200);
	expect(selectors.filter((s) => s && !/^((html(\.dark)? )?\.cg\b|:where\(\.cg\) )/.test(s))).toEqual([]);
});

test('значки: имена компонента Icon и символы спрайта совпадают', () => {
	const sprite = [...read(here('../../src/lib/components/custom/case/Sprite.svelte')).matchAll(/<symbol id="cg-i-([a-z-]+)"/g)].map((m) => m[1]);
	const icon = read(here('../../src/lib/components/custom/case/Icon.svelte'));
	const names = [...icon.slice(icon.indexOf('ICONS = ['), icon.indexOf('] as const')).matchAll(/'([a-z-]+)'/g)].map((m) => m[1]);
	expect(names).toEqual(sprite);
	expect(new Set(names).size).toBe(names.length);
});
