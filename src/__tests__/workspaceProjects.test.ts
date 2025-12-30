import { describe, expect, it } from "vitest";
import path from "node:path";
import { listWorkspaceProjects } from "../runtime/workspaceProjects";

describe("listWorkspaceProjects", () => {
	it("includes the current package when scanning", async () => {
		const packageRoot = path.resolve(__dirname, "..", "..");
		const projects = await listWorkspaceProjects({
			repoRoot: packageRoot,
			includeRoot: true,
			maxDepth: 0,
		});

		const rootProject = projects.find((project) => project.id === ".");
		expect(rootProject?.packageJsonPath).toBe(
			path.join(packageRoot, "package.json"),
		);
	});
});
