import path from "node:path";
import { pathToFileURL } from "node:url";
import { BUILTIN_STEP_TYPES } from "../loader/types.js";
import type {
	DevWizardPluginReference,
	PluginStep,
	DevWizardStep,
	StepTransitionTarget,
} from "../loader/types";
import { renderMaybeNested, renderTemplate } from "./templates.js";
import type { TemplateContext } from "./templates.js";
import type { WizardState } from "./state";
import type { ExecutorContext } from "./executor";
import { defaultWizardLog, type WizardLogAdapter } from "./logAdapter.js";

export interface WizardPluginRegistry {
	getStepHandler(stepType: string): WizardPluginStepRegistration | undefined;
	all(): WizardPluginStepRegistration[];
}

export interface WizardPluginStepRegistration {
	stepType: string;
	pluginName: string;
	reference: DevWizardPluginReference;
	handler: WizardPluginStepHandler;
}

class WizardPluginRegistryImpl implements WizardPluginRegistry {
	constructor(private readonly handlers: Map<string, WizardPluginStepRegistration>) {}

	getStepHandler(stepType: string): WizardPluginStepRegistration | undefined {
		return this.handlers.get(stepType);
	}

	all(): WizardPluginStepRegistration[] {
		return Array.from(this.handlers.values());
	}
}

export interface WizardPlugin {
	name?: string;
	stepHandlers: Record<string, WizardPluginStepHandler>;
}

export interface WizardPluginFactoryMetadata {
	module: string;
	resolvedPath?: string;
}

export interface WizardPluginStepHandler {
	plan?: (
		context: WizardPluginPlanContext,
	) => WizardPluginPlanResult | Promise<WizardPluginPlanResult>;
	run: (
		context: WizardPluginRunContext,
	) => WizardPluginStepResult | Promise<WizardPluginStepResult>;
}

export interface WizardPluginPlanContext {
	flowId: string;
	step: PluginStep;
	state: WizardState;
	context: ExecutorContext;
	templateContext: TemplateContext;
	helpers: WizardPluginHelpers;
}

export interface WizardPluginRunContext {
	flowId: string;
	step: PluginStep;
	state: WizardState;
	context: ExecutorContext;
	templateContext: TemplateContext;
	helpers: WizardPluginHelpers;
}

export interface WizardPluginHelpers {
	renderTemplate: (template: string) => string;
	renderMaybeNested: (value: unknown) => unknown;
	templateContext: TemplateContext;
	log: WizardLogAdapter;
}

export interface WizardPluginPlanResult {
	plan?: PluginStepPlan;
	next?: StepTransitionTarget;
	events?: WizardPluginPlanEvent[];
}

export interface WizardPluginPlanEvent {
	type: string;
	data?: Record<string, unknown>;
}

export interface WizardPluginStepResult {
	next?: StepTransitionTarget;
	status?: "success" | "warning" | "error";
}

export interface PluginStepPlan {
	kind: "plugin";
	id: string;
	label?: string;
	pluginType: string;
	pluginName: string;
	summary?: string;
	details?: Record<string, unknown>;
}

export interface LoadPluginsOptions {
	repoRoot: string;
}

export interface LoadPluginsResult {
	registry: WizardPluginRegistry;
	warnings: string[];
}

export function createEmptyPluginRegistry(): WizardPluginRegistry {
	return new WizardPluginRegistryImpl(new Map());
}

