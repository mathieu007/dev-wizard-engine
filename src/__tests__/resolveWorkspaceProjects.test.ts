import { describe, expect, it } from "vitest";
import path from "node:path";
import { resolveWorkspaceProjects } from "@dev-wizard/presets/scripts/resolveWorkspaceProjects";

describe("resolveWorkspaceProjects script", () => {
	it("returns the selected projects with labels", async () => {
		const repoRoot = path.resolve(process.cwd(), "..", "..");
		const resolved = await resolveWorkspaceProjects({
			repoRoot,
			selectedProjects: [
				"packages/dev-wizard-core",
				"packages/dev-wizard-cli",
			],
			includeRoot: false,
			maxDepth: 3,
		});

		expect(resolved).toEqual([
			{ id: "packages/dev-wizard-core", label: "@dev-wizard/core" },
			{ id: "packages/dev-wizard-cli", label: "@dev-wizard/cli" },
		]);
	});

	it("locates the workspace root when invoked from a package directory", async () => {
		const packageDir = path.resolve(process.cwd(), "..", "..", "packages", "dev-wizard-cli");
		const resolved = await resolveWorkspaceProjects({
			repoRoot: packageDir,
			selectedProjects: [
				"packages/dev-wizard-core",
				"packages/dev-wizard-cli",
			],
			includeRoot: true,
			maxDepth: 3,
		});

		expect(resolved.find((entry) => entry.id === "packages/dev-wizard-core")).toBeDefined();
		expect(resolved.find((entry) => entry.id === "packages/dev-wizard-cli")).toBeDefined();
	});
});
