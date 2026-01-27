import { promises as fs } from "node:fs";
import fsSync from "node:fs";
import path from "node:path";
import { execa } from "execa";
import semver from "semver";

import type { WizardActionContext } from "./actionsRegistry.js";
import { registerAction } from "./actionsRegistry.js";
import { listWorkspaceProjects } from "./workspaceProjects.js";

interface WorkspaceManifestEntry {
	name?: string;
	path?: string;
	repo?: string | null;
	defaultBranch?: string;
	role?: string;
	publishCommand?: string[];
}

const DEFAULT_MANIFEST_PATH = "workspace.repos.json";
const DEFAULT_COMMIT_MESSAGE = "chore: workspace push";
const SUMMARY_FILENAME = "COMMIT.SUMMARY.md";
const DEFAULT_COMMIT_MESSAGE_FILE = SUMMARY_FILENAME;
const DEFAULT_PUBLISH_TAG_TEMPLATE = "${name}@${version}";
const DEFAULT_PUBLISH_COMMAND = [
	"pnpm",
	"publish",
	"--access",
	"public",
	"--no-git-checks",
];

let workspaceActionsRegistered = false;

export function registerWorkspaceActions(): void {
	if (workspaceActionsRegistered) {
		return;
	}

	workspaceActionsRegistered = true;

	registerAction({
		id: "workspace-setup",
		label: "Workspace setup",
		plan: (params, context) => ({
			summary: "Clone/update workspace repositories",
			details: buildWorkspacePlanDetails(params, context),
		}),
		run: runWorkspaceSetup,
	});

	registerAction({
		id: "workspace-init-repos",
		label: "Workspace init repos",
		plan: (params, context) => ({
			summary: "Initialize git remotes for workspace repositories",
			details: buildWorkspacePlanDetails(params, context),
		}),
		run: runWorkspaceInit,
	});

	registerAction({
		id: "workspace-push",
		label: "Workspace push repos",
		plan: (params, context) => ({
			summary: "Commit + push workspace repositories",
			details: buildWorkspacePlanDetails(params, context),
		}),
		run: runWorkspacePush,
	});

	registerAction({
		id: "workspace-publish",
		label: "Workspace publish",
		plan: (params, context) => ({
			summary: "Publish workspace packages",
			details: buildWorkspacePlanDetails(params, context),
		}),
		run: runWorkspacePublish,
	});

	registerAction({
		id: "workspace-apply-publish-registry",
		label: "Workspace apply publish registry",
		plan: (params, context) => ({
			summary: "Apply publishConfig.registry to workspace packages",
			details: buildWorkspacePlanDetails(params, context),
		}),
		run: runWorkspaceApplyPublishRegistry,
	});

	registerAction({
		id: "workspace-bump-versions",
		label: "Workspace bump versions",
		plan: (params, context) => ({
			summary: "Bump workspace package versions",
			details: buildWorkspacePlanDetails(params, context),
		}),
		run: runWorkspaceBumpVersions,
	});

	registerAction({
		id: "workspace-setup-global",
		label: "Workspace setup global",
		plan: () => ({
			summary: "Build and link the Dev Wizard CLI globally",
		}),
		run: runWorkspaceSetupGlobal,
	});

	registerAction({
		id: "workspace-build-sweep",
		label: "Workspace build sweep",
		plan: (params, context) => ({
			summary: "Build selected workspace projects",
			details: buildWorkspacePlanDetails(params, context),
		}),
		run: runWorkspaceBuildSweep,
	});

	registerAction({
		id: "workspace-test-sweep",
		label: "Workspace test sweep",
		plan: (params, context) => ({
			summary: "Run tests across selected workspace projects",
			details: buildWorkspacePlanDetails(params, context),
		}),
		run: runWorkspaceTestSweep,
	});
}

function buildWorkspacePlanDetails(
	params: Record<string, unknown>,
	context: WizardActionContext,
): Record<string, unknown> {
	return {
		manifestPath: resolveManifestPath(params, context),
		dryRun: resolveDryRun(params, context),
	};
}

async function runWorkspaceSetup(
	params: Record<string, unknown>,
	context: WizardActionContext,
): Promise<void> {
	ensureWorkspaceActionsRegistered();
	const log = context.log;
	const dryRun = resolveDryRun(params, context);
	const repoRoot = resolveRepoRoot(params, context);
	const manifestPath = resolveManifestPath(params, context);
	const autoPull = readBoolean(params.autoPull) ??
		readBoolean(context.state.answers.workspaceSetupAutoPull) ??
		true;
	const useHttps = readBoolean(params.useHttps) ??
		readBoolean(context.state.answers.workspaceSetupUseHttps) ??
		false;
	const fallbackBranch = readString(params.defaultBranch) ??
		readString(context.state.answers.workspaceDefaultBranch);

	const manifest = await readWorkspaceManifest(manifestPath);

	for (const entry of manifest) {
		const relPath = readString(entry.path);
		const name = readString(entry.name) ?? relPath ?? "(unknown)";
		const repo = readString(entry.repo);
		const defaultBranch = readString(entry.defaultBranch) ?? fallbackBranch;

		if (!relPath) {
			log.warn(`[workspace-setup] skipping ${name} (missing/invalid path)`);
			continue;
		}

		const absolutePath = path.resolve(repoRoot, relPath);
		log.info(`[workspace-setup] processing ${name} (${relPath})`);

		await ensureDir(path.dirname(absolutePath), dryRun, log);

		if (!(await pathExists(absolutePath))) {
			if (!repo) {
				log.warn(
					`[workspace-setup] directory missing and no repo configured — place sources at ${relPath}`,
				);
				continue;
			}
			const resolvedRepo = toHttpsIfRequested(repo, useHttps);
			await runCommand(
				"git",
				["clone", resolvedRepo, absolutePath],
				{ dryRun, log },
			);
			if (defaultBranch) {
				await runCommand(
					"git",
					["-C", absolutePath, "checkout", defaultBranch],
					{ dryRun, log },
				);
			}
			continue;
		}

		if (!hasGitMetadata(absolutePath)) {
			if (!repo) {
				log.warn(
					"[workspace-setup] existing directory without git metadata and no repo configured; skipping.",
				);
				continue;
			}
			if (!(await isEmptyDir(absolutePath))) {
				log.warn(
					"[workspace-setup] existing non-empty directory without git metadata; skipping.",
				);
				continue;
			}
			const resolvedRepo = toHttpsIfRequested(repo, useHttps);
			await runCommand(
				"git",
				["clone", resolvedRepo, "."],
				{ cwd: absolutePath, dryRun, log },
			);
			if (defaultBranch) {
				await runCommand(
					"git",
					["-C", absolutePath, "checkout", defaultBranch],
					{ dryRun, log },
				);
			}
			continue;
		}

		if (!autoPull) {
			log.info("[workspace-setup] pull disabled; skipping fetch/pull.");
			continue;
		}

		await runCommand(
			"git",
			["-C", absolutePath, "fetch", "--all", "--prune"],
			{ dryRun, log },
		);
		if (defaultBranch) {
			await runCommand(
				"git",
				["-C", absolutePath, "checkout", defaultBranch],
				{ dryRun, log },
			);
		}
		await runCommand(
			"git",
			["-C", absolutePath, "pull", "--ff-only"],
			{ dryRun, log },
		);
	}

	log.success("[workspace-setup] done");
}

