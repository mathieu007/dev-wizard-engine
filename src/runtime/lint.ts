import fs from "node:fs/promises";
import path from "node:path";
import { resolveConfigPaths } from "../loader/configResolver.js";
import type {
	ConfigResolution,
} from "../loader/configResolver.js";
import { loadConfig } from "../loader/configLoader.js";
import type {
	BranchStep,
	CommandStep,
	DevWizardConfig,
	DevWizardFlow,
	GitWorktreeGuardStep,
	GroupStep,
	IterateStep,
	PromptStep,
	PromptPersistConfig,
} from "../loader/types";
import { isPluginStep } from "./plugins.js";
import { ConfigSchemaError } from "../loader/parser.js";
import { parseOverrideValue, validatePromptValue } from "./promptValidation.js";

const INLINE_NODE_HEREDOC_PATTERN = /node\s+-\s*<<\s*['"]?DEV_WIZARD_NODE/iu;
const LEGACY_LIBRARY_SCRIPT_PATTERN =
	/packages[\/\\-]dev-wizard-core[\/\\]examples[\/\\]library[\/\\]scripts[\/\\]/u;

export interface LintCommandOptions {
	configPath?: string | string[];
	answersPath?: string;
	manifestPath?: string;
	scenarioId?: string;
	cwd?: string;
	environment?: string;
}

export interface LintIssue {
	level: "error" | "warning";
	message: string;
	detail?: string;
	file?: string;
}

export interface LintResult {
	cwd: string;
	resolution: ConfigResolution;
	issues: LintIssue[];
	config?: DevWizardConfig;
}

export async function lintWizard(
	options: LintCommandOptions = {},
): Promise<LintResult> {
	const cwd = options.cwd ? path.resolve(options.cwd) : process.cwd();
	const issues: LintIssue[] = [];
	const effectiveEnvironment = options.environment ?? process.env.DEV_WIZARD_ENV;

	const resolution = await resolveConfigPaths({
		cwd,
		explicitPaths: options.configPath,
		environment: effectiveEnvironment,
	});

	if (resolution.errors.length > 0) {
		for (const error of resolution.errors) {
			issues.push({
				level: "error",
				message: error,
			});
		}
	}

	if (resolution.paths.length === 0) {
		issues.push({
			level: "error",
			message:
				"No Dev Wizard configuration files were found. Provide --config <path> or add dev-wizard.config.* / dev-wizard-config/index.*",
		});
		return {
			cwd,
			resolution,
			issues,
		};
	}

	let config: DevWizardConfig | undefined;
	const configWarnings: string[] = [];

	try {
		config = await loadConfig({
			configPaths: resolution.paths,
			cwd,
			onWarning: (warning) => {
				configWarnings.push(warning);
			},
		});
	} catch (error) {
		if (error instanceof ConfigSchemaError) {
			for (const issue of error.issues) {
				issues.push({
					level: "error",
					message: issue.message,
					detail:
						issue.path.length > 0
							? `path: ${issue.path.join(".")}`
							: undefined,
					file: relativePath(error.filePath, cwd),
				});
			}
		} else {
			issues.push({
				level: "error",
				message: "Failed to load configuration.",
				detail: error instanceof Error ? error.message : String(error),
			});
		}

		return {
			cwd,
			resolution,
			issues,
		};
	}

	for (const warning of configWarnings) {
		issues.push({
			level: "warning",
			message: warning,
		});
	}

	runSemanticChecks({
		config,
		resolution,
		issues,
		cwd,
	});
	await validateAnswerArtifacts({
		config,
		cwd,
		issues,
		answersPath: options.answersPath,
		manifestPath: options.manifestPath,
		scenarioId: options.scenarioId,
	});

	return {
		cwd,
		resolution,
		issues,
		config,
	};
}

interface SemanticCheckContext {
	config: DevWizardConfig;
	resolution: ConfigResolution;
	issues: LintIssue[];
	cwd: string;
}

interface AnswerValidationContext {
	config: DevWizardConfig;
	cwd: string;
	issues: LintIssue[];
	answersPath?: string;
	manifestPath?: string;
	scenarioId?: string;
}

interface AnswersPayload {
	base: Record<string, unknown>;
	perProject?: Record<string, Record<string, unknown>>;
	scenarioId?: string;
}

function runSemanticChecks({
	config,
	resolution,
	issues,
	cwd,
}: SemanticCheckContext) {
	if (config.scenarios.length === 0) {
		issues.push({
			level: "warning",
			message: "No scenarios defined. The wizard will have nothing to run.",
		});
	}

	const flowIds = new Set(Object.keys(config.flows));
	const flowGraph = buildFlowGraph(config);
	const flowStepIds = buildFlowStepIndex(config);
	const referencedFlows = new Set<string>();
	const usedPresets = new Set<string>();
	const definedPresets = new Set(Object.keys(config.commandPresets ?? {}));

	for (const scenario of config.scenarios) {
		referencedFlows.add(scenario.flow);
		if (!flowIds.has(scenario.flow)) {
			issues.push({
				level: "error",
				message: `Scenario "${scenario.id}" references unknown flow "${scenario.flow}".`,
				file: relativePath(resolution.paths[0], cwd),
			});
		}

		if (scenario.flows) {
			for (const chained of scenario.flows) {
				referencedFlows.add(chained);
				if (!flowIds.has(chained)) {
					issues.push({
						level: "error",
						message: `Scenario "${scenario.id}" chain references unknown flow "${chained}".`,
						file: relativePath(resolution.paths[0], cwd),
					});
				}
			}
		}

		if (scenario.postRun) {
			for (const hook of scenario.postRun) {
				referencedFlows.add(hook.flow);
				if (!flowIds.has(hook.flow)) {
					issues.push({
						level: "error",
						message: `Scenario "${scenario.id}" postRun references unknown flow "${hook.flow}".`,
						file: relativePath(resolution.paths[0], cwd),
					});
				}
			}
		}
	}

	for (const [flowId, flow] of Object.entries(config.flows)) {
		for (const step of flow.steps) {
			if (isPluginStep(step)) {
				continue;
			}
			if (step.type === "group") {
				referencedFlows.add(step.flow);
				validateGroupStep(step, flowId, flow, flowIds, issues, cwd, resolution);
			} else if (step.type === "iterate") {
				referencedFlows.add(step.flow);
				validateIterateStep(step, flowId, flowIds, issues, cwd, resolution);
			} else if (step.type === "prompt") {
				validatePromptStep(step, flowId, issues, cwd, resolution);
			} else if (step.type === "branch") {
				validateBranchStep(step, flowId, flowStepIds.get(flowId) ?? new Set(), issues, cwd, resolution);
			} else if (step.type === "command") {
				validateCommandStep(step, config, flowId, issues, cwd, resolution, usedPresets);
			} else if (step.type === "git-worktree-guard") {
				validateGitWorktreeGuardStep(step, flowId, issues, cwd, resolution);
			}
		}
	}

	const reachableFlows = computeReachableFlows(referencedFlows, flowGraph);

	for (const flowId of flowIds) {
		if (!reachableFlows.has(flowId)) {
			issues.push({
				level: "warning",
				message: `Flow "${flowId}" is not referenced by any scenario or step.`,
				file: relativePath(resolution.paths[0], cwd),
			});
		}
	}

	for (const preset of definedPresets) {
		if (!usedPresets.has(preset)) {
			issues.push({
				level: "warning",
				message: `Command preset "${preset}" is defined but never used.`,
				file: relativePath(resolution.paths[0], cwd),
			});
		}
	}
}

async function validateAnswerArtifacts({
	config,
	cwd,
	issues,
	answersPath,
	manifestPath,
	scenarioId,
}: AnswerValidationContext): Promise<void> {
	if (!answersPath && !manifestPath) {
		return;
	}

	if (answersPath && manifestPath) {
		issues.push({
			level: "error",
			message: "Provide only one of --answers or --manifest when running lint.",
		});
		return;
	}

	if (answersPath === "-") {
		issues.push({
			level: "error",
			message: "Lint does not support reading answers from stdin. Provide a file path.",
		});
		return;
	}

	if (manifestPath === "-") {
		issues.push({
			level: "error",
			message: "Lint does not support reading manifests from stdin. Provide a file path.",
		});
		return;
	}

	if (manifestPath) {
		await validateManifestAnswers({
			config,
			cwd,
			issues,
			manifestPath,
			scenarioId,
		});
		return;
	}

	if (!answersPath) {
		return;
	}

	await validateAnswersFile({
		config,
		cwd,
		issues,
		answersPath,
		scenarioId,
	});
}

async function validateManifestAnswers({
	config,
	cwd,
	issues,
	manifestPath,
	scenarioId,
}: {
	config: DevWizardConfig;
	cwd: string;
	issues: LintIssue[];
	manifestPath: string;
	scenarioId?: string;
}): Promise<void> {
	const resolvedPath = path.isAbsolute(manifestPath)
		? manifestPath
		: path.resolve(cwd, manifestPath);
	const file = relativePath(resolvedPath, cwd);
	let raw: string;

	try {
		raw = await fs.readFile(resolvedPath, "utf8");
	} catch (error) {
		issues.push({
			level: "error",
			message: `Failed to read manifest file at ${resolvedPath}.`,
			detail: error instanceof Error ? error.message : String(error),
			file,
		});
		return;
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (error) {
		issues.push({
			level: "error",
			message: `Manifest file ${resolvedPath} is not valid JSON.`,
			detail: error instanceof Error ? error.message : String(error),
			file,
		});
		return;
	}

	if (!isRecord(parsed)) {
		issues.push({
			level: "error",
			message: "Manifest payload must be an object.",
			file,
		});
		return;
	}

	const manifestScenarioId = typeof parsed.scenarioId === "string" ? parsed.scenarioId : undefined;
	const schemaVersion = parsed.schemaVersion;
	if (schemaVersion !== 1) {
		issues.push({
			level: "error",
			message: `Unsupported manifest schema version ${String(schemaVersion)} (expected 1).`,
			file,
		});
		return;
	}

	const answers = parsed.answers;
	if (!isRecord(answers)) {
		issues.push({
			level: "error",
			message: "Manifest answers must be an object.",
			file,
		});
		return;
	}

	if (scenarioId && manifestScenarioId && scenarioId !== manifestScenarioId) {
		issues.push({
			level: "error",
			message: `Manifest scenarioId "${manifestScenarioId}" does not match --scenario "${scenarioId}".`,
			file,
		});
	}

	const resolvedScenarioId =
		scenarioId ?? manifestScenarioId ?? (config.scenarios.length === 1 ? config.scenarios[0]?.id : undefined);
	if (!resolvedScenarioId) {
		issues.push({
			level: "error",
			message:
				"Unable to determine scenario for manifest validation. Provide --scenario or ensure the manifest includes scenarioId.",
			file,
		});
		return;
	}

	validateAnswersAgainstScenario({
		config,
		scenarioId: resolvedScenarioId,
		answers,
		issues,
		file,
	});
}

async function validateAnswersFile({
	config,
	cwd,
	issues,
	answersPath,
	scenarioId,
}: {
	config: DevWizardConfig;
	cwd: string;
	issues: LintIssue[];
	answersPath: string;
	scenarioId?: string;
}): Promise<void> {
	const resolvedPath = path.isAbsolute(answersPath)
		? answersPath
		: path.resolve(cwd, answersPath);
	const file = relativePath(resolvedPath, cwd);
	let raw: string;

	try {
		raw = await fs.readFile(resolvedPath, "utf8");
	} catch (error) {
		issues.push({
			level: "error",
			message: `Failed to read answers file at ${resolvedPath}.`,
			detail: error instanceof Error ? error.message : String(error),
			file,
		});
		return;
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (error) {
		issues.push({
			level: "error",
			message: `Answers file ${resolvedPath} is not valid JSON.`,
			detail: error instanceof Error ? error.message : String(error),
			file,
		});
		return;
	}

	if (!isRecord(parsed)) {
		issues.push({
			level: "error",
			message: "Answers payload must be an object.",
			file,
		});
		return;
	}

	const payload = extractAnswersPayload(parsed);
	if (scenarioId && payload.scenarioId && scenarioId !== payload.scenarioId) {
		issues.push({
			level: "error",
			message: `Answers metadata scenarioId "${payload.scenarioId}" does not match --scenario "${scenarioId}".`,
			file,
		});
	}

	const resolvedScenarioId =
		scenarioId ?? payload.scenarioId ?? (config.scenarios.length === 1 ? config.scenarios[0]?.id : undefined);
	if (!resolvedScenarioId) {
		issues.push({
			level: "error",
			message:
				"Unable to determine scenario for answers validation. Provide --scenario or include meta.scenarioId in the answers file.",
			file,
		});
		return;
	}

	validateAnswersAgainstScenario({
		config,
		scenarioId: resolvedScenarioId,
		answers: payload.base,
		perProject: payload.perProject,
		issues,
		file,
	});
}

function validateAnswersAgainstScenario({
	config,
	scenarioId,
	answers,
	perProject,
	issues,
	file,
}: {
	config: DevWizardConfig;
	scenarioId: string;
	answers: Record<string, unknown>;
	perProject?: Record<string, Record<string, unknown>>;
	issues: LintIssue[];
	file?: string;
}): void {
	const scenario = config.scenarios.find((item) => item.id === scenarioId);
	if (!scenario) {
		issues.push({
			level: "error",
			message: `Unknown scenario "${scenarioId}" referenced by answers.`,
			file,
		});
		return;
	}

	const flowGraph = buildFlowGraph(config);
	const startFlows = new Set<string>([scenario.flow]);
	for (const flow of scenario.flows ?? []) {
		startFlows.add(flow);
	}
	for (const hook of scenario.postRun ?? []) {
		startFlows.add(hook.flow);
	}
	const reachableFlows = computeReachableFlows(startFlows, flowGraph);

	const promptSteps: Array<{ flowId: string; step: PromptStep }> = [];
	const commandSteps: Array<{ flowId: string; step: CommandStep }> = [];
	for (const flowId of reachableFlows) {
		const flow = config.flows[flowId];
		if (!flow) {
			continue;
		}
		for (const step of flow.steps) {
			if (isPluginStep(step)) {
				continue;
			}
			if (step.type === "prompt") {
				promptSteps.push({ flowId, step });
			} else if (step.type === "command") {
				commandSteps.push({ flowId, step });
			}
		}
	}

	for (const { flowId, step } of promptSteps) {
		const key = step.storeAs ?? step.id;
		const required = step.required ?? false;
		const hasValue = Object.prototype.hasOwnProperty.call(answers, key);
		if (!hasValue && required && step.defaultValue === undefined) {
			issues.push({
				level: "error",
				message: `Missing required answer for prompt "${step.id}" (key "${key}") in flow "${flowId}".`,
				file,
			});
			continue;
		}
		if (!hasValue) {
			continue;
		}
		const rawValue = answers[key];
		try {
			const parsed = parseOverrideValue(step, rawValue);
			validatePromptValue(step, parsed);
		} catch (error) {
			issues.push({
				level: "error",
				message: `Invalid answer for prompt "${step.id}" (key "${key}") in flow "${flowId}".`,
				detail: error instanceof Error ? error.message : String(error),
				file,
			});
		}
	}

	if (perProject) {
		for (const [projectId, projectAnswers] of Object.entries(perProject)) {
			if (!projectAnswers || typeof projectAnswers !== "object") {
				continue;
			}
			for (const { flowId, step } of promptSteps) {
				if (!isProjectScopedPrompt(step)) {
					continue;
				}
				const key = step.storeAs ?? step.id;
				if (!Object.prototype.hasOwnProperty.call(projectAnswers, key)) {
					continue;
				}
				const rawValue = projectAnswers[key];
				try {
					const parsed = parseOverrideValue(step, rawValue);
					validatePromptValue(step, parsed);
				} catch (error) {
					issues.push({
						level: "error",
						message:
							`Invalid answer for prompt "${step.id}" (key "${key}")` +
							` in project "${projectId}" (flow "${flowId}").`,
						detail: error instanceof Error ? error.message : String(error),
						file,
					});
				}
			}
		}
	}

	for (const { flowId, step } of commandSteps) {
		const policy = step.onError?.policy;
		if (!policy) {
			continue;
		}
		const required = policy.required ?? true;
		const rawValue = resolveAnswerPath(answers, policy.key);
		if (rawValue === undefined || rawValue === null || rawValue === "") {
			if (required) {
				issues.push({
					level: "error",
					message: `Missing policy answer for "${policy.key}" required by step "${step.id}" (flow "${flowId}").`,
					file,
				});
			}
			continue;
		}
		const value = String(rawValue);
		const target = policy.map[value] ?? policy.default;
		if (!target) {
			const allowed = Object.keys(policy.map).join(", ");
			issues.push({
				level: "error",
				message:
					`Policy value "${value}" for "${policy.key}" is not mapped in step "${step.id}" (flow "${flowId}").`,
				detail: allowed.length > 0 ? `Allowed values: ${allowed}` : undefined,
				file,
			});
		}
	}
}

function extractAnswersPayload(payload: Record<string, unknown>): AnswersPayload {
	const meta = payload.meta;
	const scenarioId =
		meta && typeof meta === "object" && typeof (meta as Record<string, unknown>).scenarioId === "string"
			? String((meta as Record<string, unknown>).scenarioId)
			: undefined;

	if (
		Object.prototype.hasOwnProperty.call(payload, "scenario") ||
		Object.prototype.hasOwnProperty.call(payload, "projects")
	) {
		const scenario = payload.scenario;
		const projects = payload.projects;
		return {
			base: isRecord(scenario) ? scenario : {},
			perProject: isRecordOfRecords(projects) ? projects : undefined,
			scenarioId,
		};
	}

	if (
		Object.prototype.hasOwnProperty.call(payload, "base") ||
		Object.prototype.hasOwnProperty.call(payload, "perProject") ||
		Object.prototype.hasOwnProperty.call(payload, "exists")
	) {
		const base = payload.base;
		const perProject = payload.perProject;
		return {
			base: isRecord(base) ? base : {},
			perProject: isRecordOfRecords(perProject) ? perProject : undefined,
			scenarioId,
		};
	}

	return {
		base: payload,
		perProject: isRecordOfRecords(payload.perProject) ? payload.perProject : undefined,
		scenarioId,
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isRecordOfRecords(value: unknown): value is Record<string, Record<string, unknown>> {
	if (!isRecord(value)) {
		return false;
	}
	for (const entry of Object.values(value)) {
		if (!isRecord(entry)) {
			return false;
		}
	}
	return true;
}

function resolveAnswerPath(
	answers: Record<string, unknown>,
	pathKey: string,
): unknown {
	if (!pathKey.includes(".")) {
		return answers[pathKey];
	}
	let current: unknown = answers;
	for (const segment of pathKey.split(".")) {
		if (!segment) {
			continue;
		}
		if (!current || typeof current !== "object") {
			return undefined;
		}
		current = (current as Record<string, unknown>)[segment];
	}
	return current;
}

function isProjectScopedPrompt(step: PromptStep): boolean {
	const config = getPromptPersistConfig(step);
	return config?.scope === "project";
}

function getPromptPersistConfig(step: PromptStep): PromptPersistConfig | undefined {
	if (step.persist === false) {
		return undefined;
	}
	if (step.persist && typeof step.persist === "object") {
		return step.persist;
	}
	return {};
}

function validateGroupStep(
	step: GroupStep,
	flowId: string,
	flow: DevWizardFlow,
	flowIds: Set<string>,
	issues: LintIssue[],
	cwd: string,
	resolution: ConfigResolution,
) {
	if (!flowIds.has(step.flow)) {
		issues.push({
			level: "error",
			message: `Flow "${flowId}" includes unknown group flow "${step.flow}" (step "${step.id}").`,
			file: relativePath(resolution.paths[0], cwd),
		});
	}
}

function validateIterateStep(
	step: IterateStep,
	flowId: string,
	flowIds: Set<string>,
	issues: LintIssue[],
	cwd: string,
	resolution: ConfigResolution,
) {
	if (!flowIds.has(step.flow)) {
		issues.push({
			level: "error",
			message: `Flow "${flowId}" iterate step "${step.id}" references unknown flow "${step.flow}".`,
			file: relativePath(resolution.paths[0], cwd),
		});
	}

	if (step.items === undefined && step.source === undefined) {
		issues.push({
			level: "warning",
			message: `Iterate step "${step.id}" in flow "${flowId}" has no items or source to iterate.`,
			file: relativePath(resolution.paths[0], cwd),
		});
	}

	if (step.source?.from === "dynamic" && step.source.dynamic.type === "command") {
		issues.push({
			level: "error",
			message: `Iterate step "${step.id}" in flow "${flowId}" uses dynamic.command, which is not allowed. Replace it with a compute handler or a built-in dynamic provider.`,
			file: relativePath(resolution.paths[0], cwd),
		});
	}
}

function validatePromptStep(
	step: PromptStep,
	flowId: string,
	issues: LintIssue[],
	cwd: string,
	resolution: ConfigResolution,
) {
	if (
		(step.mode === "select" || step.mode === "multiselect") &&
		(!step.options || step.options.length === 0) &&
		!step.dynamic
	) {
		issues.push({
			level: "warning",
			message: `Prompt "${step.id}" in flow "${flowId}" has mode "${step.mode}" but no options or dynamic source.`,
			file: relativePath(resolution.paths[0], cwd),
		});
	}

	if (step.dynamic?.type === "command") {
		issues.push({
			level: "error",
			message: `Prompt step "${step.id}" in flow "${flowId}" uses dynamic.command, which is not allowed. Replace it with a compute handler or a built-in dynamic provider.`,
			file: relativePath(resolution.paths[0], cwd),
		});
	}
}

function validateBranchStep(
	step: BranchStep,
	flowId: string,
	stepIds: Set<string>,
	issues: LintIssue[],
	cwd: string,
	resolution: ConfigResolution,
) {
	for (const branch of step.branches) {
		if (!isSpecialTarget(branch.next) && !stepIds.has(branch.next)) {
			issues.push({
				level: "error",
				message: `Branch step "${step.id}" in flow "${flowId}" targets unknown step "${branch.next}".`,
				file: relativePath(resolution.paths[0], cwd),
			});
		}
	}

	if (step.defaultNext && !isSpecialTarget(step.defaultNext.next) && !stepIds.has(step.defaultNext.next)) {
		issues.push({
			level: "error",
			message: `Branch step "${step.id}" in flow "${flowId}" default transition references unknown step "${step.defaultNext.next}".`,
			file: relativePath(resolution.paths[0], cwd),
		});
	}
}

function validateCommandStep(
	step: CommandStep,
	config: DevWizardConfig,
	flowId: string,
	issues: LintIssue[],
	cwd: string,
	resolution: ConfigResolution,
	usedPresets: Set<string>,
) {
	const presets = config.commandPresets ?? {};
	const topLevelPath = resolution.paths[0];
	const file = relativePath(topLevelPath, cwd);
	const stepPresetName = step.defaults?.preset;
	if (stepPresetName) {
		const preset = presets[stepPresetName];
		if (preset) {
			if (
				step.defaults?.shell !== undefined &&
				preset.shell !== undefined &&
				step.defaults.shell !== preset.shell
			) {
				issues.push({
					level: "warning",
					message: `Command step "${step.id}" in flow "${flowId}" overrides preset "${stepPresetName}" field "shell" (${preset.shell} → ${step.defaults.shell}).`,
					file,
				});
			}

			if (
				step.defaults?.cwd !== undefined &&
				preset.cwd !== undefined &&
				step.defaults.cwd !== preset.cwd
			) {
				issues.push({
					level: "warning",
					message: `Command step "${step.id}" in flow "${flowId}" overrides preset "${stepPresetName}" field "cwd" (${preset.cwd} → ${step.defaults.cwd}).`,
					file,
				});
			}
		}
	}

	for (const command of step.commands) {
		if (command.preset) {
			if (!presets[command.preset]) {
				issues.push({
					level: "error",
					message: `Command step "${step.id}" in flow "${flowId}" references unknown preset "${command.preset}".`,
					file: relativePath(resolution.paths[0], cwd),
				});
			} else {
				usedPresets.add(command.preset);

				const preset = presets[command.preset];
				if (
					command.shell !== undefined &&
					preset.shell !== undefined &&
					command.shell !== preset.shell
				) {
					issues.push({
						level: "warning",
						message: `Command "${command.run}" in step "${step.id}" overrides preset "${command.preset}" field "shell" (${preset.shell} → ${command.shell}).`,
						file,
					});
				}

				if (
					command.cwd !== undefined &&
					preset.cwd !== undefined &&
					command.cwd !== preset.cwd
				) {
					issues.push({
						level: "warning",
						message: `Command "${command.run}" in step "${step.id}" overrides preset "${command.preset}" field "cwd" (${preset.cwd} → ${command.cwd}).`,
						file,
					});
				}
			}
		}

		if (INLINE_NODE_HEREDOC_PATTERN.test(command.run)) {
			issues.push({
				level: "warning",
				message: `Command step "${step.id}" in flow "${flowId}" embeds inline heredoc Node logic. Extract it into a reusable script (see packages/dev-wizard-core/docs/dev-wizard.md#lean-yaml-roadmap).`,
				file,
			});
		}

		if (LEGACY_LIBRARY_SCRIPT_PATTERN.test(command.run)) {
			issues.push({
				level: "warning",
				message: `Command step "${step.id}" in flow "${flowId}" references packages/dev-wizard-core/examples/library/scripts/* which are no longer shipped here. Update the command to call '@dev-wizard/presets/scripts/*' instead.`,
				file,
			});
		}
	}

	if (step.onError?.actions && step.onError.actions.length > 0 && !step.onError.policy) {
		issues.push({
			level: "error",
			message: `Command step "${step.id}" in flow "${flowId}" defines onError.actions without an onError.policy. Add a policy mapping to keep unattended runs deterministic.`,
			file,
		});
	}
}

function validateGitWorktreeGuardStep(
	step: GitWorktreeGuardStep,
	flowId: string,
	issues: LintIssue[],
	cwd: string,
	resolution: ConfigResolution,
) {
	const options = {
		commit: step.allowCommit ?? true,
		stash: step.allowStash ?? true,
		proceed: step.allowProceed ?? false,
	};

	if (!options.commit && !options.stash && !options.proceed) {
		issues.push({
			level: "error",
			message: `Git worktree guard step "${step.id}" in flow "${flowId}" disables all strategies (commit, stash, proceed). Enable at least one strategy.`,
			file: relativePath(resolution.paths[0], cwd),
		});
	}
}

export function formatLintResult(
	result: LintResult,
	format: "json" | "pretty",
): string {
	if (format === "json") {
		return `${JSON.stringify(result, null, 2)}\n`;
	}

	const lines: string[] = [];

	lines.push("Discovery diagnostics:");
	if (result.resolution.diagnostics.length === 0) {
		lines.push("- (none)");
	} else {
		for (const diagnostic of result.resolution.diagnostics) {
			lines.push(`- ${diagnostic}`);
		}
	}

	lines.push("");
	if (result.issues.length === 0) {
		lines.push("Issues: none 🎉");
	} else {
		lines.push("Issues:");
		for (const issue of result.issues) {
			const location = issue.file ? ` (${issue.file})` : "";
			const detail = issue.detail ? ` — ${issue.detail}` : "";
			lines.push(`- [${issue.level}] ${issue.message}${location}${detail}`);
		}
	}

	return `${lines.join("\n")}\n`;
}

function relativePath(target: string | undefined, cwd: string): string | undefined {
	if (!target) {
		return undefined;
	}
	const relative = path.relative(cwd, target);
	return relative && !relative.startsWith("..") ? relative : target;
}

function buildFlowGraph(config: DevWizardConfig): Map<string, Set<string>> {
	const graph = new Map<string, Set<string>>();
	for (const [flowId, flow] of Object.entries(config.flows)) {
		const edges = new Set<string>();
		for (const step of flow.steps) {
			if (isPluginStep(step)) {
				continue;
			}
			if (step.type === "group" || step.type === "iterate") {
				edges.add(step.flow);
			}
		}
		graph.set(flowId, edges);
	}
	return graph;
}

function buildFlowStepIndex(config: DevWizardConfig): Map<string, Set<string>> {
	const map = new Map<string, Set<string>>();
	for (const [flowId, flow] of Object.entries(config.flows)) {
		map.set(
			flowId,
			new Set(flow.steps.map((step) => step.id)),
		);
	}
	return map;
}

function computeReachableFlows(
	initial: Set<string>,
	graph: Map<string, Set<string>>,
): Set<string> {
	const reachable = new Set<string>();
	const queue: string[] = [];
	for (const flowId of initial) {
		if (!reachable.has(flowId)) {
			reachable.add(flowId);
			queue.push(flowId);
		}
	}

	while (queue.length > 0) {
		const flowId = queue.shift()!;
		const neighbors = graph.get(flowId);
		if (!neighbors) continue;
		for (const neighbor of neighbors) {
			if (!reachable.has(neighbor)) {
				reachable.add(neighbor);
				queue.push(neighbor);
			}
		}
	}

	return reachable;
}

function isSpecialTarget(target: string): boolean {
	return target === "exit" || target === "repeat";
}
