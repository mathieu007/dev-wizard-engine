import JSON5 from "json5";
import yaml from "yaml";
import { z } from "zod";
import { BUILTIN_STEP_TYPES } from "./types.js";
const metadataSchema = z.object({
    name: z.string().min(1, "meta.name is required"),
    version: z.string().min(1, "meta.version is required"),
    description: z.string().optional(),
    schemaVersion: z.number().int().positive().optional(),
});
const promptOptionSchema = z.object({
    label: z.string().min(1),
    value: z.string().min(1),
    hint: z.string().optional(),
    disabled: z.boolean().optional(),
});
const promptDynamicCacheSchema = z
    .union([
    z.literal("session"),
    z.literal("always"),
    z.object({
        ttlMs: z.number().int().positive(),
    }),
])
    .optional();
const promptDynamicMapSchema = z
    .object({
    value: z.string().optional(),
    label: z.string().optional(),
    hint: z.string().optional(),
    disableWhen: z.string().optional(),
})
    .optional();
const promptDynamicCommandSchema = z.object({
    type: z.literal("command"),
    command: z.string().min(1, "dynamic.command is required"),
    cwd: z.string().optional(),
    shell: z.boolean().optional(),
    cache: promptDynamicCacheSchema,
    map: promptDynamicMapSchema,
});
const promptDynamicGlobSchema = z.object({
    type: z.literal("glob"),
    patterns: z
        .union([z.string().min(1), z.array(z.string().min(1)).min(1)])
        .refine((value) => (Array.isArray(value) ? value.length > 0 : true), "dynamic.patterns must include at least one pattern"),
    cwd: z.string().optional(),
    ignore: z.union([z.string().min(1), z.array(z.string().min(1))]).optional(),
    cache: promptDynamicCacheSchema,
    map: promptDynamicMapSchema,
});
const promptDynamicJsonSchema = z.object({
    type: z.literal("json"),
    path: z.string().min(1, "dynamic.path is required"),
    pointer: z.string().optional(),
    cache: promptDynamicCacheSchema,
    map: promptDynamicMapSchema,
});
const promptDynamicWorkspaceProjectsSchema = z.object({
    type: z.literal("workspace-projects"),
    includeRoot: z.boolean().optional(),
    maxDepth: z.number().int().nonnegative().optional(),
    ignore: z.array(z.string().min(1)).optional(),
    limit: z.number().int().positive().optional(),
    cache: promptDynamicCacheSchema,
    map: promptDynamicMapSchema,
});
const promptDynamicProjectTsconfigsSchema = z.object({
    type: z.literal("project-tsconfigs"),
    project: z.string().min(1, "dynamic.project is required"),
    includeCustom: z.boolean().optional(),
    cache: promptDynamicCacheSchema,
    map: promptDynamicMapSchema,
});
const promptDynamicSchema = z.discriminatedUnion("type", [
    promptDynamicCommandSchema,
    promptDynamicGlobSchema,
    promptDynamicJsonSchema,
    promptDynamicWorkspaceProjectsSchema,
    promptDynamicProjectTsconfigsSchema,
]);
const transitionTargetSchema = z.union([
    z.literal("exit"),
    z.literal("repeat"),
    z.string().min(1),
]);
const transitionSchema = z.object({
    next: transitionTargetSchema,
});
const commandPresetSchema = z.object({
    cwd: z.string().optional(),
    env: z.record(z.string(), z.string()).optional(),
    shell: z.boolean().optional(),
    timeoutMs: z.number().int().positive().optional(),
    captureStdout: z.boolean().optional(),
    quiet: z.boolean().optional(),
    warnAfterMs: z.number().int().nonnegative().optional(),
    storeStdoutAs: z.string().min(1).optional(),
    parseJson: z.union([
        z.boolean(),
        z.object({
            onError: z.enum(["fail", "warn"]).optional(),
            reviver: z.string().optional(),
        }),
    ]).optional(),
    storeWhen: z.enum(["success", "failure", "always"]).optional(),
    redactKeys: z.array(z.string().min(1)).optional(),
    dryRunStrategy: z.enum(["skip", "execute"]).optional(),
    description: z.string().optional(),
    tags: z.array(z.string().min(1)).optional(),
});
const commandDescriptorSchema = z.object({
    name: z.string().optional(),
    run: z.string().min(1, "command.run is required"),
    cwd: z.string().optional(),
    env: z.record(z.string(), z.string()).optional(),
    shell: z.boolean().optional(),
    continueOnFail: z.boolean().optional(),
    timeoutMs: z.number().int().positive().optional(),
    captureStdout: z.boolean().optional(),
    quiet: z.boolean().optional(),
    preset: z.string().min(1).optional(),
    warnAfterMs: z.number().int().nonnegative().optional(),
    storeStdoutAs: z.string().min(1).optional(),
    parseJson: z.union([
        z.boolean(),
        z.object({
            onError: z.enum(["fail", "warn"]).optional(),
            reviver: z.string().optional(),
        }),
    ]).optional(),
    storeWhen: z.enum(["success", "failure", "always"]).optional(),
    redactKeys: z.array(z.string().min(1)).optional(),
    dryRunStrategy: z.enum(["skip", "execute"]).optional(),
});
const recommendationLinkSchema = z.object({
    label: z.string().optional(),
    url: z.string().min(1),
});
const recommendationCommandSchema = z.object({
    label: z.string().optional(),
    command: z.string().min(1),
});
const autoHandlingSchema = z
    .object({
    strategy: z.enum(["retry", "default", "transition", "exit"]),
    target: transitionTargetSchema.optional(),
    limit: z.number().int().positive().optional(),
})
    .refine((value) => value.strategy !== "transition" || typeof value.target === "string", {
    message: "onError.auto.target is required when strategy is \"transition\".",
    path: ["target"],
})
    .refine((value) => value.strategy === "transition" || value.target === undefined, {
    message: "onError.auto.target is only valid when strategy is \"transition\".",
    path: ["target"],
});
const stepBaseSchema = z.object({
    id: z.string().min(1, "step id is required"),
    label: z.string().optional(),
    description: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
});
const promptStepSchema = stepBaseSchema.extend({
    type: z.literal("prompt"),
    mode: z.enum(["input", "confirm", "select", "multiselect"]),
    prompt: z.string().min(1, "prompt text is required"),
    options: z.array(promptOptionSchema).optional(),
    dynamic: promptDynamicSchema.optional(),
    defaultValue: z.union([
        z.string(),
        z.boolean(),
        z.array(z.string()),
    ]).optional(),
    storeAs: z.string().optional(),
    required: z.boolean().optional(),
    showSelectionOrder: z.boolean().optional(),
    validation: z
        .object({
        regex: z.string().optional(),
        message: z.string().optional(),
        minLength: z.number().int().nonnegative().optional(),
        maxLength: z.number().int().nonnegative().optional(),
    })
        .refine((data) => data.minLength === undefined ||
        data.maxLength === undefined ||
        data.minLength <= data.maxLength, {
        message: "validation.minLength must be less than or equal to validation.maxLength",
    })
        .optional(),
    persist: z
        .union([
        z.boolean(),
        z.object({
            scope: z.enum(["scenario", "project"]).optional(),
            key: z.string().min(1).optional(),
        }),
    ])
        .optional(),
});
const commandStepSchema = stepBaseSchema.extend({
    type: z.literal("command"),
    commands: z.array(commandDescriptorSchema).min(1),
    defaults: commandPresetSchema.extend({
        preset: z.string().min(1).optional(),
    }).optional(),
    continueOnError: z.boolean().optional(),
    collectSafe: z.boolean().optional(),
    onSuccess: transitionSchema.optional(),
    onError: z
        .object({
        recommendation: z.string().optional(),
        actions: z
            .array(z.object({
            label: z.string().min(1),
            next: transitionTargetSchema,
            description: z.string().optional(),
        }))
            .optional(),
        defaultNext: transitionSchema.optional(),
        policy: z
            .object({
            key: z.string().min(1),
            map: z.record(z.string(), transitionTargetSchema),
            default: transitionTargetSchema.optional(),
            required: z.boolean().optional(),
        })
            .optional(),
        auto: autoHandlingSchema.optional(),
        links: z.array(recommendationLinkSchema).optional(),
        commands: z.array(recommendationCommandSchema).optional(),
    })
        .optional(),
    summary: z.string().optional(),
});
const messageStepSchema = stepBaseSchema.extend({
    type: z.literal("message"),
    level: z.enum(["info", "success", "warning", "error"]).optional(),
    text: z.string().min(1),
    next: transitionSchema.optional(),
});
const branchStepSchema = stepBaseSchema.extend({
    type: z.literal("branch"),
    branches: z
        .array(z.object({
        when: z.string().min(1),
        next: transitionTargetSchema,
        description: z.string().optional(),
    }))
        .min(1),
    defaultNext: transitionSchema.optional(),
});
const groupStepSchema = stepBaseSchema.extend({
    type: z.literal("group"),
    flow: z.string().min(1),
});
const iterateSourceSchema = z.discriminatedUnion("from", [
    z.object({
        from: z.literal("answers"),
        key: z.string().min(1),
    }),
    z.object({
        from: z.literal("dynamic"),
        dynamic: promptDynamicSchema,
    }),
    z.object({
        from: z.literal("json"),
        path: z.string().min(1),
        pointer: z.string().optional(),
    }),
]);
const iterateStepSchema = stepBaseSchema.extend({
    type: z.literal("iterate"),
    flow: z.string().min(1),
    items: z.array(z.unknown()).optional(),
    source: iterateSourceSchema.optional(),
    storeEachAs: z.string().optional(),
    concurrency: z.number().int().positive().optional(),
    over: z.string().optional(),
});
const computeStepSchema = stepBaseSchema.extend({
    type: z.literal("compute"),
    values: z
        .record(z.string().min(1), z.unknown())
        .refine((value) => Object.keys(value).length > 0, {
        message: "compute.values must include at least one entry.",
    })
        .optional(),
    handler: z.string().min(1).optional(),
    params: z.record(z.string(), z.unknown()).optional(),
    storeAs: z.string().min(1).optional(),
    next: transitionSchema.optional(),
})
    .refine((step) => Boolean(step.values) || Boolean(step.handler), {
    message: "compute step must define values or a handler.",
    path: ["values"],
})
    .refine((step) => !(step.values && step.handler), {
    message: "compute step cannot define both values and handler.",
    path: ["handler"],
})
    .refine((step) => !step.handler || Boolean(step.storeAs), {
    message: "compute.handler requires storeAs.",
    path: ["storeAs"],
});
const gitWorktreeGuardStepSchema = stepBaseSchema.extend({
    type: z.literal("git-worktree-guard"),
    prompt: z.string().optional(),
    cleanMessage: z.string().optional(),
    dirtyMessage: z.string().optional(),
    allowCommit: z.boolean().optional(),
    allowStash: z.boolean().optional(),
    allowBranch: z.boolean().optional(),
    allowProceed: z.boolean().optional(),
    commitMessagePrompt: z.string().optional(),
    commitMessageDefault: z.string().optional(),
    stashMessagePrompt: z.string().optional(),
    stashMessageDefault: z.string().optional(),
    branchNamePrompt: z.string().optional(),
    branchNameDefault: z.string().optional(),
    proceedConfirmationPrompt: z.string().optional(),
    storeStrategyAs: z.string().optional(),
    storeCommitMessageAs: z.string().optional(),
    storeStashMessageAs: z.string().optional(),
    storeBranchNameAs: z.string().optional(),
    cwd: z.string().optional(),
});
const builtinStepTypeSet = new Set(BUILTIN_STEP_TYPES);
const pluginStepSchema = stepBaseSchema
    .extend({
    type: z
        .string()
        .min(1)
        .refine((value) => !builtinStepTypeSet.has(value), {
        message: "Step type conflicts with a built-in step type.",
    }),
})
    .passthrough();
