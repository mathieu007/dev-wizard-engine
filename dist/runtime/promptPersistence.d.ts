import type { PromptPersistenceScope } from "../loader/types";
export interface PromptPersistenceOptions {
    repoRoot: string;
    scenarioId: string;
    filePath?: string;
    metadata?: PromptPersistenceMetadata;
}
export interface PromptPersistenceTarget {
    scope: PromptPersistenceScope;
    key: string;
    projectId?: string;
}
export interface PromptPersistenceMetadata {
    scenarioId?: string;
    identity?: PromptPersistenceIdentityMetadata;
    execution?: PromptPersistenceExecutionMetadata;
}
export interface PromptPersistenceExecutionMetadata {
    sandbox?: boolean;
    sandboxSlug?: string;
}
export interface PromptPersistenceIdentityMetadata {
    slug?: string;
    segments?: PromptPersistenceIdentitySegment[];
}
export interface PromptPersistenceIdentitySegment {
    id: string;
    value: string;
    label?: string;
    details?: Record<string, unknown>;
}
export declare class PromptPersistenceManager {
    private readonly filePath;
    private readonly metadata?;
    private snapshot;
    private loaded;
    private dirty;
    private existedAtLoad;
    constructor(options: PromptPersistenceOptions);
    load(): Promise<void>;
    get(target: PromptPersistenceTarget): unknown;
    set(target: PromptPersistenceTarget, value: unknown): void;
    private updateValue;
    private delete;
    save(): Promise<void>;
    resetAllAnswers(): void;
    setExecutionMetadata(metadata: PromptPersistenceExecutionMetadata): void;
    getFilePath(): string;
    getMetadata(): PromptPersistenceMetadata | undefined;
    didLoadExistingSnapshot(): boolean;
    private applyMetadataOverrides;
}
export declare function createPromptPersistenceManager(options: PromptPersistenceOptions): Promise<PromptPersistenceManager>;
export declare function sanitizePersistenceSegment(segment: string): string;
