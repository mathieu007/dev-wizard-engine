import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { describeWizard } from "../runtime/describe";

let tempDir: string;

beforeEach(async () => {
	tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "dev-wizard-describe-"));
});

afterEach(async () => {
	await fs.rm(tempDir, { recursive: true, force: true });
});

describe("describeWizard", () => {
	it("includes resolved command presets with usage metadata", async () => {
		const configPath = path.join(tempDir, "config.yaml");
		await fs.writeFile(
			configPath,
			`meta: { name: Preset Demo, version: 1.0.0 }
scenarios:
  - id: preset-demo
    label: Preset Demo
    flow: main
flows:
  main:
    id: main
    steps:
      - id: step-one
        type: command
        defaults:
          preset: shell
        commands:
          - run: echo "one"
          - run: echo "two"
      - id: step-two
        type: command
        commands:
          - run: echo "three"
            preset: envOnly
commandPresets:
  shell:
    shell: true
    env:
      PRESET: "1"
  envOnly:
    env:
      ONLY: "yes"
`,
			"utf8",
		);

		const result = await describeWizard({ configPath, cwd: tempDir });
		const presets = result.commandPresets ?? [];

		const shellPreset = presets.find((preset) => preset.name === "shell");
		expect(shellPreset).toBeDefined();
		expect(shellPreset?.definition.env?.PRESET).toBe("1");
		expect(shellPreset?.usageCount).toBe(2);
		expect(shellPreset?.sources).toContain(configPath);
		expect(shellPreset?.usedBy).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					flowId: "main",
					stepId: "step-one",
					commandIndex: 0,
				}),
				expect.objectContaining({
					flowId: "main",
					stepId: "step-one",
					commandIndex: 1,
				}),
			]),
		);

		const envOnlyPreset = presets.find((preset) => preset.name === "envOnly");
		expect(envOnlyPreset).toBeDefined();
		expect(envOnlyPreset?.usageCount).toBe(1);
		expect(envOnlyPreset?.usedBy).toEqual([
			{
				flowId: "main",
				stepId: "step-two",
				commandIndex: 0,
			},
		]);
	});
});
