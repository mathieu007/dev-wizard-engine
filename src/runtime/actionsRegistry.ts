import type { DevWizardConfig, StepTransitionTarget } from "../loader/types.js";
import type { WizardLogAdapter } from "./logAdapter.js";
import type { WizardState } from "./state.js";

export interface WizardActionContext {
	repoRoot: string;
	state: WizardState;
	log: WizardLogAdapter;
	dryRun: boolean;
	config: DevWizardConfig;
}

export interface WizardActionPlan {
	summary?: string;
	details?: Record<string, unknown>;
}

export interface WizardActionResult {
	status?: "success" | "warning" | "error";
	next?: StepTransitionTarget;
	outputs?: Record<string, unknown>;
}

export interface WizardActionDefinition {
	id: string;
	label?: string;
	plan?: (
		params: Record<string, unknown>,
		context: WizardActionContext,
	) => WizardActionPlan | Promise<WizardActionPlan | undefined> | undefined;
	run: (
		params: Record<string, unknown>,
		context: WizardActionContext,
	) => WizardActionResult | Promise<WizardActionResult | void> | void;
}

const registeredActions = new Map<string, WizardActionDefinition>();

export function registerAction(action: WizardActionDefinition): void {
	const id = action.id?.trim();
	if (!id) {
		throw new Error("Wizard actions must provide a non-empty id.");
	}
	if (registeredActions.has(id)) {
		throw new Error(`Wizard action "${id}" is already registered.`);
	}
	registeredActions.set(id, action);
}

export function hasAction(id: string): boolean {
	return registeredActions.has(id);
}

export function getAction(id: string): WizardActionDefinition | undefined {
	return registeredActions.get(id);
}

export function listActions(): WizardActionDefinition[] {
	return Array.from(registeredActions.values());
}
