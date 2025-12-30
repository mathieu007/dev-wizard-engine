import path from "node:path";
import { pathToFileURL } from "node:url";
import { BUILTIN_STEP_TYPES } from "../loader/types.js";
import { renderMaybeNested, renderTemplate } from "./templates.js";
import { defaultWizardLog } from "./logAdapter.js";
class WizardPluginRegistryImpl {
    handlers;
    constructor(handlers) {
        this.handlers = handlers;
    }
    getStepHandler(stepType) {
        return this.handlers.get(stepType);
    }
    all() {
        return Array.from(this.handlers.values());
    }
}
export function createEmptyPluginRegistry() {
    return new WizardPluginRegistryImpl(new Map());
}
export async function loadPlugins(references, options) {
    if (!references || references.length === 0) {
        return { registry: createEmptyPluginRegistry(), warnings: [] };
    }
    const handlers = new Map();
    const warnings = [];
    for (const reference of references) {
        const specifier = resolvePluginSpecifier(reference, options.repoRoot);
        let moduleExports;
        try {
            moduleExports = await import(specifier);
        }
        catch (error) {
            throw new Error(`Failed to load Dev Wizard plugin "${reference.module}": ${error instanceof Error ? error.message : String(error)}`);
        }
        const plugin = await instantiatePluginFromModule(moduleExports, reference);
        const pluginName = plugin.name ?? reference.name ?? reference.module;
        if (!plugin.stepHandlers || Object.keys(plugin.stepHandlers).length === 0) {
            warnings.push(`Plugin "${pluginName}" did not register any step handlers; ignoring.`);
            continue;
        }
        for (const [stepType, handler] of Object.entries(plugin.stepHandlers)) {
            if (!handler || typeof handler.run !== "function") {
                throw new Error(`Plugin "${pluginName}" registered invalid handler for step type "${stepType}".`);
            }
            if (handlers.has(stepType)) {
                const existing = handlers.get(stepType);
                throw new Error(`Step type "${stepType}" is already handled by plugin "${existing.pluginName}" (module: ${existing.reference.module}).`);
            }
            handlers.set(stepType, {
                stepType,
                pluginName,
                handler,
                reference,
            });
        }
    }
    return {
        registry: new WizardPluginRegistryImpl(handlers),
        warnings,
    };
}
function resolvePluginSpecifier(reference, repoRoot) {
    const candidate = reference.resolvedPath ?? reference.module;
    if (candidate.startsWith("file://")) {
        return candidate;
    }
    if (path.isAbsolute(candidate)) {
        return pathToFileURL(candidate).href;
    }
    if (candidate.startsWith("./") || candidate.startsWith("../")) {
        return pathToFileURL(path.resolve(repoRoot, candidate)).href;
    }
    return candidate;
}
async function instantiatePluginFromModule(moduleExports, reference) {
    const factory = typeof moduleExports.createDevWizardPlugin === "function"
        ? moduleExports.createDevWizardPlugin.bind(moduleExports)
        : typeof moduleExports.createPlugin === "function"
            ? moduleExports.createPlugin.bind(moduleExports)
            : typeof moduleExports.default === "function"
                ? moduleExports.default.bind(moduleExports)
                : undefined;
    if (factory) {
        const result = await factory(reference.options ?? {}, {
            module: reference.module,
            resolvedPath: reference.resolvedPath,
        });
        validatePluginObject(result, reference);
        return result;
    }
    const pluginObject = (typeof moduleExports.default === "object" && moduleExports.default !== null
        ? moduleExports.default
        : typeof moduleExports.plugin === "object" && moduleExports.plugin !== null
            ? moduleExports.plugin
            : undefined);
    if (!pluginObject) {
        throw new Error(`Plugin module "${reference.module}" must export a plugin object or a "createPlugin" / "createDevWizardPlugin" factory.`);
    }
    validatePluginObject(pluginObject, reference);
    return pluginObject;
}
function validatePluginObject(value, reference) {
    if (!value || typeof value !== "object") {
        throw new Error(`Plugin module "${reference.module}" did not return a valid plugin object.`);
    }
    if (!("stepHandlers" in value) ||
        typeof value.stepHandlers !== "object" ||
        !value.stepHandlers) {
        throw new Error(`Plugin "${reference.module}" is missing a "stepHandlers" object.`);
    }
}
export function createPluginHelpers(templateContext) {
    return {
        renderTemplate(value) {
            return renderTemplate(value, templateContext);
        },
        renderMaybeNested(value) {
            return renderMaybeNested(value, templateContext);
        },
        templateContext,
        log: defaultWizardLog,
    };
}
export function isPluginStep(step) {
    return !BUILTIN_STEP_TYPES.includes(step.type);
}
//# sourceMappingURL=plugins.js.map