import path from "node:path";
import { Writable } from "node:stream";
import { resolveConfigPaths } from "../loader/configResolver.js";
import { loadConfig } from "../loader/configLoader.js";
import { describeWizard, } from "../runtime/describe.js";
import { buildScenarioPlan, } from "../runtime/executor.js";
import { formatScenarioPlanJson, formatScenarioPlanNdjson, formatScenarioPlanPretty, } from "../runtime/planFormatter.js";
import { createPolicyEngine } from "../runtime/policyEngine.js";
import { loadPlugins, } from "../runtime/plugins.js";
import { createPromptHistoryManager } from "../runtime/promptHistory.js";
import { NonInteractivePromptDriver } from "../runtime/promptDriver.js";
export async function loadWizard(options = {}) {
    const cwd = options.cwd ? path.resolve(options.cwd) : process.cwd();
    const repoRoot = options.repoRoot ? path.resolve(options.repoRoot) : cwd;
    const resolution = await resolveConfigPaths({
        cwd,
        explicitPaths: options.configPath,
        environment: options.environment,
    });
    if (resolution.errors.length > 0 || resolution.paths.length === 0) {
        const message = resolution.errors[0] ??
            "No Dev Wizard configuration files were found for the supplied options.";
        throw new Error(message);
    }
    const config = await loadConfig({
        configPaths: resolution.paths,
        cwd,
    });
    const description = await describeWizard({
        configPath: resolution.paths,
        cwd,
    });
    const pluginResult = await loadPlugins(config.plugins, { repoRoot });
    return {
        config,
        resolution,
        description,
        repoRoot,
        pluginWarnings: pluginResult.warnings,
        pluginRegistry: pluginResult.registry,
    };
}
export async function planScenario(options) {
    const compileResult = await compilePlan(options);
    const prettyPlan = formatScenarioPlanPretty(compileResult.plan);
    const ndjsonPlan = formatScenarioPlanNdjson(compileResult.plan);
    const jsonPlan = formatScenarioPlanJson(compileResult.plan);
    return {
        ...compileResult,
        prettyPlan,
        ndjsonPlan,
        jsonPlan,
    };
}
export async function compilePlan(options) {
    const { config, resolution, description, repoRoot, pluginWarnings, pluginRegistry, } = await loadWizard(options);
    const dryRun = options.dryRun ?? true;
    const quiet = options.quiet ?? true;
    const verbose = options.verbose ?? false;
    const promptHistory = createPromptHistoryManager();
    try {
        const context = {
            config,
            scenarioId: options.scenarioId,
            repoRoot,
            stdout: createNullWritable(),
            stderr: createNullWritable(),
            dryRun,
            quiet,
            verbose,
            promptDriver: new NonInteractivePromptDriver(),
            overrides: structuredClone(options.overrides ?? {}),
            logWriter: undefined,
            promptOptionsCache: new Map(),
            checkpoint: undefined,
            policy: createPolicyEngine({ config: config.policies }),
            plugins: pluginRegistry,
            promptHistory,
        };
        const plan = await buildScenarioPlan(context, {});
        return {
            config,
            resolution,
            description,
            repoRoot,
            pluginWarnings,
            pluginRegistry,
            plan,
            targetMode: dryRun ? "dry-run" : "live",
        };
    }
    finally {
        await promptHistory.close().catch(() => undefined);
    }
}
function createNullWritable() {
    return new Writable({
        write(_chunk, _encoding, callback) {
            callback();
        },
    });
}
//# sourceMappingURL=api.js.map