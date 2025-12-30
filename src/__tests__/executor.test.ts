import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../loader/configLoader";
import type { DevWizardConfig, PluginStep } from "../loader/types";
import type { PromptHistoryManager } from "../runtime/promptHistory";
import {
	buildScenarioPlan as buildScenarioPlanImpl,
	executeScenario as executeScenarioImpl,
	WizardExecutionError,
} from "../runtime/executor";
import type { PromptDriver } from "../runtime/promptDriver";
import { NonInteractivePromptDriver } from "../runtime/promptDriver";
import { createLogWriter, type WizardLogEvent } from "../runtime/logWriter";
import {
	createCheckpointManager,
	loadCheckpoint,
} from "../runtime/checkpoints";
import type { WizardState } from "../runtime/state";
import { getResolvedCommandPreset } from "../runtime/commandPresets";
import {
	formatScenarioPlanPretty,
	formatScenarioPlanNdjson,
} from "../runtime/planFormatter";
import { createPolicyEngine } from "../runtime/policyEngine";
import { loadPlugins } from "../runtime/plugins";

const promptMocks = vi.hoisted(() => {
	const log = {
		info: vi.fn(),
		success: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	};
	return {
		intro: vi.fn(),
		outro: vi.fn(),
		confirm: vi.fn(async (_options?: unknown) => true),
		isCancel: () => false,
		multiselect: vi.fn(async (_options?: unknown) => []),
		note: vi.fn(),
		select: vi.fn(
			async (options: { options: Array<{ value: string }>; message?: string }) => {
			return options.options[0]?.value ?? "";
			},
		),
		text: vi.fn(async (_options?: unknown) => "Alice"),
		log,
	};
});

const textPromptMock = vi.hoisted(() => ({
	createTextPromptWithHistory: vi.fn(async (_options?: unknown) => "Alice"),
}));

class TestPromptDriver implements PromptDriver {
	async text(options: {
		message: string;
		initialValue?: string;
		placeholder?: string;
		validate?: (value: string) => string | undefined;
	}): Promise<string> {
		const value = await promptMocks.text(options);
		const error = options.validate?.(value);
		if (error) {
			throw new Error(error);
		}
		return value;
	}

	async textWithHistory(options: {
		message: string;
		initialValue?: string;
		validate?: (value: string) => string | undefined;
		history: readonly string[];
	}): Promise<string> {
		const value = await textPromptMock.createTextPromptWithHistory(options);
		const error = options.validate?.(value);
		if (error) {
			throw new Error(error);
		}
		return value;
	}

	async confirm(options: { message: string; initialValue?: boolean }): Promise<boolean> {
		return Boolean(await promptMocks.confirm(options));
	}

	async select<Value extends string>(options: {
		message: string;
		options: Array<{ value: Value; label?: string; hint?: string }>;
		initialValue?: Value;
		maxItems?: number;
	}): Promise<Value> {
		return promptMocks.select(options) as Promise<Value>;
	}

	async multiselect(options: {
		message: string;
		options: Array<{ value: string; label?: string; hint?: string }>;
		initialValues?: string[];
		required?: boolean;
		showSelectionOrder?: boolean;
		maxItems?: number;
	}): Promise<string[]> {
		return promptMocks.multiselect(options);
	}

	async selectWithShortcuts<Value extends string>(options: {
		message: string;
		options: Array<{ value: Value; label?: string; hint?: string }>;
		initialValue?: Value;
		maxItems?: number;
		shortcuts?: Array<{ key: string; value: Value; action: string }>;
		onShortcut?: (action: string) => void;
	}): Promise<Value> {
		return promptMocks.select(options) as Promise<Value>;
	}
}

const execaMocks = vi.hoisted(() => {
	const createProcess = (overrides?: {
		exitCode?: number;
		stdout?: string;
		stderr?: string;
		streamStdout?: NodeJS.ReadableStream;
	}) => {
		const result = Promise.resolve({
			exitCode: overrides?.exitCode ?? 0,
			stdout: overrides?.stdout ?? "ok",
			stderr: overrides?.stderr ?? "",
		});
		return Object.assign(result, {
			stdout: overrides?.streamStdout,
			stderr: undefined,
		});
	};

	const createFailure = (overrides?: {
		exitCode?: number;
		stdout?: string;
		stderr?: string;
		message?: string;
		streamStdout?: NodeJS.ReadableStream;
		timedOut?: boolean;
	}) => {
		const error = Object.assign(
			new Error(overrides?.message ?? "command failed"),
			{
				exitCode: overrides?.exitCode ?? 1,
				stdout: overrides?.stdout,
				stderr: overrides?.stderr,
				timedOut: overrides?.timedOut ?? false,
			},
		);
		const result = Promise.reject(error);
		return Object.assign(result, {
			stdout: overrides?.streamStdout,
			stderr: undefined,
		});
	};

		return {
			createProcess,
			createFailure,
			execaCommand: vi.fn((..._args: unknown[]) => createProcess()),
			execa: vi.fn((..._args: unknown[]) => createProcess()),
		};
	});

vi.mock("execa", () => execaMocks);

const testDir = path.dirname(fileURLToPath(import.meta.url));

let tmpDir: string;

type ExecutorContext = Parameters<typeof executeScenarioImpl>[0];
type ExecutorContextInput = Omit<ExecutorContext, "promptDriver"> & {
	promptDriver?: ExecutorContext["promptDriver"];
};

async function executeScenario(
	context: ExecutorContextInput,
	options?: Parameters<typeof executeScenarioImpl>[1],
): Promise<WizardState> {
	return executeScenarioImpl(
		{
			...context,
			promptDriver: context.promptDriver ?? new TestPromptDriver(),
		} as ExecutorContext,
		options,
	);
}

async function buildScenarioPlan(
	context: ExecutorContextInput,
	options?: Parameters<typeof buildScenarioPlanImpl>[1],
): Promise<Awaited<ReturnType<typeof buildScenarioPlanImpl>>> {
	return buildScenarioPlanImpl(
		{
			...context,
			promptDriver: context.promptDriver ?? new TestPromptDriver(),
		} as ExecutorContext,
		options,
	);
}

function createCapturedStreams(): {
	stdout: PassThrough;
	stderr: PassThrough;
	getStdout: () => string;
	getStderr: () => string;
} {
	const stdout = new PassThrough();
	const stderr = new PassThrough();
	let stdoutBuffer = "";
	let stderrBuffer = "";

	stdout.on("data", (chunk) => {
		stdoutBuffer += chunk.toString();
	});
	stderr.on("data", (chunk) => {
		stderrBuffer += chunk.toString();
	});

	return {
		stdout,
		stderr,
		getStdout: () => stdoutBuffer,
		getStderr: () => stderrBuffer,
	};
}

beforeEach(async () => {
	tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "dev-wizard-exec-"));
	promptMocks.text.mockReset();
	promptMocks.confirm.mockReset();
	promptMocks.select.mockReset();
	promptMocks.multiselect.mockReset();
	promptMocks.note.mockReset();
	promptMocks.intro.mockReset();
	promptMocks.outro.mockReset();
	promptMocks.log.info.mockReset();
	execaMocks.execaCommand.mockReset();
	execaMocks.execa.mockReset();
	promptMocks.log.success.mockReset();
	promptMocks.log.warn.mockReset();
	promptMocks.log.error.mockReset();
	textPromptMock.createTextPromptWithHistory.mockReset();
	execaMocks.execaCommand.mockClear();
	execaMocks.execaCommand.mockImplementation(() =>
		execaMocks.createProcess(),
	);
	promptMocks.text.mockImplementation(async () => "Alice");
	promptMocks.confirm.mockImplementation(async () => true);
		promptMocks.select.mockImplementation(
			async (options: { options: Array<{ value: string }>; message?: string }) => {
			return options.options[0]?.value ?? "";
			},
		);
	promptMocks.multiselect.mockImplementation(async () => []);
	textPromptMock.createTextPromptWithHistory.mockImplementation(async () => "Alice");
});

afterEach(async () => {
	await fs.rm(tmpDir, { recursive: true, force: true });
});

