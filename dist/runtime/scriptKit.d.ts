import type { CommandRecommendationCommand, CommandRecommendationLink } from "../loader/types";
import type { WizardLogWriter } from "./logWriter.js";
import type { DevWizardOptions } from "./types.js";
export interface DefineWizardCommandInput {
    id: string;
    command: string;
    args?: string[];
    label?: string;
    cwd?: string;
    env?: Record<string, string>;
    shell?: boolean;
    allowFailure?: boolean;
    warnAfterMs?: number;
    flowId?: string;
    stepId?: string;
}
export interface WizardScriptCommandDefinition extends DefineWizardCommandInput {
    args: string[];
}
export interface RunWizardCommandOptions {
    dryRun?: boolean;
    quiet?: boolean;
    logWriter?: WizardLogWriter;
    flowId?: string;
    stepId?: string;
    redactOutput?: boolean;
}
export interface WizardScriptCommandResult {
    definition: WizardScriptCommandDefinition;
    startedAt: Date;
    endedAt: Date;
    durationMs: number;
    exitCode?: number;
    stdout?: string;
    stderr?: string;
    success: boolean;
    dryRun: boolean;
    error?: Error;
}
export interface WizardTimerHandle {
    stop(): WizardTimerResult;
}
export interface WizardTimerResult {
    startedAt: Date;
    endedAt: Date;
    durationMs: number;
}
export interface WizardTimer {
    start(): WizardTimerHandle;
    wrap<T>(work: () => Promise<T> | T): Promise<WizardTimerWrapResult<T>>;
}
export interface WizardTimerWrapResult<T> extends WizardTimerResult {
    result: T;
}
export interface ProjectsOrchestratorOptions {
    repoRoot?: string;
    configPath?: string | string[];
    presetSpecifier?: string;
    scenarioId?: string;
    projects?: string[];
    selectAllProjects?: boolean;
    includeRoot?: boolean;
    maxDepth?: number;
    ignore?: string[];
    limit?: number;
    workflows?: string[];
    autoExecute?: boolean;
    overrides?: Record<string, unknown>;
    devWizardOptions?: Omit<DevWizardOptions, "configPath" | "scenario" | "overrides">;
}
export interface MaintenancePresetOverrides {
    maintenanceWindowMode?: string;
    maintenanceWindow?: string;
    maintenanceWindowCadence?: string;
    maintenanceTasks?: string[];
    maintenanceNotes?: string;
    maintenanceFollowUps?: string;
    upgradeBackupStrategy?: string;
    upgradeBranchName?: string;
    upgradeStashMessage?: string;
    upgradeCommand?: string;
    upgradePostCheckCommand?: string;
    upgradeLatestCommand?: string;
    upgradeStrategy?: string;
    typecheckCommandMode?: string;
    typecheckCommand?: string;
    typecheckWorkingDir?: string;
    typecheckTsconfigSelection?: string;
    typecheckTsconfigCustom?: string;
    typecheckCompilerOptions?: string;
    typecheckPreStrategy?: string;
    typecheckPostStrategy?: string;
    peerResolutionStrategy?: string;
    peerResolutionCommand?: string;
}
export interface MaintenanceWizardOptions {
    configPath?: string | string[];
    presetSpecifier?: string;
    scenarioId?: string;
    overrides?: MaintenancePresetOverrides & Record<string, unknown>;
    devWizardOptions?: DevWizardOptions;
}
export interface RecommendationBuilderOptions {
    summary?: string;
}
export interface WizardRecommendation {
    summary?: string;
    commands: CommandRecommendationCommand[];
    links: CommandRecommendationLink[];
}
export interface WizardRecommendationBuilder {
    setSummary(summary: string): void;
    addCommand(command: string, options?: {
        label?: string;
    }): void;
    addLink(url: string, options?: {
        label?: string;
    }): void;
    reset(): void;
    build(): WizardRecommendation;
    format(): string | undefined;
}
export interface ReadJsonStdinOptions<T> {
    stdin?: NodeJS.ReadableStream;
    encoding?: BufferEncoding;
    allowEmpty?: boolean;
    schema?: {
        parse: (input: unknown) => T;
    };
    description?: string;
}
export interface ParseScriptArgsOptions<TSchema extends {
    parse: (input: unknown) => any;
}> {
    schema: TSchema;
    argv?: readonly string[];
    aliases?: Record<string, string>;
    allowPositionals?: boolean;
    description?: string;
}
export interface HandleScriptErrorOptions {
    stderr?: NodeJS.WritableStream;
    logger?: {
        error(message: string): void;
    };
}
export declare class WizardScriptError extends Error {
    exitCode: number;
    constructor(message: string, options?: {
        exitCode?: number;
        cause?: unknown;
    });
}
export declare function createProjectsOrchestratorOptions(options?: ProjectsOrchestratorOptions): Promise<DevWizardOptions>;
export declare function createMaintenanceOptions(options?: MaintenanceWizardOptions): Promise<DevWizardOptions>;
export declare function defineWizardCommand(input: DefineWizardCommandInput): WizardScriptCommandDefinition;
export declare function runWizardCommand(definition: WizardScriptCommandDefinition, options?: RunWizardCommandOptions): Promise<WizardScriptCommandResult>;
export declare function createWizardTimer(): WizardTimer;
export declare function createRecommendationBuilder(options?: RecommendationBuilderOptions): WizardRecommendationBuilder;
export declare function formatRecommendation(recommendation: WizardRecommendation): string | undefined;
export declare function readJsonStdin<T = unknown>(options?: ReadJsonStdinOptions<T>): Promise<T>;
export declare function writeJsonStdout(value: unknown, options?: {
    stdout?: NodeJS.WritableStream;
    pretty?: number;
    appendNewline?: boolean;
}): void;
export declare function parseScriptArgs<TSchema extends {
    parse: (input: unknown) => any;
}>(options: ParseScriptArgsOptions<TSchema>): ReturnType<TSchema["parse"]>;
export declare function handleScriptError(error: unknown, options?: HandleScriptErrorOptions): void;
