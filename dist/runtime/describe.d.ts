import type { ConfigResolution } from "../loader/configResolver";
import type { DevWizardConfig, DevWizardStep, CommandPreset } from "../loader/types";
export interface DescribeWizardOptions {
    configPath?: string | string[];
    cwd?: string;
    environment?: string;
}
export interface ScenarioDescription {
    id: string;
    label: string;
    description?: string;
    flow: string;
    flows?: string[];
    tags?: string[];
    shortcuts?: Record<string, string>;
}
export interface FlowDescription {
    id: string;
    label?: string;
    description?: string;
    stepCount: number;
    steps: Array<{
        id: string;
        type: DevWizardStep["type"];
        label?: string;
        description?: string;
    }>;
}
export interface DevWizardDescription {
    resolution: ConfigResolution;
    meta?: DevWizardConfig["meta"];
    scenarios?: ScenarioDescription[];
    flows?: Record<string, FlowDescription>;
    commandPresets?: CommandPresetDescription[];
    cwd: string;
}
export interface CommandPresetUsage {
    flowId: string;
    stepId: string;
    commandIndex: number;
}
export interface CommandPresetDescription {
    name: string;
    definition: Readonly<CommandPreset>;
    sources: string[];
    usageCount: number;
    usedBy: CommandPresetUsage[];
}
export declare function describeWizard(options?: DescribeWizardOptions): Promise<DevWizardDescription>;
export declare function formatPrettyDescription(description: DevWizardDescription): string;
