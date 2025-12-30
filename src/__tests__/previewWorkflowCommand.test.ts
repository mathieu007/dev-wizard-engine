import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	getWorkflowPreviewCommand,
	getWorkflowCommands,
} from "@dev-wizard/presets/scripts/previewWorkflowCommand";

const tempDirs: string[] = [];

async function createAnswersFixture(): Promise<{
	repoRoot: string;
	answersPath: string;
}> {
	const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "dw-preview-"));
	tempDirs.push(repoRoot);
	const answersDir = path.join(
		repoRoot,
		".dev-wizard",
		"answers",
		"maintenance-window",
		"maintenance",
		"upgrade-dependencies",
	);
	await fs.mkdir(answersDir, { recursive: true });
	const answersPath = path.join(answersDir, "daily.json");
	await fs.writeFile(answersPath, JSON.stringify({ scenario: {} }), "utf8");
	return { repoRoot, answersPath };
}

afterEach(async () => {
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop();
		if (dir) {
			await fs.rm(dir, { recursive: true, force: true });
		}
	}
});

describe("getWorkflowPreviewCommand", () => {
	it("returns the preview command for known workflows", () => {
		const cmd = getWorkflowPreviewCommand("maintenance");
		expect(cmd).toBeDefined();
		expect(cmd).toContain("packages/dev-wizard-presets/maintenance/index.yaml");
	});

	it("returns undefined for unknown workflow ids", () => {
		expect(getWorkflowPreviewCommand("unknown"))
			.toBeUndefined();
	});

	it("builds project-scoped maintenance commands", () => {
		const commands = getWorkflowCommands("maintenance", {
			repoRoot: "/repo",
			project: { id: "packages/dev-wizard-cli", label: "@dev-wizard/cli" },
			promptOverrides: {
				maintenanceWindowMode: "auto",
			},
		});
		expect(commands).toBeDefined();
		expect(commands?.run).toContain("--filter '@dev-wizard/cli'");
		expect(commands?.run).toContain("/repo/packages/dev-wizard-presets/maintenance/index.yaml");
		expect(commands?.run).not.toContain("--answers");
		expect(commands?.preview).toContain("--plan");
		expect(commands?.run).toContain("--set 'maintenanceWindowMode=auto'");
		expect(commands?.preview).toContain("--set 'maintenanceWindowMode=auto'");
	});

	it("includes the scenario answers file when persisted answers exist", async () => {
		const { repoRoot, answersPath } = await createAnswersFixture();
		const commands = getWorkflowCommands("maintenance", {
			repoRoot,
			project: { id: "packages/dev-wizard-cli", label: "@dev-wizard/cli" },
			promptOverrides: {
				maintenanceWindowMode: "auto",
			},
		});
		expect(commands).toBeDefined();
		expect(commands?.run).toContain(`--answers '${answersPath}'`);
		expect(commands?.run).toContain("--set 'maintenanceWindowMode=auto'");
		expect(commands?.preview).toContain(`--answers '${answersPath}'`);
		expect(commands?.preview).toContain("--plan");
		expect(commands?.preview).toContain("--set 'maintenanceWindowMode=auto'");
	});

	it("adds inline overrides for values not captured in the persisted answers", async () => {
		const { repoRoot, answersPath } = await createAnswersFixture();
		const commands = getWorkflowCommands("maintenance", {
			repoRoot,
			project: { id: "packages/dev-wizard-cli", label: "@dev-wizard/cli" },
			promptOverrides: {
				maintenanceWindowMode: "manual",
				maintenanceWindowCadence: "weekly",
			},
		});
		expect(commands).toBeDefined();
		expect(commands?.run).toContain(`--answers '${answersPath}'`);
		expect(commands?.run).toContain("--set 'maintenanceWindowMode=manual'");
		expect(commands?.run).toContain("--set 'maintenanceWindowCadence=weekly'");
		expect(commands?.preview).toContain("--plan");
		expect(commands?.preview).toContain("--set 'maintenanceWindowMode=manual'");
	});

	it("strips wrapping quotes from inline override values", () => {
		const commands = getWorkflowCommands("maintenance", {
			repoRoot: "/repo",
			project: { id: "packages/dev-wizard-cli", label: "@dev-wizard/cli" },
			promptOverrides: {
				maintenanceWindow: '"2025-11-21-daily-maintenance"',
				upgradeBranchName: "'2025-11-12-daily-maintenance'-deps-upgrade",
			},
		});
		expect(commands?.run).toContain("--set 'maintenanceWindow=2025-11-21-daily-maintenance'");
		expect(commands?.run).toContain("--set 'upgradeBranchName=2025-11-12-daily-maintenance-deps-upgrade'");
	});

	it("ignores maintenance overrides for non-maintenance workflows", () => {
		const commands = getWorkflowCommands("git-commit", {
			repoRoot: "/repo",
			project: { id: "packages/dev-wizard-cli", label: "@dev-wizard/cli" },
			promptOverrides: {
				maintenanceWindowMode: "auto",
			},
		});
		expect(commands).toBeDefined();
		expect(commands?.run).not.toContain("--set 'maintenanceWindowMode=auto'");
		expect(commands?.preview).not.toContain("--set 'maintenanceWindowMode=auto'");
	});
});
