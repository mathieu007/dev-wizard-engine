import { z } from "zod";
export declare const wizardScenarioStartEventSchema: z.ZodObject<{
    type: z.ZodLiteral<"scenario.start">;
    scenarioId: z.ZodString;
    label: z.ZodString;
    startedAt: z.ZodString;
    flows: z.ZodArray<z.ZodString>;
    dryRun: z.ZodBoolean;
    quiet: z.ZodBoolean;
    verbose: z.ZodBoolean;
}, z.core.$strip>;
export declare const wizardScenarioCompleteEventSchema: z.ZodObject<{
    type: z.ZodLiteral<"scenario.complete">;
    scenarioId: z.ZodString;
    label: z.ZodString;
    status: z.ZodUnion<readonly [z.ZodLiteral<"success">, z.ZodLiteral<"failure">]>;
    endedAt: z.ZodOptional<z.ZodString>;
    durationMs: z.ZodNumber;
    completedSteps: z.ZodNumber;
    failedSteps: z.ZodNumber;
    exitedEarly: z.ZodBoolean;
}, z.core.$strip>;
export declare const wizardStepStartEventSchema: z.ZodObject<{
    type: z.ZodLiteral<"step.start">;
    flowId: z.ZodString;
    stepId: z.ZodString;
    stepType: z.ZodString;
    index: z.ZodNumber;
}, z.core.$strip>;
export declare const wizardStepCompleteEventSchema: z.ZodObject<{
    type: z.ZodLiteral<"step.complete">;
    flowId: z.ZodString;
    stepId: z.ZodString;
    stepType: z.ZodString;
    index: z.ZodNumber;
    next: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodNull]>>;
    durationMs: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export declare const wizardPromptAnswerEventSchema: z.ZodObject<{
    type: z.ZodLiteral<"prompt.answer">;
    flowId: z.ZodString;
    stepId: z.ZodString;
    value: z.ZodUnknown;
}, z.core.$strip>;
export declare const wizardPromptPersistenceEventSchema: z.ZodObject<{
    type: z.ZodLiteral<"prompt.persistence">;
    flowId: z.ZodString;
    stepId: z.ZodString;
    scope: z.ZodEnum<{
        scenario: "scenario";
        project: "project";
    }>;
    key: z.ZodString;
    projectId: z.ZodOptional<z.ZodString>;
    status: z.ZodEnum<{
        hit: "hit";
        miss: "miss";
    }>;
    applied: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
export declare const wizardBranchDecisionEventSchema: z.ZodObject<{
    type: z.ZodLiteral<"branch.decision">;
    flowId: z.ZodString;
    stepId: z.ZodString;
    expression: z.ZodString;
    result: z.ZodBoolean;
    target: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodNull]>>;
}, z.core.$strip>;
export declare const wizardCommandResultEventSchema: z.ZodObject<{
    type: z.ZodLiteral<"command.result">;
    flowId: z.ZodString;
    stepId: z.ZodString;
    command: z.ZodString;
    cwd: z.ZodOptional<z.ZodString>;
    dryRun: z.ZodBoolean;
    success: z.ZodBoolean;
    exitCode: z.ZodOptional<z.ZodNumber>;
    durationMs: z.ZodNumber;
    errorMessage: z.ZodOptional<z.ZodString>;
    stdout: z.ZodOptional<z.ZodString>;
    stderr: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const wizardPolicyDecisionEventSchema: z.ZodObject<{
    type: z.ZodLiteral<"policy.decision">;
    ruleId: z.ZodString;
    ruleLevel: z.ZodEnum<{
        allow: "allow";
        warn: "warn";
        block: "block";
    }>;
    enforcedLevel: z.ZodEnum<{
        allow: "allow";
        warn: "warn";
        block: "block";
    }>;
    acknowledged: z.ZodBoolean;
    flowId: z.ZodString;
    stepId: z.ZodString;
    command: z.ZodString;
    note: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const wizardLogEventSchema: z.ZodUnion<readonly [z.ZodObject<{
    type: z.ZodLiteral<"scenario.start">;
    scenarioId: z.ZodString;
    label: z.ZodString;
    startedAt: z.ZodString;
    flows: z.ZodArray<z.ZodString>;
    dryRun: z.ZodBoolean;
    quiet: z.ZodBoolean;
    verbose: z.ZodBoolean;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"scenario.complete">;
    scenarioId: z.ZodString;
    label: z.ZodString;
    status: z.ZodUnion<readonly [z.ZodLiteral<"success">, z.ZodLiteral<"failure">]>;
    endedAt: z.ZodOptional<z.ZodString>;
    durationMs: z.ZodNumber;
    completedSteps: z.ZodNumber;
    failedSteps: z.ZodNumber;
    exitedEarly: z.ZodBoolean;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"step.start">;
    flowId: z.ZodString;
    stepId: z.ZodString;
    stepType: z.ZodString;
    index: z.ZodNumber;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"step.complete">;
    flowId: z.ZodString;
    stepId: z.ZodString;
    stepType: z.ZodString;
    index: z.ZodNumber;
    next: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodNull]>>;
    durationMs: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"prompt.answer">;
    flowId: z.ZodString;
    stepId: z.ZodString;
    value: z.ZodUnknown;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"prompt.persistence">;
    flowId: z.ZodString;
    stepId: z.ZodString;
    scope: z.ZodEnum<{
        scenario: "scenario";
        project: "project";
    }>;
    key: z.ZodString;
    projectId: z.ZodOptional<z.ZodString>;
    status: z.ZodEnum<{
        hit: "hit";
        miss: "miss";
    }>;
    applied: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"branch.decision">;
    flowId: z.ZodString;
    stepId: z.ZodString;
    expression: z.ZodString;
    result: z.ZodBoolean;
    target: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodNull]>>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"command.result">;
    flowId: z.ZodString;
    stepId: z.ZodString;
    command: z.ZodString;
    cwd: z.ZodOptional<z.ZodString>;
    dryRun: z.ZodBoolean;
    success: z.ZodBoolean;
    exitCode: z.ZodOptional<z.ZodNumber>;
    durationMs: z.ZodNumber;
    errorMessage: z.ZodOptional<z.ZodString>;
    stdout: z.ZodOptional<z.ZodString>;
    stderr: z.ZodOptional<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"policy.decision">;
    ruleId: z.ZodString;
    ruleLevel: z.ZodEnum<{
        allow: "allow";
        warn: "warn";
        block: "block";
    }>;
    enforcedLevel: z.ZodEnum<{
        allow: "allow";
        warn: "warn";
        block: "block";
    }>;
    acknowledged: z.ZodBoolean;
    flowId: z.ZodString;
    stepId: z.ZodString;
    command: z.ZodString;
    note: z.ZodOptional<z.ZodString>;
}, z.core.$strip>]>;
export type WizardLogEventPayload = z.infer<typeof wizardLogEventSchema>;
