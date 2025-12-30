import type { TemplateContext } from "./templates.js";
import type { WizardState } from "./state.js";
export interface ComputeHandlerContext {
    repoRoot: string;
    state: WizardState;
    templateContext: TemplateContext;
}
export type ComputeHandler = (params: Record<string, unknown>, context: ComputeHandlerContext) => Promise<unknown> | unknown;
export declare function registerComputeHandler(id: string, handler: ComputeHandler): void;
export declare function getComputeHandler(id: string): ComputeHandler | undefined;
