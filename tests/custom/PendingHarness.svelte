<script lang="ts">
	import CasePanel from '../../src/lib/components/custom/CasePanel.svelte';
	import CaseMenuItem from '../../src/lib/components/custom/CaseMenuItem.svelte';
	const folderId = '55555555-5555-4555-8555-555555555555';
</script>

<nav><CaseMenuItem {folderId} /><CaseMenuItem folderId="not-a-folder-id" /></nav>
<CasePanel {folderId} />
