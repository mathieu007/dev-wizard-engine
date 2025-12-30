import { createRequire } from "node:module";
import path from "node:path";
import { execa } from "execa";
import { z } from "zod";

import type { CommandRecommendationCommand, CommandRecommendationLink } from "../loader/types";
import type { WizardLogWriter } from "./logWriter.js";
import type { DevWizardOptions } from "./types.js";
import { listWorkspaceProjects } from "./workspaceProjects.js";

const nodeRequire = createRequire(import.meta.url);
const PROJECTS_PRESET_SPECIFIER = "@dev-wizard/presets/projects";
const PROJECTS_SCENARIO_ID = "multi-project-orchestration";
const MAINTENANCE_PRESET_SPECIFIER = "@dev-wizard/presets/maintenance";
const MAINTENANCE_SCENARIO_ID = "maintenance-window";

export interface DefineWizardCommandInput {
	id: string;
	command: string;
	args?: string[];
	label?: string;
	cwd?: string;
	env?: Record<string, string>;
	shell?: boolean;
	allowFailure?: boolean;
	warnAfterMs?: number;
	flowId?: string;
	stepId?: string;
}

export interface WizardScriptCommandDefinition extends DefineWizardCommandInput {
	args: string[];
}

export interface RunWizardCommandOptions {
	dryRun?: boolean;
	quiet?: boolean;
	logWriter?: WizardLogWriter;
	flowId?: string;
	stepId?: string;
	redactOutput?: boolean;
}

export interface WizardScriptCommandResult {
	definition: WizardScriptCommandDefinition;
	startedAt: Date;
	endedAt: Date;
	durationMs: number;
	exitCode?: number;
	stdout?: string;
	stderr?: string;
	success: boolean;
	dryRun: boolean;
	error?: Error;
}

export interface WizardTimerHandle {
	stop(): WizardTimerResult;
}

export interface WizardTimerResult {
	startedAt: Date;
	endedAt: Date;
	durationMs: number;
}

export interface WizardTimer {
	start(): WizardTimerHandle;
	wrap<T>(work: () => Promise<T> | T): Promise<WizardTimerWrapResult<T>>;
}

export interface WizardTimerWrapResult<T> extends WizardTimerResult {
	result: T;
}

export interface ProjectsOrchestratorOptions {
	repoRoot?: string;
	configPath?: string | string[];
	presetSpecifier?: string;
	scenarioId?: string;
	projects?: string[];
	selectAllProjects?: boolean;
	includeRoot?: boolean;
	maxDepth?: number;
	ignore?: string[];
	limit?: number;
	workflows?: string[];
	autoExecute?: boolean;
	overrides?: Record<string, unknown>;
	devWizardOptions?: Omit<DevWizardOptions, "configPath" | "scenario" | "overrides">;
}

export interface MaintenancePresetOverrides {
	maintenanceWindowMode?: string;
	maintenanceWindow?: string;
	maintenanceWindowCadence?: string;
	maintenanceTasks?: string[];
	maintenanceNotes?: string;
	maintenanceFollowUps?: string;
	upgradeBackupStrategy?: string;
	upgradeBranchName?: string;
	upgradeStashMessage?: string;
	upgradeCommand?: string;
	upgradePostCheckCommand?: string;
	upgradeLatestCommand?: string;
	upgradeStrategy?: string;
	typecheckCommandMode?: string;
	typecheckCommand?: string;
	typecheckWorkingDir?: string;
	typecheckTsconfigSelection?: string;
	typecheckTsconfigCustom?: string;
	typecheckCompilerOptions?: string;
	typecheckPreStrategy?: string;
	typecheckPostStrategy?: string;
	peerResolutionStrategy?: string;
	peerResolutionCommand?: string;
}

export interface MaintenanceWizardOptions {
	configPath?: string | string[];
	presetSpecifier?: string;
	scenarioId?: string;
	overrides?: MaintenancePresetOverrides & Record<string, unknown>;
	devWizardOptions?: DevWizardOptions;
}

