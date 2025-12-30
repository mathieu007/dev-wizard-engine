export function createPolicyEngine(options) {
    const { config } = options;
    if (!config || !config.rules || config.rules.length === 0) {
        return undefined;
    }
    const acknowledged = new Set(options.acknowledgedRuleIds ?? []);
    const preparedRules = config.rules.map((rule) => ({
        rule,
        match: {
            command: normalizeToArray(rule.match.command),
            commandPattern: compilePatterns(rule.match.commandPattern),
            preset: normalizeToArray(rule.match.preset),
            flow: normalizeToArray(rule.match.flow),
            step: normalizeToArray(rule.match.step),
        },
    }));
    const evaluateCommand = (context) => {
        for (const prepared of preparedRules) {
            if (ruleMatches(prepared.match, context)) {
                return buildDecision(prepared.rule, acknowledged);
            }
        }
        return undefined;
    };
    return {
        evaluateCommand,
        acknowledge(ruleId) {
            acknowledged.add(ruleId);
        },
        isAcknowledged(ruleId) {
            return acknowledged.has(ruleId);
        },
    };
}
function buildDecision(rule, acknowledged) {
    const isAcknowledged = acknowledged.has(rule.id);
    const enforcedLevel = rule.level === "block" && isAcknowledged ? "warn" : rule.level;
    return {
        rule,
        level: rule.level,
        enforcedLevel,
        acknowledged: isAcknowledged,
        note: rule.note,
    };
}
function normalizeToArray(value) {
    if (value === undefined) {
        return undefined;
    }
    return Array.isArray(value) ? value : [value];
}
function compilePatterns(value) {
    const patterns = normalizeToArray(value);
    if (!patterns) {
        return undefined;
    }
    return patterns.map((pattern) => {
        try {
            return new RegExp(pattern);
        }
        catch (error) {
            throw new Error(`Invalid commandPattern regex "${pattern}": ${error instanceof Error ? error.message : String(error)}`);
        }
    });
}
function ruleMatches(match, context) {
    if (match.flow &&
        !match.flow.includes(context.flowId)) {
        return false;
    }
    if (match.step &&
        !match.step.includes(context.stepId)) {
        return false;
    }
    if (match.preset &&
        (!context.preset || !match.preset.includes(context.preset))) {
        return false;
    }
    if (match.command &&
        !match.command.includes(context.command)) {
        return false;
    }
    if (match.commandPattern) {
        const matched = match.commandPattern.some((regex) => regex.test(context.command));
        if (!matched) {
            return false;
        }
    }
    return true;
}
//# sourceMappingURL=policyEngine.js.map