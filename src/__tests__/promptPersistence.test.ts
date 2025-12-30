import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
	createPromptPersistenceManager,
	PromptPersistenceManager,
} from "../runtime/promptPersistence.js";

async function createTempRepo(): Promise<string> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dw-persistence-"));
	return dir;
}

export function describePromptPersistenceSuite(): void {
	describe("prompt persistence manager", () => {
		let repoRoot: string;
		let manager: PromptPersistenceManager;

		beforeEach(async () => {
			repoRoot = await createTempRepo();
			manager = await createPromptPersistenceManager({
				repoRoot,
				scenarioId: "maintenance-window",
			});
		});

		afterEach(async () => {
			await fs.rm(repoRoot, { recursive: true, force: true });
		});

		it("stores and retrieves scenario values", async () => {
			expect(
				manager.get({ scope: "scenario", key: "maintenanceWindowMode" }),
			).toBeUndefined();
			manager.set({ scope: "scenario", key: "maintenanceWindowMode" }, "auto");
			await manager.save();
			const persisted = await fs.readFile(
				path.join(
					repoRoot,
					".dev-wizard",
					"answers",
					"maintenance-window.json",
				),
				"utf8",
			);
			const parsed = JSON.parse(persisted) as Record<string, unknown>;
			expect(parsed.scenario).toStrictEqual({
				maintenanceWindowMode: "auto",
			});
		});

		it("tracks project scoped values separately", async () => {
			manager.set(
				{ scope: "project", key: "typecheckTsconfig", projectId: "packages/app" },
				"tsconfig.test.json",
			);
			await manager.save();
			const reloaded = await createPromptPersistenceManager({
				repoRoot,
				scenarioId: "maintenance-window",
			});
			expect(
				reloaded.get({
					scope: "project",
					key: "typecheckTsconfig",
					projectId: "packages/app",
				}),
			).toBe("tsconfig.test.json");
		});
	});
}

describePromptPersistenceSuite();
