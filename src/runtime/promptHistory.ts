import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export interface PromptHistoryManager {
	getAll(key: string): readonly string[];
	record(key: string, value: string): void;
	close(): Promise<void>;
}

export interface PromptHistoryOptions {
	maxEntries?: number;
	storagePath?: string;
}

const DEFAULT_MAX_ENTRIES = 50;

export function createPromptHistoryManager(
	options: PromptHistoryOptions = {},
): PromptHistoryManager {
	const maxEntries = Math.max(1, options.maxEntries ?? DEFAULT_MAX_ENTRIES);
	const storagePath = options.storagePath;
	const store = loadExistingHistory(storagePath);
	let dirty = false;

	return {
		getAll(key: string): readonly string[] {
			const resolvedKey = normaliseKey(key);
			if (!resolvedKey) {
				return [];
			}
			return store.get(resolvedKey) ?? [];
		},

		record(key: string, value: string) {
			const resolvedKey = normaliseKey(key);
			if (!resolvedKey || typeof value !== "string") {
				return;
			}

			if (value.trim().length === 0) {
				return;
			}

			const history = store.get(resolvedKey) ?? [];
			const previous = history[history.length - 1];
			if (previous === value) {
				return;
			}
			const next = [...history, value];
			if (next.length > maxEntries) {
				next.splice(0, next.length - maxEntries);
			}

			store.set(resolvedKey, next);
			dirty = true;
		},

		async close() {
			if (!storagePath || !dirty) {
				return;
			}

			const output = Object.fromEntries(
				Array.from(store.entries()).map(([key, values]) => [
					key,
					values.slice(-maxEntries),
				]),
			);

			try {
				await mkdir(path.dirname(storagePath), { recursive: true });
				await writeFile(
					storagePath,
					`${JSON.stringify(output, null, 2)}\n`,
					"utf8",
				);
				dirty = false;
			} catch {
				// Ignore persistence failures; history persistence is a best-effort feature.
			}
		},
	};
}

function loadExistingHistory(
	storagePath: string | undefined,
): Map<string, string[]> {
	if (!storagePath || !existsSync(storagePath)) {
		return new Map();
	}

	try {
		const raw = readFileSync(storagePath, "utf8");
		const parsed = JSON.parse(raw) as Record<string, unknown>;
		const entries = Object.entries(parsed ?? {});
		const store = new Map<string, string[]>();

		for (const [key, value] of entries) {
			const resolvedKey = normaliseKey(key);
			if (!resolvedKey) {
				continue;
			}

			if (!Array.isArray(value)) {
				continue;
			}

			const values = value.filter((item): item is string => typeof item === "string");
			if (values.length === 0) {
				continue;
			}

			store.set(resolvedKey, values);
		}

		return store;
	} catch {
		return new Map();
	}
}

function normaliseKey(key: string): string | undefined {
	if (typeof key !== "string") {
		return undefined;
	}
	const trimmed = key.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}
