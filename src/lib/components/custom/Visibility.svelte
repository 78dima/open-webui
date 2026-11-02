<script lang="ts">
	import { onDestroy } from 'svelte';
	import { config, user } from '$lib/stores';
	import { HIDE_KEYS, hideFor } from '$lib/custom/visibility';
	$: if (typeof document !== 'undefined') {
		const flags = HIDE_KEYS.filter((key) => hideFor($config?.custom_ui, $user?.role, key));
		if (flags.length) document.documentElement.setAttribute('data-custom-hide', flags.join(' '));
		else document.documentElement.removeAttribute('data-custom-hide');
	}
	onDestroy(() => {
		if (typeof document !== 'undefined')
			document.documentElement.removeAttribute('data-custom-hide');
	});
</script>
