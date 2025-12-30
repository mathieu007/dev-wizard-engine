import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { isDeepStrictEqual } from "node:util";
import { parseConfig } from "./parser.js";
import { INDEX_FILENAMES, ROOT_CONFIG_CANDIDATES } from "./configResolver.js";
const SUPPORTED_CONFIG_SCHEMA_VERSION = 1;
const CONFIG_REQUIRE = createRequire(import.meta.url);
const COMMAND_PRESET_SOURCES = new WeakMap();
const LEGACY_LIBRARY_WRAPPER_PATTERN = /packages[\/\\-]dev-wizard-core[\/\\]examples[\/\\]library[\/\\].+\.wizard\.ya?ml$/u;
export async function loadConfig(options) {
    const paths = Array.isArray(options.configPaths)
        ? options.configPaths
        : [options.configPaths];
    if (paths.length === 0) {
        throw new Error("Expected at least one Dev Wizard config path.");
    }
    const cwd = options.cwd ? path.resolve(options.cwd) : process.cwd();
    const cache = new Map();
    let aggregated;
    for (const configPath of paths) {
        const resolved = path.resolve(cwd, configPath);
        const loaded = await loadConfigRecursive({
            absolutePath: resolved,
            cwd,
            cache,
            loadingStack: new Set(),
            onWarning: options.onWarning,
        });
        aggregated = aggregated
            ? mergeConfigs(aggregated, loaded.config, loaded.path, options.onWarning)
            : cloneConfig(loaded.config);
    }
    if (!aggregated) {
        throw new Error("Unable to load any Dev Wizard configuration files.");
    }
    return aggregated;
}
async function loadConfigRecursive({ absolutePath, cwd, cache, loadingStack, onWarning, }) {
    if (cache.has(absolutePath)) {
        return { config: cache.get(absolutePath), path: absolutePath };
    }
    if (loadingStack.has(absolutePath)) {
        throw new Error(`Circular config import detected: ${Array.from(loadingStack).join(" -> ")} -> ${absolutePath}`);
    }
    loadingStack.add(absolutePath);
    let source;
    try {
        source = await fs.readFile(absolutePath, "utf8");
    }
    catch (error) {
        throw new Error(`Failed to read Dev Wizard config at ${absolutePath}: ${String(error)}`);
    }
    if (absolutePath.endsWith("shared-maintenance.flows.yaml")) {
        onWarning?.(`"${absolutePath}" is deprecated and no longer shipped here. Import '@dev-wizard/presets/maintenance' directly instead of referencing the legacy shared-maintenance file.`);
    }
    if (LEGACY_LIBRARY_WRAPPER_PATTERN.test(absolutePath)) {
        onWarning?.(`"${absolutePath}" is a legacy sample wrapper config. Prefer importing the matching @dev-wizard/presets/* config directly.`);
    }
    if (source.includes("examples/library/scripts/")) {
        onWarning?.(`"${absolutePath}" references scripts under packages/dev-wizard-core/examples/library/scripts, which are no longer shipped here. Update commands to use '@dev-wizard/presets/scripts/*'.`);
    }
    const parsed = parseConfig(source, absolutePath);
    initializeCommandPresetSources(parsed, absolutePath);
    if (parsed.plugins?.length) {
        try {
            parsed.plugins = parsed.plugins.map((plugin) => ({
                ...plugin,
                resolvedPath: resolvePluginModule({
                    specifier: plugin.module,
                    fromPath: absolutePath,
                    cwd,
                }),
                source: absolutePath,
            }));
        }
        catch (error) {
            throw new Error(`Failed to resolve plugin module declared in ${absolutePath}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    let aggregated = cloneConfig(parsed);
    validateSchemaVersion(parsed.meta?.schemaVersion, absolutePath, onWarning);
    if (parsed.imports?.length) {
        for (const importRef of parsed.imports) {
            const importPath = await resolveConfigImport({
                specifier: importRef,
                fromPath: absolutePath,
                cwd,
            });
            const imported = await loadConfigRecursive({
                absolutePath: importPath,
                cwd,
                cache,
                loadingStack,
                onWarning,
            });
            aggregated = mergeConfigs(aggregated, imported.config, importPath, onWarning);
        }
    }
    cache.set(absolutePath, aggregated);
    loadingStack.delete(absolutePath);
    return { config: aggregated, path: absolutePath };
}
function mergeConfigs(target, addition, additionPath, onWarning) {
    const result = cloneConfig(target);
    for (const scenario of addition.scenarios) {
        if (result.scenarios.some((existing) => existing.id === scenario.id)) {
            throw new Error(`Duplicate scenario id "${scenario.id}" while merging ${additionPath}`);
        }
        result.scenarios.push(scenario);
    }
    for (const [flowId, flow] of Object.entries(addition.flows)) {
        if (result.flows[flowId]) {
            throw new Error(`Duplicate flow id "${flowId}" encountered while merging ${additionPath}`);
        }
        result.flows[flowId] = flow;
    }
    if (addition.commandPresets) {
        result.commandPresets ??= {};
        const resultSources = ensureCommandPresetSourceMap(result);
        const additionSources = COMMAND_PRESET_SOURCES.get(addition) ?? new Map();
        for (const [presetName, presetValue] of Object.entries(addition.commandPresets)) {
            const existing = result.commandPresets[presetName];
            const existingSources = resultSources.get(presetName);
            if (existing) {
                if (!isDeepStrictEqual(existing, presetValue)) {
                    throw new Error(`Duplicate command preset "${presetName}" with conflicting definitions while merging ${additionPath}`);
                }
                onWarning?.(`Command preset "${presetName}" defined in ${additionPath} duplicates existing definition from ${existingSources ? Array.from(existingSources).join(", ") : "a previous config"}; using the first definition.`);
            }
            result.commandPresets[presetName] = existing ?? presetValue;
            const sources = additionSources.get(presetName) ?? new Set([additionPath]);
            const targetSources = resultSources.get(presetName) ?? new Set();
            for (const source of sources) {
                targetSources.add(source);
            }
            resultSources.set(presetName, targetSources);
        }
    }
    if (addition.plugins?.length) {
        result.plugins ??= [];
        const registeredPlugins = new Map();
        for (const existing of result.plugins) {
            const key = getPluginRegistryKey(existing);
            if (!registeredPlugins.has(key)) {
                registeredPlugins.set(key, { source: existing.source });
            }
        }
        for (const plugin of addition.plugins) {
            const key = getPluginRegistryKey(plugin);
            if (registeredPlugins.has(key)) {
                const previousSource = registeredPlugins.get(key)?.source;
                onWarning?.(`Plugin "${plugin.module}" from ${additionPath} duplicates an earlier registration${previousSource ? ` defined in ${previousSource}` : ""}; using the first definition.`);
                continue;
            }
            result.plugins.push(plugin);
            registeredPlugins.set(key, { source: plugin.source ?? additionPath });
        }
    }
    return result;
}
function cloneConfig(config) {
    const cloned = structuredClone(config);
    copyCommandPresetSources(config, cloned);
    return cloned;
}
function validateSchemaVersion(schemaVersion, filePath, onWarning) {
    if (schemaVersion === undefined) {
        return;
    }
    if (schemaVersion !== SUPPORTED_CONFIG_SCHEMA_VERSION) {
        onWarning?.(`Config ${filePath} declares schemaVersion ${schemaVersion}, but the current runtime supports ${SUPPORTED_CONFIG_SCHEMA_VERSION}. Behaviour may be undefined.`);
    }
}
async function resolveConfigImport({ specifier, fromPath, cwd, }) {
    const fromDir = path.dirname(fromPath);
    if (isFileLikeSpecifier(specifier)) {
        const candidate = path.resolve(fromDir, specifier);
        return candidate;
    }
    // Attempt to resolve as file within package (e.g., package/path/config.yaml)
    try {
        const resolved = CONFIG_REQUIRE.resolve(specifier, { paths: [fromDir, cwd] });
        if (await fileHasSupportedExtension(resolved)) {
            return resolved;
        }
        const configFromPackage = await locatePackageConfig(path.dirname(resolved));
        if (configFromPackage) {
            return configFromPackage;
        }
    }
    catch {
        // ignore and continue to package root lookup
    }
    // Resolve package root (specifier may be package name)
    try {
        const packageJsonPath = CONFIG_REQUIRE.resolve(path.join(specifier, "package.json"), { paths: [fromDir, cwd] });
        const packageRoot = path.dirname(packageJsonPath);
        const configPath = await locatePackageConfig(packageRoot);
        if (configPath) {
            return configPath;
        }
    }
    catch (error) {
        throw new Error(`Unable to resolve config import "${specifier}" from ${fromPath}: ${error instanceof Error ? error.message : String(error)}`);
    }
    throw new Error(`Unable to resolve config import "${specifier}" from ${fromPath}: no supported config files found`);
}
function isFileLikeSpecifier(specifier) {
    return specifier.startsWith("./") || specifier.startsWith("../") || specifier.startsWith("/") || /^[A-Za-z]:[\\/]/.test(specifier);
}
async function locatePackageConfig(pkgRoot) {
    for (const candidate of ROOT_CONFIG_CANDIDATES) {
        const filePath = path.join(pkgRoot, candidate);
        if (await pathExists(filePath)) {
            return filePath;
        }
    }
    const configDir = path.join(pkgRoot, "dev-wizard-config");
    if (!(await pathExists(configDir))) {
        return undefined;
    }
    for (const candidate of INDEX_FILENAMES) {
        const filePath = path.join(configDir, candidate);
        if (await pathExists(filePath)) {
            return filePath;
        }
    }
    return undefined;
}
function resolvePluginModule({ specifier, fromPath, cwd, }) {
    const fromDir = path.dirname(fromPath);
    if (isFileLikeSpecifier(specifier)) {
        return path.resolve(fromDir, specifier);
    }
    try {
        return CONFIG_REQUIRE.resolve(specifier, { paths: [fromDir, cwd] });
    }
    catch (error) {
        throw new Error(`Unable to resolve plugin module "${specifier}" from ${fromPath}: ${error instanceof Error ? error.message : String(error)}`);
    }
}
async function pathExists(filePath) {
    try {
        await fs.access(filePath);
        return true;
    }
    catch {
        return false;
    }
}
async function fileHasSupportedExtension(filePath) {
    const extension = path.extname(filePath).toLowerCase();
    return [".yaml", ".yml", ".json", ".json5"].includes(extension);
}
function initializeCommandPresetSources(config, sourcePath) {
    if (!config.commandPresets) {
        return;
    }
    const map = new Map();
    for (const presetName of Object.keys(config.commandPresets)) {
        map.set(presetName, new Set([sourcePath]));
    }
    COMMAND_PRESET_SOURCES.set(config, map);
}
function ensureCommandPresetSourceMap(config) {
    let sources = COMMAND_PRESET_SOURCES.get(config);
    if (!sources) {
        sources = new Map();
        COMMAND_PRESET_SOURCES.set(config, sources);
    }
    return sources;
}
function copyCommandPresetSources(from, to) {
    const original = COMMAND_PRESET_SOURCES.get(from);
    if (!original) {
        return;
    }
    const clone = new Map();
    for (const [name, paths] of original.entries()) {
        clone.set(name, new Set(paths));
    }
    COMMAND_PRESET_SOURCES.set(to, clone);
}
function getPluginRegistryKey(plugin) {
    return plugin.resolvedPath ?? plugin.module;
}
export function getCommandPresetSources(config) {
    const sources = COMMAND_PRESET_SOURCES.get(config);
    if (!sources) {
        return new Map();
    }
    const copy = new Map();
    for (const [name, paths] of sources.entries()) {
        copy.set(name, new Set(paths));
    }
    return copy;
}
//# sourceMappingURL=configLoader.js.map