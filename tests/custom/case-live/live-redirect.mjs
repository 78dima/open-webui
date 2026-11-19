// ai-dvokat: живая проверка переадресации прежних адресов на новые страницы «Дел» (сдача 5) и время открытия
// прежних и новых страниц — настоящий браузер, своя среда (run.sh), то же дело, что у live-case.mjs.
// Порядок: 1) переадресация выключена — замер времени «переход → готовая страница» для прежней и новой страницы дела и
// «Моих дел» (по три замера с пустым кэшем и с тёплым); 2) переадресация включается настройкой сервиса
// (LEGAL_TOOLS_CASE_PAGE_REDIRECT, сервис перезапускается): старые ссылки на «Мои дела» и на дело открывают новые
// страницы, адрес дела из блока дела для модели — тоже, «← название дела» с листа ведёт на новую страницу; лист,
// «несколько листов» и ручки остаются у сервиса; 3) переадресация выключается — прежние страницы открываются как
// раньше (дальше с ними сверяется live-sections.mjs). Подмен в браузере нет.
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const arg = (name) => {
	const i = process.argv.indexOf(`--${name}`);
	return i > 0 ? process.argv[i + 1] : undefined;
};
const state = JSON.parse(readFileSync(arg('state'), 'utf8'));
const { folder } = JSON.parse(readFileSync(arg('case'), 'utf8'));
const compose = (arg('compose') ?? '').split(' ').filter(Boolean);
const out = arg('out');
if (out) mkdirSync(out, { recursive: true });
const base = state.base;
const NEW_CASE = `/case/${folder}`;
const OLD_CASE = `/legal-tools/case/${folder}`;
let fails = 0;
const ok = (cond, what) => {
	console.log(`${cond ? 'OK  ' : 'FAIL'} ${what}`);
	if (!cond) fails += 1;
	return !!cond;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const one = (s) =>
	String(s ?? '')
		.replace(/\s+/g, ' ')
		.trim();
async function api(method, path, token, body) {
	const r = await fetch(base + path, {
		method,
		redirect: 'manual',
		headers: {
			Accept: 'application/json',
			...(body ? { 'Content-Type': 'application/json' } : {}),
			...(token ? { Authorization: `Bearer ${token}` } : {})
		},
		body: body ? JSON.stringify(body) : undefined
	});
	const text = await r.text();
	let data = null;
	try {
		data = text ? JSON.parse(text) : null;
	} catch {
		data = text.slice(0, 200);
	}
	return { status: r.status, data, location: r.headers.get('location') };
}
const owner = (
	await api('POST', '/api/v1/auths/signin', null, {
		email: state.emails.owner,
		password: state.password
	})
).data;
async function step(name, fn) {
	try {
		await fn();
	} catch (e) {
		ok(
			false,
			`${name}: шаг оборвался — ${String(e?.message ?? e)
				.split('\n')[0]
				.slice(0, 240)}`
		);
	}
}
/** Настройка переадресации в своей среде: сервис страницы перезапускается с новым значением. */
async function redirect(on) {
	execFileSync(compose[0], [...compose.slice(1), 'up', '-d', '--pull', 'never', 'tools'], {
		env: { ...process.env, LIVE_REDIRECT: on ? 'true' : 'false' },
		stdio: 'ignore'
	});
	for (let i = 0; i < 90; i++) {
		await sleep(2000);
		const r = await api('GET', '/legal-tools/health').catch(() => ({ status: 0 }));
		if (r.status === 200) return;
	}
	throw new Error('сервис не поднялся после смены настройки');
}

const browser = await chromium.launch({
	executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined
});
/** Окно вошедшего юриста: вход чата — в хранилище браузера, вход сервиса — в cookie (как после входа формой). */
async function signedContext(options = {}) {
	const context = await browser.newContext({
		viewport: { width: 1280, height: 1000 },
		locale: 'ru-RU',
		...options
	});
	await context.addCookies([{ name: 'token', value: owner.token, url: base }]);
	await context.addInitScript((t) => localStorage.setItem('token', t), owner.token);
	return context;
}

// ================================================================ время открытия: прежние и новые страницы
// готовая страница — когда на ней есть данные дела: сводка обзора (новая) и тома дела (прежняя); список папок с делами
const PAGES = [
	['«Мои дела», прежняя', '/legal-tools/case/', 'main#app table tbody tr'],
	[
		'«Мои дела», новая',
		'/case',
		'[data-testid="my-cases"][data-phase="ready"] [data-testid="case-folder"]'
	],
	['дело, прежняя', OLD_CASE, '#sec-volumes .volume'],
	[
		'дело, новая',
		NEW_CASE,
		'[data-testid="case-summary"]:not([data-state="loading"]):not([data-state="error"])'
	]
];
const timing = {};
await step('время открытия', async () => {
	const open = async (page, path, ready) => {
		const t0 = Date.now();
		await page.goto(base + path, { waitUntil: 'commit' });
		await page.waitForSelector(ready, { timeout: 60000 });
		return Date.now() - t0;
	};
	// прогрев самой среды (первый запрос после запуска сервисов в замер не идёт)
	{
		const context = await signedContext();
		const page = await context.newPage();
		for (const [, path, ready] of PAGES) await open(page, path, ready);
		await context.close();
	}
	for (const [name, path, ready] of PAGES) {
		const cold = [];
		const warm = [];
		for (let i = 0; i < 3; i++) {
			// пустой кэш: новое окно браузера без сохранённых файлов
			const context = await signedContext();
			const page = await context.newPage();
			cold.push(await open(page, path, ready));
			if (i === 0) {
				// тёплый кэш: та же страница ещё три раза в том же окне
				for (let k = 0; k < 3; k++) warm.push(await open(page, path, ready));
			}
			await context.close();
		}
		timing[name] = { cold, warm };
		const mid = (list) => [...list].sort((a, b) => a - b)[1];
		console.log(
			`ВРЕМЯ ${name}: пустой кэш — ${cold.join(', ')} мс (середина ${mid(cold)}); тёплый — ${warm.join(', ')} мс (середина ${mid(warm)})`
		);
	}
	ok(
		Object.keys(timing).length === 4,
		'время открытия замерено: по три замера с пустым и с тёплым кэшем у четырёх страниц'
	);
	if (out) writeFileSync(join(out, 'timing.json'), JSON.stringify(timing, null, 1));
});

// ================================================================ переадресация включена
const context = await signedContext({ permissions: [] });
const page = await context.newPage();
const newCase = () => page.waitForSelector('[data-testid="case-summary"]', { timeout: 60000 });
await step('переадресация включена', async () => {
	await redirect(true);
	// старая ссылка на «Мои дела»
	await page.goto(base + '/legal-tools/case/');
	await page.waitForSelector('[data-testid="my-cases"][data-phase="ready"]', { timeout: 60000 });
	ok(
		new URL(page.url()).pathname === '/case',
		`старая ссылка на «Мои дела» (/legal-tools/case/) открыла новую страницу: ${new URL(page.url()).pathname}`
	);
	await page.goto(base + '/legal-tools/case');
	await page.waitForSelector('[data-testid="my-cases"]', { timeout: 60000 });
	ok(new URL(page.url()).pathname === '/case', 'то же без косой черты в конце');
	// старая ссылка на дело
	await page.goto(base + OLD_CASE);
	await newCase();
	ok(
		new URL(page.url()).pathname === NEW_CASE,
		`старая ссылка на дело открыла новую страницу дела: ${new URL(page.url()).pathname.replace(folder, '<папка>')}`
	);
	if (out) await page.screenshot({ path: join(out, 'live-redirect-case.png') });
	// старая ссылка на раздел дела (метка #sec-check из прежних ссылок)
	await page.goto('about:blank');
	await page.goto(`${base}${OLD_CASE}#sec-check`);
	await page.waitForSelector('[data-testid="case-check"]', { timeout: 60000 });
	ok(
		new URL(page.url()).pathname === `${NEW_CASE}/check`,
		'старая ссылка с меткой раздела (#sec-check) открыла раздел «Проверьте листы» новой страницы'
	);
	// адрес дела, который получает модель в блоке дела (urls.case_url, считается в контейнере сервиса)
	const modelUrl = execFileSync(
		compose[0],
		[
			...compose.slice(1),
			'exec',
			'-T',
			'tools',
			'python',
			'-c',
			`from legal_tools.case import urls; from legal_tools.settings import get_settings; print(urls.case_url(get_settings().receipt_page_base, "${folder}"))`
		],
		{ encoding: 'utf8' }
	).trim();
	await page.goto('about:blank');
	await page.goto(new URL(modelUrl, base).toString());
	await newCase();
	ok(
		modelUrl === OLD_CASE && new URL(page.url()).pathname === NEW_CASE,
		`адрес дела из блока дела для модели (${modelUrl.replace(folder, '<папка>')} — прежний) открыл новую страницу`
	);
	// с листа: «← название дела»
	const d = (await api('GET', `/legal-tools/api/cases/${folder}`, owner.token)).data;
	const vol = d.overview.volumes[0];
	const pages = (
		await api('GET', `/legal-tools/api/cases/${folder}/pages?volume=${vol.id}`, owner.token)
	).data.pages;
	const sheet = await page.goto(`${base}${OLD_CASE}/p/${pages[1].id}`);
	await page.waitForSelector('body.g[data-page="sheet"]');
	ok(
		sheet.status() === 200 && new URL(page.url()).pathname === `${OLD_CASE}/p/${pages[1].id}`,
		'лист остаётся страницей сервиса по прежнему адресу (не переадресуется)'
	);
	const back = one(await page.locator('.head a.ref.only-w').first().textContent());
	await page.locator('.head a.ref.only-w').first().click();
	await newCase();
	ok(new URL(page.url()).pathname === NEW_CASE, `с листа «${back}» привела на новую страницу дела`);
	// «несколько листов» и ручки — у сервиса
	const ref = await context.request.get(`${base}${OLD_CASE}/ref?t=999&l=1`, { maxRedirects: 0 });
	const list = await api('GET', '/legal-tools/api/cases', owner.token);
	const one1 = await api('GET', `/legal-tools/api/cases/${folder}`, owner.token);
	ok(
		ref.status() === 404 &&
			(await ref.text()).includes('data-page="ref"') &&
			list.status === 200 &&
			one1.status === 200 &&
			!list.location &&
			!one1.location,
		'«несколько листов» и ручки сервиса отвечают сами, без переадресации'
	);
	const raw = await api('GET', OLD_CASE, owner.token);
	ok(
		raw.status === 302 && raw.location === `${base}${NEW_CASE}`,
		`ответ сервиса на старый адрес дела: ${raw.status} → ${String(raw.location).replace(folder, '<папка>')}`
	);
	// не вошедший юрист: старая ссылка → новая страница → вход чата
	const anon = await browser.newContext({
		viewport: { width: 1280, height: 900 },
		locale: 'ru-RU'
	});
	const p = await anon.newPage();
	await p.goto(base + OLD_CASE);
	await p.waitForURL((url) => url.pathname === '/auth', { timeout: 30000 });
	await p.locator('input[type="email"]').fill(state.emails.owner);
	await p.locator('input[type="password"]').fill(state.password);
	await p.locator('button[type="submit"]').click();
	await p.waitForSelector('[data-testid="case-summary"]', { timeout: 60000 });
	ok(
		new URL(p.url()).pathname === NEW_CASE,
		'без входа: старая ссылка на дело ведёт на вход чата, после входа открыта новая страница дела'
	);
	await anon.close();
});

// ================================================================ переадресация выключена: прежние страницы как раньше
await step('переадресация выключена', async () => {
	await redirect(false);
	await page.goto(base + OLD_CASE);
	await page.waitForSelector('#sec-volumes .volume', { timeout: 60000 });
	ok(
		new URL(page.url()).pathname === OLD_CASE && (await page.locator('body.g').count()) === 0,
		'выключено: старый адрес дела открывает прежнюю страницу сервиса (тома дела на месте)'
	);
	await page.goto(base + '/legal-tools/case/');
	await page.waitForSelector('main#app table tbody tr', { timeout: 60000 });
	ok(
		new URL(page.url()).pathname === '/legal-tools/case/',
		'выключено: старый адрес «Моих дел» открывает прежнюю страницу'
	);
	const raw = await api('GET', OLD_CASE, owner.token);
	ok(
		raw.status === 200 && !raw.location,
		'выключено: сервис отвечает прежней страницей, без переадресации'
	);
	// новые страницы при этом тоже работают (выключатель их не касается)
	await page.goto(base + NEW_CASE);
	await newCase();
	ok(
		new URL(page.url()).pathname === NEW_CASE,
		'новая страница дела открывается и при выключенной переадресации'
	);
});

await browser.close();
console.log(`переадресация: ${fails ? `FAIL — не прошло ${fails}` : 'все проверки OK'}`);
process.exit(fails ? 1 : 0);
