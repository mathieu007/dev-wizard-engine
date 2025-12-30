import type { ConfigResolution } from "../loader/configResolver.js";
import type { DevWizardConfig } from "../loader/types";
import { type DevWizardDescription, type DescribeWizardOptions } from "../runtime/describe.js";
import { type ScenarioPlan } from "../runtime/executor.js";
import { type LoadPluginsResult } from "../runtime/plugins.js";
export interface LoadWizardOptions extends DescribeWizardOptions {
    environment?: string;
    repoRoot?: string;
}
export interface LoadWizardResult {
    config: DevWizardConfig;
    resolution: ConfigResolution;
    description: DevWizardDescription;
    repoRoot: string;
    pluginWarnings: string[];
    pluginRegistry: LoadPluginsResult["registry"];
}
export interface PlanScenarioOptions extends LoadWizardOptions {
    scenarioId: string;
    dryRun?: boolean;
    overrides?: Record<string, unknown>;
    quiet?: boolean;
    verbose?: boolean;
}
export interface CompilePlanOptions extends LoadWizardOptions {
    scenarioId: string;
    dryRun?: boolean;
    overrides?: Record<string, unknown>;
    quiet?: boolean;
    verbose?: boolean;
}
export interface PlanScenarioResult extends LoadWizardResult {
    plan: ScenarioPlan;
    prettyPlan: string;
    ndjsonPlan: string[];
    jsonPlan: string;
    targetMode: "dry-run" | "live";
}
export interface CompilePlanResult extends LoadWizardResult {
    plan: ScenarioPlan;
    targetMode: "dry-run" | "live";
}
export declare function loadWizard(options?: LoadWizardOptions): Promise<LoadWizardResult>;
export declare function planScenario(options: PlanScenarioOptions): Promise<PlanScenarioResult>;
export declare function compilePlan(options: CompilePlanOptions): Promise<CompilePlanResult>;
