/** B2 view of GET /api/jobs/{id}. Two inputs: U5 `structured` with schema_version=1
 * (jobs/result_schema.py, checked against the stand 05.11.2026, legal-tools f750f53)
 * and the older unversioned `result`. Other versions need an explicit adapter.
 * Optional fields are never reconstructed from prose or presented as verified facts.
 */
export type Location = { element_id: string; doc?: string; page?: number };
export type Finding = {
	claim: string;
	severity?: 'high' | 'medium' | 'low';
	element_ids: string[];
	locations?: Location[];
};
export type Edit = {
	element_id: string;
	before?: string;
	after?: string;
	rationale?: string;
	status?: string;
};
export type Source = {
	label: string;
	receipt_id?: string;
	edition?: string;
	fragment?: string;
	url?: string;
};
export type Artifact = { id: string; name: string; size?: number };
export type Job = {
	id: string;
	status: string;
	schema_version?: string;
	summary?: string;
	findings?: Finding[];
	edits?: Edit[];
	sources: Source[];
	artifacts: Artifact[];
	gaps: string[];
	partial_reason?: string;
	spent_usd?: number;
	unknown_usage: boolean;
	created_at?: string;
	finished_at?: string;
};

/** U2 GET /api/receipts/{id} (api_extra.py), checked against the stand 05.11.2026.
 * Foreign and missing receipts both answer 403. edition_date is DD.MM.YYYY;
 * verify_status is always null for now (no verification semantics yet).
 */
export type Receipt = {
	id: string;
	endpoint?: string;
	base?: string;
	nd?: number;
	dst?: number;
	edition_date?: string;
	edition_status?: string;
	para_from?: number;
	para_to?: number;
	/** The stored receipt fragment (at most 32 KiB). */
	canonical_text: string;
	citation?: string;
	citation_label?: string;
	doc_title?: string;
	kplus_url?: string;
	fetched_at?: string;
	base_updated_on?: string;
	verify_status?: string;
};
/** U3 GET /api/jobs?folder_id=&limit=&cursor= → {items, next_cursor}; own jobs only, newest first. */
export type CaseArtifact = { id: string; kind?: string; name: string; size?: number };
export type CaseJob = {
	id: string;
	kind: string;
	status: string;
	created_at?: string;
	finished_at?: string;
	spent_usd?: number;
	artifacts: CaseArtifact[];
};
export type CaseJobsPage = { items: CaseJob[]; next_cursor?: string };
/** U4 GET /api/jobs/{id}/artifacts → [{id, kind, filename, size, sha256, owui_file_id, mime}]. */
export type JobArtifact = CaseArtifact & { sha256?: string; mime?: string; owui_file_id?: string };
/** Open WebUI GET /api/v1/folders/{id}: items attached to the folder in its Knowledge. */
export type FolderItem = { id: string; type: 'note' | 'file' | 'collection' | string; name: string };
