import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { execaCommand } from "execa";
import fg from "fast-glob";
import { renderMaybeNested } from "./templates.js";
import { listWorkspaceProjects } from "./workspaceProjects.js";
const persistentCache = new Map();
export async function resolveDynamicPromptOptions(dynamicConfig, templateContext, context) {
    if (!dynamicConfig) {
        return undefined;
    }
    const renderedConfig = renderMaybeNested(dynamicConfig, templateContext);
    const cacheKey = buildCacheKey(renderedConfig, context.repoRoot);
    const cached = getCachedOptions(renderedConfig.cache, cacheKey, context);
    if (cached) {
        return cached;
    }
    const options = await loadOptions(renderedConfig, templateContext, context);
    storeOptions(renderedConfig.cache, cacheKey, options, context);
    return options;
}
async function loadOptions(config, templateContext, context) {
    switch (config.type) {
        case "command":
            return loadOptionsFromCommand(config, context);
        case "glob":
            return loadOptionsFromGlob(config, context);
        case "json":
            return loadOptionsFromJson(config, context);
        case "workspace-projects":
            return loadOptionsFromWorkspaceProjects(config, context);
        case "project-tsconfigs":
            return loadOptionsFromProjectTsconfigs(config, context);
        default:
            return [];
    }
}
async function loadOptionsFromCommand(config, context) {
    const subprocess = await execaCommand(config.command, {
        cwd: config.cwd ? path.resolve(context.repoRoot, config.cwd) : context.repoRoot,
        env: process.env,
        shell: config.shell ?? true,
    });
    const parsed = parseJsonSafe(subprocess.stdout, "command");
    return normalizeToPromptOptions(parsed, config.map);
}
async function loadOptionsFromGlob(config, context) {
    const cwd = config.cwd
        ? path.resolve(context.repoRoot, config.cwd)
        : context.repoRoot;
    const matches = await fg(Array.isArray(config.patterns) ? config.patterns : [config.patterns], {
        cwd,
        ignore: config.ignore
            ? Array.isArray(config.ignore)
                ? config.ignore
                : [config.ignore]
            : undefined,
        onlyFiles: false,
        dot: true,
        unique: true,
    });
    const options = matches.map((match) => {
        const absolutePath = path.resolve(cwd, match);
        const relativePath = path.relative(context.repoRoot, absolutePath);
        return {
            value: absolutePath,
            label: relativePath || ".",
        };
    });
    return applyDynamicMap(options, config.map);
}
async function loadOptionsFromJson(config, context) {
    const filePath = path.resolve(context.repoRoot, config.path);
    const fileContents = await readFile(filePath, "utf8");
    const parsed = parseJsonSafe(fileContents, "json");
    const target = resolvePointer(parsed, config.pointer);
    return normalizeToPromptOptions(target, config.map);
}
async function loadOptionsFromWorkspaceProjects(config, context) {
    const projects = await listWorkspaceProjects({
        repoRoot: context.repoRoot,
        includeRoot: config.includeRoot,
        maxDepth: config.maxDepth,
        ignore: config.ignore,
        limit: config.limit,
    });
    const options = projects.map((project) => ({
        value: project.id,
        label: project.label,
    }));
    return applyDynamicMap(options, config.map);
}
async function loadOptionsFromProjectTsconfigs(config, context) {
    const projectDir = path.isAbsolute(config.project)
        ? path.resolve(config.project)
        : path.resolve(context.repoRoot, config.project);
    const stats = await stat(projectDir).catch(() => {
        throw new Error(`Project directory ${config.project} was not found under ${context.repoRoot}.`);
    });
    if (!stats.isDirectory()) {
        throw new Error(`Project path ${projectDir} is not a directory. Provide a folder that contains tsconfig files.`);
    }
    const entries = await readdir(projectDir, { withFileTypes: true });
    const matches = entries
        .filter((entry) => entry.isFile() &&
        entry.name.toLowerCase().startsWith("tsconfig") &&
        entry.name.toLowerCase().endsWith(".json"))
        .map((entry) => entry.name)
        .sort((a, b) => a.localeCompare(b));
    if (!matches.includes("tsconfig.json")) {
        matches.push("tsconfig.json");
    }
    const relativeProjectPath = path.relative(context.repoRoot, projectDir) || ".";
    const options = matches.map((filename) => ({
        value: filename,
        label: filename,
        hint: path.posix.join(relativeProjectPath.replace(/\\/g, "/"), filename),
    }));
    if (config.includeCustom ?? true) {
        options.push({
            value: "__custom__",
            label: "Custom path…",
            hint: "Enter a relative path within the project",
        });
    }
    return applyDynamicMap(options, config.map);
}
function normalizeToPromptOptions(value, map) {
    if (Array.isArray(value)) {
        return applyDynamicMap(value.map((item) => {
            if (typeof item === "string" || typeof item === "number") {
                return {
                    value: String(item),
                    label: String(item),
                };
            }
            if (item && typeof item === "object") {
                return normalizeObjectOption(item, map);
            }
            return {
                value: JSON.stringify(item),
                label: JSON.stringify(item),
            };
        }), map);
    }
    if (value && typeof value === "object") {
        const entries = Object.entries(value).map(([key, val]) => {
            if (typeof val === "string" || typeof val === "number") {
                return {
                    value: key,
                    label: String(val),
                };
            }
            if (val && typeof val === "object") {
                return normalizeObjectOption({ value: key, ...val }, map);
            }
            return {
                value: key,
                label: key,
            };
        });
        return applyDynamicMap(entries, map);
    }
    if (typeof value === "string" || typeof value === "number") {
        return [
            {
                value: String(value),
                label: String(value),
            },
        ];
    }
    return [];
}
function normalizeObjectOption(item, map) {
    const source = {
        ...('value' in item ? { value: item.value } : {}),
        ...('label' in item ? { label: item.label } : {}),
        ...('hint' in item ? { hint: item.hint } : {}),
        ...('disabled' in item ? { disabled: item.disabled } : {}),
        ...item,
    };
    const valuePath = map?.value ?? "value";
    const labelPath = map?.label ?? "label";
    const hintPath = map?.hint;
    const disablePath = map?.disableWhen;
    const value = getPath(source, valuePath) ?? source.value ?? source.id;
    const label = getPath(source, labelPath) ??
        source.label ??
        source.name ??
        source.value ??
        source.id;
    const hint = hintPath ? getPath(source, hintPath) : source.hint;
    const disabled = disablePath ? Boolean(getPath(source, disablePath)) : Boolean(source.disabled);
    return {
        value: String(value ?? label ?? ""),
        label: String(label ?? value ?? ""),
        hint: hint === undefined ? undefined : String(hint),
        disabled,
    };
}
function applyDynamicMap(options, map) {
    if (!map) {
        return options;
    }
    return options.map((option) => normalizeObjectOption(option, map));
}
function getPath(value, pointer) {
    if (!pointer) {
        return undefined;
    }
    if (pointer.startsWith("/")) {
        return resolvePointer(value, pointer);
    }
    const segments = pointer.split(".").filter(Boolean);
    let current = value;
    for (const segment of segments) {
        if (!current || typeof current !== "object") {
            return undefined;
        }
        current = current[segment];
    }
    return current;
}
function resolvePointer(value, pointer) {
    if (!pointer || pointer === "/") {
        return value;
    }
    const segments = pointer
        .split("/")
        .slice(pointer.startsWith("/") ? 1 : 0)
        .map((segment) => segment.replace(/~1/g, "/").replace(/~0/g, "~"));
    let current = value;
    for (const segment of segments) {
        if (!current || typeof current !== "object") {
            return undefined;
        }
        current = current[segment];
    }
    return current;
}
function parseJsonSafe(source, label) {
    try {
        return JSON.parse(source);
    }
    catch (error) {
        throw new Error(`Failed to parse dynamic ${label} output as JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
}
function buildCacheKey(config, repoRoot) {
    return `${repoRoot}:${JSON.stringify(config)}`;
}
function getCachedOptions(cacheConfig, cacheKey, context) {
    if (!cacheConfig) {
        return undefined;
    }
    if (cacheConfig === "session") {
        return context.cache.get(cacheKey);
    }
    const entry = persistentCache.get(cacheKey);
    if (!entry) {
        return undefined;
    }
    if (typeof cacheConfig === "object" && entry.expiresAt) {
        if (Date.now() > entry.expiresAt) {
            persistentCache.delete(cacheKey);
            return undefined;
        }
    }
    return entry.options;
}
function storeOptions(cacheConfig, cacheKey, options, context) {
    if (!cacheConfig) {
        return;
    }
    if (cacheConfig === "session") {
        context.cache.set(cacheKey, options);
        return;
    }
    const ttl = typeof cacheConfig === "object" ? Math.max(0, cacheConfig.ttlMs ?? 0) : undefined;
    persistentCache.set(cacheKey, {
        options,
        expiresAt: ttl ? Date.now() + ttl : undefined,
    });
}
//# sourceMappingURL=promptOptions.js.map