export async function loadPlugins(
	references: readonly DevWizardPluginReference[] | undefined,
	options: LoadPluginsOptions,
): Promise<LoadPluginsResult> {
	if (!references || references.length === 0) {
		return { registry: createEmptyPluginRegistry(), warnings: [] };
	}

	const handlers = new Map<string, WizardPluginStepRegistration>();
	const warnings: string[] = [];

	for (const reference of references) {
		const specifier = resolvePluginSpecifier(reference, options.repoRoot);
		let moduleExports: Record<string, unknown>;

		try {
			moduleExports = await import(specifier);
		} catch (error) {
			throw new Error(
				`Failed to load Dev Wizard plugin "${reference.module}": ${error instanceof Error ? error.message : String(error)}`,
			);
		}

		const plugin = await instantiatePluginFromModule(moduleExports, reference);
		const pluginName = plugin.name ?? reference.name ?? reference.module;

		if (!plugin.stepHandlers || Object.keys(plugin.stepHandlers).length === 0) {
			warnings.push(
				`Plugin "${pluginName}" did not register any step handlers; ignoring.`,
			);
			continue;
		}

		for (const [stepType, handler] of Object.entries(plugin.stepHandlers)) {
			if (!handler || typeof handler.run !== "function") {
				throw new Error(
					`Plugin "${pluginName}" registered invalid handler for step type "${stepType}".`,
				);
			}

			if (handlers.has(stepType)) {
				const existing = handlers.get(stepType)!;
				throw new Error(
					`Step type "${stepType}" is already handled by plugin "${existing.pluginName}" (module: ${existing.reference.module}).`,
				);
			}

			handlers.set(stepType, {
				stepType,
				pluginName,
				handler,
				reference,
			});
		}
	}

	return {
		registry: new WizardPluginRegistryImpl(handlers),
		warnings,
	};
}

function resolvePluginSpecifier(
	reference: DevWizardPluginReference,
	repoRoot: string,
): string {
	const candidate = reference.resolvedPath ?? reference.module;

	if (candidate.startsWith("file://")) {
		return candidate;
	}

	if (path.isAbsolute(candidate)) {
		return pathToFileURL(candidate).href;
	}

	if (candidate.startsWith("./") || candidate.startsWith("../")) {
		return pathToFileURL(path.resolve(repoRoot, candidate)).href;
	}

	return candidate;
}

async function instantiatePluginFromModule(
	moduleExports: Record<string, unknown>,
	reference: DevWizardPluginReference,
): Promise<WizardPlugin> {
	const factory =
		typeof moduleExports.createDevWizardPlugin === "function"
			? moduleExports.createDevWizardPlugin.bind(moduleExports)
			: typeof moduleExports.createPlugin === "function"
				? moduleExports.createPlugin.bind(moduleExports)
				: typeof moduleExports.default === "function"
					? moduleExports.default.bind(moduleExports)
					: undefined;

	if (factory) {
		const result = await factory(reference.options ?? {}, {
			module: reference.module,
			resolvedPath: reference.resolvedPath,
		} satisfies WizardPluginFactoryMetadata);
		validatePluginObject(result, reference);
		return result;
	}

	const pluginObject =
		(typeof moduleExports.default === "object" && moduleExports.default !== null
			? moduleExports.default
			: typeof moduleExports.plugin === "object" && moduleExports.plugin !== null
				? moduleExports.plugin
				: undefined) as WizardPlugin | undefined;

	if (!pluginObject) {
		throw new Error(
			`Plugin module "${reference.module}" must export a plugin object or a "createPlugin" / "createDevWizardPlugin" factory.`,
		);
	}

	validatePluginObject(pluginObject, reference);
	return pluginObject;
}

function validatePluginObject(
	value: unknown,
	reference: DevWizardPluginReference,
): asserts value is WizardPlugin {
	if (!value || typeof value !== "object") {
		throw new Error(
			`Plugin module "${reference.module}" did not return a valid plugin object.`,
		);
	}
	if (
		!("stepHandlers" in value) ||
		typeof (value as { stepHandlers?: unknown }).stepHandlers !== "object" ||
		!(value as { stepHandlers: unknown }).stepHandlers
	) {
		throw new Error(
			`Plugin "${reference.module}" is missing a "stepHandlers" object.`,
		);
	}
}

export function createPluginHelpers(
	templateContext: TemplateContext,
): WizardPluginHelpers {
	return {
		renderTemplate(value: string) {
			return renderTemplate(value, templateContext);
		},
		renderMaybeNested(value: unknown) {
			return renderMaybeNested(value, templateContext);
		},
		templateContext,
		log: defaultWizardLog,
	};
}

export function normalizeStepType(value: unknown): string {
	return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function isPluginStep(step: DevWizardStep): step is PluginStep {
	const stepType = normalizeStepType(step.type);
	return !BUILTIN_STEP_TYPES.includes(
		stepType as (typeof BUILTIN_STEP_TYPES)[number],
	);
}
