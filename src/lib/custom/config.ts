/** Public configuration only. Missing or malformed flags keep upstream behavior.
 * Owner 05.11: start, receipt_panel, case and hide are gone (standard Open WebUI tools instead). */
export type CustomUI = {
	hello?: boolean;
	brand?: {
		name?: string;
		suffix?: boolean;
		about?: boolean;
		community?: boolean;
	};
	result_card?: boolean;
	legal_tools_base?: string;
};

const object = (value: unknown): Record<string, unknown> | undefined =>
	value !== null && typeof value === 'object' && !Array.isArray(value)
		? value as Record<string, unknown>
		: undefined;

/** Do not coerce strings such as "true" into enabled features. */
export function readCustomUI(value: unknown): CustomUI {
	const raw = object(value);
	const result: CustomUI = {};
	if (!raw) return result;
	for (const key of ['hello', 'result_card'] as const) {
		if (typeof raw[key] === 'boolean') result[key] = raw[key];
	}
	const brand = object(raw.brand);
	if (brand) {
		result.brand = {};
		if (typeof brand.name === 'string' && brand.name.trim()) {
			result.brand.name = brand.name.trim();
		}
		for (const key of ['suffix', 'about', 'community'] as const) {
			if (typeof brand[key] === 'boolean') result.brand[key] = brand[key];
		}
	}
	// Restrict authenticated requests to a same-origin path; no query, fragment or traversal.
	if (typeof raw.legal_tools_base === 'string' &&
		/^\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\/?$/.test(raw.legal_tools_base)) {
		result.legal_tools_base = raw.legal_tools_base.replace(/\/$/, '');
	}
	return result;
}
