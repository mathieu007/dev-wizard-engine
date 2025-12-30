import { promises as fs } from "node:fs";
import type { Dirent } from "node:fs";
import path from "node:path";

export interface WorkspaceProject {
	id: string;
	label: string;
	packageJsonPath: string;
}

export interface WorkspaceProjectScanOptions {
	repoRoot: string;
	includeRoot?: boolean;
	maxDepth?: number;
	ignore?: string[];
	limit?: number;
}

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

export async function listWorkspaceProjects(
	options: WorkspaceProjectScanOptions,
): Promise<WorkspaceProject[]> {
	const {
		repoRoot,
		includeRoot = true,
		maxDepth = DEFAULT_MAX_DEPTH,
		ignore,
		limit,
	} = options;

	const ignoreSet = new Set<string>(ignore ?? DEFAULT_IGNORE);
	const seen = new Set<string>();
	const projects: WorkspaceProject[] = [];

	async function tryAdd(relativeDir: string) {
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
			const pkg = JSON.parse(raw) as { name?: string };
			const defaultLabel =
				normalized === "."
					? path.basename(repoRoot)
					: path.basename(normalized);
			const label = pkg.name ?? defaultLabel ?? normalized;
			projects.push({
				id: normalized,
				label,
				packageJsonPath,
			});
			seen.add(normalized);
		} catch {
			// Ignore directories without package.json files.
		}
	}

	async function walk(relativeDir: string, depth: number) {
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

	let entries: Dirent[];
		try {
			entries = await fs.readdir(absoluteDir, { withFileTypes: true });
		} catch {
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

			const childRelative =
				relativeDir === "" ? entry.name : path.join(relativeDir, entry.name);
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
