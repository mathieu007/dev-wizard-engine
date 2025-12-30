import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
const REPORTS_DIR = ".reports";
const RUNS_DIR = "runs";
const STATE_FILENAME = "state.json";
const METADATA_FILENAME = "metadata.json";
class FileCheckpointManager {
    options;
    directory;
    interval;
    retention;
    pendingSteps = 0;
    status = "running";
    constructor(options, runId) {
        this.options = options;
        this.directory = path.join(options.repoRoot, REPORTS_DIR, RUNS_DIR, runId);
        this.interval = Math.max(1, options.interval ?? 1);
        this.retention = options.retention;
        this.runId = runId;
    }
    runId;
    async record(state, options = {}) {
        if (options.immediate !== true) {
            this.pendingSteps += 1;
            if (this.pendingSteps < this.interval) {
                return;
            }
        }
        this.pendingSteps = 0;
        await this.writeState(state, this.status);
    }
    async finalize(state, status) {
        this.status = status;
        await this.writeState(state, status);
        await this.prune();
    }
    async writeState(state, status) {
        await mkdir(this.directory, { recursive: true });
        const statePayload = JSON.stringify(prepareStateForSerialization({ ...state, runId: this.runId }), serializationReplacer, 2);
        const now = new Date();
        const metadataPayload = JSON.stringify({
            id: this.runId,
            scenarioId: state.scenario.id,
            scenarioLabel: state.scenario.label,
            startedAt: state.startedAt.toISOString(),
            updatedAt: now.toISOString(),
            status,
            dryRun: this.options.dryRun,
            flowCursor: state.flowCursor ?? 0,
            stepCursor: state.stepCursor ?? 0,
            phase: state.phase,
            postRunCursor: state.postRunCursor,
        }, null, 2);
        await Promise.all([
            writeFile(path.join(this.directory, STATE_FILENAME), `${statePayload}\n`),
            writeFile(path.join(this.directory, METADATA_FILENAME), `${metadataPayload}\n`),
        ]);
    }
    async prune() {
        const keep = this.retention;
        if (!keep || keep <= 0) {
            return;
        }
        const checkpoints = await listCheckpoints(this.options.repoRoot, {
            scenarioId: this.options.scenarioId,
        });
        const excess = checkpoints
            .filter((entry) => entry.id !== this.runId)
            .slice(keep);
        await Promise.all(excess.map(async (entry) => {
            try {
                await rm(entry.path, { recursive: true, force: true });
            }
            catch {
                // Best-effort cleanup; ignore errors.
            }
        }));
    }
}
export async function createCheckpointManager(options) {
    if (options.interval !== undefined && options.interval <= 0) {
        return undefined;
    }
    const runId = options.runId ?? generateRunId(options.scenarioId);
    return new FileCheckpointManager(options, runId);
}
export async function listCheckpoints(repoRoot, filter = {}) {
    const runsRoot = path.join(repoRoot, REPORTS_DIR, RUNS_DIR);
    let entries;
    try {
        entries = await readdir(runsRoot, { withFileTypes: true });
    }
    catch {
        return [];
    }
    const results = [];
    for (const entry of entries) {
        if (!entry.isDirectory()) {
            continue;
        }
        const runDir = path.join(runsRoot, entry.name);
        const metadataPath = path.join(runDir, METADATA_FILENAME);
        try {
            const payload = await readFile(metadataPath, "utf8");
            const data = JSON.parse(payload);
            if (filter.scenarioId && data.scenarioId !== filter.scenarioId) {
                continue;
            }
            results.push({
                ...data,
                path: runDir,
            });
        }
        catch {
            continue;
        }
    }
    results.sort((a, b) => {
        const left = Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
        if (left !== 0) {
            return left;
        }
        return a.id.localeCompare(b.id);
    });
    return results;
}
export async function loadCheckpoint(options) {
    const runDir = resolveCheckpointDirectory(options.repoRoot, options.identifier);
    const [statePayload, metadataPayload] = await Promise.all([
        readFile(path.join(runDir, STATE_FILENAME), "utf8"),
        readFile(path.join(runDir, METADATA_FILENAME), "utf8"),
    ]);
    const metadata = JSON.parse(metadataPayload);
    const rawState = JSON.parse(statePayload);
    const state = hydrateWizardState(rawState);
    state.runId = metadata.id;
    return {
        state,
        metadata: {
            ...metadata,
            path: runDir,
        },
    };
}
function resolveCheckpointDirectory(repoRoot, identifier) {
    const runsRoot = path.join(repoRoot, REPORTS_DIR, RUNS_DIR);
    const candidate = path.isAbsolute(identifier)
        ? identifier
        : path.join(runsRoot, identifier);
    return candidate;
}
function generateRunId(scenarioId) {
    const now = new Date();
    const parts = [
        now.getUTCFullYear(),
        pad(now.getUTCMonth() + 1),
        pad(now.getUTCDate()),
        "-",
        pad(now.getUTCHours()),
        pad(now.getUTCMinutes()),
        pad(now.getUTCSeconds()),
    ];
    const timestamp = parts.join("");
    const sanitizedScenario = scenarioId.replace(/[^a-zA-Z0-9-_]/g, "-");
    return `${timestamp}-${sanitizedScenario}`;
}
function pad(value) {
    return value.toString().padStart(2, "0");
}
function prepareStateForSerialization(state) {
    return {
        ...state,
    };
}
function serializationReplacer(_key, value) {
    if (value instanceof Date) {
        return value.toISOString();
    }
    if (value instanceof Error) {
        const error = {
            name: value.name,
            message: value.message,
            stack: value.stack,
        };
        return error;
    }
    return value;
}
function hydrateWizardState(state) {
    state.startedAt = new Date(state.startedAt);
    if (state.endedAt) {
        state.endedAt = new Date(state.endedAt);
    }
    for (const record of state.history ?? []) {
        hydrateCommandExecutionRecord(record);
    }
    if (state.lastCommand) {
        hydrateCommandExecutionRecord(state.lastCommand);
    }
    for (const flow of state.flowRuns ?? []) {
        hydrateFlowRunRecord(flow);
    }
    return state;
}
function hydrateCommandExecutionRecord(record) {
    record.startedAt = new Date(record.startedAt);
    record.endedAt = new Date(record.endedAt);
    if (record.error && !(record.error instanceof Error)) {
        const serialized = record.error;
        const error = new Error(serialized.message ?? "Command failed");
        error.name = serialized.name ?? "Error";
        if (serialized.stack) {
            error.stack = serialized.stack;
        }
        record.error = error;
    }
}
function hydrateFlowRunRecord(record) {
    record.startedAt = new Date(record.startedAt);
    record.endedAt = new Date(record.endedAt);
}
//# sourceMappingURL=checkpoints.js.map