const baseConfig: DevWizardConfig = {
	meta: { name: "Test", version: "1.0.0" },
	scenarios: [{ id: "demo", label: "Demo", flow: "main" }],
	flows: {
		main: {
			id: "main",
			steps: [
				{
					id: "greet",
					type: "prompt",
					mode: "input",
					prompt: "What is your name?",
					storeAs: "name",
				},
				{
					id: "run-command",
					type: "command",
					commands: [
						{
							run: "echo \"hello\"",
							cwd: ".",
						},
					],
				},
			],
		},
	},
};


	describe("executeScenario", () => {
		it("emits dry-run log entries without invoking commands", async () => {
			const logPath = path.join(tmpDir, "dry-run.log");
			const logWriter = createLogWriter(logPath);
			const streams = createCapturedStreams();

			const state = await executeScenario({
				config: baseConfig,
				scenarioId: "demo",
				repoRoot: tmpDir,
				stdout: streams.stdout,
				stderr: streams.stderr,
				dryRun: true,
				quiet: false,
				verbose: false,
				overrides: {},
				logWriter,
			});

			await logWriter.close();

			expect(execaMocks.execaCommand).not.toHaveBeenCalled();
			expect(state.completedSteps).toBe(2);
			expect(streams.getStdout()).toContain("[1/2]");

			const contents = await fs.readFile(logPath, "utf8");
		const events = contents
			.trim()
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line) as { type: string; dryRun?: boolean });

			expect(events.some((event) => event.type === "command.result" && event.dryRun)).toBe(true);
		});

		it("blocks commands in collect mode unless explicitly allowed", async () => {
			execaMocks.execaCommand.mockClear();
			const streams = createCapturedStreams();
			const config: DevWizardConfig = {
				meta: { name: "Collect Mode", version: "1.0.0" },
				scenarios: [{ id: "collect", label: "Collect", flow: "main" }],
				flows: {
					main: {
						id: "main",
						steps: [
							{
								id: "ask-name",
								type: "prompt",
								mode: "input",
								prompt: "Name?",
								storeAs: "name",
							},
							{
								id: "run-command",
								type: "command",
								commands: [
									{
										run: "echo hello",
										dryRunStrategy: "execute",
									},
								],
							},
						],
					},
				},
			};

			await expect(
				executeScenario({
					config,
					scenarioId: "collect",
					repoRoot: tmpDir,
					stdout: streams.stdout,
					stderr: streams.stderr,
					dryRun: false,
					quiet: false,
					verbose: false,
					phase: "collect",
					nonInteractive: false,
					overrides: {},
				}),
			).rejects.toThrow("Collect mode reached command step");

			expect(execaMocks.execaCommand).not.toHaveBeenCalled();
		});

		it("executes collect-safe commands in collect mode", async () => {
			execaMocks.execaCommand.mockClear();
			const streams = createCapturedStreams();
			const config: DevWizardConfig = {
				meta: { name: "Collect Mode", version: "1.0.0" },
				scenarios: [{ id: "collect", label: "Collect", flow: "main" }],
				flows: {
					main: {
						id: "main",
						steps: [
							{
								id: "ask-name",
								type: "prompt",
								mode: "input",
								prompt: "Name?",
								storeAs: "name",
							},
							{
								id: "run-command",
								type: "command",
								collectSafe: true,
								commands: [
									{
										run: "echo hello",
									},
								],
							},
						],
					},
				},
			};

			const state = await executeScenario({
				config,
				scenarioId: "collect",
				repoRoot: tmpDir,
				stdout: streams.stdout,
				stderr: streams.stderr,
				dryRun: false,
				quiet: false,
				verbose: false,
				phase: "collect",
				nonInteractive: false,
				overrides: {},
			});

			expect(execaMocks.execaCommand).toHaveBeenCalled();
			expect(state.answers.name).toBe("Alice");
		});

		it("blocks commands when policy rules are not acknowledged", async () => {
		const config: DevWizardConfig = {
			meta: { name: "Policy Block", version: "1.0.0" },
			scenarios: [
				{
					id: "policy-block",
					label: "Policy Block",
					flow: "flow",
				},
			],
			flows: {
				flow: {
					id: "flow",
					steps: [
						{
							id: "deploy",
							type: "command",
							commands: [
								{
									run: "deploy --channel prod",
								},
							],
						},
					],
				},
			},
			policies: {
				rules: [
					{
						id: "block-prod",
						level: "block",
						match: {
							commandPattern: "deploy\\s+--channel\\s+prod",
						},
						note: "Production deploys require acknowledgement.",
					},
				],
			},
		};

		const events: WizardLogEvent[] = [];
		const policy = createPolicyEngine({ config: config.policies })!;
		promptMocks.confirm.mockResolvedValueOnce(false);

		await expect(
			executeScenario(
				{
					config,
					scenarioId: "policy-block",
					repoRoot: process.cwd(),
					stdout: new PassThrough(),
					stderr: new PassThrough(),
					dryRun: true,
					quiet: false,
					verbose: false,
					overrides: {},
					logWriter: {
						write(event: WizardLogEvent) {
							events.push(event);
						},
						async close() {
							// no-op
						},
					},
					policy,
				},
				{},
			),
		).rejects.toThrow(/blocked by policy "block-prod"/);

		const policyEvent = events.find(
			(event) =>
				event.type === "policy.decision" &&
				event.ruleId === "block-prod",
		);
		expect(policyEvent).toBeDefined();
		expect((policyEvent as any).acknowledged).toBe(false);
	});

	it("allows acknowledged policy rules to proceed", async () => {
		const config: DevWizardConfig = {
			meta: { name: "Policy Ack", version: "1.0.0" },
			scenarios: [
				{
					id: "policy-ack",
					label: "Policy Ack",
					flow: "flow",
				},
			],
			flows: {
				flow: {
					id: "flow",
					steps: [
						{
							id: "deploy",
							type: "command",
							commands: [
								{
									run: "deploy --channel prod",
								},
							],
						},
					],
				},
			},
			policies: {
				rules: [
					{
						id: "block-prod",
						level: "block",
						match: {
							commandPattern: "deploy\\s+--channel\\s+prod",
						},
					},
				],
			},
		};

		const events: WizardLogEvent[] = [];
		const policy = createPolicyEngine({
			config: config.policies,
			acknowledgedRuleIds: ["block-prod"],
		})!;

	const state = await executeScenario(
		{
			config,
			scenarioId: "policy-ack",
			repoRoot: process.cwd(),
			stdout: new PassThrough(),
			stderr: new PassThrough(),
			dryRun: true,
			quiet: false,
			verbose: false,
			overrides: {},
			logWriter: {
				write(event: WizardLogEvent) {
					events.push(event);
				},
				async close() {
					// no-op
				},
			},
			policy,
		},
		{},
	);

	const policyEvent = events.find(
		(event) =>
			event.type === "policy.decision" &&
			event.ruleId === "block-prod",
	);
	expect(policyEvent).toBeDefined();
	expect((policyEvent as any).acknowledged).toBe(true);
	expect(state.policyDecisions).toEqual(
		expect.arrayContaining([
			{
				ruleId: "block-prod",
				ruleLevel: "block",
				enforcedLevel: "warn",
				acknowledged: true,
				flowId: "flow",
				stepId: "deploy",
				command: "deploy --channel prod",
				note: undefined,
			},
		]),
	);
	});

	it("records successful command execution in the log", async () => {
		const logPath = path.join(tmpDir, "run.log");
		const logWriter = createLogWriter(logPath);

		const state = await executeScenario({
			config: baseConfig,
			scenarioId: "demo",
			repoRoot: tmpDir,
			stdout: new PassThrough(),
			stderr: new PassThrough(),
			dryRun: false,
			quiet: false,
			verbose: false,
			overrides: {},
			logWriter,
		});

		await logWriter.close();

		expect(execaMocks.execaCommand).toHaveBeenCalledTimes(1);
		expect(state.completedSteps).toBe(2);

		const contents = await fs.readFile(logPath, "utf8");
		const events = contents
			.trim()
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line) as { type: string; success?: boolean });

		expect(
			events.some(
				(event) => event.type === "command.result" && event.success === true,
			),
		).toBe(true);
	});

	it("blocks dynamic command options in collect mode", async () => {
		execaMocks.execaCommand.mockClear();

		const config: DevWizardConfig = {
			meta: { name: "Dynamic", version: "1.0.0" },
			scenarios: [{ id: "dynamic", label: "Dynamic", flow: "main" }],
			flows: {
				main: {
					id: "main",
					steps: [
						{
							id: "choose-package",
							type: "prompt",
							mode: "select",
							prompt: "Select package",
							storeAs: "package",
							dynamic: {
								type: "command",
								command: "list-packages",
							},
						},
					],
				},
			},
		};

		await expect(
			executeScenario({
				config,
				scenarioId: "dynamic",
				repoRoot: tmpDir,
				stdout: new PassThrough(),
				stderr: new PassThrough(),
				dryRun: false,
				quiet: false,
				verbose: false,
				overrides: {},
				phase: "collect",
			}),
		).rejects.toThrow(/Collect mode cannot resolve dynamic.command options/);

		expect(execaMocks.execaCommand).not.toHaveBeenCalled();
	});

	it("loads prompt options from dynamic command sources", async () => {
		execaMocks.execaCommand.mockImplementationOnce(() =>
			execaMocks.createProcess({
				stdout: JSON.stringify(["pkg-alpha", "pkg-beta"]),
			}),
		);

		const config: DevWizardConfig = {
			meta: { name: "Dynamic", version: "1.0.0" },
			scenarios: [{ id: "dynamic", label: "Dynamic", flow: "main" }],
			flows: {
				main: {
					id: "main",
					steps: [
						{
							id: "choose-package",
							type: "prompt",
							mode: "select",
							prompt: "Select package",
							storeAs: "package",
							dynamic: {
								type: "command",
								command: "list-packages",
							},
						},
					],
				},
			},
		};

		const state = await executeScenario({
			config,
			scenarioId: "dynamic",
			repoRoot: tmpDir,
			stdout: new PassThrough(),
			stderr: new PassThrough(),
			dryRun: false,
			quiet: false,
			verbose: false,
			overrides: {},
		});

		expect(execaMocks.execaCommand).toHaveBeenCalledWith(
			"list-packages",
			expect.objectContaining({ cwd: tmpDir }),
		);
		expect(promptMocks.select).toHaveBeenCalledWith(
			expect.objectContaining({
				options: expect.arrayContaining([
					expect.objectContaining({ value: "pkg-alpha", label: "pkg-alpha" }),
				]),
			}),
		);
		expect(state.answers.package).toBe("pkg-alpha");
	});

	it("loads prompt options from project tsconfig providers", async () => {
		const projectDir = path.join(tmpDir, "packages", "demo");
		await fs.mkdir(projectDir, { recursive: true });
		await fs.writeFile(path.join(projectDir, "tsconfig.json"), "{}");
		await fs.writeFile(path.join(projectDir, "tsconfig.test.json"), "{}");

		const config: DevWizardConfig = {
			meta: { name: "Project tsconfigs", version: "1.0.0" },
			scenarios: [{ id: "tsconfigs", label: "Project tsconfigs", flow: "main" }],
			flows: {
				main: {
					id: "main",
					steps: [
						{
							id: "choose-tsconfig",
							type: "prompt",
							mode: "select",
							prompt: "Select tsconfig",
							storeAs: "tsconfig",
							dynamic: {
								type: "project-tsconfigs",
								project: "packages/demo",
							},
						},
					],
				},
			},
		};

		const state = await executeScenario({
			config,
			scenarioId: "tsconfigs",
			repoRoot: tmpDir,
			stdout: new PassThrough(),
			stderr: new PassThrough(),
			dryRun: false,
			quiet: false,
			verbose: false,
			overrides: {},
		});

		expect(promptMocks.select).toHaveBeenCalledWith(
			expect.objectContaining({
				options: expect.arrayContaining([
					expect.objectContaining({ value: "tsconfig.json" }),
					expect.objectContaining({ value: "tsconfig.test.json" }),
				]),
			}),
		);
		expect(["tsconfig.json", "tsconfig.test.json"]).toContain(
			state.answers.tsconfig,
		);
	});

	it("iterates over items and stores per-item answers", async () => {
		execaMocks.execaCommand.mockClear();
		execaMocks.execaCommand.mockImplementation(() =>
			execaMocks.createProcess({ stdout: "done" }),
		);

		const config: DevWizardConfig = {
			meta: { name: "Iterate", version: "1.0.0" },
			scenarios: [{ id: "iterate", label: "Iterate", flow: "main" }],
			flows: {
				perPackage: {
					id: "perPackage",
					steps: [
						{
							id: "run-per-package",
							type: "command",
							commands: [
								{
									run: 'echo "{{ state.answers.package }}"',
								},
							],
						},
					],
				},
				main: {
					id: "main",
					steps: [
						{
							id: "iterate-packages",
							type: "iterate",
							items: ["pkg-alpha", "pkg-beta"],
							storeEachAs: "package",
							flow: "perPackage",
						},
					],
				},
			},
		};

		const state = await executeScenario({
			config,
			scenarioId: "iterate",
			repoRoot: tmpDir,
			stdout: new PassThrough(),
			stderr: new PassThrough(),
			dryRun: false,
			quiet: false,
			verbose: false,
			overrides: {},
		});

		expect(state.history).toHaveLength(2);
		expect(execaMocks.execaCommand).toHaveBeenNthCalledWith(
			1,
			'echo "pkg-alpha"',
			expect.any(Object),
		);
		expect(execaMocks.execaCommand).toHaveBeenNthCalledWith(
			2,
			'echo "pkg-beta"',
			expect.any(Object),
		);
		expect(state.answers.package).toBeUndefined();
		expect(state.iteration).toBeUndefined();
	});

	it("stores command output as JSON with redaction", async () => {
		execaMocks.execaCommand.mockClear();
		execaMocks.execaCommand.mockImplementationOnce(() =>
			execaMocks.createProcess({
				stdout: JSON.stringify({ token: "abc", count: 2 }),
			}),
		);

		const config: DevWizardConfig = {
			meta: { name: "Store", version: "1.0.0" },
			scenarios: [{ id: "store", label: "Store", flow: "main" }],
			flows: {
				main: {
					id: "main",
					steps: [
						{
							id: "capture",
							type: "command",
							commands: [
								{
									run: "fetch-data",
									storeStdoutAs: "payload",
									parseJson: true,
									redactKeys: ["token"],
								},
							],
						},
					],
				},
			},
		};

		const state = await executeScenario({
			config,
			scenarioId: "store",
			repoRoot: tmpDir,
			stdout: new PassThrough(),
			stderr: new PassThrough(),
			dryRun: false,
			quiet: false,
			verbose: false,
			overrides: {},
		});

		expect(state.answers.payload).toEqual({ token: "[REDACTED]", count: 2 });
	});

	it("executes commands during dry-run when dryRunStrategy is execute", async () => {
		execaMocks.execaCommand.mockClear();

		const config: DevWizardConfig = {
			meta: { name: "DryRunExecute", version: "1.0.0" },
			scenarios: [
				{ id: "dry-run-execute", label: "Dry Run Execute", flow: "main" },
			],
			flows: {
				main: {
					id: "main",
					steps: [
						{
							id: "collect",
							type: "command",
							commands: [
								{
									run: "gather-projects",
									storeStdoutAs: "projects",
									dryRunStrategy: "execute",
								},
							],
						},
					],
				},
			},
		};

		const state = await executeScenario({
			config,
			scenarioId: "dry-run-execute",
			repoRoot: tmpDir,
			stdout: new PassThrough(),
			stderr: new PassThrough(),
			dryRun: true,
			quiet: false,
			verbose: false,
			overrides: {},
		});

		expect(execaMocks.execaCommand).toHaveBeenCalledTimes(1);
		expect(state.answers.projects).toBe("ok");
	});

		it("warns and keeps raw output when JSON parsing fails with warn option", async () => {
			execaMocks.execaCommand.mockClear();
			execaMocks.execaCommand.mockImplementationOnce(() =>
				execaMocks.createProcess({ stdout: "not-json" }),
			);
			const streams = createCapturedStreams();

		const config: DevWizardConfig = {
			meta: { name: "ParseWarn", version: "1.0.0" },
			scenarios: [{ id: "warn", label: "Warn", flow: "main" }],
			flows: {
				main: {
					id: "main",
					steps: [
						{
							id: "capture",
							type: "command",
							commands: [
								{
									run: "fetch-data",
									storeStdoutAs: "payload",
									parseJson: { onError: "warn" },
								},
							],
						},
					],
				},
			},
		};

			const state = await executeScenario({
				config,
				scenarioId: "warn",
				repoRoot: tmpDir,
				stdout: streams.stdout,
				stderr: streams.stderr,
				dryRun: false,
				quiet: false,
				verbose: false,
				overrides: {},
			});

			expect(streams.getStderr()).toContain("Failed to parse JSON output");
			expect(state.answers.payload).toBe("not-json");
		});

	it("stores output on failure when configured", async () => {
		execaMocks.execaCommand.mockClear();
		execaMocks.execaCommand.mockImplementationOnce(() =>
			execaMocks.createFailure({
				stdout: JSON.stringify({ status: "failed" }),
				message: "oops",
			}),
		);

		const config: DevWizardConfig = {
			meta: { name: "FailureStore", version: "1.0.0" },
			scenarios: [{ id: "failure", label: "Failure", flow: "main" }],
			flows: {
				main: {
					id: "main",
					steps: [
						{
							id: "maybe-fail",
							type: "command",
							continueOnError: true,
							commands: [
								{
									run: "might-fail",
									storeStdoutAs: "failurePayload",
									parseJson: true,
									storeWhen: "failure",
								},
							],
						},
					],
				},
			},
		};

		const state = await executeScenario({
			config,
			scenarioId: "failure",
			repoRoot: tmpDir,
			stdout: new PassThrough(),
			stderr: new PassThrough(),
			dryRun: false,
			quiet: false,
			verbose: false,
			overrides: {},
		});

		expect(state.answers.failurePayload).toEqual({ status: "failed" });
		expect(state.failedSteps).toBe(1);
	});

	it("fails when JSON parsing fails without warn", async () => {
		execaMocks.execaCommand.mockClear();
		execaMocks.execaCommand.mockImplementationOnce(() =>
			execaMocks.createProcess({ stdout: "not-json" }),
		);

		const config: DevWizardConfig = {
			meta: { name: "ParseFail", version: "1.0.0" },
			scenarios: [{ id: "fail", label: "Fail", flow: "main" }],
			flows: {
				main: {
					id: "main",
					steps: [
						{
							id: "capture",
							type: "command",
							commands: [
								{
									run: "fetch-data",
									storeStdoutAs: "payload",
									parseJson: true,
								},
							],
						},
					],
				},
			},
		};

		await expect(
			executeScenario({
				config,
				scenarioId: "fail",
				repoRoot: tmpDir,
				stdout: new PassThrough(),
				stderr: new PassThrough(),
				dryRun: false,
				quiet: false,
				verbose: false,
				overrides: {},
			}),
		).rejects.toThrow(/Failed to parse JSON output/);
	});

		it("logs additional command details when verbose mode is enabled", async () => {
			const streams = createCapturedStreams();

			await executeScenario({
				config: baseConfig,
				scenarioId: "demo",
				repoRoot: tmpDir,
				stdout: streams.stdout,
				stderr: streams.stderr,
				dryRun: false,
				quiet: false,
				verbose: true,
				overrides: {},
			});

			expect(streams.getStdout()).toContain("→ ");
			expect(streams.getStdout()).toContain("✓");
		});

		it("suppresses progress logs when quiet mode is enabled", async () => {
			const logPath = path.join(tmpDir, "quiet.log");
			const logWriter = createLogWriter(logPath);
			const streams = createCapturedStreams();

			await executeScenario({
				config: baseConfig,
				scenarioId: "demo",
				repoRoot: tmpDir,
				stdout: streams.stdout,
				stderr: streams.stderr,
				dryRun: false,
				quiet: true,
				verbose: false,
				overrides: {},
				logWriter,
			});

			await logWriter.close();

			expect(streams.getStdout()).not.toMatch(/\[1\/2\]/);
		});

	it("respects CLI overrides and skips interactive prompts", async () => {
		const overrideConfig: DevWizardConfig = {
			meta: { name: "Override Test", version: "1.0.0" },
			scenarios: [{ id: "override", label: "Override", flow: "override-flow" }],
			flows: {
				"override-flow": {
					id: "override-flow",
					steps: [
						{
							id: "ask-name",
							type: "prompt",
							mode: "input",
							prompt: "Name?",
							storeAs: "name",
						},
						{
							id: "confirm-flag",
							type: "prompt",
							mode: "confirm",
							prompt: "Continue?",
							storeAs: "continueFlag",
						},
						{
							id: "select-option",
							type: "prompt",
							mode: "select",
							prompt: "Pick one",
							storeAs: "choice",
							options: [
								{ label: "Option A", value: "a" },
								{ label: "Option B", value: "b" },
							],
						},
						{
							id: "choose-many",
							type: "prompt",
							mode: "multiselect",
							prompt: "Pick many",
							storeAs: "many",
							options: [
								{ label: "One", value: "1" },
								{ label: "Two", value: "2" },
								{ label: "Three", value: "3" },
							],
						},
						{
							id: "done",
							type: "message",
							level: "success",
							text: "Override complete",
						},
					],
				},
			},
		};

		const state = await executeScenario({
			config: overrideConfig,
			scenarioId: "override",
			repoRoot: tmpDir,
			stdout: new PassThrough(),
			stderr: new PassThrough(),
			dryRun: false,
			quiet: false,
			verbose: false,
			overrides: {
				name: "OverrideName",
				continueFlag: "no",
				choice: "b",
				many: "1,3",
			},
		});

		expect(textPromptMock.createTextPromptWithHistory).not.toHaveBeenCalled();
		expect(promptMocks.confirm).not.toHaveBeenCalled();
		expect(promptMocks.select).not.toHaveBeenCalled();
		expect(promptMocks.multiselect).not.toHaveBeenCalled();

		expect(state.answers.name).toBe("OverrideName");
		expect(state.answers.continueFlag).toBe(false);
		expect(state.answers.choice).toBe("b");
		expect(state.answers.many).toEqual(["1", "3"]);
	});

