import { Writable } from "node:stream";
import { Readable } from "node:stream";
import { afterEach, describe, expect, test, vi } from "vitest";
import { z } from "zod";

const workspaceProjectMocks = vi.hoisted(() => ({
	listWorkspaceProjects: vi.fn(async () => [
		{
			id: "packages/app",
			label: "app",
			packageJsonPath: "/repo/packages/app/package.json",
		},
	]),
}));

vi.mock("../runtime/workspaceProjects", () => workspaceProjectMocks);

import type { WizardLogWriter } from "../runtime/logWriter";
import {
	createMaintenanceOptions,
	createProjectsOrchestratorOptions,
	createRecommendationBuilder,
	createWizardTimer,
	defineWizardCommand,
	formatRecommendation,
	handleScriptError,
	parseScriptArgs,
	readJsonStdin,
	runWizardCommand,
	writeJsonStdout,
	WizardScriptError,
} from "../runtime/scriptKit";

describe("scriptKit", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		process.exitCode = 0;
		workspaceProjectMocks.listWorkspaceProjects.mockClear();
	});

	test("defineWizardCommand clones args", () => {
		const command = defineWizardCommand({
			id: "example",
			command: "node",
			args: ["-v"],
			label: "Node version",
		});

		expect(command.args).toEqual(["-v"]);
		expect(command.args).not.toBeUndefined();

		command.args.push("--help");
		expect(command.args).toEqual(["-v", "--help"]);
	});

	test("runWizardCommand runs a successful command", async () => {
		const command = defineWizardCommand({
			id: "success",
			command: process.execPath,
			args: ["-e", "process.exit(0)"],
		});

		const result = await runWizardCommand(command, { quiet: true });

		expect(result.success).toBe(true);
		expect(result.exitCode).toBe(0);
		expect(result.error).toBeUndefined();
		expect(result.durationMs).toBeGreaterThanOrEqual(0);
	});

	test("runWizardCommand captures failures", async () => {
		const command = defineWizardCommand({
			id: "failure",
			command: process.execPath,
			args: ["-e", "process.exit(2)"],
		});

		const result = await runWizardCommand(command, { quiet: true });

		expect(result.success).toBe(false);
		expect(result.exitCode).toBe(2);
		expect(result.error).toBeInstanceOf(Error);
	});

	test("runWizardCommand supports dry runs", async () => {
		const command = defineWizardCommand({
			id: "dry-run",
			command: process.execPath,
			args: ["-e", "process.exit(99)"],
		});

		const result = await runWizardCommand(command, { quiet: true, dryRun: true });

		expect(result.success).toBe(true);
		expect(result.exitCode).toBe(0);
		expect(result.dryRun).toBe(true);
	});

	test("runWizardCommand emits telemetry events", async () => {
		const events: unknown[] = [];
		const logWriter: WizardLogWriter = {
			write(event) {
				events.push(event);
			},
			close: async () => {},
		};

		const command = defineWizardCommand({
			id: "telemetry",
			command: process.execPath,
			args: ["-e", "process.exit(0)"],
			flowId: "flow-a",
			stepId: "step-1",
		});

		await runWizardCommand(command, { quiet: true, logWriter });

		expect(events).toHaveLength(1);
		const event = events[0] as {
			type: string;
			flowId: string;
			stepId: string;
			success: boolean;
		};
		expect(event.type).toBe("command.result");
		expect(event.flowId).toBe("flow-a");
		expect(event.stepId).toBe("step-1");
		expect(event.success).toBe(true);
	});

	test("createWizardTimer wraps async work", async () => {
		const timer = createWizardTimer();

		const result = await timer.wrap(async () => {
			await new Promise((resolve) => setTimeout(resolve, 10));
			return 42;
		});

		expect(result.result).toBe(42);
		expect(result.durationMs).toBeGreaterThanOrEqual(0);
	});

	test("recommendation builder formats details", () => {
		const builder = createRecommendationBuilder({
			summary: "Review the workflow results.",
		});

		builder.addCommand("pnpm run diagnostics", { label: "Diagnostics" });
		builder.addLink("https://example.com/results", { label: "Dashboard" });

		const recommendation = builder.build();
		expect(recommendation.commands).toHaveLength(1);
		expect(recommendation.links).toHaveLength(1);

		const formatted = formatRecommendation(recommendation);
		expect(formatted).toContain("Review the workflow results.");
		expect(formatted).toContain("Diagnostics");
		expect(formatted).toContain("Dashboard");
	});
});

