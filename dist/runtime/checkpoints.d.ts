import type { WizardState } from "./state";
export interface CheckpointManager {
    runId: string;
    record(state: WizardState, options?: {
        immediate?: boolean;
    }): Promise<void>;
    finalize(state: WizardState, status: CheckpointStatus): Promise<void>;
}
export interface CheckpointManagerOptions {
    repoRoot: string;
    scenarioId: string;
    scenarioLabel: string;
    runId?: string;
    dryRun: boolean;
    interval?: number;
    retention?: number;
}
export type CheckpointStatus = "running" | "completed" | "failed";
export interface CheckpointMetadata {
    id: string;
    path: string;
    scenarioId: string;
    scenarioLabel: string;
    startedAt: string;
    updatedAt: string;
    status: CheckpointStatus;
    dryRun: boolean;
    flowCursor: number;
    stepCursor: number;
    phase?: WizardState["phase"];
    postRunCursor?: number;
}
export declare function createCheckpointManager(options: CheckpointManagerOptions): Promise<CheckpointManager | undefined>;
export declare function listCheckpoints(repoRoot: string, filter?: {
    scenarioId?: string;
}): Promise<CheckpointMetadata[]>;
export interface LoadCheckpointOptions {
    repoRoot: string;
    identifier: string;
}
export declare function loadCheckpoint(options: LoadCheckpointOptions): Promise<{
    state: WizardState;
    metadata: CheckpointMetadata;
}>;
