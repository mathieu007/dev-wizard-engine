import type { IntegrationTimingMetadata } from "./integrationTimings";
import type { WizardState } from "./state";
export interface WorkflowAnalyticsStepEntry {
    label?: string;
    status: "success" | "failed";
    durationMs: number;
    integrationTiming?: IntegrationTimingMetadata;
    capturedOutput?: string;
}
export interface WorkflowAnalyticsEntry {
    id: string;
    label?: string;
    category?: string;
    includeInAll?: boolean;
    status: "success" | "failed";
    durationMs: number;
    steps: readonly WorkflowAnalyticsStepEntry[];
}
export interface WorkflowAnalyticsWriteOptions {
    state: WizardState;
    repoRoot?: string;
}
export declare function writeWorkflowAnalyticsReports(options: WorkflowAnalyticsWriteOptions): Promise<void>;
