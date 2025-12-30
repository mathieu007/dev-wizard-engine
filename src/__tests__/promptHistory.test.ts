import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createPromptHistoryManager } from "../runtime/promptHistory";

const tempDirs: string[] = [];

afterEach(async () => {
	await Promise.all(
		tempDirs.splice(0).map(async (dir) =>
			fs.rm(dir, { recursive: true, force: true }),
		),
	);
});

describe("createPromptHistoryManager", () => {
	it("persists history between manager instances", async () => {
		const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "prompt-history-"));
		tempDirs.push(tmpDir);
		const storagePath = path.join(tmpDir, "history.json");

		const firstManager = createPromptHistoryManager({ storagePath, maxEntries: 5 });
		firstManager.record("commitFile", "./COMMIT.SUMMARY.md");
		await firstManager.close();

		const secondManager = createPromptHistoryManager({ storagePath, maxEntries: 5 });
		expect(secondManager.getAll("commitFile")).toEqual(["./COMMIT.SUMMARY.md"]);
		await secondManager.close();
	});

	it("enforces the max entries limit when persisting", async () => {
		const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "prompt-history-"));
		tempDirs.push(tmpDir);
		const storagePath = path.join(tmpDir, "history.json");

		const manager = createPromptHistoryManager({ storagePath, maxEntries: 2 });
		manager.record("foo", "a");
		manager.record("foo", "b");
		manager.record("foo", "c");
		await manager.close();

		const reloaded = createPromptHistoryManager({ storagePath, maxEntries: 2 });
		expect(reloaded.getAll("foo")).toEqual(["b", "c"]);
		await reloaded.close();
	});

	it("ignores empty or whitespace-only values", async () => {
		const manager = createPromptHistoryManager({ maxEntries: 5 });
		manager.record("emptyCheck", "");
		manager.record("emptyCheck", "   ");
		manager.record("emptyCheck", "\n");
		expect(manager.getAll("emptyCheck")).toEqual([]);
		await manager.close();
	});

	it("deduplicates consecutive entries", async () => {
		const manager = createPromptHistoryManager({ maxEntries: 5 });
		manager.record("dedupe", "alpha");
		manager.record("dedupe", "alpha");
		manager.record("dedupe", "beta");
		manager.record("dedupe", "beta");
		expect(manager.getAll("dedupe")).toEqual(["alpha", "beta"]);
		await manager.close();
	});
});