export interface RecommendationBuilderOptions {
	summary?: string;
}

export interface WizardRecommendation {
	summary?: string;
	commands: CommandRecommendationCommand[];
	links: CommandRecommendationLink[];
}

export interface WizardRecommendationBuilder {
	setSummary(summary: string): void;
	addCommand(command: string, options?: { label?: string }): void;
	addLink(url: string, options?: { label?: string }): void;
	reset(): void;
	build(): WizardRecommendation;
	format(): string | undefined;
}

export interface ReadJsonStdinOptions<T> {
	stdin?: NodeJS.ReadableStream;
	encoding?: BufferEncoding;
	allowEmpty?: boolean;
	schema?: { parse: (input: unknown) => T };
	description?: string;
}

export interface ParseScriptArgsOptions<TSchema extends { parse: (input: unknown) => any }> {
	schema: TSchema;
	argv?: readonly string[];
	aliases?: Record<string, string>;
	allowPositionals?: boolean;
	description?: string;
}

export interface HandleScriptErrorOptions {
	stderr?: NodeJS.WritableStream;
	logger?: { error(message: string): void };
}

export class WizardScriptError extends Error {
	exitCode: number;

	constructor(message: string, options?: { exitCode?: number; cause?: unknown }) {
		super(message);
		this.name = "WizardScriptError";
		this.exitCode = options?.exitCode ?? 1;
		if (options?.cause !== undefined) {
			// Assigning cause manually keeps compatibility with older Node versions.
			(this as Error & { cause?: unknown }).cause = options.cause;
		}
	}
}

export async function createProjectsOrchestratorOptions(
	options: ProjectsOrchestratorOptions = {},
): Promise<DevWizardOptions> {
	const {
		repoRoot: repoRootArg,
		configPath,
		presetSpecifier,
		scenarioId,
		projects,
		selectAllProjects,
		includeRoot,
		maxDepth,
		ignore,
		limit,
		workflows,
		autoExecute,
		overrides,
		devWizardOptions,
	} = options;

	const repoRoot = repoRootArg ? path.resolve(repoRootArg) : process.cwd();

	const resolvedConfigPath =
		configPath ?? resolveProjectsPresetPath(presetSpecifier ?? PROJECTS_PRESET_SPECIFIER);
	const resolvedScenario = scenarioId ?? PROJECTS_SCENARIO_ID;

	const mergedOverrides: Record<string, unknown> = Object.assign({}, overrides ?? {});

	if (workflows && workflows.length > 0) {
		mergedOverrides.selectedWorkflows = dedupeStrings(workflows);
	}

	if (typeof autoExecute === "boolean") {
		mergedOverrides.executeWorkflow = autoExecute;
	}

	const selectedProjects = await resolveProjectSelections({
		repoRoot,
		projects,
		selectAllProjects,
		includeRoot,
		maxDepth,
		ignore,
		limit,
	});
	if (selectedProjects?.length) {
		mergedOverrides.selectedProjects = selectedProjects;
	}

	const wizardOptions: DevWizardOptions = {
		...(devWizardOptions ?? {}),
		configPath: resolvedConfigPath,
		scenario: resolvedScenario,
	};

	if (Object.keys(mergedOverrides).length > 0) {
		wizardOptions.overrides = mergedOverrides;
	}

	return wizardOptions;
}

