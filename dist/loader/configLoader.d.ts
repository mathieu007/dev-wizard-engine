import type { DevWizardConfig } from "./types.js";
export interface LoadConfigOptions {
    configPaths: string | string[];
    cwd?: string;
    onWarning?: (message: string) => void;
}
export declare function loadConfig(options: LoadConfigOptions): Promise<DevWizardConfig>;
export declare function getCommandPresetSources(config: DevWizardConfig): Map<string, Set<string>>;
