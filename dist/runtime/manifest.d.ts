import type { ScenarioPlan } from "./executor.js";
export interface DevWizardManifest {
    schemaVersion: 1;
    scenarioId: string;
    scenarioLabel?: string;
    scenarioDescription?: string;
    createdAt: string;
    repoRoot: string;
    configPaths: string[];
    configHash: string;
    cliVersion?: string;
    coreVersion?: string;
    environment?: string;
    plan: ScenarioPlan;
    answers: Record<string, unknown>;
    registerArgs?: readonly string[];
}
export interface LoadedManifest extends DevWizardManifest {
    filePath: string;
}
export declare function writeManifest(filePath: string, manifest: DevWizardManifest): Promise<void>;
export declare function readManifest(filePath: string): Promise<LoadedManifest>;
