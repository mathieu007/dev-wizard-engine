import path from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../loader/configLoader.js";
import { buildScenarioPlan } from "../runtime/executor";
import { NonInteractivePromptDriver } from "../runtime/promptDriver";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const configPath = path.resolve(
	testDir,
	"../../../dev-wizard-presets/git-commit-push/index.yaml",
);

async function planCommitPushFlow(overrides: Record<string, unknown>) {
	const config = await loadConfig({ configPaths: configPath });
	return buildScenarioPlan({
		config,
		scenarioId: "git-commit-push",
		repoRoot: path.dirname(configPath),
		stdout: new PassThrough(),
		stderr: new PassThrough(),
		dryRun: true,
		quiet: true,
		verbose: false,
		promptDriver: new NonInteractivePromptDriver(),
		overrides,
		logWriter: undefined,
		promptOptionsCache: new Map(),
		checkpoint: undefined,
	});
}

describe("git-commit-push library flow", () => {
	it("renders git commands using the commit message file override", async () => {
		const plan = await planCommitPushFlow({
			commitMessageFile: "notes.txt",
			clearCommitMessageFile: true,
		});

		expect(plan.pendingPromptCount).toBe(0);
		const steps = plan.flows[0]?.steps ?? [];
		const commitStep = steps.find((step) => step.id === "commit-and-push");
		const clearStep = steps.find((step) => step.id === "clear-message-file");

		expect(commitStep).toBeDefined();
		expect(commitStep?.kind).toBe("command");
		const commitCommands =
			(commitStep as { commands?: Array<{ run: string }> })?.commands?.map(
				(command) => command.run,
			) ?? [];
		expect(commitCommands).toEqual([
			"git add .",
			'git commit -F "notes.txt"',
			"git push",
		]);

		expect(clearStep).toBeDefined();
		expect(clearStep?.kind).toBe("command");
		const clearCommands =
			(clearStep as { commands?: Array<{ run: string }> })?.commands?.map(
				(command) => command.run,
			) ?? [];
		expect(clearCommands).toEqual([': > "notes.txt"']);
	});

	it("skips clearing the commit message file when not requested", async () => {
		const plan = await planCommitPushFlow({
			commitMessageFile: "notes.txt",
			clearCommitMessageFile: false,
		});

		const steps = plan.flows[0]?.steps ?? [];
		const ids = steps.map((step) => step.id);

		expect(ids).toContain("commit-and-push");
		expect(ids).toContain("clear-message-routing");
		expect(ids).not.toContain("clear-message-file");
	});
});
