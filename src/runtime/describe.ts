import path from "node:path";
import { loadConfig } from "../loader/configLoader.js";
import { resolveConfigPaths } from "../loader/configResolver.js";
import type {
	ConfigResolution,
	ConfigResolutionEntry,
} from "../loader/configResolver";
import type {
	DevWizardConfig,
	DevWizardFlow,
	DevWizardScenario,
	DevWizardStep,
	CommandPreset,
	CommandStep,
} from "../loader/types";
import { listResolvedCommandPresets } from "./commandPresets.js";

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

export async function describeWizard(
	options: DescribeWizardOptions = {},
): Promise<DevWizardDescription> {
	const cwd = options.cwd ? path.resolve(options.cwd) : process.cwd();

	const resolution = await resolveConfigPaths({
		cwd,
		explicitPaths: options.configPath,
		environment: options.environment,
	});

	if (resolution.errors.length > 0 || resolution.paths.length === 0) {
		return {
			resolution,
			cwd,
		};
	}

	const config = await loadConfig({
		configPaths: resolution.paths,
		cwd,
	});

	return {
		resolution,
		meta: config.meta,
		scenarios: describeScenarios(config.scenarios),
		flows: describeFlows(config.flows),
		commandPresets: describeCommandPresets(config),
		cwd,
	};
}

function describeScenarios(
	scenarios: DevWizardScenario[],
): ScenarioDescription[] {
	return scenarios.map((scenario) => ({
		id: scenario.id,
		label: scenario.label,
		description: scenario.description,
		flow: scenario.flow,
		flows: scenario.flows,
		tags: scenario.tags,
		shortcuts: scenario.shortcuts,
	}));
}

function describeFlows(
	flows: DevWizardConfig["flows"],
): Record<string, FlowDescription> {
	const result: Record<string, FlowDescription> = {};

	for (const [flowId, flow] of Object.entries(flows)) {
		result[flowId] = {
			id: flow.id,
			label: flow.label,
			description: flow.description,
			stepCount: flow.steps.length,
			steps: flow.steps.map((step) => ({
				id: step.id,
				type: step.type,
				label: step.label,
				description: step.description,
			})),
		};
	}

	return result;
}

function describeCommandPresets(
	config: DevWizardConfig,
): CommandPresetDescription[] {
	const resolved = listResolvedCommandPresets(config);
	if (resolved.length === 0) {
		return [];
	}
	const usageMap = collectPresetUsage(config);

	return resolved.map((preset) => {
		const usage = usageMap.get(preset.name) ?? [];
		return {
			name: preset.name,
			definition: preset.definition,
			sources: preset.sources,
			usageCount: usage.length,
			usedBy: usage,
		};
	});
}

function collectPresetUsage(
	config: DevWizardConfig,
): Map<string, CommandPresetUsage[]> {
	const usage = new Map<string, CommandPresetUsage[]>();

	for (const [flowId, flow] of Object.entries(config.flows)) {
		for (const step of flow.steps) {
			if (!isCommandStep(step)) {
				continue;
			}
			const stepPreset = step.defaults?.preset;
			step.commands.forEach((command, index) => {
				const presetName = command.preset ?? stepPreset;
				if (!presetName) {
					return;
				}
				const entry = usage.get(presetName) ?? [];
				entry.push({
					flowId,
					stepId: step.id,
					commandIndex: index,
				});
				usage.set(presetName, entry);
			});
		}
	}

	return usage;
}

function isCommandStep(step: DevWizardStep): step is CommandStep {
	return step.type === "command" && Array.isArray((step as CommandStep).commands);
}

export function formatPrettyDescription(
	description: DevWizardDescription,
): string {
	const lines: string[] = [];
	const { resolution } = description;

	addDiagnostics(lines, resolution);
	addSelectedConfigs(lines, resolution.entries, description.cwd);

	if (resolution.errors.length > 0) {
		lines.push("");
		lines.push("Errors:");
		for (const error of resolution.errors) {
			lines.push(`- ${error}`);
		}
	}

	if (resolution.errors.length === 0 && resolution.paths.length > 0) {
		if (description.meta) {
			lines.push("");
			const versionLabel = description.meta.version ? ` v${description.meta.version}` : "";
			lines.push(
				`Meta: ${description.meta.name}${versionLabel}${
					description.meta.description ? ` — ${description.meta.description}` : ""
				}`,
			);
		}

		if (description.scenarios && description.scenarios.length > 0) {
			lines.push("");
			lines.push("Scenarios:");
			for (const scenario of description.scenarios) {
				const tagsLabel =
					scenario.tags && scenario.tags.length > 0
						? ` [tags: ${scenario.tags.join(", ")}]`
						: "";
				lines.push(
					`- ${scenario.label} (${scenario.id}) → ${scenario.flow}${tagsLabel}`,
				);
				if (scenario.description) {
					lines.push(`    ${scenario.description}`);
				}
				if (scenario.flows && scenario.flows.length > 0) {
					lines.push(
						`    chained flows: ${scenario.flows.join(", ")}`,
					);
				}
			}
		}

		if (description.flows && Object.keys(description.flows).length > 0) {
			lines.push("");
			lines.push("Flows:");
			for (const flow of Object.values(description.flows)) {
				lines.push(
					`- ${flow.id} (${flow.stepCount} step${flow.stepCount === 1 ? "" : "s"})`,
				);
				if (flow.label || flow.description) {
					lines.push(
						`    ${flow.label ?? ""}${
							flow.description ? ` — ${flow.description}` : ""
						}`.trim(),
					);
				}
			}
		}
	}

	return lines.join("\n");
}

function addDiagnostics(
	lines: string[],
	resolution: ConfigResolution,
) {
	if (resolution.diagnostics.length === 0) {
		lines.push("Discovery diagnostics: (none)");
		return;
	}

	lines.push("Discovery diagnostics:");
	for (const diagnostic of resolution.diagnostics) {
		lines.push(`- ${diagnostic}`);
	}
}

function addSelectedConfigs(
	lines: string[],
	entries: ConfigResolutionEntry[],
	cwd: string,
) {
	lines.push("");
	if (entries.length === 0) {
		lines.push("Selected config files: (none)");
		return;
	}

	lines.push("Selected config files:");
	for (const entry of entries) {
		const relative = path.relative(cwd, entry.path);
		lines.push(`- ${relative && !relative.startsWith("..") ? relative : entry.path} [${entry.source}]`);
	}
}
