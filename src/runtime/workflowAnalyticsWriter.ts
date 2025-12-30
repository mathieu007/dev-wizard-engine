import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
	IntegrationTimingMetadata,
	IntegrationTimingSnapshot,
	IntegrationTimingSource,
} from "./integrationTimings";
import { buildIntegrationTimingSnapshot } from "./integrationTimings.js";
import type { WizardState } from "./state";
import { extractWorkflowMetadata, type WorkflowMetadata } from "./workflowMetadata.js";
import { loadReleaseEmailStatus } from "./releaseEmailStatus.js";
import { summarizeCapturedOutput } from "./capturedOutput.js";

export interface WorkflowAnalyticsStepEntry {
	label?: string;
	status: "success" | "failed";
	durationMs: number;
	integrationTiming?: IntegrationTimingMetadata;
	capturedOutput?: string;
}

export interface WorkflowAnalyticsEntry {
	id: string;
	label?: string;
	category?: string;
	includeInAll?: boolean;
	status: "success" | "failed";
	durationMs: number;
	steps: readonly WorkflowAnalyticsStepEntry[];
}

interface WorkflowAnalyticsSnapshot {
	generatedAt: string;
	workflows: readonly WorkflowAnalyticsEntry[];
	releaseEmail?: unknown;
	previous?: WorkflowAnalyticsSnapshotPreview;
}

const WORKFLOW_HISTORY_LIMIT = 50;
const INTEGRATION_TIMINGS_HISTORY_LIMIT = 50;

interface WorkflowAnalyticsSnapshotPreview {
	generatedAt: string;
	workflows: ReadonlyArray<{
		id: string;
		status: "success" | "failed";
		durationMs: number;
	}>;
}

export interface WorkflowAnalyticsWriteOptions {
	state: WizardState;
	repoRoot?: string;
}

export async function writeWorkflowAnalyticsReports(
	options: WorkflowAnalyticsWriteOptions,
): Promise<void> {
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
	const integrationTimingsLatestPath = path.join(
		reportsDir,
		"integration-timings-latest.json",
	);
	const integrationTimingsHistoryPath = path.join(
		reportsDir,
		"integration-timings-history.json",
	);
	const releaseEmailStatusPath = path.join(reportsDir, "release-email-status.json");

	await mkdir(reportsDir, { recursive: true });

	const generatedAt = new Date().toISOString();
	let releaseEmail: unknown;
	try {
		releaseEmail = await loadReleaseEmailStatus(releaseEmailStatusPath);
	} catch (error) {
		console.warn(
			`Failed to load release email status: ${error instanceof Error ? error.message : String(error)}`,
		);
	}

	const history = await loadWorkflowAnalyticsHistory(workflowsHistoryPath);
	const previousEntry = history.at(-1);
	const previous = previousEntry ? buildSnapshotPreview(previousEntry) : undefined;

	const snapshot: WorkflowAnalyticsSnapshot = {
		generatedAt,
		workflows,
		...(releaseEmail ? { releaseEmail } : {}),
		...(previous ? { previous } : {}),
	};

	await writeFile(
		workflowsLatestPath,
		`${JSON.stringify(snapshot, null, 2)}\n`,
		"utf8",
	);
	await appendWorkflowAnalyticsHistory(history, workflowsHistoryPath, snapshot);

	if (integrationSources.length > 0) {
		const integrationSnapshot = buildIntegrationTimingSnapshot(
			generatedAt,
			integrationSources,
		);
		if (integrationSnapshot) {
			await writeFile(
				integrationTimingsLatestPath,
				`${JSON.stringify(integrationSnapshot, null, 2)}\n`,
				"utf8",
			);
			await appendIntegrationTimingHistory(
				integrationTimingsHistoryPath,
				integrationSnapshot,
			);
		}
	}
}

interface WorkflowAnalyticsMutable {
	meta: WorkflowMetadataMutable;
	status: "success" | "failed";
	durationMs: number;
	steps: Map<string, WorkflowStepMutable>;
}

interface WorkflowMetadataMutable extends WorkflowMetadata {
	category?: string;
	includeInAll?: boolean;
}

interface WorkflowStepMutable {
	label?: string;
	status: "success" | "failed";
	durationMs: number;
	integrationTiming?: IntegrationTimingMetadata;
	capturedOutput?: string;
}

