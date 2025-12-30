import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
const DEFAULT_MAX_ENTRIES = 50;
export function createPromptHistoryManager(options = {}) {
    const maxEntries = Math.max(1, options.maxEntries ?? DEFAULT_MAX_ENTRIES);
    const storagePath = options.storagePath;
    const store = loadExistingHistory(storagePath);
    let dirty = false;
    return {
        getAll(key) {
            const resolvedKey = normaliseKey(key);
            if (!resolvedKey) {
                return [];
            }
            return store.get(resolvedKey) ?? [];
        },
        record(key, value) {
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
            const output = Object.fromEntries(Array.from(store.entries()).map(([key, values]) => [
                key,
                values.slice(-maxEntries),
            ]));
            try {
                await mkdir(path.dirname(storagePath), { recursive: true });
                await writeFile(storagePath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
                dirty = false;
            }
            catch {
                // Ignore persistence failures; history persistence is a best-effort feature.
            }
        },
    };
}
function loadExistingHistory(storagePath) {
    if (!storagePath || !existsSync(storagePath)) {
        return new Map();
    }
    try {
        const raw = readFileSync(storagePath, "utf8");
        const parsed = JSON.parse(raw);
        const entries = Object.entries(parsed ?? {});
        const store = new Map();
        for (const [key, value] of entries) {
            const resolvedKey = normaliseKey(key);
            if (!resolvedKey) {
                continue;
            }
            if (!Array.isArray(value)) {
                continue;
            }
            const values = value.filter((item) => typeof item === "string");
            if (values.length === 0) {
                continue;
            }
            store.set(resolvedKey, values);
        }
        return store;
    }
    catch {
        return new Map();
    }
}
function normaliseKey(key) {
    if (typeof key !== "string") {
        return undefined;
    }
    const trimmed = key.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}
//# sourceMappingURL=promptHistory.js.map