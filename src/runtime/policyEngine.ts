import type {
	PolicyConfig,
	PolicyLevel,
	PolicyRule,
} from "../loader/types";

export interface PolicyEvaluationContext {
	flowId: string;
	stepId: string;
	command: string;
	preset?: string;
}

export interface PolicyDecision {
	rule: PolicyRule;
	level: PolicyLevel;
	enforcedLevel: PolicyLevel;
	acknowledged: boolean;
	note?: string;
}

export interface PolicyEngine {
	evaluateCommand(
		context: PolicyEvaluationContext,
	): PolicyDecision | undefined;
	acknowledge(ruleId: string): void;
	isAcknowledged(ruleId: string): boolean;
}

interface PreparedPolicyRule {
	rule: PolicyRule;
	match: {
		command?: string[];
		commandPattern?: RegExp[];
		preset?: string[];
		flow?: string[];
		step?: string[];
	};
}

interface PolicyEngineOptions {
	config?: PolicyConfig;
	acknowledgedRuleIds?: Iterable<string>;
}

export function createPolicyEngine(
	options: PolicyEngineOptions,
): PolicyEngine | undefined {
	const { config } = options;
	if (!config || !config.rules || config.rules.length === 0) {
		return undefined;
	}

	const acknowledged = new Set(options.acknowledgedRuleIds ?? []);
	const preparedRules: PreparedPolicyRule[] = config.rules.map((rule) => ({
		rule,
		match: {
			command: normalizeToArray(rule.match.command),
			commandPattern: compilePatterns(rule.match.commandPattern),
			preset: normalizeToArray(rule.match.preset),
			flow: normalizeToArray(rule.match.flow),
			step: normalizeToArray(rule.match.step),
		},
	}));

	const evaluateCommand = (
		context: PolicyEvaluationContext,
	): PolicyDecision | undefined => {
		for (const prepared of preparedRules) {
			if (ruleMatches(prepared.match, context)) {
				return buildDecision(prepared.rule, acknowledged);
			}
		}
		return undefined;
	};

	return {
		evaluateCommand,
		acknowledge(ruleId: string) {
			acknowledged.add(ruleId);
		},
		isAcknowledged(ruleId: string) {
			return acknowledged.has(ruleId);
		},
	};
}

function buildDecision(
	rule: PolicyRule,
	acknowledged: Set<string>,
): PolicyDecision {
	const isAcknowledged = acknowledged.has(rule.id);
	const enforcedLevel: PolicyLevel =
		rule.level === "block" && isAcknowledged ? "warn" : rule.level;

	return {
		rule,
		level: rule.level,
		enforcedLevel,
		acknowledged: isAcknowledged,
		note: rule.note,
	};
}

function normalizeToArray(value?: string | string[]): string[] | undefined {
	if (value === undefined) {
		return undefined;
	}
	return Array.isArray(value) ? value : [value];
}

function compilePatterns(
	value?: string | string[],
): RegExp[] | undefined {
	const patterns = normalizeToArray(value);
	if (!patterns) {
		return undefined;
	}
	return patterns.map((pattern) => {
		try {
			return new RegExp(pattern);
		} catch (error) {
			throw new Error(
				`Invalid commandPattern regex "${pattern}": ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	});
}

function ruleMatches(
	match: PreparedPolicyRule["match"],
	context: PolicyEvaluationContext,
): boolean {
	if (
		match.flow &&
		!match.flow.includes(context.flowId)
	) {
		return false;
	}

	if (
		match.step &&
		!match.step.includes(context.stepId)
	) {
		return false;
	}

	if (
		match.preset &&
		(!context.preset || !match.preset.includes(context.preset))
	) {
		return false;
	}

	if (
		match.command &&
		!match.command.includes(context.command)
	) {
		return false;
	}

	if (match.commandPattern) {
		const matched = match.commandPattern.some((regex) =>
			regex.test(context.command),
		);
		if (!matched) {
			return false;
		}
	}

	return true;
}
