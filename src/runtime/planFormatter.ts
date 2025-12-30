import chalk from "chalk";
import type { ScenarioPlan, PlanEvent, PlanPreferences } from "./executor";

interface FormatOptions {
	indent?: number;
	preferences: PlanPreferences;
}

const DEFAULT_PLAN_PREFERENCES: PlanPreferences = {
	expandEnv: false,
	expandTemplates: false,
	expandBranches: false,
};

export function formatScenarioPlanPretty(
	plan: ScenarioPlan,
): string {
	const lines: string[] = [];
	const preferences = plan.preferences ?? DEFAULT_PLAN_PREFERENCES;
	const title = `${plan.scenarioLabel} (${plan.scenarioId}) — target mode: ${plan.targetMode}`;
	lines.push(chalk.bold(title));

	if (plan.overrides.length > 0) {
		lines.push("");
		lines.push(chalk.cyan("Overrides:"));
		for (const entry of plan.overrides) {
			lines.push(`  ${entry.key} = ${formatValue(entry.value)} (${entry.source})`);
		}
	}

	if (plan.warnings.length > 0) {
		lines.push("");
		lines.push(chalk.yellow("Warnings:"));
		for (const warning of plan.warnings) {
			lines.push(`  • ${warning}`);
		}
	}

	if (plan.pendingPromptCount > 0) {
		lines.push("");
		lines.push(
			chalk.yellow(
				`${plan.pendingPromptCount} prompt${plan.pendingPromptCount === 1 ? "" : "s"} require interactive input.`,
			),
		);
	}

	for (const flow of plan.flows) {
		lines.push("");
		const flowHeader = flow.label
			? `${flow.label} (${flow.id})`
			: flow.id;
		lines.push(chalk.magenta(`Flow: ${flowHeader}`));
		if (flow.description) {
			lines.push(indent(flow.description));
		}

		for (const step of flow.steps) {
			formatStep(lines, step, { indent: 2, preferences });
		}
	}

	return `${lines.join("\n")}\n`;
}

export function formatScenarioPlanNdjson(plan: ScenarioPlan): string[] {
	const events: PlanEvent[] = [...plan.events];
	const preferences = plan.preferences ?? DEFAULT_PLAN_PREFERENCES;
	events.push({
		type: "plan.preferences",
		data: {
			expandEnv: preferences.expandEnv,
			expandTemplates: preferences.expandTemplates,
			expandBranches: preferences.expandBranches,
		},
	});
	events.push({
		type: "plan.summary",
		data: {
			warnings: plan.warnings,
			pendingPromptCount: plan.pendingPromptCount,
		},
	});
	return events.map((event) =>
		JSON.stringify({
			type: event.type,
			flowId: event.flowId,
			stepId: event.stepId,
			data: event.data,
		}),
	);
}

export function formatScenarioPlanJson(plan: ScenarioPlan): string {
	return `${JSON.stringify(plan, null, 2)}\n`;
}

function formatStep(lines: string[], step: any, options: FormatOptions): void {
	switch (step.kind) {
		case "command":
			formatCommandStep(lines, step, options);
			break;
		case "prompt":
			formatPromptStep(lines, step, options);
			break;
	case "branch":
		formatBranchStep(lines, step, options);
		break;
	case "message":
		formatMessageStep(lines, step, options);
		break;
	case "git-worktree-guard":
		formatGitWorktreeGuardStep(lines, step, options);
		break;
		case "group":
			formatGroupStep(lines, step, options);
			break;
		case "iterate":
			formatIterateStep(lines, step, options);
			break;
		case "compute":
			formatComputeStep(lines, step, options);
			break;
		case "plugin":
			formatPluginStep(lines, step, options);
			break;
		default:
			lines.push(indent(`- ${step.id} (${step.kind})`, options.indent));
	}
}

