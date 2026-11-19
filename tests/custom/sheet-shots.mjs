// ai-dvokat: снимки страницы листа и «нескольких листов» (сдача 4) для сверки с макетами L-* варианта «Г».
// Страницы рисует сервис legal-tools; здесь — его разметка на выдуманных данных, собранная статическим сайтом
// (`tools/tests/sheet_site.py` в копии сервиса), и макеты из снимка дизайна, отрисованные тем же браузером. Пары:
// `<макет>-<ширина>-<схема>.page.png` и `.mock.png` (1280 и 360, светлая и тёмная); состояния L-states — в `states/`.
// Заодно проверки, которым нужен браузер: 360 px без прокрутки вбок, поля не меньше 16 px, страница без скрипта.
//
//   (в копии сервиса)  uv run python tests/sheet_site.py <сайт>
//   node tests/custom/sheet-shots.mjs --site <сайт> --out <каталог> --mocks <design-g-snapshot/project>
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, normalize } from 'node:path';

const arg = (name, fallback) => {
	const i = process.argv.indexOf(`--${name}`);
	return i > 0 ? process.argv[i + 1] : fallback;
};
const site = arg('site');
const out = arg('out');
const mocks = arg('mocks');
if (!site || !out || !mocks) {
	console.error('нужны --site <сайт> --out <каталог> --mocks <макеты>');
	process.exit(2);
}
mkdirSync(join(out, 'states'), { recursive: true });
const here = (p) => fileURLToPath(new URL(p, import.meta.url));

