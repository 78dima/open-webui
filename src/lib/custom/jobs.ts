import { readCustomUI } from './config';
import type { Job, Source, Finding, Edit, Artifact } from './types';

const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
export const isJobId = (value: unknown): value is string =>
	typeof value === 'string' && new RegExp(`^${uuid}$`, 'i').test(value);
// U1: only the terminal marker emitted by Pipe, never UUIDs in arbitrary prose/code.
const terminalMarker = new RegExp(`\\s*<!-- legal-tools:job=(${uuid}) -->\\s*$`, 'i');
export function jobIdFromMessage(content: unknown): string | undefined {
	if (typeof content !== 'string') return;
	const marker = content.match(terminalMarker);
	if (marker) return marker[1].toLowerCase();
	const legacy = content.match(
		new RegExp(
			`^Задание (${uuid}) ещё выполняется\\. Результат появится в этом чате после завершения \\(обновите страницу\\)\\.\\s*$`,
			'i'
		)
	);
	return legacy?.[1].toLowerCase();
}
/** R4: hide the terminal U1 marker from people; the stored message keeps it for B2 and Pipe.
 * Removes exactly what jobIdFromMessage recognizes, with the blank lines before it. */
export function stripJobMarker<T>(content: T): T {
	return (typeof content === 'string' ? content.replace(terminalMarker, '') : content) as T;
}
type OutputPart = { text?: unknown };
const partText = (part: OutputPart | null | undefined) =>
	part?.text === undefined || part?.text === null ? '' : String(part.text);
/** The same for structured output: the marker ends the last non-empty message item. */
export function stripJobMarkerFromOutput<T>(output: T): T {
	if (!Array.isArray(output)) return output;
	for (let index = output.length - 1; index >= 0; index--) {
		const item = output[index];
		if (item?.type !== 'message' || !Array.isArray(item.content)) continue;
		const text = item.content.map(partText).join('');
		if (!text.trim()) continue;
		let cut = text.length - stripJobMarker(text).length;
		if (!cut) return output;
		const content = [...item.content];
		for (let i = content.length - 1; i >= 0 && cut > 0; i--) {
			const value = partText(content[i]);
			if (!value) continue;
			const keep = Math.max(0, value.length - cut);
			cut -= value.length - keep;
			content[i] = { ...content[i], text: value.slice(0, keep) };
		}
		const copy = [...output];
		copy[index] = { ...item, content };
		return copy as T;
	}
	return output;
}
const record = (v: unknown): Record<string, unknown> =>
	v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const text = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const strings = (v: unknown): string[] => list(v).filter((x): x is string => typeof x === 'string');
const number = (v: unknown): number | undefined =>
	typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined;
const date = (v: unknown): string | undefined =>
	typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v : undefined;
export function safeSourceURL(value: unknown): string | undefined {
	if (typeof value !== 'string') return;
	try {
		const url = new URL(value);
		return ['https:', 'http:'].includes(url.protocol) ? url.href : undefined;
	} catch {
		return;
	}
}
export function normalizeSources(value: unknown): Source[] {
	return list(value)
		.map((raw) => {
			const s = record(raw),
				old = record(s.source),
				meta = record(list(s.metadata)[0]);
			return {
				label: text(s.citation_label) ?? text(s.label) ?? text(old.name) ?? '',
				receipt_id: text(s.receipt_id) ?? text(meta.receipt_id),
				edition: text(s.edition_date) ?? text(s.edition),
				fragment: text(s.canonical_text) ?? text(list(s.document)[0]),
				url: safeSourceURL(s.kplus_url ?? old.url)
			};
		})
		.filter((s) => s.label || s.receipt_id);
}
const severity = (v: unknown) =>
	['high', 'medium', 'low'].includes(String(v)) ? (v as Finding['severity']) : undefined;
const artifactsOf = (value: unknown): Artifact[] =>
	list(value).flatMap((v) => {
		const a = record(v);
		if (!isJobId(a.id)) return [];
		return [{ id: a.id, name: text(a.filename) ?? text(a.name) ?? a.id, size: number(a.size) }];
	});
