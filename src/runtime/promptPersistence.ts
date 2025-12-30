import fs from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

import type { PromptPersistenceScope } from "../loader/types";

export interface PromptPersistenceOptions {
	repoRoot: string;
	scenarioId: string;
	filePath?: string;
	metadata?: PromptPersistenceMetadata;
}

interface PromptPersistenceSnapshot {
	scenario?: Record<string, unknown>;
	projects?: Record<string, Record<string, unknown>>;
	meta?: PromptPersistenceMetadata;
}

export interface PromptPersistenceTarget {
	scope: PromptPersistenceScope;
	key: string;
	projectId?: string;
}

export interface PromptPersistenceMetadata {
	scenarioId?: string;
	identity?: PromptPersistenceIdentityMetadata;
	execution?: PromptPersistenceExecutionMetadata;
}

export interface PromptPersistenceExecutionMetadata {
	sandbox?: boolean;
	sandboxSlug?: string;
}

export interface PromptPersistenceIdentityMetadata {
	slug?: string;
	segments?: PromptPersistenceIdentitySegment[];
}

export interface PromptPersistenceIdentitySegment {
	id: string;
	value: string;
	label?: string;
	details?: Record<string, unknown>;
}

export class PromptPersistenceManager {
	private readonly filePath: string;
	private readonly metadata?: PromptPersistenceMetadata;
	private snapshot: PromptPersistenceSnapshot = {};
	private loaded = false;
	private dirty = false;
	private existedAtLoad = false;

	constructor(options: PromptPersistenceOptions) {
		this.metadata = options.metadata;
		if (options.filePath) {
			this.filePath = path.isAbsolute(options.filePath)
				? options.filePath
				: path.resolve(options.repoRoot, options.filePath);
		} else {
			this.filePath = path.join(
				options.repoRoot,
				".dev-wizard",
				"answers",
				`${sanitizePersistenceSegment(options.scenarioId)}.json`,
			);
		}
	}