async function runWorkspaceBuildSweep(
	params: Record<string, unknown>,
	context: WizardActionContext,
): Promise<void> {
	ensureWorkspaceActionsRegistered();
	const log = context.log;
	const dryRun = resolveDryRun(params, context);
	const repoRoot = resolveRepoRoot(params, context);
	const manifestPath = resolveManifestPath(params, context);
	const buildModes =
		readStringArray(params.buildModes) ??
		readStringArray(context.state.answers.buildSweepModes) ??
		["normal", "turbo"];
	const tsconfig =
		readString(params.tsconfig) ??
		readString(context.state.answers.buildSweepTsconfig) ??
		"tsconfig.build.json";
	const cacheBase =
		readString(params.cacheBase) ??
		readString(context.state.answers.buildSweepCacheBase) ??
		".dev-wizard/cache";
	const writeScripts =
		readBoolean(params.writeScripts) ??
		readBoolean(context.state.answers.buildSweepWriteScripts) ??
		true;
	const overwriteScripts =
		readBoolean(params.overwriteScripts) ??
		readBoolean(context.state.answers.buildSweepOverwriteScripts) ??
		true;
	const runBuilds =
		readBoolean(params.runBuilds) ??
		readBoolean(context.state.answers.buildSweepRunBuilds) ??
		false;
	const createNormalTsconfig =
		readBoolean(params.createNormalTsconfig) ?? true;

	const tsbuildinfoDir = path.resolve(repoRoot, cacheBase, "tsbuildinfo");
	await ensureDir(tsbuildinfoDir, dryRun, log);

	const manifest = await readWorkspaceManifest(manifestPath);
	const modes = buildModes.length > 0 ? buildModes : ["normal"];
	const filters = readStringArray(params.projects) ??
		readStringArray(context.state.answers.buildSweepProjects);
	const needsTurbo = modes.includes("turbo");

	let selected = manifest;
	if (filters && filters.length > 0) {
		selected = manifest.filter((entry) =>
			filters.some((filter) =>
				[entry.name, entry.path].some(
					(value) =>
						typeof value === "string" &&
						value.toLowerCase().includes(filter.toLowerCase()),
				),
			)
		);
		if (selected.length === 0) {
			log.warn(
				"[workspace-build] no manifest entries matched the selected filters; falling back to all entries.",
			);
			selected = manifest;
		}
	}

	if (selected.length === 0) {
		log.warn("[workspace-build] no matching projects to build");
		return;
	}

	const buildErrors: string[] = [];
	if (needsTurbo) {
		await ensureTurboConfig(repoRoot, { dryRun, log });
		await ensureTurboDependency(repoRoot, { dryRun, log });
	}

	// Seed helpful root scripts so users can trigger recursive builds easily.
	const rootBuildScripts: Record<string, string> = {};
	if (modes.includes("normal")) {
		rootBuildScripts.build = "pnpm -r run build";
	}
	if (modes.includes("quick")) {
		rootBuildScripts["build:quick"] = "pnpm -r run build:quick";
	}
	if (modes.includes("turbo")) {
		rootBuildScripts["build:turbo"] =
			`TURBO_TS_CONFIG=${tsconfig} pnpm dlx turbo run build`;
	}
	if (Object.keys(rootBuildScripts).length > 0) {
		await updatePackageJsonScripts(path.join(repoRoot, "package.json"), rootBuildScripts, {
			overwrite: overwriteScripts,
			dryRun,
			log,
		});
	}

	for (const entry of selected) {
		const relPath = readString(entry.path);
		if (!relPath) {
			log.warn("[workspace-build] skipping entry with missing path");
			continue;
		}
		const projectDir = path.resolve(repoRoot, relPath);
		const packageJsonPath = path.join(projectDir, "package.json");
		const filterId = readString(entry.name) ?? relPath;
		const safeName = makeSafeName(filterId);
		const tsbuildinfoFile = path.join(
			tsbuildinfoDir,
			`${safeName}.tsbuildinfo`,
		);

		if (createNormalTsconfig && tsconfig !== "tsconfig.json") {
			await ensureDerivedTsconfig(
				projectDir,
				tsconfig,
				"tsconfig.json",
				{ dryRun, log },
			);
		}

		const resolvedNormalTsconfig = pickExistingTsconfig(projectDir, [
			tsconfig,
			"tsconfig.json",
		]);
		if (!resolvedNormalTsconfig) {
			log.warn(
				`[workspace-build] ${filterId}: no tsconfig found (tried ${tsconfig} and tsconfig.json); skipping.`,
			);
			continue;
		}

		const resolvedQuickTsconfig = resolvedNormalTsconfig;
		const resolvedTurboTsconfig = resolvedNormalTsconfig;

		const normalCommand = [
			"pnpm",
			"exec",
			"tsc",
			"-p",
			resolvedNormalTsconfig,
			"--pretty",
			"false",
			"--incremental",
			"--tsBuildInfoFile",
			tsbuildinfoFile,
		];
		const quickCommand = [
			"pnpm",
			"exec",
			"tsc",
			"-p",
			resolvedQuickTsconfig,
			"--pretty",
			"false",
			"--incremental",
			"--tsBuildInfoFile",
			tsbuildinfoFile,
		];
		const turboCommand = [
			"pnpm",
			"dlx",
			"turbo",
			"run",
			"build",
			"--filter",
			filterId,
		];
		const turboEnv = { TURBO_TS_CONFIG: resolvedTurboTsconfig };

		if (runBuilds) {
			const primaryMode = modes[0] ?? "normal";
			let commandToRun = normalCommand;
			let env: Record<string, string> | undefined;
			if (primaryMode === "turbo") {
				commandToRun = turboCommand;
				env = turboEnv;
			} else if (primaryMode === "quick") {
				if (!quickCommand) {
					log.warn(
						`[workspace-build] ${filterId}: quick tsconfig missing; skipping quick build.`,
					);
					commandToRun = normalCommand;
				} else {
					commandToRun = quickCommand;
				}
			}
			log.info(`[workspace-build] building ${filterId} (${primaryMode})`);
			try {
				await runCommand(commandToRun[0], commandToRun.slice(1), {
					cwd: projectDir,
					dryRun,
					log,
					env,
				});
			} catch (error) {
				buildErrors.push(
					`[workspace-build] ${filterId} (${primaryMode}) failed: ${String(error)}`,
				);
			}
		}

		if (writeScripts) {
			const scripts: Record<string, string> = {};
			if (modes.includes("normal")) {
				scripts.build = normalCommand.join(" ");
			}
			if (modes.includes("quick") && quickCommand) {
				scripts["build:quick"] = quickCommand.join(" ");
			}
			if (modes.includes("turbo")) {
				// Fallback to a direct tsc build if turbo is not configured or fails.
				const fallbackBuild = [
					"pnpm",
					"exec",
					"tsc",
					"-p",
					resolvedTurboTsconfig,
					"--pretty",
					"false",
					"--incremental",
					"--tsBuildInfoFile",
					tsbuildinfoFile,
				];
				scripts["build:turbo"] =
					`TURBO_TS_CONFIG=${resolvedTurboTsconfig} ${turboCommand.join(" ")} || ${fallbackBuild.join(" ")}`;
			}
			if (Object.keys(scripts).length > 0) {
				await updatePackageJsonScripts(
					packageJsonPath,
					scripts,
					{ overwrite: overwriteScripts, dryRun, log },
				);
			}
		}
	}

	if (buildErrors.length > 0) {
		throw new Error(
			`One or more builds failed:\n${buildErrors.join("\n")}`,
		);
	}

	log.success("[workspace-build] done");
}

async function runWorkspaceTestSweep(
	params: Record<string, unknown>,
	context: WizardActionContext,
): Promise<void> {
	ensureWorkspaceActionsRegistered();
	const log = context.log;
	const dryRun = resolveDryRun(params, context);
	const repoRoot = resolveRepoRoot(params, context);
	const manifestPath = resolveManifestPath(params, context);
	const testModes =
		readStringArray(params.testModes) ??
		readStringArray(context.state.answers.testSweepModes) ??
		["normal", "turbo"];
	const testConfig =
		readString(params.tsconfig) ??
		readString(context.state.answers.testSweepTsconfig) ??
		"vitest.config.ts";
	const cacheBase =
		readString(params.cacheBase) ??
		readString(context.state.answers.testSweepCacheBase) ??
		".dev-wizard/cache/tests";
	const writeScripts =
		readBoolean(params.writeScripts) ??
		readBoolean(context.state.answers.testSweepWriteScripts) ??
		true;
	const overwriteScripts =
		readBoolean(params.overwriteScripts) ??
		readBoolean(context.state.answers.testSweepOverwriteScripts) ??
		true;
	const runTests =
		readBoolean(params.runTests) ??
		readBoolean(context.state.answers.testSweepRunTests) ??
		false;

	const manifest = await readWorkspaceManifest(manifestPath);
	const filters = readStringArray(params.projects) ??
		readStringArray(context.state.answers.testSweepProjects);
	let selected = manifest;
	if (filters && filters.length > 0) {
		selected = manifest.filter((entry) =>
			filters.some((filter) =>
				[entry.name, entry.path].some(
					(value) =>
						typeof value === "string" &&
						value.toLowerCase().includes(filter.toLowerCase()),
				),
			)
		);
		if (selected.length === 0) {
			log.warn(
				"[workspace-test] no manifest entries matched the selected filters; falling back to all entries.",
			);
			selected = manifest;
		}
	}

	if (selected.length === 0) {
		log.warn("[workspace-test] no matching projects to test");
		return;
	}

	const testErrors: string[] = [];
	const modes = testModes.length > 0 ? testModes : ["normal"];

	for (const entry of selected) {
		const relPath = readString(entry.path);
		if (!relPath) {
			log.warn("[workspace-test] skipping entry with missing path");
			continue;
		}
		const projectDir = path.resolve(repoRoot, relPath);
		const packageJsonPath = path.join(projectDir, "package.json");
		const filterId = readString(entry.name) ?? relPath;
		const safeName = makeSafeName(filterId);
		const vitestCacheDir = path.resolve(
			repoRoot,
			cacheBase,
			safeName,
		);

		const resolvedTestConfig = await ensureVitestConfig(
			projectDir,
			filterId,
			{
				cacheDir: vitestCacheDir,
				preferredConfig: testConfig,
				dryRun,
				log,
			},
		);

		const normalCommand = [
			"pnpm",
			"exec",
			"vitest",
			"run",
			"--passWithNoTests",
			"--config",
			resolvedTestConfig,
		];
		const quickCommand = [
			"pnpm",
			"exec",
			"vitest",
			"run",
			"--passWithNoTests",
			"--changed",
			"--config",
			resolvedTestConfig,
		];
		const turboCommand = [
			"pnpm",
			"dlx",
			"turbo",
			"run",
			"test",
			"--filter",
			filterId,
		];

		if (runTests) {
			const primaryMode = modes[0] ?? "normal";
			let commandToRun = normalCommand;
			let env: Record<string, string> | undefined;
			if (primaryMode === "turbo") {
				commandToRun = turboCommand;
			} else if (primaryMode === "quick") {
				commandToRun = quickCommand;
			}
			log.info(`[workspace-test] running tests for ${filterId} (${primaryMode})`);
			try {
				await runCommand(commandToRun[0], commandToRun.slice(1), {
					cwd: projectDir,
					dryRun,
					log,
					env,
				});
			} catch (error) {
				testErrors.push(
					`[workspace-test] ${filterId} (${primaryMode}) failed: ${String(error)}`,
				);
			}
		}

		if (writeScripts) {
			const scripts: Record<string, string> = {};
			if (modes.includes("normal")) {
				scripts.test = normalCommand.join(" ");
			}
			if (modes.includes("quick")) {
				scripts["test:quick"] = quickCommand.join(" ");
			}
			if (modes.includes("turbo")) {
				scripts["test:turbo"] = turboCommand.join(" ");
			}
			if (Object.keys(scripts).length > 0) {
				await updatePackageJsonScripts(
					packageJsonPath,
					scripts,
					{ overwrite: overwriteScripts, dryRun, log },
				);
			}
		}
	}

	if (testErrors.length > 0) {
		throw new Error(
			`One or more test runs failed:\n${testErrors.join("\n")}`,
		);
	}

	// Seed helpful root scripts for recursive test runs.
	const rootTestScripts: Record<string, string> = {};
	if (modes.includes("normal")) {
		rootTestScripts.test = "pnpm -r run test";
	}
	if (modes.includes("quick")) {
		rootTestScripts["test:quick"] = "pnpm -r run test:quick";
	}
	if (modes.includes("turbo")) {
		rootTestScripts["test:turbo"] =
			`TURBO_TS_CONFIG=${testConfig} pnpm dlx turbo run test`;
	}
	if (Object.keys(rootTestScripts).length > 0) {
		await updatePackageJsonScripts(path.join(repoRoot, "package.json"), rootTestScripts, {
			overwrite: overwriteScripts,
			dryRun,
			log,
		});
	}

	log.success("[workspace-test] done");
}

