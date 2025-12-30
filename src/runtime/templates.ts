import Handlebars from "handlebars";

type TemplateCache = Map<string, Handlebars.TemplateDelegate>;

const templateCache: TemplateCache = new Map();
let helpersRegistered = false;

export interface TemplateContext {
	state: Record<string, unknown>;
	step?: Record<string, unknown>;
	env: NodeJS.ProcessEnv;
	iteration?: {
		index: number;
		total: number;
		value: unknown;
		key?: string;
	};
	repoRoot: string;
}

export function renderTemplate(
	template: string,
	context: TemplateContext,
): string {
	if (!template.includes("{{")) {
		return template;
	}

	ensureHelpersRegistered();

	const cached =
		templateCache.get(template) ??
		templateCache
			.set(template, Handlebars.compile(template, { noEscape: true }))
			.get(template)!;

	return cached(context);
}

export function renderMaybeNested(
	value: unknown,
	context: TemplateContext,
): unknown {
	if (typeof value === "string") {
		return renderTemplate(value, context);
	}

	if (Array.isArray(value)) {
		return value.map((item) => renderMaybeNested(item, context));
	}

	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value).map(([key, val]) => [
				key,
				renderMaybeNested(val, context),
			]),
		);
	}

	return value;
}

function ensureHelpersRegistered() {
	if (helpersRegistered) {
		return;
	}

	helpersRegistered = true;

	Handlebars.registerHelper("eq", (a: unknown, b: unknown) => a === b);
	Handlebars.registerHelper("ne", (a: unknown, b: unknown) => a !== b);
	Handlebars.registerHelper("lt", (a: unknown, b: unknown) => (a as number) < (b as number));
	Handlebars.registerHelper("gt", (a: unknown, b: unknown) => (a as number) > (b as number));
	Handlebars.registerHelper("and", (...args: unknown[]) =>
		args.slice(0, -1).every(Boolean),
	);
	Handlebars.registerHelper("or", (...args: unknown[]) =>
		args.slice(0, -1).some(Boolean),
	);
	Handlebars.registerHelper("not", (value: unknown) => !value);
	Handlebars.registerHelper("includes", (value: unknown, target: unknown) => {
		if (Array.isArray(value)) {
			return value.includes(target);
		}
		if (typeof value === "string") {
			return value.includes(String(target));
		}
		return false;
	});
	const isHandlebarsOptions = (value: unknown): boolean =>
		Boolean(
			value &&
			typeof value === "object" &&
			"hash" in (value as Record<string, unknown>) &&
			"data" in (value as Record<string, unknown>),
		);
	Handlebars.registerHelper("default", (value: unknown, fallback: unknown) => {
		const normalizedFallback = isHandlebarsOptions(fallback)
			? undefined
			: fallback;
		return value ?? normalizedFallback;
	});
	Handlebars.registerHelper("array", (...args: unknown[]) => args.slice(0, -1));
	Handlebars.registerHelper("json", (value: unknown) =>
		JSON.stringify(value, null, 2),
	);
	Handlebars.registerHelper("jsonLiteral", (value: unknown) => {
		const json = JSON.stringify(value);
		return json === undefined ? "null" : json;
	});
	Handlebars.registerHelper("jsonString", (value: unknown) => {
		const json = JSON.stringify(value) ?? "null";
		return json
			.replace(/\\/g, "\\\\")
			.replace(/"/g, '\\"')
			.replace(/'/g, "\\'")
			.replace(/`/g, "\\`")
			.replace(/\u2028/g, "\\u2028")
			.replace(/\u2029/g, "\\u2029");
	});
	Handlebars.registerHelper("lookup", (value: unknown, key: unknown) => {
		if (value && typeof value === "object" && key != null) {
			return (value as Record<string, unknown>)[String(key)];
		}
		return undefined;
	});
	Handlebars.registerHelper("lookupOr", (value: unknown, key: unknown, fallback?: unknown) => {
		if (value && typeof value === "object" && key != null) {
			const resolved = (value as Record<string, unknown>)[String(key)];
			return resolved === undefined ? (fallback ?? {}) : resolved;
		}
		return fallback ?? {};
	});
}
