export function parseOverrideValue(step, rawValue) {
    switch (step.mode) {
        case "confirm": {
            if (typeof rawValue === "boolean") {
                return rawValue;
            }
            if (typeof rawValue === "string") {
                const parsed = parseBoolean(rawValue);
                return parsed;
            }
            throw new Error(`Override value for prompt "${step.id}" must be a boolean or boolean-like string.`);
        }
        case "select": {
            const value = typeof rawValue === "string" || typeof rawValue === "number"
                ? String(rawValue)
                : rawValue;
            if (typeof value !== "string") {
                throw new Error(`Override value for prompt "${step.id}" must be a string matching an available option.`);
            }
            if (step.options && !step.options.some((option) => option.value === value)) {
                throw new Error(`Override value "${value}" is not a valid option for prompt "${step.id}".`);
            }
            return value;
        }
        case "multiselect": {
            if (Array.isArray(rawValue)) {
                const values = rawValue.map((entry) => String(entry));
                if (step.options) {
                    const invalid = values.filter((value) => !step.options.some((option) => option.value === value));
                    if (invalid.length > 0) {
                        throw new Error(`Override values "${invalid.join(", ")}" are not valid options for prompt "${step.id}".`);
                    }
                }
                return values;
            }
            if (typeof rawValue === "string") {
                const values = rawValue
                    .split(",")
                    .map((entry) => entry.trim())
                    .filter(Boolean);
                if (step.options) {
                    const invalid = values.filter((value) => !step.options.some((option) => option.value === value));
                    if (invalid.length > 0) {
                        throw new Error(`Override values "${invalid.join(", ")}" are not valid options for prompt "${step.id}".`);
                    }
                }
                return values;
            }
            throw new Error(`Override value for prompt "${step.id}" must be an array of strings or a comma-separated string.`);
        }
        case "input":
        default: {
            if (rawValue === undefined || rawValue === null) {
                throw new Error(`Override value for prompt "${step.id}" must not be null or undefined.`);
            }
            if (typeof rawValue === "string") {
                return rawValue;
            }
            if (typeof rawValue === "number" || typeof rawValue === "boolean") {
                return String(rawValue);
            }
            throw new Error(`Override value for prompt "${step.id}" must be a primitive string/number/boolean.`);
        }
    }
}
export function validatePromptValue(step, value) {
    const rules = step.validation;
    if (!rules)
        return;
    const fallbackMessage = rules.message ?? `Prompt "${step.id}" did not satisfy validation rules.`;
    const { regex, minLength, maxLength } = rules;
    const length = Array.isArray(value)
        ? value.length
        : typeof value === "string"
            ? value.length
            : String(value).length;
    if (minLength !== undefined && length < minLength) {
        throw new Error(rules.message ??
            (Array.isArray(value)
                ? `Select at least ${minLength} option(s) for prompt "${step.id}".`
                : `Value for prompt "${step.id}" must be at least ${minLength} character(s).`));
    }
    if (maxLength !== undefined && length > maxLength) {
        throw new Error(rules.message ??
            (Array.isArray(value)
                ? `Select no more than ${maxLength} option(s) for prompt "${step.id}".`
                : `Value for prompt "${step.id}" must be at most ${maxLength} character(s).`));
    }
    if (regex) {
        let pattern;
        try {
            pattern = new RegExp(regex);
        }
        catch (error) {
            throw new Error(`Invalid validation regex "${regex}" for prompt "${step.id}": ${String(error)}`);
        }
        const target = Array.isArray(value)
            ? value.map((entry) => String(entry)).join(",")
            : String(value);
        if (!pattern.test(target)) {
            throw new Error(fallbackMessage);
        }
    }
}
function parseBoolean(rawValue) {
    const normalized = rawValue.trim().toLowerCase();
    if (["true", "1", "yes", "y", "on"].includes(normalized)) {
        return true;
    }
    if (["false", "0", "no", "n", "off"].includes(normalized)) {
        return false;
    }
    throw new Error(`Unable to parse boolean override value "${rawValue}".`);
}
//# sourceMappingURL=promptValidation.js.map