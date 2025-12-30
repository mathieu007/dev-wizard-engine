import type { CommandPreset, DevWizardConfig } from "../loader/types";
import { getCommandPresetSources } from "../loader/configLoader.js";

export interface ResolvedCommandPreset {
	name: string;
	definition: Readonly<CommandPreset>;
	sources: string[];
}

const PRESET_CACHE = new WeakMap<DevWizardConfig, Map<string, ResolvedCommandPreset>>();

export function getResolvedCommandPreset(
	config: DevWizardConfig,
	presetName: string,
): ResolvedCommandPreset | undefined {
	const cache = buildPresetCache(config);
	return cache.get(presetName);
}

export function listResolvedCommandPresets(
	config: DevWizardConfig,
): ResolvedCommandPreset[] {
	return Array.from(buildPresetCache(config).values());
}

function buildPresetCache(
	config: DevWizardConfig,
): Map<string, ResolvedCommandPreset> {
	let cache = PRESET_CACHE.get(config);
	if (cache) {
		return cache;
	}

	cache = new Map();
	const sourcesMap = getCommandPresetSources(config);
	const presets = config.commandPresets ?? {};

	for (const [name, preset] of Object.entries(presets)) {
		cache.set(name, {
			name,
			definition: freezePreset(preset),
			sources: Array.from(sourcesMap.get(name) ?? []),
		});
	}

	PRESET_CACHE.set(config, cache);
	return cache;
}

function freezePreset(preset: CommandPreset): Readonly<CommandPreset> {
	const frozen: CommandPreset = { ...preset };
	if (preset.env) {
		frozen.env = { ...preset.env };
	}
	if (preset.tags) {
		frozen.tags = [...preset.tags];
	}
	return Object.freeze(frozen);
}
