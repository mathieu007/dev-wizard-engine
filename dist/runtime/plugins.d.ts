import type { DevWizardPluginReference, PluginStep, DevWizardStep, StepTransitionTarget } from "../loader/types";
import type { TemplateContext } from "./templates.js";
import type { WizardState } from "./state";
import type { ExecutorContext } from "./executor";
import { type WizardLogAdapter } from "./logAdapter.js";
export interface WizardPluginRegistry {
    getStepHandler(stepType: string): WizardPluginStepRegistration | undefined;
    all(): WizardPluginStepRegistration[];
}
export interface WizardPluginStepRegistration {
    stepType: string;
    pluginName: string;
    reference: DevWizardPluginReference;
    handler: WizardPluginStepHandler;
}
export interface WizardPlugin {
    name?: string;
    stepHandlers: Record<string, WizardPluginStepHandler>;
}
export interface WizardPluginFactoryMetadata {
    module: string;
    resolvedPath?: string;
}
export interface WizardPluginStepHandler {
    plan?: (context: WizardPluginPlanContext) => WizardPluginPlanResult | Promise<WizardPluginPlanResult>;
    run: (context: WizardPluginRunContext) => WizardPluginStepResult | Promise<WizardPluginStepResult>;
}
export interface WizardPluginPlanContext {
    flowId: string;
    step: PluginStep;
    state: WizardState;
    context: ExecutorContext;
    templateContext: TemplateContext;
    helpers: WizardPluginHelpers;
}
export interface WizardPluginRunContext {
    flowId: string;
    step: PluginStep;
    state: WizardState;
    context: ExecutorContext;
    templateContext: TemplateContext;
    helpers: WizardPluginHelpers;
}
export interface WizardPluginHelpers {
    renderTemplate: (template: string) => string;
    renderMaybeNested: (value: unknown) => unknown;
    templateContext: TemplateContext;
    log: WizardLogAdapter;
}
export interface WizardPluginPlanResult {
    plan?: PluginStepPlan;
    next?: StepTransitionTarget;
    events?: WizardPluginPlanEvent[];
}
export interface WizardPluginPlanEvent {
    type: string;
    data?: Record<string, unknown>;
}
export interface WizardPluginStepResult {
    next?: StepTransitionTarget;
    status?: "success" | "warning" | "error";
}
export interface PluginStepPlan {
    kind: "plugin";
    id: string;
    label?: string;
    pluginType: string;
    pluginName: string;
    summary?: string;
    details?: Record<string, unknown>;
}
export interface LoadPluginsOptions {
    repoRoot: string;
}
export interface LoadPluginsResult {
    registry: WizardPluginRegistry;
    warnings: string[];
}
export declare function createEmptyPluginRegistry(): WizardPluginRegistry;
export declare function loadPlugins(references: readonly DevWizardPluginReference[] | undefined, options: LoadPluginsOptions): Promise<LoadPluginsResult>;
export declare function createPluginHelpers(templateContext: TemplateContext): WizardPluginHelpers;
export declare function isPluginStep(step: DevWizardStep): step is PluginStep;