function computeWorkflowAnalytics(state: WizardState): {
	workflows: WorkflowAnalyticsEntry[];
	integrationSources: IntegrationTimingSource[];
} {
	const workflowMap = new Map<string, WorkflowAnalyticsMutable>();
	const stepWorkflowMap = new Map<
		string,
		{ workflowId: string; workflowLabel?: string }
	>();

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
		} else {
			if (!workflow.meta.label && workflowMeta.label) {
				workflow.meta.label = workflowMeta.label;
			}
			if (!workflow.meta.category && workflowMeta.category) {
				workflow.meta.category = workflowMeta.category;
			}
			if (
				workflow.meta.includeInAll === undefined &&
				workflowMeta.includeInAll !== undefined
			) {
				workflow.meta.includeInAll = workflowMeta.includeInAll;
			}
		}

		const durationMs = Math.max(
			0,
			record.endedAt.getTime() - record.startedAt.getTime(),
		);
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

	const integrationSources: IntegrationTimingSource[] = [];

	for (const capture of state.integrationTimings) {
		const key = `${capture.flowId}::${capture.stepId}`;
		let mapping:
			| {
					workflowId: string;
					workflowLabel?: string;
			  }
			| undefined;

		if (capture.workflowId && workflowMap.has(capture.workflowId)) {
			mapping = {
				workflowId: capture.workflowId,
				workflowLabel: capture.workflowLabel,
			};
		} else {
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

	const workflows: WorkflowAnalyticsEntry[] = Array.from(
		workflowMap.values(),
	).map((workflow) => ({
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

async function appendWorkflowAnalyticsHistory(
	history: WorkflowAnalyticsSnapshot[],
	filePath: string,
	entry: WorkflowAnalyticsSnapshot,
): Promise<void> {
	history.push(entry);
	while (history.length > WORKFLOW_HISTORY_LIMIT) {
		history.shift();
	}
	await writeFile(filePath, `${JSON.stringify(history, null, 2)}\n`, "utf8");
}

async function loadWorkflowAnalyticsHistory(
	filePath: string,
): Promise<WorkflowAnalyticsSnapshot[]> {
	try {
		const raw = await readFile(filePath, "utf8");
		const parsed = JSON.parse(raw);
		if (Array.isArray(parsed)) {
			return parsed.filter(
				(item): item is WorkflowAnalyticsSnapshot =>
					item &&
					typeof item === "object" &&
					typeof (item as { generatedAt?: unknown }).generatedAt === "string",
			);
		}
		console.warn(
			`workflow history at ${filePath} was not an array; resetting history.`,
		);
		return [];
	} catch (error) {
		const cause = error as NodeJS.ErrnoException;
		if (cause?.code === "ENOENT") {
			return [];
		}
		throw error;
	}
}

async function appendIntegrationTimingHistory(
	filePath: string,
	snapshot: IntegrationTimingSnapshot,
): Promise<void> {
	const history = await loadIntegrationTimingHistory(filePath);
	history.push(snapshot);
	while (history.length > INTEGRATION_TIMINGS_HISTORY_LIMIT) {
		history.shift();
	}
	await writeFile(filePath, `${JSON.stringify(history, null, 2)}\n`, "utf8");
}

async function loadIntegrationTimingHistory(
	filePath: string,
): Promise<IntegrationTimingSnapshot[]> {
	try {
		const raw = await readFile(filePath, "utf8");
		const parsed = JSON.parse(raw);
		if (Array.isArray(parsed)) {
			return parsed.filter(
				(item): item is IntegrationTimingSnapshot =>
					item &&
					typeof item === "object" &&
					typeof (item as { generatedAt?: unknown }).generatedAt === "string",
			);
		}
		console.warn(
			`integration timings history at ${filePath} was not an array; resetting history.`,
		);
		return [];
	} catch (error) {
		const cause = error as NodeJS.ErrnoException;
		if (cause?.code === "ENOENT") {
			return [];
		}
		throw error;
	}
}

function buildSnapshotPreview(
	snapshot: WorkflowAnalyticsSnapshot,
): WorkflowAnalyticsSnapshotPreview {
	return {
		generatedAt: snapshot.generatedAt,
		workflows: snapshot.workflows.map((workflow) => ({
			id: workflow.id,
			status: workflow.status,
			durationMs: workflow.durationMs,
		})),
	};
}
