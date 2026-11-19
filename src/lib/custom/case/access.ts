/* ai-dvokat: открыты ли «Дела» этому юристу — для пункта «Дела» в левой панели чата. Сервис отвечает ручкой
   `GET <база>/api/cases/access` (выпуск включён и юрист в группе выпуска). Спрашивается один раз за сеанс на токен;
   сервис не ответил, ответил отказом или долго молчит — пункта нет, чат при этом ничего не ждёт. */
import { legalToolsBase } from '../jobs';

const answers = new Map<string, Promise<boolean>>();
const TIMEOUT_MS = 8000;

export function caseAccess(
	config: unknown,
	deps: { fetcher?: typeof fetch; token?: string | null } = {}
): Promise<boolean> {
	let token = deps.token;
	if (token === undefined) {
		try {
			token = localStorage.getItem('token');
		} catch {
			token = null;
		}
	}
	if (!token) return Promise.resolve(false);
	const base = legalToolsBase(config);
	const key = `${base}|${token}`;
	const known = answers.get(key);
	if (known) return known;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
	const asked = (deps.fetcher ?? fetch)(`${base}/api/cases/access`, {
		headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
		credentials: 'same-origin',
		redirect: 'error',
		cache: 'no-store',
		signal: controller.signal
	})
		.then(async (r) => (r.ok ? (await r.json())?.case === true : false))
		.catch(() => false)
		.finally(() => clearTimeout(timer));
	answers.set(key, asked);
	// «нет» из-за сбоя не запоминается: следующий показ панели спросит снова
	void asked.then((yes) => {
		if (!yes) answers.delete(key);
	});
	return asked;
}
