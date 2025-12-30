export interface DevWizardMetadata {
	name: string;
	version: string;
	description?: string;
	schemaVersion?: number;
}

export interface DevWizardScenario {
	id: string;
	label: string;
	description?: string;
	flow: string;
	flows?: string[];
	tags?: string[];
	shortcuts?: Record<string, string>;
	postRun?: DevWizardPostRun[];
	identity?: DevWizardScenarioIdentity;
}

export interface DevWizardScenarioIdentity {
	segments: DevWizardScenarioIdentitySegment[];
}

export interface DevWizardScenarioIdentitySegment {
	id: string;
	prompt: string;
	description?: string;
	defaultValue?: string;
	options?: DevWizardScenarioIdentitySegmentOption[];
	allowCustom?: boolean;
	placeholder?: string;
}

export interface DevWizardScenarioIdentitySegmentOption {
	value: string;
	label?: string;
	hint?: string;
}

export interface DevWizardFlow {
	id: string;
	label?: string;
	description?: string;
	steps: DevWizardStep[];
}

export type DevWizardStep =
	| PromptStep
	| CommandStep
	| MessageStep
	| BranchStep
	| GroupStep
	| IterateStep
	| ComputeStep
	| GitWorktreeGuardStep
	| PluginStep;

export const BUILTIN_STEP_TYPES = [
	"prompt",
	"command",
	"message",
	"branch",
	"group",
	"iterate",
	"compute",
	"git-worktree-guard",
] as const;

export interface BaseStep {
	id: string;
	label?: string;
	description?: string;
	metadata?: Record<string, unknown>;
}

export interface PromptStep extends BaseStep {
	type: "prompt";
	mode: "input" | "confirm" | "select" | "multiselect";
	prompt: string;
	options?: PromptOption[];
	dynamic?: PromptDynamicOptions;
	defaultValue?: string | boolean | string[];
	storeAs?: string;
	required?: boolean;
	validation?: PromptValidation;
	persist?: boolean | PromptPersistConfig;
	showSelectionOrder?: boolean;
}

export type PromptPersistenceScope = "scenario" | "project";

export interface PromptPersistConfig {
	scope?: PromptPersistenceScope;
	key?: string;
}

export interface PromptOption {
	label: string;
	value: string;
	hint?: string;
	disabled?: boolean;
}

export type PromptDynamicOptions =
	| PromptCommandOptions
	| PromptGlobOptions
	| PromptJsonOptions
	| PromptWorkspaceProjectsOptions
	| PromptProjectTsconfigsOptions;

export interface PromptDynamicBase {
	cache?: "session" | "always" | { ttlMs: number };
	map?: PromptDynamicMap;
}

export interface PromptDynamicMap {
	value?: string;
	label?: string;
	hint?: string;
	disableWhen?: string;
}

export interface PromptWorkspaceProjectsOptions extends PromptDynamicBase {
	type: "workspace-projects";
	includeRoot?: boolean;
	maxDepth?: number;
	ignore?: string[];
	limit?: number;
}

export interface PromptCommandOptions extends PromptDynamicBase {
	type: "command";
	command: string;
	cwd?: string;
	shell?: boolean;
}

export interface PromptProjectTsconfigsOptions extends PromptDynamicBase {
	type: "project-tsconfigs";
	project: string;
	includeCustom?: boolean;
}

export interface PromptGlobOptions extends PromptDynamicBase {
	type: "glob";
	patterns: string | string[];
	cwd?: string;
	ignore?: string | string[];
}

export interface PromptJsonOptions extends PromptDynamicBase {
	type: "json";
	path: string;
	pointer?: string;
}

export interface CommandStep extends BaseStep {
	type: "command";
	commands: CommandDescriptor[];
	defaults?: CommandDefaults;
	continueOnError?: boolean;
	collectSafe?: boolean;
	onSuccess?: StepTransition;
	onError?: CommandErrorHandling;
	summary?: string;
}

export interface CommandDescriptor {
	name?: string;
	run: string;
	cwd?: string;
	env?: Record<string, string>;
	shell?: boolean;
	continueOnFail?: boolean;
	timeoutMs?: number;
	captureStdout?: boolean;
	quiet?: boolean;
	preset?: string;
	warnAfterMs?: number;
	storeStdoutAs?: string;
	parseJson?: boolean | CommandParseJsonOptions;
	storeWhen?: "success" | "failure" | "always";
	redactKeys?: string[];
	dryRunStrategy?: "skip" | "execute";
}

export interface CommandDefaults {
	cwd?: string;
	env?: Record<string, string>;
	shell?: boolean;
	timeoutMs?: number;
	captureStdout?: boolean;
	quiet?: boolean;
	preset?: string;
	warnAfterMs?: number;
	storeStdoutAs?: string;
	parseJson?: boolean | CommandParseJsonOptions;
	storeWhen?: "success" | "failure" | "always";
	redactKeys?: string[];
	dryRunStrategy?: "skip" | "execute";
}

