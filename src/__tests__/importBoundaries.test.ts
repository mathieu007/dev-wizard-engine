import { describe, expect, it } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(testDir, "..");

const disallowedImports = ["@clack/prompts", "@clack/core"];

async function collectSourceFiles(dir: string): Promise<string[]> {
	const entries = await readdir(dir, { withFileTypes: true });
	const results: string[] = [];

	for (const entry of entries) {
		const entryPath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name === "__tests__") {
				continue;
			}
			const nested = await collectSourceFiles(entryPath);
			results.push(...nested);
			continue;
		}
		if (!entry.isFile()) {
			continue;
		}
		if (!entry.name.endsWith(".ts") || entry.name.endsWith(".d.ts")) {
			continue;
		}
		results.push(entryPath);
	}

	return results;
}

describe("import boundaries", () => {
	it("keeps UI prompt dependencies out of engine modules", async () => {
		const sourceFiles = await collectSourceFiles(srcRoot);
		const offenders: string[] = [];

		for (const filePath of sourceFiles) {
			const contents = await readFile(filePath, "utf8");
			if (disallowedImports.some((needle) => contents.includes(needle))) {
				offenders.push(path.relative(srcRoot, filePath));
			}
		}

		expect(offenders).toEqual([]);
	});
});
