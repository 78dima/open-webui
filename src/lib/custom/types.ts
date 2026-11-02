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