export async function createMaintenanceOptions(
	options: MaintenanceWizardOptions = {},
): Promise<DevWizardOptions> {
	const { configPath, presetSpecifier, scenarioId, overrides, devWizardOptions } = options;
	const {
		configPath: discardConfig,
		scenario: discardScenario,
		overrides: baseOverrides,
		...restWizardOptions
	} = devWizardOptions ?? {};
	void discardConfig;
	void discardScenario;

	const resolvedConfigPath =
		configPath ?? resolveMaintenancePresetPath(presetSpecifier ?? MAINTENANCE_PRESET_SPECIFIER);
	const resolvedScenario = scenarioId ?? MAINTENANCE_SCENARIO_ID;

	const mergedOverrides = Object.assign({}, baseOverrides ?? {}, overrides ?? {});

	return {
		...restWizardOptions,
		configPath: resolvedConfigPath,
		scenario: resolvedScenario,
		overrides: Object.keys(mergedOverrides).length > 0 ? mergedOverrides : undefined,
	};
}

async function resolveProjectSelections(options: {
	repoRoot: string;
	projects?: string[];
	selectAllProjects?: boolean;
	includeRoot?: boolean;
	maxDepth?: number;
	ignore?: string[];
	limit?: number;
}): Promise<string[] | undefined> {
	const normalizedProjects = options.projects ? dedupeStrings(options.projects) : [];
	if (normalizedProjects.length > 0) {
		return normalizedProjects;
	}

	if (!options.selectAllProjects) {
		return undefined;
	}

	const discovered = await listWorkspaceProjects({
		repoRoot: options.repoRoot,
		includeRoot: options.includeRoot ?? true,
		maxDepth: options.maxDepth ?? 3,
		ignore: options.ignore,
		limit: options.limit,
	});

	if (discovered.length === 0) {
		throw new WizardScriptError(
			`No workspace projects were found under ${options.repoRoot}. Provide explicit project identifiers or run from a repo containing package.json files.`,
		);
	}

	return discovered.map((project) => project.id);
}

function resolveProjectsPresetPath(specifier: string): string {
	try {
		return nodeRequire.resolve(specifier);
	} catch (error) {
		throw new WizardScriptError(
			`Failed to resolve projects preset "${specifier}". Ensure @dev-wizard/presets is installed or provide an explicit configPath.`,
			{ cause: error },
		);
	}
}

function resolveMaintenancePresetPath(specifier: string): string {
	try {
		return nodeRequire.resolve(specifier);
	} catch (error) {
		throw new WizardScriptError(
			`Failed to resolve maintenance preset "${specifier}". Ensure @dev-wizard/presets is installed or provide an explicit configPath.`,
			{ cause: error },
		);
	}
}

function dedupeStrings(values?: readonly string[]): string[] {
	if (!values) {
		return [];
	}

	const normalized = new Set<string>();
	for (const entry of values) {
		if (typeof entry !== "string") {
			continue;
		}
		const trimmed = entry.trim();
		if (trimmed.length === 0) {
			continue;
		}
		normalized.add(trimmed);
	}

	return Array.from(normalized);
}

export function defineWizardCommand(
	input: DefineWizardCommandInput,
): WizardScriptCommandDefinition {
	return {
		...input,
		args: [...(input.args ?? [])],
	};
}