export interface CommandPreset extends CommandDefaults {
	description?: string;
	tags?: string[];
}

export interface DevWizardCommandPresets {
	[key: string]: CommandPreset;
}

export interface CommandErrorHandling {
	recommendation?: string;
	actions?: TransitionAction[];
	defaultNext?: StepTransition;
	policy?: CommandErrorPolicy;
	auto?: CommandErrorAutoHandling;
	links?: CommandRecommendationLink[];
	commands?: CommandRecommendationCommand[];
}

export interface CommandErrorPolicy {
	key: string;
	map: Record<string, StepTransitionTarget>;
	default?: StepTransitionTarget;
	required?: boolean;
}

export interface TransitionAction {
	label: string;
	next: StepTransitionTarget;
	description?: string;
}

export interface CommandErrorAutoHandling {
	strategy: "retry" | "default" | "transition" | "exit";
	target?: StepTransitionTarget;
	limit?: number;
}

export interface CommandRecommendationLink {
	label?: string;
	url: string;
}

export interface CommandRecommendationCommand {
	label?: string;
	command: string;
}

export interface GitWorktreeGuardStep extends BaseStep {
	type: "git-worktree-guard";
	prompt?: string;
	cleanMessage?: string;
	dirtyMessage?: string;
	allowCommit?: boolean;
	allowStash?: boolean;
	allowBranch?: boolean;
	allowProceed?: boolean;
	commitMessagePrompt?: string;
	commitMessageDefault?: string;
	stashMessagePrompt?: string;
	stashMessageDefault?: string;
	branchNamePrompt?: string;
	branchNameDefault?: string;
	proceedConfirmationPrompt?: string;
	storeStrategyAs?: string;
	storeCommitMessageAs?: string;
	storeStashMessageAs?: string;
	storeBranchNameAs?: string;
	cwd?: string;
}

export type PolicyLevel = "allow" | "warn" | "block";

export interface PolicyRuleMatch {
	command?: string | string[];
	commandPattern?: string | string[];
	preset?: string | string[];
	flow?: string | string[];
	step?: string | string[];
}

export interface PolicyRule {
	id: string;
	level: PolicyLevel;
	match: PolicyRuleMatch;
	note?: string;
}

export interface PolicyConfig {
	defaultLevel?: PolicyLevel;
	rules: PolicyRule[];
}

export interface CommandParseJsonOptions {
	onError?: "fail" | "warn";
	reviver?: string;
}

export interface MessageStep extends BaseStep {
	type: "message";
	level?: "info" | "success" | "warning" | "error";
	text: string;
	next?: StepTransition;
}

export interface BranchStep extends BaseStep {
	type: "branch";
	branches: BranchCondition[];
	defaultNext?: StepTransition;
}

export interface BranchCondition {
	when: string;
	next: StepTransitionTarget;
	description?: string;
}

export interface GroupStep extends BaseStep {
	type: "group";
	flow: string;
}

export interface IterateStep extends BaseStep {
	type: "iterate";
	items?: unknown[];
	source?: IterateSource;
	storeEachAs?: string;
	flow: string;
	concurrency?: number;
	over?: string;
}

export interface ComputeStep extends BaseStep {
	type: "compute";
	values?: Record<string, unknown>;
	handler?: string;
	params?: Record<string, unknown>;
	storeAs?: string;
	next?: StepTransition;
}

export type IterateSource =
	| {
			from: "answers";
			key: string;
	  }
	| {
			from: "dynamic";
			dynamic: PromptDynamicOptions;
	  }
	| {
			from: "json";
			path: string;
			pointer?: string;
	  };

export interface StepTransition {
	next: StepTransitionTarget;
}

export type StepTransitionTarget = "exit" | "repeat" | string;

export interface DevWizardConfig {
	meta: DevWizardMetadata;
	imports?: string[];
	scenarios: DevWizardScenario[];
	flows: Record<string, DevWizardFlow>;
	commandPresets?: DevWizardCommandPresets;
	policies?: PolicyConfig;
	plugins?: DevWizardPluginReference[];
}

export interface DevWizardPostRun {
	flow: string;
	when?: "always" | "on-success" | "on-failure";
}

export interface PromptValidation {
	regex?: string;
	message?: string;
	minLength?: number;
	maxLength?: number;
}

export interface PluginStep extends BaseStep {
	type: string;
	[key: string]: unknown;
}

export interface DevWizardPluginReference {
	module: string;
	name?: string;
	options?: unknown;
	resolvedPath?: string;
	source?: string;
}
