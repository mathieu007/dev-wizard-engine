export interface WorkflowMetadata {
    id: string;
    label?: string;
    category?: string;
    includeInAll?: boolean;
}
export declare function extractWorkflowMetadata(source: unknown): WorkflowMetadata | undefined;