async function ensureVitestConfig(
	projectDir: string,
	filterId: string,
	opts: {
		cacheDir: string;
		preferredConfig?: string;
		dryRun: boolean;
		log: WizardActionContext["log"];
	},
): Promise<string> {
	const { cacheDir, preferredConfig, dryRun, log } = opts;
	const configPath = path.resolve(
		projectDir,
		preferredConfig ?? "vitest.config.ts",
	);

	if (await pathExists(configPath)) {
		return configPath;
	}

	const cacheDirRelative = path.isAbsolute(cacheDir)
		? path.relative(projectDir, cacheDir)
		: cacheDir;
	const vitestConfig = `import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["src/__tests__/**/*.{test,spec}.ts"],
		cache: { dir: "${cacheDirRelative}" },
	},
});
`;

	if (dryRun) {
		log.info(`[workspace-test] (dry-run) would seed vitest config for ${filterId} at ${configPath}`);
		return configPath;
	}

	await ensureDir(path.dirname(configPath), dryRun, log);
	await fs.writeFile(configPath, vitestConfig, "utf8");
	log.success(`[workspace-test] seeded vitest config for ${filterId} at ${configPath}`);

	return configPath;
}

async function ensureTurboConfig(
	repoRoot: string,
	opts: { dryRun: boolean; log: WizardActionContext["log"] },
): Promise<void> {
	const { dryRun, log } = opts;
	const turboPath = path.join(repoRoot, "turbo.json");
	if (await pathExists(turboPath)) {
		log.info("[workspace-build] turbo.json already present; leaving as-is.");
		return;
	}

	const turboConfig = {
		$schema: "https://turborepo.com/schema.json",
		tasks: {
			build: {
				dependsOn: ["^build"],
				outputs: ["dist/**", "packages/**/dist/**"],
			},
			lint: {
				dependsOn: ["^lint"],
			},
			typecheck: {
				dependsOn: ["^typecheck"],
			},
			test: {
				dependsOn: ["^test"],
				outputs: [".dev-wizard/cache/tests/**", "coverage/**"],
			},
			dev: {
				cache: false,
				persistent: true,
			},
		},
	};

	if (dryRun) {
		log.info("[workspace-build] (dry-run) would write turbo.json");
		return;
	}

	await fs.writeFile(turboPath, `${JSON.stringify(turboConfig, null, 2)}\n`, "utf8");
	log.success("[workspace-build] created turbo.json for turbo builds.");
}

async function ensureTurboDependency(
	repoRoot: string,
	opts: { dryRun: boolean; log: WizardActionContext["log"] },
): Promise<void> {
	const { dryRun, log } = opts;
	const packageJsonPath = path.join(repoRoot, "package.json");
	if (!(await pathExists(packageJsonPath))) {
		log.warn("[workspace-build] package.json not found; cannot add turbo dependency.");
		return;
	}

	const raw = await fs.readFile(packageJsonPath, "utf8");
	const pkg = JSON.parse(raw) as {
		scripts?: Record<string, unknown>;
		devDependencies?: Record<string, unknown>;
	};

	const scripts =
		pkg.scripts && typeof pkg.scripts === "object"
			? { ...(pkg.scripts as Record<string, unknown>) }
			: {};
	const devDeps =
		pkg.devDependencies && typeof pkg.devDependencies === "object"
			? { ...(pkg.devDependencies as Record<string, unknown>) }
			: {};

	let changed = false;
	const turboVersion = "^2.7.3";
	if (!devDeps.turbo) {
		devDeps.turbo = turboVersion;
		changed = true;
	}
	if (scripts.turbo !== "turbo") {
		scripts.turbo = "turbo";
		changed = true;
	}

	if (!changed) return;

	const nextJson = {
		...pkg,
		devDependencies: devDeps,
		scripts,
	};

	if (dryRun) {
		log.info("[workspace-build] dry-run: ensure turbo devDependency/script in package.json");
		return;
	}

	await fs.writeFile(packageJsonPath, `${JSON.stringify(nextJson, null, 2)}\n`, "utf8");
	log.info("[workspace-build] ensured turbo devDependency and script in package.json");
}

async function runWorkspaceInit(
	params: Record<string, unknown>,
	context: WizardActionContext,
): Promise<void> {
	ensureWorkspaceActionsRegistered();
	const log = context.log;
	const dryRun = resolveDryRun(params, context);
	const repoRoot = resolveRepoRoot(params, context);
	const manifestPath = resolveManifestPath(params, context);
	const reconfigure = readBoolean(params.reconfigure) ??
		readBoolean(context.state.answers.workspaceInitReconfigure) ??
		false;
	const remoteName = readString(params.remoteName) ??
		readString(context.state.answers.workspaceGitRemote) ??
		"origin";
	const fallbackBranch = readString(params.defaultBranch) ??
		readString(context.state.answers.workspaceDefaultBranch);

	const manifest = await readWorkspaceManifest(manifestPath);
	const sandboxRemoteRoot = process.env.DEV_WIZARD_SANDBOX_REMOTE_ROOT;
	const sandboxSlug = process.env.DEV_WIZARD_SANDBOX_SLUG;

	for (const entry of manifest) {
		const relPath = readString(entry.path);
		const role = readString(entry.role);
		let repo = readString(entry.repo);
		const name = readString(entry.name) ?? relPath ?? "(unknown)";
		const defaultBranch = readString(entry.defaultBranch) ?? fallbackBranch;
		const isRoot = relPath === "." || role === "root";

		if (sandboxRemoteRoot && sandboxSlug && isRoot) {
			repo = path.resolve(sandboxRemoteRoot, `${sandboxSlug}.git`);
		}

		if (!repo) {
			log.info(`[workspace-init] skipping ${name} (no repo configured)`);
			continue;
		}
		if (!relPath) {
			log.warn(`[workspace-init] skipping ${name} (missing/invalid path)`);
			continue;
		}

		const absolutePath = path.resolve(repoRoot, relPath);
		log.info(`[workspace-init] processing ${name} (${relPath})`);

		await ensureDir(absolutePath, dryRun, log);

		const hadGit = hasGitMetadata(absolutePath);
		if (!hadGit) {
			await runCommand("git", ["init"], { cwd: absolutePath, dryRun, log });
			if (defaultBranch) {
				await runCommand(
					"git",
					["symbolic-ref", "HEAD", `refs/heads/${defaultBranch}`],
					{ cwd: absolutePath, dryRun, log },
				);
			}
		}

		const existingRemote = hadGit
			? await getRemoteUrl(absolutePath, remoteName)
			: undefined;
		if (!existingRemote) {
			await runCommand(
				"git",
				["remote", "add", remoteName, repo],
				{ cwd: absolutePath, dryRun, log },
			);
		} else if (reconfigure && existingRemote !== repo) {
			await runCommand(
				"git",
				["remote", "set-url", remoteName, repo],
				{ cwd: absolutePath, dryRun, log },
			);
		} else if (existingRemote !== repo) {
			log.info(
				`[workspace-init] ${remoteName} already set to ${existingRemote}; use reconfigure to overwrite.`,
			);
		}
	}

	log.success("[workspace-init] done");
}

