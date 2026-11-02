/** Observed contract: legal-tools jobs/api.py + review/schemas.py, 2026-11-02.
 * Legacy API is unversioned. U5 has not assigned a schema_version yet.
 * Optional fields are never reconstructed from prose or presented as verified facts.
 */
export type Finding = {
	claim: string;
	severity?: 'high' | 'medium' | 'low';
	element_ids: string[];
};
export type Edit = { element_id: string; before?: string; after?: string; rationale?: string };
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
	spent_usd?: number;
	unknown_usage: boolean;
	created_at?: string;
	finished_at?: string;
};

/** Draft U2–U4 contracts requested on 2026-11-02. No REST transport exists yet.
 * Dates are ISO strings at the API boundary; nullable fields follow stored receipts/jobs.
 * Confirm the actual response schema before replacing the explicit unavailable states.
 */
export type ReceiptResponse = {
	id: string;
	endpoint: string;
	base: string;
	nd: number;
	dst: number | null;
	edition_nd: number | null;
	edition_date: string | null;
	para_from: number | null;
	para_to: number | null;
	/** The original receipt fragment, at most 32 KiB encoded as UTF-8. */
	canonical_text: string;
	citation_label: string | null;
	kplus_url: string;
	fetched_at: string;
	base_updated_on: string | null;
	/** U2 has not specified an enumeration or verification semantics. */
	verify_status?: string | null;
};
export type CaseArtifactSummary = { id: string; kind: string; filename: string; size: number };
export type CaseJobSummary = {
	id: string;
	kind: string;
	status: string;
	created_at: string;
	finished_at: string | null;
	spent_usd: number | null;
	artifacts: CaseArtifactSummary[];
};
export type CaseJobsQuery = { folder_id: string; limit: 50; cursor?: string };
/** U3 requests a list; no pagination response envelope has been agreed yet. */
export type CaseJobsResponse = CaseJobSummary[];
export type JobArtifactListItem = CaseArtifactSummary & { sha256: string; owui_file_id?: string };
export type JobArtifactsResponse = JobArtifactListItem[];
