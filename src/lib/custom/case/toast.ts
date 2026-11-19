/* ai-dvokat: всплывающее сообщение страниц «Дел»: обычное исчезает через 2,5 с, об ошибке — через 6 с (как на прежней
   странице, inventory § 0.2). Показывает svelte-sonner форка, вид — компонент Toast (вариант «Г»). */
import { toast } from 'svelte-sonner';
import Toast from '$lib/components/custom/case/Toast.svelte';

export function caseToast(text: string, error = false) {
	// типы svelte-sonner 0.3 не знают свойств своего компонента — отсюда приведение
	const options = {
		componentProps: { text, error },
		duration: error ? 6000 : 2500,
		position: 'bottom-center'
	};
	toast.custom(Toast as never, options as never);
}