async function runWorkspacePush(
	params: Record<string, unknown>,
	context: WizardActionContext,
): Promise<void> {
	ensureWorkspaceActionsRegistered();
	const log = context.log;
	const dryRun = resolveDryRun(params, context);
	const repoRoot = resolveRepoRoot(params, context);
	const manifestPath = resolveManifestPath(params, context);
	const remoteName = readString(params.remoteName) ??
		readString(context.state.answers.workspaceGitRemote);
	const commitMessageFile = readString(params.commitMessageFile) ??
		readString(context.state.answers.workspacePushCommitFile) ??
		DEFAULT_COMMIT_MESSAGE_FILE;
	const fallbackCommitMessage = readString(params.fallbackCommitMessage) ??
		readString(context.state.answers.workspacePushFallbackCommitMessage) ??
		DEFAULT_COMMIT_MESSAGE;
	const pushTags = readBoolean(params.pushTags) ??
		readBoolean(context.state.answers.workspacePushPushTags) ??
		false;
	const setUpstream = readBoolean(params.setUpstream) ??
		readBoolean(context.state.answers.workspacePushSetUpstream) ??
		true;
	const filters = readStringArray(params.filters) ??
		readStringArray(context.state.answers.workspacePushTargets);
	const includeRoot = readBoolean(params.includeRoot) ??
		readBoolean(context.state.answers.workspacePushIncludeRoot) ??
		true;
	const sandboxOnlyRoot = process.env.DEV_WIZARD_SANDBOX_ONLY_ROOT === "1";

	const manifest = await readWorkspaceManifest(manifestPath);
	const normalizedEntries = manifest.map((entry) => ({
		...entry,
		path: normalizeWorkspacePath(readString(entry.path) ?? "", repoRoot),
	}));

	const rootEntry = normalizedEntries.find((entry) => entry.path === ".");
	const entries = sandboxOnlyRoot
		? []
		: normalizedEntries.filter((entry) =>
				entry.path === "." ? false : shouldProcessPushEntry(entry, { filters }),
			);

	const hasWork = entries.length > 0;
	if (!hasWork && !(includeRoot && rootEntry)) {
		if (includeRoot && !rootEntry) {
			log.warn("[workspace-push] root push requested, but no root entry found in manifest; skipping root.");
		}
		log.info("[workspace-push] manifest is empty; nothing to do.");
		return;
	}

	for (const entry of entries) {
		await processPushEntry(entry, {
			repoRoot,
			dryRun,
			log,
			remoteName,
			commitMessageFile,
			fallbackCommitMessage,
			pushTags,
			setUpstream,
		});
	}

	if (includeRoot && !rootEntry) {
		log.warn("[workspace-push] root push requested, but no root entry found in manifest; skipping root.");
	}

	if (includeRoot && rootEntry) {
		// Push the root regardless of filters when explicitly requested.
		const excludePaths = normalizedEntries
			.map((entry) => entry.path)
			.filter((entryPath): entryPath is string => Boolean(entryPath && entryPath !== "."))
			.map((entryPath) => entryPath.split(path.sep).join("/"));
		const submodulePaths = await readGitSubmodulePaths(repoRoot);
		const rootExcludePaths =
			submodulePaths.length > 0
				? excludePaths.filter((entryPath) => !submodulePaths.includes(entryPath))
				: excludePaths;
		await processRootRepo({
			repoRoot,
			dryRun,
			log,
			remoteName,
			commitMessageFile,
			fallbackCommitMessage,
			pushTags,
			setUpstream,
			excludePaths: rootExcludePaths,
		});
	}

	log.success("[workspace-push] done");
}

async function runWorkspaceApplyPublishRegistry(
	params: Record<string, unknown>,
	context: WizardActionContext,
): Promise<void> {
	ensureWorkspaceActionsRegistered();
	const log = context.log;
	const repoRoot = resolveRepoRoot(params, context);
	const manifestPath = resolveManifestPath(params, context);
	const registry = readString(params.registry);
	const includeRoot = readBoolean(params.includeRoot) ?? true;
	if (!registry) {
		log.warn("[workspace-apply-publish-registry] no registry provided; skipping.");
		return;
	}

	const manifest = await readWorkspaceManifest(manifestPath);
	const paths = manifest
		.map((entry) => readString(entry.path))
		.filter((p): p is string => Boolean(p))
		.map((p) => normalizeWorkspacePath(p, repoRoot));

	// Fallback: if manifest is empty or missing entries, discover workspace projects.
	if (paths.length === 0) {
		const discovered = await listWorkspaceProjects({
			repoRoot,
			includeRoot: true,
			maxDepth: 3,
		});
		for (const project of discovered) {
			// listWorkspaceProjects returns ids as relative paths
			const rel = normalizeWorkspacePath(project.id, repoRoot);
			if (!paths.includes(rel)) {
				paths.push(rel);
			}
		}
	}

	if (includeRoot && !paths.includes(".")) {
		paths.push(".");
	}

	if (paths.length === 0) {
		log.warn("[workspace-apply-publish-registry] manifest is empty; nothing to update.");
		return;
	}

	for (const relPath of paths) {
		const pkgDir = path.resolve(repoRoot, relPath);
		const pkgPath = path.join(pkgDir, "package.json");
		if (!(await pathExists(pkgPath))) {
			log.warn(`[workspace-apply-publish-registry] ${relPath}: package.json not found; skipping.`);
			continue;
		}
		const pkgRaw = await fs.readFile(pkgPath, "utf8");
		const pkg = JSON.parse(pkgRaw) as {
			publishConfig?: { registry?: string; tag?: string; access?: string };
		};
		pkg.publishConfig = pkg.publishConfig ?? {};
		pkg.publishConfig.registry = registry;
		const updated = JSON.stringify(pkg, null, 2);
		if (updated !== pkgRaw) {
			log.info(
				`[workspace-apply-publish-registry] set publishConfig.registry to ${registry} for ${relPath}`,
			);
			await fs.writeFile(pkgPath, `${updated}\n`, "utf8");
		} else {
			log.info(`[workspace-apply-publish-registry] ${relPath} already set; no change.`);
		}
	}

	log.success("[workspace-apply-publish-registry] done");
}

