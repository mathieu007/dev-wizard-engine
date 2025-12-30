import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getComputeHandler, type ComputeHandlerContext } from "../runtime/computeHandlers";
import type { WizardState } from "../runtime/state";
import type { TemplateContext } from "../runtime/templates";

let tmpDir: string;

function createContext(repoRoot: string): ComputeHandlerContext {
	const templateContext: TemplateContext = {
		state: { answers: {} },
		env: process.env,
		repoRoot,
	};

	return {
		repoRoot,
		state: { answers: {} } as WizardState,
		templateContext,
	};
}

describe("compute handlers", () => {
	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "dev-wizard-compute-"));
	});

	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
	});

	it("builds maintenance window identifiers", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2025-01-20T09:00:00Z"));

		try {
			const handler = getComputeHandler("maintenance-window");
			expect(handler).toBeDefined();
			const result = await handler!(
				{ cadence: "daily", name: "Daily Maintenance" },
				createContext(tmpDir),
			);
			expect(result).toEqual({
				identifier: "2025-01-20-daily-maintenance",
				base: "daily-maintenance",
				cadence: "daily",
			});
		} finally {
			vi.useRealTimers();
		}
	});

	it("detects tsconfig candidates", async () => {
		const targetDir = path.join(tmpDir, "packages/app");
		await fs.mkdir(targetDir, { recursive: true });
		await fs.writeFile(path.join(targetDir, "tsconfig.test.json"), "{}");

		const handler = getComputeHandler("detect-project-tsconfig");
		const result = await handler!(
			{ repoRoot: tmpDir, target: "packages/app" },
			createContext(tmpDir),
		);
		expect(result).toBe("tsconfig.test.json");
	});

	it("renders typecheck commands", async () => {
		await fs.writeFile(
			path.join(tmpDir, "pnpm-workspace.yaml"),
			"packages:\n  - packages/*\n",
		);

		const handler = getComputeHandler("render-typecheck-command");
		const result = await handler!(
			{
				tsconfig: "tsconfig.test.json",
				cwd: "packages/app",
				compilerOptions: "{\"skipLibCheck\":true}",
				repoRoot: tmpDir,
			},
			createContext(tmpDir),
		);

		const command = String(result);
		expect(command).toContain("pnpm exec tsx");
		expect(command).toContain("packages/dev-wizard-presets/scripts/typecheck.ts");
		expect(command).toContain("--tsconfig tsconfig.test.json");
		expect(command).toContain("--cwd packages/app");
		expect(command).toContain("skipLibCheck");
	});

	it("reads commit message files with fallback", async () => {
		const handler = getComputeHandler("commit-message-file");
		const existing = path.join(tmpDir, "COMMIT.SUMMARY.md");
		await fs.writeFile(existing, "chore(repo): hello\n");
		const fromFile = await handler!({ path: existing }, createContext(tmpDir));
		expect(fromFile).toBe("chore(repo): hello");

		const missing = path.join(tmpDir, "repo", "COMMIT.SUMMARY.md");
		const fallback = await handler!({ path: missing }, createContext(tmpDir));
		expect(fallback).toBe("chore(repo): Dev Wizard automation snapshot");
	});
});
