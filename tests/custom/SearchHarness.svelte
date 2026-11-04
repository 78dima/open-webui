<script lang="ts">
	// The real upstream global search with the fork's filter (B5+).
	import { setContext } from 'svelte';
	import { writable } from 'svelte/store';
	import SearchModal from '../../src/lib/components/layout/SearchModal.svelte';
	import { settings } from './stores';
	setContext('i18n', writable({ t: (key: string) => key, language: 'ru-RU' }));
	settings.set({});
</script>

<SearchModal show={true} />