export async function runWizardCommand(
	definition: WizardScriptCommandDefinition,
	options?: RunWizardCommandOptions,
): Promise<WizardScriptCommandResult> {
	const startedAt = new Date();
	const quiet = Boolean(options?.quiet);
	const dryRun = Boolean(options?.dryRun);
	const flowId = options?.flowId ?? definition.flowId ?? "script";
	const stepId = options?.stepId ?? definition.stepId ?? definition.id;
	const label =
		definition.label ??
		[definition.command, ...definition.args].filter(Boolean).join(" ");

	if (!quiet) {
		console.log(`▶ ${label}${dryRun ? " (dry run)" : ""}…`);
	}

	let stdout: string | undefined;
	let stderr: string | undefined;
	let exitCode: number | undefined;
	let error: Error | undefined;
	let success = true;

	if (!dryRun) {
		const execution = await execa(definition.command, definition.args, {
			cwd: definition.cwd,
			env: definition.env,
			shell: definition.shell ?? false,
			reject: false,
			stdio: ["inherit", "pipe", "pipe"],
		});
		stdout = execution.stdout || undefined;
		stderr = execution.stderr || undefined;
		exitCode = execution.exitCode ?? undefined;
		success = (execution.exitCode ?? 0) === 0 || Boolean(definition.allowFailure);
		if (!success) {
			error = execution.stderr
				? new Error(execution.stderr)
				: new Error(`Command "${label}" failed with exit code ${execution.exitCode}`);
		}
	} else {
		success = true;
		exitCode = 0;
	}

	const endedAt = new Date();
	const durationMs = Math.max(0, endedAt.getTime() - startedAt.getTime());

	if (!quiet) {
		const statusIcon = success ? "✓" : "✖";
		const baseMessage = `${statusIcon} ${label} (${formatDuration(durationMs)})`;
		if (success) {
			console.log(baseMessage);
		} else {
			const failureSuffix =
				typeof exitCode === "number" ? ` (exit ${exitCode})` : "";
			console.error(`${baseMessage}${failureSuffix}`);
		}

		if (stdout && !options?.redactOutput) {
			process.stdout.write(stdout);
			if (!stdout.endsWith("\n")) {
				process.stdout.write("\n");
			}
		}

		if (stderr && !options?.redactOutput) {
			process.stderr.write(stderr);
			if (!stderr.endsWith("\n")) {
				process.stderr.write("\n");
			}
		}

		if (
			typeof definition.warnAfterMs === "number" &&
			durationMs >= definition.warnAfterMs
		) {
			console.warn(
				`⚠ ${label} exceeded ${formatDuration(definition.warnAfterMs)} (took ${formatDuration(durationMs)}).`,
			);
		}
	}

	if (options?.logWriter) {
		options.logWriter.write({
			type: "command.result",
			flowId,
			stepId,
			command: [definition.command, ...definition.args].filter(Boolean).join(" "),
			cwd: definition.cwd,
			dryRun,
			success,
			exitCode,
			durationMs,
			stdout: options.redactOutput ? undefined : stdout,
			stderr: options.redactOutput ? undefined : stderr,
		});
	}

	return {
		definition,
		startedAt,
		endedAt,
		durationMs,
		exitCode,
		stdout,
		stderr,
		success,
		dryRun,
		error,
	};
}

export function createWizardTimer(): WizardTimer {
	return {
		start() {
			const startedAt = new Date();
			return {
				stop(): WizardTimerResult {
					const endedAt = new Date();
					return {
						startedAt,
						endedAt,
						durationMs: Math.max(0, endedAt.getTime() - startedAt.getTime()),
					};
				},
			};
		},
		async wrap<T>(work: () => Promise<T> | T): Promise<WizardTimerWrapResult<T>> {
			const handle = this.start();
			try {
				const result = await work();
				const timing = handle.stop();
				return {
					...timing,
					result,
				};
			} catch (error) {
				const timing = handle.stop();
				if (error && typeof error === "object" && !("timing" in error)) {
					Object.assign(error as Record<string, unknown>, { timing });
				}
				throw error;
			}
		},
	};
}

export function createRecommendationBuilder(
	options?: RecommendationBuilderOptions,
): WizardRecommendationBuilder {
	let summary = options?.summary;
	const commands: CommandRecommendationCommand[] = [];
	const links: CommandRecommendationLink[] = [];

	return {
		setSummary(value: string) {
			summary = value;
		},
		addCommand(command: string, entryOptions?: { label?: string }) {
			commands.push({
				command,
				label: entryOptions?.label,
			});
		},
		addLink(url: string, entryOptions?: { label?: string }) {
			links.push({
				url,
				label: entryOptions?.label,
			});
		},
		reset() {
			summary = options?.summary;
			commands.splice(0, commands.length);
			links.splice(0, links.length);
		},
		build(): WizardRecommendation {
			return {
				summary,
				commands: [...commands],
				links: [...links],
			};
		},
		format() {
			return formatRecommendation({
				summary,
				commands,
				links,
			});
		},
	};
}

