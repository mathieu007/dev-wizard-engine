export type IntegrationTimingStatus = "passed" | "failed" | "dry-run";

export interface IntegrationTimingEvent {
	task: string;
	profile: string;
	label?: string;
	durationMs: number;
	status: IntegrationTimingStatus;
}

export interface IntegrationTimingRun {
	profile: string;
	status: IntegrationTimingStatus;
	durationMs: number;
	label?: string;
}

export interface IntegrationTimingTaskSummary {
	task: string;
	label?: string;
	totalDurationMs: number;
	runs: readonly IntegrationTimingRun[];
}

export interface IntegrationTimingSummary {
	totalDurationMs: number;
	tasks: readonly IntegrationTimingTaskSummary[];
}

export interface IntegrationTimingMetadata {
	events: readonly IntegrationTimingEvent[];
	summary: IntegrationTimingSummary;
}

export interface IntegrationTimingSource {
	workflowId: string;
	workflowLabel?: string;
	stepLabel?: string;
	metadata: IntegrationTimingMetadata;
}

export interface IntegrationTimingStepSnapshot {
	label?: string;
	totalDurationMs: number;
	tasks: readonly IntegrationTimingTaskSummary[];
}

export interface IntegrationTimingWorkflowSnapshot {
	id: string;
	label?: string;
	totalDurationMs: number;
	steps: readonly IntegrationTimingStepSnapshot[];
}

export interface IntegrationTimingSnapshot {
	generatedAt: string;
	totalDurationMs: number;
	workflows: readonly IntegrationTimingWorkflowSnapshot[];
	events: readonly IntegrationTimingEvent[];
}

const TIMING_PREFIX = "[integration][timing]";

export function extractIntegrationTimingMetadata(
	output: string | undefined,
): IntegrationTimingMetadata | undefined {
	if (!output) {
		return undefined;
	}

	const lines = output.split(/\r?\n/);
	const events: IntegrationTimingEvent[] = [];

	for (const line of lines) {
		const event = parseIntegrationTimingLine(line);
		if (event) {
			events.push(event);
		}
	}

	if (events.length === 0) {
		return undefined;
	}

	return {
		events,
		summary: summariseIntegrationTimingEvents(events),
	};
}

function parseIntegrationTimingLine(
	line: string,
): IntegrationTimingEvent | undefined {
	if (!line.startsWith(TIMING_PREFIX)) {
		return undefined;
	}

	const payload = line.slice(TIMING_PREFIX.length).trim();
	try {
		const parsed = JSON.parse(payload) as Partial<IntegrationTimingEvent>;
		if (
			typeof parsed.task === "string" &&
			typeof parsed.profile === "string" &&
			typeof parsed.durationMs === "number" &&
			typeof parsed.status === "string"
		) {
			return {
				task: parsed.task,
				profile: parsed.profile,
				durationMs: parsed.durationMs,
				status: normaliseStatus(parsed.status),
				label: parsed.label,
			};
		}
	} catch {
		// Ignore invalid JSON payloads.
	}

	return undefined;
}

function summariseIntegrationTimingEvents(
	events: readonly IntegrationTimingEvent[],
): IntegrationTimingSummary {
	const taskMap = new Map<string, IntegrationTimingTaskSummaryMutable>();
	let totalDurationMs = 0;

	for (const event of events) {
		totalDurationMs += event.durationMs;
		let taskEntry = taskMap.get(event.task);
		if (!taskEntry) {
			taskEntry = {
				task: event.task,
				label: event.label,
				totalDurationMs: 0,
				runs: [],
			};
			taskMap.set(event.task, taskEntry);
		}

		taskEntry.totalDurationMs += event.durationMs;
		taskEntry.runs.push({
			profile: event.profile,
			label: event.label,
			status: event.status,
			durationMs: event.durationMs,
		});
	}

	const tasks = Array.from(taskMap.values()).map((entry) => ({
		task: entry.task,
		label: entry.label,
		totalDurationMs: entry.totalDurationMs,
		runs: entry.runs.slice(),
	}));

	tasks.sort((a, b) => a.task.localeCompare(b.task));

	return {
		totalDurationMs,
		tasks,
	};
}

function normaliseStatus(status: string): IntegrationTimingStatus {
	switch (status) {
		case "passed":
		case "failed":
		case "dry-run":
			return status;
		default:
			return "passed";
	}
}

interface IntegrationTimingTaskSummaryMutable {
	task: string;
	label?: string;
	totalDurationMs: number;
	runs: Array<IntegrationTimingRun>;
}

export function buildIntegrationTimingSnapshot(
	generatedAt: string,
	sources: readonly IntegrationTimingSource[],
): IntegrationTimingSnapshot | undefined {
	if (!generatedAt || sources.length === 0) {
		return undefined;
	}

	const workflowMap = new Map<
		string,
		{
			label?: string;
			totalDurationMs: number;
			steps: Array<{
				label?: string;
				totalDurationMs: number;
				tasks: readonly IntegrationTimingTaskSummary[];
			}>;
		}
	>();
	const events: IntegrationTimingEvent[] = [];
	let totalDurationMs = 0;

	for (const source of sources) {
		const summary = source.metadata.summary;
		events.push(...source.metadata.events);
		totalDurationMs += summary.totalDurationMs;

		let workflowEntry = workflowMap.get(source.workflowId);
		if (!workflowEntry) {
			workflowEntry = {
				label: source.workflowLabel,
				totalDurationMs: 0,
				steps: [],
			};
			workflowMap.set(source.workflowId, workflowEntry);
		}
		if (!workflowEntry.label && source.workflowLabel) {
			workflowEntry.label = source.workflowLabel;
		}
		workflowEntry.totalDurationMs += summary.totalDurationMs;
		workflowEntry.steps.push({
			label: source.stepLabel,
			totalDurationMs: summary.totalDurationMs,
			tasks: summary.tasks.map((task) => ({
				task: task.task,
				label: task.label,
				totalDurationMs: task.totalDurationMs,
				runs: task.runs.map((run) => ({ ...run })),
			})),
		});
	}

	const workflows: IntegrationTimingWorkflowSnapshot[] = Array.from(workflowMap.entries()).map(
		([id, value]) => ({
			id,
			label: value.label,
			totalDurationMs: value.totalDurationMs,
			steps: value.steps.map((step) => ({
				label: step.label,
				totalDurationMs: step.totalDurationMs,
				tasks: step.tasks.map((task) => ({
					task: task.task,
					label: task.label,
					totalDurationMs: task.totalDurationMs,
					runs: task.runs.map((run) => ({ ...run })),
				})),
			})),
		}),
	);
	workflows.sort((a, b) => a.id.localeCompare(b.id));

	return {
		generatedAt,
		totalDurationMs,
		workflows,
		events,
	};
}