function formatCommandStep(lines: string[], step: any, options: FormatOptions): void {
	const header = step.label ? `${step.label} (${step.id})` : step.id;
	const baseIndent = options.indent ?? 0;
	const showTemplates = options.preferences.expandTemplates;
	const showEnvDiffs = options.preferences.expandEnv;
	lines.push(indent(`- [command] ${header}`, baseIndent));
	if (step.description) {
		lines.push(indent(step.description, baseIndent + 2));
	}

	for (const command of step.commands) {
		lines.push(indent(`• ${command.run}`, baseIndent + 2));
		const metadata: string[] = [];
		if (command.cwd) {
			metadata.push(`cwd: ${command.cwd}`);
		}
		if (command.shell !== undefined) {
			metadata.push(`shell: ${command.shell}`);
		}
		if (command.warnAfterMs !== undefined) {
			metadata.push(`warnAfterMs: ${command.warnAfterMs}`);
		}
		if (command.continueOnFail) {
			metadata.push(`continueOnFail: true`);
		}
		if (command.preset) {
			metadata.push(`preset: ${command.preset}`);
		}
		if (command.storeStdoutAs) {
			metadata.push(`storeStdoutAs: ${command.storeStdoutAs}`);
		}
		if (command.parseJson !== undefined) {
			metadata.push(`parseJson: ${formatValue(command.parseJson)}`);
		}
		if (command.summary) {
			metadata.push(`summary: ${command.summary}`);
		}
		if (showTemplates && metadata.length > 0) {
			for (const entry of metadata) {
				lines.push(indent(entry, baseIndent + 4));
			}
		} else if (!showTemplates && metadata.length > 0) {
			lines.push(
				indent(
					"details: (hidden — use --plan-expand templates)",
					baseIndent + 4,
				),
			);
		}

		if (command.envDiff && command.envDiff.length > 0) {
			if (showEnvDiffs) {
				lines.push(indent(`env:`, baseIndent + 4));
				for (const diff of command.envDiff) {
					const previous = diff.previous ? ` (previous: ${diff.previous})` : "";
					lines.push(
						indent(
							`${diff.key}=${diff.value} [${diff.source}]${previous}`,
							baseIndent + 6,
						),
					);
				}
			} else {
				lines.push(
					indent(
						"env diffs: (hidden — use --plan-expand env)",
						baseIndent + 4,
					),
				);
			}
		}
	}
}

function formatPromptStep(lines: string[], step: any, options: FormatOptions): void {
	const header = step.label ? `${step.label} (${step.id})` : step.id;
	const baseIndent = options.indent ?? 0;
	lines.push(indent(`- [prompt:${step.mode}] ${header}`, baseIndent));
	lines.push(indent(`question: ${step.prompt}`, baseIndent + 2));
	if (step.answerSource === "override") {
		lines.push(indent(`answer: ${formatValue(step.answer)} (override)`, baseIndent + 2));
	} else if (step.answerSource === "default") {
		lines.push(indent(`default answer: ${formatValue(step.answer)}`, baseIndent + 2));
	} else if (step.answerSource === "persisted") {
		lines.push(indent(`answer: ${formatValue(step.answer)} (persisted)`, baseIndent + 2));
	} else {
		lines.push(indent(`answer: <required at runtime>`, baseIndent + 2));
	}
	if (step.options && step.options.length > 0) {
		lines.push(indent(`options:`, baseIndent + 2));
		for (const option of step.options) {
			const hint = option.hint ? ` — ${option.hint}` : "";
			lines.push(indent(`• ${option.label} (${option.value})${hint}`, baseIndent + 4));
		}
	}
	if (step.dynamic) {
		lines.push(indent(`options resolved dynamically at runtime`, baseIndent + 2));
	}
}

function formatBranchStep(lines: string[], step: any, options: FormatOptions): void {
	const header = step.label ? `${step.label} (${step.id})` : step.id;
	const baseIndent = options.indent ?? 0;
	lines.push(indent(`- [branch] ${header}`, baseIndent));
	if (options.preferences.expandBranches) {
		for (const branch of step.branches) {
			lines.push(
				indent(
					`• ${branch.expression} → ${branch.target} [${branch.result ? "true" : "false"}]`,
					baseIndent + 2,
				),
			);
		}
	} else if (step.branches?.length) {
		lines.push(
			indent(
				"branch rationales: (hidden — use --plan-expand branches)",
				baseIndent + 2,
			),
		);
	}
	if (step.defaultTarget) {
		lines.push(indent(`default → ${step.defaultTarget}`, baseIndent + 2));
	}
	if (step.selectedTarget) {
		lines.push(indent(`selected → ${step.selectedTarget}`, baseIndent + 2));
	}
}

