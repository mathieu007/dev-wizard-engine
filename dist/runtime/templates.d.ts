export interface TemplateContext {
    state: Record<string, unknown>;
    step?: Record<string, unknown>;
    env: NodeJS.ProcessEnv;
    iteration?: {
        index: number;
        total: number;
        value: unknown;
        key?: string;
    };
    repoRoot: string;
}
export declare function renderTemplate(template: string, context: TemplateContext): string;
export declare function renderMaybeNested(value: unknown, context: TemplateContext): unknown;