async function runWorkspacePublish(
	params: Record<string, unknown>,
	context: WizardActionContext,
): Promise<void> {
	ensureWorkspaceActionsRegistered();
	const log = context.log;
	const dryRun = resolveDryRun(params, context);
	const repoRoot = resolveRepoRoot(params, context);
	const manifestPath = resolveManifestPath(params, context);
	const bumpVersions =
		readBoolean(params.bumpVersions) ??
		readBoolean(context.state.answers.workspacePublishAutoBump) ??
		false;
	const skipBumpConfirm =
		readBoolean(params.skipBumpConfirm) ??
		readBoolean(context.state.answers.workspacePublishSkipVersionConfirm) ??
		false;
	const releaseType = readString(params.releaseType) ??
		readString(context.state.answers.workspacePublishReleaseType) ??
		"patch";
	const prereleaseId = readString(params.prereleaseId) ??
		readString(context.state.answers.workspacePublishPrereleaseId) ??
		"rc";
	const includeInternal = readBoolean(params.includeInternal) ??
		readBoolean(context.state.answers.workspacePublishIncludeInternal) ??
		false;
	const skipChecks = readBoolean(params.skipChecks) ??
		readBoolean(context.state.answers.workspacePublishSkipChecks) ??
		false;
	const skipPublish = readBoolean(params.skipPublish) ??
		readBoolean(context.state.answers.workspacePublishSkipPublish) ??
		false;
	const requireClean = readBoolean(params.requireClean) ??
		readBoolean(context.state.answers.workspacePublishRequireClean) ??
		true;
	const publishRegistry = readString(params.publishRegistry) ??
		readString(context.state.answers.workspacePublishRegistry);
	const distTag = readString(params.distTag) ??
		readString(context.state.answers.workspacePublishDistTag);
	const checks = readStringArray(params.checks) ??
		readStringArray(context.state.answers.workspacePublishChecks) ??
		["lint", "typecheck", "test", "build"];
	const filters = readStringArray(params.filters) ??
		readStringArray(context.state.answers.workspacePublishTargets);
	const runPushFirst = readBoolean(params.runPushFirst) ??
		readBoolean(context.state.answers.workspacePublishRunPushFirst) ??
		false;
	const pushRequireClean =
		readBoolean(context.state.answers.workspacePushRequireClean) ?? true;
	const skipExistingPublished =
		readBoolean(params.skipExistingPublished) ??
		readBoolean(context.state.answers.workspacePublishSkipExisting) ??
		true;
	const pushParams = {
		manifestPath,
		dryRun,
		remoteName: readString(context.state.answers.workspaceGitRemote),
		commitMessageFile: readString(context.state.answers.workspacePushCommitFile) ??
			DEFAULT_COMMIT_MESSAGE_FILE,
		fallbackCommitMessage: readString(
			context.state.answers.workspacePushFallbackCommitMessage,
		) ?? DEFAULT_COMMIT_MESSAGE,
		requireClean:
			bumpVersions && releaseType !== "manual" ? false : pushRequireClean,
		pushTags: readBoolean(context.state.answers.workspacePushPushTags) ?? false,
		setUpstream: readBoolean(context.state.answers.workspacePushSetUpstream) ?? true,
		filters: readStringArray(context.state.answers.workspacePushTargets),
		includeRoot: readBoolean(context.state.answers.workspacePushIncludeRoot) ?? true,
	};

	if (bumpVersions && releaseType !== "manual") {
		const cleanBeforeBump = await isWorkspaceClean(
			manifestPath,
			repoRoot,
			includeInternal,
			filters,
			log,
		);
		if (!cleanBeforeBump) {
			log.warn(
				"[workspace-publish] skipping auto-bump because working tree is dirty; clean or disable auto-bump to proceed.",
			);
		} else {
		log.info(
			`[workspace-publish] auto version bump requested (releaseType=${releaseType}, prereleaseId=${prereleaseId})`,
		);
		await runWorkspaceBumpVersions(
			{
				manifestPath,
				dryRun,
				filters,
				includeInternal,
				releaseType,
				prereleaseId,
				skipConfirm: skipBumpConfirm,
				tagTemplate: DEFAULT_PUBLISH_TAG_TEMPLATE,
			},
			context,
			);
		}
	}

	if (runPushFirst) {
		log.info("[workspace-publish] running workspace-push before publish.");
		await runWorkspacePush(pushParams, context);
	}

	const manifest = await readWorkspaceManifest(manifestPath);
	const entries = manifest.filter((entry) =>
		shouldProcessPublishEntry(entry, {
			includeInternal,
			filters,
		}),
	);

	if (entries.length === 0) {
		log.info("[workspace-publish] no packages matched the current filter/role selection");
		return;
	}

	for (const entry of entries) {
		const relPath = readString(entry.path);
		const name = readString(entry.name) ?? relPath ?? "(unknown)";
		if (!relPath) {
			log.warn(`[workspace-publish] skipping ${name} (missing/invalid path)`);
			continue;
		}

		const pkgDir = path.resolve(repoRoot, relPath);
		log.info(`[workspace-publish] processing ${name} (${relPath})`);

		if (!(await pathExists(pkgDir))) {
			log.warn(`[workspace-publish] directory ${relPath} does not exist; skipping.`);
			continue;
		}

		const pkgJsonPath = path.join(pkgDir, "package.json");
		if (!(await pathExists(pkgJsonPath))) {
			log.warn(`[workspace-publish] missing package.json in ${relPath}; skipping.`);
			continue;
		}
		const pkgJson = JSON.parse(await fs.readFile(pkgJsonPath, "utf8")) as {
			version?: string;
			scripts?: Record<string, unknown>;
			publishConfig?: { registry?: string; tag?: string };
		};
		const pkgVersion = readString(pkgJson.version);
		const pkgRegistry = readString(pkgJson.publishConfig?.registry);
		const pkgTag = readString(pkgJson.publishConfig?.tag);
		const effectiveRegistry = pkgRegistry ?? publishRegistry;
		const effectiveTag = pkgTag ?? distTag;

		if (requireClean) {
			await ensureGitClean(pkgDir, name, dryRun, log);
		} else {
			log.info("[workspace-publish] git clean check skipped (per configuration).");
		}

		const scripts = pkgJson.scripts ?? {};

		if (!skipChecks) {
			if (checks.length === 0) {
				log.info("[workspace-publish] checks skipped (no checks selected).");
			}
			for (const script of checks) {
				if (scripts[script]) {
					await runCommand("pnpm", ["run", script], {
						cwd: pkgDir,
						dryRun,
						log,
					});
				}
			}
		} else {
			log.info("[workspace-publish] checks skipped via skipChecks flag.");
		}

		if (skipPublish) {
			log.info("[workspace-publish] publish skipped via skipPublish flag.");
			continue;
		}

		if (skipExistingPublished && pkgVersion) {
			const published = await readPublishedVersion(name, effectiveRegistry, effectiveTag, log);
			if (published && published === pkgVersion) {
				log.info(
					`[workspace-publish] ${name} ${pkgVersion} already published; skipping.`,
				);
				continue;
			}
		}

		let publishCommand = Array.isArray(entry.publishCommand) &&
			entry.publishCommand.every((part) => typeof part === "string")
			? entry.publishCommand
			: DEFAULT_PUBLISH_COMMAND;
		if (publishCommand.length === 0) {
			log.info("[workspace-publish] publish command empty; skipping publish.");
			continue;
		}

		const args = [...publishCommand];
		const command = args.shift() as string;
		const env: Record<string, string> = {};
		if (effectiveRegistry) {
			env.NPM_CONFIG_REGISTRY = effectiveRegistry;
			if (!args.includes("--registry")) {
				args.push("--registry", effectiveRegistry);
			}
		}
		if (effectiveTag) {
			env.NPM_CONFIG_TAG = effectiveTag;
			if (!args.includes("--tag")) {
				args.push("--tag", effectiveTag);
			}
		}
		if (releaseType === "prerelease" && prereleaseId) {
			env.NPM_CONFIG_PREID = prereleaseId;
		}
		await runCommand(command, args, {
			cwd: pkgDir,
			dryRun,
			log,
			env: Object.keys(env).length > 0 ? env : undefined,
		});
	}

	log.success("[workspace-publish] done");
}

async function runWorkspaceBumpVersions(
	params: Record<string, unknown>,
	context: WizardActionContext,
): Promise<void> {
	const log = context.log;
	const dryRun = resolveDryRun(params, context);
	const repoRoot = resolveRepoRoot(params, context);
	const manifestPath = resolveManifestPath(params, context);
	const filters = readStringArray(params.filters) ??
		readStringArray(context.state.answers.workspacePublishTargets);
	const includeInternal =
		readBoolean(params.includeInternal) ??
		readBoolean(context.state.answers.workspacePublishIncludeInternal) ??
		false;
	const releaseType =
		readString(params.releaseType) ??
		readString(context.state.answers.workspacePublishReleaseType) ??
		"patch";
	const prereleaseId =
		readString(params.prereleaseId) ??
		readString(context.state.answers.workspacePublishPrereleaseId) ??
		"rc";
	const skipConfirm =
		readBoolean(params.skipConfirm) ??
		readBoolean(context.state.answers.workspacePublishSkipVersionConfirm) ??
		false;
	const tagTemplate =
		readString(params.tagTemplate) ??
		DEFAULT_PUBLISH_TAG_TEMPLATE;

	const manifest = await readWorkspaceManifest(manifestPath);
	const entries = manifest.filter((entry) =>
		shouldProcessPublishEntry(entry, { filters, includeInternal }),
	);

	if (entries.length === 0) {
		log.warn("[workspace-bump] manifest is empty; nothing to bump.");
		return;
	}

	const bumps: Array<{ name: string; relPath: string; from?: string; to: string }> = [];

	for (const entry of entries) {
		const relPath = readString(entry.path);
		const pkgName = readString(entry.name) ?? relPath ?? "(unknown)";
		if (!relPath) {
			log.warn(`[workspace-bump] skipping ${pkgName}: missing path.`);
			continue;
		}
		const pkgJsonPath = path.resolve(repoRoot, relPath, "package.json");
		if (!(await pathExists(pkgJsonPath))) {
			log.warn(`[workspace-bump] ${pkgName}: package.json not found; skipping.`);
			continue;
		}
		const pkgRaw = await fs.readFile(pkgJsonPath, "utf8");
		const pkg = JSON.parse(pkgRaw) as { version?: string };
		const current = pkg.version;
		const next = computeNextVersion(current, releaseType, prereleaseId);
		bumps.push({ name: pkgName, relPath, from: current, to: next });
	}

	if (bumps.length === 0) {
		log.warn("[workspace-bump] no eligible packages found to bump.");
		return;
	}

	if (!skipConfirm) {
		const summary = bumps
			.map((b) => `- ${b.name}: ${b.from ?? "0.0.0"} → ${b.to}`)
			.join("\n");
		log.info(`[workspace-bump] planned version bumps:\n${summary}`);
	}

	for (const bump of bumps) {
		const pkgDir = path.resolve(repoRoot, bump.relPath);
		log.info(`[workspace-bump] ${bump.name}: ${bump.from ?? "none"} → ${bump.to}`);
		if (dryRun) {
			continue;
		}
		await runCommand(
			"pnpm",
			["version", bump.to, "--no-git-tag-version"],
			{ cwd: pkgDir, dryRun, log },
		);
		const tag = tagTemplate.replace("${name}", bump.name).replace("${version}", bump.to);
		if (tag && tag.trim().length > 0) {
			await runCommand("git", ["tag", "-f", tag], { cwd: pkgDir, dryRun, log });
		}
	}

	log.success("[workspace-bump] done");
}

function computeNextVersion(
	current: string | undefined,
	releaseType: string,
	preid: string,
): string {
	const base = current && semver.valid(current) ? current : "0.0.0";
	if (releaseType === "manual") {
		return base;
	}
	if (releaseType === "prerelease") {
		return semver.inc(base, "prerelease", preid) ?? base;
	}
	const bumpType = releaseType as semver.ReleaseType;
	return semver.inc(base, bumpType) ?? base;
}
async function runWorkspaceSetupGlobal(
	params: Record<string, unknown>,
	context: WizardActionContext,
): Promise<void> {
	ensureWorkspaceActionsRegistered();
	const log = context.log;
	const dryRun = resolveDryRun(params, context);
	const repoRoot = resolveRepoRoot(params, context);

	const selections = await resolveWorkspaceGlobalPackages(params, context, repoRoot);
	if (selections.length === 0) {
		log.warn("[workspace-setup-global] no packages selected; skipping.");
		return;
	}

	log.info(
		`[workspace-setup-global] linking ${selections.length} package(s): ${selections.join(
			", ",
		)}`,
	);

	await runCommand("pnpm", ["setup"], { cwd: repoRoot, dryRun, log });

	const projectIndex = await buildWorkspaceProjectIndex(repoRoot);
	for (const selection of selections) {
		const resolved = await resolveWorkspacePackageTarget(
			selection,
			repoRoot,
			projectIndex,
		);
		if (!resolved.filter) {
			log.warn(`[workspace-setup-global] skipping ${selection} (no package name)`);
			continue;
		}
		if (!resolved.dir) {
			log.warn(`[workspace-setup-global] skipping ${selection} (path not found)`);
			continue;
		}
		await runCommand(
			"pnpm",
			["--filter", `${resolved.filter}...`, "run", "build"],
			{ cwd: repoRoot, dryRun, log },
		);
		await runCommand(
			"pnpm",
			["link", "--global"],
			{ cwd: resolved.dir, dryRun, log },
		);
	}

	log.success("[workspace-setup-global] done");
}

