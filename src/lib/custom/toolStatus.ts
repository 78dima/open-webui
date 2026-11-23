import { hideFor } from './visibility';
import ru from './locales/ru-RU.json' with { type: 'json' };

/** Plain tool status for legal users: one Russian line per call, no tool names, arguments or results.
 * Tool names follow legal-tools MCP (tools/src/legal_tools/mcp/server.py, 2026-11-08); Open WebUI
 * prefixes them with the server id, e.g. `legal-tools_kplus_search`.
 */
export type ToolState = 'active' | 'done' | 'error' | 'rejected' | 'approval' | 'input';
type Label = { noun: string; active: string; done: string };

const text = ru.tool_status;
const TOOLS: Record<string, Label> = text.tools;
/** Longest first, so a prefixed name resolves to the most specific tool. */
export const TOOL_NAMES = Object.keys(TOOLS).sort((a, b) => b.length - a.length);

/** Presentation only, `custom_ui.hide.tool_details` for role user; admin keeps the upstream block. */
export function plainToolStatus(raw: unknown, role: string | undefined): boolean {
	return hideFor(raw, role, 'tool_details');
}

export function toolKey(name: unknown): string | undefined {
	if (typeof name !== 'string') return undefined;
	return TOOL_NAMES.find((key) => name === key || name.endsWith(`_${key}`));
}

function label(name: unknown): Label {
	const key = toolKey(name);
	return key ? TOOLS[key] : text.generic;
}

export function toolStatusLabel(name: unknown, state: ToolState): string {
	const item = label(name);
	if (state === 'active') return item.active;
	if (state === 'done') return item.done;
	if (state === 'input') return text.states.input;
	return text.states[state].replace('{noun}', item.noun);
}

/** Same state precedence as upstream ToolCallDisplay, with errors made explicit in the text. */
export function toolState(flags: {
	rejected?: boolean;
	error?: boolean;
	done?: boolean;
	input?: boolean;
	approval?: boolean;
}): ToolState {
	if (flags.rejected) return 'rejected';
	if (flags.error) return 'error';
	if (flags.done) return 'done';
	if (flags.input) return 'input';
	if (flags.approval) return 'approval';
	return 'active';
}

/** Group summary such as «Выполнено: поиск в КонсультантПлюс (2), оглавление документа».
 * `preparing` — the calls of the group are done while the message itself is not finished yet (the model is
 * working on the answer): «Выполнено, готовлю ответ: …» instead of a final-looking «Выполнено: …». */
export function toolGroupText(
	names: unknown[],
	active: boolean,
	error = false,
	preparing = false
): { prefix: string; detail: string } {
	const counts = new Map<string, number>();
	for (const name of names) {
		const noun = label(name).noun;
		counts.set(noun, (counts.get(noun) ?? 0) + 1);
	}
	const detail = [...counts]
		.map(([noun, count]) =>
			count > 1 ? text.group.count.replace('{noun}', noun).replace('{count}', String(count)) : noun
		)
		.join(', ');
	return {
		prefix: active
			? text.group.active
			: error
				? text.group.error
				: preparing
					? text.group.preparing
					: text.group.done,
		detail
	};
}
