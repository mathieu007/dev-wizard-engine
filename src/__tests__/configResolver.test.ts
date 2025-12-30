import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveConfigPaths } from "../loader/configResolver";

const tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dev-wizard-config-"));
	tempDirs.push(dir);
	return dir;
}

afterEach(async () => {
	await Promise.all(
		tempDirs.splice(0).map((dir) =>
			fs.rm(dir, { recursive: true, force: true }),
		),
	);
});

describe("resolveConfigPaths", () => {
	it("prefers explicit paths when provided", async () => {
		const cwd = await createTempDir();
		const configPath = path.join(cwd, "custom.yaml");
		await fs.writeFile(configPath, "meta: {}");

		const result = await resolveConfigPaths({
			cwd,
			explicitPaths: configPath,
		});

		expect(result.paths).toEqual([configPath]);
		expect(result.errors).toHaveLength(0);
	});

	it("discovers root config files", async () => {
		const cwd = await createTempDir();
		const rootConfig = path.join(cwd, "dev-wizard.config.yaml");
		await fs.writeFile(rootConfig, "meta: {}");

		const result = await resolveConfigPaths({ cwd });

		expect(result.paths).toContain(rootConfig);
		expect(result.errors).toHaveLength(0);
	});

	it("discovers index files within dev-wizard-config", async () => {
		const cwd = await createTempDir();
		const baseDir = path.join(cwd, "dev-wizard-config");
		await fs.mkdir(baseDir, { recursive: true });
		const indexFile = path.join(baseDir, "index.yaml");
		await fs.writeFile(indexFile, "meta: {}");

		const result = await resolveConfigPaths({ cwd });

		expect(result.paths).toContain(indexFile);
		expect(result.errors).toHaveLength(0);
	});

	it("applies environment overlays when available", async () => {
		const cwd = await createTempDir();
		const baseDir = path.join(cwd, "dev-wizard-config");
		const envDir = path.join(baseDir, "environments", "staging");
		await fs.mkdir(envDir, { recursive: true });
		const baseConfig = path.join(baseDir, "index.yaml");
		const envConfig = path.join(envDir, "index.yaml");
		await fs.writeFile(baseConfig, "meta: {}");
		await fs.writeFile(envConfig, "meta: {}");

		const result = await resolveConfigPaths({ cwd, environment: "staging" });

		expect(result.paths).toEqual([baseConfig, envConfig]);
	});

	it("falls back gracefully when environment overlay is missing", async () => {
		const cwd = await createTempDir();
		const baseDir = path.join(cwd, "dev-wizard-config");
		await fs.mkdir(baseDir, { recursive: true });
		const baseConfig = path.join(baseDir, "index.yaml");
		await fs.writeFile(baseConfig, "meta: {}");

		const result = await resolveConfigPaths({ cwd, environment: "missing" });

		expect(result.paths).toEqual([baseConfig]);
		expect(result.diagnostics.some((line) =>
			line.includes("dev-wizard-config/environments/missing/ (missing)"),
		)).toBe(true);
	});

	it("includes local overlays from directory and root files", async () => {
		const cwd = await createTempDir();
		const baseDir = path.join(cwd, "dev-wizard-config");
		const localDir = path.join(baseDir, "local");
		await fs.mkdir(localDir, { recursive: true });
		const baseConfig = path.join(baseDir, "index.yaml");
		const localConfig = path.join(localDir, "index.yaml");
		const rootLocalConfig = path.join(cwd, "dev-wizard.config.local.yaml");
		await fs.writeFile(baseConfig, "meta: {}");
		await fs.writeFile(localConfig, "meta: {}");
		await fs.writeFile(rootLocalConfig, "meta: {}");

		const result = await resolveConfigPaths({ cwd });

		expect(result.paths).toEqual([baseConfig, localConfig, rootLocalConfig]);
	});

	it("loads package.json wizard.config entries", async () => {
		const cwd = await createTempDir();
		const pkgConfig = path.join(cwd, "package-config.yaml");
		await fs.writeFile(pkgConfig, "meta: {}");
		await fs.writeFile(
			path.join(cwd, "package.json"),
			JSON.stringify({
				name: "test",
				wizard: {
					config: ["package-config.yaml"],
				},
			}),
		);

		const result = await resolveConfigPaths({ cwd });

		expect(result.paths).toContain(pkgConfig);
		expect(result.errors).toHaveLength(0);
	});

	it("captures errors for missing package.json wizard.config entries", async () => {
		const cwd = await createTempDir();
		await fs.writeFile(
			path.join(cwd, "package.json"),
			JSON.stringify({
				name: "test",
				wizard: {
					config: ["missing.yaml"],
				},
			}),
		);

		const result = await resolveConfigPaths({ cwd });

		expect(result.errors).toEqual([
			expect.stringContaining("package.json#wizard.config references missing file"),
		]);
		expect(result.paths).toHaveLength(0);
	});
});
