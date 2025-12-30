export interface WorkflowMetadata {
	id: string;
	label?: string;
	category?: string;
	includeInAll?: boolean;
}

export function extractWorkflowMetadata(
	source: unknown,
): WorkflowMetadata | undefined {
	if (!source || typeof source !== "object") {
		return undefined;
	}
	const record = source as Record<string, unknown>;
	const workflow = record.workflow;
	if (!workflow || typeof workflow !== "object") {
		return undefined;
	}
	const workflowRecord = workflow as Record<string, unknown>;
	const id = typeof workflowRecord.id === "string" ? workflowRecord.id : undefined;
	if (!id) {
		return undefined;
	}
	return {
		id,
		label: typeof workflowRecord.label === "string" ? workflowRecord.label : undefined,
		category:
			typeof workflowRecord.category === "string" ? workflowRecord.category : undefined,
		includeInAll:
			typeof workflowRecord.includeInAll === "boolean"
				? workflowRecord.includeInAll
				: undefined,
	};
}
