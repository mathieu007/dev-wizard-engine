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

const DEFAULT_WORKSPACE_MANIFEST_PATH = "workspace.repos.json";

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

registerComputeHandler("workspace-bootstrap", async (params, context) => {
	const repoRootParam = readString(params.repoRoot);
	const repoRoot = repoRootParam
		? path.resolve(repoRootParam)
		: await findWorkspaceRoot(context.repoRoot);
	const pathParam =
		readString(params.path) ?? ".dev-wizard/answers/workspace/bootstrap.json";
	const resolvedPath = path.isAbsolute(pathParam)
		? pathParam
		: path.resolve(repoRoot, pathParam);
	const required = readBoolean(params.required) ?? true;
	const requiredKeys =
		readStringArray(params.requireKeys) ?? [
			"workspaceManifestPath",
			"workspaceGitRemote",
			"workspaceDefaultBranch",
		];
	let raw: string;
	try {
		raw = await fs.readFile(resolvedPath, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			if (!required) {
				return {};
			}
			throw new Error(
				`Workspace bootstrap answers not found at ${resolvedPath}. Run "dev-wizard workspace bootstrap" to create them.`,
			);
		}
		throw error;
	}

	let snapshot: unknown;
	try {
		snapshot = JSON.parse(raw) as unknown;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(
			`Workspace bootstrap answers at ${resolvedPath} are not valid JSON: ${message}`,
		);
	}

	const scenario =
		snapshot && typeof snapshot === "object"
			? (snapshot as { scenario?: Record<string, unknown> }).scenario
			: undefined;
	if (!scenario || typeof scenario !== "object" || Array.isArray(scenario)) {
		if (!required) {
			return {};
		}
		throw new Error(
			`Workspace bootstrap answers at ${resolvedPath} are missing the "scenario" object. Re-run "dev-wizard workspace bootstrap".`,
		);
	}

	const missingKeys = requiredKeys.filter(
		(key) => readString(scenario[key]) === undefined,
	);
	if (missingKeys.length > 0 && required) {
		throw new Error(
			`Workspace bootstrap answers at ${resolvedPath} are missing required keys: ${missingKeys.join(
				", ",
			)}.`,
		);
	}

	const values: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(scenario)) {
		if (context.state.answers[key] === undefined) {
			values[key] = value;
		}
	}

	const meta =
		snapshot && typeof snapshot === "object"
			? (snapshot as { meta?: { execution?: Record<string, unknown> } }).meta
			: undefined;
	const execution = meta?.execution;
	const sandboxFlag = readBoolean(execution?.sandbox);
	const sandboxSlug = readString(execution?.sandboxSlug);
	if (sandboxFlag !== undefined) {
		values.workspaceBootstrapSandbox = sandboxFlag;
	}
	if (sandboxSlug) {
		values.workspaceBootstrapSandboxSlug = sandboxSlug;
	}
	const envSandbox = context.templateContext.env.DEV_WIZARD_SANDBOX;
	const runningInSandbox =
		typeof envSandbox === "string" &&
		envSandbox.length > 0 &&
		envSandbox !== "0" &&
		envSandbox.toLowerCase() !== "false";
	if (sandboxFlag === true && !runningInSandbox) {
		values.workspaceBootstrapSandboxMismatch = true;
	}

values.workspaceBootstrapPath = resolvedPath;
return values;
});

registerComputeHandler("workspace-global-packages", async (params, context) => {
	const repoRootParam = readString(params.repoRoot);
	const repoRoot = repoRootParam
		? path.resolve(repoRootParam)
		: await findWorkspaceRoot(context.repoRoot);
	const includeRoot = readBoolean(params.includeRoot) ?? false;
	const maxDepth = readNumber(params.maxDepth);
	const ignore = readStringArray(params.ignore);
	const limit = readNumber(params.limit);
	const manifestPathParam =
		readString(params.manifestPath) ??
		readString(context.state.answers.workspaceManifestPath);
	const manifestPaths = await loadManifestPaths(repoRoot, manifestPathParam);

	const projects = await listWorkspaceProjects({
		repoRoot,
		includeRoot,
		maxDepth,
		ignore,
		limit,
	});

	const selected: string[] = [];
	for (const project of projects) {
		if (manifestPaths && !manifestPaths.has(project.id)) {
			continue;
		}
		if (await packageHasBin(project.packageJsonPath)) {
			selected.push(project.id);
		}
	}

	return selected;
});

