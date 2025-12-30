export function createPlugin(options = {}) {
	const defaultStoreKey =
		typeof options.storeAs === "string" ? options.storeAs : "echo-output";

	return {
		name: "echo-plugin",
		stepHandlers: {
			echo: {
				async plan({ step, helpers }) {
					const summary =
						typeof step.message === "string"
							? helpers.renderTemplate(step.message)
							: undefined;
					return {
						plan: {
							kind: "plugin",
							id: step.id,
							label: step.label,
							pluginType: step.type,
							pluginName: "echo-plugin",
							summary,
							details: summary ? { message: summary } : undefined,
						},
					};
				},
				async run({ step, state, helpers }) {
					const key =
						typeof step.storeAs === "string" ? step.storeAs : defaultStoreKey;
					const value =
						typeof step.message === "string"
							? helpers.renderTemplate(step.message)
							: step.message;
					state.answers[key] = value;
					return { status: "success" };
				},
			},
		},
	};
}
