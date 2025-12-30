import type { WizardState } from "./state";

export interface DevWizardOptions {
	configPath?: string | string[];
	scenario?: string;
	phase?: "collect" | "execute";
	dryRun?: boolean;
	plan?: boolean;
	planFormat?: "pretty" | "ndjson" | "json";
	planOutputPath?: string;
	planOnly?: boolean;
	logFile?: string;
	logNdjson?: boolean;
	logOtlpEndpoint?: string;
	logOtlpHeaders?: Record<string, string>;
	logOtlpServiceName?: string;
	logOtlpScopeName?: string;
	logOtlpResourceAttributes?: Record<string, string>;
	policyAcks?: string[];
	listScenarios?: boolean;
	quiet?: boolean;
	verbose?: boolean;
	overrides?: Record<string, unknown>;
	args?: readonly string[];
	stdout?: NodeJS.WritableStream;
	stderr?: NodeJS.WritableStream;
	explainConfig?: boolean;
	resumeFrom?: string;
	checkpointInterval?: number;
	checkpointRetention?: number;
	environment?: string;
	executionSandbox?: boolean;
	executionSandboxSlug?: string;
	planExpand?: PlanExpandSection[];
	loadPersistedAnswers?: boolean;
	answersPathUsed?: string;
	registerManifestPath?: string;
	executeManifestPath?: string;
	manifestForce?: boolean;
	clientVersion?: string;
	answersIdentity?: string;
	answersIdentitySegments?: Record<string, string>;
	answersIdentitySegmentDetails?: Record<string, IdentitySegmentMetadata>;
}

export type PlanExpandSection = "env" | "templates" | "branches";

export interface DevWizardRunResult {
	exitCode: number;
	state?: WizardState;
	persistedAnswers?: PersistedAnswersContext;
}

export interface PersistedAnswersContext {
	filePath: string;
	scenarioId: string;
	identitySlug?: string;
}

export interface IdentitySegmentMetadata {
	label?: string;
	details?: Record<string, unknown>;
}
