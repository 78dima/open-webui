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
	'models'
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