function formatMessageStep(lines: string[], step: any, options: FormatOptions): void {
	const header = step.label ? `${step.label} (${step.id})` : step.id;
	const baseIndent = options.indent ?? 0;
	lines.push(indent(`- [message] ${header}`, baseIndent));
	if (step.level) {
		lines.push(indent(`level: ${step.level}`, baseIndent + 2));
	}
	lines.push(indent(`text: ${step.text}`, baseIndent + 2));
}

function formatComputeStep(lines: string[], step: any, options: FormatOptions): void {
	const header = step.label ? `${step.label} (${step.id})` : step.id;
	const baseIndent = options.indent ?? 0;
	lines.push(indent(`- [compute] ${header}`, baseIndent));
	if (step.description) {
		lines.push(indent(step.description, baseIndent + 2));
	}
	if (step.handler) {
		lines.push(indent(`handler: ${step.handler}`, baseIndent + 2));
	}
	if (step.storeAs) {
		lines.push(indent(`storeAs: ${step.storeAs}`, baseIndent + 2));
	}
	lines.push(indent(`values:`, baseIndent + 2));
	for (const [key, value] of Object.entries(step.values ?? {})) {
		lines.push(indent(`${key}: ${formatValue(value)}`, baseIndent + 4));
	}
}

function formatGroupStep(lines: string[], step: any, options: FormatOptions): void {
	const header = step.label ? `${step.label} (${step.id})` : step.id;
	const baseIndent = options.indent ?? 0;
	lines.push(indent(`- [group] ${header} → flow ${step.flowId}`, baseIndent));
	for (const nestedStep of step.plan.steps) {
		formatStep(lines, nestedStep, {
			indent: baseIndent + 4,
			preferences: options.preferences,
		});
	}
}

function formatIterateStep(lines: string[], step: any, options: FormatOptions): void {
	const header = step.label ? `${step.label} (${step.id})` : step.id;
	const baseIndent = options.indent ?? 0;
	const countLabel = step.itemCount !== undefined ? ` (${step.itemCount} item${step.itemCount === 1 ? "" : "s"})` : "";
	lines.push(indent(`- [iterate] ${header}${countLabel}`, baseIndent));
	lines.push(indent(`source: ${step.sourceDescription}`, baseIndent + 2));
	if (step.note) {
		lines.push(indent(step.note, baseIndent + 2));
	}
}

function formatGitWorktreeGuardStep(lines: string[], step: any, options: FormatOptions): void {
	const header = step.label ? `${step.label} (${step.id})` : step.id;
	const baseIndent = options.indent ?? 0;
	lines.push(indent(`- [git-worktree-guard] ${header}`, baseIndent));
	lines.push(
		indent(
			`status: ${step.status}${
				step.strategy ? ` (strategy: ${step.strategy})` : ""
			}`,
			baseIndent + 2,
		),
	);
	lines.push(indent(step.message, baseIndent + 2));
}

function formatPluginStep(lines: string[], step: any, options: FormatOptions): void {
	const header = step.label ? `${step.label} (${step.id})` : step.id;
	const baseIndent = options.indent ?? 0;
	lines.push(
		indent(
			`- [plugin:${step.pluginType}] ${header} (plugin: ${step.pluginName})`,
			baseIndent,
		),
	);
	if (step.summary) {
		lines.push(indent(step.summary, baseIndent + 2));
	}
	if (step.details && typeof step.details === "object") {
		lines.push(indent(`details:`, baseIndent + 2));
		for (const [key, value] of Object.entries(step.details)) {
			lines.push(indent(`${key}: ${formatValue(value)}`, baseIndent + 4));
		}
	}
}

function indent(text: string, level = 0): string {
	return `${" ".repeat(level)}${text}`;
}

function formatValue(value: unknown): string {
	if (typeof value === "string") {
		return value;
	}
	if (typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}
	if (value === null) {
		return "null";
	}
	if (value === undefined) {
		return "undefined";
	}
	return JSON.stringify(value);
}