function ensureWorkspaceActionsRegistered(): void {
	if (!workspaceActionsRegistered) {
		throw new Error("Workspace actions not registered.");
	}
}

async function processPushEntry(
	entry: WorkspaceManifestEntry,
	options: {
		repoRoot: string;
		dryRun: boolean;
		log: WizardActionContext["log"];
		remoteName?: string;
		commitMessageFile: string;
		fallbackCommitMessage: string;
		pushTags: boolean;
		setUpstream: boolean;
	},
): Promise<void> {
	const {
		repoRoot,
		dryRun,
		log,
		remoteName,
		commitMessageFile,
		fallbackCommitMessage,
		pushTags,
		setUpstream,
	} = options;
	const relPath = readString(entry.path);
	const name = readString(entry.name) ?? relPath ?? "(unknown)";
	const repo = readString(entry.repo);

	if (!repo) {
		log.info(`[workspace-push] skipping ${name} (${relPath ?? "unknown"}): no repo configured`);
		return;
	}
	if (!relPath) {
		log.warn(`[workspace-push] skipping ${name} (missing/invalid path)`);
		return;
	}

	const repoDir = path.resolve(repoRoot, relPath);
	log.info(`[workspace-push] processing ${name} (${relPath})`);

	if (!(await pathExists(repoDir))) {
		log.warn(`[workspace-push] directory ${repoDir} does not exist; skipping.`);
		return;
	}
	if (!hasGitMetadata(repoDir)) {
		log.warn(`[workspace-push] ${repoDir} is not a git repository; skipping.`);
		return;
	}

	const summaryPath = await ensureCommitSummary(
		repoDir,
		commitMessageFile,
		fallbackCommitMessage,
		dryRun,
		log,
	);
	await runCommand("git", ["add", "--all"], { cwd: repoDir, dryRun, log });

	if (await hasStagedChanges(repoDir, dryRun, log)) {
		await runCommand(
			"git",
			["commit", "--no-verify", "-F", summaryPath],
			{ cwd: repoDir, dryRun, log },
		);
		await runCommand(
			"git",
			buildPushArgs(remoteName, { pushTags, setUpstream }),
			{ cwd: repoDir, dryRun, log },
		);
		await clearSummary(summaryPath, commitMessageFile, dryRun, log);
		log.info("[workspace-push] committed and pushed changes.");
		return;
	}

	if (await hasRemoteConfigured(repoDir, remoteName, dryRun, log)) {
		log.info("[workspace-push] no changes to commit; pushing to ensure remote is up-to-date.");
		await runCommand("git", buildPushArgs(remoteName), {
			cwd: repoDir,
			dryRun,
			log,
		});
	} else {
		log.info("[workspace-push] no git remote configured; skipping push.");
	}
}

async function processRootRepo(options: {
	repoRoot: string;
	dryRun: boolean;
	log: WizardActionContext["log"];
	remoteName?: string;
	commitMessageFile: string;
	fallbackCommitMessage: string;
	pushTags: boolean;
	setUpstream: boolean;
	excludePaths?: string[];
}): Promise<void> {
	const {
		repoRoot,
		dryRun,
		log,
		remoteName,
		commitMessageFile,
		fallbackCommitMessage,
		pushTags,
		setUpstream,
	} = options;
	if (!hasGitMetadata(repoRoot)) {
		log.info("[workspace-push] root directory is not a git repository; skipping root push.");
		return;
	}
	log.info("[workspace-push] processing root workspace repository");
	const summaryPath = await ensureCommitSummary(
		repoRoot,
		commitMessageFile,
		fallbackCommitMessage,
		dryRun,
		log,
	);
	const addArgs = ["add", "--all"];
	if (options.excludePaths && options.excludePaths.length > 0) {
		addArgs.push("--", ".", ...options.excludePaths.map((entryPath) => `:(exclude)${entryPath}`));
	}
	await runCommand("git", addArgs, { cwd: repoRoot, dryRun, log });
	if (await hasStagedChanges(repoRoot, dryRun, log)) {
		await runCommand(
			"git",
			["commit", "--no-verify", "-F", summaryPath],
			{ cwd: repoRoot, dryRun, log },
		);
		if (await hasRemoteConfigured(repoRoot, remoteName, dryRun, log)) {
			await runCommand("git", buildPushArgs(remoteName, { pushTags, setUpstream }), {
				cwd: repoRoot,
				dryRun,
				log,
			});
		} else {
			log.info("[workspace-push] root has no git remote configured; skipping push.");
		}
		await clearSummary(summaryPath, commitMessageFile, dryRun, log);
		log.info("[workspace-push] committed root workspace changes.");
		return;
	}
	if (await hasRemoteConfigured(repoRoot, remoteName, dryRun, log)) {
		log.info("[workspace-push] no root changes to commit; pushing.");
		await runCommand("git", buildPushArgs(remoteName), {
			cwd: repoRoot,
			dryRun,
			log,
		});
	} else {
		log.info("[workspace-push] no root remote configured; skipping push.");
	}
}

function buildPushArgs(
	remoteName?: string,
	options?: { pushTags?: boolean; setUpstream?: boolean },
): string[] {
	const args = ["push", "--no-verify"];
	if (options?.setUpstream) {
		args.push("--set-upstream");
	}
	if (remoteName) {
		args.push(remoteName);
		if (options?.setUpstream) {
			args.push("HEAD");
		}
	}
	if (options?.pushTags) {
		args.push("--tags");
	}
	return args;
}

async function ensureCommitSummary(
	repoDir: string,
	commitMessageFile: string,
	fallbackCommitMessage: string,
	dryRun: boolean,
	log: WizardActionContext["log"],
): Promise<string> {
	const summaryPath = path.join(repoDir, commitMessageFile || DEFAULT_COMMIT_MESSAGE_FILE);
	if (dryRun) {
		log.info(
			`[workspace-push] dry-run: ensure ${path.basename(summaryPath)} exists in ${repoDir}`,
		);
		return summaryPath;
	}

	if (!fsSync.existsSync(summaryPath)) {
		log.info(`[workspace-push] missing ${summaryPath}; creating it now.`);
		await fs.mkdir(path.dirname(summaryPath), { recursive: true });
		await fs.writeFile(summaryPath, "");
	}
	const contents = await fs.readFile(summaryPath, "utf8");
	if (contents.trim().length === 0) {
		log.info(
			`[workspace-push] ${path.basename(summaryPath)} is empty; writing default message.`,
		);
		await fs.writeFile(summaryPath, `${fallbackCommitMessage}\n`);
	}
	return summaryPath;
}

async function clearSummary(
	summaryPath: string,
	commitMessageFile: string,
	dryRun: boolean,
	log: WizardActionContext["log"],
): Promise<void> {
	if (dryRun) {
		log.info(
			`[workspace-push] dry-run: skip clearing ${path.basename(commitMessageFile || summaryPath)}.`,
		);
		return;
	}
	await fs.writeFile(summaryPath, "");
}

async function hasStagedChanges(
	repoDir: string,
	dryRun: boolean,
	log: WizardActionContext["log"],
): Promise<boolean> {
	if (dryRun) {
		log.info("[workspace-push] dry-run: skipping staged change detection.");
		return false;
	}
	const result = await execa("git", ["diff", "--cached", "--quiet"], {
		cwd: repoDir,
		reject: false,
	});
	if (result.exitCode === 0) {
		return false;
	}
	if (result.exitCode === 1) {
		return true;
	}
	throw new Error(`[workspace-push] git diff --cached failed in ${repoDir}`);
}

async function hasRemoteConfigured(
	repoDir: string,
	remoteName: string | undefined,
	dryRun: boolean,
	log: WizardActionContext["log"],
): Promise<boolean> {
	if (dryRun) {
		log.info("[workspace-push] dry-run: skipping git remote detection.");
		return Boolean(remoteName);
	}
	const result = await execa("git", ["remote"], {
		cwd: repoDir,
		reject: false,
	});
	if (result.exitCode !== 0) {
		throw new Error(`[workspace-push] git remote failed in ${repoDir}`);
	}
	const remotes = result.stdout.trim().split("\n").filter(Boolean);
	if (remoteName) {
		return remotes.includes(remoteName);
	}
	return remotes.length > 0;
}

async function readPublishedVersion(
	packageName: string,
	registry: string | undefined,
	distTag: string | undefined,
	log: WizardActionContext["log"],
): Promise<string | undefined> {
	const args = [
		"view",
		packageName,
		distTag ? `dist-tags.${distTag}` : "version",
	];
	if (registry) {
		args.push("--registry", registry);
	}
	const result = await execa("pnpm", args, { reject: false });
	if (result.exitCode !== 0) {
		log.warn(`[workspace-publish] unable to read registry version for ${packageName}; proceeding.`);
		return undefined;
	}
	const output = result.stdout.trim();
	return output || undefined;
}

