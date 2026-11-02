<script lang="ts">
	import Result from '../../src/lib/components/custom/Result.svelte';
	import { resultMessage } from './stores';
</script>

<Result {...$resultMessage}><p data-testid="original-answer">{$resultMessage.content}</p></Result>
