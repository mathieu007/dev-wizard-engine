import { getCommandPresetSources } from "../loader/configLoader.js";
const PRESET_CACHE = new WeakMap();
export function getResolvedCommandPreset(config, presetName) {
    const cache = buildPresetCache(config);
    return cache.get(presetName);
}
export function listResolvedCommandPresets(config) {
    return Array.from(buildPresetCache(config).values());
}
function buildPresetCache(config) {
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
function freezePreset(preset) {
    const frozen = { ...preset };
    if (preset.env) {
        frozen.env = { ...preset.env };
    }
    if (preset.tags) {
        frozen.tags = [...preset.tags];
    }
    return Object.freeze(frozen);
}
//# sourceMappingURL=commandPresets.js.map