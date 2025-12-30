import fs from "node:fs/promises";
import path from "node:path";

import type { ScenarioPlan } from "./executor.js";

export interface DevWizardManifest {
	schemaVersion: 1;
	scenarioId: string;
	scenarioLabel?: string;
	scenarioDescription?: string;
	createdAt: string;
	repoRoot: string;
	configPaths: string[];
	configHash: string;
	cliVersion?: string;
	coreVersion?: string;
	environment?: string;
	plan: ScenarioPlan;
	answers: Record<string, unknown>;
	registerArgs?: readonly string[];
}

export interface LoadedManifest extends DevWizardManifest {
	filePath: string;
}

export async function writeManifest(
	filePath: string,
	manifest: DevWizardManifest,
): Promise<void> {
	const resolved = path.resolve(filePath);
	await fs.mkdir(path.dirname(resolved), { recursive: true });
	const payload = JSON.stringify(manifest, null, 2);
	await fs.writeFile(resolved, `${payload}\n`, "utf8");
}

export async function readManifest(filePath: string): Promise<LoadedManifest> {
	const resolved = path.resolve(filePath);
	const raw = await fs.readFile(resolved, "utf8");
	const parsed = JSON.parse(raw) as DevWizardManifest;
	if (parsed.schemaVersion !== 1) {
		throw new Error(
			`Unsupported manifest schema version ${String(parsed.schemaVersion)} (expected 1).`,
		);
	}
	return {
		...parsed,
		filePath: resolved,
	};
}