describe("script helpers", () => {
	test("readJsonStdin parses structured payloads", async () => {
		const schema = z.object({ workflowId: z.string() });
		const payload = await readJsonStdin({
			stdin: Readable.from(['{ "workflowId": "demo" }\n']),
			schema,
			description: "workflow preview payload",
		});

		expect(payload.workflowId).toBe("demo");
	});

	test("readJsonStdin rejects empty payloads", async () => {
		await expect(
			readJsonStdin({ stdin: Readable.from(["   "]) }),
		).rejects.toBeInstanceOf(WizardScriptError);
	});

	test("parseScriptArgs normalises flags", () => {
		const schema = z.object({
			repoRoot: z.string().optional(),
			includeRoot: z
				.union([z.boolean(), z.string()])
				.transform((value) =>
					typeof value === "string" ? value !== "false" : value,
				)
				.optional()
				.default(true),
			maxDepth: z
				.union([z.number(), z.string()])
				.transform((value) => Number(value))
				.pipe(z.number().int())
				.optional(),
			ignore: z
				.union([z.array(z.string()), z.string()])
				.transform((value) =>
					Array.isArray(value) ? value : value ? [value] : [],
				)
				.optional()
				.default([]),
		});

		const parsed = parseScriptArgs({
			schema,
			argv: [
				"--repo-root",
				"/repo",
				"--no-include-root",
				"--max-depth",
				"3",
				"--ignore",
				"dist",
				"--ignore",
				"build",
			],
		});

		expect(parsed.repoRoot).toBe("/repo");
		expect(parsed.includeRoot).toBe(false);
		expect(parsed.maxDepth).toBe(3);
		expect(parsed.ignore).toEqual(["dist", "build"]);
	});

	test("parseScriptArgs rejects unexpected positionals", () => {
		expect(() =>
			parseScriptArgs({
				schema: z.object({}),
				argv: ["positional"],
			}),
		).toThrow(WizardScriptError);
	});

	test("handleScriptError writes message and exit code", () => {
		let output = "";
		const stderr = new Writable({
			write(chunk, _encoding, callback) {
				output += chunk.toString();
				callback();
			},
		});

		process.exitCode = 0;
		handleScriptError(new WizardScriptError("script failed", { exitCode: 5 }), {
			stderr,
		});

		expect(process.exitCode).toBe(5);
		expect(output).toContain("script failed");
	});

	test("writeJsonStdout serialises values", () => {
		let output = "";
		const stdout = new Writable({
			write(chunk, _encoding, callback) {
				output += chunk.toString();
				callback();
			},
		});

		writeJsonStdout({ ok: true }, { stdout, pretty: 0 });

		expect(output.trim()).toBe('{"ok":true}');
	});
});

describe("projects orchestrator helpers", () => {
	test("createProjectsOrchestratorOptions merges overrides", async () => {
		const options = await createProjectsOrchestratorOptions({
			configPath: "/repo/node_modules/@dev-wizard/presets/projects/index.yaml",
			workflows: ["maintenance"],
			projects: ["packages/app"],
			overrides: { maintenanceWindow: "weekly" },
			devWizardOptions: { dryRun: true },
		});

		expect(options.configPath).toBe("/repo/node_modules/@dev-wizard/presets/projects/index.yaml");
		expect(options.scenario).toBe("multi-project-orchestration");
		expect(options.overrides).toEqual(
			expect.objectContaining({
				maintenanceWindow: "weekly",
				selectedWorkflows: ["maintenance"],
				selectedProjects: ["packages/app"],
			}),
		);
	});

	test("createProjectsOrchestratorOptions selects all projects when requested", async () => {
		workspaceProjectMocks.listWorkspaceProjects.mockResolvedValueOnce([
			{
				id: ".",
				label: "repo",
				packageJsonPath: "/repo/package.json",
			},
		]);

		const options = await createProjectsOrchestratorOptions({
			configPath: "/repo/node_modules/@dev-wizard/presets/projects/index.yaml",
			repoRoot: "/repo",
			selectAllProjects: true,
		});

		expect(workspaceProjectMocks.listWorkspaceProjects).toHaveBeenCalledWith(
			expect.objectContaining({ repoRoot: "/repo", includeRoot: true, maxDepth: 3 }),
		);
		expect(options.overrides).toEqual(
			expect.objectContaining({ selectedProjects: ["."] }),
		);
	});

});

describe("maintenance helpers", () => {
	test("createMaintenanceOptions merges overrides", async () => {
		const options = await createMaintenanceOptions({
			configPath: "/repo/node_modules/@dev-wizard/presets/maintenance/index.yaml",
			overrides: {
				maintenanceWindowMode: "manual",
				maintenanceTasks: ["upgrade-dependencies"],
			},
			devWizardOptions: {
				dryRun: true,
				logFile: "maintenance.log",
			},
		});

		expect(options.configPath).toBe(
			"/repo/node_modules/@dev-wizard/presets/maintenance/index.yaml",
		);
		expect(options.scenario).toBe("maintenance-window");
		expect(options.overrides).toEqual(
			expect.objectContaining({
				maintenanceWindowMode: "manual",
				maintenanceTasks: ["upgrade-dependencies"],
			}),
		);
		expect(options.dryRun).toBe(true);
	});

});
