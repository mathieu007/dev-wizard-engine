import { z } from "zod";
export const wizardScenarioStartEventSchema = z.object({
    type: z.literal("scenario.start"),
    scenarioId: z.string(),
    label: z.string(),
    startedAt: z.string(),
    flows: z.array(z.string()),
    dryRun: z.boolean(),
    quiet: z.boolean(),
    verbose: z.boolean(),
});
export const wizardScenarioCompleteEventSchema = z.object({
    type: z.literal("scenario.complete"),
    scenarioId: z.string(),
    label: z.string(),
    status: z.union([z.literal("success"), z.literal("failure")]),
    endedAt: z.string().optional(),
    durationMs: z.number(),
    completedSteps: z.number(),
    failedSteps: z.number(),
    exitedEarly: z.boolean(),
});
export const wizardStepStartEventSchema = z.object({
    type: z.literal("step.start"),
    flowId: z.string(),
    stepId: z.string(),
    stepType: z.string(),
    index: z.number(),
});
export const wizardStepCompleteEventSchema = z.object({
    type: z.literal("step.complete"),
    flowId: z.string(),
    stepId: z.string(),
    stepType: z.string(),
    index: z.number(),
    next: z.union([z.string(), z.null()]).optional(),
    durationMs: z.number().optional(),
});
export const wizardPromptAnswerEventSchema = z.object({
    type: z.literal("prompt.answer"),
    flowId: z.string(),
    stepId: z.string(),
    value: z.unknown(),
});
export const wizardPromptPersistenceEventSchema = z.object({
    type: z.literal("prompt.persistence"),
    flowId: z.string(),
    stepId: z.string(),
    scope: z.enum(["scenario", "project"]),
    key: z.string(),
    projectId: z.string().optional(),
    status: z.enum(["hit", "miss"]),
    applied: z.boolean().optional(),
});
export const wizardBranchDecisionEventSchema = z.object({
    type: z.literal("branch.decision"),
    flowId: z.string(),
    stepId: z.string(),
    expression: z.string(),
    result: z.boolean(),
    target: z.union([z.string(), z.null()]).optional(),
});
export const wizardCommandResultEventSchema = z.object({
    type: z.literal("command.result"),
    flowId: z.string(),
    stepId: z.string(),
    command: z.string(),
    cwd: z.string().optional(),
    dryRun: z.boolean(),
    success: z.boolean(),
    exitCode: z.number().optional(),
    durationMs: z.number(),
    errorMessage: z.string().optional(),
    stdout: z.string().optional(),
    stderr: z.string().optional(),
});
export const wizardPolicyDecisionEventSchema = z.object({
    type: z.literal("policy.decision"),
    ruleId: z.string(),
    ruleLevel: z.enum(["allow", "warn", "block"]),
    enforcedLevel: z.enum(["allow", "warn", "block"]),
    acknowledged: z.boolean(),
    flowId: z.string(),
    stepId: z.string(),
    command: z.string(),
    note: z.string().optional(),
});
export const wizardLogEventSchema = z.union([
    wizardScenarioStartEventSchema,
    wizardScenarioCompleteEventSchema,
    wizardStepStartEventSchema,
    wizardStepCompleteEventSchema,
    wizardPromptAnswerEventSchema,
    wizardPromptPersistenceEventSchema,
    wizardBranchDecisionEventSchema,
    wizardCommandResultEventSchema,
    wizardPolicyDecisionEventSchema,
]);
//# sourceMappingURL=eventSchema.js.map