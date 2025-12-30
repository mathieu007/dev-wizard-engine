export function extractWorkflowMetadata(source) {
    if (!source || typeof source !== "object") {
        return undefined;
    }
    const record = source;
    const workflow = record.workflow;
    if (!workflow || typeof workflow !== "object") {
        return undefined;
    }
    const workflowRecord = workflow;
    const id = typeof workflowRecord.id === "string" ? workflowRecord.id : undefined;
    if (!id) {
        return undefined;
    }
    return {
        id,
        label: typeof workflowRecord.label === "string" ? workflowRecord.label : undefined,
        category: typeof workflowRecord.category === "string" ? workflowRecord.category : undefined,
        includeInAll: typeof workflowRecord.includeInAll === "boolean"
            ? workflowRecord.includeInAll
            : undefined,
    };
}
//# sourceMappingURL=workflowMetadata.js.map