it("supports non-string override values", async () => {
	const config: DevWizardConfig = {
		meta: { name: "Typed Overrides", version: "1.0.0" },
		scenarios: [{ id: "typed", label: "Typed", flow: "typed-flow" }],
			flows: {
				"typed-flow": {
					id: "typed-flow",
					steps: [
						{
							id: "branch-name",
							type: "prompt",
							mode: "input",
							prompt: "Branch?",
							storeAs: "branch",
						},
						{
							id: "ship-it",
							type: "prompt",
							mode: "confirm",
							prompt: "Ship it?",
							storeAs: "shipIt",
						},
						{
							id: "targets",
							type: "prompt",
							mode: "multiselect",
							prompt: "Targets",
							options: [
								{ label: "Web", value: "web" },
								{ label: "Mobile", value: "mobile" },
							],
							storeAs: "targets",
						},
						{
							id: "finish",
							type: "message",
							text: "done",
						},
					],
				},
			},
		};

		const state = await executeScenario({
			config,
			scenarioId: "typed",
			repoRoot: tmpDir,
			stdout: new PassThrough(),
			stderr: new PassThrough(),
			dryRun: false,
			quiet: false,
			verbose: true,
			overrides: {
				branch: "release/1.2.3",
				shipIt: true,
				targets: ["web", "mobile"],
			},
		});

		expect(state.answers.branch).toBe("release/1.2.3");
		expect(state.answers.shipIt).toBe(true);
	expect(state.answers.targets).toEqual(["web", "mobile"]);
});


