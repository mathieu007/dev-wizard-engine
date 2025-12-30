import type { DevWizardConfig } from "../loader/types";
export declare function createConfigJsonSchema(): Record<string, unknown>;
export declare function createPromptOverrideSchema(config: DevWizardConfig): Record<string, unknown>;
export interface PromptOverrideScaffoldOptions {
    schemaRef?: string;
}
export declare function createPromptOverrideScaffold(config: DevWizardConfig, options?: PromptOverrideScaffoldOptions): Record<string, unknown>;