async function isWorkspaceClean(
	manifestPath: string,
	repoRoot: string,
	includeInternal: boolean,
	filters: string[] | undefined,
	log: WizardActionContext["log"],
): Promise<boolean> {
	const manifest = await readWorkspaceManifest(manifestPath);
	const entries = manifest.filter((entry) =>
		shouldProcessPublishEntry(entry, { includeInternal, filters }),
	);

	for (const entry of entries) {
		const relPath = readString(entry.path);
		if (!relPath) {
			continue;
		}
		const pkgDir = path.resolve(repoRoot, relPath);
		if (!(await pathExists(pkgDir))) {
			continue;
		}
		const status = await execa("git", ["status", "--porcelain"], {
			cwd: pkgDir,
			reject: false,
		});
		if (status.exitCode !== 0) {
			throw new Error(`[workspace-publish] git status failed in ${pkgDir}`);
		}
		if (status.stdout.trim().length > 0) {
			log.warn(
				`[workspace-publish] ${relPath} is dirty; auto-bump will be skipped to avoid repeated version increments.`,
			);
			return false;
		}
	}
	return true;
}

async function ensureGitClean(
	pkgDir: string,
	entryName: string,
	dryRun: boolean,
	log: WizardActionContext["log"],
	label = "workspace-publish",
): Promise<void> {
	if (dryRun) {
		log.info(`[${label}] check clean git state for ${entryName} (skipped in dry-run)`);
		return;
	}
	const result = await execa("git", ["status", "--porcelain"], {
		cwd: pkgDir,
		reject: false,
	});
	if (result.exitCode !== 0) {
		throw new Error(`[${label}] git status failed in ${pkgDir}`);
	}
	if (result.stdout.trim().length > 0) {
		throw new Error(
			`[${entryName}] working tree is dirty; commit or stash changes first.`,
		);
	}
}

async function getRemoteUrl(
	repoDir: string,
	remoteName: string,
): Promise<string | undefined> {
	const result = await execa("git", ["remote", "get-url", remoteName], {
		cwd: repoDir,
		reject: false,
	});
	return result.exitCode === 0 ? result.stdout.trim() : undefined;
}

async function readWorkspaceManifest(
	manifestPath: string,
): Promise<WorkspaceManifestEntry[]> {
	if (!(await pathExists(manifestPath))) {
		throw new Error(`workspace manifest not found at ${manifestPath}`);
	}
	const raw = await fs.readFile(manifestPath, "utf8");
	const parsed = JSON.parse(raw) as unknown;
	if (!Array.isArray(parsed)) {
		throw new Error("workspace manifest must be a JSON array");
	}
	return parsed as WorkspaceManifestEntry[];
}

async function readGitSubmodulePaths(repoRoot: string): Promise<string[]> {
	const gitmodulesPath = path.join(repoRoot, ".gitmodules");
	if (!(await pathExists(gitmodulesPath))) {
		return [];
	}

	const raw = await fs.readFile(gitmodulesPath, "utf8");
	const paths = new Set<string>();
	for (const line of raw.split(/\r?\n/u)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith(";")) {
			continue;
		}
		const match = trimmed.match(/^path\s*=\s*(.+)$/u);
		if (!match) {
			continue;
		}
		const rawPath = match[1]?.trim();
		if (!rawPath) {
			continue;
		}
		const normalized = path.normalize(rawPath).split(path.sep).join("/");
		paths.add(normalized);
	}
	return [...paths];
}

function resolveRepoRoot(
	params: Record<string, unknown>,
	context: WizardActionContext,
): string {
	const root = readString(params.repoRoot) ?? context.repoRoot;
	return path.resolve(root);
}

function resolveManifestPath(
	params: Record<string, unknown>,
	context: WizardActionContext,
): string {
	const value = readString(params.manifestPath) ??
		readString(params.manifest) ??
		readString(context.state.answers.workspaceManifestPath) ??
		DEFAULT_MANIFEST_PATH;
	return path.isAbsolute(value) ? value : path.resolve(resolveRepoRoot(params, context), value);
}

function resolveDryRun(
	params: Record<string, unknown>,
	context: WizardActionContext,
): boolean {
	const explicit = readBoolean(params.dryRun);
	return Boolean(context.dryRun || explicit);
}

function normalizeWorkspacePath(entryPath: string, repoRoot: string): string {
	const normalized = path.normalize(
		path.isAbsolute(entryPath) ? path.relative(repoRoot, entryPath) : entryPath,
	);
	return normalized === "" ? "." : normalized;
}

async function resolveWorkspaceGlobalPackages(
	params: Record<string, unknown>,
	context: WizardActionContext,
	repoRoot: string,
): Promise<string[]> {
	const explicit =
		readStringArray(params.globalPackages) ??
		readStringArray(params.packages) ??
		readStringArray(context.state.answers.workspaceGlobalPackages);
	if (explicit && explicit.length > 0) {
		return explicit;
	}

	const manifestPath = readString(params.manifestPath) ??
		readString(context.state.answers.workspaceManifestPath);
	const defaults = await detectWorkspaceGlobalPackages({
		repoRoot,
		manifestPath,
	});
	return defaults;
}

async function detectWorkspaceGlobalPackages(options: {
	repoRoot: string;
	manifestPath?: string;
}): Promise<string[]> {
	const { repoRoot, manifestPath } = options;
	let manifestPaths: Set<string> | undefined;

	if (manifestPath) {
		const resolvedManifest = path.isAbsolute(manifestPath)
			? manifestPath
			: path.resolve(repoRoot, manifestPath);
		try {
			const manifest = await readWorkspaceManifest(resolvedManifest);
			manifestPaths = new Set(
				manifest
					.map((entry) => readString(entry.path))
					.filter((entryPath): entryPath is string => Boolean(entryPath))
					.map((entryPath) =>
						path.normalize(
							path.isAbsolute(entryPath)
								? path.relative(repoRoot, entryPath)
								: entryPath,
						) || ".",
					),
			);
		} catch {
			manifestPaths = undefined;
		}
	}

	const projects = await listWorkspaceProjects({
		repoRoot,
		includeRoot: false,
		maxDepth: 3,
	});
	const selections: string[] = [];
	for (const project of projects) {
		if (manifestPaths && !manifestPaths.has(project.id)) {
			continue;
		}
		if (await packageHasBin(project.packageJsonPath)) {
			selections.push(project.id);
		}
	}
	return selections;
}

interface WorkspaceProjectIndexEntry {
	dir: string;
	name?: string;
}

interface WorkspaceProjectIndex {
	byId: Map<string, WorkspaceProjectIndexEntry>;
	byName: Map<string, WorkspaceProjectIndexEntry>;
}

async function buildWorkspaceProjectIndex(
	repoRoot: string,
): Promise<WorkspaceProjectIndex> {
	const projects = await listWorkspaceProjects({
		repoRoot,
		includeRoot: true,
		maxDepth: 3,
	});
	const byId = new Map<string, WorkspaceProjectIndexEntry>();
	const byName = new Map<string, WorkspaceProjectIndexEntry>();

	for (const project of projects) {
		const dir = project.id === "."
			? repoRoot
			: path.resolve(repoRoot, project.id);
		const name = await readPackageName(project.packageJsonPath);
		const entry = { dir, name };
		byId.set(project.id, entry);
		if (name) {
			byName.set(name, entry);
		}
	}

	return { byId, byName };
}

async function resolveWorkspacePackageTarget(
	selection: string,
	repoRoot: string,
	index: WorkspaceProjectIndex,
): Promise<{ filter?: string; dir?: string }> {
	const trimmed = selection.trim();
	if (!trimmed) {
		return {};
	}

	const looksLikePath =
		trimmed.startsWith(".") ||
		trimmed.includes(path.sep) ||
		path.isAbsolute(trimmed);

	if (looksLikePath) {
		const candidate = path.isAbsolute(trimmed)
			? trimmed
			: path.resolve(repoRoot, trimmed);
		if (await pathExists(candidate)) {
			const packageJsonPath = path.join(candidate, "package.json");
			const name = await readPackageName(packageJsonPath);
			return { filter: name ?? trimmed, dir: candidate };
		}
	}

	const byName = index.byName.get(trimmed);
	if (byName) {
		return { filter: byName.name ?? trimmed, dir: byName.dir };
	}

	const byId = index.byId.get(trimmed);
	if (byId) {
		return { filter: byId.name ?? trimmed, dir: byId.dir };
	}

	return { filter: trimmed };
}

async function readPackageName(packageJsonPath: string): Promise<string | undefined> {
	if (!(await pathExists(packageJsonPath))) {
		return undefined;
	}
	try {
		const raw = await fs.readFile(packageJsonPath, "utf8");
		const parsed = JSON.parse(raw) as { name?: string };
		const name = readString(parsed.name);
		return name ?? undefined;
	} catch {
		return undefined;
	}
}

async function packageHasBin(packageJsonPath: string): Promise<boolean> {
	try {
		const raw = await fs.readFile(packageJsonPath, "utf8");
		const parsed = JSON.parse(raw) as { bin?: unknown };
		const bin = parsed.bin;
		if (typeof bin === "string") {
			return bin.trim().length > 0;
		}
		if (bin && typeof bin === "object") {
			return Object.keys(bin as Record<string, unknown>).length > 0;
		}
	} catch {
		return false;
	}
	return false;
}

