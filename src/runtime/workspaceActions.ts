import { promises as fs } from "node:fs";
import fsSync from "node:fs";
import path from "node:path";
import { execa } from "execa";

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
		id: "workspace-setup-global",
		label: "Workspace setup global",
		plan: () => ({
			summary: "Build and link the Dev Wizard CLI globally",
		}),
		run: runWorkspaceSetupGlobal,
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

	for (const entry of manifest) {
		const relPath = readString(entry.path);
		const repo = readString(entry.repo);
		const name = readString(entry.name) ?? relPath ?? "(unknown)";
		const defaultBranch = readString(entry.defaultBranch) ?? fallbackBranch;

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

	const manifest = await readWorkspaceManifest(manifestPath);
	const entries = manifest.filter((entry) =>
		shouldProcessPushEntry(entry, { filters }),
	);

	if (entries.length === 0) {
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

	if (includeRoot) {
		await processRootRepo({
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

	log.success("[workspace-push] done");
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
	const releaseType = readString(params.releaseType) ??
		readString(context.state.answers.workspacePublishReleaseType);
	const prereleaseId = readString(params.prereleaseId) ??
		readString(context.state.answers.workspacePublishPrereleaseId);
	const checks = readStringArray(params.checks) ??
		readStringArray(context.state.answers.workspacePublishChecks) ??
		["lint", "typecheck", "test", "build"];
	const filters = readStringArray(params.filters) ??
		readStringArray(context.state.answers.workspacePublishTargets);
	const runPushFirst = readBoolean(params.runPushFirst) ??
		readBoolean(context.state.answers.workspacePublishRunPushFirst) ??
		false;
	const pushParams = {
		manifestPath,
		dryRun,
		remoteName: readString(context.state.answers.workspaceGitRemote),
		commitMessageFile: readString(context.state.answers.workspacePushCommitFile) ??
			DEFAULT_COMMIT_MESSAGE_FILE,
		fallbackCommitMessage: readString(
			context.state.answers.workspacePushFallbackCommitMessage,
		) ?? DEFAULT_COMMIT_MESSAGE,
		requireClean: readBoolean(context.state.answers.workspacePushRequireClean) ?? true,
		pushTags: readBoolean(context.state.answers.workspacePushPushTags) ?? false,
		setUpstream: readBoolean(context.state.answers.workspacePushSetUpstream) ?? true,
		filters: readStringArray(context.state.answers.workspacePushTargets),
		includeRoot: readBoolean(context.state.answers.workspacePushIncludeRoot) ?? true,
	};

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

		if (requireClean) {
			await ensureGitClean(pkgDir, name, dryRun, log);
		} else {
			log.info("[workspace-publish] git clean check skipped (per configuration).");
		}

		const pkgJson = JSON.parse(await fs.readFile(pkgJsonPath, "utf8")) as {
			scripts?: Record<string, unknown>;
		};
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

		const publishCommand = Array.isArray(entry.publishCommand) &&
			entry.publishCommand.every((part) => typeof part === "string")
			? entry.publishCommand
			: DEFAULT_PUBLISH_COMMAND;
		if (publishCommand.length === 0) {
			log.info("[workspace-publish] publish command empty; skipping publish.");
			continue;
		}

		const [command, ...args] = publishCommand;
		const env: Record<string, string> = {};
		if (publishRegistry) {
			env.NPM_CONFIG_REGISTRY = publishRegistry;
		}
		if (distTag) {
			env.NPM_CONFIG_TAG = distTag;
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
	await runCommand("git", ["add", "--all"], { cwd: repoRoot, dryRun, log });
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
		args.push("-u");
	}
	if (remoteName) {
		args.push(remoteName);
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
