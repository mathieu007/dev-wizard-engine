import type { CommandDescriptor, DevWizardScenario, PolicyLevel, StepTransitionTarget } from "../loader/types";
import type { IntegrationTimingMetadata } from "./integrationTimings";
export interface WizardIdentitySegmentSelection {
    id: string;
    value: string;
    label?: string;
    details?: Record<string, unknown>;
    source?: "option" | "custom" | "cli";
}
export interface WizardIdentitySelection {
    slug: string;
    segments: WizardIdentitySegmentSelection[];
}
export interface CommandExecutionRecord {
    flowId: string;
    stepId: string;
    stepLabel?: string;
    stepMetadata?: Record<string, unknown>;
    descriptor: CommandDescriptor;
    rendered: CommandDescriptor;
    startedAt: Date;
    endedAt: Date;
    durationMs: number;
    success: boolean;
    exitCode?: number;
    stdout?: string;
    stderr?: string;
    error?: Error;
    warnAfterMs?: number;
    longRunning?: boolean;
    timedOut?: boolean;
}
export interface IntegrationTimingCapture {
    flowId: string;
    stepId: string;
    workflowId?: string;
    workflowLabel?: string;
    command: CommandDescriptor;
    metadata: IntegrationTimingMetadata;
}
export interface FlowRunRecord {
    flowId: string;
    startedAt: Date;
    endedAt: Date;
    durationMs: number;
    exitedEarly: boolean;
}
export interface RetryRecord {
    flowId: string;
    stepId: string;
    stepLabel?: string;
}
export type SkipReason = "action" | "default" | "policy";
export interface SkipRecord {
    flowId: string;
    stepId: string;
    stepLabel?: string;
    target?: StepTransitionTarget;
    actionLabel?: string;
    reason: SkipReason;
}
export interface PolicyDecisionRecord {
    ruleId: string;
    ruleLevel: PolicyLevel;
    enforcedLevel: PolicyLevel;
    acknowledged: boolean;
    flowId: string;
    stepId: string;
    command: string;
    note?: string;
}
export interface IterationContext {
    index: number;
    total: number;
    value: unknown;
    key?: string;
}
export interface WizardState {
    scenario: DevWizardScenario;
    answers: Record<string, unknown>;
    identity?: WizardIdentitySelection;
    history: CommandExecutionRecord[];
    lastCommand?: CommandExecutionRecord;
    completedSteps: number;
    failedSteps: number;
    integrationTimings: IntegrationTimingCapture[];
    flowRuns: FlowRunRecord[];
    startedAt: Date;
    endedAt?: Date;
    exitedEarly: boolean;
    retries: RetryRecord[];
    skippedSteps: SkipRecord[];
    policyDecisions: PolicyDecisionRecord[];
    autoActionCounts: Record<string, number>;
    iteration?: IterationContext;
    flowCursor: number;
    stepCursor: number;
    runId?: string;
    phase?: "scenario" | "post-run" | "complete";
    postRunCursor?: number;
}