describe("checkpoints and resume", () => {
	it("writes checkpoints to disk and loads them back", async () => {
		const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "wizard-checkpoint-"));
		const config: DevWizardConfig = {
			meta: { name: "Checkpoint Demo", version: "0.0.1" },
			flows: {
				main: {
					id: "main",
					steps: [
						{
							id: "intro",
							type: "message",
							level: "info",
							text: "hi",
						},
					],
				},
			},
			scenarios: [
				{
					id: "demo",
					label: "Demo",
					flow: "main",
				},
			],
		};

		const checkpoint = await createCheckpointManager({
			repoRoot: tmpDir,
			scenarioId: "demo",
			scenarioLabel: "Demo",
			dryRun: true,
			interval: 1,
			retention: 5,
		});

		const state = await executeScenario(
			{
				config,
				scenarioId: "demo",
				repoRoot: tmpDir,
				stdout: new PassThrough(),
				stderr: new PassThrough(),
				dryRun: true,
				quiet: false,
				verbose: false,
				overrides: {},
				logWriter: undefined,
				promptOptionsCache: new Map(),
				checkpoint,
			},
			{ checkpoint },
			);

		await checkpoint?.finalize(state, "completed");

		const runId = checkpoint?.runId ?? state.runId!;
		const restored = await loadCheckpoint({
			repoRoot: tmpDir,
			identifier: runId,
		});

		expect(restored.metadata.status).toBe("completed");
		expect(restored.state.phase).toBe("complete");
		expect(restored.state.flowRuns.length).toBeGreaterThan(0);

		await fs.rm(tmpDir, { recursive: true, force: true });
	});

	it("resumes scenario execution from a checkpoint after failure", async () => {
		const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "wizard-resume-"));
		const config: DevWizardConfig = {
			meta: { name: "Checkpoint Resume", version: "0.0.1" },
			flows: {
				main: {
					id: "main",
					steps: [
						{
							id: "name",
							type: "prompt",
							mode: "input",
							prompt: "name?",
							storeAs: "name",
						},
						{
							id: "command",
							type: "command",
							commands: [
								{
									run: "echo boom",
								},
							],
						},
					],
				},
			},
			scenarios: [
				{
					id: "demo",
					label: "Demo Resume",
					flow: "main",
				},
			],
		};

		execaMocks.execaCommand.mockReset();
		execaMocks.execaCommand.mockImplementation(() =>
			execaMocks.createProcess(),
		);
		execaMocks.execaCommand.mockImplementationOnce(() =>
			execaMocks.createFailure({ message: "command failed" }),
		);

		const checkpoint = await createCheckpointManager({
			repoRoot: tmpDir,
			scenarioId: "demo",
			scenarioLabel: "Demo Resume",
			dryRun: false,
			interval: 1,
			retention: 5,
		});

		promptMocks.select.mockResolvedValueOnce("exit");

		const failingState = await executeScenario(
			{
				config,
				scenarioId: "demo",
				repoRoot: tmpDir,
				stdout: new PassThrough(),
				stderr: new PassThrough(),
				dryRun: false,
				quiet: false,
				verbose: false,
				overrides: {},
				logWriter: undefined,
				promptOptionsCache: new Map(),
				checkpoint,
			},
			{ checkpoint },
		);
		expect(failingState.failedSteps).toBeGreaterThan(0);
		expect(failingState.exitedEarly).toBe(true);

		await checkpoint?.finalize(failingState, "failed");

		const runId = checkpoint?.runId ?? failingState!.runId!;
		const restored = await loadCheckpoint({
			repoRoot: tmpDir,
			identifier: runId,
		});

		expect(restored.state.stepCursor).toBeDefined();
		expect(restored.metadata.status).toBe("failed");

		execaMocks.execaCommand.mockImplementation(() =>
			execaMocks.createProcess(),
		);

		const resumeManager = await createCheckpointManager({
			repoRoot: tmpDir,
			scenarioId: "demo",
			scenarioLabel: "Demo Resume",
			runId,
			dryRun: false,
			interval: 1,
			retention: 5,
		});

		const resumedState = await executeScenario(
			{
				config,
				scenarioId: "demo",
				repoRoot: tmpDir,
				stdout: new PassThrough(),
				stderr: new PassThrough(),
				dryRun: false,
				quiet: false,
				verbose: false,
				overrides: {},
				logWriter: undefined,
				promptOptionsCache: new Map(),
				checkpoint: resumeManager,
			},
			{
				initialState: restored.state,
				checkpoint: resumeManager,
			},
			);

		await resumeManager?.finalize(resumedState, "completed");

		expect(resumedState.failedSteps).toBeGreaterThanOrEqual(1);
		expect(resumedState.exitedEarly).toBe(false);

		execaMocks.execaCommand.mockImplementation(() => execaMocks.createProcess());
		await fs.rm(tmpDir, { recursive: true, force: true });
	});
});


	it("applies command presets and defaults and flags long-running commands", async () => {
		const config: DevWizardConfig = {
			meta: { name: "Presets", version: "1.0.0" },
			commandPresets: {
				shell: {
					shell: true,
					env: { PRESET: "1" },
					description: "Common shell execution defaults",
					tags: ["shell", "shared"],
				},
			},
			scenarios: [{ id: "preset", label: "Preset", flow: "main" }],
			flows: {
				main: {
					id: "main",
					steps: [
						{
							id: "run",
							type: "command",
							defaults: {
								cwd: "./scripts",
								env: { DEFAULT: "yes" },
								preset: "shell",
								warnAfterMs: 0,
							},
							commands: [
								{
									run: "echo hi",
									env: { LOCAL: "value" },
								},
							],
						},
					],
				},
			},
		};

			execaMocks.execaCommand.mockImplementationOnce(() =>
				execaMocks.createProcess({ stdout: "hi" }),
			);
			const streams = createCapturedStreams();

			const state = await executeScenario({
				config,
				scenarioId: "preset",
				repoRoot: tmpDir,
				stdout: streams.stdout,
				stderr: streams.stderr,
				dryRun: false,
				quiet: false,
				verbose: false,
				overrides: {},
			});

		expect(execaMocks.execaCommand).toHaveBeenCalledTimes(1);
		const firstCall = execaMocks.execaCommand.mock.calls[0] as
			| unknown[]
			| undefined;
		const callOptions = (firstCall?.[1] ?? {}) as {
			cwd?: string;
			env?: Record<string, string>;
			shell?: boolean;
		};
		expect(callOptions.cwd).toBe("./scripts");
		expect(callOptions.shell).toBe(true);
		expect(callOptions.env).toMatchObject({
			PRESET: "1",
			DEFAULT: "yes",
			LOCAL: "value",
		});
		expect(
			Object.prototype.hasOwnProperty.call(callOptions, "description"),
		).toBe(false);
		expect(
			Object.prototype.hasOwnProperty.call(callOptions, "tags"),
		).toBe(false);
		const resolvedPreset = getResolvedCommandPreset(config, "shell");
		expect(resolvedPreset?.definition.description).toBe(
			"Common shell execution defaults",
		);
		expect(resolvedPreset?.definition.tags).toEqual(["shell", "shared"]);
			expect(resolvedPreset?.sources).toHaveLength(0);
			expect(state.history[0]?.warnAfterMs).toBe(0);
			expect(state.history[0]?.longRunning).toBe(true);
			expect(streams.getStderr()).toContain("exceeded");
			expect(streams.getStderr()).toContain("echo hi");
		});

	it("enforces validation rules for overrides", async () => {
		const validationConfig: DevWizardConfig = {
			meta: { name: "Validation Test", version: "1.0.0" },
			scenarios: [{ id: "validation", label: "Validation", flow: "validation-flow" }],
			flows: {
				"validation-flow": {
					id: "validation-flow",
					steps: [
						{
							id: "code",
							type: "prompt",
							mode: "input",
							prompt: "Enter three digits",
							storeAs: "code",
							validation: {
								regex: "^\\d{3}$",
								message: "Provide three digits.",
							},
						},
						{
							id: "pick",
							type: "prompt",
							mode: "multiselect",
							prompt: "Pick at least two options",
							storeAs: "choices",
							options: [
								{ label: "One", value: "1" },
								{ label: "Two", value: "2" },
								{ label: "Three", value: "3" },
							],
							validation: {
								minLength: 2,
								message: "Choose at least two options.",
							},
						},
					],
				},
			},
		};

	await expect(
		executeScenario({
			config: validationConfig,
			scenarioId: "validation",
			repoRoot: tmpDir,
			stdout: new PassThrough(),
			stderr: new PassThrough(),
			dryRun: false,
			quiet: false,
			verbose: false,
			overrides: {
				code: "12a",
				pick: "1",
			},
		}),
	).rejects.toThrow(/Provide three digits/);

	const state = await executeScenario({
		config: validationConfig,
		scenarioId: "validation",
		repoRoot: tmpDir,
		stdout: new PassThrough(),
		stderr: new PassThrough(),
		dryRun: false,
		quiet: false,
		verbose: false,
		overrides: {
			code: "123",
			pick: "1,3",
		},
	});

	expect(state.answers.code).toBe("123");
	expect(state.answers.choices).toEqual(["1", "3"]);
});
	it("builds preview plan with overrides and branch decisions", async () => {
		const config: DevWizardConfig = {
			meta: { name: "Preview", version: "1.0.0" },
			commandPresets: {
				shell: {
					shell: true,
					env: { PRESET: "1" },
				},
			},
			scenarios: [{ id: "demo", label: "Demo", flow: "main" }],
			flows: {
				main: {
					id: "main",
					steps: [
						{
							id: "channel",
							type: "prompt",
							mode: "select",
							prompt: "Select release channel",
							storeAs: "channel",
							required: true,
							options: [
								{ label: "Alpha", value: "alpha" },
								{ label: "Beta", value: "beta" },
							],
						},
						{
							id: "branch",
							type: "branch",
					branches: [
						{
							when: "answers.channel === 'beta'",
							next: "beta-step",
							description: "Deploy beta channels",
						},
					],
							defaultNext: { next: "alpha-step" },
						},
						{
							id: "alpha-step",
							type: "command",
							defaults: {
								preset: "shell",
								env: { DEFAULT: "alpha" },
							},
							commands: [
								{
									run: "deploy --channel alpha",
								},
							],
						},
						{
							id: "beta-step",
							type: "command",
							defaults: {
								preset: "shell",
								env: { DEFAULT: "beta" },
							},
							commands: [
								{
									run: "deploy --channel {{state.answers.channel}}",
									env: { LOCAL: "value" },
								},
							],
							summary: "Deploy beta channel",
						},
						{
							id: "complete",
							type: "message",
							level: "success",
							text: "Done!",
						},
					],
				},
			},
		};

	const plan = await buildScenarioPlan(
		{
				config,
				scenarioId: "demo",
				repoRoot: tmpDir,
				stdout: new PassThrough(),
				stderr: new PassThrough(),
				dryRun: false,
				quiet: false,
				verbose: false,
				overrides: { channel: "beta" },
				logWriter: undefined,
				promptOptionsCache: new Map(),
				checkpoint: undefined,
			},
			{},
		);

		expect(plan.pendingPromptCount).toBe(0);
		expect(plan.flows).toHaveLength(1);
		const steps = plan.flows[0]!.steps;
		expect(steps).toHaveLength(4);
		const promptStep = steps[0] as any;
		const branchStep = steps[1] as any;
		const commandStep = steps[2] as any;
		const messageStep = steps[3] as any;
		expect(promptStep.kind).toBe("prompt");
		expect(promptStep.answerSource).toBe("override");
		expect(branchStep.kind).toBe("branch");
		expect(branchStep.selectedTarget).toBe("beta-step");
		expect(commandStep.kind).toBe("command");
		expect(commandStep.commands[0]?.run).toBe("deploy --channel beta");
		expect(commandStep.commands[0]?.envDiff).toMatchObject([
			{ key: "PRESET", source: "preset", value: "1" },
			{ key: "DEFAULT", source: "defaults", value: "beta" },
			{ key: "LOCAL", source: "command", value: "value" },
		]);
		expect(messageStep.kind).toBe("message");

	const ansiEscape = String.fromCharCode(0x1b);
	const ansiCodesPattern = new RegExp(`${ansiEscape}\\[[0-9;]*m`, "g");
	const collapsed = formatScenarioPlanPretty(plan)
		.replace(ansiCodesPattern, "")
		.replace(/\r\n/g, "\n");
	expect(collapsed).toMatchSnapshot();
	expect(collapsed).toContain("env diffs: (hidden — use --plan-expand env)");
	expect(collapsed).toContain("branch rationales: (hidden — use --plan-expand branches)");
	plan.preferences = {
		expandEnv: true,
		expandTemplates: true,
		expandBranches: true,
	};
	const expanded = formatScenarioPlanPretty(plan)
		.replace(ansiCodesPattern, "")
		.replace(/\r\n/g, "\n");
	expect(expanded).toMatchSnapshot();
	expect(expanded).toContain("shell:");
	expect(expanded).toContain("env:");
	const ndjsonPlan = formatScenarioPlanNdjson(plan);
	const preferencesEvent = ndjsonPlan.find((line) =>
		line.includes("\"plan.preferences\""),
	);
	expect(preferencesEvent).toBeDefined();
	expect(preferencesEvent).toContain("\"expandEnv\":true");
	});

	it("renders compute steps in the plan and applies them during execution", async () => {
		const originalUser = process.env.USER;
		process.env.USER = "codex";

		try {
			const config: DevWizardConfig = {
				meta: { name: "Compute", version: "1.0.0" },
				scenarios: [{ id: "compute", label: "Compute", flow: "main" }],
				flows: {
					main: {
						id: "main",
						steps: [
							{
								id: "set-values",
								type: "compute",
								values: {
									greeting: "Hello {{ env.USER }}",
									profile: { user: "{{ env.USER }}" },
									count: 2,
								},
							},
							{
								id: "announce",
								type: "message",
								level: "info",
								text: "{{ state.answers.greeting }}",
							},
						],
					},
				},
			};

			const plan = await buildScenarioPlan({
				config,
				scenarioId: "compute",
				repoRoot: tmpDir,
				stdout: new PassThrough(),
				stderr: new PassThrough(),
				dryRun: true,
				quiet: true,
				verbose: false,
				overrides: {},
				logWriter: undefined,
				promptOptionsCache: new Map(),
				checkpoint: undefined,
			});

			const computeStep = plan.flows[0]?.steps[0] as any;
			expect(computeStep.kind).toBe("compute");
			expect(computeStep.values).toEqual({
				greeting: "Hello codex",
				profile: { user: "codex" },
				count: 2,
			});

			const state = await executeScenario({
				config,
				scenarioId: "compute",
				repoRoot: tmpDir,
				stdout: new PassThrough(),
				stderr: new PassThrough(),
				dryRun: true,
				quiet: true,
				verbose: false,
				overrides: {},
			});

			expect(state.answers.greeting).toBe("Hello codex");
			expect(state.answers.profile).toEqual({ user: "codex" });
			expect(state.answers.count).toBe(2);
		} finally {
			process.env.USER = originalUser;
		}
	});

	it("runs workspace-projects compute handlers", async () => {
		await fs.writeFile(
			path.join(tmpDir, "package.json"),
			JSON.stringify({ name: "root" }),
		);
		await fs.mkdir(path.join(tmpDir, "packages/app"), { recursive: true });
		await fs.writeFile(
			path.join(tmpDir, "packages/app/package.json"),
			JSON.stringify({ name: "pkg-app" }),
		);

		const config: DevWizardConfig = {
			meta: { name: "Compute Handler", version: "1.0.0" },
			scenarios: [{ id: "compute", label: "Compute", flow: "main" }],
			flows: {
				main: {
					id: "main",
					steps: [
						{
							id: "projects",
							type: "compute",
							handler: "workspace-projects",
							storeAs: "projects",
						params: {
							includeRoot: true,
							maxDepth: 2,
							selectedProjects: [".", "packages/app"],
						},
					},
				],
			},
			},
		};

		const plan = await buildScenarioPlan({
			config,
			scenarioId: "compute",
			repoRoot: tmpDir,
			stdout: new PassThrough(),
			stderr: new PassThrough(),
			dryRun: true,
			quiet: true,
			verbose: false,
			overrides: {},
			logWriter: undefined,
			promptOptionsCache: new Map(),
			checkpoint: undefined,
		});

		const planProjects = (plan.flows[0]?.steps[0] as any)?.values?.projects ?? [];
		expect(planProjects.length).toBe(2);

		const state = await executeScenario({
			config,
			scenarioId: "compute",
			repoRoot: tmpDir,
			stdout: new PassThrough(),
			stderr: new PassThrough(),
			dryRun: true,
			quiet: true,
			verbose: false,
			overrides: {},
		});

		const projects = state.answers.projects as Array<{ id: string }>;
		const ids = projects.map((project) => project.id).sort();
		expect(ids).toEqual([".", "packages/app"]);
	});

	it("parses template-json compute handler results", async () => {
		const config: DevWizardConfig = {
			meta: { name: "Template JSON", version: "1.0.0" },
			scenarios: [{ id: "compute", label: "Compute", flow: "main" }],
			flows: {
				main: {
					id: "main",
					steps: [
						{
							id: "payload",
							type: "compute",
							handler: "template-json",
							storeAs: "payload",
							params: {
								value: "{{ json (array 'alpha' 'beta') }}",
							},
						},
					],
				},
			},
		};

		const state = await executeScenario({
			config,
			scenarioId: "compute",
			repoRoot: tmpDir,
			stdout: new PassThrough(),
			stderr: new PassThrough(),
			dryRun: true,
			quiet: true,
			verbose: false,
			overrides: {},
		});

		expect(state.answers.payload).toEqual(["alpha", "beta"]);
	});

	it("builds maintenance window identifiers with compute handlers", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2025-01-15T12:00:00Z"));

		try {
			const config: DevWizardConfig = {
				meta: { name: "Maintenance Window", version: "1.0.0" },
				scenarios: [{ id: "compute", label: "Compute", flow: "main" }],
				flows: {
					main: {
						id: "main",
						steps: [
							{
								id: "window",
								type: "compute",
								handler: "maintenance-window",
								storeAs: "window",
								params: {
									cadence: "daily",
									name: "Daily Maintenance",
								},
							},
						],
					},
				},
			};

			const state = await executeScenario({
				config,
				scenarioId: "compute",
				repoRoot: tmpDir,
				stdout: new PassThrough(),
				stderr: new PassThrough(),
				dryRun: true,
				quiet: true,
				verbose: false,
				overrides: {},
			});

			expect(state.answers.window).toEqual({
				identifier: "2025-01-15-daily-maintenance",
				base: "daily-maintenance",
				cadence: "daily",
			});
		} finally {
			vi.useRealTimers();
		}
	});

	it("detects tsconfig candidates via compute handler", async () => {
		await fs.mkdir(path.join(tmpDir, "packages/app"), { recursive: true });
		await fs.writeFile(
			path.join(tmpDir, "packages/app/tsconfig.test.json"),
			JSON.stringify({}),
		);

		const config: DevWizardConfig = {
			meta: { name: "Detect Tsconfig", version: "1.0.0" },
			scenarios: [{ id: "compute", label: "Compute", flow: "main" }],
			flows: {
				main: {
					id: "main",
					steps: [
						{
							id: "detect",
							type: "compute",
							handler: "detect-project-tsconfig",
							storeAs: "tsconfig",
							params: {
								repoRoot: tmpDir,
								target: "packages/app",
							},
						},
					],
				},
			},
		};

		const state = await executeScenario({
			config,
			scenarioId: "compute",
			repoRoot: tmpDir,
			stdout: new PassThrough(),
			stderr: new PassThrough(),
			dryRun: true,
			quiet: true,
			verbose: false,
			overrides: {},
		});

		expect(state.answers.tsconfig).toBe("tsconfig.test.json");
	});

	it("renders typecheck commands via compute handler", async () => {
		await fs.writeFile(
			path.join(tmpDir, "pnpm-workspace.yaml"),
			"packages:\n  - packages/*\n",
		);

		const config: DevWizardConfig = {
			meta: { name: "Render Typecheck", version: "1.0.0" },
			scenarios: [{ id: "compute", label: "Compute", flow: "main" }],
			flows: {
				main: {
					id: "main",
					steps: [
						{
							id: "render",
							type: "compute",
							handler: "render-typecheck-command",
							storeAs: "command",
							params: {
								tsconfig: "tsconfig.test.json",
								cwd: "packages/app",
								compilerOptions: "{\"skipLibCheck\":true}",
								repoRoot: tmpDir,
							},
						},
					],
				},
			},
		};

		const state = await executeScenario({
			config,
			scenarioId: "compute",
			repoRoot: tmpDir,
			stdout: new PassThrough(),
			stderr: new PassThrough(),
			dryRun: true,
			quiet: true,
			verbose: false,
			overrides: {},
		});

		const command = state.answers.command as string;
		expect(command).toContain("pnpm exec tsx");
		expect(command).toContain("packages/dev-wizard-presets/scripts/typecheck.ts");
		expect(command).toContain("--tsconfig tsconfig.test.json");
		expect(command).toContain("--cwd packages/app");
		expect(command).toContain("skipLibCheck");
	});

	it("collects then executes maintenance preset flows without prompts", async () => {
		const configPath = path.resolve(
			testDir,
			"..",
			"..",
			"..",
			"dev-wizard-presets",
			"maintenance",
			"index.yaml",
		);
		const config = await loadConfig({ configPaths: configPath });

		const overrides = {
			maintenanceWindowCadence: "weekly",
			maintenanceWindowName: "weekly-maintenance",
			maintenanceTasks: ["clean-cache"],
			maintenanceTaskFailureStrategy: "abort",
			maintenanceNotes: "",
		};

		const collectState = await executeScenario({
			config,
			scenarioId: "maintenance-window",
			repoRoot: tmpDir,
			stdout: new PassThrough(),
			stderr: new PassThrough(),
			dryRun: true,
			quiet: true,
			verbose: false,
			overrides,
			phase: "collect",
			nonInteractive: true,
			promptDriver: new NonInteractivePromptDriver(),
		});

		const collectFlows = collectState.flowRuns.map((flow) => flow.flowId);
		expect(collectFlows).toEqual(["choose-maintenance-tasks"]);
		expect(collectState.answers.maintenanceWindow).toMatch(/weekly-maintenance$/);

		const executeState = await executeScenario({
			config,
			scenarioId: "maintenance-window",
			repoRoot: tmpDir,
			stdout: new PassThrough(),
			stderr: new PassThrough(),
			dryRun: true,
			quiet: true,
			verbose: false,
			overrides: collectState.answers,
			phase: "execute",
			nonInteractive: true,
			promptDriver: new NonInteractivePromptDriver(),
		});

		const executeFlows = executeState.flowRuns.map((flow) => flow.flowId);
		expect(executeFlows).toEqual([
			"choose-maintenance-tasks",
			"perform-maintenance",
			"wrap-up",
		]);
		expect(executeState.answers.maintenanceTasks).toEqual(["clean-cache"]);
	});

	it("collects then executes projects preset flows without prompts", async () => {
		const createProcess = (stdout: string) =>
			Object.assign(
				Promise.resolve({ exitCode: 0, stdout, stderr: "" }),
				{ stdout: undefined, stderr: undefined },
			);
		execaMocks.execaCommand.mockImplementation((command: unknown) => {
			const commandText = typeof command === "string" ? command : String(command);
			if (commandText.includes("previewWorkflowCommand.ts")) {
				return createProcess('{"preview":"cmd","run":"cmd"}');
			}
			return createProcess("ok");
		});

		await fs.writeFile(
			path.join(tmpDir, "package.json"),
			JSON.stringify({ name: "root" }),
		);
		await fs.mkdir(path.join(tmpDir, "packages/app"), { recursive: true });
		await fs.writeFile(
			path.join(tmpDir, "packages/app/package.json"),
			JSON.stringify({ name: "app" }),
		);
		await fs.writeFile(
			path.join(tmpDir, "COMMIT.SUMMARY.md"),
			"chore(repo): automation snapshot",
		);

		const configPath = path.resolve(
			testDir,
			"..",
			"..",
			"..",
			"dev-wizard-presets",
			"projects",
			"index.yaml",
		);
		const config = await loadConfig({ configPaths: configPath });

		const overrides = {
			selectedProjects: ["packages/app"],
			selectedWorkflows: ["git-commit"],
			dirtyWorktreeCommitMessageMode: "file",
			dirtyWorktreeStrategy: "proceed",
		};

		const collectState = await executeScenario({
			config,
			scenarioId: "multi-project-orchestration",
			repoRoot: tmpDir,
			stdout: new PassThrough(),
			stderr: new PassThrough(),
			dryRun: true,
			quiet: true,
			verbose: false,
			overrides,
			phase: "collect",
			nonInteractive: true,
			promptDriver: new NonInteractivePromptDriver(),
		});

		const collectFlows = collectState.flowRuns.map((flow) => flow.flowId);
		expect(collectFlows).toEqual(["collect-projects"]);
		expect(collectState.answers.dirtyWorktreeCommitMessage).toContain(
			"automation snapshot",
		);

		const executeState = await executeScenario({
			config,
			scenarioId: "multi-project-orchestration",
			repoRoot: tmpDir,
			stdout: new PassThrough(),
			stderr: new PassThrough(),
			dryRun: true,
			quiet: true,
			verbose: false,
			overrides: collectState.answers,
			phase: "execute",
			nonInteractive: true,
			promptDriver: new NonInteractivePromptDriver(),
		});

		const executeFlows = executeState.flowRuns.map((flow) => flow.flowId);
		expect(executeFlows).toEqual([
			"collect-projects",
			"execute-project-workflows",
		]);
		expect(executeState.answers.selectedProjects).toEqual(["packages/app"]);
	});

	it("fails when interactive prompt input violates validation rules", async () => {
		const validationConfig: DevWizardConfig = {
			meta: { name: "Prompt Validation", version: "1.0.0" },
			scenarios: [{ id: "prompt-validation", label: "Prompt Validation", flow: "flow" }],
			flows: {
				flow: {
					id: "flow",
					steps: [
						{
							id: "interactive-code",
							type: "prompt",
							mode: "input",
							prompt: "Enter three digits",
							storeAs: "code",
							validation: {
								regex: "^\\d{3}$",
								message: "Provide three digits.",
							},
						},
					],
				},
			},
		};

		textPromptMock.createTextPromptWithHistory.mockResolvedValueOnce("12a");

		await expect(
			executeScenario({
				config: validationConfig,
				scenarioId: "prompt-validation",
				repoRoot: tmpDir,
				stdout: new PassThrough(),
				stderr: new PassThrough(),
				dryRun: false,
				quiet: false,
				verbose: false,
				overrides: {},
			}),
		).rejects.toThrow("Provide three digits.");
		expect(textPromptMock.createTextPromptWithHistory).toHaveBeenCalledTimes(1);
	});

	it("reuses prompt history for text inputs and records new entries", async () => {
		const config: DevWizardConfig = {
			meta: { name: "Prompt History", version: "1.0.0" },
			scenarios: [{ id: "history-demo", label: "History Demo", flow: "flow" }],
			flows: {
				flow: {
					id: "flow",
					steps: [
						{
							id: "interactive-name",
							type: "prompt",
							mode: "input",
							prompt: "Name?",
							storeAs: "developerName",
						},
					],
				},
			},
		};

		const existingHistory = ["Alice", "Bob"];
		const promptHistory: PromptHistoryManager = {
			getAll: vi.fn(() => existingHistory),
			record: vi.fn(),
			close: vi.fn(async () => undefined),
		};

		textPromptMock.createTextPromptWithHistory.mockResolvedValueOnce("Charlie");

		const finalState = await executeScenario(
			{
				config,
				scenarioId: "history-demo",
				repoRoot: tmpDir,
				stdout: new PassThrough(),
				stderr: new PassThrough(),
				dryRun: false,
				quiet: false,
				verbose: false,
				overrides: {},
				promptHistory,
			},
			{},
		);

		expect(promptHistory.getAll).toHaveBeenCalledWith("developerName");
		expect(textPromptMock.createTextPromptWithHistory).toHaveBeenCalledWith(
			expect.objectContaining({
				history: existingHistory,
			}),
		);
		expect(promptHistory.record).toHaveBeenCalledWith("developerName", "Charlie");
		expect(finalState.answers.developerName).toBe("Charlie");
	});

	it("automatically retries a failing command when auto retry is configured", async () => {
		const config: DevWizardConfig = {
			meta: { name: "Auto Retry", version: "1.0.0" },
			scenarios: [{ id: "auto-retry", label: "Auto Retry", flow: "auto-flow" }],
			flows: {
				"auto-flow": {
					id: "auto-flow",
					steps: [
						{
							id: "auto-command",
							type: "command",
							commands: [{ run: "pnpm retry-me" }],
							onError: {
								auto: { strategy: "retry", limit: 2 },
							},
						},
					],
				},
			},
		};

		execaMocks.execaCommand
			.mockImplementationOnce(() =>
				execaMocks.createFailure({ message: "first failure", exitCode: 1 }),
			)
			.mockImplementationOnce(() =>
				execaMocks.createFailure({ message: "second failure", exitCode: 1 }),
			)
			.mockImplementationOnce(() =>
				execaMocks.createProcess({ stdout: "success" }),
			);

		const state = await executeScenario({
			config,
			scenarioId: "auto-retry",
			repoRoot: tmpDir,
			stdout: new PassThrough(),
			stderr: new PassThrough(),
			dryRun: false,
			quiet: false,
			verbose: false,
			overrides: {},
		});

		expect(execaMocks.execaCommand).toHaveBeenCalledTimes(3);
		expect(promptMocks.select).not.toHaveBeenCalled();
		expect(state.retries).toHaveLength(2);
		expect(state.autoActionCounts["auto-flow:auto-command"]).toBe(2);
	});

	it("falls back to prompting after auto retry limit is reached", async () => {
		const config: DevWizardConfig = {
			meta: { name: "Auto Limit", version: "1.0.0" },
			scenarios: [{ id: "auto-limit", label: "Auto Limit", flow: "limit-flow" }],
			flows: {
				"limit-flow": {
					id: "limit-flow",
					steps: [
						{
							id: "limit-command",
							type: "command",
							commands: [{ run: "pnpm still-broken" }],
							onError: {
								auto: { strategy: "retry", limit: 1 },
								actions: [
									{ label: "Skip", next: "finish" },
									{ label: "Abort", next: "exit" },
								],
							},
						},
						{
							id: "finish",
							type: "message",
							level: "success",
							text: "Done",
						},
					],
				},
			},
		};

		execaMocks.execaCommand
			.mockImplementationOnce(() =>
				execaMocks.createFailure({ message: "first failure" }),
			)
			.mockImplementationOnce(() =>
				execaMocks.createFailure({ message: "second failure" }),
			);

		promptMocks.select.mockImplementationOnce(async () => "exit");

		const state = await executeScenario({
			config,
			scenarioId: "auto-limit",
			repoRoot: tmpDir,
			stdout: new PassThrough(),
			stderr: new PassThrough(),
			dryRun: false,
			quiet: false,
			verbose: false,
			overrides: {},
		});

		expect(promptMocks.select).toHaveBeenCalledTimes(1);
		expect(state.retries).toHaveLength(1);
		expect(state.exitedEarly).toBe(true);
		expect(state.autoActionCounts["limit-flow:limit-command"]).toBe(1);
	});

	it("routes failures using onError policy mappings", async () => {
		const config: DevWizardConfig = {
			meta: { name: "Policy Routing", version: "1.0.0" },
			scenarios: [{ id: "policy-routing", label: "Policy Routing", flow: "main" }],
			flows: {
				main: {
					id: "main",
					steps: [
						{
							id: "policy-strategy",
							type: "prompt",
							mode: "select",
							prompt: "Pick a policy",
							storeAs: "policyStrategy",
							options: [
								{ label: "Proceed", value: "proceed" },
								{ label: "Exit", value: "exit" },
							],
						},
						{
							id: "policy-shape",
							type: "compute",
							values: {
								policies: {
									upgrade: {
										strategy: "{{ state.answers.policyStrategy }}",
									},
								},
							},
						},
						{
							id: "failing-command",
							type: "command",
							commands: [{ run: "pnpm fail-now" }],
							onError: {
								policy: {
									key: "policies.upgrade.strategy",
									map: {
										proceed: "after",
										exit: "exit",
									},
								},
							},
						},
						{
							id: "after",
							type: "message",
							level: "success",
							text: "continued",
						},
					],
				},
			},
		};

		execaMocks.execaCommand.mockImplementationOnce(() =>
			execaMocks.createFailure({ message: "boom" }),
		);
		promptMocks.select.mockClear();

		const state = await executeScenario({
			config,
			scenarioId: "policy-routing",
			repoRoot: tmpDir,
			stdout: new PassThrough(),
			stderr: new PassThrough(),
			dryRun: false,
			quiet: true,
			verbose: false,
			overrides: {
				policyStrategy: "proceed",
			},
			nonInteractive: true,
		});

		expect(promptMocks.select).not.toHaveBeenCalled();
		expect(state.skippedSteps[0]?.reason).toBe("policy");
		expect(state.skippedSteps[0]?.target).toBe("after");
	});

	it("fails unattended runs when onError policy values are missing", async () => {
		const config: DevWizardConfig = {
			meta: { name: "Policy Missing", version: "1.0.0" },
			scenarios: [{ id: "policy-missing", label: "Policy Missing", flow: "main" }],
			flows: {
				main: {
					id: "main",
					steps: [
						{
							id: "failing-command",
							type: "command",
							commands: [{ run: "pnpm still-failing" }],
							onError: {
								policy: {
									key: "policies.upgrade.strategy",
									map: {
										proceed: "after",
									},
								},
							},
						},
						{
							id: "after",
							type: "message",
							level: "success",
							text: "continued",
						},
					],
				},
			},
		};

		execaMocks.execaCommand.mockImplementationOnce(() =>
			execaMocks.createFailure({ message: "boom" }),
		);

		await expect(
			executeScenario({
				config,
				scenarioId: "policy-missing",
				repoRoot: tmpDir,
				stdout: new PassThrough(),
				stderr: new PassThrough(),
				dryRun: false,
				quiet: true,
				verbose: false,
				overrides: {},
				nonInteractive: true,
			}),
		).rejects.toThrow(/Missing policy "policies\.upgrade\.strategy"/);
	});

	it("captures integration timing metadata when stdout contains markers", async () => {
		const config: DevWizardConfig = {
			meta: { name: "Timing", version: "1.0.0" },
			scenarios: [{ id: "timing", label: "Timing", flow: "timing-flow" }],
			flows: {
				"timing-flow": {
					id: "timing-flow",
					steps: [
						{
							id: "run",
							type: "command",
							commands: [
								{
									run: "pnpm test",
									captureStdout: true,
								},
							],
						},
					],
				},
			},
		};

		execaMocks.execaCommand.mockImplementationOnce(() =>
			execaMocks.createProcess({
				stdout:
					'[integration][timing]{"task":"suite","profile":"default","durationMs":1200,"status":"passed"}',
			}),
		);

		const state = await executeScenario({
			config,
			scenarioId: "timing",
			repoRoot: tmpDir,
			stdout: new PassThrough(),
			stderr: new PassThrough(),
			dryRun: false,
			quiet: false,
			verbose: false,
			overrides: {},
		});

		expect(execaMocks.execaCommand).toHaveBeenCalledTimes(1);
		const firstCall = execaMocks.execaCommand.mock.calls[0] as
			| unknown[]
			| undefined;
		const stdoutMode = (firstCall?.[1] as { stdout?: string } | undefined)?.stdout;
		expect(stdoutMode).toBe("pipe");
		expect(state.integrationTimings).toHaveLength(1);
		expect(state.integrationTimings[0]?.metadata.events[0]?.task).toBe("suite");
	});

	it("executes chained flows defined on the scenario sequentially", async () => {
		const config: DevWizardConfig = {
			meta: { name: "Chained", version: "1.0.0" },
			scenarios: [
				{
					id: "chain",
					label: "Chain",
					flow: "first-flow",
					flows: ["second-flow"],
				},
			],
			flows: {
				"first-flow": {
					id: "first-flow",
					steps: [
						{
							id: "first-command",
							type: "command",
							commands: [{ run: "echo first" }],
						},
					],
				},
				"second-flow": {
					id: "second-flow",
					steps: [
						{
							id: "second-command",
							type: "command",
							commands: [{ run: "echo second" }],
						},
					],
				},
			},
		};

		const state = await executeScenario({
			config,
			scenarioId: "chain",
			repoRoot: tmpDir,
			stdout: new PassThrough(),
			stderr: new PassThrough(),
			dryRun: false,
			quiet: false,
			verbose: false,
			overrides: {},
		});

		expect(state.flowRuns.map((run) => run.flowId)).toEqual([
			"first-flow",
			"second-flow",
		]);
		expect(state.exitedEarly).toBe(false);
		expect(execaMocks.execaCommand).toHaveBeenCalledTimes(2);
	});

	it("runs post-run flows when on-success hooks are configured", async () => {
		const config: DevWizardConfig = {
			meta: { name: "PostRun", version: "1.0.0" },
			scenarios: [
				{
					id: "post-success",
					label: "Post Success",
					flow: "main",
					postRun: [{ flow: "after-success", when: "on-success" }],
				},
			],
			flows: {
				main: {
					id: "main",
					steps: [
						{
							id: "notice",
							type: "message",
							level: "info",
							text: "Main flow executed.",
						},
					],
				},
				"after-success": {
					id: "after-success",
					steps: [
						{
							id: "summary",
							type: "command",
							commands: [{ run: "echo \"post\"" }],
						},
					],
				},
			},
		};

		execaMocks.execaCommand.mockImplementationOnce(() =>
			execaMocks.createProcess({ stdout: "post" }),
		);

		const state = await executeScenario({
			config,
			scenarioId: "post-success",
			repoRoot: tmpDir,
			stdout: new PassThrough(),
			stderr: new PassThrough(),
			dryRun: false,
			quiet: false,
			verbose: false,
			overrides: {},
		});

		expect(state.completedSteps).toBe(2);
		expect(execaMocks.execaCommand).toHaveBeenCalledTimes(1);
	});

	it("only runs on-failure post-run hooks when failures occur", async () => {
		const config: DevWizardConfig = {
			meta: { name: "PostRunFailure", version: "1.0.0" },
			scenarios: [
				{
					id: "post-failure",
					label: "Post Failure",
					flow: "main",
					postRun: [{ flow: "after-failure", when: "on-failure" }],
				},
			],
			flows: {
				main: {
					id: "main",
					steps: [
						{
							id: "failing-command",
							type: "command",
							continueOnError: true,
							commands: [
								{
									run: "pnpm fail",
									continueOnFail: true,
								},
							],
						},
					],
				},
				"after-failure": {
					id: "after-failure",
					steps: [
						{
							id: "collect",
							type: "command",
							commands: [{ run: "echo \"failure\"" }],
						},
					],
				},
			},
		};

		execaMocks.execaCommand
			.mockImplementationOnce(() =>
				execaMocks.createFailure({
					stdout: "",
					message: "failure",
				}),
			)
			.mockImplementationOnce(() => execaMocks.createProcess({ stdout: "failure" }));

		const state = await executeScenario({
			config,
			scenarioId: "post-failure",
			repoRoot: tmpDir,
			stdout: new PassThrough(),
			stderr: new PassThrough(),
			dryRun: false,
			quiet: false,
			verbose: false,
			overrides: {},
		});

		expect(state.failedSteps).toBeGreaterThan(0);
		expect(execaMocks.execaCommand).toHaveBeenCalledTimes(2);
		const secondCall = execaMocks.execaCommand.mock.calls[1] as
			| unknown[]
			| undefined;
		expect(secondCall?.[0]).toBe("echo \"failure\"");
	});

	it("runs steps provided by plugins", async () => {
		const pluginPath = path.join(
			testDir,
			"fixtures",
			"plugins",
			"echoPlugin.mjs",
		);
		const config: DevWizardConfig = {
			meta: { name: "Plugin Demo", version: "1.0.0" },
			plugins: [
				{
					module: "./fixtures/plugins/echoPlugin.mjs",
					resolvedPath: pluginPath,
					source: pluginPath,
				},
			],
			scenarios: [
				{
					id: "plugin-scenario",
					label: "Plugin Scenario",
					flow: "main",
				},
			],
			flows: {
				main: {
					id: "main",
					steps: [
						{
							id: "collect-name",
							type: "prompt",
							mode: "input",
							prompt: "Name?",
							storeAs: "name",
						},
						{
							id: "echo",
							type: "echo",
							message: "Hello {{ state.answers.name }}!",
							storeAs: "greeting",
						} as unknown as PluginStep,
					],
				},
			},
		};

		const pluginLoad = await loadPlugins(config.plugins, { repoRoot: testDir });
		const baseContext: Parameters<typeof executeScenario>[0] = {
			config,
			scenarioId: "plugin-scenario",
			repoRoot: testDir,
			stdout: new PassThrough(),
			stderr: new PassThrough(),
			dryRun: false,
			quiet: true,
			verbose: false,
			overrides: { name: "Ada" },
			logWriter: undefined,
			promptOptionsCache: new Map(),
			checkpoint: undefined,
			policy: undefined,
			plugins: pluginLoad.registry,
		};

		const state = await executeScenario(baseContext);
		expect(state.answers.greeting).toBe("Hello Ada!");
		expect(state.completedSteps).toBe(2);

		const planContext: Parameters<typeof buildScenarioPlan>[0] = {
			...baseContext,
			dryRun: true,
			quiet: true,
			overrides: { name: "Grace" },
		};

		const plan = await buildScenarioPlan(planContext);
		const pluginPlan = plan.flows[0]?.steps.find(
			(step) => step.kind === "plugin",
		);

		expect(pluginPlan).toMatchObject({
			kind: "plugin",
			pluginType: "echo",
			pluginName: "echo-plugin",
			summary: "Hello Grace!",
		});
	});
});
