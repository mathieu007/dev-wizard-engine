import { promises as fs } from "node:fs";
import path from "node:path";
import type { TemplateContext } from "./templates.js";
import type { WizardState } from "./state.js";
import { listWorkspaceProjects } from "./workspaceProjects.js";

export interface ComputeHandlerContext {
	repoRoot: string;
	state: WizardState;
	templateContext: TemplateContext;
}

export type ComputeHandler = (
	params: Record<string, unknown>,
	context: ComputeHandlerContext,
) => Promise<unknown> | unknown;

const computeHandlers = new Map<string, ComputeHandler>();

export function registerComputeHandler(id: string, handler: ComputeHandler): void {
	if (computeHandlers.has(id)) {
		throw new Error(`Compute handler "${id}" is already registered.`);
	}
	computeHandlers.set(id, handler);
}

export function getComputeHandler(id: string): ComputeHandler | undefined {
	return computeHandlers.get(id);
}

registerComputeHandler("workspace-projects", async (params, context) => {
	const includeRoot = readBoolean(params.includeRoot);
	const maxDepth = readNumber(params.maxDepth);
	const ignore = readStringArray(params.ignore);
	const limit = readNumber(params.limit);
	const selectedProjects =
		readStringArray(params.selectedProjects) ??
		readStringArray(context.state.answers.selectedProjects);
	const repoRootParam = readString(params.repoRoot);
	const repoRoot = repoRootParam
		? path.resolve(repoRootParam)
		: await findWorkspaceRoot(context.repoRoot);

	const projects = await listWorkspaceProjects({
		repoRoot,
		includeRoot,
		maxDepth,
		ignore,
		limit,
	});
	if (!selectedProjects || selectedProjects.length === 0) {
		return [];
	}

	const projectById = new Map(projects.map((project) => [project.id, project]));
	const resolved: Array<{ id: string; label: string }> = [];
	const seen = new Set<string>();
	for (const id of selectedProjects) {
		if (seen.has(id)) {
			continue;
		}
		seen.add(id);
		const project = projectById.get(id);
		if (project) {
			resolved.push({ id: project.id, label: project.label });
		}
	}
	return resolved;
});

registerComputeHandler("template-json", (params) => {
	const value = params.value ?? params.template ?? params.json;
	const fallback = params.fallback;
	if (value === undefined) {
		if (fallback === undefined) {
			throw new Error('Compute handler "template-json" requires a "value" (or "fallback").');
		}
		return parseTemplateJsonValue(fallback);
	}
	return parseTemplateJsonValue(value);
});

registerComputeHandler("maintenance-window", (params) => {
	const cadence = normalizeMaintenanceCadence(readString(params.cadence));
	const base = sanitizeMaintenanceWindowName(readString(params.name)) ??
		`${cadence}-maintenance`;
	const date = new Date().toISOString().slice(0, 10);
	return {
		identifier: `${date}-${base}`,
		base,
		cadence,
	};
});

const TS_CONFIG_CANDIDATES = [
	"tsconfig.dev.json",
	"tsconfig.test.json",
	"tsconfig.json",
] as const;

registerComputeHandler("detect-project-tsconfig", async (params, context) => {
	const repoRoot = readString(params.repoRoot) ?? context.repoRoot;
	const target = readString(params.target);
	const baseDir = path.resolve(repoRoot);
	const searchDir = target ? path.resolve(baseDir, target) : baseDir;

	for (const candidate of TS_CONFIG_CANDIDATES) {
		const filePath = path.join(searchDir, candidate);
		try {
			const stats = await fs.stat(filePath);
			if (stats.isFile()) {
				return candidate;
			}
		} catch {
			continue;
		}
	}

	return null;
});

registerComputeHandler("render-typecheck-command", async (params, context) => {
	const repoRoot = readString(params.repoRoot) ?? context.repoRoot;
	const tsconfig = readString(params.tsconfig) ?? "tsconfig.json";
	const cwd = readString(params.cwd);
	const compilerOptions = readString(params.compilerOptions);
	const workspaceRoot = await findWorkspaceRoot(path.resolve(repoRoot));
	const scriptPath = path.join(
		workspaceRoot,
		"packages/dev-wizard-presets/scripts/typecheck.ts",
	);

	const parts = ["pnpm", "exec", "tsx", scriptPath, "--tsconfig", tsconfig];
	if (cwd && cwd !== ".") {
		parts.push("--cwd", cwd);
	}
	if (compilerOptions && compilerOptions.trim().length > 0) {
		parts.push("--compilerOptions", compilerOptions);
	}

	return parts.map(quoteCommandPart).join(" ");
});

