export type IntegrationTimingStatus = "passed" | "failed" | "dry-run";
export interface IntegrationTimingEvent {
    task: string;
    profile: string;
    label?: string;
    durationMs: number;
    status: IntegrationTimingStatus;
}
export interface IntegrationTimingRun {
    profile: string;
    status: IntegrationTimingStatus;
    durationMs: number;
    label?: string;
}
export interface IntegrationTimingTaskSummary {
    task: string;
    label?: string;
    totalDurationMs: number;
    runs: readonly IntegrationTimingRun[];
}
export interface IntegrationTimingSummary {
    totalDurationMs: number;
    tasks: readonly IntegrationTimingTaskSummary[];
}
export interface IntegrationTimingMetadata {
    events: readonly IntegrationTimingEvent[];
    summary: IntegrationTimingSummary;
}
export interface IntegrationTimingSource {
    workflowId: string;
    workflowLabel?: string;
    stepLabel?: string;
    metadata: IntegrationTimingMetadata;
}
export interface IntegrationTimingStepSnapshot {
    label?: string;
    totalDurationMs: number;
    tasks: readonly IntegrationTimingTaskSummary[];
}
export interface IntegrationTimingWorkflowSnapshot {
    id: string;
    label?: string;
    totalDurationMs: number;
    steps: readonly IntegrationTimingStepSnapshot[];
}
export interface IntegrationTimingSnapshot {
    generatedAt: string;
    totalDurationMs: number;
    workflows: readonly IntegrationTimingWorkflowSnapshot[];
    events: readonly IntegrationTimingEvent[];
}
export declare function extractIntegrationTimingMetadata(output: string | undefined): IntegrationTimingMetadata | undefined;
export declare function buildIntegrationTimingSnapshot(generatedAt: string, sources: readonly IntegrationTimingSource[]): IntegrationTimingSnapshot | undefined;
