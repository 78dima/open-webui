// ai-dvokat: снимки страниц «Дел» для сверки с макетами варианта «Г» (сдачи вёрстки).
// Берёт стенд компонентов (tests/custom, настоящие компоненты и стили; ручки подменены выдуманными данными из
// fixtures/case) и кладёт PNG парами: `<макет>.page.png` — страница, `<макет>.mock.png` — макет из снимка дизайна,
// отрисованный тем же браузером (подстановка {{fontStack}}, свой файл шрифта вместо Google Fonts). Плюс полная
// сетка «состояние × 1280/360 × светлая/тёмная» в `matrix/`.
//
//   CUSTOM_TEST_PORT=5184 node ../../node_modules/vite/bin/vite.js --config vite.config.ts   # стенд, из tests/custom
//   node tests/custom/case-shots.mjs --base http://127.0.0.1:5184 --out <каталог> --mocks <design-g-snapshot/project>
//   --set d — только «Мои дела», --set k — только страница дела (по умолчанию — всё)
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
async function mock(browser, name, width, height, dark, file, source = name) {
	const raw = readFileSync(join(mocks, `${source}.dc.html`), 'utf8');
	let body = raw.slice(raw.indexOf('<x-dc>') + 6, raw.indexOf('</x-dc>'));
	const helmet = body.match(/<helmet>([\s\S]*?)<\/helmet>/);
	const styles = helmet ? [...helmet[1].matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n') : '';
	body = body
		.replace(/<helmet>[\s\S]*?<\/helmet>/, '')
		.replaceAll('{{fontStack}}', FONT_STACK)
		.replaceAll('disabled="{{ true }}"', 'disabled')
		// случайная строка со ссылкой в конце D-phone — мусор холста, в дизайн не входит
		.replace(/<p style="margin: 0; position: absolute[^>]*>https:\/\/dribbble[^<]*<\/p>/, '');
	body = body
		.replaceAll('{{themeClass}}', dark ? 'dark' : '')
		.replaceAll('{{maxW}}', width <= 720 ? `${width}px` : 'none')
		.replaceAll('checked="{{ true }}"', 'checked');
	const gcss = raw.includes('./g.css') ? readFileSync(join(mocks, 'g.css'), 'utf8') : '';
	const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><style>${fontFace}\n${gcss}\n${styles}</style></head><body>${body}</body></html>`;
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

// ---- страница дела: каркас, «Обзор», «Загрузить материалы», «Проверьте листы» ----
const FOLDER = fixture('case-boot').folder_id;
const without = (o, ...keys) => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));
const CASE_SCENES = {
	// обзор: дело в работе (как на макете K-overview — без паузы), меню телефона, шесть состояний сводки K-status
	overview: { data: () => ({ ...fixture('case-overview-processing'), paused: null }) },
	menu: { data: () => ({ ...fixture('case-overview-processing'), paused: null }), menu: true },
	'status-empty': {
		data: () => {
			const d = fixture('case-overview');
			return { ...d, overview: { ...d.overview, volumes: [], files_without_volume: [], e_case: [], check_sheets: [],
				index_coverage: { indexed: 0, total: 0 }, size: { pages: 0, documents: 0 }, passport: null, case: without(d.overview.case, 'engine_note') },
				check_total: 0, uploads: [], files: {}, counts: {}, deadlines_next: [], estimate: null };
		},
		passport: false
	},
	'status-ready': { data: () => fixture('case-overview') },
	'status-paused': { data: () => ({ ...fixture('case-overview-processing'), paused: { reason: 'fuse', since: new Date().toISOString().slice(0, 11) + '02:02:00Z', until: null } }) },
	'status-stopped': { data: () => fixture('case-overview-processing') },
	'status-offline': { data: () => fixture('case-overview-processing'), offline: true },
	'status-readonly': { data: () => ({ ...fixture('case-overview-processing'), paused: null, uploads: [] }), boot: { can_write: false, is_owner: false } },
	'no-case': { data: () => fixture('case-overview'), boot: { has_case: false, case_id: null } },
	check: { data: () => fixture('case-overview'), section: 'check' },
	upload: { data: () => fixture('case-overview-processing'), section: 'upload', files: true },
	// разделы сдачи 3: данные — примеры выдуманного дела; `routes` — ручки раздела (хвост адреса → пример или ответ)
	volumes: { data: () => ({ ...fixture('case-overview-processing'), paused: null }), section: 'volumes', after: async (page) => {
		await page.getByTestId('case-file-actions').first().click();
	} }
};

async function openCase(browser, scene, width, height, dark) {
	const s = CASE_SCENES[scene];
	const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, colorScheme: dark ? 'dark' : 'light' });
	const page = await context.newPage();
	await page.addInitScript(() => localStorage.setItem('token', 'shot-token'));
	let overviewCalls = 0;
	await page.route('**/legal-tools/api/cases/ui.json', (r) => r.fulfill({ json: { strings } }));
	await page.route(`**/legal-tools/api/cases/${FOLDER}/boot`, (r) => r.fulfill({ json: { ...fixture('case-boot'), ...(s.boot ?? {}) } }));
	await page.route(`**/legal-tools/api/cases/${FOLDER}/passport`, (r) =>
		s.passport === false ? r.fulfill({ json: { fields: [] } }) : r.fulfill({ json: fixture('passport') })
	);
	await page.route(`**/legal-tools/api/cases/${FOLDER}/folder-files`, (r) => r.fulfill({ json: fixture('folder-files') }));
	await page.route(`**/legal-tools/api/cases/${FOLDER}`, (r) => {
		overviewCalls += 1;
		if (s.offline && overviewCalls > 1) return r.abort('internetdisconnected');
		return r.fulfill({ json: s.data() });
	});
	// загрузки: первая часть первого файла остаётся без ответа — строка «передаётся»
	await page.route(`**/legal-tools/api/cases/${FOLDER}/uploads`, (r) => {
		const b = r.request().postDataJSON();
		return r.fulfill({ status: 201, json: { upload: { id: `up-${b.filename}`, filename: b.filename, size: b.size, received: 0, part_size: 16777216, parts: [], status: 'receiving', phase: 'receiving' } } });
	});
	await page.route(`**/legal-tools/api/cases/${FOLDER}/uploads/**`, () => {});
	for (const [tail, answer] of Object.entries(s.routes ?? {})) {
		await page.route(`**/legal-tools/api/cases/${FOLDER}/${tail}`, (r) =>
			typeof answer === 'function' ? answer(r) : r.fulfill({ json: fixture(answer) })
		);
	}
	await page.goto(`${base}/?casepage=${FOLDER}${s.section ? `&s=${s.section}` : ''}`);
	await page.waitForFunction(() => typeof window.setConfig === 'function');
	if (dark) await page.evaluate(() => document.documentElement.classList.add('dark'));
	await page.evaluate(() => window.setConfig({ custom_ui: { case: true } }));
	await page.waitForSelector('[data-testid="case-page"]');
	if (s.boot?.has_case === false) await page.waitForSelector('[data-testid="case-none"]');
	else if (!s.section) await page.waitForSelector('[data-testid="case-summary"]:not([data-state="loading"])');
	if (s.offline) {
		await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
		await page.waitForSelector('[data-testid="case-offline"]');
	}
	if (s.menu && width <= 720) {
		await page.getByTestId('case-menu-open').click();
		await page.waitForSelector('[data-testid="case-menu"]');
	}
	if (s.files) {
		const file = (name, size) => ({ name, mimeType: 'application/octet-stream', buffer: Buffer.alloc(size) });
		await page.getByTestId('case-pick-files').setInputFiles([file('foto-015.jpg', 4400000)]);
		await page.getByTestId('case-upload-start').click();
		await page.waitForSelector('[data-testid="case-upload"][data-state="running"]');
		await page.getByTestId('case-pick-files').setInputFiles([
			file('tom-11.pdf', 880000), file('tom-12.pdf', 645000), file('arbitr-otzyv.pdf', 870400),
			...Array.from({ length: 14 }, (_, n) => file(`foto-${n + 1}.jpg`, 2861000))
		]);
		const rows = page.getByTestId('case-queue-row');
		await rows.nth(0).getByRole('radio').first().check();
		await rows.nth(0).getByRole('textbox').fill('11');
		await rows.nth(1).getByRole('radio').first().check();
		await rows.nth(1).getByRole('combobox').selectOption({ index: 1 });
		await page.getByTestId('case-upload-start').click(); // у третьего PDF вид не указан — подсказка у кнопки
	}
	if (s.after) await s.after(page, width);
	await page.evaluate(() => document.fonts.ready);
	await page.waitForTimeout(250);
	const full = await page.evaluate(() => document.querySelector('.cg-view')?.scrollHeight ?? 0);
	if (full > height) {
		await page.setViewportSize({ width, height: full });
		await page.waitForTimeout(100);
	}
	return { context, page };
}
async function shotCase(browser, scene, width, height, dark, file) {
	const { context, page } = await openCase(browser, scene, width, height, dark);
	await page.screenshot({ path: file });
	const overflow = await page.evaluate(() => {
		const view = document.querySelector('.cg-view');
		return (view ? view.scrollWidth - view.clientWidth : 0) + (document.documentElement.scrollWidth - window.innerWidth);
	});
	await context.close();
	return overflow;
}
// макет (или его основа для обёрток -phone и -dark) → состояние страницы дела
const trio = (name, scene, height, phone) => [
	[name, name, scene, 1280, height, false],
	[`${name}-phone`, name, scene, 360, phone, false],
	[`${name}-dark`, name, scene, 1280, height, true]
];
const CASE_PAIRS = [
	['K-overview', 'K-overview', 'overview', 1280, 1420, false],
	['K-overview-phone', 'K-overview', 'overview', 360, 2000, false],
	['K-overview-dark', 'K-overview', 'overview', 1280, 1420, true],
	['K-menu-phone', 'K-menu-phone', 'menu', 360, 1140, false],
	['K-upload', 'K-upload', 'upload', 1280, 2120, false],
	['K-upload-phone', 'K-upload', 'upload', 360, 3200, false],
	['K-upload-dark', 'K-upload', 'upload', 1280, 2120, true],
	['K-check', 'K-check', 'check', 1280, 1860, false],
	['K-check-phone', 'K-check', 'check', 360, 2900, false],
	['K-check-dark', 'K-check', 'check', 1280, 1860, true],
	...trio('K-volumes', 'volumes', 2060, 3200)
];
const STATUS = ['status-empty', 'status-ready', 'status-paused', 'status-stopped', 'status-offline', 'status-readonly', 'no-case'];
const set = arg('set', 'all');
const only = arg('only', ''); // один макет со своими обёртками: --only K-volumes (состояния и матрица не снимаются)

const browser = await chromium.launch({
	executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined
});
const report = [];
if (set !== 'd') {
	for (const [name, source, scene, width, height, dark] of CASE_PAIRS.filter((p) => !only || p[1] === only)) {
		const overflow = await shotCase(browser, scene, width, height, dark, join(out, `${name}.page.png`));
		if (mocks) await mock(browser, name, width, height, dark, join(out, `${name}.mock.png`), source);
		report.push({ mock: name, scene, width, dark, overflow });
	}
	if (mocks && !only) await mock(browser, 'K-status', 1280, 940, false, join(out, 'K-status.mock.png'));
	for (const scene of only ? [] : STATUS) {
		const overflow = await shotCase(browser, scene, 1280, 720, false, join(out, `K-status.${scene}.page.png`));
		report.push({ mock: 'K-status', scene, width: 1280, dark: false, overflow });
	}
	for (const scene of only ? [] : Object.keys(CASE_SCENES)) {
		for (const width of [1280, 360]) {
			for (const dark of [false, true]) {
				const file = join(out, 'matrix', `case-${scene}.${width}.${dark ? 'dark' : 'light'}.png`);
				const overflow = await shotCase(browser, scene, width, 720, dark, file);
				report.push({ mock: 'matrix', scene: `case-${scene}`, width, dark, overflow });
			}
		}
	}
}
for (const [name, scene, width, height, dark] of set === 'k' ? [] : PAIRS) {
	const overflow = await shot(browser, scene, width, height, dark, join(out, `${name}.page.png`));
	if (mocks) await mock(browser, name, width, height, dark, join(out, `${name}.mock.png`));
	report.push({ mock: name, scene, width, dark, overflow });
}
for (const scene of set === 'k' ? [] : EDGE_EXTRA) {
	const overflow = await shot(browser, scene, 1280, 900, false, join(out, `D-edge.${scene}.page.png`));
	report.push({ mock: 'D-edge', scene, width: 1280, dark: false, overflow });
}
for (const scene of set === 'k' ? [] : Object.keys(SCENES)) {
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