const coreStepSchema = z.discriminatedUnion("type", [
    promptStepSchema,
    commandStepSchema,
    messageStepSchema,
    branchStepSchema,
    groupStepSchema,
    iterateStepSchema,
    computeStepSchema,
    gitWorktreeGuardStepSchema,
]);
const stepSchema = z.union([coreStepSchema, pluginStepSchema]);
const postRunHookSchema = z.object({
    flow: z.string().min(1),
    when: z.enum(["always", "on-success", "on-failure"]).optional(),
});
const scenarioSchema = z.object({
    id: z.string().min(1),
    label: z.string().min(1),
    description: z.string().optional(),
    flow: z.string().min(1),
    flows: z.array(z.string().min(1)).optional(),
    tags: z.array(z.string().min(1)).optional(),
    shortcuts: z.record(z.string(), z.string().min(1)).optional(),
    postRun: z
        .union([postRunHookSchema, z.array(postRunHookSchema)])
        .optional(),
    identity: z
        .object({
        segments: z
            .array(z
            .object({
            id: z.string().min(1),
            prompt: z.string().min(1),
            description: z.string().optional(),
            defaultValue: z.string().optional(),
            options: z
                .array(z.object({
                value: z.string().min(1),
                label: z.string().optional(),
                hint: z.string().optional(),
            }))
                .min(1)
                .optional(),
            allowCustom: z.boolean().optional(),
            placeholder: z.string().optional(),
        })
            .refine((segment) => Boolean(segment.allowCustom) ||
            (segment.options !== undefined &&
                segment.options.length > 0), {
            message: "identity segments must define options or set allowCustom: true",
            path: ["options"],
        }))
            .min(1, "identity.segments requires at least one segment"),
    })
        .optional(),
});
const flowSchema = z.object({
    id: z.string().min(1),
    label: z.string().optional(),
    description: z.string().optional(),
    steps: z.array(stepSchema).min(1),
});
const stringOrStringArray = z.union([
    z.string().min(1),
    z.array(z.string().min(1)).min(1),
]);
const policyMatchSchema = z
    .object({
    command: stringOrStringArray.optional(),
    commandPattern: stringOrStringArray.optional(),
    preset: stringOrStringArray.optional(),
    flow: stringOrStringArray.optional(),
    step: stringOrStringArray.optional(),
})
    .refine((value) => value.command !== undefined ||
    value.commandPattern !== undefined ||
    value.preset !== undefined ||
    value.flow !== undefined ||
    value.step !== undefined, {
    message: "policy.match must specify at least one selector (command, commandPattern, preset, flow, or step).",
});
const policyRuleSchema = z.object({
    id: z.string().min(1),
    level: z.enum(["allow", "warn", "block"]),
    match: policyMatchSchema,
    note: z.string().optional(),
});
const policyConfigSchema = z.object({
    defaultLevel: z.enum(["allow", "warn", "block"]).optional(),
    rules: z.array(policyRuleSchema).min(1),
});
export const configSchema = z.object({
    meta: metadataSchema,
    imports: z.array(z.string().min(1)).optional(),
    scenarios: z.array(scenarioSchema).default([]),
    flows: z.record(z.string(), flowSchema),
    commandPresets: z.record(z.string(), commandPresetSchema.extend({
        preset: z.never().optional(),
    })).optional(),
    policies: policyConfigSchema.optional(),
    plugins: z.array(z.object({
        module: z.string().min(1),
        name: z.string().optional(),
        options: z.unknown().optional(),
    })).optional().default([]),
});
export class ConfigSchemaError extends Error {
    name = "ConfigSchemaError";
    issues;
    filePath;
    constructor(filePath, issues) {
        super(`Invalid Dev Wizard config (${filePath})`);
        this.filePath = filePath;
        this.issues = issues;
    }
}
export function validateConfigSchema(raw, filePath) {
    const parsed = parseByExtension(raw, filePath);
    const result = configSchema.safeParse(parsed);
    if (!result.success) {
        return {
            success: false,
            error: new ConfigSchemaError(filePath, result.error.issues),
        };
    }
    return { success: true, config: result.data };
}
export function parseConfig(raw, filePath) {
    const validation = validateConfigSchema(raw, filePath);
    if (!validation.success) {
        throw validation.error;
    }
    const rawConfig = validation.config;
    for (const scenario of rawConfig.scenarios) {
        if (!scenario.postRun)
            continue;
        if (Array.isArray(scenario.postRun)) {
            continue;
        }
        scenario.postRun = [scenario.postRun];
    }
    const config = rawConfig;
    validateConfigIntegrity(config, filePath);
    return config;
}
function parseByExtension(raw, filePath) {
    const extension = filePath.split(".").pop()?.toLowerCase();
    switch (extension) {
        case "yaml":
        case "yml":
            return yaml.parse(raw);
        case "json5":
            return JSON5.parse(raw);
        case "json":
            return JSON.parse(raw);
        default:
            try {
                return yaml.parse(raw);
            }
            catch {
                return JSON5.parse(raw);
            }
    }
}
function validateConfigIntegrity(config, filePath) {
    const scenarioIds = new Set();
    for (const scenario of config.scenarios) {
        if (scenarioIds.has(scenario.id)) {
            throw new Error(`Duplicate scenario id "${scenario.id}" detected in ${filePath}.`);
        }
        scenarioIds.add(scenario.id);
        if (!config.flows[scenario.flow]) {
            throw new Error(`Scenario "${scenario.id}" references missing flow "${scenario.flow}" in ${filePath}.`);
        }
        if (scenario.flows) {
            for (const chainedFlow of scenario.flows) {
                if (!config.flows[chainedFlow]) {
                    throw new Error(`Scenario "${scenario.id}" references missing flow "${chainedFlow}" in flows array (${filePath}).`);
                }
            }
        }
    }
    for (const [flowId, flow] of Object.entries(config.flows)) {
        if (flow.id !== flowId) {
            throw new Error(`Flow key "${flowId}" does not match its id "${flow.id}" in ${filePath}.`);
        }
        const stepIds = new Set();
        for (const step of flow.steps) {
            if (stepIds.has(step.id)) {
                throw new Error(`Duplicate step id "${step.id}" found in flow "${flowId}" (${filePath}).`);
            }
            stepIds.add(step.id);
        }
    }
}
//# sourceMappingURL=parser.js.map