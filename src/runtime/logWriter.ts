import fs from "node:fs";
import path from "node:path";

export type WizardLogEvent =
	| {
			type: "scenario.start";
			scenarioId: string;
			label: string;
			startedAt: string;
			flows: string[];
			dryRun: boolean;
			quiet: boolean;
			verbose: boolean;
	  }
	| {
			type: "scenario.complete";
			scenarioId: string;
			label: string;
			status: "success" | "failure";
			endedAt?: string;
			durationMs: number;
			completedSteps: number;
			failedSteps: number;
			exitedEarly: boolean;
	  }
	| {
			type: "step.start" | "step.complete";
			flowId: string;
			stepId: string;
			stepType: string;
			index: number;
			next?: string | null;
			durationMs?: number;
	  }
	| {
			type: "prompt.answer";
			flowId: string;
			stepId: string;
			value: unknown;
	  }
	| {
			type: "prompt.persistence";
			flowId: string;
			stepId: string;
			scope: "scenario" | "project";
			key: string;
			projectId?: string;
			status: "hit" | "miss";
			applied?: boolean;
	  }
	| {
			type: "branch.decision";
			flowId: string;
			stepId: string;
			expression: string;
			result: boolean;
			target?: string | null;
	  }
	| {
			type: "command.result";
			flowId: string;
			stepId: string;
			command: string;
			cwd?: string;
			dryRun: boolean;
			success: boolean;
			exitCode?: number;
			durationMs: number;
			errorMessage?: string;
			stdout?: string;
			stderr?: string;
	  }
	| {
			type: "policy.decision";
			ruleId: string;
			ruleLevel: "allow" | "warn" | "block";
			enforcedLevel: "allow" | "warn" | "block";
			acknowledged: boolean;
			flowId: string;
			stepId: string;
			command: string;
			note?: string;
	  }
	| {
			type: "shortcut.trigger";
			action: "skip-step" | "replay-command" | "safe-abort";
			shortcut: string;
			flowId: string;
			stepId: string;
			stepLabel?: string;
	  };

export interface WizardLogWriter {
	write(event: WizardLogEvent): void;
	close(): Promise<void>;
}

export interface WizardLogWriterOptions {
	redactPromptValues?: boolean;
	redactCommandOutput?: boolean;
}

export function createLogWriter(
	filePath: string,
	options?: WizardLogWriterOptions,
): WizardLogWriter {
	const resolvedPath = path.resolve(filePath);
	const directory = path.dirname(resolvedPath);

	fs.mkdirSync(directory, { recursive: true });
	const stream = fs.createWriteStream(resolvedPath, {
		flags: "a",
		encoding: "utf8",
	});

	return createWritableLogWriter(stream, { closeStream: true, options });
}

export function createStreamLogWriter(
	stream: NodeJS.WritableStream,
	options?: WizardLogWriterOptions,
): WizardLogWriter {
	return createWritableLogWriter(stream, { closeStream: false, options });
}

function createWritableLogWriter(
	stream: NodeJS.WritableStream,
	{
		closeStream,
		options,
	}: {
		closeStream: boolean;
		options?: WizardLogWriterOptions;
	},
): WizardLogWriter {
	return {
		write(event) {
			const payload = {
				timestamp: new Date().toISOString(),
				...sanitizeEvent(event, options),
			};
			stream.write(`${JSON.stringify(payload)}\n`);
		},
		close() {
			if (!closeStream) {
				return Promise.resolve();
			}
			return new Promise<void>((resolve, reject) => {
				const handleFinish = () => {
					cleanup();
					resolve();
				};
				const handleError = (error: NodeJS.ErrnoException) => {
					cleanup();
					reject(error);
				};
				const cleanup = () => {
					stream.removeListener("finish", handleFinish);
					stream.removeListener("close", handleFinish);
					stream.removeListener("error", handleError);
				};

				stream.once("finish", handleFinish);
				stream.once("close", handleFinish);
				stream.once("error", handleError);
				stream.end();
			});
		},
	};
}

function sanitizeEvent(
	event: WizardLogEvent,
	options?: WizardLogWriterOptions,
): WizardLogEvent {
	if (!options) {
		return event;
	}

	let sanitized: WizardLogEvent = event;

	if (options.redactPromptValues && event.type === "prompt.answer") {
		sanitized = {
			...event,
			value: "[redacted]",
		};
	}

	if (options.redactCommandOutput && sanitized.type === "command.result") {
		const { stdout, stderr, ...rest } = sanitized;
		void stdout;
		void stderr;
		sanitized = {
			...rest,
			stdout: undefined,
			stderr: undefined,
		};
	}

	return sanitized;
}
