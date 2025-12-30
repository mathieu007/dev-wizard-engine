export function evaluateCondition(expression, context) {
    if (!expression.trim()) {
        return false;
    }
    try {
        const evaluator = new Function("context", `const { answers, scenario, lastCommand } = context;
			return Boolean(${expression});`);
        return Boolean(evaluator(context));
    }
    catch (error) {
        throw new Error(`Failed to evaluate branch expression "${expression}": ${String(error)}`);
    }
}
//# sourceMappingURL=expression.js.map