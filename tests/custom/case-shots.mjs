// ai-dvokat: снимки страниц «Дел» для сверки с макетами варианта «Г» (сдачи вёрстки).
// Берёт стенд компонентов (tests/custom, настоящие компоненты и стили; ручки подменены выдуманными данными из
// fixtures/case) и кладёт PNG парами: `<макет>.page.png` — страница, `<макет>.mock.png` — макет из снимка дизайна,
// отрисованный тем же браузером (подстановка {{fontStack}}, свой файл шрифта вместо Google Fonts). Плюс полная
// сетка «состояние × 1280/360 × светлая/тёмная» в `matrix/`.
//
//   CUSTOM_TEST_PORT=5184 node ../../node_modules/vite/bin/vite.js --config vite.config.ts   # стенд, из tests/custom
//   node tests/custom/case-shots.mjs --base http://127.0.0.1:5184 --out <каталог> --mocks <design-g-snapshot/project>
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const arg = (name, fallback) => {
	const i = process.argv.indexOf(`--${name}`);
	return i > 0 ? process.argv[i + 1] : fallback;
};
const base = arg('base', 'http://127.0.0.1:5174');
const out = arg('out');
const mocks = arg('mocks');
if (!out) {
	console.error('нужен --out <каталог>');
	process.exit(2);
}
mkdirSync(join(out, 'matrix'), { recursive: true });

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const fixture = (name) => JSON.parse(readFileSync(here(`./fixtures/case/${name}.json`), 'utf8'));
const strings = fixture('strings');
const FONT_STACK =
	"'Geologica', system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
const fontFace = ['cyrillic-ext', 'cyrillic', 'latin-ext', 'latin']
	.map((subset) => {
		const file = here(`../../src/lib/custom/case/fonts/geologica-${subset}-wght-normal.woff2`);
		const css = readFileSync(here('../../src/lib/custom/case/case.css'), 'utf8');
		const range = css
			.split(`geologica-${subset}-wght-normal.woff2`)[1]
			.match(/unicode-range:([^}]+)\}/)[1];
		return `@font-face{font-family:'Geologica';font-weight:100 900;src:url(data:font/woff2;base64,${readFileSync(file).toString('base64')}) format('woff2');unicode-range:${range}}`;
	})
	.join('\n');

// ---- состояния страницы «Мои дела» ----
const SCENES = {
	ready: { listing: 'my-cases', tree: true },
	loading: { listing: 'my-cases', hang: true },
	empty: { listing: 'my-cases-empty' },
	'error-chat': { status: 503, detail: 'Open WebUI временно не отвечает — список папок не получить' },
	'error-network': { abort: true },
	edge: { listing: 'my-cases-edge' },
	'no-cases': { listing: 'my-cases-no-cases' },
	'search-empty': { listing: 'my-cases', tree: true, search: 'мироненко' },
	creating: { listing: 'my-cases-no-cases', createHang: true },
	'create-failed': {
		listing: 'my-cases-no-cases',
		createStatus: 500,
		createDetail: 'внутренняя ошибка — повторите позже'
	}
};

async function open(browser, scene, width, height, dark) {
	const s = SCENES[scene];
	const context = await browser.newContext({
		viewport: { width, height },
		deviceScaleFactor: 1,
		colorScheme: dark ? 'dark' : 'light'
	});
	const page = await context.newPage();
	await page.addInitScript(() => localStorage.setItem('token', 'shot-token'));
	await page.route('**/legal-tools/api/cases/ui.json', (r) => r.fulfill({ json: { strings } }));
	await page.route('**/api/v1/folders/', (r) => r.fulfill({ json: s.tree ? fixture('folders') : [] }));
	await page.route('**/api/v1/folders/shared', (r) =>
		r.fulfill({ json: s.tree ? fixture('folders-shared') : [] })
	);
	await page.route('**/legal-tools/api/cases', async (r) => {
		if (s.hang) return; // запрос остаётся без ответа — страница в состоянии «Загрузка…»
		if (s.abort) return r.abort('internetdisconnected');
		if (s.status) return r.fulfill({ status: s.status, json: { detail: s.detail } });
		return r.fulfill({ json: fixture(s.listing) });
	});
	await page.route('**/legal-tools/api/cases/*-*', async (r) => {
		if (r.request().method() !== 'POST') return r.fallback();
		if (s.createHang) return;
		return r.fulfill({ status: s.createStatus ?? 500, json: { detail: s.createDetail ?? '' } });
	});
	await page.goto(`${base}/?case`);
	await page.waitForFunction(() => typeof window.setConfig === 'function');
	if (dark) await page.evaluate(() => document.documentElement.classList.add('dark'));
	await page.evaluate(() => window.setConfig({ custom_ui: { case: true } }));
	const want = s.hang ? 'loading' : s.status || s.abort ? 'error' : 'ready';
	await page.waitForSelector(`[data-testid="my-cases"][data-phase="${want}"]`);
	if (s.search) await page.locator('input[type="search"]').fill(s.search);
	if (s.createHang || s.createStatus) {
		await page.locator('[data-testid="case-folder"] button:visible').first().click();
		if (s.createStatus) await page.waitForSelector('[data-testid="case-toast"]');
	}
	await page.evaluate(() => document.fonts.ready);
	await page.waitForTimeout(250);
	// страница прокручивается внутри своего блока: окно растягивается под содержимое, чтобы снимок был целым
	const full = await page.evaluate(() => document.querySelector('.cg-view')?.scrollHeight ?? 0);
	if (full > height) {
		await page.setViewportSize({ width, height: full });
		await page.waitForTimeout(100);
	}
	return { context, page };
}

