export function evaluateCondition(
	expression: string,
	context: Record<string, unknown>,
): boolean {
	if (!expression.trim()) {
		return false;
	}

	try {
		const evaluator = new Function(
			"context",
			`const { answers, scenario, lastCommand } = context;
			return Boolean(${expression});`,
		);
		return Boolean(evaluator(context));
	} catch (error) {
		throw new Error(
			`Failed to evaluate branch expression "${expression}": ${String(error)}`,
		);
	}
}