	async load(): Promise<void> {
		if (this.loaded) {
			return;
		}
		try {
			const raw = await fs.readFile(this.filePath, "utf8");
			this.snapshot = JSON.parse(raw) as PromptPersistenceSnapshot;
			this.existedAtLoad = true;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
				throw error;
			}
			this.snapshot = {};
		}
		this.loaded = true;
		this.applyMetadataOverrides();
	}

	get(target: PromptPersistenceTarget): unknown {
		if (!this.loaded) {
			return undefined;
		}
		switch (target.scope) {
		case "project": {
			if (!target.projectId) {
				return undefined;
			}
			return this.snapshot.projects?.[target.projectId]?.[target.key];
		}
		case "scenario":
		default:
			return this.snapshot.scenario?.[target.key];
		}
	}

	set(target: PromptPersistenceTarget, value: unknown): void {
		if (!this.loaded) {
			return;
		}
		if (value === undefined) {
			this.delete(target);
			return;
		}
		switch (target.scope) {
		case "project":
			if (!target.projectId) {
				return;
			}
			this.snapshot.projects = this.snapshot.projects ?? {};
			this.snapshot.projects[target.projectId] =
				this.snapshot.projects[target.projectId] ?? {};
			this.updateValue(
				this.snapshot.projects[target.projectId]!,
				target.key,
				value,
			);
			break;
		case "scenario":
		default:
			this.snapshot.scenario = this.snapshot.scenario ?? {};
			this.updateValue(this.snapshot.scenario, target.key, value);
			break;
		}
	}

	private updateValue(
		target: Record<string, unknown>,
		key: string,
		value: unknown,
	): void {
		if (key.length === 0) {
			return;
		}
		const existing = target[key];
		if (existing !== undefined && isDeepStrictEqual(existing, value)) {
			return;
		}
		this.dirty = true;
		target[key] = value;
	}

	private delete(target: PromptPersistenceTarget): void {
		switch (target.scope) {
		case "project":
			if (!target.projectId || !this.snapshot.projects?.[target.projectId]) {
				return;
			}
			if (target.key in this.snapshot.projects[target.projectId]!) {
				delete this.snapshot.projects[target.projectId]![target.key];
				this.dirty = true;
			}
			break;
		case "scenario":
		default:
			if (!this.snapshot.scenario) {
				return;
			}
			if (target.key in this.snapshot.scenario) {
				delete this.snapshot.scenario[target.key];
				this.dirty = true;
			}
			break;
		}
	}

	async save(): Promise<void> {
		if (!this.loaded || !this.dirty) {
			return;
		}
		const serialized = JSON.stringify(this.snapshot, null, 2);
		await fs.mkdir(path.dirname(this.filePath), { recursive: true });
		await fs.writeFile(this.filePath, `${serialized}\n`, "utf8");
		this.dirty = false;
	}

	resetAllAnswers(): void {
		if (!this.loaded) {
			return;
		}
		const hadScenario =
			this.snapshot.scenario &&
			Object.keys(this.snapshot.scenario).length > 0;
		const hadProjects =
			this.snapshot.projects &&
			Object.keys(this.snapshot.projects).length > 0;
		if (hadScenario) {
			this.snapshot.scenario = {};
		}
		if (hadProjects) {
			this.snapshot.projects = {};
		}
		if (hadScenario || hadProjects) {
			this.dirty = true;
		}
	}

	setExecutionMetadata(metadata: PromptPersistenceExecutionMetadata): void {
		if (!this.loaded) {
			return;
		}
		this.snapshot.meta = this.snapshot.meta ?? {};
		const currentExecution = this.snapshot.meta.execution;
		const nextExecution = { ...(currentExecution ?? {}), ...metadata };
		if (!isDeepStrictEqual(currentExecution, nextExecution)) {
			this.snapshot.meta.execution = nextExecution;
			this.dirty = true;
		}
	}

	getFilePath(): string {
		return this.filePath;
	}

	getMetadata(): PromptPersistenceMetadata | undefined {
		if (!this.loaded) {
			return undefined;
		}
		return this.snapshot.meta;
	}

	didLoadExistingSnapshot(): boolean {
		return this.existedAtLoad;
	}

	private applyMetadataOverrides(): void {
		if (!this.metadata || !this.loaded) {
			return;
		}
		this.snapshot.meta = this.snapshot.meta ?? {};
		let changed = false;
		if (
			this.metadata.scenarioId &&
			this.snapshot.meta.scenarioId !== this.metadata.scenarioId
		) {
			this.snapshot.meta.scenarioId = this.metadata.scenarioId;
			changed = true;
		}
		if (this.metadata.identity) {
			const currentIdentity = this.snapshot.meta.identity;
			const nextIdentity = mergeIdentityMetadata(
				currentIdentity,
				this.metadata.identity,
			);
			if (!isDeepStrictEqual(currentIdentity, nextIdentity)) {
				this.snapshot.meta.identity = nextIdentity;
				changed = true;
			}
		}
		if (this.metadata.execution) {
			const currentExecution = this.snapshot.meta.execution;
			const nextExecution = {
				...(currentExecution ?? {}),
				...this.metadata.execution,
			};
			if (!isDeepStrictEqual(currentExecution, nextExecution)) {
				this.snapshot.meta.execution = nextExecution;
				changed = true;
			}
		}
		if (changed) {
			this.dirty = true;
		}
	}
}

export async function createPromptPersistenceManager(
	options: PromptPersistenceOptions,
): Promise<PromptPersistenceManager> {
	const manager = new PromptPersistenceManager(options);
	await manager.load();
	return manager;
}

function sanitizeSegment(segment: string): string {
	return segment.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

function mergeIdentityMetadata(
	current: PromptPersistenceIdentityMetadata | undefined,
	incoming: PromptPersistenceIdentityMetadata,
): PromptPersistenceIdentityMetadata {
	const result: PromptPersistenceIdentityMetadata = {
		...(current ?? {}),
		...incoming,
	};
	if (incoming.segments && incoming.segments.length > 0) {
		result.segments = incoming.segments.map((segment) => ({
			id: segment.id,
			value: segment.value,
			label: segment.label,
			details: segment.details ? { ...segment.details } : undefined,
		}));
	}
	return result;
}

export function sanitizePersistenceSegment(segment: string): string {
	return sanitizeSegment(segment);
}
