import type { CommandPreset, DevWizardConfig } from "../loader/types";
export interface ResolvedCommandPreset {
    name: string;
    definition: Readonly<CommandPreset>;
    sources: string[];
}
export declare function getResolvedCommandPreset(config: DevWizardConfig, presetName: string): ResolvedCommandPreset | undefined;
export declare function listResolvedCommandPresets(config: DevWizardConfig): ResolvedCommandPreset[];