async function shot(browser, scene, width, height, dark, file) {
	const { context, page } = await open(browser, scene, width, height, dark);
	await page.screenshot({ path: file });
	const overflow = await page.evaluate(() => {
		const view = document.querySelector('.cg-view');
		return view ? view.scrollWidth - view.clientWidth : 0;
	});
	await context.close();
	return overflow;
}

// ---- макет из снимка дизайна ----
async function mock(browser, name, width, height, dark, file) {
	const raw = readFileSync(join(mocks, `${name}.dc.html`), 'utf8');
	let body = raw.slice(raw.indexOf('<x-dc>') + 6, raw.indexOf('</x-dc>'));
	const helmet = body.match(/<helmet>([\s\S]*?)<\/helmet>/);
	const styles = helmet ? [...helmet[1].matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n') : '';
	body = body
		.replace(/<helmet>[\s\S]*?<\/helmet>/, '')
		.replaceAll('{{fontStack}}', FONT_STACK)
		.replaceAll('disabled="{{ true }}"', 'disabled')
		// случайная строка со ссылкой в конце D-phone — мусор холста, в дизайн не входит
		.replace(/<p style="margin: 0; position: absolute[^>]*>https:\/\/dribbble[^<]*<\/p>/, '');
	const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><style>${fontFace}\n${styles}</style></head><body>${body}</body></html>`;
	const context = await browser.newContext({
		viewport: { width, height },
		deviceScaleFactor: 1,
		colorScheme: dark ? 'dark' : 'light'
	});
	const page = await context.newPage();
	await page.setContent(html);
	await page.evaluate(() => document.fonts.ready);
	await page.waitForTimeout(150);
	await page.screenshot({ path: file, fullPage: true });
	await context.close();
}

// макет → состояние страницы, которым он снят (размер и схема — как у макета в VERSION.md)
const PAIRS = [
	['D-panel', 'ready', 1280, 1020, false],
	['D-phone', 'ready', 360, 1480, false],
	['D-dark', 'ready', 1280, 1020, true],
	['D-dark-phone', 'ready', 360, 1480, true],
	['D-loading', 'loading', 1280, 720, false],
	['D-empty', 'empty', 1280, 720, false],
	['D-empty-phone', 'empty', 360, 720, false],
	['D-error', 'error-chat', 1280, 720, false],
	['D-error-phone', 'error-network', 360, 720, false],
	['D-edge', 'edge', 1280, 900, false]
];
// D-edge — лист с особыми случаями: к нему ещё четыре состояния страницы
const EDGE_EXTRA = ['search-empty', 'no-cases', 'creating', 'create-failed'];

const browser = await chromium.launch({
	executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined
});
const report = [];
for (const [name, scene, width, height, dark] of PAIRS) {
	const overflow = await shot(browser, scene, width, height, dark, join(out, `${name}.page.png`));
	if (mocks) await mock(browser, name, width, height, dark, join(out, `${name}.mock.png`));
	report.push({ mock: name, scene, width, dark, overflow });
}
for (const scene of EDGE_EXTRA) {
	const overflow = await shot(browser, scene, 1280, 900, false, join(out, `D-edge.${scene}.page.png`));
	report.push({ mock: 'D-edge', scene, width: 1280, dark: false, overflow });
}
for (const scene of Object.keys(SCENES)) {
	for (const width of [1280, 360]) {
		for (const dark of [false, true]) {
			const file = join(out, 'matrix', `${scene}.${width}.${dark ? 'dark' : 'light'}.png`);
			const overflow = await shot(browser, scene, width, 720, dark, file);
			report.push({ mock: 'matrix', scene, width, dark, overflow });
		}
	}
}
await browser.close();
writeFileSync(join(out, 'shots.json'), JSON.stringify(report, null, 1) + '\n');
const bad = report.filter((r) => r.overflow > 0);
console.log(`${report.length} снимков → ${out}; прокрутка вбок: ${bad.length ? JSON.stringify(bad) : 'нет'}`);
process.exit(bad.length ? 1 : 0);
