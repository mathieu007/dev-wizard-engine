import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { executeScenario } from "../runtime/executor";
import { NonInteractivePromptDriver } from "../runtime/promptDriver";
import type { DevWizardConfig } from "../loader/types";
import type { WizardLogEvent } from "../runtime/logWriter";
import {
	wizardLogEventSchema,
	createStreamLogWriter,
	createPolicyEngine,
} from "..";

describe("telemetry schema", () => {
	it("validates events emitted during scenario execution", async () => {
		const config: DevWizardConfig = {
			meta: { name: "Telemetry Test", version: "1.0.0" },
			scenarios: [
				{
					id: "demo",
					label: "Demo",
					flow: "flow",
				},
			],
			flows: {
				flow: {
					id: "flow",
					steps: [
						{
							id: "select",
							type: "prompt",
							mode: "select",
							prompt: "Choose channel",
							options: [
								{ label: "Stable", value: "stable" },
								{ label: "Beta", value: "beta" },
							],
							storeAs: "channel",
						},
						{
							id: "branch",
							type: "branch",
							branches: [
								{
									when: "answers.channel === 'beta'",
									next: "beta-step",
								},
							],
							defaultNext: { next: "stable-step" },
						},
						{
							id: "beta-step",
							type: "command",
							commands: [
								{
									run: "echo beta",
								},
							],
						},
						{
							id: "stable-step",
							type: "message",
							level: "info",
							text: "Stable channel selected",
						},
					],
				},
			},
		};

		const events: WizardLogEvent[] = [];
		const logWriter = {
			write(event: WizardLogEvent) {
				events.push(event);
			},
			async close() {
				// no-op
			},
		};

		await executeScenario(
			{
				config,
				scenarioId: "demo",
				repoRoot: process.cwd(),
				stdout: new PassThrough(),
				stderr: new PassThrough(),
				dryRun: true,
				quiet: false,
				verbose: false,
				promptDriver: new NonInteractivePromptDriver(),
				overrides: { channel: "beta" },
				logWriter,
			},
			{},
		);

		expect(events.length).toBeGreaterThan(0);
		for (const event of events) {
			expect(() => wizardLogEventSchema.parse(event)).not.toThrow();
		}
	});

	it("validates sanitized NDJSON events", async () => {
		const stream = new PassThrough();
		stream.setEncoding("utf8");
		const writer = createStreamLogWriter(stream, {
			redactPromptValues: true,
			redactCommandOutput: true,
		});

		writer.write({
			type: "prompt.answer",
			flowId: "flow",
			stepId: "prompt-1",
			value: "secret",
		});
		writer.write({
			type: "command.result",
			flowId: "flow",
			stepId: "cmd-1",
			command: "echo secret",
			dryRun: false,
			success: true,
			durationMs: 10,
		});
		writer.write({
			type: "prompt.persistence",
			flowId: "flow",
			stepId: "prompt-1",
			scope: "scenario",
			key: "channel",
			status: "hit",
			applied: true,
		});

		await writer.close();

		const raw = stream.read() as string;
		const payloads = raw
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));
		expect(payloads).toHaveLength(3);
	for (const payload of payloads) {
		expect(() => wizardLogEventSchema.parse(payload)).not.toThrow();
	}
});

	it("validates policy decision events", async () => {
		const config: DevWizardConfig = {
			meta: { name: "Policy Telemetry", version: "1.0.0" },
			scenarios: [{ id: "policy", label: "Policy", flow: "flow" }],
			flows: {
				flow: {
					id: "flow",
					steps: [
						{
							id: "deploy",
							type: "command",
							commands: [{ run: "deploy --channel prod" }],
						},
					],
				},
			},
			policies: {
				rules: [
					{
						id: "block-prod",
						level: "block",
						match: { commandPattern: "deploy\\s+--channel\\s+prod" },
						note: "Production deploys require acknowledgement.",
					},
				],
			},
		};

		const events: WizardLogEvent[] = [];
		const policy = createPolicyEngine({
			config: config.policies,
			acknowledgedRuleIds: ["block-prod"],
		});

			await executeScenario(
				{
					config,
					scenarioId: "policy",
					repoRoot: process.cwd(),
					stdout: new PassThrough(),
					stderr: new PassThrough(),
					dryRun: true,
					quiet: false,
					verbose: false,
					promptDriver: new NonInteractivePromptDriver(),
					overrides: {},
					logWriter: {
						write(event: WizardLogEvent) {
							events.push(event);
					},
					async close() {
						// no-op
					},
				},
				policy: policy!,
			},
			{},
		);

		const policyEvent = events.find((event) => event.type === "policy.decision");
		expect(policyEvent).toBeDefined();
		expect(() => wizardLogEventSchema.parse(policyEvent)).not.toThrow();
	});
});
