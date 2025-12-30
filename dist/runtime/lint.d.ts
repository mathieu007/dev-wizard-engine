import type { ConfigResolution } from "../loader/configResolver.js";
import type { DevWizardConfig } from "../loader/types";
export interface LintCommandOptions {
    configPath?: string | string[];
    answersPath?: string;
    manifestPath?: string;
    scenarioId?: string;
    cwd?: string;
    environment?: string;
}
export interface LintIssue {
    level: "error" | "warning";
    message: string;
    detail?: string;
    file?: string;
}
export interface LintResult {
    cwd: string;
    resolution: ConfigResolution;
    issues: LintIssue[];
    config?: DevWizardConfig;
}
export declare function lintWizard(options?: LintCommandOptions): Promise<LintResult>;
export declare function formatLintResult(result: LintResult, format: "json" | "pretty"): string;