// ---- сайт: адреса как у сервиса (без расширений), соседний лист — та же страница сцены ----
const TYPES = {
	css: 'text/css; charset=utf-8',
	js: 'text/javascript; charset=utf-8',
	woff2: 'font/woff2'
};
const server = createServer((req, res) => {
	const url = new URL(req.url, 'http://x');
	let path = normalize(decodeURIComponent(url.pathname)).replace(/^\/legal-tools/, '');
	const send = (file, type) => {
		res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
		res.end(readFileSync(file));
	};
	const file = join(site, path);
	const ext = path.split('.').pop();
	if (TYPES[ext] && existsSync(file)) return send(file, TYPES[ext]);
	if (/\/image$/.test(path) && existsSync(file)) return send(file, 'image/svg+xml');
	const m = /^\/case\/([^/]+)\/(?:p\/\d+|ref)$/.exec(path);
	if (m) {
		const dir = join(site, 'case', m[1]);
		const page = path.endsWith('/ref')
			? join(dir, 'ref.html')
			: [
					join(dir, 'p', `${path.split('/').pop()}.html`),
					join(dir, 'p', '645.html'),
					join(dir, 'p', '1.html')
				].find((f) => existsSync(f));
		if (page && existsSync(page) && statSync(page).isFile())
			return send(page, 'text/html; charset=utf-8');
	}
	res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
	res.end('нет');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/legal-tools`;

// ---- макеты ----
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

async function mock(browser, source, width, height, dark, file, tab = 'text') {
	const raw = readFileSync(join(mocks, `${source}.dc.html`), 'utf8');
	let body = raw.slice(raw.indexOf('<x-dc>') + 6, raw.indexOf('</x-dc>'));
	const helmet = body.match(/<helmet>([\s\S]*?)<\/helmet>/);
	const styles = helmet
		? [...helmet[1].matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n')
		: '';
	body = body
		.replace(/<helmet>[\s\S]*?<\/helmet>/, '')
		.replaceAll('{{fontStack}}', FONT_STACK)
		.replaceAll('disabled="{{ true }}"', 'disabled')
		.replaceAll('{{themeClass}}', dark ? 'dark' : '')
		.replaceAll('{{tabClass}}', tab === 'image' ? 't-img' : 't-text')
		.replaceAll('{{textOn}}', tab === 'image' ? '' : 'on')
		.replaceAll('{{imgOn}}', tab === 'image' ? 'on' : '')
		.replaceAll('{{maxW}}', width <= 720 ? `${width}px` : 'none');
	const gcss = readFileSync(join(mocks, 'g.css'), 'utf8');
	const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><style>${fontFace}\n${gcss}\n${styles}</style></head><body>${body}</body></html>`;
	const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
	const page = await context.newPage();
	await page.setContent(html);
	await page.evaluate(() => document.fonts.ready);
	await page.waitForTimeout(150);
	await page.screenshot({ path: file, fullPage: true });
	await context.close();
}

const problems = [];
async function open(
	browser,
	scene,
	width,
	height,
	dark,
	{ hash = '', js = true, ref = false, select = false } = {}
) {
	const context = await browser.newContext({
		viewport: { width, height },
		deviceScaleFactor: 1,
		colorScheme: dark ? 'dark' : 'light',
		javaScriptEnabled: js
	});
	const page = await context.newPage();
	const errors = [];
	page.on('pageerror', (e) => errors.push(String(e)));
	page.on(
		'console',
		(m) => m.type() === 'error' && !/favicon/.test(m.text()) && errors.push(m.text())
	);
	await page.goto(`${base}/case/${scene}/${ref ? 'ref' : 'p/645'}${hash}`);
	await page.evaluate(() => document.fonts.ready);
	await page.waitForTimeout(250);
	if (select) {
		// выделение части текста листа: кнопка копирования меняет подпись
		await page.evaluate(() => {
			const node = document.getElementById('hl').firstChild;
			const r = document.createRange();
			r.setStart(node, 0);
			r.setEnd(node, 30);
			const s = getSelection();
			s.removeAllRanges();
			s.addRange(r);
		});
		await page.waitForTimeout(100);
	}
	// общие проверки вида: без прокрутки вбок; поля не меньше 16 px (телефон не увеличивает страницу при вводе)
	const facts = await page.evaluate(() => ({
		side: document.documentElement.scrollWidth - document.documentElement.clientWidth,
		small: [...document.querySelectorAll('input:not([type=checkbox]),select,textarea')]
			.filter((el) => el.offsetParent && parseFloat(getComputedStyle(el).fontSize) < 16)
			.map((el) => el.name)
	}));
	const tag = `${scene}${hash} ${width}${dark ? ' тёмная' : ''}${js ? '' : ' без скрипта'}`;
	if (facts.side > 0) problems.push(`${tag}: прокрутка вбок ${facts.side}px`);
	if (width <= 720 && facts.small.length)
		problems.push(`${tag}: поля меньше 16px — ${facts.small}`);
	// у сайта на диске ручек нет: ошибки сети изображения в сцене без изображения — ожидаемые
	const real = errors.filter((e) => !(scene === 'noimage' && /404|Failed to load/.test(e)));
	if (real.length) problems.push(`${tag}: ошибки страницы — ${real.join(' | ')}`);
	return { context, page };
}
async function shot(browser, scene, width, height, dark, file, opts = {}) {
	const { context, page } = await open(browser, scene, width, height, dark, opts);
	if (opts.after) await opts.after(page);
	await page.screenshot({ path: file, fullPage: true });
	await context.close();
}

// макет → сцена сайта; каждая пара — 1280 и 360, светлая и тёмная
const PAIRS = [
	['L-sheet', 'L-sheet', 'sheet', {}, 'text'],
	['L-sheet-image', 'L-sheet', 'sheet', { hash: '#image' }, 'image'],
	['L-ref', 'L-ref', 'ref', { ref: true }, 'text']
];
const HEIGHT = { 'L-sheet': [1420, 2000], 'L-sheet-image': [1420, 1500], 'L-ref': [900, 1200] };
const STATES = [
	['plain', {}],
	['reader', {}],
	['old', {}],
	['removed', {}],
	['nonumber', {}],
	['notext', {}],
	['first', {}],
	['halves', {}],
	['noimage', {}],
	['layer', {}],
	['sheet', { select: true, name: 'copy-quote' }],
	['sheet', { js: false, name: 'noscript' }],
	['ref-none', { ref: true }],
	['ref-noback', { ref: true }],
	['ref-novolume', { ref: true }],
	['error-login', { path1: true }],
	['error-404', { path1: true }]
];

const only = arg('only', '');
const browser = await chromium.launch();
let n = 0;
for (const [name, source, scene, opts, tab] of PAIRS) {
	if (only && name !== only) continue;
	for (const [w, i] of [
		[1280, 0],
		[360, 1]
	])
		for (const dark of [false, true]) {
			// «Изображение» — вкладка телефона; на компьютере такого вида нет
			if (name === 'L-sheet-image' && w === 1280) continue;
			const stem = join(out, `${name}-${w}-${dark ? 'dark' : 'light'}`);
			await shot(browser, scene, w, HEIGHT[name][i], dark, `${stem}.page.png`, opts);
			await mock(browser, source, w, HEIGHT[name][i], dark, `${stem}.mock.png`, tab);
			n += 2;
		}
}
if (!only || only === 'L-states') {
	for (const dark of [false, true]) {
		await mock(
			browser,
			'L-states',
			1280,
			1500,
			dark,
			join(out, `L-states-1280-${dark ? 'dark' : 'light'}.mock.png`)
		);
		n += 1;
	}
	for (const [scene, o] of STATES)
		for (const w of [1280, 360])
			for (const dark of [false, true]) {
				const file = join(out, 'states', `${o.name ?? scene}-${w}-${dark ? 'dark' : 'light'}.png`);
				await shot(browser, scene, w, w === 360 ? 780 : 900, dark, file, o);
				n += 1;
			}
}

// ---- страница без скрипта: открывается, читается, листается; то, чему нужен скрипт, не показано ----
{
	const { context, page } = await open(browser, 'sheet', 360, 780, false, { js: false });
	const facts = await page.evaluate(() => {
		const seen = (sel) =>
			[...document.querySelectorAll(sel)].some((el) => el.offsetParent !== null);
		return {
			text: seen('#sheet-text'),
			mark: document.getElementById('hl')?.textContent ?? '',
			image: seen('#sheet-img'),
			frames: document.querySelectorAll('#sheet-frames rect').length,
			copy: seen('[data-copy]'),
			edit: seen('#sheet-edit'),
			tabs: seen('.tabs'),
			textFirst:
				document.getElementById('text').getBoundingClientRect().top <
				document.getElementById('image').getBoundingClientRect().top,
			next: seen('a[rel=next]')
		};
	});
	if (
		!facts.text ||
		!facts.image ||
		!facts.mark ||
		facts.frames !== 2 ||
		!facts.textFirst ||
		!facts.next
	)
		problems.push(`без скрипта: лист не читается целиком — ${JSON.stringify(facts)}`);
	if (facts.copy || facts.edit || facts.tabs)
		problems.push(`без скрипта видно то, чему нужен скрипт — ${JSON.stringify(facts)}`);
	await page.locator('a[rel=next]:visible').first().click();
	await page.waitForURL(/\/p\/646$/);
	// «Лист №» → форма по якорю → «несколько листов»
	await page.locator('a[href="#goto"]').click();
	await page.locator('#goto input[name=l]').fill('88');
	const visible = await page.locator('#goto form').isVisible();
	if (!visible) problems.push('без скрипта: форма «Открыть лист» под «Лист №» не открылась');
	await context.close();
}
await browser.close();
server.close();
console.log(`снимков: ${n}`);
if (problems.length) {
	console.error(problems.join('\n'));
	process.exit(1);
}
