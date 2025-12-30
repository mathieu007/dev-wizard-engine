import { z } from "zod";
import type { DevWizardConfig } from "./types";
export declare const configSchema: z.ZodObject<{
    meta: z.ZodObject<{
        name: z.ZodString;
        version: z.ZodString;
        description: z.ZodOptional<z.ZodString>;
        schemaVersion: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>;
    imports: z.ZodOptional<z.ZodArray<z.ZodString>>;
    scenarios: z.ZodDefault<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        label: z.ZodString;
        description: z.ZodOptional<z.ZodString>;
        flow: z.ZodString;
        flows: z.ZodOptional<z.ZodArray<z.ZodString>>;
        tags: z.ZodOptional<z.ZodArray<z.ZodString>>;
        shortcuts: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        postRun: z.ZodOptional<z.ZodUnion<readonly [z.ZodObject<{
            flow: z.ZodString;
            when: z.ZodOptional<z.ZodEnum<{
                always: "always";
                "on-success": "on-success";
                "on-failure": "on-failure";
            }>>;
        }, z.core.$strip>, z.ZodArray<z.ZodObject<{
            flow: z.ZodString;
            when: z.ZodOptional<z.ZodEnum<{
                always: "always";
                "on-success": "on-success";
                "on-failure": "on-failure";
            }>>;
        }, z.core.$strip>>]>>;
        identity: z.ZodOptional<z.ZodObject<{
            segments: z.ZodArray<z.ZodObject<{
                id: z.ZodString;
                prompt: z.ZodString;
                description: z.ZodOptional<z.ZodString>;
                defaultValue: z.ZodOptional<z.ZodString>;
                options: z.ZodOptional<z.ZodArray<z.ZodObject<{
                    value: z.ZodString;
                    label: z.ZodOptional<z.ZodString>;
                    hint: z.ZodOptional<z.ZodString>;
                }, z.core.$strip>>>;
                allowCustom: z.ZodOptional<z.ZodBoolean>;
                placeholder: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
    }, z.core.$strip>>>;
    flows: z.ZodRecord<z.ZodString, z.ZodObject<{
        id: z.ZodString;
        label: z.ZodOptional<z.ZodString>;
        description: z.ZodOptional<z.ZodString>;
        steps: z.ZodArray<z.ZodUnion<readonly [z.ZodDiscriminatedUnion<[z.ZodObject<{
            id: z.ZodString;
            label: z.ZodOptional<z.ZodString>;
            description: z.ZodOptional<z.ZodString>;
            metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
            type: z.ZodLiteral<"prompt">;
            mode: z.ZodEnum<{
                input: "input";
                confirm: "confirm";
                select: "select";
                multiselect: "multiselect";
            }>;
            prompt: z.ZodString;
            options: z.ZodOptional<z.ZodArray<z.ZodObject<{
                label: z.ZodString;
                value: z.ZodString;
                hint: z.ZodOptional<z.ZodString>;
                disabled: z.ZodOptional<z.ZodBoolean>;
            }, z.core.$strip>>>;
            dynamic: z.ZodOptional<z.ZodDiscriminatedUnion<[z.ZodObject<{
                type: z.ZodLiteral<"command">;
                command: z.ZodString;
                cwd: z.ZodOptional<z.ZodString>;
                shell: z.ZodOptional<z.ZodBoolean>;
                cache: z.ZodOptional<z.ZodUnion<readonly [z.ZodLiteral<"session">, z.ZodLiteral<"always">, z.ZodObject<{
                    ttlMs: z.ZodNumber;
                }, z.core.$strip>]>>;
                map: z.ZodOptional<z.ZodObject<{
                    value: z.ZodOptional<z.ZodString>;
                    label: z.ZodOptional<z.ZodString>;
                    hint: z.ZodOptional<z.ZodString>;
                    disableWhen: z.ZodOptional<z.ZodString>;
                }, z.core.$strip>>;
            }, z.core.$strip>, z.ZodObject<{
                type: z.ZodLiteral<"glob">;
                patterns: z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>]>;
                cwd: z.ZodOptional<z.ZodString>;
                ignore: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>]>>;
                cache: z.ZodOptional<z.ZodUnion<readonly [z.ZodLiteral<"session">, z.ZodLiteral<"always">, z.ZodObject<{
                    ttlMs: z.ZodNumber;
                }, z.core.$strip>]>>;
                map: z.ZodOptional<z.ZodObject<{
                    value: z.ZodOptional<z.ZodString>;
                    label: z.ZodOptional<z.ZodString>;
                    hint: z.ZodOptional<z.ZodString>;
                    disableWhen: z.ZodOptional<z.ZodString>;
                }, z.core.$strip>>;
            }, z.core.$strip>, z.ZodObject<{
                type: z.ZodLiteral<"json">;
                path: z.ZodString;
                pointer: z.ZodOptional<z.ZodString>;
                cache: z.ZodOptional<z.ZodUnion<readonly [z.ZodLiteral<"session">, z.ZodLiteral<"always">, z.ZodObject<{
                    ttlMs: z.ZodNumber;
                }, z.core.$strip>]>>;
                map: z.ZodOptional<z.ZodObject<{
                    value: z.ZodOptional<z.ZodString>;
                    label: z.ZodOptional<z.ZodString>;
                    hint: z.ZodOptional<z.ZodString>;
                    disableWhen: z.ZodOptional<z.ZodString>;
                }, z.core.$strip>>;
            }, z.core.$strip>, z.ZodObject<{
                type: z.ZodLiteral<"workspace-projects">;
                includeRoot: z.ZodOptional<z.ZodBoolean>;
                maxDepth: z.ZodOptional<z.ZodNumber>;
                ignore: z.ZodOptional<z.ZodArray<z.ZodString>>;
                limit: z.ZodOptional<z.ZodNumber>;
                cache: z.ZodOptional<z.ZodUnion<readonly [z.ZodLiteral<"session">, z.ZodLiteral<"always">, z.ZodObject<{
                    ttlMs: z.ZodNumber;
                }, z.core.$strip>]>>;
                map: z.ZodOptional<z.ZodObject<{
                    value: z.ZodOptional<z.ZodString>;
                    label: z.ZodOptional<z.ZodString>;
                    hint: z.ZodOptional<z.ZodString>;
                    disableWhen: z.ZodOptional<z.ZodString>;
                }, z.core.$strip>>;
            }, z.core.$strip>, z.ZodObject<{
                type: z.ZodLiteral<"project-tsconfigs">;
                project: z.ZodString;
                includeCustom: z.ZodOptional<z.ZodBoolean>;
                cache: z.ZodOptional<z.ZodUnion<readonly [z.ZodLiteral<"session">, z.ZodLiteral<"always">, z.ZodObject<{
                    ttlMs: z.ZodNumber;
                }, z.core.$strip>]>>;
                map: z.ZodOptional<z.ZodObject<{
                    value: z.ZodOptional<z.ZodString>;
                    label: z.ZodOptional<z.ZodString>;
                    hint: z.ZodOptional<z.ZodString>;
                    disableWhen: z.ZodOptional<z.ZodString>;
                }, z.core.$strip>>;
            }, z.core.$strip>], "type">>;
            defaultValue: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodBoolean, z.ZodArray<z.ZodString>]>>;
            storeAs: z.ZodOptional<z.ZodString>;
            required: z.ZodOptional<z.ZodBoolean>;
            showSelectionOrder: z.ZodOptional<z.ZodBoolean>;
            validation: z.ZodOptional<z.ZodObject<{
                regex: z.ZodOptional<z.ZodString>;
                message: z.ZodOptional<z.ZodString>;
                minLength: z.ZodOptional<z.ZodNumber>;
                maxLength: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strip>>;
            persist: z.ZodOptional<z.ZodUnion<readonly [z.ZodBoolean, z.ZodObject<{
                scope: z.ZodOptional<z.ZodEnum<{
                    scenario: "scenario";
                    project: "project";
                }>>;
                key: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>]>>;
        }, z.core.$strip>, z.ZodObject<{
            id: z.ZodString;
            label: z.ZodOptional<z.ZodString>;
            description: z.ZodOptional<z.ZodString>;
            metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
            type: z.ZodLiteral<"command">;
            commands: z.ZodArray<z.ZodObject<{
                name: z.ZodOptional<z.ZodString>;
                run: z.ZodString;
                cwd: z.ZodOptional<z.ZodString>;
                env: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
                shell: z.ZodOptional<z.ZodBoolean>;
                continueOnFail: z.ZodOptional<z.ZodBoolean>;
                timeoutMs: z.ZodOptional<z.ZodNumber>;
                captureStdout: z.ZodOptional<z.ZodBoolean>;
                quiet: z.ZodOptional<z.ZodBoolean>;
                preset: z.ZodOptional<z.ZodString>;
                warnAfterMs: z.ZodOptional<z.ZodNumber>;
                storeStdoutAs: z.ZodOptional<z.ZodString>;
                parseJson: z.ZodOptional<z.ZodUnion<readonly [z.ZodBoolean, z.ZodObject<{
                    onError: z.ZodOptional<z.ZodEnum<{
                        warn: "warn";
                        fail: "fail";
                    }>>;
                    reviver: z.ZodOptional<z.ZodString>;
                }, z.core.$strip>]>>;
                storeWhen: z.ZodOptional<z.ZodEnum<{
                    always: "always";
                    success: "success";
                    failure: "failure";
                }>>;
                redactKeys: z.ZodOptional<z.ZodArray<z.ZodString>>;
                dryRunStrategy: z.ZodOptional<z.ZodEnum<{
                    skip: "skip";
                    execute: "execute";
                }>>;
            }, z.core.$strip>>;
            defaults: z.ZodOptional<z.ZodObject<{
                cwd: z.ZodOptional<z.ZodString>;
                env: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
                shell: z.ZodOptional<z.ZodBoolean>;
                timeoutMs: z.ZodOptional<z.ZodNumber>;
                captureStdout: z.ZodOptional<z.ZodBoolean>;
                quiet: z.ZodOptional<z.ZodBoolean>;
                warnAfterMs: z.ZodOptional<z.ZodNumber>;
                storeStdoutAs: z.ZodOptional<z.ZodString>;
                parseJson: z.ZodOptional<z.ZodUnion<readonly [z.ZodBoolean, z.ZodObject<{
                    onError: z.ZodOptional<z.ZodEnum<{
                        warn: "warn";
                        fail: "fail";
                    }>>;
                    reviver: z.ZodOptional<z.ZodString>;
                }, z.core.$strip>]>>;
                storeWhen: z.ZodOptional<z.ZodEnum<{
                    always: "always";
                    success: "success";
                    failure: "failure";
                }>>;
                redactKeys: z.ZodOptional<z.ZodArray<z.ZodString>>;
                dryRunStrategy: z.ZodOptional<z.ZodEnum<{
                    skip: "skip";
                    execute: "execute";
                }>>;
                description: z.ZodOptional<z.ZodString>;
                tags: z.ZodOptional<z.ZodArray<z.ZodString>>;
                preset: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>>;
            continueOnError: z.ZodOptional<z.ZodBoolean>;
            collectSafe: z.ZodOptional<z.ZodBoolean>;
            onSuccess: z.ZodOptional<z.ZodObject<{
                next: z.ZodUnion<readonly [z.ZodLiteral<"exit">, z.ZodLiteral<"repeat">, z.ZodString]>;
            }, z.core.$strip>>;
            onError: z.ZodOptional<z.ZodObject<{
                recommendation: z.ZodOptional<z.ZodString>;
                actions: z.ZodOptional<z.ZodArray<z.ZodObject<{
                    label: z.ZodString;
                    next: z.ZodUnion<readonly [z.ZodLiteral<"exit">, z.ZodLiteral<"repeat">, z.ZodString]>;
                    description: z.ZodOptional<z.ZodString>;
                }, z.core.$strip>>>;
                defaultNext: z.ZodOptional<z.ZodObject<{
                    next: z.ZodUnion<readonly [z.ZodLiteral<"exit">, z.ZodLiteral<"repeat">, z.ZodString]>;
                }, z.core.$strip>>;
                policy: z.ZodOptional<z.ZodObject<{
                    key: z.ZodString;
                    map: z.ZodRecord<z.ZodString, z.ZodUnion<readonly [z.ZodLiteral<"exit">, z.ZodLiteral<"repeat">, z.ZodString]>>;
                    default: z.ZodOptional<z.ZodUnion<readonly [z.ZodLiteral<"exit">, z.ZodLiteral<"repeat">, z.ZodString]>>;
                    required: z.ZodOptional<z.ZodBoolean>;
                }, z.core.$strip>>;
                auto: z.ZodOptional<z.ZodObject<{
                    strategy: z.ZodEnum<{
                        exit: "exit";
                        retry: "retry";
                        default: "default";
                        transition: "transition";
                    }>;
                    target: z.ZodOptional<z.ZodUnion<readonly [z.ZodLiteral<"exit">, z.ZodLiteral<"repeat">, z.ZodString]>>;
                    limit: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strip>>;
                links: z.ZodOptional<z.ZodArray<z.ZodObject<{
                    label: z.ZodOptional<z.ZodString>;
                    url: z.ZodString;
                }, z.core.$strip>>>;
                commands: z.ZodOptional<z.ZodArray<z.ZodObject<{
                    label: z.ZodOptional<z.ZodString>;
                    command: z.ZodString;
                }, z.core.$strip>>>;
            }, z.core.$strip>>;
            summary: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>, z.ZodObject<{
            id: z.ZodString;
            label: z.ZodOptional<z.ZodString>;
            description: z.ZodOptional<z.ZodString>;
            metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
            type: z.ZodLiteral<"message">;
            level: z.ZodOptional<z.ZodEnum<{
                success: "success";
                info: "info";
                warning: "warning";
                error: "error";
            }>>;
            text: z.ZodString;
            next: z.ZodOptional<z.ZodObject<{
                next: z.ZodUnion<readonly [z.ZodLiteral<"exit">, z.ZodLiteral<"repeat">, z.ZodString]>;
            }, z.core.$strip>>;
        }, z.core.$strip>, z.ZodObject<{
            id: z.ZodString;
            label: z.ZodOptional<z.ZodString>;
            description: z.ZodOptional<z.ZodString>;
            metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
            type: z.ZodLiteral<"branch">;
            branches: z.ZodArray<z.ZodObject<{
                when: z.ZodString;
                next: z.ZodUnion<readonly [z.ZodLiteral<"exit">, z.ZodLiteral<"repeat">, z.ZodString]>;
                description: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>>;
            defaultNext: z.ZodOptional<z.ZodObject<{
                next: z.ZodUnion<readonly [z.ZodLiteral<"exit">, z.ZodLiteral<"repeat">, z.ZodString]>;
            }, z.core.$strip>>;
        }, z.core.$strip>, z.ZodObject<{
            id: z.ZodString;
            label: z.ZodOptional<z.ZodString>;
            description: z.ZodOptional<z.ZodString>;
            metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
            type: z.ZodLiteral<"group">;
            flow: z.ZodString;
        }, z.core.$strip>, z.ZodObject<{
            id: z.ZodString;
            label: z.ZodOptional<z.ZodString>;
            description: z.ZodOptional<z.ZodString>;
            metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
            type: z.ZodLiteral<"iterate">;
            flow: z.ZodString;
            items: z.ZodOptional<z.ZodArray<z.ZodUnknown>>;
            source: z.ZodOptional<z.ZodDiscriminatedUnion<[z.ZodObject<{
                from: z.ZodLiteral<"answers">;
                key: z.ZodString;
            }, z.core.$strip>, z.ZodObject<{
                from: z.ZodLiteral<"dynamic">;
                dynamic: z.ZodDiscriminatedUnion<[z.ZodObject<{
                    type: z.ZodLiteral<"command">;
                    command: z.ZodString;
                    cwd: z.ZodOptional<z.ZodString>;
                    shell: z.ZodOptional<z.ZodBoolean>;
                    cache: z.ZodOptional<z.ZodUnion<readonly [z.ZodLiteral<"session">, z.ZodLiteral<"always">, z.ZodObject<{
                        ttlMs: z.ZodNumber;
                    }, z.core.$strip>]>>;
                    map: z.ZodOptional<z.ZodObject<{
                        value: z.ZodOptional<z.ZodString>;
                        label: z.ZodOptional<z.ZodString>;
                        hint: z.ZodOptional<z.ZodString>;
                        disableWhen: z.ZodOptional<z.ZodString>;
                    }, z.core.$strip>>;
                }, z.core.$strip>, z.ZodObject<{
                    type: z.ZodLiteral<"glob">;
                    patterns: z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>]>;
                    cwd: z.ZodOptional<z.ZodString>;
                    ignore: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>]>>;
                    cache: z.ZodOptional<z.ZodUnion<readonly [z.ZodLiteral<"session">, z.ZodLiteral<"always">, z.ZodObject<{
                        ttlMs: z.ZodNumber;
                    }, z.core.$strip>]>>;
                    map: z.ZodOptional<z.ZodObject<{
                        value: z.ZodOptional<z.ZodString>;
                        label: z.ZodOptional<z.ZodString>;
                        hint: z.ZodOptional<z.ZodString>;
                        disableWhen: z.ZodOptional<z.ZodString>;
                    }, z.core.$strip>>;
                }, z.core.$strip>, z.ZodObject<{
                    type: z.ZodLiteral<"json">;
                    path: z.ZodString;
                    pointer: z.ZodOptional<z.ZodString>;
                    cache: z.ZodOptional<z.ZodUnion<readonly [z.ZodLiteral<"session">, z.ZodLiteral<"always">, z.ZodObject<{
                        ttlMs: z.ZodNumber;
                    }, z.core.$strip>]>>;
                    map: z.ZodOptional<z.ZodObject<{
                        value: z.ZodOptional<z.ZodString>;
                        label: z.ZodOptional<z.ZodString>;
                        hint: z.ZodOptional<z.ZodString>;
                        disableWhen: z.ZodOptional<z.ZodString>;
                    }, z.core.$strip>>;
                }, z.core.$strip>, z.ZodObject<{
                    type: z.ZodLiteral<"workspace-projects">;
                    includeRoot: z.ZodOptional<z.ZodBoolean>;
                    maxDepth: z.ZodOptional<z.ZodNumber>;
                    ignore: z.ZodOptional<z.ZodArray<z.ZodString>>;
                    limit: z.ZodOptional<z.ZodNumber>;
                    cache: z.ZodOptional<z.ZodUnion<readonly [z.ZodLiteral<"session">, z.ZodLiteral<"always">, z.ZodObject<{
                        ttlMs: z.ZodNumber;
                    }, z.core.$strip>]>>;
                    map: z.ZodOptional<z.ZodObject<{
                        value: z.ZodOptional<z.ZodString>;
                        label: z.ZodOptional<z.ZodString>;
                        hint: z.ZodOptional<z.ZodString>;
                        disableWhen: z.ZodOptional<z.ZodString>;
                    }, z.core.$strip>>;
                }, z.core.$strip>, z.ZodObject<{
                    type: z.ZodLiteral<"project-tsconfigs">;
                    project: z.ZodString;
                    includeCustom: z.ZodOptional<z.ZodBoolean>;
                    cache: z.ZodOptional<z.ZodUnion<readonly [z.ZodLiteral<"session">, z.ZodLiteral<"always">, z.ZodObject<{
                        ttlMs: z.ZodNumber;
                    }, z.core.$strip>]>>;
                    map: z.ZodOptional<z.ZodObject<{
                        value: z.ZodOptional<z.ZodString>;
                        label: z.ZodOptional<z.ZodString>;
                        hint: z.ZodOptional<z.ZodString>;
                        disableWhen: z.ZodOptional<z.ZodString>;
                    }, z.core.$strip>>;
                }, z.core.$strip>], "type">;
            }, z.core.$strip>, z.ZodObject<{
                from: z.ZodLiteral<"json">;
                path: z.ZodString;
                pointer: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>], "from">>;
            storeEachAs: z.ZodOptional<z.ZodString>;
            concurrency: z.ZodOptional<z.ZodNumber>;
            over: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>, z.ZodObject<{
            id: z.ZodString;
            label: z.ZodOptional<z.ZodString>;
            description: z.ZodOptional<z.ZodString>;
            metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
            type: z.ZodLiteral<"compute">;
            values: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
            handler: z.ZodOptional<z.ZodString>;
            params: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
            storeAs: z.ZodOptional<z.ZodString>;
            next: z.ZodOptional<z.ZodObject<{
                next: z.ZodUnion<readonly [z.ZodLiteral<"exit">, z.ZodLiteral<"repeat">, z.ZodString]>;
            }, z.core.$strip>>;
        }, z.core.$strip>, z.ZodObject<{
            id: z.ZodString;
            label: z.ZodOptional<z.ZodString>;
            description: z.ZodOptional<z.ZodString>;
            metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
            type: z.ZodLiteral<"git-worktree-guard">;
            prompt: z.ZodOptional<z.ZodString>;
            cleanMessage: z.ZodOptional<z.ZodString>;
            dirtyMessage: z.ZodOptional<z.ZodString>;
            allowCommit: z.ZodOptional<z.ZodBoolean>;
            allowStash: z.ZodOptional<z.ZodBoolean>;
            allowBranch: z.ZodOptional<z.ZodBoolean>;
            allowProceed: z.ZodOptional<z.ZodBoolean>;
            commitMessagePrompt: z.ZodOptional<z.ZodString>;
            commitMessageDefault: z.ZodOptional<z.ZodString>;
            stashMessagePrompt: z.ZodOptional<z.ZodString>;
            stashMessageDefault: z.ZodOptional<z.ZodString>;
            branchNamePrompt: z.ZodOptional<z.ZodString>;
            branchNameDefault: z.ZodOptional<z.ZodString>;
            proceedConfirmationPrompt: z.ZodOptional<z.ZodString>;
            storeStrategyAs: z.ZodOptional<z.ZodString>;
            storeCommitMessageAs: z.ZodOptional<z.ZodString>;
            storeStashMessageAs: z.ZodOptional<z.ZodString>;
            storeBranchNameAs: z.ZodOptional<z.ZodString>;
            cwd: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>], "type">, z.ZodObject<{
            id: z.ZodString;
            label: z.ZodOptional<z.ZodString>;
            description: z.ZodOptional<z.ZodString>;
            metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
            type: z.ZodString;
        }, z.core.$loose>]>>;
    }, z.core.$strip>>;
    commandPresets: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodObject<{
        cwd: z.ZodOptional<z.ZodString>;
        env: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        shell: z.ZodOptional<z.ZodBoolean>;
        timeoutMs: z.ZodOptional<z.ZodNumber>;
        captureStdout: z.ZodOptional<z.ZodBoolean>;
        quiet: z.ZodOptional<z.ZodBoolean>;
        warnAfterMs: z.ZodOptional<z.ZodNumber>;
        storeStdoutAs: z.ZodOptional<z.ZodString>;
        parseJson: z.ZodOptional<z.ZodUnion<readonly [z.ZodBoolean, z.ZodObject<{
            onError: z.ZodOptional<z.ZodEnum<{
                warn: "warn";
                fail: "fail";
            }>>;
            reviver: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>]>>;
        storeWhen: z.ZodOptional<z.ZodEnum<{
            always: "always";
            success: "success";
            failure: "failure";
        }>>;
        redactKeys: z.ZodOptional<z.ZodArray<z.ZodString>>;
        dryRunStrategy: z.ZodOptional<z.ZodEnum<{
            skip: "skip";
            execute: "execute";
        }>>;
        description: z.ZodOptional<z.ZodString>;
        tags: z.ZodOptional<z.ZodArray<z.ZodString>>;
        preset: z.ZodOptional<z.ZodNever>;
    }, z.core.$strip>>>;
    policies: z.ZodOptional<z.ZodObject<{
        defaultLevel: z.ZodOptional<z.ZodEnum<{
            allow: "allow";
            warn: "warn";
            block: "block";
        }>>;
        rules: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            level: z.ZodEnum<{
                allow: "allow";
                warn: "warn";
                block: "block";
            }>;
            match: z.ZodObject<{
                command: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>]>>;
                commandPattern: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>]>>;
                preset: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>]>>;
                flow: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>]>>;
                step: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>]>>;
            }, z.core.$strip>;
            note: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    plugins: z.ZodDefault<z.ZodOptional<z.ZodArray<z.ZodObject<{
        module: z.ZodString;
        name: z.ZodOptional<z.ZodString>;
        options: z.ZodOptional<z.ZodUnknown>;
    }, z.core.$strip>>>>;
}, z.core.$strip>;
export declare class ConfigSchemaError extends Error {
    name: string;
    readonly issues: z.ZodIssue[];
    readonly filePath: string;
    constructor(filePath: string, issues: z.ZodIssue[]);
}
interface SchemaValidationResult {
    success: true;
    config: z.infer<typeof configSchema>;
}
interface SchemaValidationFailure {
    success: false;
    error: ConfigSchemaError;
}
export type SchemaValidationOutcome = SchemaValidationResult | SchemaValidationFailure;
export declare function validateConfigSchema(raw: string, filePath: string): SchemaValidationOutcome;
export declare function parseConfig(raw: string, filePath: string): DevWizardConfig;
export {};
