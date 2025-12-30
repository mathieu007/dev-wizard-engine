import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildIntegrationTimingSnapshot } from "./integrationTimings.js";
import { extractWorkflowMetadata } from "./workflowMetadata.js";
import { loadReleaseEmailStatus } from "./releaseEmailStatus.js";
import { summarizeCapturedOutput } from "./capturedOutput.js";
const WORKFLOW_HISTORY_LIMIT = 50;
const INTEGRATION_TIMINGS_HISTORY_LIMIT = 50;
export async function writeWorkflowAnalyticsReports(options) {
    const { state } = options;
    if (state.history.length === 0 && state.integrationTimings.length === 0) {
        return;
    }
    const { workflows, integrationSources } = computeWorkflowAnalytics(state);
    if (workflows.length === 0 && integrationSources.length === 0) {
        return;
    }
    const repoRoot = options.repoRoot ?? process.cwd();
    const reportsDir = path.join(repoRoot, ".reports");
    const workflowsLatestPath = path.join(reportsDir, "workflows-latest.json");
    const workflowsHistoryPath = path.join(reportsDir, "workflows-history.json");
    const integrationTimingsLatestPath = path.join(reportsDir, "integration-timings-latest.json");
    const integrationTimingsHistoryPath = path.join(reportsDir, "integration-timings-history.json");
    const releaseEmailStatusPath = path.join(reportsDir, "release-email-status.json");
    await mkdir(reportsDir, { recursive: true });
    const generatedAt = new Date().toISOString();
    let releaseEmail;
    try {
        releaseEmail = await loadReleaseEmailStatus(releaseEmailStatusPath);
    }
    catch (error) {
        console.warn(`Failed to load release email status: ${error instanceof Error ? error.message : String(error)}`);
    }
    const history = await loadWorkflowAnalyticsHistory(workflowsHistoryPath);
    const previousEntry = history.at(-1);
    const previous = previousEntry ? buildSnapshotPreview(previousEntry) : undefined;
    const snapshot = {
        generatedAt,
        workflows,
        ...(releaseEmail ? { releaseEmail } : {}),
        ...(previous ? { previous } : {}),
    };
    await writeFile(workflowsLatestPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
    await appendWorkflowAnalyticsHistory(history, workflowsHistoryPath, snapshot);
    if (integrationSources.length > 0) {
        const integrationSnapshot = buildIntegrationTimingSnapshot(generatedAt, integrationSources);
        if (integrationSnapshot) {
            await writeFile(integrationTimingsLatestPath, `${JSON.stringify(integrationSnapshot, null, 2)}\n`, "utf8");
            await appendIntegrationTimingHistory(integrationTimingsHistoryPath, integrationSnapshot);
        }
    }
}
function computeWorkflowAnalytics(state) {
    const workflowMap = new Map();
    const stepWorkflowMap = new Map();
    for (const record of state.history) {
        const workflowMeta = extractWorkflowMetadata(record.stepMetadata);
        if (!workflowMeta?.id) {
            continue;
        }
        let workflow = workflowMap.get(workflowMeta.id);
        if (!workflow) {
            workflow = {
                meta: { ...workflowMeta },
                status: "success",
                durationMs: 0,
                steps: new Map(),
            };
            workflowMap.set(workflowMeta.id, workflow);
        }
        else {
            if (!workflow.meta.label && workflowMeta.label) {
                workflow.meta.label = workflowMeta.label;
            }
            if (!workflow.meta.category && workflowMeta.category) {
                workflow.meta.category = workflowMeta.category;
            }
            if (workflow.meta.includeInAll === undefined &&
                workflowMeta.includeInAll !== undefined) {
                workflow.meta.includeInAll = workflowMeta.includeInAll;
            }
        }
        const durationMs = Math.max(0, record.endedAt.getTime() - record.startedAt.getTime());
        workflow.durationMs += durationMs;
        if (!record.success) {
            workflow.status = "failed";
        }
        const stepKey = record.stepId;
        let step = workflow.steps.get(stepKey);
        if (!step) {
            step = {
                label: record.stepLabel ?? stepKey,
                status: "success",
                durationMs: 0,
            };
            workflow.steps.set(stepKey, step);
        }
        step.durationMs += durationMs;
        if (!record.success) {
            step.status = "failed";
        }
        if (record.stdout) {
            const snippet = summarizeCapturedOutput(record.stdout, {
                hardLimit: 400,
            });
            if (snippet) {
                step.capturedOutput = step.capturedOutput
                    ? `${step.capturedOutput}\n${snippet}`
                    : snippet;
            }
        }
        stepWorkflowMap.set(`${record.flowId}::${record.stepId}`, {
            workflowId: workflowMeta.id,
            workflowLabel: workflowMeta.label ?? workflow.meta.label,
        });
    }
    const integrationSources = [];
    for (const capture of state.integrationTimings) {
        const key = `${capture.flowId}::${capture.stepId}`;
        let mapping;
        if (capture.workflowId && workflowMap.has(capture.workflowId)) {
            mapping = {
                workflowId: capture.workflowId,
                workflowLabel: capture.workflowLabel,
            };
        }
        else {
            mapping = stepWorkflowMap.get(key);
        }
        if (!mapping) {
            continue;
        }
        const workflow = workflowMap.get(mapping.workflowId);
        if (!workflow) {
            continue;
        }
        const step = workflow.steps.get(capture.stepId);
        if (!step) {
            continue;
        }
        step.integrationTiming = capture.metadata;
        integrationSources.push({
            workflowId: mapping.workflowId,
            workflowLabel: mapping.workflowLabel ?? workflow.meta.label,
            stepLabel: step.label,
            metadata: capture.metadata,
        });
    }
    const workflows = Array.from(workflowMap.values()).map((workflow) => ({
        id: workflow.meta.id,
        label: workflow.meta.label ?? workflow.meta.id,
        category: workflow.meta.category,
        includeInAll: workflow.meta.includeInAll,
        status: workflow.status,
        durationMs: workflow.durationMs,
        steps: Array.from(workflow.steps.values()).map((step) => ({
            label: step.label,
            status: step.status,
            durationMs: step.durationMs,
            ...(step.integrationTiming
                ? { integrationTiming: step.integrationTiming }
                : {}),
            ...(step.capturedOutput
                ? { capturedOutput: step.capturedOutput }
                : {}),
        })),
    }));
    workflows.sort((a, b) => a.id.localeCompare(b.id));
    return { workflows, integrationSources };
}
async function appendWorkflowAnalyticsHistory(history, filePath, entry) {
    history.push(entry);
    while (history.length > WORKFLOW_HISTORY_LIMIT) {
        history.shift();
    }
    await writeFile(filePath, `${JSON.stringify(history, null, 2)}\n`, "utf8");
}
async function loadWorkflowAnalyticsHistory(filePath) {
    try {
        const raw = await readFile(filePath, "utf8");
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
            return parsed.filter((item) => item &&
                typeof item === "object" &&
                typeof item.generatedAt === "string");
        }
        console.warn(`workflow history at ${filePath} was not an array; resetting history.`);
        return [];
    }
    catch (error) {
        const cause = error;
        if (cause?.code === "ENOENT") {
            return [];
        }
        throw error;
    }
}
async function appendIntegrationTimingHistory(filePath, snapshot) {
    const history = await loadIntegrationTimingHistory(filePath);
    history.push(snapshot);
    while (history.length > INTEGRATION_TIMINGS_HISTORY_LIMIT) {
        history.shift();
    }
    await writeFile(filePath, `${JSON.stringify(history, null, 2)}\n`, "utf8");
}
async function loadIntegrationTimingHistory(filePath) {
    try {
        const raw = await readFile(filePath, "utf8");
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
            return parsed.filter((item) => item &&
                typeof item === "object" &&
                typeof item.generatedAt === "string");
        }
        console.warn(`integration timings history at ${filePath} was not an array; resetting history.`);
        return [];
    }
    catch (error) {
        const cause = error;
        if (cause?.code === "ENOENT") {
            return [];
        }
        throw error;
    }
}
function buildSnapshotPreview(snapshot) {
    return {
        generatedAt: snapshot.generatedAt,
        workflows: snapshot.workflows.map((workflow) => ({
            id: workflow.id,
            status: workflow.status,
            durationMs: workflow.durationMs,
        })),
    };
}
//# sourceMappingURL=workflowAnalyticsWriter.js.map