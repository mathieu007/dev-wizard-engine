export type WizardLogEvent = {
    type: "scenario.start";
    scenarioId: string;
    label: string;
    startedAt: string;
    flows: string[];
    dryRun: boolean;
    quiet: boolean;
    verbose: boolean;
} | {
    type: "scenario.complete";
    scenarioId: string;
    label: string;
    status: "success" | "failure";
    endedAt?: string;
    durationMs: number;
    completedSteps: number;
    failedSteps: number;
    exitedEarly: boolean;
} | {
    type: "step.start" | "step.complete";
    flowId: string;
    stepId: string;
    stepType: string;
    index: number;
    next?: string | null;
    durationMs?: number;
} | {
    type: "prompt.answer";
    flowId: string;
    stepId: string;
    value: unknown;
} | {
    type: "prompt.persistence";
    flowId: string;
    stepId: string;
    scope: "scenario" | "project";
    key: string;
    projectId?: string;
    status: "hit" | "miss";
    applied?: boolean;
} | {
    type: "branch.decision";
    flowId: string;
    stepId: string;
    expression: string;
    result: boolean;
    target?: string | null;
} | {
    type: "command.result";
    flowId: string;
    stepId: string;
    command: string;
    cwd?: string;
    dryRun: boolean;
    success: boolean;
    exitCode?: number;
    durationMs: number;
    errorMessage?: string;
    stdout?: string;
    stderr?: string;
} | {
    type: "policy.decision";
    ruleId: string;
    ruleLevel: "allow" | "warn" | "block";
    enforcedLevel: "allow" | "warn" | "block";
    acknowledged: boolean;
    flowId: string;
    stepId: string;
    command: string;
    note?: string;
} | {
    type: "shortcut.trigger";
    action: "skip-step" | "replay-command" | "safe-abort";
    shortcut: string;
    flowId: string;
    stepId: string;
    stepLabel?: string;
};
export interface WizardLogWriter {
    write(event: WizardLogEvent): void;
    close(): Promise<void>;
}
export interface WizardLogWriterOptions {
    redactPromptValues?: boolean;
    redactCommandOutput?: boolean;
}
export declare function createLogWriter(filePath: string, options?: WizardLogWriterOptions): WizardLogWriter;
export declare function createStreamLogWriter(stream: NodeJS.WritableStream, options?: WizardLogWriterOptions): WizardLogWriter;
