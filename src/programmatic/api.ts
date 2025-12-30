import path from "node:path";
import { Writable } from "node:stream";
import { resolveConfigPaths } from "../loader/configResolver.js";
import type { ConfigResolution } from "../loader/configResolver.js";
import { loadConfig } from "../loader/configLoader.js";
import type { DevWizardConfig } from "../loader/types";
import {
	describeWizard,
	type DevWizardDescription,
	type DescribeWizardOptions,
} from "../runtime/describe.js";
import {
	buildScenarioPlan,
	type ExecutorContext,
	type ScenarioPlan,
} from "../runtime/executor.js";
import {
	formatScenarioPlanJson,
	formatScenarioPlanNdjson,
	formatScenarioPlanPretty,
} from "../runtime/planFormatter.js";
import { createPolicyEngine } from "../runtime/policyEngine.js";
import {
	loadPlugins,
	type LoadPluginsResult,
} from "../runtime/plugins.js";
import { createPromptHistoryManager } from "../runtime/promptHistory.js";
import { NonInteractivePromptDriver } from "../runtime/promptDriver.js";

export interface LoadWizardOptions extends DescribeWizardOptions {
	environment?: string;
	repoRoot?: string;
}

export interface LoadWizardResult {
	config: DevWizardConfig;
	resolution: ConfigResolution;
	description: DevWizardDescription;
	repoRoot: string;
	pluginWarnings: string[];
	pluginRegistry: LoadPluginsResult["registry"];
}

export interface PlanScenarioOptions extends LoadWizardOptions {
	scenarioId: string;
	dryRun?: boolean;
	overrides?: Record<string, unknown>;
	quiet?: boolean;
	verbose?: boolean;
}

export interface CompilePlanOptions extends LoadWizardOptions {
	scenarioId: string;
	dryRun?: boolean;
	overrides?: Record<string, unknown>;
	quiet?: boolean;
	verbose?: boolean;
}

export interface PlanScenarioResult extends LoadWizardResult {
	plan: ScenarioPlan;
	prettyPlan: string;
	ndjsonPlan: string[];
	jsonPlan: string;
	targetMode: "dry-run" | "live";
}

export interface CompilePlanResult extends LoadWizardResult {
	plan: ScenarioPlan;
	targetMode: "dry-run" | "live";
}

export async function loadWizard(
	options: LoadWizardOptions = {},
): Promise<LoadWizardResult> {
	const cwd = options.cwd ? path.resolve(options.cwd) : process.cwd();
	const repoRoot = options.repoRoot ? path.resolve(options.repoRoot) : cwd;

	const resolution = await resolveConfigPaths({
		cwd,
		explicitPaths: options.configPath,
		environment: options.environment,
	});

	if (resolution.errors.length > 0 || resolution.paths.length === 0) {
		const message =
			resolution.errors[0] ??
			"No Dev Wizard configuration files were found for the supplied options.";
		throw new Error(message);
	}

	const config = await loadConfig({
		configPaths: resolution.paths,
		cwd,
	});

	const description = await describeWizard({
		configPath: resolution.paths,
		cwd,
	});

	const pluginResult = await loadPlugins(config.plugins, { repoRoot });

	return {
		config,
		resolution,
		description,
		repoRoot,
		pluginWarnings: pluginResult.warnings,
		pluginRegistry: pluginResult.registry,
	};
}

export async function planScenario(
	options: PlanScenarioOptions,
): Promise<PlanScenarioResult> {
	const compileResult = await compilePlan(options);
	const prettyPlan = formatScenarioPlanPretty(compileResult.plan);
	const ndjsonPlan = formatScenarioPlanNdjson(compileResult.plan);
	const jsonPlan = formatScenarioPlanJson(compileResult.plan);

	return {
		...compileResult,
		prettyPlan,
		ndjsonPlan,
		jsonPlan,
	};
}

export async function compilePlan(
	options: CompilePlanOptions,
): Promise<CompilePlanResult> {
	const {
		config,
		resolution,
		description,
		repoRoot,
		pluginWarnings,
		pluginRegistry,
	} = await loadWizard(options);

	const dryRun = options.dryRun ?? true;
	const quiet = options.quiet ?? true;
	const verbose = options.verbose ?? false;

	const promptHistory = createPromptHistoryManager();

	try {
		const context: ExecutorContext = {
			config,
			scenarioId: options.scenarioId,
			repoRoot,
			stdout: createNullWritable(),
			stderr: createNullWritable(),
			dryRun,
			quiet,
			verbose,
			promptDriver: new NonInteractivePromptDriver(),
			overrides: structuredClone(options.overrides ?? {}),
			logWriter: undefined,
			promptOptionsCache: new Map(),
			checkpoint: undefined,
			policy: createPolicyEngine({ config: config.policies }),
			plugins: pluginRegistry,
			promptHistory,
		};

		const plan = await buildScenarioPlan(context, {});

		return {
			config,
			resolution,
			description,
			repoRoot,
			pluginWarnings,
			pluginRegistry,
			plan,
			targetMode: dryRun ? "dry-run" : "live",
		};
	} finally {
		await promptHistory.close().catch(() => undefined);
	}
}

function createNullWritable(): Writable {
	return new Writable({
		write(_chunk, _encoding, callback) {
			callback();
		},
	});
}