function makeSafeName(value: string): string {
	return value.replace(/[^a-zA-Z0-9_.-]/g, "_");
}

function pickExistingTsconfig(
	projectDir: string,
	candidates: string[],
): string | undefined {
	for (const candidate of candidates) {
		if (!candidate) continue;
		const absolute = path.resolve(projectDir, candidate);
		if (fsSync.existsSync(absolute)) {
			return path.relative(projectDir, absolute);
		}
	}
	return undefined;
}

async function updatePackageJsonScripts(
	packageJsonPath: string,
	newScripts: Record<string, string>,
	options: {
		overwrite: boolean;
		dryRun: boolean;
		log: WizardActionContext["log"];
	},
): Promise<void> {
	const { overwrite, dryRun, log } = options;
	let packageJson: Record<string, unknown> = {};
	let scripts: Record<string, string> = {};

	if (await pathExists(packageJsonPath)) {
		const raw = await fs.readFile(packageJsonPath, "utf8");
		packageJson = JSON.parse(raw) as Record<string, unknown>;
		const existingScripts = packageJson.scripts;
		if (existingScripts && typeof existingScripts === "object") {
			scripts = Object.fromEntries(
				Object.entries(existingScripts as Record<string, unknown>)
					.filter(([key, value]) => typeof value === "string")
					.map(([key, value]) => [key, value as string]),
			);
		}
	}

	let changed = false;
	for (const [key, value] of Object.entries(newScripts)) {
		if (!overwrite && scripts[key]) {
			continue;
		}
		if (scripts[key] !== value) {
			scripts[key] = value;
			changed = true;
		}
	}

	if (!changed) {
		return;
	}

	const nextJson = { ...packageJson, scripts };
	const serialized = `${JSON.stringify(nextJson, null, 2)}\n`;

	if (dryRun) {
		log.info(`[workspace] dry-run: update ${packageJsonPath} scripts`);
		return;
	}

	await fs.writeFile(packageJsonPath, serialized, "utf8");
	log.info(`[workspace] updated scripts in ${packageJsonPath}`);
}

async function ensureQuickTsconfig(
	projectDir: string,
	baseTsconfig: string,
	quickTsconfig: string,
	options: { dryRun: boolean; log: WizardActionContext["log"] },
): Promise<void> {
	const { dryRun, log } = options;
	if (!quickTsconfig || quickTsconfig === baseTsconfig) {
		return;
	}
	const quickPath = path.resolve(projectDir, quickTsconfig);
	if (await pathExists(quickPath)) {
		return;
	}

	const content = {
		extends: baseTsconfig,
		compilerOptions: {
			incremental: true,
		},
	};

	if (dryRun) {
		log.info(`[workspace] dry-run: seed quick tsconfig at ${quickTsconfig}`);
		return;
	}

	await ensureDir(path.dirname(quickPath), dryRun, log);
	await fs.writeFile(quickPath, `${JSON.stringify(content, null, 2)}\n`, "utf8");
	log.info(`[workspace] seeded quick tsconfig at ${quickTsconfig}`);
}

async function ensureDerivedTsconfig(
	projectDir: string,
	targetTsconfig: string,
	parentTsconfig: string,
	options: { dryRun: boolean; log: WizardActionContext["log"] },
): Promise<void> {
	const { dryRun, log } = options;
	if (!targetTsconfig || targetTsconfig === parentTsconfig) return;
	const targetPath = path.resolve(projectDir, targetTsconfig);
	if (await pathExists(targetPath)) return;

	const parentExists = await pathExists(path.resolve(projectDir, parentTsconfig));
	if (!parentExists) return;

	const content = {
		extends: parentTsconfig,
		compilerOptions: {
			incremental: true,
		},
	};

	if (dryRun) {
		log.info(`[workspace] dry-run: seed tsconfig at ${targetTsconfig}`);
		return;
	}

	await ensureDir(path.dirname(targetPath), dryRun, log);
	await fs.writeFile(targetPath, `${JSON.stringify(content, null, 2)}\n`, "utf8");
	log.info(`[workspace] seeded tsconfig at ${targetTsconfig}`);
}

async function ensureTurboTsconfig(
	projectDir: string,
	baseTsconfig: string,
	turboTsconfig: string,
	options: { dryRun: boolean; log: WizardActionContext["log"] },
): Promise<void> {
	const { dryRun, log } = options;
	if (!turboTsconfig || turboTsconfig === baseTsconfig) {
		return;
	}
	const turboPath = path.resolve(projectDir, turboTsconfig);
	if (await pathExists(turboPath)) {
		return;
	}

	const content = {
		extends: baseTsconfig,
		compilerOptions: {
			incremental: true,
		},
	};

	if (dryRun) {
		log.info(`[workspace] dry-run: seed turbo tsconfig at ${turboTsconfig}`);
		return;
	}

	await ensureDir(path.dirname(turboPath), dryRun, log);
	await fs.writeFile(turboPath, `${JSON.stringify(content, null, 2)}\n`, "utf8");
	log.info(`[workspace] seeded turbo tsconfig at ${turboTsconfig}`);
}

async function runCommand(
	command: string,
	args: string[],
	options: {
		cwd?: string;
		dryRun: boolean;
		log: WizardActionContext["log"];
		env?: Record<string, string>;
	},
): Promise<void> {
	const { cwd, dryRun, log, env } = options;
	const location = cwd ? `(cd ${cwd})` : "";
	if (dryRun) {
		log.info(`[workspace] dry-run: ${location} ${command} ${args.join(" ")}`.trim());
		return;
	}

	try {
		await execa(command, args, {
			cwd,
			stdio: "inherit",
			env: env ? { ...process.env, ...env } : undefined,
		});
	} catch (error) {
		const message =
			error instanceof Error ? error.message : String(error);
		throw new Error(
			`command failed (${command} ${args.join(" ")}): ${message}`,
		);
	}
}

async function ensureDir(
	target: string,
	dryRun: boolean,
	log: WizardActionContext["log"],
): Promise<void> {
	if (await pathExists(target)) {
		return;
	}
	if (dryRun) {
		log.info(`[workspace] dry-run: mkdir -p ${target}`);
		return;
	}
	await fs.mkdir(target, { recursive: true });
}

function hasGitMetadata(dir: string): boolean {
	return fsSync.existsSync(path.join(dir, ".git"));
}

async function isEmptyDir(dir: string): Promise<boolean> {
	try {
		const entries = await fs.readdir(dir);
		return entries.length === 0;
	} catch {
		return false;
	}
}

async function pathExists(target: string): Promise<boolean> {
	try {
		await fs.stat(target);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return false;
		}
		throw error;
	}
}

function toHttpsIfRequested(repoUrl: string, useHttps: boolean): string {
	if (!useHttps) {
		return repoUrl;
	}
	const match = /^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/.exec(repoUrl);
	if (!match) {
		return repoUrl;
	}
	const org = match[1];
	const repo = match[2].endsWith(".git") ? match[2] : `${match[2]}.git`;
	return `https://github.com/${org}/${repo}`;
}

function shouldProcessPublishEntry(
	entry: WorkspaceManifestEntry,
	options: { includeInternal: boolean; filters: string[] | undefined },
): boolean {
	const { includeInternal, filters } = options;
	if (filters && filters.length > 0) {
		const matches = filters.some((filter) =>
			[entry.name, entry.path].some(
				(value) => typeof value === "string" && value.includes(filter),
			),
		);
		if (!matches) {
			return false;
		}
	}

	const role = readString(entry.role) ?? "independent";
	if (role === "internal-helper" && !includeInternal) {
		return false;
	}
	return true;
}

function shouldProcessPushEntry(
	entry: WorkspaceManifestEntry,
	options: { filters: string[] | undefined },
): boolean {
	const { filters } = options;
	if (filters && filters.length > 0) {
		const matches = filters.some((filter) =>
			[entry.name, entry.path].some(
				(value) => typeof value === "string" && value.includes(filter),
			),
		);
		if (!matches) {
			return false;
		}
	}
	return true;
}

function readBoolean(value: unknown): boolean | undefined {
	if (typeof value === "boolean") {
		return value;
	}
	if (typeof value === "string") {
		if (value === "true") {
			return true;
		}
		if (value === "false") {
			return false;
		}
	}
	return undefined;
}

function readString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function readStringArray(value: unknown): string[] | undefined {
	if (Array.isArray(value)) {
		const filtered = value
			.filter((entry) => typeof entry === "string")
			.map((entry) => entry.trim())
			.filter((entry) => entry.length > 0);
		return filtered.length > 0 ? filtered : undefined;
	}
	if (typeof value === "string") {
		const trimmed = value.trim();
		if (!trimmed) {
			return undefined;
		}
		if (trimmed.startsWith("[")) {
			try {
				const parsed = JSON.parse(trimmed) as unknown;
				if (Array.isArray(parsed)) {
					const filtered = parsed
						.filter((entry) => typeof entry === "string")
						.map((entry) => entry.trim())
						.filter((entry) => entry.length > 0);
					return filtered.length > 0 ? filtered : undefined;
				}
			} catch {
				// Fall through to treat as a single string.
			}
		}
		return [trimmed];
	}
	return undefined;
}
