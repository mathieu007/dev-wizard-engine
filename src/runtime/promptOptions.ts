import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { execaCommand } from "execa";
import fg from "fast-glob";
import type {
	PromptDynamicOptions,
	PromptOption,
	PromptDynamicMap,
} from "../loader/types";
import type { TemplateContext } from "./templates.js";
import { renderMaybeNested } from "./templates.js";
import { listWorkspaceProjects } from "./workspaceProjects.js";

interface PromptOptionsCacheEntry {
	options: PromptOption[];
	expiresAt?: number;
}

const persistentCache = new Map<string, PromptOptionsCacheEntry>();

export interface DynamicOptionsContext {
	repoRoot: string;
	cache: Map<string, PromptOption[]>;
}

export async function resolveDynamicPromptOptions(
	dynamicConfig: PromptDynamicOptions | undefined,
	templateContext: TemplateContext,
	context: DynamicOptionsContext,
): Promise<PromptOption[] | undefined> {
	if (!dynamicConfig) {
		return undefined;
	}

	const renderedConfig = renderMaybeNested(
		dynamicConfig,
		templateContext,
	) as PromptDynamicOptions;
	const cacheKey = buildCacheKey(renderedConfig, context.repoRoot);

	const cached = getCachedOptions(renderedConfig.cache, cacheKey, context);
	if (cached) {
		return cached;
	}

	const options = await loadOptions(renderedConfig, templateContext, context);
	storeOptions(renderedConfig.cache, cacheKey, options, context);
	return options;
}

