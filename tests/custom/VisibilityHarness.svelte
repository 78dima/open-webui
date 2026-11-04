<script lang="ts">
	import { config, user, models } from './stores';
	import Visibility from '../../src/lib/components/custom/Visibility.svelte';
	import { modelVisible, hideFor, hideSettingsTab } from '../../src/lib/custom/visibility';
</script>

<Visibility />
<a href="/workspace/tools">Tools</a><a href="/workspace/functions">Functions</a><a
	href="/workspace/prompts">Prompts</a
>
<a href="/workspace/knowledge">Knowledge</a><a href="/workspace/skills">Skills</a>
<button id="temporary-chat-button">Temporary chat</button>
<!-- Same markup as upstream layout/Sidebar/UserMenu.svelte rows. -->
<div class="user-menu-row"><a role="menuitem" href="/notes">Notes</a><button>Pin notes</button></div>
<div class="user-menu-row"><a role="menuitem" href="/automations">Automations</a><button>Pin automations</button></div>
<div class="user-menu-row"><a role="menuitem" href="/workspace">Workspace</a></div>
{#if !hideSettingsTab('audio', $config?.custom_ui, $user?.role)}<button>Audio settings</button>{/if}
{#if !hideFor($config?.custom_ui, $user?.role, 'settings_images')}<button>Images</button>{/if}
{#if !hideFor($config?.custom_ui, $user?.role, 'settings_code_interpreter')}<button
		>Interpreter</button
	>{/if}
<ul aria-label="Models">
	{#each $models.filter((m) => modelVisible(m, $config?.custom_ui, $user?.role)) as model}<li>
			{model.id}
		</li>{/each}
</ul>
