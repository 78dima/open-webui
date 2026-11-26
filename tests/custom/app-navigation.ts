// Стенд компонентов: вместо переходов SvelteKit (`$app/navigation`) — запись, куда пошли бы (проверки читают её),
// и необязательный обработчик стенда (для SPA-переходов в CasePageHarness).
export const goto = async (path: string, opts?: { replaceState?: boolean }) => {
	((window as any).__goto ??= []).push(path);
	const handler = (window as any).__onGoto;
	if (typeof handler === 'function') await handler(path, opts);
};
export const beforeNavigate = () => undefined;
export const afterNavigate = () => undefined;
