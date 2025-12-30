import { promises as fs } from "node:fs";
import path from "node:path";
import chalk from "chalk";
import { execa, execaCommand } from "execa";
import { renderMaybeNested, renderTemplate } from "./templates.js";
import { evaluateCondition } from "./expression.js";
import { getComputeHandler } from "./computeHandlers.js";
import { extractIntegrationTimingMetadata } from "./integrationTimings.js";
import { extractWorkflowMetadata } from "./workflowMetadata.js";
import { writeWorkflowAnalyticsReports } from "./workflowAnalyticsWriter.js";
import { getResolvedCommandPreset } from "./commandPresets.js";
import { resolveDynamicPromptOptions, } from "./promptOptions.js";
import { createPolicyTelemetryHook, } from "./policyTelemetry.js";
import { createPluginHelpers, createEmptyPluginRegistry, isPluginStep, } from "./plugins.js";
import { createPromptHistoryManager, } from "./promptHistory.js";
import { PromptCancelledError } from "./promptDriver.js";
import { parseOverrideValue, validatePromptValue } from "./promptValidation.js";
function writeLine(stream, message) {
    stream.write(`${message}\n`);
}
function logInfo(context, message) {
    if (context.quiet) {
        return;
    }
    writeLine(context.stdout, message);
}
function logSuccess(context, message) {
    if (context.quiet) {
        return;
    }
    writeLine(context.stdout, message);
}
function logWarn(context, message) {
    writeLine(context.stderr, message);
}
function logError(context, message) {
    writeLine(context.stderr, message);
}
function logNote(context, title, body) {
    logWarn(context, `${title}:`);
    for (const line of body.split("\n")) {
        logWarn(context, line);
    }
}
const DEFAULT_PLAN_PREFERENCES = {
    expandEnv: false,
    expandTemplates: false,
    expandBranches: false,
};
const DEFAULT_WORKTREE_PROMPT = "Select a backup strategy before running the selected workflows.";
const DEFAULT_WORKTREE_CLEAN_MESSAGE = "Working tree is clean. Continuing.";
const DEFAULT_WORKTREE_DIRTY_MESSAGE = "Working tree has uncommitted changes. Choose how you want to back it up before automation runs.";
const DEFAULT_COMMIT_MESSAGE_PROMPT = "Commit message for the staged cleanup";
const DEFAULT_COMMIT_MESSAGE_TEMPLATE = "dev-wizard automation cleanup";
const DEFAULT_STASH_MESSAGE_PROMPT = "Stash message describing these saved changes";
const DEFAULT_STASH_MESSAGE_TEMPLATE = "dev-wizard automation stash";
const DEFAULT_BRANCH_PROMPT = "Branch name for this automation snapshot";
const DEFAULT_BRANCH_NAME_PREFIX = "dev-wizard/automation";
export class WizardExecutionError extends Error {
    state;
    constructor(cause, state) {
        super(cause instanceof Error ? cause.message : String(cause));
        this.name = "WizardExecutionError";
        this.state = state;
        this.cause = cause;
        if (cause instanceof Error && cause.stack) {
            this.stack = cause.stack;
        }
    }
}
export async function executeScenario(context, options = {}) {
    ensurePluginRegistry(context);
    const scenario = context.config.scenarios.find((item) => item.id === context.scenarioId);
    if (!scenario) {
        throw new Error(`Unknown scenario "${context.scenarioId}".`);
    }
    const { initialState, checkpoint } = options;
    const state = initialState
        ? prepareResumeState(initialState, scenario)
        : createInitialState(scenario);
    state.scenario = scenario;
    state.identity = options.identity ?? state.identity;
    state.runId ??= checkpoint?.runId;
    const originalLogWriter = context.logWriter;
    const policyTelemetryWriter = createPolicyTelemetryHook({
        onDecision(event) {
            recordPolicyDecision(state, event);
        },
    });
    context.logWriter = chainLogWriters([
        policyTelemetryWriter,
        originalLogWriter,
    ]);
    const flowSequence = buildScenarioFlowSequence(scenario, context.phase);
    emitLog(context, {
        type: "scenario.start",
        scenarioId: scenario.id,
        label: scenario.label,
        startedAt: state.startedAt.toISOString(),
        flows: flowSequence,
        dryRun: context.dryRun,
        quiet: context.quiet,
        verbose: context.verbose,
    });
    if (checkpoint) {
        await checkpoint.record(state, { immediate: true });
    }
    try {
        const startingFlowIndex = clampIndex(state.flowCursor ?? 0, flowSequence.length);
        for (let index = startingFlowIndex; index < flowSequence.length; index += 1) {
            const flowId = flowSequence[index];
            state.flowCursor = index;
            state.phase = "scenario";
            const flowStartedAt = new Date();
            const next = await runFlow(context.config, flowId, state, context, {
                checkpoint,
                startingStepIndex: index === startingFlowIndex ? state.stepCursor ?? 0 : 0,
            });
            const flowEndedAt = new Date();
            state.flowRuns.push({
                flowId,
                startedAt: flowStartedAt,
                endedAt: flowEndedAt,
                durationMs: Math.max(0, flowEndedAt.getTime() - flowStartedAt.getTime()),
                exitedEarly: next === "exit",
            });
            state.stepCursor = 0;
            if (next === "exit") {
                state.exitedEarly = true;
                if (checkpoint) {
                    await checkpoint.record(state, { immediate: true });
                }
                break;
            }
            state.flowCursor = index + 1;
            if (checkpoint) {
                await checkpoint.record(state);
            }
        }
        const postRunExecuted = context.phase === "collect"
            ? false
            : await runPostRunHooks(scenario, state, context, checkpoint);
        state.endedAt = new Date();
        if (postRunExecuted && checkpoint) {
            await checkpoint.record(state, { immediate: true });
        }
        state.phase = "complete";
        if (!context.dryRun) {
            try {
                await writeWorkflowAnalyticsReports({ state, repoRoot: context.repoRoot });
            }
            catch (error) {
                logWarn(context, `Failed to write workflow analytics: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
        emitLog(context, {
            type: "scenario.complete",
            scenarioId: scenario.id,
            label: scenario.label,
            status: "success",
            endedAt: state.endedAt?.toISOString(),
            durationMs: getScenarioDuration(state),
            completedSteps: state.completedSteps,
            failedSteps: state.failedSteps,
            exitedEarly: state.exitedEarly,
        });
    }
    catch (error) {
        if (!state.endedAt) {
            state.endedAt = new Date();
        }
        state.exitedEarly = true;
        if (checkpoint) {
            await checkpoint.record(state, { immediate: true });
        }
        emitLog(context, {
            type: "scenario.complete",
            scenarioId: scenario.id,
            label: scenario.label,
            status: "failure",
            endedAt: state.endedAt?.toISOString(),
            durationMs: getScenarioDuration(state),
            completedSteps: state.completedSteps,
            failedSteps: state.failedSteps,
            exitedEarly: true,
        });
        throw new WizardExecutionError(error, state);
    }
    finally {
        await policyTelemetryWriter.close().catch(() => undefined);
        context.logWriter = originalLogWriter;
    }
    return state;
}
function ensurePromptHistory(context) {
    if (!context.promptHistory) {
        context.promptHistory = createPromptHistoryManager();
    }
    return context.promptHistory;
}
export async function buildScenarioPlan(context, options = {}) {
    ensurePluginRegistry(context);
    const scenario = context.config.scenarios.find((item) => item.id === context.scenarioId);
    if (!scenario) {
        throw new Error(`Unknown scenario "${context.scenarioId}".`);
    }
    const clonedOverrides = context.overrides && Object.keys(context.overrides).length > 0
        ? structuredClone(context.overrides)
        : {};
    const planContext = {
        ...context,
        // Force dry-run behaviour to avoid executing commands while planning.
        dryRun: true,
        quiet: true,
        logWriter: undefined,
        overrides: clonedOverrides,
        stdout: context.stdout,
        stderr: context.stderr,
        promptOptionsCache: new Map(),
        plugins: context.plugins,
    };
    const baseState = options.initialState
        ? prepareResumeState(structuredClone(options.initialState), scenario)
        : createInitialState(scenario);
    const state = structuredClone(baseState);
    state.flowCursor = clampIndex(state.flowCursor ?? 0, buildScenarioFlowSequence(scenario, context.phase).length);
    state.stepCursor = Math.max(0, state.stepCursor ?? 0);
    const plan = {
        scenarioId: scenario.id,
        scenarioLabel: scenario.label,
        scenarioDescription: scenario.description,
        targetMode: context.dryRun ? "dry-run" : "live",
        resume: options.initialState !== undefined
            ? {
                startingFlowIndex: state.flowCursor ?? 0,
                startingStepIndex: state.stepCursor ?? 0,
            }
            : undefined,
        overrides: collectPlanOverrides(clonedOverrides),
        warnings: [],
        pendingPromptCount: 0,
        preferences: { ...DEFAULT_PLAN_PREFERENCES },
        flows: [],
        events: [],
    };
    plan.events.push({
        type: "plan.meta",
        data: {
            scenarioId: plan.scenarioId,
            scenarioLabel: plan.scenarioLabel,
            targetMode: plan.targetMode,
        },
    });
    const flowSequence = buildScenarioFlowSequence(scenario, context.phase);
    const startingFlowIndex = clampIndex(state.flowCursor ?? 0, flowSequence.length);
    for (let index = startingFlowIndex; index < flowSequence.length; index += 1) {
        const flowId = flowSequence[index];
        const startingStepIndex = index === startingFlowIndex ? clampIndex(state.stepCursor ?? 0, context.config.flows[flowId]?.steps.length ?? 0) : 0;
        const { flowPlan, exitTarget } = await previewFlow(planContext, state, flowId, startingStepIndex, plan, { nested: false });
        plan.flows.push(flowPlan);
        if (exitTarget === "exit") {
            break;
        }
    }
    return plan;
}
async function previewFlow(context, state, flowId, startingStepIndex, plan, options) {
    const flow = context.config.flows[flowId];
    if (!flow) {
        throw new Error(`Flow "${flowId}" not found in configuration.`);
    }
    const flowPlan = {
        id: flow.id,
        label: flow.label,
        description: flow.description,
        steps: [],
    };
    plan.events.push({
        type: "plan.flow",
        flowId: flow.id,
        data: {
            stepCount: flow.steps.length,
            nested: options.nested,
        },
    });
    const stepIndex = new Map();
    flow.steps.forEach((step, index) => stepIndex.set(step.id, index));
    for (let pointer = clampIndex(startingStepIndex, flow.steps.length); pointer < flow.steps.length; pointer += 1) {
        const step = flow.steps[pointer];
        const templateContext = buildTemplateContext(context, state, step);
        const preview = await previewStep(flow, step, state, context, templateContext, plan, options);
        flowPlan.steps.push(preview.plan);
        if (preview.next === "exit") {
            return { flowPlan, exitTarget: "exit" };
        }
        if (preview.next === "repeat") {
            pointer -= 1;
            continue;
        }
        if (typeof preview.next === "string") {
            const nextIndex = stepIndex.get(preview.next);
            if (typeof nextIndex !== "number") {
                plan.warnings.push(`Step "${step.id}" attempted to jump to unknown step "${preview.next}" during plan preview.`);
                break;
            }
            pointer = nextIndex - 1;
            continue;
        }
    }
    return { flowPlan, exitTarget: undefined };
}
async function previewStep(flow, step, state, context, templateContext, plan, options) {
    if (isPluginStep(step)) {
        return previewPluginStep(flow, step, state, context, templateContext, plan);
    }
    switch (step.type) {
        case "command":
            return previewCommandStep(flow.id, step, state, context, templateContext, plan);
        case "prompt":
            return previewPromptStep(flow.id, step, state, context, templateContext, plan);
        case "message":
            return {
                plan: previewMessageStep(flow.id, step, templateContext, plan),
            };
        case "branch":
            return previewBranchStep(flow.id, step, state, templateContext, plan);
        case "group": {
            const { flowPlan, exitTarget } = await previewFlow(context, state, step.flow, 0, plan, { nested: true });
            const groupPlan = {
                kind: "group",
                id: step.id,
                label: step.label,
                flowId: step.flow,
                plan: flowPlan,
            };
            plan.events.push({
                type: "plan.step",
                flowId: flow.id,
                stepId: step.id,
                data: {
                    kind: "group",
                    flowId: step.flow,
                },
            });
            return {
                plan: groupPlan,
                next: exitTarget,
            };
        }
        case "iterate":
            return previewIterateStep(flow.id, step, state, context, templateContext, plan);
        case "compute":
            return previewComputeStep(flow.id, step, state, templateContext, context, plan);
        case "git-worktree-guard":
            return previewGitWorktreeGuardStep(flow.id, step, state, context, templateContext, plan);
        default:
            throw new Error(`Unsupported step type ${step.type}`);
    }
}
function collectPlanOverrides(overrides) {
    return Object.entries(overrides)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([key, value]) => ({
        key,
        value,
        source: "override",
    }));
}
function buildPluginPlan(step, pluginName, result) {
    const basePlan = {
        kind: "plugin",
        id: step.id,
        label: step.label,
        pluginType: step.type,
        pluginName,
    };
    if (!result?.plan) {
        return basePlan;
    }
    return {
        ...basePlan,
        ...result.plan,
        kind: "plugin",
        id: result.plan.id ?? basePlan.id,
        label: result.plan.label ?? basePlan.label,
        pluginType: result.plan.pluginType ?? basePlan.pluginType,
        pluginName: result.plan.pluginName ?? basePlan.pluginName,
        summary: result.plan.summary ?? basePlan.summary,
        details: result.plan.details ?? basePlan.details,
    };
}
function normalizePluginStepResult(result) {
    return {
        next: result?.next,
        status: result?.status ?? "success",
    };
}
function getPluginRegistration(context, stepType) {
    const registry = ensurePluginRegistry(context);
    const registration = registry.getStepHandler(stepType);
    if (!registration) {
        throw new Error(`Unsupported step type "${stepType}". Register a plugin that provides this step type.`);
    }
    return registration;
}
function ensurePluginRegistry(context) {
    if (!context.plugins) {
        context.plugins = createEmptyPluginRegistry();
    }
    return context.plugins;
}
async function previewCommandStep(flowId, step, state, context, templateContext, plan) {
    const commandPlans = [];
    for (let index = 0; index < step.commands.length; index += 1) {
        const rawDescriptor = step.commands[index];
        const resolvedDescriptor = resolveCommandDescriptor(rawDescriptor, step, context.config);
        const renderedDescriptor = renderMaybeNested(resolvedDescriptor, templateContext);
        const commandPresetName = rawDescriptor.preset ?? step.defaults?.preset ?? resolvedDescriptor.preset;
        const commandPreset = commandPresetName
            ? getResolvedCommandPreset(context.config, commandPresetName)?.definition
            : undefined;
        const envDiff = computeEnvDiffEntries(commandPreset?.env ?? {}, step.defaults?.env ?? {}, rawDescriptor.env ?? {});
        const warnAfterMs = normalizeWarnAfterMs(renderedDescriptor.warnAfterMs);
        commandPlans.push({
            index,
            name: rawDescriptor.name,
            run: renderedDescriptor.run,
            cwd: renderedDescriptor.cwd,
            shell: renderedDescriptor.shell,
            env: renderedDescriptor.env,
            envDiff: envDiff.length > 0 ? envDiff : undefined,
            warnAfterMs,
            continueOnFail: Boolean(rawDescriptor.continueOnFail ?? step.continueOnError ?? false),
            preset: commandPresetName,
            storeStdoutAs: renderedDescriptor.storeStdoutAs,
            parseJson: renderedDescriptor.parseJson,
            summary: step.summary,
        });
        const now = new Date();
        const record = {
            flowId,
            stepId: step.id,
            stepLabel: step.label ?? step.id,
            stepMetadata: step.metadata,
            descriptor: rawDescriptor,
            rendered: renderedDescriptor,
            startedAt: now,
            endedAt: now,
            durationMs: 0,
            success: true,
            exitCode: 0,
            warnAfterMs,
            longRunning: false,
            timedOut: false,
        };
        state.history.push(record);
        state.lastCommand = record;
    }
    const planStep = {
        kind: "command",
        id: step.id,
        label: step.label,
        description: step.description,
        continueOnError: step.continueOnError,
        commands: commandPlans,
    };
    plan.events.push({
        type: "plan.step",
        flowId,
        stepId: step.id,
        data: {
            kind: "command",
            commandCount: commandPlans.length,
        },
    });
    for (const command of commandPlans) {
        plan.events.push({
            type: "plan.command",
            flowId,
            stepId: step.id,
            data: {
                index: command.index,
                run: command.run,
                cwd: command.cwd,
                envDiff: command.envDiff,
            },
        });
    }
    return {
        plan: planStep,
        next: step.onSuccess?.next,
    };
}
function previewMessageStep(flowId, step, templateContext, plan) {
    const text = renderTemplate(step.text, templateContext);
    const planStep = {
        kind: "message",
        id: step.id,
        label: step.label,
        level: step.level,
        text,
    };
    plan.events.push({
        type: "plan.step",
        flowId,
        stepId: step.id,
        data: {
            kind: "message",
        },
    });
    return planStep;
}
async function previewPromptStep(flowId, step, state, context, templateContext, plan) {
    const promptText = renderTemplate(step.prompt, templateContext);
    const key = step.storeAs ?? step.id;
    const expectsOptions = step.mode === "select" || step.mode === "multiselect";
    let answerSource = "pending";
    let answer;
    let defaultValue;
    const persistenceTarget = resolvePromptPersistenceTarget(step, state);
    const override = getOverride(context, key, step.id);
    if (override !== undefined) {
        answer = parseOverrideValue(step, override);
        answerSource = "override";
        state.answers[key] = answer;
    }
    if (persistenceTarget && context.promptPersistence) {
        const persisted = context.promptPersistence.get(persistenceTarget);
        if (persisted !== undefined) {
            if (context.usePromptPersistenceAnswers && answerSource === "pending") {
                answer = persisted;
                answerSource = "persisted";
                state.answers[key] = answer;
            }
            else if (defaultValue === undefined) {
                defaultValue = persisted;
            }
        }
    }
    if (answerSource === "pending" && step.defaultValue !== undefined) {
        const renderedDefault = renderMaybeNested(step.defaultValue, templateContext);
        if (renderedDefault !== undefined) {
            defaultValue = renderedDefault;
        }
    }
    if (answerSource === "pending" && defaultValue !== undefined) {
        const normalizedDefault = step.mode === "multiselect"
            ? normalizeMultiselectDefault(defaultValue) ?? defaultValue
            : defaultValue;
        answer = normalizedDefault;
        answerSource = "default";
        defaultValue = normalizedDefault;
        state.answers[key] = answer;
    }
    if (answerSource === "pending") {
        plan.pendingPromptCount += 1;
        plan.warnings.push(`Prompt "${step.id}" requires input at runtime.`);
    }
    let options;
    let dynamic = false;
    if (expectsOptions) {
        if (step.options && step.options.length > 0) {
            options = step.options.map((option) => {
                const rendered = renderPromptOption(option, templateContext);
                return {
                    value: rendered.value,
                    label: rendered.label,
                    hint: rendered.hint,
                    disabled: rendered.disabled,
                };
            });
        }
        else if (step.dynamic) {
            dynamic = true;
        }
    }
    const planStep = {
        kind: "prompt",
        id: step.id,
        label: step.label,
        mode: step.mode,
        prompt: promptText,
        answer,
        answerSource,
        required: Boolean(step.required),
        options,
        dynamic,
        defaultValue,
    };
    plan.events.push({
        type: "plan.step",
        flowId,
        stepId: step.id,
        data: {
            kind: "prompt",
            mode: step.mode,
            answerSource,
            required: Boolean(step.required),
        },
    });
    return {
        plan: planStep,
    };
}
function previewBranchStep(flowId, step, state, templateContext, plan) {
    const branches = [];
    let selectedTarget;
    for (const branch of step.branches) {
        const expression = renderTemplate(branch.when, templateContext);
        const result = evaluateCondition(expression, {
            answers: state.answers,
            scenario: state.scenario,
            lastCommand: state.lastCommand,
        });
        const branchPreview = {
            expression,
            result,
            target: branch.next,
            description: branch.description,
        };
        branches.push(branchPreview);
        if (selectedTarget === undefined && result) {
            selectedTarget = branch.next;
        }
    }
    const defaultTarget = step.defaultNext?.next;
    const finalTarget = selectedTarget ?? defaultTarget;
    if (finalTarget === undefined) {
        plan.warnings.push(`Branch step "${step.id}" does not select a target during preview.`);
    }
    const planStep = {
        kind: "branch",
        id: step.id,
        label: step.label,
        branches,
        defaultTarget,
        selectedTarget: finalTarget,
    };
    plan.events.push({
        type: "plan.step",
        flowId,
        stepId: step.id,
        data: {
            kind: "branch",
            selectedTarget: finalTarget,
        },
    });
    return {
        plan: planStep,
        next: finalTarget,
    };
}
async function previewIterateStep(flowId, step, state, context, templateContext, plan) {
    let sourceDescription = "static";
    let itemCount;
    let note;
    if (Array.isArray(step.items)) {
        const rendered = renderMaybeNested(step.items, templateContext);
        const normalized = normalizeItems(rendered);
        itemCount = normalized.length;
    }
    else if (step.source) {
        switch (step.source.from) {
            case "answers": {
                sourceDescription = `answers.${step.source.key}`;
                const value = state.answers[step.source.key];
                const normalized = normalizeItems(value);
                itemCount = normalized.length;
                break;
            }
            case "json": {
                sourceDescription = `json:${step.source.path}`;
                try {
                    const options = (await resolveDynamicPromptOptions({
                        type: "json",
                        path: step.source.path,
                        pointer: step.source.pointer,
                    }, templateContext, getDynamicContext(context))) ?? [];
                    itemCount = options.length;
                }
                catch (error) {
                    note = `Unable to preview JSON source: ${error instanceof Error ? error.message : String(error)}`;
                }
                break;
            }
            case "dynamic": {
                sourceDescription = `dynamic:${step.source.dynamic.type}`;
                note = "Dynamic sources are evaluated at runtime.";
                break;
            }
            default:
                sourceDescription = "unknown";
        }
    }
    const planStep = {
        kind: "iterate",
        id: step.id,
        label: step.label,
        flowId: step.flow,
        sourceDescription,
        itemCount,
        note,
    };
    plan.events.push({
        type: "plan.step",
        flowId,
        stepId: step.id,
        data: {
            kind: "iterate",
            source: sourceDescription,
            itemCount,
        },
    });
    return {
        plan: planStep,
    };
}
async function previewComputeStep(flowId, step, state, templateContext, context, plan) {
    const result = await resolveComputeStepValues(step, state, templateContext, context);
    for (const [key, value] of Object.entries(result.values)) {
        state.answers[key] = value;
    }
    const planStep = {
        kind: "compute",
        id: step.id,
        label: step.label,
        description: step.description,
        handler: result.handler,
        storeAs: result.storeAs,
        values: result.values,
    };
    plan.events.push({
        type: "plan.step",
        flowId,
        stepId: step.id,
        data: {
            kind: "compute",
            handler: result.handler,
            storeAs: result.storeAs,
            values: result.values,
        },
    });
    return { plan: planStep };
}
async function previewGitWorktreeGuardStep(flowId, step, state, context, templateContext, plan) {
    const cwd = resolveWorktreeGuardCwd(step, templateContext, context);
    const status = await readWorktreeStatus(cwd);
    const strategyKey = getStrategyAnswerKey(step);
    const strategy = readStoredStrategy(state.answers[strategyKey]) ??
        peekStrategyOverride(step, context, state, strategyKey);
    const summary = status === "clean"
        ? renderTemplate(step.cleanMessage ?? DEFAULT_WORKTREE_CLEAN_MESSAGE, templateContext)
        : buildDirtyWorktreePreviewMessage(step, templateContext, strategy, state);
    if (status === "dirty" && !strategy) {
        plan.pendingPromptCount += 1;
    }
    const planStep = {
        kind: "git-worktree-guard",
        id: step.id,
        label: step.label,
        status,
        strategy,
        message: summary,
    };
    plan.events.push({
        type: "plan.step",
        flowId,
        stepId: step.id,
        data: {
            kind: "git-worktree-guard",
            status,
            strategy,
        },
    });
    return { plan: planStep };
}
async function previewPluginStep(flow, step, state, context, templateContext, plan) {
    const registration = getPluginRegistration(context, step.type);
    const handler = registration.handler;
    const helpers = createPluginHelpers(templateContext);
    let planResult;
    if (typeof handler.plan === "function") {
        planResult = await handler.plan({
            flowId: flow.id,
            step,
            state,
            context,
            templateContext,
            helpers,
        });
    }
    const pluginPlan = buildPluginPlan(step, registration.pluginName, planResult);
    plan.events.push({
        type: "plan.step",
        flowId: flow.id,
        stepId: step.id,
        data: {
            kind: "plugin",
            pluginType: pluginPlan.pluginType,
            pluginName: pluginPlan.pluginName,
            summary: pluginPlan.summary,
            details: pluginPlan.details,
        },
    });
    if (planResult?.events) {
        for (const event of planResult.events) {
            plan.events.push({
                type: event.type,
                flowId: flow.id,
                stepId: step.id,
                data: event.data ?? {},
            });
        }
    }
    return {
        plan: pluginPlan,
        next: planResult?.next,
    };
}
function computeEnvDiffEntries(presetEnv, defaultEnv, commandEnv) {
    const keys = new Set([
        ...Object.keys(presetEnv),
        ...Object.keys(defaultEnv),
        ...Object.keys(commandEnv),
    ]);
    const entries = [];
    for (const key of keys) {
        if (Object.prototype.hasOwnProperty.call(commandEnv, key)) {
            const previous = Object.prototype.hasOwnProperty.call(defaultEnv, key)
                ? defaultEnv[key]
                : presetEnv[key];
            entries.push({
                key,
                value: commandEnv[key],
                previous,
                source: "command",
            });
            continue;
        }
        if (Object.prototype.hasOwnProperty.call(defaultEnv, key)) {
            const previous = presetEnv[key];
            entries.push({
                key,
                value: defaultEnv[key],
                previous,
                source: "defaults",
            });
            continue;
        }
        if (Object.prototype.hasOwnProperty.call(presetEnv, key)) {
            entries.push({
                key,
                value: presetEnv[key],
                source: "preset",
            });
        }
    }
    return entries;
}
async function runFlow(config, flowId, state, context, options = {}) {
    const flow = config.flows[flowId];
    if (!flow) {
        throw new Error(`Flow "${flowId}" not found in configuration.`);
    }
    const stepIndex = new Map();
    flow.steps.forEach((step, index) => stepIndex.set(step.id, index));
    const checkpoint = options.checkpoint;
    for (let pointer = clampIndex(options.startingStepIndex ?? 0, flow.steps.length); pointer < flow.steps.length; pointer += 1) {
        const step = flow.steps[pointer];
        const startedAt = Date.now();
        state.stepCursor = pointer;
        if (checkpoint) {
            await checkpoint.record(state, { immediate: true });
        }
        emitLog(context, {
            type: "step.start",
            flowId: flow.id,
            stepId: step.id,
            stepType: step.type,
            index: pointer,
        });
        const breadcrumb = showProgress(context, flow, step, pointer, flow.steps.length);
        const result = await executeStep(flow, step, state, context);
        const durationMs = Date.now() - startedAt;
        const nextTarget = result?.next;
        const status = result?.status ?? "success";
        const isRepeat = nextTarget === "repeat";
        if (!isRepeat) {
            state.completedSteps += 1;
        }
        emitLog(context, {
            type: "step.complete",
            flowId: flow.id,
            stepId: step.id,
            stepType: step.type,
            index: pointer,
            next: nextTarget,
            durationMs,
        });
        reportStepCompletion(context, breadcrumb, status, nextTarget, context.dryRun, context.quiet, durationMs);
        if (nextTarget === "exit") {
            if (checkpoint) {
                await checkpoint.record(state, { immediate: true });
            }
            return "exit";
        }
        if (isRepeat) {
            pointer -= 1;
            continue;
        }
        if (typeof nextTarget === "string") {
            const nextIndex = stepIndex.get(nextTarget);
            if (typeof nextIndex !== "number") {
                throw new Error(`Step "${step.id}" attempted to jump to unknown step "${nextTarget}".`);
            }
            state.stepCursor = nextIndex;
            pointer = nextIndex - 1;
            continue;
        }
        state.stepCursor = pointer + 1;
        if (checkpoint) {
            await checkpoint.record(state);
        }
    }
    state.stepCursor = 0;
    if (checkpoint) {
        await checkpoint.record(state, { immediate: true });
    }
    return undefined;
}
async function runPostRunHooks(scenario, state, context, checkpoint) {
    const hooks = scenario.postRun;
    if (!hooks || hooks.length === 0) {
        return false;
    }
    const succeeded = state.failedSteps === 0;
    state.phase = "post-run";
    state.postRunCursor = state.postRunCursor ?? 0;
    for (let index = state.postRunCursor; index < hooks.length; index += 1) {
        const hook = hooks[index];
        const when = hook.when ?? "always";
        const shouldRun = (when === "always") ||
            (when === "on-success" && succeeded) ||
            (when === "on-failure" && !succeeded);
        if (!shouldRun) {
            state.postRunCursor = index + 1;
            continue;
        }
        state.postRunCursor = index;
        if (checkpoint) {
            await checkpoint.record(state, { immediate: true });
        }
        await runFlow(context.config, hook.flow, state, context, {
            checkpoint,
            startingStepIndex: 0,
        });
        state.postRunCursor = index + 1;
        if (checkpoint) {
            await checkpoint.record(state);
        }
    }
    state.postRunCursor = hooks.length;
    return true;
}
async function executeStep(flow, step, state, context) {
    const templateContext = buildTemplateContext(context, state, step);
    if (isPluginStep(step)) {
        return executePluginStep(flow, step, state, context, templateContext);
    }
    switch (step.type) {
        case "prompt":
            return executePromptStep(flow.id, step, state, context, templateContext);
        case "message":
            return executeMessageStep(step, templateContext, context);
        case "branch":
            return executeBranchStep(flow.id, step, state, context, templateContext);
        case "group": {
            const next = await runFlow(context.config, step.flow, state, context, {
                checkpoint: context.checkpoint,
            });
            return { next, status: "success" };
        }
        case "command":
            return executeCommandStep(flow.id, step, state, context, templateContext);
        case "iterate":
            return executeIterateStep(flow.id, step, state, context, templateContext);
        case "compute":
            return executeComputeStep(step, state, templateContext, context);
        case "git-worktree-guard":
            return executeGitWorktreeGuardStep(flow.id, step, state, context, templateContext);
        default:
            throw new Error(`Unsupported step type ${step.type}`);
    }
}
const PROMPT_LABEL_MAX_LENGTH = 80;
const PROMPT_HINT_MAX_LENGTH = 60;
const MIN_VISIBLE_PROMPT_ROWS = 5;
export const SKIP_STEP_OPTION_VALUE = "__shortcut_skip_step__";
const SAFE_ABORT_OPTION_VALUE = "__shortcut_safe_abort__";
const REPLAY_SHORTCUT_VALUE = "retry";
const CTRL_S = "\u0013";
const CTRL_R = "\u0012";
const CTRL_X = "\u0018";
const SHORTCUT_LABELS = {
    "skip-step": "Ctrl+S",
    "replay-command": "Ctrl+R",
    "safe-abort": "Ctrl+X",
};
function truncateText(value, maxLength) {
    if (!value) {
        return value;
    }
    return value.length <= maxLength
        ? value
        : `${value.slice(0, Math.max(1, maxLength - 1))}…`;
}
function determineMaxVisiblePromptItems(optionCount) {
    if (optionCount <= 0) {
        return undefined;
    }
    const terminalRows = typeof process.stdout.rows === "number" && process.stdout.rows > 0
        ? process.stdout.rows
        : undefined;
    const availableRows = terminalRows
        ? Math.max(MIN_VISIBLE_PROMPT_ROWS, terminalRows - 6)
        : 10;
    return Math.min(optionCount, availableRows);
}
function logFullPromptOptions(context, step, options) {
    void context;
    void step;
    void options;
}
function normalizeMultiselectDefault(value) {
    if (Array.isArray(value)) {
        return value.map((entry) => String(entry));
    }
    if (typeof value === "string") {
        const trimmed = value.trim();
        if (!trimmed) {
            return undefined;
        }
        try {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed)) {
                return parsed.map((entry) => String(entry));
            }
        }
        catch {
            return undefined;
        }
    }
    return undefined;
}
async function executePromptStep(flowId, step, state, context, templateContext) {
    const prompt = renderTemplate(step.prompt, templateContext);
    const key = step.storeAs ?? step.id;
    let defaultValue = renderMaybeNested(step.defaultValue, templateContext);
    const override = getOverride(context, key, step.id);
    const persistenceTarget = resolvePromptPersistenceTarget(step, state);
    if (override !== undefined) {
        const parsed = parseOverrideValue(step, override);
        validatePromptValue(step, parsed);
        state.answers[key] = parsed;
        logSuccess(context, `[override] ${key}=${formatOverrideDisplay(parsed, step.mode)}`);
        emitLog(context, {
            type: "prompt.answer",
            flowId,
            stepId: step.id,
            value: parsed,
        });
        removeOverride(context, key, step.id);
        persistPromptAnswer(context, persistenceTarget, parsed);
        return { status: "success" };
    }
    if (persistenceTarget && context.promptPersistence) {
        const persisted = context.promptPersistence.get(persistenceTarget);
        if (persisted !== undefined) {
            validatePromptValue(step, persisted);
            const applied = Boolean(context.usePromptPersistenceAnswers);
            logPromptPersistenceEvent(context, flowId, step.id, persistenceTarget, "hit", applied);
            if (applied) {
                state.answers[key] = persisted;
                logSuccess(context, `[persisted] ${key}=${formatOverrideDisplay(persisted, step.mode)}`);
                emitLog(context, {
                    type: "prompt.answer",
                    flowId,
                    stepId: step.id,
                    value: persisted,
                });
                return { status: "success" };
            }
            if (defaultValue === undefined) {
                defaultValue = persisted;
            }
        }
        else {
            logPromptPersistenceEvent(context, flowId, step.id, persistenceTarget, "miss");
        }
    }
    let promptOptions;
    const expectsOptions = step.mode === "select" || step.mode === "multiselect";
    if (expectsOptions) {
        promptOptions = await buildPromptOptions(step, templateContext, context);
        if (promptOptions.length === 0) {
            throw new Error(`Prompt "${step.id}" did not produce any options. Ensure static options or dynamic sources are configured.`);
        }
    }
    const promptHistory = ensurePromptHistory(context);
    let answer;
    if (context.nonInteractive) {
        throw new Error(`Non-interactive run cannot prompt for "${step.id}" (${key}). Provide it via --answers/--set or run in collect mode first.`);
    }
    switch (step.mode) {
        case "input":
            answer = await context.promptDriver.textWithHistory({
                message: prompt,
                initialValue: typeof defaultValue === "string" ? defaultValue : undefined,
                validate(value) {
                    if (step.required && !value?.trim()) {
                        return "A value is required.";
                    }
                    return undefined;
                },
                history: promptHistory.getAll(key),
            });
            break;
        case "confirm":
            answer = await context.promptDriver.confirm({
                message: prompt,
                initialValue: typeof defaultValue === "boolean"
                    ? defaultValue
                    : undefined,
            });
            break;
        case "select":
            logFullPromptOptions(context, step, promptOptions);
            answer = await context.promptDriver.select({
                message: prompt,
                initialValue: typeof defaultValue === "string"
                    ? defaultValue
                    : undefined,
                options: promptOptions ?? [],
            });
            break;
        case "multiselect":
            {
                logFullPromptOptions(context, step, promptOptions);
                const initialValues = normalizeMultiselectDefault(defaultValue);
                const optionsList = (promptOptions ?? []);
                const maxVisibleItems = determineMaxVisiblePromptItems(promptOptions?.length ?? 0);
                answer = await context.promptDriver.multiselect({
                    message: prompt,
                    initialValues,
                    options: optionsList,
                    required: step.required,
                    showSelectionOrder: step.showSelectionOrder,
                    maxItems: maxVisibleItems,
                });
            }
            break;
        default:
            throw new Error(`Unknown prompt mode: ${step.mode}`);
    }
    validatePromptValue(step, answer);
    state.answers[key] = answer;
    if (step.mode === "input" && typeof answer === "string") {
        promptHistory.record(key, answer);
    }
    emitLog(context, {
        type: "prompt.answer",
        flowId,
        stepId: step.id,
        value: answer,
    });
    persistPromptAnswer(context, persistenceTarget, answer);
    return { status: "success" };
}
function resolvePromptPersistenceTarget(step, state) {
    const config = getPromptPersistConfig(step);
    if (!config) {
        return undefined;
    }
    const key = config.key ?? step.storeAs ?? step.id;
    if (!key) {
        return undefined;
    }
    const scope = config.scope ?? "scenario";
    if (scope === "project") {
        const projectId = getCurrentProjectId(state);
        if (!projectId) {
            return undefined;
        }
        return { scope, key, projectId };
    }
    return { scope, key };
}
function getPromptPersistConfig(step) {
    if (step.persist === false) {
        return undefined;
    }
    if (step.persist && typeof step.persist === "object") {
        return step.persist;
    }
    return {};
}
function getCurrentProjectId(state) {
    const project = state.answers.project;
    if (project && typeof project === "object") {
        const candidate = project.id;
        if (typeof candidate === "string" && candidate.trim().length > 0) {
            return candidate;
        }
    }
    const projectId = state.answers.projectId;
    if (typeof projectId === "string" && projectId.trim().length > 0) {
        return projectId;
    }
    return undefined;
}
function persistPromptAnswer(context, target, value) {
    if (!target || !context.promptPersistence) {
        return;
    }
    context.promptPersistence.set(target, value);
}
function logPromptPersistenceEvent(context, flowId, stepId, target, status, applied) {
    emitLog(context, {
        type: "prompt.persistence",
        flowId,
        stepId,
        scope: target.scope,
        key: target.key,
        projectId: target.projectId,
        status,
        ...(typeof applied === "boolean" ? { applied } : {}),
    });
}
function renderPromptOption(option, templateContext) {
    const renderedLabel = renderTemplate(option.label, templateContext);
    const renderedHint = option.hint
        ? renderTemplate(option.hint, templateContext)
        : undefined;
    const truncatedLabelText = truncateText(renderedLabel, PROMPT_LABEL_MAX_LENGTH);
    const truncatedHintText = truncateText(renderedHint, PROMPT_HINT_MAX_LENGTH);
    return {
        value: option.value,
        label: truncatedLabelText ?? renderedLabel,
        hint: truncatedHintText,
        disabled: option.disabled ?? false,
        fullLabel: renderedLabel ?? option.label,
        fullHint: renderedHint,
        isLabelTruncated: renderedLabel !== undefined && (truncatedLabelText ?? renderedLabel) !== renderedLabel,
        isHintTruncated: renderedHint !== undefined && (truncatedHintText ?? renderedHint) !== renderedHint,
    };
}
async function buildPromptOptions(step, templateContext, context) {
    assertDynamicCommandAllowed(step.id, step.dynamic, context, "prompt");
    const dynamicContext = getDynamicContext(context);
    const dynamicOptions = (await resolveDynamicPromptOptions(step.dynamic, templateContext, dynamicContext)) ??
        [];
    const combined = [...dynamicOptions, ...(step.options ?? [])];
    const rendered = combined.map((option) => renderPromptOption(option, templateContext));
    const unique = new Map();
    for (const option of rendered) {
        unique.set(option.value, option);
    }
    return Array.from(unique.values());
}
async function resolveIterationItems(step, state, templateContext, context) {
    if (step.items === undefined && step.source === undefined) {
        throw new Error(`Iterate step "${step.id}" must define either items or a source.`);
    }
    if (Array.isArray(step.items)) {
        const rendered = renderMaybeNested(step.items, templateContext);
        return normalizeItems(rendered);
    }
    if (step.source) {
        switch (step.source.from) {
            case "answers": {
                const value = state.answers[step.source.key];
                return normalizeItems(value);
            }
            case "dynamic": {
                assertDynamicCommandAllowed(step.id, step.source.dynamic, context, "iterate");
                const options = (await resolveDynamicPromptOptions(step.source.dynamic, templateContext, getDynamicContext(context))) ?? [];
                return options.map((option) => option.value);
            }
            case "json": {
                const options = (await resolveDynamicPromptOptions({
                    type: "json",
                    path: step.source.path,
                    pointer: step.source.pointer,
                }, templateContext, getDynamicContext(context))) ?? [];
                return options.map((option) => option.value);
            }
            default:
                return [];
        }
    }
    return [];
}
function assertDynamicCommandAllowed(stepId, dynamic, context, sourceLabel) {
    if (context.phase !== "collect" || dynamic?.type !== "command") {
        return;
    }
    throw new Error(`Collect mode cannot resolve dynamic.command options for ${sourceLabel} "${stepId}". Use "glob", "json", or "workspace-projects" providers, or move the command into a compute step.`);
}
function normalizeItems(value) {
    if (Array.isArray(value)) {
        return value.slice();
    }
    if (value === undefined || value === null) {
        return [];
    }
    return [value];
}
function getDynamicContext(context) {
    const cache = context.promptOptionsCache ?? new Map();
    if (!context.promptOptionsCache) {
        context.promptOptionsCache = cache;
    }
    return {
        repoRoot: context.repoRoot,
        cache,
    };
}
function maybeStoreCommandOutput(state, record, context) {
    const descriptor = record.rendered;
    const storeKey = descriptor.storeStdoutAs;
    if (!storeKey) {
        return;
    }
    const storeWhen = descriptor.storeWhen ?? "success";
    const shouldStore = storeWhen === "always" ||
        (storeWhen === "success" && record.success) ||
        (storeWhen === "failure" && !record.success);
    if (!shouldStore) {
        return;
    }
    const rawOutput = record.stdout ?? "";
    const parseOptions = typeof descriptor.parseJson === "object"
        ? descriptor.parseJson
        : descriptor.parseJson
            ? {}
            : undefined;
    let value = rawOutput;
    if (descriptor.parseJson) {
        try {
            const reviver = parseOptions?.reviver
                ? createReviver(context, parseOptions.reviver)
                : undefined;
            value = JSON.parse(rawOutput || "null", reviver);
        }
        catch (error) {
            if (parseOptions?.onError === "warn") {
                logWarn(context, `Failed to parse JSON output for ${chalk.cyan(record.stepId)}: ${error instanceof Error ? error.message : String(error)}. Using raw stdout instead.`);
                value = rawOutput;
            }
            else {
                throw new Error(`Failed to parse JSON output for ${record.stepId}: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
    }
    if (descriptor.redactKeys && descriptor.redactKeys.length > 0) {
        value = applyRedactions(value, descriptor.redactKeys);
    }
    state.answers[storeKey] = value;
}
function createReviver(context, code) {
    if (!code.trim()) {
        return undefined;
    }
    try {
        // eslint-disable-next-line no-new-func
        const fn = new Function("key", "value", code);
        return function reviver(key, value) {
            return fn.call(this, key, value);
        };
    }
    catch (error) {
        logWarn(context, `Ignoring invalid parseJson.reviver script: ${error instanceof Error ? error.message : String(error)}.`);
        return undefined;
    }
}
function applyRedactions(value, paths) {
    if (!value || typeof value !== "object") {
        return value;
    }
    const clone = cloneValue(value);
    for (const path of paths) {
        redactPath(clone, path);
    }
    return clone;
}
function cloneValue(input) {
    if (Array.isArray(input)) {
        return input.map((item) => cloneValue(item));
    }
    if (input && typeof input === "object") {
        return Object.fromEntries(Object.entries(input).map(([key, val]) => [
            key,
            cloneValue(val),
        ]));
    }
    return input;
}
function redactPath(target, path) {
    if (!target || typeof target !== "object") {
        return;
    }
    const segments = path.split(".").filter(Boolean);
    if (segments.length === 0) {
        return;
    }
    let current = target;
    for (let index = 0; index < segments.length - 1; index += 1) {
        const segment = segments[index];
        const key = getSegment(segment);
        if (current == null ||
            (typeof key === "number"
                ? !Array.isArray(current) || key >= current.length
                : typeof current !== "object" || !(key in current))) {
            return;
        }
        current = current[key];
    }
    const finalSegment = segments[segments.length - 1];
    const finalKey = getSegment(finalSegment);
    if (current == null) {
        return;
    }
    if (typeof finalKey === "number") {
        if (Array.isArray(current) && finalKey < current.length) {
            current[finalKey] = "[REDACTED]";
        }
    }
    else if (typeof current === "object" && finalKey in current) {
        current[finalKey] = "[REDACTED]";
    }
}
function getSegment(segment) {
    if (/^\d+$/.test(segment)) {
        return Number(segment);
    }
    return segment;
}
function executeMessageStep(step, templateContext, context) {
    const textValue = renderTemplate(step.text, templateContext);
    let status = "success";
    switch (step.level ?? "info") {
        case "success":
            logSuccess(context, textValue);
            break;
        case "warning":
            logWarn(context, textValue);
            status = "warning";
            break;
        case "error":
            logError(context, textValue);
            status = "error";
            break;
        default:
            logInfo(context, textValue);
    }
    return { next: step.next?.next, status };
}
function executeBranchStep(flowId, step, state, context, templateContext) {
    for (const branch of step.branches) {
        const expression = renderTemplate(branch.when, templateContext);
        const result = evaluateCondition(expression, {
            answers: state.answers,
            scenario: state.scenario,
            lastCommand: state.lastCommand,
        });
        emitLog(context, {
            type: "branch.decision",
            flowId,
            stepId: step.id,
            expression,
            result,
            target: result ? branch.next : undefined,
        });
        if (result) {
            return { next: branch.next, status: "success" };
        }
    }
    if (step.defaultNext) {
        emitLog(context, {
            type: "branch.decision",
            flowId,
            stepId: step.id,
            expression: "default",
            result: true,
            target: step.defaultNext.next,
        });
    }
    return { next: step.defaultNext?.next, status: "success" };
}
function resolveCommandDescriptor(raw, step, config) {
    const defaults = step.defaults;
    const presetName = raw.preset ?? defaults?.preset;
    const preset = presetName
        ? getResolvedCommandPreset(config, presetName)?.definition
        : undefined;
    const presetDefaults = preset ? withoutPresetMetadata(preset) : undefined;
    if (presetName && !preset) {
        throw new Error(`Command preset "${presetName}" referenced by step "${step.id}" was not found in commandPresets.`);
    }
    const mergedEnv = {
        ...(presetDefaults?.env ?? {}),
        ...(defaults?.env ?? {}),
        ...(raw.env ?? {}),
    };
    const descriptor = {
        ...(presetDefaults ?? {}),
        ...(defaults ?? {}),
        ...raw,
        env: Object.keys(mergedEnv).length > 0 ? mergedEnv : undefined,
    };
    return descriptor;
}
function withoutPresetMetadata(preset) {
    const { description, tags, ...rest } = preset;
    void description;
    void tags;
    return rest;
}
async function executeIterateStep(flowId, step, state, context, templateContext) {
    const items = await resolveIterationItems(step, state, templateContext, context);
    if (items.length === 0) {
        logWarn(context, `[iterate] Step ${chalk.cyan(step.id)} did not resolve any items. Skipping.`);
        return { status: "warning" };
    }
    if (step.concurrency && step.concurrency > 1) {
        logWarn(context, `[iterate] concurrency > 1 is not yet supported (step ${chalk.cyan(step.id)}). Falling back to sequential execution.`);
    }
    const previousIteration = state.iteration;
    const previousStoredValue = step.storeEachAs
        ? state.answers[step.storeEachAs]
        : undefined;
    let hadFailure = false;
    for (let index = 0; index < items.length; index += 1) {
        const value = items[index];
        state.iteration = {
            index,
            total: items.length,
            value,
            key: step.over ?? step.storeEachAs,
        };
        if (step.storeEachAs) {
            state.answers[step.storeEachAs] = value;
        }
        const failuresBefore = state.failedSteps;
        const result = await runFlow(context.config, step.flow, state, context, {
            checkpoint: context.checkpoint,
        });
        if (state.failedSteps > failuresBefore) {
            hadFailure = true;
        }
        if (result === "exit") {
            state.iteration = previousIteration;
            if (step.storeEachAs) {
                if (previousStoredValue === undefined) {
                    delete state.answers[step.storeEachAs];
                }
                else {
                    state.answers[step.storeEachAs] = previousStoredValue;
                }
            }
            return { next: "exit", status: hadFailure ? "warning" : "success" };
        }
    }
    state.iteration = previousIteration;
    if (step.storeEachAs) {
        if (previousStoredValue === undefined) {
            delete state.answers[step.storeEachAs];
        }
        else {
            state.answers[step.storeEachAs] = previousStoredValue;
        }
    }
    return { status: hadFailure ? "warning" : "success" };
}
async function executeComputeStep(step, state, templateContext, context) {
    const result = await resolveComputeStepValues(step, state, templateContext, context);
    for (const [key, value] of Object.entries(result.values)) {
        state.answers[key] = value;
    }
    return { next: step.next?.next, status: "success" };
}
async function resolveComputeStepValues(step, state, templateContext, context) {
    if (step.handler) {
        const handler = getComputeHandler(step.handler);
        if (!handler) {
            throw new Error(`Unknown compute handler "${step.handler}".`);
        }
        const renderedParams = renderMaybeNested(step.params ?? {}, templateContext);
        const params = normalizeComputeParams(step, renderedParams);
        const result = await handler(params, {
            repoRoot: context.repoRoot,
            state,
            templateContext,
        });
        const values = normalizeComputeResult(step, result);
        return {
            values,
            handler: step.handler,
            storeAs: step.storeAs,
        };
    }
    return {
        values: renderComputeValues(step, templateContext),
    };
}
function renderComputeValues(step, templateContext) {
    const values = {};
    for (const [key, value] of Object.entries(step.values ?? {})) {
        values[key] = renderMaybeNested(value, templateContext);
    }
    return values;
}
function normalizeComputeParams(step, params) {
    if (!params || typeof params !== "object" || Array.isArray(params)) {
        throw new Error(`Compute step "${step.id}" params must resolve to an object.`);
    }
    return params;
}
function normalizeComputeResult(step, result) {
    if (step.storeAs) {
        return { [step.storeAs]: result };
    }
    if (result && typeof result === "object" && !Array.isArray(result)) {
        return result;
    }
    throw new Error(`Compute step "${step.id}" must define storeAs when the handler result is not an object.`);
}
async function executeGitWorktreeGuardStep(flowId, step, state, context, templateContext) {
    const cwd = resolveWorktreeGuardCwd(step, templateContext, context);
    const status = await readWorktreeStatus(cwd);
    if (status === "clean") {
        const message = renderTemplate(step.cleanMessage ?? DEFAULT_WORKTREE_CLEAN_MESSAGE, templateContext);
        if (!context.quiet) {
            logSuccess(context, `[git] ${message}`);
        }
        return { status: "success" };
    }
    const dirtyMessage = renderTemplate(step.dirtyMessage ?? DEFAULT_WORKTREE_DIRTY_MESSAGE, templateContext);
    if (!context.quiet) {
        logWarn(context, `[git] ${dirtyMessage}`);
    }
    const strategy = await ensureWorktreeStrategy(flowId, step, state, context, templateContext);
    if (strategy === "commit-push" || strategy === "branch") {
        let branchName;
        if (strategy === "branch") {
            branchName = await ensureBranchName(flowId, step, state, context, templateContext);
            await applyBranchStrategy(cwd, branchName);
            if (!context.quiet) {
                logSuccess(context, `[git] Created and switched to branch ${branchName}.`);
            }
        }
        const commitMessage = await ensureCommitMessage(flowId, step, state, context, templateContext);
        await applyCommitStrategy(cwd, commitMessage);
        if (!context.quiet) {
            const branchSuffix = branchName ? ` on ${branchName}` : "";
            logSuccess(context, `[git] Committed and pushed local changes${branchSuffix} (${commitMessage}).`);
        }
    }
    else if (strategy === "stash") {
        const stashMessage = await ensureStashMessage(flowId, step, state, context, templateContext);
        await applyStashStrategy(cwd, stashMessage);
        if (!context.quiet) {
            logSuccess(context, `[git] Stashed changes (${stashMessage}).`);
        }
    }
    else {
        if (!context.quiet) {
            logWarn(context, "[git] Proceeding with dirty working tree.");
        }
    }
    return { status: "success" };
}
function resolveWorktreeGuardCwd(step, templateContext, context) {
    const repoRoot = context.repoRoot;
    if (!step.cwd) {
        return repoRoot;
    }
    const rendered = renderTemplate(step.cwd, templateContext).trim();
    if (rendered.length === 0) {
        return repoRoot;
    }
    return path.isAbsolute(rendered)
        ? rendered
        : path.join(repoRoot, rendered);
}
async function readWorktreeStatus(cwd) {
    try {
        const result = await execaCommand("git status --porcelain --untracked-files=normal", { cwd });
        return result.stdout.trim().length === 0 ? "clean" : "dirty";
    }
    catch (error) {
        throw new Error(`Failed to inspect the git working tree in ${cwd}: ${error instanceof Error ? error.message : String(error)}`);
    }
}
function getStrategyAnswerKey(step) {
    return step.storeStrategyAs ?? `${step.id}Strategy`;
}
function getCommitMessageKey(step) {
    return step.storeCommitMessageAs ?? `${step.id}CommitMessage`;
}
function getStashMessageKey(step) {
    return step.storeStashMessageAs ?? `${step.id}StashMessage`;
}
function getBranchNameKey(step) {
    return step.storeBranchNameAs ?? `${step.id}BranchName`;
}
function readStoredStrategy(value) {
    if (typeof value !== "string") {
        return undefined;
    }
    if (value === "commit-push" ||
        value === "stash" ||
        value === "branch" ||
        value === "proceed") {
        return value;
    }
    return undefined;
}
function peekStrategyOverride(step, context, state, key) {
    const override = getOverride(context, key, step.id);
    if (override === undefined) {
        return undefined;
    }
    const normalized = readStoredStrategy(typeof override === "string" ? override : String(override));
    if (!normalized) {
        throw new Error(`Override for "${key}" must be one of: commit-push, stash, branch, proceed.`);
    }
    state.answers[key] = normalized;
    return normalized;
}
function buildDirtyWorktreePreviewMessage(step, templateContext, strategy, state) {
    if (strategy) {
        const meta = STRATEGY_METADATA[strategy];
        if (strategy === "branch") {
            const branchName = readStoredString(state.answers[getBranchNameKey(step)]);
            if (branchName) {
                return `${meta.planSummary} Branch: ${branchName}.`;
            }
        }
        return meta.planSummary;
    }
    const allowed = listAllowedStrategies(step)
        .map((strategyId) => STRATEGY_METADATA[strategyId].label)
        .join(", ");
    const base = renderTemplate(step.dirtyMessage ?? DEFAULT_WORKTREE_DIRTY_MESSAGE, templateContext);
    return `${base} Strategies: ${allowed}.`;
}
async function ensureWorktreeStrategy(flowId, step, state, context, templateContext) {
    const key = getStrategyAnswerKey(step);
    const existing = readStoredStrategy(state.answers[key]);
    if (existing) {
        return existing;
    }
    const options = buildStrategyOptions(step);
    const prompt = {
        id: `${step.id}.strategy`,
        type: "prompt",
        mode: "select",
        prompt: renderTemplate(step.prompt ?? DEFAULT_WORKTREE_PROMPT, templateContext),
        options,
        storeAs: key,
        required: true,
    };
    await executePromptStep(flowId, prompt, state, context, templateContext);
    const selected = readStoredStrategy(state.answers[key]);
    if (!selected) {
        throw new Error(`No strategy selected for worktree guard step "${step.id}".`);
    }
    return selected;
}
async function ensureCommitMessage(flowId, step, state, context, templateContext) {
    const key = getCommitMessageKey(step);
    const existing = readStoredString(state.answers[key]);
    if (existing) {
        return existing;
    }
    const prompt = {
        id: `${step.id}.commitMessage`,
        type: "prompt",
        mode: "input",
        storeAs: key,
        required: true,
        prompt: renderTemplate(step.commitMessagePrompt ?? DEFAULT_COMMIT_MESSAGE_PROMPT, templateContext),
        defaultValue: renderTemplate(step.commitMessageDefault ?? DEFAULT_COMMIT_MESSAGE_TEMPLATE, templateContext),
    };
    await executePromptStep(flowId, prompt, state, context, templateContext);
    const value = readStoredString(state.answers[key]);
    if (!value) {
        throw new Error("Commit message is required to continue.");
    }
    return value;
}
async function ensureStashMessage(flowId, step, state, context, templateContext) {
    const key = getStashMessageKey(step);
    const existing = readStoredString(state.answers[key]);
    if (existing) {
        return existing;
    }
    const prompt = {
        id: `${step.id}.stashMessage`,
        type: "prompt",
        mode: "input",
        storeAs: key,
        required: true,
        prompt: renderTemplate(step.stashMessagePrompt ?? DEFAULT_STASH_MESSAGE_PROMPT, templateContext),
        defaultValue: renderTemplate(step.stashMessageDefault ?? DEFAULT_STASH_MESSAGE_TEMPLATE, templateContext),
    };
    await executePromptStep(flowId, prompt, state, context, templateContext);
    const value = readStoredString(state.answers[key]);
    if (!value) {
        throw new Error("Stash message is required to continue.");
    }
    return value;
}
async function ensureBranchName(flowId, step, state, context, templateContext) {
    const key = getBranchNameKey(step);
    const existing = readStoredString(state.answers[key]);
    if (existing) {
        return existing;
    }
    const fallbackName = buildDefaultBranchName();
    const defaultValue = step.branchNameDefault
        ? renderTemplate(step.branchNameDefault, templateContext)
        : fallbackName;
    const prompt = {
        id: `${step.id}.branchName`,
        type: "prompt",
        mode: "input",
        storeAs: key,
        required: true,
        prompt: renderTemplate(step.branchNamePrompt ?? DEFAULT_BRANCH_PROMPT, templateContext),
        defaultValue,
    };
    await executePromptStep(flowId, prompt, state, context, templateContext);
    const value = readStoredString(state.answers[key]);
    if (!value) {
        throw new Error("Branch name is required to continue.");
    }
    return value;
}
function readStoredString(value) {
    if (typeof value !== "string") {
        return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}
function buildDefaultBranchName() {
    const today = new Date().toISOString().slice(0, 10);
    return `${DEFAULT_BRANCH_NAME_PREFIX}-${today}`;
}
async function applyCommitStrategy(cwd, message) {
    await autoCommitNestedRepositories(cwd, message);
    try {
        await execa("git", ["add", "-A"], { cwd });
        await execa("git", ["commit", "-m", message], { cwd });
        await pushWithUpstreamFallback(cwd);
    }
    catch (error) {
        throw new Error(`Failed to commit and push local changes: ${error instanceof Error ? error.message : String(error)}`);
    }
}
async function applyBranchStrategy(cwd, branchName) {
    try {
        await execa("git", ["switch", "-c", branchName], { cwd });
        return;
    }
    catch {
        try {
            await execa("git", ["checkout", "-b", branchName], { cwd });
            return;
        }
        catch (secondError) {
            const message = secondError instanceof Error ? secondError.message : String(secondError);
            throw new Error(`Failed to create branch ${branchName}: ${message}`);
        }
    }
}
async function applyStashStrategy(cwd, message) {
    try {
        await execa("git", ["stash", "push", "--include-untracked", "-m", message], {
            cwd,
        });
    }
    catch (error) {
        throw new Error(`Failed to stash local changes: ${error instanceof Error ? error.message : String(error)}`);
    }
}
function buildStrategyOptions(step) {
    const allowed = listAllowedStrategies(step);
    return allowed.map((strategy) => {
        const meta = STRATEGY_METADATA[strategy];
        return {
            value: strategy,
            label: meta.label,
            hint: meta.hint,
        };
    });
}
async function autoCommitNestedRepositories(cwd, message) {
    const manifestPath = path.join(cwd, "workspace.repos.json");
    if (!(await pathExists(manifestPath))) {
        return;
    }
    let manifest = [];
    try {
        const raw = await fs.readFile(manifestPath, "utf8");
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
            manifest = parsed;
        }
    }
    catch {
        return;
    }
    for (const entry of manifest) {
        const repoPath = typeof entry?.path === "string" ? entry.path.trim() : "";
        if (repoPath.length === 0) {
            continue;
        }
        const repoDir = path.isAbsolute(repoPath) ? repoPath : path.join(cwd, repoPath);
        if (!(await pathExists(path.join(repoDir, ".git")))) {
            continue;
        }
        let status;
        try {
            const result = await execaCommand("git status --porcelain --untracked-files=normal", { cwd: repoDir });
            status = result.stdout.trim();
        }
        catch {
            continue;
        }
        if (status.length === 0) {
            continue;
        }
        await execa("git", ["add", "-A"], { cwd: repoDir });
        const diff = await execa("git", ["diff", "--cached", "--name-only"], {
            cwd: repoDir,
        });
        if (diff.stdout.trim().length === 0) {
            continue;
        }
        try {
            await execa("git", ["commit", "-m", message], { cwd: repoDir });
        }
        catch (error) {
            const text = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to commit nested repository "${repoPath}": ${text}`);
        }
        try {
            await pushWithUpstreamFallback(repoDir);
        }
        catch (error) {
            const text = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to push nested repository "${repoPath}": ${text}`);
        }
    }
}
async function pathExists(target) {
    try {
        await fs.access(target);
        return true;
    }
    catch {
        return false;
    }
}
async function getCurrentBranchName(cwd) {
    const result = await execa("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd });
    const name = result.stdout.trim();
    if (!name) {
        throw new Error("Unable to determine current branch name.");
    }
    return name;
}
async function getDefaultRemoteName(cwd, branch) {
    try {
        const { stdout } = await execa("git", ["config", "--get", `branch.${branch}.remote`], {
            cwd,
        });
        const configured = stdout.trim();
        if (configured) {
            return configured;
        }
    }
    catch {
        // Ignore and fall back to first remote.
    }
    try {
        const { stdout } = await execa("git", ["remote"], { cwd });
        const remotes = stdout
            .split(/\r?\n/)
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0);
        if (remotes.length > 0) {
            return remotes[0];
        }
    }
    catch {
        // Ignore and fall back to default origin value.
    }
    return "origin";
}
async function pushWithUpstreamFallback(cwd) {
    try {
        await execa("git", ["push"], { cwd });
        return;
    }
    catch (error) {
        if (!isMissingUpstreamError(error)) {
            throw error;
        }
        const branch = await getCurrentBranchName(cwd);
        const remote = await getDefaultRemoteName(cwd, branch);
        await execa("git", ["push", "--set-upstream", remote, branch], { cwd });
    }
}
function isMissingUpstreamError(error) {
    const message = extractErrorMessage(error).toLowerCase();
    return (message.includes("has no upstream branch") ||
        message.includes("no upstream configured"));
}
function extractErrorMessage(error) {
    if (error && typeof error === "object") {
        const stderr = error.stderr;
        const stdout = error.stdout;
        if (typeof stderr === "string" && stderr.length > 0) {
            return stderr;
        }
        if (typeof stdout === "string" && stdout.length > 0) {
            return stdout;
        }
        if (error instanceof Error && typeof error.message === "string") {
            return error.message;
        }
    }
    return String(error ?? "");
}
function listAllowedStrategies(step) {
    const options = [];
    if (step.allowCommit ?? true) {
        options.push("commit-push");
    }
    if (step.allowStash ?? true) {
        options.push("stash");
    }
    if (step.allowBranch ?? false) {
        options.push("branch");
    }
    if (step.allowProceed ?? false) {
        options.push("proceed");
    }
    if (options.length === 0) {
        throw new Error(`Git worktree guard step "${step.id}" does not enable any strategies.`);
    }
    return options;
}
const STRATEGY_METADATA = {
    "commit-push": {
        label: "Commit + push changes",
        hint: "Stages everything, commits with your message, and pushes to the current remote.",
        planSummary: "Working tree is dirty. Will commit and push local changes before automation runs.",
    },
    stash: {
        label: "Stash changes",
        hint: "Creates a stash entry (including untracked files) so the working tree is clean.",
        planSummary: "Working tree is dirty. Will stash local changes before automation runs.",
    },
    branch: {
        label: "Create a branch, then commit + push",
        hint: "Creates a new branch, switches to it, commits, and pushes so the current branch stays clean.",
        planSummary: "Working tree is dirty. Will create a new branch, then commit and push local changes before automation runs.",
    },
    proceed: {
        label: "Proceed without guarding (not recommended)",
        hint: "Continue without creating a safety snapshot.",
        planSummary: "Working tree is dirty. Will proceed without creating a backup (not recommended).",
    },
};
async function executePluginStep(flow, step, state, context, templateContext) {
    const registration = getPluginRegistration(context, step.type);
    const helpers = createPluginHelpers(templateContext);
    const result = await registration.handler.run({
        flowId: flow.id,
        step,
        state,
        context,
        templateContext,
        helpers,
    });
    return normalizePluginStepResult(result);
}
function normalizeWarnAfterMs(value) {
    if (value === undefined || value === null) {
        return undefined;
    }
    if (typeof value === "number") {
        return Number.isFinite(value) ? value : undefined;
    }
    if (typeof value === "string") {
        const trimmed = value.trim();
        if (trimmed.length === 0) {
            return undefined;
        }
        const parsed = Number(trimmed);
        return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
}
async function executeCommandStep(flowId, step, state, context, templateContext) {
    let hadFailure = false;
    if (context.phase === "collect" && !step.collectSafe) {
        throw new Error(`Collect mode reached command step "${step.id}" in flow "${flowId}". Mark it collectSafe or replace it with a compute step.`);
    }
    for (const descriptor of step.commands) {
        const resolvedDescriptor = resolveCommandDescriptor(descriptor, step, context.config);
        const renderedDescriptor = renderMaybeNested(resolvedDescriptor, templateContext);
        await enforceCommandPolicy({
            context,
            flowId,
            step,
            rawDescriptor: descriptor,
            renderedDescriptor,
        });
        const record = await runCommand({
            flowId,
            step,
            rawDescriptor: descriptor,
            renderedDescriptor,
            context,
        });
        state.lastCommand = record;
        state.history.push(record);
        maybeStoreCommandOutput(state, record, context);
        recordIntegrationTiming(record, state);
        if (!record.success) {
            state.failedSteps += 1;
            hadFailure = true;
        }
        emitLog(context, {
            type: "command.result",
            flowId,
            stepId: step.id,
            command: renderedDescriptor.run,
            cwd: renderedDescriptor.cwd,
            dryRun: context.dryRun,
            success: record.success,
            exitCode: record.exitCode,
            durationMs: record.endedAt.getTime() - record.startedAt.getTime(),
            errorMessage: record.error?.message,
            stdout: record.stdout,
            stderr: record.stderr,
        });
        if (!record.success && !shouldContinueAfterFailure(step, descriptor)) {
            return await handleCommandFailure(flowId, step, state, context, record);
        }
    }
    const nextTarget = step.onSuccess?.next;
    return { next: nextTarget, status: hadFailure ? "warning" : "success" };
}
function shouldContinueAfterFailure(step, descriptor) {
    return Boolean(step.continueOnError || descriptor.continueOnFail);
}
function canPromptForPolicy(context) {
    const stdout = context.stdout;
    if (context.quiet) {
        return false;
    }
    if (stdout && typeof stdout.isTTY === "boolean") {
        return stdout.isTTY;
    }
    return Boolean(process.stdout.isTTY);
}
async function enforceCommandPolicy({ context, flowId, step, rawDescriptor, renderedDescriptor, }) {
    const policyEngine = context.policy;
    if (!policyEngine) {
        return;
    }
    const preset = renderedDescriptor.preset ??
        step.defaults?.preset ??
        rawDescriptor.preset;
    const evaluationInput = {
        flowId,
        stepId: step.id,
        command: renderedDescriptor.run,
        preset,
    };
    const initialDecision = policyEngine.evaluateCommand(evaluationInput);
    if (!initialDecision) {
        return;
    }
    let decision = initialDecision;
    const rule = decision.rule;
    const logPolicyDecision = () => {
        emitLog(context, {
            type: "policy.decision",
            ruleId: rule.id,
            ruleLevel: decision.level,
            enforcedLevel: decision.enforcedLevel,
            acknowledged: decision.acknowledged,
            flowId,
            stepId: step.id,
            command: renderedDescriptor.run,
            note: rule.note,
        });
    };
    const warnMessage = () => {
        const note = rule.note ? ` — ${rule.note}` : "";
        const acknowledgement = decision.acknowledged ? " (acknowledged)" : "";
        logWarn(context, `${chalk.yellow("[policy]")} ${rule.id}${acknowledgement}: ${renderedDescriptor.run}${note}`);
    };
    if (decision.enforcedLevel === "block") {
        const note = rule.note ? ` — ${rule.note}` : "";
        const message = `${chalk.red("[policy]")} ${rule.id}: ${renderedDescriptor.run}${note}`;
        if (!canPromptForPolicy(context)) {
            logError(context, `${message} (blocked)`);
            logPolicyDecision();
            throw new Error(`Command "${renderedDescriptor.run}" blocked by policy "${rule.id}". Use --policy-ack ${rule.id} to proceed.`);
        }
        let proceed = false;
        try {
            proceed = await context.promptDriver.confirm({
                message: `${message}\nContinue anyway?`,
                initialValue: false,
            });
        }
        catch (error) {
            if (!(error instanceof PromptCancelledError)) {
                throw error;
            }
        }
        if (proceed === false) {
            logPolicyDecision();
            throw new Error(`Command "${renderedDescriptor.run}" blocked by policy "${rule.id}".`);
        }
        policyEngine.acknowledge(rule.id);
        const reevaluatedDecision = policyEngine.evaluateCommand(evaluationInput) ?? decision;
        decision = reevaluatedDecision;
        logWarn(context, `${chalk.yellow("[policy acknowledged]")} ${rule.id}: proceeding after acknowledgement.`);
    }
    if (decision.enforcedLevel === "warn") {
        warnMessage();
    }
    logPolicyDecision();
    if (decision.enforcedLevel === "block") {
        throw new Error(`Command "${renderedDescriptor.run}" blocked by policy "${rule.id}".`);
    }
}
async function runCommand({ flowId, step, rawDescriptor, renderedDescriptor, context, }) {
    const startedAt = new Date();
    const quietCommand = Boolean(renderedDescriptor.quiet);
    const requiresStdoutCapture = Boolean(renderedDescriptor.captureStdout ||
        quietCommand ||
        renderedDescriptor.storeStdoutAs ||
        renderedDescriptor.parseJson);
    const stdoutMode = requiresStdoutCapture ? "pipe" : "inherit";
    const warnAfterMs = normalizeWarnAfterMs(renderedDescriptor.warnAfterMs);
    const dryRunStrategy = renderedDescriptor.dryRunStrategy ?? "skip";
    const executingInDryRun = context.dryRun && dryRunStrategy === "execute";
    const registerMode = context.executionMode === "register";
    const collectMode = context.phase === "collect";
    const allowCollectExecution = collectMode && step.collectSafe === true;
    if (context.verbose && !context.quiet && (!context.dryRun || executingInDryRun)) {
        const details = [renderedDescriptor.run];
        if (renderedDescriptor.cwd) {
            details.push(`cwd=${renderedDescriptor.cwd}`);
        }
        if (renderedDescriptor.timeoutMs) {
            details.push(`timeout=${renderedDescriptor.timeoutMs}ms`);
        }
        logInfo(context, chalk.gray(`→ ${details.join(" | ")}`));
    }
    const shouldSkipExecution = registerMode || (!allowCollectExecution && context.dryRun && !executingInDryRun);
    if (shouldSkipExecution) {
        const label = collectMode
            ? "[collect]"
            : registerMode
                ? "[register]"
                : "[dry-run]";
        logInfo(context, `${chalk.gray(label)} ${renderedDescriptor.run}${renderedDescriptor.cwd ? chalk.gray(` (cwd: ${renderedDescriptor.cwd})`) : ""}`);
        return {
            flowId,
            stepId: step.id,
            stepLabel: step.label ?? step.id,
            stepMetadata: step.metadata,
            descriptor: rawDescriptor,
            rendered: renderedDescriptor,
            startedAt,
            endedAt: new Date(),
            success: true,
            exitCode: 0,
            durationMs: 0,
            warnAfterMs,
            longRunning: false,
            timedOut: false,
        };
    }
    if (executingInDryRun) {
        logInfo(context, `${chalk.gray("[dry-run execute]")} ${renderedDescriptor.run}${renderedDescriptor.cwd ? chalk.gray(` (cwd: ${renderedDescriptor.cwd})`) : ""}`);
    }
    try {
        const subprocess = execaCommand(renderedDescriptor.run, {
            cwd: renderedDescriptor.cwd,
            env: {
                ...process.env,
                ...(renderedDescriptor.env ?? {}),
            },
            shell: renderedDescriptor.shell ?? true,
            timeout: renderedDescriptor.timeoutMs,
            stdin: "inherit",
            stdout: stdoutMode,
            stderr: "inherit",
        });
        if (stdoutMode === "pipe" && subprocess.stdout && !context.quiet && !quietCommand) {
            subprocess.stdout.on("data", (chunk) => {
                context.stdout.write(chunk);
            });
        }
        const result = await subprocess;
        const endedAt = new Date();
        const durationMs = Math.max(0, endedAt.getTime() - startedAt.getTime());
        const longRunning = typeof warnAfterMs === "number" && durationMs >= warnAfterMs;
        if (longRunning && !context.quiet) {
            logWarn(context, `${chalk.yellow("⚠")} ${renderedDescriptor.run} exceeded ${formatDurationForLog(warnAfterMs)} (took ${formatDurationForLog(durationMs)})`);
        }
        if (context.verbose && !context.quiet) {
            logSuccess(context, `${chalk.gray("✓")} ${renderedDescriptor.run} (${formatDurationForLog(durationMs)})`);
        }
        return {
            flowId,
            stepId: step.id,
            stepLabel: step.label ?? step.id,
            stepMetadata: step.metadata,
            descriptor: rawDescriptor,
            rendered: renderedDescriptor,
            startedAt,
            endedAt,
            success: true,
            exitCode: result.exitCode,
            stdout: stdoutMode === "pipe" ? result.stdout : undefined,
            stderr: result.stderr,
            durationMs,
            warnAfterMs,
            longRunning,
            timedOut: false,
        };
    }
    catch (error) {
        const failure = error;
        const endedAt = new Date();
        const durationMs = Math.max(0, endedAt.getTime() - startedAt.getTime());
        const durationSuffix = context.verbose ? ` after ${formatDurationForLog(durationMs)}` : "";
        const timedOut = Boolean(failure.timedOut);
        const longRunning = typeof warnAfterMs === "number" && durationMs >= warnAfterMs;
        logError(context, `Command "${renderedDescriptor.run}" failed${typeof failure.exitCode === "number"
            ? ` (exit code ${failure.exitCode})`
            : timedOut
                ? " (timed out)"
                : ""}${durationSuffix}.`);
        if (timedOut && !context.quiet) {
            logWarn(context, `${chalk.yellow("⚠")} ${renderedDescriptor.run} timed out after ${formatDurationForLog(renderedDescriptor.timeoutMs ?? durationMs)}.`);
        }
        return {
            flowId,
            stepId: step.id,
            stepLabel: step.label ?? step.id,
            stepMetadata: step.metadata,
            descriptor: rawDescriptor,
            rendered: renderedDescriptor,
            startedAt,
            endedAt,
            success: false,
            exitCode: typeof failure.exitCode === "number" ? failure.exitCode : undefined,
            stdout: stdoutMode === "pipe" ? failure.stdout : undefined,
            stderr: failure.stderr,
            error: error instanceof Error ? error : new Error(String(error)),
            durationMs,
            warnAfterMs,
            longRunning,
            timedOut,
        };
    }
}
async function handleCommandFailure(flowId, step, state, context, record) {
    void record;
    const autoHandled = maybeApplyAutoHandling(flowId, step, state, context);
    if (autoHandled) {
        return autoHandled;
    }
    const recommendationMessage = buildRecommendationMessage(step.onError);
    if (recommendationMessage) {
        logNote(context, "Recommendation", recommendationMessage);
    }
    const policyResolution = resolveOnErrorPolicy(step.onError?.policy, state);
    if (policyResolution && "target" in policyResolution) {
        const actionLabel = findActionLabel(step.onError?.actions, policyResolution.target);
        if (policyResolution.target === "repeat") {
            recordRetry(state, flowId, step);
        }
        else if (policyResolution.target !== "exit") {
            recordSkip(state, flowId, step, {
                target: policyResolution.target,
                actionLabel,
                reason: "policy",
            });
        }
        logAutoAction(context, step, `policy "${policyResolution.key}" -> ${policyResolution.target}`);
        return {
            next: policyResolution.target,
            status: policyResolution.target === "exit" ? "error" : "warning",
        };
    }
    if (policyResolution &&
        "missing" in policyResolution &&
        context.nonInteractive &&
        policyResolution.required) {
        throw new Error(`Missing policy "${policyResolution.key}" for command "${step.id}". Provide it via answers before executing unattended runs.`);
    }
    const actions = step.onError?.actions ?? [];
    const actionLabels = new Map();
    if (context.nonInteractive) {
        const defaultNext = step.onError?.defaultNext?.next ?? "exit";
        const description = defaultNext === "exit"
            ? "non-interactive run exiting"
            : `non-interactive run using default path -> ${defaultNext}`;
        logAutoAction(context, step, description);
        if (defaultNext !== "exit") {
            recordSkip(state, flowId, step, {
                target: defaultNext,
                reason: "default",
            });
        }
        return {
            next: defaultNext,
            status: defaultNext === "exit" ? "error" : "warning",
        };
    }
    for (const action of actions) {
        actionLabels.set(action.next, action.label);
    }
    if (actions.length === 0) {
        const defaultNext = step.onError?.defaultNext?.next ?? "exit";
        if (defaultNext !== "exit") {
            recordSkip(state, flowId, step, {
                target: defaultNext,
                reason: "default",
            });
        }
        return {
            next: defaultNext,
            status: defaultNext === "exit" ? "error" : "warning",
        };
    }
    const supportsShortcuts = supportsShortcutPrompts(context);
    const shortcutMessage = supportsShortcuts
        ? `\n${chalk.dim(`Shortcuts: ${SHORTCUT_LABELS["skip-step"]} skip · ${SHORTCUT_LABELS["replay-command"]} replay · ${SHORTCUT_LABELS["safe-abort"]} safe abort`)}`
        : "";
    const skipHint = supportsShortcuts
        ? `Mark this step as skipped and continue (${SHORTCUT_LABELS["skip-step"]})`
        : "Mark this step as skipped and continue";
    const replayHint = supportsShortcuts
        ? `Re-run the last command (${SHORTCUT_LABELS["replay-command"]})`
        : "Re-run the last command";
    const abortHint = supportsShortcuts
        ? `Exit and print the summary (${SHORTCUT_LABELS["safe-abort"]})`
        : "Exit and print the summary";
    const promptOptions = [
        ...actions.map((action) => ({
            value: action.next,
            label: action.label,
            hint: action.description,
        })),
        {
            value: SKIP_STEP_OPTION_VALUE,
            label: "Skip this step",
            hint: skipHint,
        },
        {
            value: REPLAY_SHORTCUT_VALUE,
            label: "Replay last command",
            hint: replayHint,
        },
        {
            value: SAFE_ABORT_OPTION_VALUE,
            label: "Safe abort",
            hint: abortHint,
        },
    ];
    let triggeredShortcut;
    let selection;
    try {
        selection = supportsShortcuts
            ? await context.promptDriver.selectWithShortcuts({
                message: `How would you like to proceed?${shortcutMessage}`,
                options: promptOptions,
                shortcuts: [
                    {
                        key: CTRL_S,
                        value: SKIP_STEP_OPTION_VALUE,
                        action: "skip-step",
                    },
                    {
                        key: CTRL_R,
                        value: REPLAY_SHORTCUT_VALUE,
                        action: "replay-command",
                    },
                    {
                        key: CTRL_X,
                        value: SAFE_ABORT_OPTION_VALUE,
                        action: "safe-abort",
                    },
                ],
                onShortcut(action) {
                    const shortcutAction = action;
                    triggeredShortcut = {
                        action: shortcutAction,
                        label: SHORTCUT_LABELS[shortcutAction],
                    };
                },
            })
            : await context.promptDriver.select({
                message: "How would you like to proceed?",
                options: promptOptions,
            });
    }
    catch (error) {
        if (error instanceof PromptCancelledError) {
            return { next: "exit", status: "error" };
        }
        throw error;
    }
    switch (selection) {
        case SAFE_ABORT_OPTION_VALUE:
            if (triggeredShortcut) {
                recordShortcutTrigger({
                    context,
                    step,
                    flowId,
                    action: triggeredShortcut.action,
                    label: triggeredShortcut.label,
                });
            }
            return { next: "exit", status: "error" };
        case REPLAY_SHORTCUT_VALUE:
            if (triggeredShortcut) {
                recordShortcutTrigger({
                    context,
                    step,
                    flowId,
                    action: triggeredShortcut.action,
                    label: triggeredShortcut.label,
                });
            }
            recordRetry(state, flowId, step);
            return { next: "repeat", status: "warning" };
        case SKIP_STEP_OPTION_VALUE: {
            if (triggeredShortcut) {
                recordShortcutTrigger({
                    context,
                    step,
                    flowId,
                    action: triggeredShortcut.action,
                    label: triggeredShortcut.label,
                });
            }
            const target = step.onSuccess?.next;
            recordSkip(state, flowId, step, {
                target,
                actionLabel: "Skip this step",
                reason: "action",
            });
            return {
                next: target,
                status: "warning",
            };
        }
        default: {
            const target = selection;
            const actionLabel = actionLabels.get(target);
            recordSkip(state, flowId, step, {
                target,
                actionLabel,
                reason: "action",
            });
            return {
                next: target,
                status: "warning",
            };
        }
    }
}
function supportsShortcutPrompts(context) {
    if (context.quiet) {
        return false;
    }
    const stdout = context.stdout;
    return Boolean(stdout && typeof stdout.isTTY === "boolean" && stdout.isTTY);
}
function recordShortcutTrigger({ context, step, flowId, action, label, }) {
    emitLog(context, {
        type: "shortcut.trigger",
        action,
        shortcut: label,
        flowId,
        stepId: step.id,
        stepLabel: step.label,
    });
}
function recordRetry(state, flowId, step) {
    state.retries.push({
        flowId,
        stepId: step.id,
        stepLabel: step.label ?? step.id,
    });
}
function recordSkip(state, flowId, step, details) {
    state.skippedSteps.push({
        flowId,
        stepId: step.id,
        stepLabel: step.label ?? step.id,
        target: details.target,
        actionLabel: details.actionLabel,
        reason: details.reason,
    });
}
function resolveOnErrorPolicy(policy, state) {
    if (!policy) {
        return undefined;
    }
    const required = policy.required ?? true;
    const rawValue = resolveAnswerPath(state.answers, policy.key);
    if (rawValue === undefined || rawValue === null || rawValue === "") {
        return { missing: true, key: policy.key, required };
    }
    const value = String(rawValue);
    const target = policy.map[value] ?? policy.default;
    if (!target) {
        return { missing: true, key: policy.key, required };
    }
    return { target, key: policy.key };
}
function resolveAnswerPath(answers, path) {
    if (!path.includes(".")) {
        return answers[path];
    }
    let current = answers;
    for (const segment of path.split(".")) {
        if (!segment) {
            continue;
        }
        if (!current || typeof current !== "object") {
            return undefined;
        }
        current = current[segment];
    }
    return current;
}
function maybeApplyAutoHandling(flowId, step, state, context) {
    const auto = step.onError?.auto;
    if (!auto) {
        return undefined;
    }
    const limit = auto.limit ?? 1;
    const key = `${flowId}:${step.id}`;
    const attemptsSoFar = state.autoActionCounts[key] ?? 0;
    if (attemptsSoFar >= limit) {
        return undefined;
    }
    const attempt = attemptsSoFar + 1;
    state.autoActionCounts[key] = attempt;
    const attemptSuffix = limit > 1 ? ` (${attempt}/${limit})` : "";
    switch (auto.strategy) {
        case "retry": {
            recordRetry(state, flowId, step);
            logAutoAction(context, step, `retrying${attemptSuffix}`);
            return { next: "repeat", status: "warning" };
        }
        case "default": {
            const target = step.onError?.defaultNext?.next ?? "exit";
            const actionLabel = findActionLabel(step.onError?.actions, target);
            if (target !== "exit") {
                recordSkip(state, flowId, step, {
                    target,
                    actionLabel,
                    reason: "default",
                });
            }
            const description = target === "exit"
                ? `exiting via default${attemptSuffix}`
                : `using default path -> ${target}${attemptSuffix}`;
            logAutoAction(context, step, description);
            return {
                next: target,
                status: target === "exit" ? "error" : "warning",
            };
        }
        case "transition": {
            const target = auto.target ?? "exit";
            if (target === "repeat") {
                recordRetry(state, flowId, step);
                logAutoAction(context, step, `retrying${attemptSuffix}`);
                return { next: "repeat", status: "warning" };
            }
            if (target === "exit") {
                logAutoAction(context, step, `exiting via transition${attemptSuffix}`);
                return { next: "exit", status: "error" };
            }
            const actionLabel = findActionLabel(step.onError?.actions, target);
            recordSkip(state, flowId, step, {
                target,
                actionLabel,
                reason: "action",
            });
            const description = actionLabel
                ? `selecting action "${actionLabel}"${attemptSuffix}`
                : `selecting transition -> ${target}${attemptSuffix}`;
            logAutoAction(context, step, description);
            return {
                next: target,
                status: "warning",
            };
        }
        case "exit": {
            logAutoAction(context, step, `exiting wizard${attemptSuffix}`);
            return { next: "exit", status: "error" };
        }
        default:
            return undefined;
    }
}
function buildRecommendationMessage(onError) {
    if (!onError) {
        return undefined;
    }
    const lines = [];
    if (onError.recommendation && onError.recommendation.trim().length > 0) {
        lines.push(onError.recommendation.trim());
    }
    const commands = (onError.commands ?? []).map((entry) => {
        const label = entry.label ?? entry.command;
        return entry.label ? `${label}: ${entry.command}` : entry.command;
    });
    appendRecommendationSection(lines, "Commands", commands);
    const links = (onError.links ?? []).map((entry) => {
        const label = entry.label ?? entry.url;
        return entry.label ? `${label}: ${entry.url}` : entry.url;
    });
    appendRecommendationSection(lines, "Links", links);
    return lines.length > 0 ? lines.join("\n") : undefined;
}
function appendRecommendationSection(lines, heading, entries) {
    if (entries.length === 0) {
        return;
    }
    if (lines.length > 0) {
        lines.push("");
    }
    lines.push(`${heading}:`);
    for (const entry of entries) {
        lines.push(`- ${entry}`);
    }
}
function findActionLabel(actions, target) {
    if (!actions || !target) {
        return undefined;
    }
    return actions.find((action) => action.next === target)?.label;
}
function logAutoAction(context, step, description) {
    if (context.quiet) {
        return;
    }
    const stepLabel = step.label ?? step.id;
    logInfo(context, chalk.yellow(`[auto] ${description} for ${chalk.cyan(stepLabel)}`));
}
function buildTemplateContext(context, state, step) {
    const identity = state.identity;
    const identityById = identity
        ? identity.segments.reduce((acc, segment) => {
            acc[segment.id] = segment;
            return acc;
        }, {})
        : undefined;
    return {
        state: {
            answers: state.answers,
            scenario: state.scenario,
            lastCommand: state.lastCommand,
            repoRoot: context.repoRoot,
            identity,
            identityById,
            answersFileName: context.answersFileName,
            answersFileBase: context.answersFileBase,
        },
        step: step,
        env: process.env,
        repoRoot: context.repoRoot,
        iteration: state.iteration,
    };
}
function chainLogWriters(writers) {
    const filtered = writers.filter(Boolean);
    if (filtered.length === 0) {
        return undefined;
    }
    if (filtered.length === 1) {
        return filtered[0];
    }
    return {
        write(event) {
            for (const writer of filtered) {
                writer.write(event);
            }
        },
        async close() {
            let firstError;
            for (const writer of filtered) {
                try {
                    await writer.close();
                }
                catch (error) {
                    if (!firstError) {
                        firstError = error;
                    }
                }
            }
            if (firstError) {
                throw firstError;
            }
        },
    };
}
function recordPolicyDecision(state, event) {
    state.policyDecisions.push({
        ruleId: event.ruleId,
        ruleLevel: event.ruleLevel,
        enforcedLevel: event.enforcedLevel,
        acknowledged: event.acknowledged,
        flowId: event.flowId,
        stepId: event.stepId,
        command: event.command,
        note: event.note,
    });
}
function emitLog(context, event) {
    context.logWriter?.write(event);
}
function showProgress(context, flow, step, index, total) {
    const modeLabel = context.dryRun ? "dry-run" : "live";
    const breadcrumb = `${flow.id} > ${step.id}`;
    if (!context.quiet) {
        logInfo(context, `[${index + 1}/${total}] ${breadcrumb} (${modeLabel})`);
    }
    return breadcrumb;
}
function reportStepCompletion(context, breadcrumb, status, nextTarget, dryRun, quiet, durationMs) {
    const modeLabel = dryRun ? "dry-run" : "live";
    const suffix = nextTarget && nextTarget !== "exit" && nextTarget !== "repeat"
        ? ` → ${nextTarget}`
        : nextTarget === "repeat"
            ? " (retrying)"
            : "";
    const durationLabel = context.verbose && !Number.isNaN(durationMs)
        ? ` (${formatDurationForLog(durationMs)})`
        : "";
    const message = `${breadcrumb}${suffix} [${modeLabel}]${durationLabel}`;
    switch (status) {
        case "warning":
            logWarn(context, message);
            break;
        case "error":
            logError(context, message);
            break;
        default:
            if (!quiet) {
                logSuccess(context, message);
            }
            break;
    }
}
function recordIntegrationTiming(record, state) {
    if (!record.stdout) {
        return;
    }
    const metadata = extractIntegrationTimingMetadata(record.stdout);
    if (!metadata) {
        return;
    }
    const workflow = extractWorkflowMetadata(record.stepMetadata);
    state.integrationTimings.push({
        flowId: record.flowId,
        stepId: record.stepId,
        workflowId: workflow?.id,
        workflowLabel: workflow?.label,
        command: record.rendered,
        metadata,
    });
}
function formatDurationForLog(durationMs) {
    if (durationMs < 1000) {
        return `${durationMs}ms`;
    }
    const seconds = durationMs / 1000;
    if (seconds < 60) {
        return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
    }
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    if (minutes < 60) {
        return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
    }
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}
function buildScenarioFlowSequence(scenario, phase) {
    if (phase === "collect") {
        return [scenario.flow];
    }
    const sequence = [scenario.flow];
    if (Array.isArray(scenario.flows)) {
        sequence.push(...scenario.flows);
    }
    return sequence;
}
function getScenarioDuration(state) {
    const end = state.endedAt ?? new Date();
    return Math.max(0, end.getTime() - state.startedAt.getTime());
}
function createInitialState(scenario) {
    return {
        scenario,
        answers: {},
        history: [],
        lastCommand: undefined,
        completedSteps: 0,
        failedSteps: 0,
        integrationTimings: [],
        flowRuns: [],
        startedAt: new Date(),
        endedAt: undefined,
        exitedEarly: false,
        retries: [],
        skippedSteps: [],
        policyDecisions: [],
        autoActionCounts: {},
        iteration: undefined,
        flowCursor: 0,
        stepCursor: 0,
        phase: "scenario",
        postRunCursor: 0,
    };
}
function prepareResumeState(state, scenario) {
    state.scenario = scenario;
    state.autoActionCounts = state.autoActionCounts ?? {};
    state.answers = state.answers ?? {};
    state.history = state.history ?? [];
    state.retries = state.retries ?? [];
    state.skippedSteps = state.skippedSteps ?? [];
    state.policyDecisions = state.policyDecisions ?? [];
    state.integrationTimings = state.integrationTimings ?? [];
    state.flowRuns = state.flowRuns ?? [];
    state.phase = state.phase ?? "scenario";
    state.postRunCursor = state.postRunCursor ?? 0;
    state.flowCursor = clampIndex(state.flowCursor ?? 0, buildScenarioFlowSequence(scenario).length);
    state.stepCursor = Math.max(0, state.stepCursor ?? 0);
    state.exitedEarly = false;
    state.endedAt = undefined;
    return state;
}
function clampIndex(value, length) {
    if (!Number.isFinite(value) || value < 0) {
        return 0;
    }
    if (value >= length) {
        return length;
    }
    return Math.floor(value);
}
function getOverride(context, key, stepId) {
    if (Object.prototype.hasOwnProperty.call(context.overrides, key)) {
        return context.overrides[key];
    }
    if (stepId !== key && Object.prototype.hasOwnProperty.call(context.overrides, stepId)) {
        return context.overrides[stepId];
    }
    return undefined;
}
function removeOverride(context, key, stepId) {
    delete context.overrides[key];
    if (stepId !== key) {
        delete context.overrides[stepId];
    }
}
function formatOverrideDisplay(value, mode) {
    if (Array.isArray(value)) {
        return value.join(", ");
    }
    if (typeof value === "boolean") {
        return value ? "true" : "false";
    }
    return String(value);
}
//# sourceMappingURL=executor.js.map