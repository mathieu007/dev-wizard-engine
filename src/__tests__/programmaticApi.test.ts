import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { compilePlan, loadWizard, planScenario } from "../programmatic/api";

let tempDir: string;

beforeEach(async () => {
	tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "dev-wizard-programmatic-"));
});

afterEach(async () => {
	await fs.rm(tempDir, { recursive: true, force: true });
});

describe("programmatic API", () => {
	it("loads wizard metadata without executing flows", async () => {
		const configPath = path.join(tempDir, "config.yaml");
		await fs.writeFile(
			configPath,
			`meta: { name: Programmatic Demo, version: 1.0.0 }
scenarios:
  - id: sample
    label: Sample
    flow: main
flows:
  main:
    id: main
    steps:
      - id: message
        type: message
        level: info
        text: \"hello\"
`,
			"utf8",
		);

		const result = await loadWizard({ configPath, cwd: tempDir });

		expect(result.config.meta?.name).toBe("Programmatic Demo");
		expect(result.description.scenarios?.[0]?.id).toBe("sample");
		expect(result.pluginWarnings).toHaveLength(0);
	});

	it("builds a scenario plan with formatted output", async () => {
		const configPath = path.join(tempDir, "config.yaml");
		await fs.writeFile(
			configPath,
			`meta: { name: Plan Demo, version: 1.0.0 }
scenarios:
  - id: plan-me
    label: Plan Me
    flow: main
flows:
  main:
    id: main
    steps:
      - id: announce
        type: message
        level: info
        text: \"Planning...\"
      - id: greet
        type: command
        commands:
          - run: echo \"Hello\"
`,
			"utf8",
		);

		const result = await planScenario({
			configPath,
			cwd: tempDir,
			scenarioId: "plan-me",
		});

		expect(result.plan.scenarioId).toBe("plan-me");
		expect(result.prettyPlan).toContain("Plan Me");
		expect(result.ndjsonPlan.length).toBeGreaterThan(0);
		expect(result.jsonPlan).toContain("\"scenarioId\": \"plan-me\"");
		expect(result.targetMode).toBe("dry-run");
	});

	it("compiles a scenario plan without formatting helpers", async () => {
		const configPath = path.join(tempDir, "config.yaml");
		await fs.writeFile(
			configPath,
			`meta: { name: Compile Demo, version: 1.0.0 }
scenarios:
  - id: compile-me
    label: Compile Me
    flow: main
flows:
  main:
    id: main
    steps:
      - id: announce
        type: message
        level: info
        text: \"Compiling...\"
`,
			"utf8",
		);

		const result = await compilePlan({
			configPath,
			cwd: tempDir,
			scenarioId: "compile-me",
		});

		expect(result.plan.scenarioId).toBe("compile-me");
		expect(result.targetMode).toBe("dry-run");
	});
});
