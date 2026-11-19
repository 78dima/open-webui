// Стенд компонентов: вместо переходов SvelteKit (`$app/navigation`) — запись, куда пошли бы (проверки читают её).
export const goto = async (path: string) => {
	((window as any).__goto ??= []).push(path);
};
export const beforeNavigate = () => undefined;
export const afterNavigate = () => undefined;
