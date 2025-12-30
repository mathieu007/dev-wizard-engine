import type { CommandParseJsonOptions, DevWizardConfig, PromptOption, PromptStep, StepTransitionTarget } from "../loader/types";
import type { WizardState, WizardIdentitySelection } from "./state";
import type { WizardLogWriter } from "./logWriter.js";
import type { CheckpointManager } from "./checkpoints";
import type { PolicyEngine } from "./policyEngine";
import type { WizardPluginRegistry, PluginStepPlan } from "./plugins.js";
import { type PromptHistoryManager } from "./promptHistory.js";
import { PromptPersistenceManager } from "./promptPersistence.js";
import type { PromptDriver } from "./promptDriver.js";
export interface ExecutorContext {
    config: DevWizardConfig;
    scenarioId: string;
    repoRoot: string;
    stdout: NodeJS.WritableStream;
    stderr: NodeJS.WritableStream;
    dryRun: boolean;
    quiet: boolean;
    verbose: boolean;
    phase?: "collect" | "execute";
    nonInteractive?: boolean;
    promptDriver: PromptDriver;
    overrides: Record<string, unknown>;
    answersFileName?: string;
    answersFileBase?: string;
    logWriter?: WizardLogWriter;
    promptOptionsCache?: Map<string, PromptOption[]>;
    checkpoint?: CheckpointManager;
    policy?: PolicyEngine;
    plugins?: WizardPluginRegistry;
    promptHistory?: PromptHistoryManager;
    promptPersistence?: PromptPersistenceManager;
    usePromptPersistenceAnswers?: boolean;
    executionMode?: "standard" | "register" | "manifest";
}
interface ScenarioExecutionOptions {
    initialState?: WizardState;
    checkpoint?: CheckpointManager;
    identity?: WizardIdentitySelection;
}
export type PlanFormat = "pretty" | "ndjson" | "json";
export interface ScenarioPlan {
    scenarioId: string;
    scenarioLabel: string;
    scenarioDescription?: string;
    targetMode: "dry-run" | "live";
    resume?: {
        startingFlowIndex: number;
        startingStepIndex: number;
    };
    overrides: PlanOverride[];
    warnings: string[];
    pendingPromptCount: number;
    preferences: PlanPreferences;
    flows: FlowPlan[];
    events: PlanEvent[];
}
export interface PlanPreferences {
    expandEnv: boolean;
    expandTemplates: boolean;
    expandBranches: boolean;
}
interface FlowPlan {
    id: string;
    label?: string;
    description?: string;
    steps: StepPlan[];
}
type StepPlan = CommandStepPlan | PromptStepPlan | BranchStepPlan | MessageStepPlan | GroupStepPlan | IterateStepPlan | ComputeStepPlan | GitWorktreeGuardPlan | PluginStepPlan;
interface CommandStepPlan {
    kind: "command";
    id: string;
    label?: string;
    description?: string;
    continueOnError?: boolean;
    commands: CommandPreview[];
}
interface CommandPreview {
    index: number;
    name?: string;
    run: string;
    cwd?: string;
    shell?: boolean;
    env?: Record<string, string>;
    envDiff?: EnvDiffEntry[];
    warnAfterMs?: number;
    continueOnFail?: boolean;
    preset?: string;
    storeStdoutAs?: string;
    parseJson?: boolean | CommandParseJsonOptions;
    summary?: string;
}
interface EnvDiffEntry {
    key: string;
    value: string;
    previous?: string;
    source: "preset" | "defaults" | "command";
}
interface PromptStepPlan {
    kind: "prompt";
    id: string;
    label?: string;
    mode: PromptStep["mode"];
    prompt: string;
    answer?: unknown;
    answerSource: "override" | "default" | "persisted" | "pending";
    required: boolean;
    options?: PromptPlanOption[];
    dynamic?: boolean;
    defaultValue?: unknown;
}
interface PromptPlanOption {
    value: string;
    label: string;
    hint?: string;
    disabled?: boolean;
}
interface BranchStepPlan {
    kind: "branch";
    id: string;
    label?: string;
    branches: BranchPreview[];
    defaultTarget?: StepTransitionTarget;
    selectedTarget?: StepTransitionTarget;
}
interface BranchPreview {
    expression: string;
    result: boolean;
    target: StepTransitionTarget;
    description?: string;
}
interface MessageStepPlan {
    kind: "message";
    id: string;
    label?: string;
    level?: "info" | "success" | "warning" | "error";
    text: string;
}
interface GroupStepPlan {
    kind: "group";
    id: string;
    label?: string;
    flowId: string;
    plan: FlowPlan;
}
interface GitWorktreeGuardPlan {
    kind: "git-worktree-guard";
    id: string;
    label?: string;
    status: "clean" | "dirty";
    strategy?: WorktreeStrategy;
    message: string;
}
type WorktreeStrategy = "commit-push" | "stash" | "branch" | "proceed";
interface IterateStepPlan {
    kind: "iterate";
    id: string;
    label?: string;
    flowId: string;
    sourceDescription: string;
    itemCount?: number;
    note?: string;
}
interface ComputeStepPlan {
    kind: "compute";
    id: string;
    label?: string;
    description?: string;
    handler?: string;
    storeAs?: string;
    values: Record<string, unknown>;
}
interface PlanOverride {
    key: string;
    value: unknown;
    source: "override" | "answers";
}
export interface PlanEvent {
    type: string;
    flowId?: string;
    stepId?: string;
    data: Record<string, unknown>;
}
export declare class WizardExecutionError extends Error {
    readonly state: WizardState;
    constructor(cause: unknown, state: WizardState);
}
export declare function executeScenario(context: ExecutorContext, options?: ScenarioExecutionOptions): Promise<WizardState>;
export declare function buildScenarioPlan(context: ExecutorContext, options?: ScenarioExecutionOptions): Promise<ScenarioPlan>;
export declare const SKIP_STEP_OPTION_VALUE = "__shortcut_skip_step__";
export {};