async function loadOptions(
	config: PromptDynamicOptions,
	templateContext: TemplateContext,
	context: DynamicOptionsContext,
): Promise<PromptOption[]> {
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

async function loadOptionsFromCommand(
	config: Extract<PromptDynamicOptions, { type: "command" }>,
	context: DynamicOptionsContext,
): Promise<PromptOption[]> {
	const subprocess = await execaCommand(config.command, {
		cwd: config.cwd ? path.resolve(context.repoRoot, config.cwd) : context.repoRoot,
		env: process.env,
		shell: config.shell ?? true,
	});

	const parsed = parseJsonSafe(subprocess.stdout, "command");
	return normalizeToPromptOptions(parsed, config.map);
}

async function loadOptionsFromGlob(
	config: Extract<PromptDynamicOptions, { type: "glob" }>,
	context: DynamicOptionsContext,
): Promise<PromptOption[]> {
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

	const options: PromptOption[] = matches.map((match) => {
		const absolutePath = path.resolve(cwd, match);
		const relativePath = path.relative(context.repoRoot, absolutePath);
		return {
			value: absolutePath,
			label: relativePath || ".",
		};
	});

	return applyDynamicMap(options, config.map);
}

async function loadOptionsFromJson(
	config: Extract<PromptDynamicOptions, { type: "json" }>,
	context: DynamicOptionsContext,
): Promise<PromptOption[]> {
	const filePath = path.resolve(context.repoRoot, config.path);
	const fileContents = await readFile(filePath, "utf8");
	const parsed = parseJsonSafe(fileContents, "json");
	const target = resolvePointer(parsed, config.pointer);
	return normalizeToPromptOptions(target, config.map);
}

async function loadOptionsFromWorkspaceProjects(
	config: Extract<PromptDynamicOptions, { type: "workspace-projects" }>,
	context: DynamicOptionsContext,
): Promise<PromptOption[]> {
	const projects = await listWorkspaceProjects({
		repoRoot: context.repoRoot,
		includeRoot: config.includeRoot,
		maxDepth: config.maxDepth,
		ignore: config.ignore,
		limit: config.limit,
	});

	const options: PromptOption[] = projects.map((project) => ({
		value: project.id,
		label: project.label,
	}));

	return applyDynamicMap(options, config.map);
}

async function loadOptionsFromProjectTsconfigs(
	config: Extract<PromptDynamicOptions, { type: "project-tsconfigs" }>,
	context: DynamicOptionsContext,
): Promise<PromptOption[]> {
	const projectDir = path.isAbsolute(config.project)
		? path.resolve(config.project)
		: path.resolve(context.repoRoot, config.project);

	const stats = await stat(projectDir).catch(() => {
		throw new Error(
			`Project directory ${config.project} was not found under ${context.repoRoot}.`,
		);
	});

	if (!stats.isDirectory()) {
		throw new Error(
			`Project path ${projectDir} is not a directory. Provide a folder that contains tsconfig files.`,
		);
	}

	const entries = await readdir(projectDir, { withFileTypes: true });
	const matches = entries
		.filter(
			(entry) =>
				entry.isFile() &&
				entry.name.toLowerCase().startsWith("tsconfig") &&
				entry.name.toLowerCase().endsWith(".json"),
		)
		.map((entry) => entry.name)
		.sort((a, b) => a.localeCompare(b));

	if (!matches.includes("tsconfig.json")) {
		matches.push("tsconfig.json");
	}

	const relativeProjectPath = path.relative(context.repoRoot, projectDir) || ".";
	const options: PromptOption[] = matches.map((filename) => ({
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

function normalizeToPromptOptions(
	value: unknown,
	map?: PromptDynamicMap,
): PromptOption[] {
	if (Array.isArray(value)) {
		return applyDynamicMap(
			value.map((item) => {
				if (typeof item === "string" || typeof item === "number") {
					return {
						value: String(item),
						label: String(item),
					};
				}

				if (item && typeof item === "object") {
					return normalizeObjectOption(
						item as Record<string, unknown>,
						map,
					);
				}

				return {
					value: JSON.stringify(item),
					label: JSON.stringify(item),
				};
			}),
			map,
		);
	}

	if (value && typeof value === "object") {
		const entries = Object.entries(value as Record<string, unknown>).map(
			([key, val]) => {
				if (typeof val === "string" || typeof val === "number") {
					return {
						value: key,
						label: String(val),
					};
				}
				if (val && typeof val === "object") {
					return normalizeObjectOption(
						{ value: key, ...(val as Record<string, unknown>) },
						map,
					);
				}
				return {
					value: key,
					label: key,
				};
			},
		);
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

function normalizeObjectOption(
	item: Record<string, unknown> | PromptOption,
	map?: PromptDynamicMap,
): PromptOption {
	const source: Record<string, unknown> = {
		...('value' in item ? { value: (item as PromptOption).value } : {}),
		...('label' in item ? { label: (item as PromptOption).label } : {}),
		...('hint' in item ? { hint: (item as PromptOption).hint } : {}),
		...('disabled' in item ? { disabled: (item as PromptOption).disabled } : {}),
		...(item as Record<string, unknown>),
	};
	const valuePath = map?.value ?? "value";
	const labelPath = map?.label ?? "label";
	const hintPath = map?.hint;
	const disablePath = map?.disableWhen;

	const value = getPath(source, valuePath) ?? source.value ?? source.id;
	const label =
		getPath(source, labelPath) ??
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

function applyDynamicMap(
	options: PromptOption[],
	map?: PromptDynamicMap,
): PromptOption[] {
	if (!map) {
		return options;
	}

	return options.map((option) =>
		normalizeObjectOption(option as unknown as Record<string, unknown>, map),
	);
}

function getPath(value: unknown, pointer?: string): unknown {
	if (!pointer) {
		return undefined;
	}

	if (pointer.startsWith("/")) {
		return resolvePointer(value, pointer);
	}

const segments = pointer.split(".").filter(Boolean);
	let current: unknown = value;
	for (const segment of segments) {
		if (!current || typeof current !== "object") {
			return undefined;
		}
		current = (current as Record<string, unknown>)[segment];
	}
	return current;
}

function resolvePointer(value: unknown, pointer: string | undefined): unknown {
	if (!pointer || pointer === "/") {
		return value;
	}

	const segments = pointer
		.split("/")
		.slice(pointer.startsWith("/") ? 1 : 0)
		.map((segment) => segment.replace(/~1/g, "/").replace(/~0/g, "~"));

	let current: unknown = value;
	for (const segment of segments) {
		if (!current || typeof current !== "object") {
			return undefined;
		}
		current = (current as Record<string, unknown>)[segment];
	}
	return current;
}

function parseJsonSafe(source: string, label: string): unknown {
	try {
		return JSON.parse(source);
	} catch (error) {
		throw new Error(
			`Failed to parse dynamic ${label} output as JSON: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}
}

function buildCacheKey(config: PromptDynamicOptions, repoRoot: string): string {
	return `${repoRoot}:${JSON.stringify(config)}`;
}

function getCachedOptions(
	cacheConfig: PromptDynamicOptions["cache"],
	cacheKey: string,
	context: DynamicOptionsContext,
): PromptOption[] | undefined {
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

function storeOptions(
	cacheConfig: PromptDynamicOptions["cache"],
	cacheKey: string,
	options: PromptOption[],
	context: DynamicOptionsContext,
): void {
	if (!cacheConfig) {
		return;
	}

	if (cacheConfig === "session") {
		context.cache.set(cacheKey, options);
		return;
	}

	const ttl =
		typeof cacheConfig === "object" ? Math.max(0, cacheConfig.ttlMs ?? 0) : undefined;

	persistentCache.set(cacheKey, {
		options,
		expiresAt: ttl ? Date.now() + ttl : undefined,
	});
}
