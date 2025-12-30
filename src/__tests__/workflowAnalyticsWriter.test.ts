import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WizardState } from "../runtime/state";
import { writeWorkflowAnalyticsReports } from "../runtime/workflowAnalyticsWriter";

let repoRoot: string;

beforeEach(async () => {
	repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "dev-wizard-analytics-"));
});

afterEach(async () => {
	await fs.rm(repoRoot, { recursive: true, force: true });
});

describe("writeWorkflowAnalyticsReports", () => {
	it("writes workflow and integration timing snapshots", async () => {
		const reportsDir = path.join(repoRoot, ".reports");
		await fs.mkdir(reportsDir, { recursive: true });
		await fs.writeFile(
			path.join(reportsDir, "release-email-status.json"),
			JSON.stringify({
				version: "0.0.0-dev",
				status: "draft",
				httpStatus: 200,
				timestamp: new Date().toISOString(),
				subject: "Dev", 
			}) + "\n",
			"utf8",
		);

		const start = new Date();
		const end = new Date(start.getTime() + 750);

		const state: WizardState = {
			scenario: { id: "workflows-core", label: "Core Workflows", flow: "core-workflows" },
			answers: {},
			history: [
				{
					flowId: "build-test-flow",
					stepId: "build-test-step",
					stepLabel: "build-test-step",
					stepMetadata: {
						workflow: {
							id: "build-test",
							label: "build-test",
							category: "core",
							includeInAll: true,
						},
					},
					descriptor: { run: "echo" },
					rendered: { run: "echo" },
					startedAt: start,
					endedAt: end,
					success: true,
					stdout: "build test ok\nall good",
					stderr: "",
					exitCode: 0,
					durationMs: end.getTime() - start.getTime(),
					warnAfterMs: undefined,
					longRunning: false,
					timedOut: false,
				},
			],
			lastCommand: undefined,
			completedSteps: 1,
			failedSteps: 0,
	retries: [],
	skippedSteps: [],
	policyDecisions: [],
	integrationTimings: [
				{
					flowId: "build-test-flow",
					stepId: "build-test-step",
					workflowId: "build-test",
					workflowLabel: "build-test",
					command: { run: "node" },
					metadata: {
						events: [
							{
								task: "build-test",
								profile: "default",
								durationMs: 1350,
								status: "passed",
							},
						],
						summary: {
							totalDurationMs: 1350,
							tasks: [
								{
									task: "build-test",
									label: "build-test",
									totalDurationMs: 1350,
									runs: [
										{
											profile: "default",
											status: "passed",
											durationMs: 1350,
										},
									],
								},
							],
						},
					},
				},
			],
			flowRuns: [
				{
					flowId: "core-workflows",
					startedAt: start,
					endedAt: end,
					durationMs: Math.max(0, end.getTime() - start.getTime()),
					exitedEarly: false,
				},
			],
			startedAt: start,
			endedAt: end,
			exitedEarly: false,
			autoActionCounts: {},
			flowCursor: 1,
			stepCursor: 0,
			runId: "test-run",
			phase: "complete",
			postRunCursor: 0,
		};

		await writeWorkflowAnalyticsReports({ state, repoRoot });

		const workflowsLatestPath = path.join(reportsDir, "workflows-latest.json");
		const latestRaw = await fs.readFile(workflowsLatestPath, "utf8");
		const latest = JSON.parse(latestRaw) as {
			generatedAt: string;
			workflows: Array<{
				id: string;
				durationMs: number;
				steps: Array<{ capturedOutput?: string }>;
			}>;
		};

		expect(latest.workflows).toHaveLength(1);
		expect(latest.workflows[0]?.id).toBe("build-test");
		expect(latest.workflows[0]?.durationMs).toBeGreaterThan(0);
		expect(latest.workflows[0]?.steps?.[0]?.capturedOutput).toContain("build test ok");

		const integrationLatestPath = path.join(
			reportsDir,
			"integration-timings-latest.json",
		);
		const integrationRaw = await fs.readFile(integrationLatestPath, "utf8");
		const integration = JSON.parse(integrationRaw) as {
			workflows: Array<{ id: string }>;
		};
		expect(integration.workflows[0]?.id).toBe("build-test");
	});
});