/** U5 schema_version=1: GET /api/jobs/{id} → structured (terminal jobs only). */
function normalizeV1(raw: Record<string, unknown>, s: Record<string, unknown>, id: string): Job {
	const usage = record(s.usage);
	const findings = list(s.findings).flatMap((v) => {
		const f = record(v);
		if (typeof f.claim !== 'string') return [];
		const locations = list(f.locations).flatMap((l) => {
			const loc = record(l);
			return typeof loc.element_id === 'string'
				? [{ element_id: loc.element_id, doc: text(loc.doc), page: number(loc.page) }]
				: [];
		});
		return [
			{
				claim: f.claim,
				severity: severity(f.severity),
				element_ids: locations.map((l) => l.element_id),
				locations
			}
		];
	});
	const edits = list(s.edits).flatMap((v) => {
		const e = record(v);
		if (typeof e.element_id !== 'string') return [];
		return [
			{
				element_id: e.element_id,
				before: text(e.before),
				after: text(e.after),
				rationale: text(e.rationale),
				status: text(e.status)
			}
		];
	});
	const sources: Source[] = list(s.sources)
		.map((v) => {
			const src = record(v);
			return {
				label: text(src.name) ?? '',
				receipt_id: isJobId(src.receipt_id) ? src.receipt_id : undefined,
				fragment: text(src.excerpt),
				url: safeSourceURL(src.url)
			};
		})
		.filter((src) => src.label || src.receipt_id);
	return {
		id,
		status: text(s.status) ?? String(raw.status),
		schema_version: '1',
		summary: text(record(s.report).summary),
		findings,
		edits,
		artifacts: artifactsOf(raw.artifacts),
		sources,
		gaps: strings(s.gaps),
		partial_reason: text(s.partial_reason),
		spent_usd: number(usage.spent_usd) ?? number(raw.spent_usd),
		unknown_usage: usage.unknown === true || raw.unknown_usage === true,
		created_at: date(raw.created_at),
		finished_at: date(raw.finished_at)
	};
}
export function normalizeJob(value: unknown, expectedId: string): Job {
	const raw = record(value);
	if (raw.id !== expectedId || typeof raw.status !== 'string') throw new Error('invalid');
	const result = record(raw.result),
		report = record(result.report),
		structured = record(raw.structured);
	if (raw.structured != null) {
		// Fields are only added within a version; any other version needs its own adapter.
		if (structured.schema_version !== 1 || structured.job_id !== expectedId)
			throw new Error('unsupported schema');
		return normalizeV1(raw, structured, expectedId);
	}
	const version = raw.schema_version ?? result.schema_version;
	if (version != null && version !== 'legacy-unversioned') throw new Error('unsupported schema');
	const findings = Array.isArray(result.findings)
		? result.findings.flatMap((v) => {
				const f = record(v);
				if (typeof f.claim !== 'string') return [];
				return [
					{ claim: f.claim, element_ids: strings(f.element_ids), severity: severity(f.severity) } as Finding
				];
			})
		: undefined;
	const edits = Array.isArray(result.edits)
		? result.edits.flatMap((v) => {
				const e = record(v);
				if (typeof e.element_id !== 'string') return [];
				return [
					{
						element_id: e.element_id,
						before: text(e.before),
						after: text(e.after),
						rationale: text(e.rationale)
					} as Edit
				];
			})
		: undefined;
	return {
		id: expectedId,
		status: raw.status,
		schema_version: text(raw.schema_version ?? result.schema_version),
		summary: text(report.summary) ?? text(result.summary),
		findings,
		edits,
		artifacts: artifactsOf(raw.artifacts),
		sources: normalizeSources(result.sources),
		gaps: strings(result.gaps),
		spent_usd: number(raw.spent_usd),
		unknown_usage: raw.unknown_usage === true,
		created_at: date(raw.created_at),
		finished_at: date(raw.finished_at)
	};
}
export class JobRequestError extends Error {
	constructor(public kind: 'auth' | 'forbidden' | 'unavailable' | 'invalid') {
		super(kind);
	}
}
export function legalToolsBase(config: unknown): string {
	return readCustomUI(config).legal_tools_base ?? '/legal-tools';
}
async function authorizedFetch(path: string, signal: AbortSignal): Promise<Response> {
	const token = localStorage.getItem('token');
	if (!token) throw new JobRequestError('auth');
	const response = await fetch(path, {
		headers: { Authorization: `Bearer ${token}` },
		credentials: 'same-origin',
		redirect: 'error',
		cache: 'no-store',
		signal
	});
	if (!response.ok)
		throw new JobRequestError(
			response.status === 401 ? 'auth' : response.status === 403 ? 'forbidden' : 'unavailable'
		);
	return response;
}
export async function fetchJob(base: string, id: string, signal: AbortSignal): Promise<Job> {
	if (!isJobId(id) || legalToolsBase({ legal_tools_base: base }) !== base)
		throw new JobRequestError('invalid');
	const response = await authorizedFetch(`${base}/api/jobs/${id}`, signal);
	try {
		return normalizeJob(await response.json(), id);
	} catch {
		throw new JobRequestError('invalid');
	}
}
export async function downloadArtifact(
	base: string,
	jobId: string,
	artifact: Artifact,
	signal: AbortSignal
) {
	if (
		!isJobId(jobId) ||
		!isJobId(artifact.id) ||
		legalToolsBase({ legal_tools_base: base }) !== base
	)
		throw new JobRequestError('invalid');
	const response = await authorizedFetch(
		`${base}/api/jobs/${jobId}/artifacts/${artifact.id}`,
		signal
	);
	const url = URL.createObjectURL(await response.blob());
	const anchor = document.createElement('a');
	anchor.href = url;
	anchor.download = artifact.name.replace(/[\\/\x00-\x1f]/g, '_');
	document.body.append(anchor);
	anchor.click();
	anchor.remove();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function elapsedSeconds(job: Job): number | undefined {
	if (!job.created_at || !job.finished_at) return;
	const delta = Date.parse(job.finished_at) - Date.parse(job.created_at);
	return delta >= 0 ? Math.round(delta / 1000) : undefined;
}
