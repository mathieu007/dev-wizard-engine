export interface PromptHistoryManager {
    getAll(key: string): readonly string[];
    record(key: string, value: string): void;
    close(): Promise<void>;
}
export interface PromptHistoryOptions {
    maxEntries?: number;
    storagePath?: string;
}
export declare function createPromptHistoryManager(options?: PromptHistoryOptions): PromptHistoryManager;
