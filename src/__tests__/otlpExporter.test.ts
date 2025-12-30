import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOtlpLogWriter } from "..";

const mockFetch = vi.fn<
	(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
>();

describe("createOtlpLogWriter", () => {
	beforeEach(() => {
		mockFetch.mockResolvedValue(
			new Response(null, {
				status: 200,
			}),
		);
		vi.stubGlobal("fetch", mockFetch);
	});

	afterEach(() => {
		mockFetch.mockReset();
		vi.unstubAllGlobals();
	});

	it("emits scenario and step spans to the configured OTLP endpoint", async () => {
		const writer = createOtlpLogWriter({
			endpoint: "https://collector.example.com/v1/traces",
			headers: { Authorization: "Bearer token" },
			serviceName: "dev-wizard-tests",
			scopeName: "dev-wizard-e2e",
			resourceAttributes: { "deployment.env": "dev" },
		});

		const startedAt = new Date().toISOString();
		const endedAt = new Date(Date.now() + 25).toISOString();

		writer.write({
			type: "scenario.start",
			scenarioId: "demo",
			label: "Demo Scenario",
			startedAt,
			flows: ["main"],
			dryRun: false,
			quiet: false,
			verbose: false,
		});

		writer.write({
			type: "step.start",
			flowId: "main",
			stepId: "command-step",
			stepType: "command",
			index: 0,
		});

		writer.write({
			type: "command.result",
			flowId: "main",
			stepId: "command-step",
			command: "deploy --channel beta",
			dryRun: false,
			success: true,
			durationMs: 10,
		});

		writer.write({
			type: "policy.decision",
			ruleId: "warn-prod",
			ruleLevel: "warn",
			enforcedLevel: "warn",
			acknowledged: false,
			flowId: "main",
			stepId: "command-step",
			command: "deploy --channel beta",
			note: "Use --policy-ack warn-prod",
		});

		writer.write({
			type: "step.complete",
			flowId: "main",
			stepId: "command-step",
			stepType: "command",
			index: 0,
			durationMs: 10,
			next: undefined,
		});

		writer.write({
			type: "scenario.complete",
			scenarioId: "demo",
			label: "Demo Scenario",
			status: "success",
			endedAt,
			durationMs: 25,
			completedSteps: 1,
			failedSteps: 0,
			exitedEarly: false,
		});

		await writer.close();

		expect(mockFetch).toHaveBeenCalledTimes(1);
		const [endpoint, init] = mockFetch.mock.calls[0]!;
		expect(endpoint).toBe("https://collector.example.com/v1/traces");
		expect(init?.headers).toMatchObject({
			Authorization: "Bearer token",
			"content-type": "application/json",
		});

		const payload = JSON.parse((init?.body as string) ?? "{}");
		expect(payload.resourceSpans).toHaveLength(1);
		const scopeSpans = payload.resourceSpans[0]?.scopeSpans ?? [];
		expect(scopeSpans).toHaveLength(1);
		const spans = scopeSpans[0]?.spans ?? [];
		expect(spans.length).toBeGreaterThanOrEqual(2);
		expect(spans[0]?.traceId).toBeDefined();
		expect(spans[1]?.parentSpanId).toBe(spans[0]?.spanId);
		const commandSpan = spans.find((span: any) => span.name?.includes("command-step"));
		expect(commandSpan?.events).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					name: "policy.decision",
					attributes: expect.arrayContaining([
						expect.objectContaining({
							key: "dev_wizard.rule_id",
							value: expect.objectContaining({ stringValue: "warn-prod" }),
						}),
						expect.objectContaining({
							key: "dev_wizard.acknowledged",
							value: expect.objectContaining({ stringValue: "false" }),
						}),
					]),
				}),
			]),
		);
	});
});