type WorkspaceManifestEntryInput = {
	path?: unknown;
	repo?: unknown;
	name?: unknown;
	defaultBranch?: unknown;
	role?: unknown;
	publishCommand?: unknown;
	[key: string]: unknown;
};

registerComputeHandler("workspace-manifest-list", async (params, context) => {
	const repoRoot = resolveRepoRoot(params, context);
	const manifestPathParam =
		readString(params.manifestPath) ??
		readString(context.state.answers.workspaceManifestPath) ??
		DEFAULT_WORKSPACE_MANIFEST_PATH;
	const resolvedManifestPath = path.isAbsolute(manifestPathParam)
		? manifestPathParam
		: path.resolve(repoRoot, manifestPathParam);

	let entries: unknown = [];
	try {
		const raw = await fs.readFile(resolvedManifestPath, "utf8");
		entries = JSON.parse(raw) as unknown;
		if (!Array.isArray(entries)) {
			throw new Error("workspace manifest must be a JSON array");
		}
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			entries = [];
		} else {
			throw error;
		}
	}

	return {
		workspaceManifestPath: resolvedManifestPath,
		workspaceManifestEntries: entries,
	};
});

registerComputeHandler("workspace-manifest-update", async (params, context) => {
	const repoRoot = resolveRepoRoot(params, context);
	const manifestPathParam =
		readString(params.manifestPath) ??
		readString(context.state.answers.workspaceManifestPath) ??
		DEFAULT_WORKSPACE_MANIFEST_PATH;
	const resolvedManifestPath = path.isAbsolute(manifestPathParam)
		? manifestPathParam
		: path.resolve(repoRoot, manifestPathParam);
	const mode = readString(params.mode);
	if (!mode) {
		throw new Error('workspace-manifest-update: "mode" is required.');
	}

	let manifest: unknown = [];
	try {
		const raw = await fs.readFile(resolvedManifestPath, "utf8");
		manifest = JSON.parse(raw) as unknown;
		if (!Array.isArray(manifest)) {
			throw new Error("workspace manifest must be a JSON array");
		}
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			if (mode === "remove" || mode === "update") {
				throw new Error(
					`workspace manifest not found at ${resolvedManifestPath}; cannot ${mode} entry.`,
				);
			}
			manifest = [];
		} else {
			throw error;
		}
	}

	const normalizedManifest = (manifest as WorkspaceManifestEntryInput[]).map((entry) => {
		const p = readString(entry.path);
		return {
			...entry,
			path: normalizeWorkspacePath(p ?? "", repoRoot),
		};
	});

	const entryInput = params.entry as Record<string, unknown> | undefined;
	const entryPathRaw =
		readString(params.path) ??
		readString(entryInput?.path) ??
		(mode === "root" ? "." : undefined);
	const entryPath = entryPathRaw
		? normalizeWorkspacePath(entryPathRaw, repoRoot)
		: undefined;

	if ((mode === "remove" || mode === "update" || mode === "add" || mode === "root") && !entryPath) {
		throw new Error('workspace-manifest-update: "path" is required for this mode.');
	}

	if (mode === "remove") {
		const filtered = normalizedManifest.filter(
			(entry) => normalizeWorkspacePath(readString(entry.path) ?? "", repoRoot) !== entryPath!,
		);
		await fs.writeFile(resolvedManifestPath, `${JSON.stringify(filtered, null, 2)}\n`);
		return {
			workspaceManifestPath: resolvedManifestPath,
			workspaceManifestEntries: filtered,
			workspaceManifestUpdated: true,
		};
	}

	const targetEntryPath = entryPath ?? ".";
	const entryRepo = readString(params.repo) ?? readString(entryInput?.repo);
	if (!entryRepo) {
		throw new Error('workspace-manifest-update: "repo" is required for this mode.');
	}

	const entryName =
		readString(params.name) ??
		readString(entryInput?.name) ??
		(entryPath === "." ? "workspace-root" : entryPath);
	const entryDefaultBranch =
		readString(params.defaultBranch) ?? readString(entryInput?.defaultBranch);
	const entryRole = readString(params.role) ?? readString(entryInput?.role);
	const publishCommandRaw =
		readString(params.publishCommand) ?? readString(entryInput?.publishCommand);
	const publishCommandArray = Array.isArray(entryInput?.publishCommand)
		? entryInput?.publishCommand.filter((v) => typeof v === "string") as string[]
		: publishCommandRaw
			? publishCommandRaw.split(/\s+/).filter((v) => v.length > 0)
			: undefined;

	const newEntry: WorkspaceManifestEntryInput & { path: string } = {
		name: entryName,
		path: targetEntryPath,
		repo: entryRepo,
	};
	if (entryDefaultBranch) {
		newEntry.defaultBranch = entryDefaultBranch;
	}
	if (entryRole) {
		newEntry.role = entryRole;
	}
	if (publishCommandArray && publishCommandArray.length > 0) {
		newEntry.publishCommand = publishCommandArray;
	}

	const filtered = normalizedManifest.filter((entry) => {
		const entryPathValue = readString(entry.path);
		return normalizeWorkspacePath(entryPathValue ?? "", repoRoot) !== targetEntryPath;
	});
	filtered.push(newEntry);
	await fs.writeFile(resolvedManifestPath, `${JSON.stringify(filtered, null, 2)}\n`);

	return {
		workspaceManifestPath: resolvedManifestPath,
		workspaceManifestEntries: filtered,
		workspaceManifestUpdated: true,
	};
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

function resolveRepoRoot(params: Record<string, unknown>, context: ComputeHandlerContext): string {
	const repoRootParam = readString(params.repoRoot);
	return repoRootParam ? path.resolve(repoRootParam) : context.repoRoot;
}

function normalizeWorkspacePath(entryPath: string, repoRoot: string): string {
	const normalized = path.normalize(
		path.isAbsolute(entryPath) ? path.relative(repoRoot, entryPath) : entryPath,
	);
	return normalized === "" ? "." : normalized;
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

async function loadManifestPaths(
	repoRoot: string,
	manifestPath?: string,
): Promise<Set<string> | undefined> {
	if (!manifestPath) {
		return undefined;
	}
	const resolved = path.isAbsolute(manifestPath)
		? manifestPath
		: path.resolve(repoRoot, manifestPath);
	let raw: string;
	try {
		raw = await fs.readFile(resolved, "utf8");
	} catch {
		return undefined;
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw) as unknown;
	} catch {
		return undefined;
	}

	if (!Array.isArray(parsed)) {
		return undefined;
	}

	const paths = new Set<string>();
	for (const entry of parsed) {
		const entryPath = readString((entry as { path?: unknown }).path);
		if (!entryPath) {
			continue;
		}
		const normalized = path.normalize(
			path.isAbsolute(entryPath)
				? path.relative(repoRoot, entryPath)
				: entryPath,
		);
		const trimmed = normalized === "" ? "." : normalized;
		paths.add(trimmed);
	}

	return paths.size > 0 ? paths : undefined;
}

async function packageHasBin(packageJsonPath: string): Promise<boolean> {
	let raw: string;
	try {
		raw = await fs.readFile(packageJsonPath, "utf8");
	} catch {
		return false;
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw) as unknown;
	} catch {
		return false;
	}

	if (!parsed || typeof parsed !== "object") {
		return false;
	}

	const bin = (parsed as { bin?: unknown }).bin;
	if (typeof bin === "string") {
		return bin.trim().length > 0;
	}
	if (bin && typeof bin === "object") {
		return Object.keys(bin as Record<string, unknown>).length > 0;
	}
	return false;
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
