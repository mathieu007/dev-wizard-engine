import { describe, expect, it } from "vitest";
import { createPolicyEngine } from "../runtime/policyEngine";
import type { PolicyConfig } from "../loader/types";

const policyConfig: PolicyConfig = {
	rules: [
		{
			id: "block-production",
			level: "block",
			match: {
				commandPattern: "deploy\\s+--channel\\s+prod",
			},
			note: "Production deploys require acknowledgement.",
		},
		{
			id: "warn-scripts",
			level: "warn",
			match: {
				step: "script-step",
			},
			note: "Script step emits warnings.",
		},
	],
};

describe("policyEngine", () => {
	it("matches rules and respects acknowledgements", () => {
		const engine = createPolicyEngine({ config: policyConfig });
		expect(engine).toBeDefined();
		const policy = engine!;

		let decision = policy.evaluateCommand({
			flowId: "release",
			stepId: "deploy-step",
			command: "deploy --channel prod",
		});
		expect(decision).toMatchObject({
			level: "block",
			enforcedLevel: "block",
			acknowledged: false,
			rule: { id: "block-production" },
		});

		policy.acknowledge("block-production");

		decision = policy.evaluateCommand({
			flowId: "release",
			stepId: "deploy-step",
			command: "deploy --channel prod",
		});
		expect(decision).toMatchObject({
			level: "block",
			enforcedLevel: "warn",
			acknowledged: true,
			rule: { id: "block-production" },
		});
	});

	it("returns warn decisions", () => {
		const policy = createPolicyEngine({ config: policyConfig })!;
		const decision = policy.evaluateCommand({
			flowId: "release",
			stepId: "script-step",
			command: "npm run verify",
		});
		expect(decision).toMatchObject({
			level: "warn",
			enforcedLevel: "warn",
			rule: { id: "warn-scripts" },
		});
	});
});
