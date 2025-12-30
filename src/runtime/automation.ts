import { zodToJsonSchema } from "zod-to-json-schema";
import { configSchema } from "../loader/parser.js";
import type {
	DevWizardConfig,
	PromptOption,
	PromptStep,
	PromptValidation,
} from "../loader/types";

interface PromptDefinition {
	key: string;
	step: PromptStep;
	required: boolean;
	defaultValue?: string | boolean | string[];
	options?: PromptOption[];
	validation?: PromptValidation;
	flows: Set<string>;
}

function collectPromptDefinitions(config: DevWizardConfig): PromptDefinition[] {
	const map = new Map<string, PromptDefinition>();

	for (const flow of Object.values(config.flows)) {
		for (const step of flow.steps) {
			if (step.type !== "prompt") {
				continue;
			}

			const promptStep = step as PromptStep;
			const key = promptStep.storeAs ?? promptStep.id;
			const existing = map.get(key);
			if (existing) {
				existing.flows.add(flow.id);
				continue;
			}

			map.set(key, {
				key,
				step: promptStep,
				required: promptStep.required ?? false,
				defaultValue: promptStep.defaultValue,
				options: promptStep.options,
				validation: promptStep.validation,
				flows: new Set([flow.id]),
			});
		}
	}

	return Array.from(map.values());
}

function describePrompt(definition: PromptDefinition): string {
	const pieces: string[] = [];
	pieces.push(`Prompt: ${definition.step.prompt}`);
	pieces.push(`Mode: ${definition.step.mode}`);
	if (definition.required) {
		pieces.push("Required");
	}
	if (definition.options && definition.options.length > 0) {
		const options = definition.options
			.map((option) => `${option.label} (${option.value})`)
			.join(", ");
		pieces.push(`Options: ${options}`);
	}
	const flows = Array.from(definition.flows);
	if (flows.length > 0) {
		pieces.push(`Flows: ${flows.join(", ")}`);
	}
	return pieces.join(" | ");
}

export function createConfigJsonSchema(): Record<string, unknown> {
	return zodToJsonSchema(
		configSchema as unknown as Parameters<typeof zodToJsonSchema>[0],
		{
			$refStrategy: "none",
			target: "jsonSchema7",
			definitionPath: "definitions",
		},
	);
}

function buildInputSchema(definition: PromptDefinition): Record<string, unknown> {
	const schema: Record<string, unknown> = {
		type: "string",
		description: describePrompt(definition),
	};

	if (definition.validation?.minLength !== undefined) {
		schema.minLength = definition.validation.minLength;
	}
	if (definition.validation?.maxLength !== undefined) {
		schema.maxLength = definition.validation.maxLength;
	}
	if (definition.validation?.regex) {
		schema.pattern = definition.validation.regex;
	}

	if (definition.defaultValue !== undefined) {
		schema.default = definition.defaultValue;
	}

	return schema;
}

function buildConfirmSchema(definition: PromptDefinition): Record<string, unknown> {
	const schema: Record<string, unknown> = {
		type: "boolean",
		description: describePrompt(definition),
	};

	if (typeof definition.defaultValue === "boolean") {
		schema.default = definition.defaultValue;
	}

	return schema;
}

function buildSelectSchema(definition: PromptDefinition): Record<string, unknown> {
	const schema: Record<string, unknown> = {
		type: "string",
		description: describePrompt(definition),
	};

	if (definition.options && definition.options.length > 0) {
		schema.enum = definition.options.map((option) => option.value);
	}

	if (typeof definition.defaultValue === "string") {
		schema.default = definition.defaultValue;
	}

	return schema;
}

function buildMultiSelectSchema(definition: PromptDefinition): Record<string, unknown> {
	const schema: Record<string, unknown> = {
		type: "array",
		description: describePrompt(definition),
		items: {
			type: "string",
			enum: definition.options?.map((option) => option.value),
		},
		uniqueItems: true,
	};

	if (Array.isArray(definition.defaultValue)) {
		schema.default = definition.defaultValue;
	}

	return schema;
}

export function createPromptOverrideSchema(
	config: DevWizardConfig,
): Record<string, unknown> {
	const definitions = collectPromptDefinitions(config);
	const properties: Record<string, unknown> = {
		$schema: {
			type: "string",
			description:
				"Optional JSON Schema reference to keep tooling aware of the overrides structure.",
		},
	};
	const requiredKeys: string[] = [];

	for (const definition of definitions) {
		let schema: Record<string, unknown>;
		switch (definition.step.mode) {
			case "confirm":
				schema = buildConfirmSchema(definition);
				break;
			case "select":
				schema = buildSelectSchema(definition);
				break;
			case "multiselect":
				schema = buildMultiSelectSchema(definition);
				break;
			case "input":
			default:
				schema = buildInputSchema(definition);
				break;
		}

		properties[definition.key] = schema;
		if (definition.required && definition.defaultValue === undefined) {
			requiredKeys.push(definition.key);
		}
	}

	const schema: Record<string, unknown> = {
		$schema: "https://json-schema.org/draft/2020-12/schema",
		title: "Dev Wizard Prompt Overrides",
		type: "object",
		additionalProperties: false,
		properties,
	};

	if (requiredKeys.length > 0) {
		schema.required = requiredKeys;
	}

	return schema;
}

export interface PromptOverrideScaffoldOptions {
	schemaRef?: string;
}

export function createPromptOverrideScaffold(
	config: DevWizardConfig,
	options: PromptOverrideScaffoldOptions = {},
): Record<string, unknown> {
	const definitions = collectPromptDefinitions(config);
	const overrides: Record<string, unknown> = {};

	if (options.schemaRef) {
		overrides.$schema = options.schemaRef;
	}

	for (const definition of definitions) {
		if (definition.defaultValue !== undefined) {
			if (Array.isArray(definition.defaultValue)) {
				overrides[definition.key] = [...definition.defaultValue];
			} else {
				overrides[definition.key] = definition.defaultValue;
			}
			continue;
		}

		switch (definition.step.mode) {
			case "confirm":
				overrides[definition.key] = false;
				break;
			case "select":
				overrides[definition.key] =
					definition.options && definition.options.length > 0
						? definition.options[0]!.value
						: "";
				break;
			case "multiselect":
				overrides[definition.key] = [];
				break;
			case "input":
			default:
				overrides[definition.key] = "";
				break;
		}
	}

	return overrides;
}
