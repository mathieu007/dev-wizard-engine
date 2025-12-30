import fs from "node:fs/promises";
import path from "node:path";
export const ROOT_CONFIG_CANDIDATES = [
    "dev-wizard.config.yaml",
    "dev-wizard.config.yml",
    "dev-wizard.config.json",
    "dev-wizard.config.json5",
];
export const INDEX_FILENAMES = ["index.yaml", "index.yml", "index.json", "index.json5"];
export async function resolveConfigPaths(options = {}) {
    const cwd = options.cwd ? path.resolve(options.cwd) : process.cwd();
    const diagnostics = [];
    const errors = [];
    const entries = [];
    const seen = new Set();
    const explicit = normalizeExplicitPaths(options.explicitPaths);
    if (explicit.length > 0) {
        for (const provided of explicit) {
            const absolute = path.isAbsolute(provided)
                ? provided
                : path.resolve(cwd, provided);
            if (await pathExists(absolute)) {
                record(entries, seen, absolute, "explicit");
                diagnostics.push(formatDiagnostic("explicit", cwd, absolute, "found"));
            }
            else {
                errors.push(`Explicit config path not found: ${formatRelative(cwd, absolute)}`);
                diagnostics.push(formatDiagnostic("explicit", cwd, absolute, "missing"));
            }
        }
        return finalize(entries, diagnostics, errors);
    }
    await evaluateRootConfigs({ cwd, diagnostics, entries, seen });
    await evaluateConfigDirectory({
        cwd,
        diagnostics,
        entries,
        seen,
        environment: options.environment,
        includeLocal: options.includeLocal ?? true,
    });
    await evaluatePackageJson({ cwd, diagnostics, entries, seen, errors });
    return finalize(entries, diagnostics, errors);
}
function finalize(entries, diagnostics, errors) {
    return {
        entries,
        diagnostics,
        errors,
        paths: entries.map((entry) => entry.path),
    };
}
function normalizeExplicitPaths(input) {
    if (!input) {
        return [];
    }
    return Array.isArray(input) ? input : [input];
}
async function evaluateRootConfigs({ cwd, diagnostics, entries, seen, }) {
    for (const candidate of ROOT_CONFIG_CANDIDATES) {
        const absolute = path.join(cwd, candidate);
        const exists = await pathExists(absolute);
        diagnostics.push(formatDiagnostic("root", cwd, absolute, exists ? "found" : "missing"));
        if (exists) {
            record(entries, seen, absolute, "root");
        }
    }
}
async function evaluateConfigDirectory({ cwd, diagnostics, entries, seen, environment, includeLocal, }) {
    const baseDir = path.join(cwd, "dev-wizard-config");
    const exists = await pathExists(baseDir);
    if (!exists) {
        diagnostics.push("[directory] dev-wizard-config/ (missing)");
        return;
    }
    // Base overlays (root index files)
    const baseIndexes = await findDirectIndexFiles(baseDir);
    if (baseIndexes.length > 0) {
        for (const file of baseIndexes) {
            record(entries, seen, file, "directory");
        }
        diagnostics.push(`[directory] dev-wizard-config/ (base overlay, ${baseIndexes.length} index file${baseIndexes.length === 1 ? "" : "s"})`);
    }
    else {
        diagnostics.push("[directory] dev-wizard-config/ (base overlay missing index files)");
    }
    // Environment overlay
    if (environment) {
        const envDir = path.join(baseDir, "environments", environment);
        if (await pathExists(envDir)) {
            const envIndexes = await findDirectIndexFiles(envDir);
            if (envIndexes.length > 0) {
                for (const file of envIndexes) {
                    record(entries, seen, file, "directory");
                }
                diagnostics.push(`[directory] dev-wizard-config/environments/${environment}/ (overlay, ${envIndexes.length} index file${envIndexes.length === 1 ? "" : "s"})`);
            }
            else {
                diagnostics.push(`[directory] dev-wizard-config/environments/${environment}/ (overlay present, no index files)`);
            }
        }
        else {
            diagnostics.push(`[directory] dev-wizard-config/environments/${environment}/ (missing)`);
        }
    }
    // Local overlay (optional)
    if (includeLocal) {
        const localDir = path.join(baseDir, "local");
        let localFound = false;
        if (await pathExists(localDir)) {
            const localIndexes = await findDirectIndexFiles(localDir);
            if (localIndexes.length > 0) {
                localFound = true;
                for (const file of localIndexes) {
                    record(entries, seen, file, "directory");
                }
                diagnostics.push(`[directory] dev-wizard-config/local/ (overlay, ${localIndexes.length} index file${localIndexes.length === 1 ? "" : "s"})`);
            }
        }
        const localRootCandidates = await findRootLocalConfig(cwd);
        if (localRootCandidates.length > 0) {
            localFound = true;
            for (const file of localRootCandidates) {
                record(entries, seen, file, "root");
            }
            diagnostics.push(`[root] dev-wizard.config.local.* (overlay, ${localRootCandidates.length} file${localRootCandidates.length === 1 ? "" : "s"})`);
        }
        if (!localFound) {
            diagnostics.push("[directory] dev-wizard-config/local/ (local overlay not applied)");
        }
    }
}
async function evaluatePackageJson({ cwd, diagnostics, entries, seen, errors, }) {
    const packageJsonPath = path.join(cwd, "package.json");
    if (!(await pathExists(packageJsonPath))) {
        diagnostics.push("[package-json] wizard.config (package.json missing)");
        return;
    }
    let parsed;
    try {
        const file = await fs.readFile(packageJsonPath, "utf8");
        parsed = JSON.parse(file);
    }
    catch (error) {
        errors.push(`Failed to parse package.json: ${error instanceof Error ? error.message : String(error)}`);
        return;
    }
    const wizardConfig = parsed?.wizard
        ?.config;
    if (!wizardConfig) {
        diagnostics.push("[package-json] wizard.config (not set)");
        return;
    }
    const configs = Array.isArray(wizardConfig)
        ? wizardConfig
        : [wizardConfig];
    const stringConfigs = configs.filter((item) => typeof item === "string");
    if (stringConfigs.length === 0) {
        errors.push("package.json#wizard.config must be a string or array of strings.");
        return;
    }
    let found = 0;
    for (const rawPath of stringConfigs) {
        const absolute = path.resolve(cwd, rawPath);
        if (await pathExists(absolute)) {
            record(entries, seen, absolute, "package-json");
            found += 1;
        }
        else {
            errors.push(`package.json#wizard.config references missing file: ${formatRelative(cwd, absolute)}`);
        }
    }
    if (found === 0) {
        diagnostics.push("[package-json] wizard.config (no existing files found)");
    }
    else {
        diagnostics.push(`[package-json] wizard.config (found ${found} file${found === 1 ? "" : "s"})`);
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
function record(entries, seen, filePath, source) {
    if (seen.has(filePath)) {
        return;
    }
    seen.add(filePath);
    entries.push({ path: filePath, source });
}
function formatDiagnostic(source, cwd, filePath, status) {
    return `[${source}] ${formatRelative(cwd, filePath)} (${status})`;
}
function formatRelative(cwd, target) {
    const relative = path.relative(cwd, target);
    return relative && !relative.startsWith("..") ? relative : target;
}
async function findDirectIndexFiles(directory) {
    const results = [];
    for (const filename of INDEX_FILENAMES) {
        const candidate = path.join(directory, filename);
        if (await pathExists(candidate)) {
            results.push(candidate);
        }
    }
    results.sort((a, b) => a.localeCompare(b));
    return results;
}
async function findRootLocalConfig(cwd) {
    const results = [];
    const localCandidates = ROOT_CONFIG_CANDIDATES.map((candidate) => candidate.replace("dev-wizard.config", "dev-wizard.config.local"));
    for (const candidate of localCandidates) {
        const absolute = path.join(cwd, candidate);
        if (await pathExists(absolute)) {
            results.push(absolute);
        }
    }
    return results;
}
//# sourceMappingURL=configResolver.js.map