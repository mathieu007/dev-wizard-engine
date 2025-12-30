import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../loader/configLoader.js";

let tmpDir: string;

beforeEach(async () => {
	tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "dev-wizard-loader-"));
});

afterEach(async () => {
	await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("loadConfig", () => {
	it("merges imported configs and shared flows", async () => {
		const sharedPath = path.join(tmpDir, "shared.yaml");
		await fs.writeFile(
			sharedPath,
			`meta:\n  name: Shared\n  version: 1.0.0\nscenarios: []\nflows:\n  shared-step:\n    id: shared-step\n    steps:\n      - id: shared-message\n        type: message\n        text: "Hello from shared"\n`,
		);

		const mainPath = path.join(tmpDir, "main.yaml");
		await fs.writeFile(
			mainPath,
			`meta:\n  name: Main\n  version: 1.0.0\nimports:\n  - ./shared.yaml\nscenarios:\n  - id: demo\n    label: Demo\n    flow: main-flow\nflows:\n  main-flow:\n    id: main-flow\n    steps:\n      - id: group-shared\n        type: group\n        flow: shared-step\n`,
		);

		const config = await loadConfig({ configPaths: mainPath });

		expect(config.scenarios).toHaveLength(1);
		expect(config.flows["shared-step"]).toBeDefined();
		expect(config.flows["shared-step"].steps[0]?.type).toBe("message");
	});

	it("throws when duplicate scenario ids are encountered", async () => {
		const sharedPath = path.join(tmpDir, "dup.yaml");
		await fs.writeFile(
			sharedPath,
			`meta:\n  name: Dup\n  version: 1.0.0\nscenarios:\n  - id: duplicate\n    label: One\n    flow: dup-flow\nflows:\n  dup-flow:\n    id: dup-flow\n    steps:\n      - id: noop\n        type: message\n        text: noop\n`,
		);

		const mainPath = path.join(tmpDir, "dup-main.yaml");
		await fs.writeFile(
			mainPath,
			`meta:\n  name: Dup Main\n  version: 1.0.0\nimports:\n  - ./dup.yaml\nscenarios:\n  - id: duplicate\n    label: Another\n    flow: dup-flow\nflows:\n  dup-flow:\n    id: dup-flow\n    steps:\n      - id: noop\n        type: message\n        text: noop\n`,
		);

		await expect(loadConfig({ configPaths: mainPath })).rejects.toThrow(
			/Duplicate scenario id/i,
		);
	});

	it("loads presets from node modules packages", async () => {
		const presetsDir = path.join(tmpDir, "node_modules", "@dev-wizard", "presets");
		await fs.mkdir(presetsDir, { recursive: true });
		await fs.writeFile(
			path.join(presetsDir, "package.json"),
			JSON.stringify({ name: "@dev-wizard/presets", version: "0.0.0", main: "index.js" }),
		);
		await fs.writeFile(path.join(presetsDir, "index.js"), "module.exports = {};");
		await fs.writeFile(
			path.join(presetsDir, "dev-wizard.config.yaml"),
			`meta:\n  name: Presets\n  version: 1.0.0\nscenarios:\n  - id: preset-scenario\n    label: Preset\n    flow: preset-flow\nflows:\n  preset-flow:\n    id: preset-flow\n    steps:\n      - id: preset-message\n        type: message\n        text: preset\n`,
		);

		const mainPath = path.join(tmpDir, "main.yaml");
		await fs.writeFile(
			mainPath,
			`meta:\n  name: Main\n  version: 1.0.0\nimports:\n  - '@dev-wizard/presets'\nscenarios: []\nflows: {}\n`,
		);

		const config = await loadConfig({
			configPaths: mainPath,
			cwd: tmpDir,
		});

		expect(config.scenarios.some((scenario) => scenario.id === "preset-scenario")).toBe(true);
	});

	it("warns when schemaVersion is unsupported", async () => {
		const configPath = path.join(tmpDir, "schema.yaml");
		await fs.writeFile(
			configPath,
			`meta:\n  name: Schema\n  version: 1.0.0\n  schemaVersion: 99\nscenarios: []\nflows: {}\n`,
		);

		const warnings: string[] = [];
		await loadConfig({
			configPaths: configPath,
			onWarning: (warning) => warnings.push(warning),
		});

		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toContain("schemaVersion 99");
	});

	it("merges command presets from imports and tracks duplicate metadata", async () => {
		const sharedPath = path.join(tmpDir, "presets.shared.yaml");
		await fs.writeFile(
			sharedPath,
			`meta:\n  name: Shared\n  version: 1.0.0\nscenarios: []\nflows: {}\ncommandPresets:\n  shell:\n    shell: true\n    env:\n      SHARED: yes\n`,
		);

		const mainPath = path.join(tmpDir, "presets.main.yaml");
		await fs.writeFile(
			mainPath,
			`meta:\n  name: Main\n  version: 1.0.0\nimports:\n  - ./presets.shared.yaml\nscenarios: []\nflows: {}\ncommandPresets:\n  docker:\n    env:\n      FROM: root\n`,
		);

		const config = await loadConfig({ configPaths: mainPath });

		expect(config.commandPresets?.shell?.shell).toBe(true);
		expect(config.commandPresets?.shell?.env?.SHARED).toBe("yes");
		expect(config.commandPresets?.docker?.env?.FROM).toBe("root");
	});

	it("warns on identical preset redefinitions and surfaces conflicting ones", async () => {
		const basePath = path.join(tmpDir, "base.yaml");
		await fs.writeFile(
			basePath,
			`meta:\n  name: Base\n  version: 1.0.0\nscenarios: []\nflows: {}\ncommandPresets:\n  shell:\n    shell: true\n`,
		);

		const identicalPath = path.join(tmpDir, "identical.yaml");
		await fs.writeFile(
			identicalPath,
			`meta:\n  name: Identical\n  version: 1.0.0\nscenarios: []\nflows: {}\ncommandPresets:\n  shell:\n    shell: true\n`,
		);

		const conflictingPath = path.join(tmpDir, "conflict.yaml");
		await fs.writeFile(
			conflictingPath,
			`meta:\n  name: Conflict\n  version: 1.0.0\nscenarios: []\nflows: {}\ncommandPresets:\n  shell:\n    env:\n      MODE: prod\n`,
		);

		const warnings: string[] = [];
		await loadConfig({
			configPaths: [basePath, identicalPath],
			onWarning: (warning) => warnings.push(warning),
		});

		expect(warnings.some((warning) => warning.includes("identical"))).toBe(true);

		await expect(
			loadConfig({ configPaths: [basePath, conflictingPath] }),
		).rejects.toThrow(/conflicting definitions/i);
	});
});