export function formatRecommendation(
	recommendation: WizardRecommendation,
): string | undefined {
	const lines: string[] = [];
	const summary = recommendation.summary?.trim();
	if (summary) {
		lines.push(summary);
	}

	appendRecommendationSection(lines, "Commands", recommendation.commands);
	appendRecommendationSection(lines, "Links", recommendation.links);

	return lines.length > 0 ? lines.join("\n") : undefined;
}

function appendRecommendationSection(
	lines: string[],
	heading: string,
	entries: CommandRecommendationCommand[] | CommandRecommendationLink[],
): void {
	if (!Array.isArray(entries) || entries.length === 0) {
		return;
	}

	lines.push(`${heading}:`);
	for (const entry of entries) {
		if ("command" in entry) {
			const label = entry.label ?? entry.command;
			lines.push(`  - ${label}${entry.label ? `: ${entry.command}` : ""}`);
			continue;
		}

		if ("url" in entry) {
			const label = entry.label ?? entry.url;
			lines.push(`  - ${label}${entry.label ? `: ${entry.url}` : ""}`);
		}
	}
}

function formatDuration(durationMs: number): string {
	if (!Number.isFinite(durationMs)) {
		return "0ms";
	}

	if (durationMs < 1_000) {
		return `${durationMs}ms`;
	}

	if (durationMs < 60_000) {
		return `${(durationMs / 1_000).toFixed(1)}s`;
	}

	const minutes = Math.floor(durationMs / 60_000);
	const seconds = Math.round((durationMs % 60_000) / 1_000);
	return `${minutes}m ${seconds}s`;
}

export async function readJsonStdin<T = unknown>(
	options: ReadJsonStdinOptions<T> = {},
): Promise<T> {
	const stdin = options.stdin ?? process.stdin;
	const encoding = options.encoding ?? "utf8";
	let raw = "";

	for await (const chunk of stdin) {
		if (typeof chunk === "string") {
			raw += chunk;
		} else {
			raw += Buffer.from(chunk).toString(encoding);
		}
	}

	const trimmed = raw.trim();
	if (trimmed.length === 0) {
		if (options.allowEmpty) {
			return undefined as unknown as T;
		}
		throw new WizardScriptError(
			options.description
				? `${options.description} was not provided on stdin.`
				: "No JSON payload provided on stdin.",
		);
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(trimmed) as unknown;
	} catch (error) {
		throw new WizardScriptError(
			options.description
				? `Unable to parse ${options.description} JSON from stdin.`
				: "Unable to parse JSON payload from stdin.",
			{ cause: error },
		);
	}

	if (!options.schema) {
		return parsed as T;
	}

	try {
		return options.schema.parse(parsed);
	} catch (error) {
		if (error instanceof z.ZodError) {
			throw new WizardScriptError(formatZodError(options.description, error), {
				cause: error,
			});
		}
		throw error;
	}
}

export function writeJsonStdout(
	value: unknown,
	options: { stdout?: NodeJS.WritableStream; pretty?: number; appendNewline?: boolean } = {},
): void {
	const stdout = options.stdout ?? process.stdout;
	const pretty = options.pretty ?? 2;
	const serialized =
		pretty > 0 ? JSON.stringify(value, null, pretty) : JSON.stringify(value);
	const body =
		serialized === undefined ? String(value) : serialized;
	const suffix = options.appendNewline === false ? "" : "\n";
	stdout.write(`${body}${suffix}`);
}

