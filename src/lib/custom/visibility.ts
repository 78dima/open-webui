import { readCustomUI, type CustomUI } from './config';
export type HideKey = keyof NonNullable<CustomUI['hide']>;
export const HIDE_KEYS: HideKey[] = [
	'workspace_tools',
	'workspace_functions',
	'workspace_prompts',
	'settings_audio',
	'settings_images',
	'settings_code_interpreter',
	'temporary_chat',
	'arena',
	'models',
	'notes',
	'channels',
	'automations'
];
export const LEGAL_MODELS = [
	'jurist-rf',
	'jurist-rf-deep',
	'legal_workflows.contract_review',
	'legal_workflows.compare_versions',
	'legal_workflows.legal_opinion',
	'legal_workflows.draft_document',
	'legal_workflows.clean_copy'
] as const;
/** Presentation only: this does not grant or revoke backend permissions. */
export function hideFor(raw: unknown, role: string | undefined, key: HideKey): boolean {
	return role === 'user' && readCustomUI(raw).hide?.[key] === true;
}
export function modelVisible(
	model: { id: string; owned_by?: string },
	raw: unknown,
	role?: string
): boolean {
	if (hideFor(raw, role, 'models') && !(LEGAL_MODELS as readonly string[]).includes(model.id))
		return false;
	return !(hideFor(raw, role, 'arena') && model.owned_by === 'arena');
}
export function hideSettingsTab(id: string, raw: unknown, role?: string): boolean {
	const flags: Record<string, HideKey> = {
		audio: 'settings_audio',
		images: 'settings_images',
		code: 'settings_code_interpreter'
	};
	return !!flags[id] && hideFor(raw, role, flags[id]);
}
export function hideSetting(key: string, raw: unknown, role?: string): boolean {
	return (
		(hideFor(raw, role, 'temporary_chat') &&
			/\.(temporaryChatByDefault|newTemporaryChat)\./.test(key)) ||
		(hideFor(raw, role, 'settings_audio') &&
			(key.startsWith('settings.personal.audio.') ||
				(key.startsWith('settings.personal.interface.') &&
					/\.(sections\.voice|allowVoiceInterruptionInCall|displayEmojiInCall)\./.test(key))))
	);
}
/** Sidebar menu items (Sidebar.svelte isMenuItemVisible). */
export function hideMenuItem(id: unknown, raw: unknown, role?: string): boolean {
	return (id === 'notes' || id === 'automations') && hideFor(raw, role, id);
}
/** Upstream UI visibility controls (ui-visibility.ts isControlVisible). */
export function hideControl(id: string, raw: unknown, role?: string): boolean {
	return id === 'chat.attach_notes' && hideFor(raw, role, 'notes');
}
type SearchResponseShape = {
	items?: { kind?: string }[];
	kinds?: string[];
	scopes?: { kind?: string }[];
};
/** Global search: notes and channel messages are found by the server, hidden here. */
export function hideSearchResults<T extends SearchResponseShape>(response: T, raw: unknown, role?: string): T {
	const kinds = [
		...(hideFor(raw, role, 'notes') ? ['note'] : []),
		...(hideFor(raw, role, 'channels') ? ['message'] : [])
	];
	if (!kinds.length || !response) return response;
	response.items = (response.items ?? []).filter((item) => !kinds.includes(String(item?.kind)));
	response.kinds = (response.kinds ?? []).filter((kind) => !kinds.includes(kind));
	if (kinds.includes('message'))
		response.scopes = (response.scopes ?? []).filter((scope) => scope?.kind !== 'channel');
	return response;
}
