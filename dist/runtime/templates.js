import Handlebars from "handlebars";
const templateCache = new Map();
let helpersRegistered = false;
export function renderTemplate(template, context) {
    if (!template.includes("{{")) {
        return template;
    }
    ensureHelpersRegistered();
    const cached = templateCache.get(template) ??
        templateCache
            .set(template, Handlebars.compile(template, { noEscape: true }))
            .get(template);
    return cached(context);
}
export function renderMaybeNested(value, context) {
    if (typeof value === "string") {
        return renderTemplate(value, context);
    }
    if (Array.isArray(value)) {
        return value.map((item) => renderMaybeNested(item, context));
    }
    if (value && typeof value === "object") {
        return Object.fromEntries(Object.entries(value).map(([key, val]) => [
            key,
            renderMaybeNested(val, context),
        ]));
    }
    return value;
}
function ensureHelpersRegistered() {
    if (helpersRegistered) {
        return;
    }
    helpersRegistered = true;
    Handlebars.registerHelper("eq", (a, b) => a === b);
    Handlebars.registerHelper("ne", (a, b) => a !== b);
    Handlebars.registerHelper("lt", (a, b) => a < b);
    Handlebars.registerHelper("gt", (a, b) => a > b);
    Handlebars.registerHelper("and", (...args) => args.slice(0, -1).every(Boolean));
    Handlebars.registerHelper("or", (...args) => args.slice(0, -1).some(Boolean));
    Handlebars.registerHelper("not", (value) => !value);
    Handlebars.registerHelper("includes", (value, target) => {
        if (Array.isArray(value)) {
            return value.includes(target);
        }
        if (typeof value === "string") {
            return value.includes(String(target));
        }
        return false;
    });
    const isHandlebarsOptions = (value) => Boolean(value &&
        typeof value === "object" &&
        "hash" in value &&
        "data" in value);
    Handlebars.registerHelper("default", (value, fallback) => {
        const normalizedFallback = isHandlebarsOptions(fallback)
            ? undefined
            : fallback;
        return value ?? normalizedFallback;
    });
    Handlebars.registerHelper("array", (...args) => args.slice(0, -1));
    Handlebars.registerHelper("json", (value) => JSON.stringify(value, null, 2));
    Handlebars.registerHelper("jsonLiteral", (value) => {
        const json = JSON.stringify(value);
        return json === undefined ? "null" : json;
    });
    Handlebars.registerHelper("jsonString", (value) => {
        const json = JSON.stringify(value) ?? "null";
        return json
            .replace(/\\/g, "\\\\")
            .replace(/"/g, '\\"')
            .replace(/'/g, "\\'")
            .replace(/`/g, "\\`")
            .replace(/\u2028/g, "\\u2028")
            .replace(/\u2029/g, "\\u2029");
    });
    Handlebars.registerHelper("lookup", (value, key) => {
        if (value && typeof value === "object" && key != null) {
            return value[String(key)];
        }
        return undefined;
    });
    Handlebars.registerHelper("lookupOr", (value, key, fallback) => {
        if (value && typeof value === "object" && key != null) {
            const resolved = value[String(key)];
            return resolved === undefined ? (fallback ?? {}) : resolved;
        }
        return fallback ?? {};
    });
}
//# sourceMappingURL=templates.js.map