export function parseScriptArgs<TSchema extends { parse: (input: unknown) => any }>(
	options: ParseScriptArgsOptions<TSchema>,
): ReturnType<TSchema["parse"]> {
	const argv = options.argv ? Array.from(options.argv) : process.argv.slice(2);
	const aliases = options.aliases ?? {};
	const normalized: Record<string, unknown> = {};
	const positionals: string[] = [];

	const resolveKey = (flag: string) => {
		const canonical = aliases[flag] ?? flag;
		return toCamelCase(canonical);
	};

	const assignValue = (key: string, value: unknown) => {
		const current = normalized[key];
		if (current === undefined) {
			normalized[key] = value;
		} else if (Array.isArray(current)) {
			normalized[key] = [...current, value];
		} else {
			normalized[key] = [current, value];
		}
	};

	for (let index = 0; index < argv.length; index += 1) {
		const token = argv[index]!;

		if (token === "--") {
			positionals.push(...argv.slice(index + 1));
			break;
		}

		if (!token.startsWith("-") || token === "-") {
			positionals.push(token);
			continue;
		}

		if (token.startsWith("--no-")) {
			const key = resolveKey(token.slice(5));
			assignValue(key, false);
			continue;
		}

		if (token.startsWith("--")) {
			const eqIndex = token.indexOf("=");
			let flag = token.slice(2);
			let rawValue: unknown = true;

			if (eqIndex !== -1) {
				flag = token.slice(2, eqIndex);
				rawValue = token.slice(eqIndex + 1);
			} else if (index + 1 < argv.length && !argv[index + 1]!.startsWith("-")) {
				rawValue = argv[index + 1];
				index += 1;
			}

			assignValue(resolveKey(flag), rawValue);
			continue;
		}

		const compact = token.replace(/^-+/, "");
		const key = resolveKey(compact);
		assignValue(key, true);
	}

	if (positionals.length > 0 && options.allowPositionals !== true) {
		throw new WizardScriptError(
			`Unexpected positional argument${positionals.length > 1 ? "s" : ""}: ${positionals.join(", ")}`,
		);
	}

	if (positionals.length > 0) {
		normalized.positionals ??= positionals;
	}

	try {
		return options.schema.parse(normalized);
	} catch (error) {
		if (error instanceof z.ZodError) {
			throw new WizardScriptError(formatZodError(options.description, error), {
				cause: error,
			});
		}
		throw error;
	}
}

export function handleScriptError(
	error: unknown,
	options: HandleScriptErrorOptions = {},
): void {
	const stderr = options.stderr ?? process.stderr;
	let scriptError: WizardScriptError;

	if (error instanceof WizardScriptError) {
		scriptError = error;
	} else if (error instanceof Error) {
		scriptError = new WizardScriptError(error.message, { cause: error });
	} else {
		scriptError = new WizardScriptError(String(error));
	}

	if (!process.exitCode || process.exitCode === 0) {
		process.exitCode = scriptError.exitCode;
	}

	const message = scriptError.message || "Script failed.";
	if (options.logger) {
		options.logger.error(message);
		const cause = (scriptError as Error & { cause?: unknown }).cause;
		if (cause instanceof Error && cause.message && cause.message !== message) {
			options.logger.error(cause.message);
		}
		return;
	}

	stderr.write(`${message}\n`);
	const cause = (scriptError as Error & { cause?: unknown }).cause;
	if (cause instanceof z.ZodError) {
		for (const issue of cause.issues) {
			stderr.write(` - ${issue.path.join(".") || "(root)"}: ${issue.message}\n`);
		}
	} else if (cause instanceof Error && cause.message && cause.message !== message) {
		stderr.write(`${cause.message}\n`);
	}
}

function formatZodError(description: string | undefined, error: z.ZodError): string {
	const header = description
		? `Invalid ${description} provided`
		: "Invalid input provided";
	const details = error.issues
		.map((issue) => {
			const path = issue.path.join(".") || "(root)";
			return `${path}: ${issue.message}`;
		})
		.join("; ");
	return `${header}: ${details}`;
}

function toCamelCase(flag: string): string {
	return flag
		.replace(/^-+/, "")
		.replace(/-([a-z0-9])/gi, (_, char: string) => char.toUpperCase());
}
