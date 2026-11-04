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
