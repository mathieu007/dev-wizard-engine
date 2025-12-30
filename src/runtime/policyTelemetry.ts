import type { WizardLogEvent, WizardLogWriter } from "./logWriter";

export type PolicyDecisionEvent = Extract<
	WizardLogEvent,
	{ type: "policy.decision" }
>;

export interface PolicyTelemetryHookOptions {
	onDecision: (event: PolicyDecisionEvent) => void;
}

export function createPolicyTelemetryHook(
	options: PolicyTelemetryHookOptions,
): WizardLogWriter {
	return {
		write(event) {
			if (event.type === "policy.decision") {
				options.onDecision(event);
			}
		},
		close() {
			return Promise.resolve();
		},
	};
}