registerComputeHandler("commit-message-file", async (params) => {
	const filePath = readString(params.path);
	if (!filePath) {
		throw new Error('Compute handler "commit-message-file" requires a "path".');
	}
	const resolvedPath = path.resolve(filePath);
	const fallbackMessage = buildCommitMessageFallback(resolvedPath);
	let contents: string;

	try {
		contents = await fs.readFile(resolvedPath, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return fallbackMessage;
		}
		throw error;
	}

	const normalized = contents.replace(/\r\n/g, "\n").trim();
	return normalized.length > 0 ? normalized : fallbackMessage;
});

function readBoolean(value: unknown): boolean | undefined {
	if (typeof value === "boolean") {
		return value;
	}
	if (typeof value === "string") {
		if (value === "true") {
			return true;
		}
		if (value === "false") {
			return false;
		}
	}
	return undefined;
}

function readNumber(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) {
		return value;
	}
	if (typeof value === "string" && value.trim() !== "") {
		const parsed = Number(value);
		if (!Number.isNaN(parsed)) {
			return parsed;
		}
	}
	return undefined;
}

function readStringArray(value: unknown): string[] | undefined {
	if (Array.isArray(value)) {
		const filtered = value.filter((entry) => typeof entry === "string");
		return filtered.length > 0 ? filtered : undefined;
	}
	if (typeof value === "string") {
		return [value];
	}
	return undefined;
}

function readString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function parseTemplateJsonValue(value: unknown): unknown {
	if (typeof value === "string") {
		const trimmed = value.trim();
		if (trimmed === "") {
			throw new Error('Compute handler "template-json" received an empty string.');
		}
		try {
			return JSON.parse(trimmed);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new Error(
				`Compute handler "template-json" failed to parse JSON: ${message}`,
			);
		}
	}
	return value;
}

function normalizeMaintenanceCadence(value?: string): string {
	const trimmed = value?.trim().toLowerCase();
	if (
		trimmed &&
		(trimmed === "weekly" ||
			trimmed === "daily" ||
			trimmed === "monthly" ||
			trimmed === "quarterly" ||
			trimmed === "adhoc")
	) {
		return trimmed;
	}
	return "weekly";
}

function sanitizeMaintenanceWindowName(value?: string): string | undefined {
	const trimmed = value?.trim();
	if (!trimmed) {
		return undefined;
	}
	const slug = trimmed
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-+/, "")
		.replace(/-+$/, "");
	return slug.length > 0 ? slug : undefined;
}

function quoteCommandPart(value: string): string {
	return /^[\w@/.:=-]+$/u.test(value) ? value : JSON.stringify(value);
}

function buildCommitMessageFallback(filePath: string): string {
	const directoryName = path.basename(path.dirname(filePath)) || "repo";
	return `chore(${directoryName}): Dev Wizard automation snapshot`;
}

async function findWorkspaceRoot(start: string): Promise<string> {
	let current = path.resolve(start);
	const root = path.parse(current).root;
	let fallbackGitDir: string | undefined;

	while (true) {
		if (await hasWorkspaceManifest(current)) {
			return current;
		}

		if (!fallbackGitDir && (await hasGitMarker(current))) {
			fallbackGitDir = current;
		}

		if (current === root) {
			return fallbackGitDir ?? path.resolve(start);
		}

		const parent = path.dirname(current);
		if (parent === current) {
			return fallbackGitDir ?? path.resolve(start);
		}
		current = parent;
	}
}

async function hasWorkspaceManifest(dir: string): Promise<boolean> {
	const manifests = ["pnpm-workspace.yaml", "pnpm-workspace.yml"];
	for (const file of manifests) {
		if (await pathExists(path.join(dir, file))) {
			return true;
		}
	}
	return false;
}

async function hasGitMarker(dir: string): Promise<boolean> {
	return pathExists(path.join(dir, ".git"));
}

async function pathExists(filePath: string): Promise<boolean> {
	try {
		await fs.access(filePath);
		return true;
	} catch {
		return false;
	}
}
