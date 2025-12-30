import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { planScenario } from "../programmatic/api";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const sampleConfigPath = path.resolve(
	testDir,
	"../../../dev-wizard-core/examples/sample.wizard.yaml",
);
const presetConfigPath = path.resolve(
	testDir,
	"../../../dev-wizard-presets/git-commit-push/index.yaml",
);

describe("plan compiler golden outputs", () => {
	it("renders stable plan outputs for the sample scenario", async () => {
		const originalUser = process.env.USER;
		process.env.USER = "codex";

		try {
			const result = await planScenario({
				configPath: sampleConfigPath,
				cwd: path.dirname(sampleConfigPath),
				scenarioId: "hello-world",
			});

			expect(result.prettyPlan).toMatchSnapshot();
			expect(result.ndjsonPlan.join("\n")).toMatchSnapshot();
			expect(result.jsonPlan).toMatchSnapshot();
		} finally {
			process.env.USER = originalUser;
		}
	});

	it("renders stable plan outputs for the git-commit-push preset", async () => {
		const result = await planScenario({
			configPath: presetConfigPath,
			cwd: path.dirname(presetConfigPath),
			scenarioId: "git-commit-push",
		});

		expect(result.prettyPlan).toMatchSnapshot();
		expect(result.ndjsonPlan.join("\n")).toMatchSnapshot();
		expect(result.jsonPlan).toMatchSnapshot();
	});
});
