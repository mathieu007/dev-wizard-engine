import { promises as fs } from "node:fs";
import path from "node:path";
const DEFAULT_IGNORE = [
    "node_modules",
    ".pnpm",
    ".dev-wizard",
    ".git",
    "dist",
    "build",
    ".turbo",
    ".cache",
];
const DEFAULT_MAX_DEPTH = 2;
export async function listWorkspaceProjects(options) {
    const { repoRoot, includeRoot = true, maxDepth = DEFAULT_MAX_DEPTH, ignore, limit, } = options;
    const ignoreSet = new Set(ignore ?? DEFAULT_IGNORE);
    const seen = new Set();
    const projects = [];
    async function tryAdd(relativeDir) {
        const normalized = relativeDir === "" ? "." : relativeDir;
        if (seen.has(normalized)) {
            return;
        }
        if (!includeRoot && normalized === ".") {
            return;
        }
        const absoluteDir = normalized === "."
            ? repoRoot
            : path.join(repoRoot, normalized);
        const packageJsonPath = path.join(absoluteDir, "package.json");
        try {
            const raw = await fs.readFile(packageJsonPath, "utf8");
            const pkg = JSON.parse(raw);
            const defaultLabel = normalized === "."
                ? path.basename(repoRoot)
                : path.basename(normalized);
            const label = pkg.name ?? defaultLabel ?? normalized;
            projects.push({
                id: normalized,
                label,
                packageJsonPath,
            });
            seen.add(normalized);
        }
        catch {
            // Ignore directories without package.json files.
        }
    }
    async function walk(relativeDir, depth) {
        if (limit !== undefined && projects.length >= limit) {
            return;
        }
        await tryAdd(relativeDir);
        if (depth >= maxDepth) {
            return;
        }
        const absoluteDir = relativeDir === ""
            ? repoRoot
            : path.join(repoRoot, relativeDir);
        let entries;
        try {
            entries = await fs.readdir(absoluteDir, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const entry of entries) {
            if (!entry.isDirectory()) {
                continue;
            }
            if (ignoreSet.has(entry.name)) {
                continue;
            }
            if (entry.name.startsWith(".")) {
                continue;
            }
            const childRelative = relativeDir === "" ? entry.name : path.join(relativeDir, entry.name);
            await walk(childRelative, depth + 1);
            if (limit !== undefined && projects.length >= limit) {
                return;
            }
        }
    }
    await walk("", 0);
    projects.sort((a, b) => a.label.localeCompare(b.label));
    return limit !== undefined ? projects.slice(0, limit) : projects;
}
//# sourceMappingURL=workspaceProjects.js.map