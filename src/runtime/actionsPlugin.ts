import type { CommandErrorHandling, PluginStep } from "../loader/types.js";
import type { WizardActionContext } from "./actionsRegistry.js";
import { getAction } from "./actionsRegistry.js";
import { registerWorkspaceActions } from "./workspaceActions.js";
import type {
	WizardPlugin,
	WizardPluginPlanResult,
	WizardPluginPlanContext,
	WizardPluginRunContext,
	WizardPluginStepResult,
} from "./plugins.js";
import { PromptCancelledError } from "./promptDriver.js";

interface ActionStep extends PluginStep {
	action?: string;
	params?: Record<string, unknown>;
	onError?: CommandErrorHandling;
	collectSafe?: boolean;
}

const ACTION_PLUGIN_NAME = "dev-wizard-actions";

export function createDevWizardPlugin(): WizardPlugin {
	registerWorkspaceActions();

	return {
		name: ACTION_PLUGIN_NAME,
		stepHandlers: {
			action: {
				plan: planActionStep,
				run: runActionStep,
			},
		},
	};
}

async function planActionStep(
	context: WizardPluginPlanContext,
): Promise<WizardPluginPlanResult> {
	const step = context.step as ActionStep;
	const actionId = readString(step.action) ?? "unknown";
	const params = renderParams(step, context);
	const action = getAction(actionId);

	const actionPlan = action?.plan
		? await action.plan(params, buildActionContext(context))
		: undefined;

	return {
		plan: {
			kind: "plugin",
			id: step.id,
			pluginType: step.type,
			pluginName: ACTION_PLUGIN_NAME,
			summary:
				actionPlan?.summary ?? (actionId === "unknown" ? "Action step" : `Action: ${actionId}`),
			details:
				actionPlan?.details ?? {
					action: actionId,
					params,
				},
		},
	};
}

async function runActionStep(
	context: WizardPluginRunContext,
): Promise<WizardPluginStepResult> {
	const step = context.step as ActionStep;
	if (context.context.phase === "collect" && !step.collectSafe) {
		throw new Error(
			`Collect mode reached action step "${step.id}" in flow "${context.flowId}". Mark it collectSafe or replace it with a compute step.`,
		);
	}

	const actionId = readString(step.action);
	if (!actionId) {
		throw new Error(`Action step "${step.id}" is missing an action id.`);
	}

	const action = getAction(actionId);
	if (!action) {
		throw new Error(`Action "${actionId}" is not registered.`);
	}

	const params = renderParams(step, context);
	const actionContext = buildActionContext(context);

	try {
		const result = await action.run(params, actionContext);
		if (result?.outputs) {
			for (const [key, value] of Object.entries(result.outputs)) {
				context.state.answers[key] = value;
			}
		}
		return {
			next: result?.next,
			status: result?.status ?? "success",
		};
	} catch (error) {
		context.state.failedSteps += 1;
		return await handleActionFailure(error, step, context);
	}
}

function renderParams(
	step: ActionStep,
	context: WizardPluginPlanContext | WizardPluginRunContext,
): Record<string, unknown> {
	const rawParams = step.params ?? {};
	const rendered = context.helpers.renderMaybeNested(rawParams);
	return typeof rendered === "object" && rendered ? { ...rendered } : {};
}

function buildActionContext(
	context: WizardPluginPlanContext | WizardPluginRunContext,
): WizardActionContext {
	return {
		repoRoot: context.context.repoRoot,
		state: context.state,
		log: context.helpers.log,
		dryRun: context.context.dryRun,
		config: context.context.config,
	};
}

async function handleActionFailure(
	error: unknown,
	step: ActionStep,
	context: WizardPluginRunContext,
): Promise<WizardPluginStepResult> {
	if (!step.onError) {
		throw error;
	}

	const message = error instanceof Error ? error.message : String(error);
	if (message) {
		context.helpers.log.error(`[action] ${message}`);
	}

	if (step.onError.recommendation) {
		context.helpers.log.info(step.onError.recommendation.trim());
	}

	const actions = step.onError.actions ?? [];
	const defaultNext = step.onError.defaultNext?.next ?? "exit";

	if (context.context.nonInteractive) {
		return {
			next: defaultNext,
			status: defaultNext === "exit" ? "error" : "warning",
		};
	}

	if (actions.length === 0) {
		return {
			next: defaultNext,
			status: defaultNext === "exit" ? "error" : "warning",
		};
	}

	const promptOptions = actions.map((action) => ({
		value: action.next,
		label: action.label,
		hint: action.description,
	}));
	if (!promptOptions.some((option) => option.value === "exit")) {
		promptOptions.push({
			value: "exit",
			label: "Exit",
			hint: "Exit and review the summary.",
		});
	}

	try {
		const selection = await context.context.promptDriver.select({
			message: "How would you like to proceed?",
			options: promptOptions,
		});
		return {
			next: selection,
			status: selection === "exit" ? "error" : "warning",
		};
	} catch (promptError) {
		if (promptError instanceof PromptCancelledError) {
			return { next: "exit", status: "error" };
		}
		throw promptError;
	}
}

function readString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() !== "" ? value : undefined;
}
