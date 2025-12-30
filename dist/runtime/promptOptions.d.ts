import type { PromptDynamicOptions, PromptOption } from "../loader/types";
import type { TemplateContext } from "./templates.js";
export interface DynamicOptionsContext {
    repoRoot: string;
    cache: Map<string, PromptOption[]>;
}
export declare function resolveDynamicPromptOptions(dynamicConfig: PromptDynamicOptions | undefined, templateContext: TemplateContext, context: DynamicOptionsContext): Promise<PromptOption[] | undefined>;
