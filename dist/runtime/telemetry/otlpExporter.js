import { randomBytes } from "node:crypto";
const DEFAULT_SERVICE_NAME = "dev-wizard";
const DEFAULT_SCOPE_NAME = "dev-wizard";
export function createOtlpLogWriter(options) {
    const headers = {
        "content-type": "application/json",
        ...options.headers,
    };
    let pending = Promise.resolve();
    let trace;
    const enqueue = (task) => {
        pending = pending.then(task).catch((error) => {
            // eslint-disable-next-line no-console
            console.warn("[dev-wizard][otlp] Failed to flush telemetry:", error);
        });
    };
    return {
        write(event) {
            switch (event.type) {
                case "scenario.start": {
                    const traceId = generateTraceId();
                    const rootSpanId = generateSpanId();
                    trace = {
                        traceId,
                        rootSpanId,
                        rootSpanName: event.label,
                        startTimeMs: toMillis(event.startedAt),
                        status: "STATUS_CODE_OK",
                        spans: [],
                        activeSteps: new Map(),
                        resourceAttributes: {
                            "service.name": options.serviceName ?? DEFAULT_SERVICE_NAME,
                            ...options.resourceAttributes,
                            "dev_wizard.scenario_id": event.scenarioId,
                        },
                        scopeName: options.scopeName ?? DEFAULT_SCOPE_NAME,
                    };
                    break;
                }
                case "step.start": {
                    if (!trace) {
                        break;
                    }
                    const spanId = generateSpanId();
                    trace.activeSteps.set(event.stepId, {
                        spanId,
                        name: `${event.stepType}:${event.stepId}`,
                        startTimeMs: Date.now(),
                        events: [],
                        attributes: [
                            makeAttribute("dev_wizard.flow_id", event.flowId),
                            makeAttribute("dev_wizard.step_type", event.stepType),
                            makeAttribute("dev_wizard.step_index", String(event.index)),
                        ],
                    });
                    break;
                }
                case "step.complete": {
                    if (!trace) {
                        break;
                    }
                    const active = trace.activeSteps.get(event.stepId);
                    const endTimeMs = Date.now();
                    const startTimeMs = active?.startTimeMs ?? endTimeMs - (event.durationMs ?? 0);
                    const span = {
                        traceId: trace.traceId,
                        spanId: active?.spanId ?? generateSpanId(),
                        parentSpanId: trace.rootSpanId,
                        name: active?.name ?? `${event.stepType}:${event.stepId}`,
                        kind: "SPAN_KIND_INTERNAL",
                        startTimeUnixNano: toUnixNano(startTimeMs),
                        endTimeUnixNano: toUnixNano(active ? active.startTimeMs + (event.durationMs ?? 0) : endTimeMs),
                        status: {
                            code: event.next === "exit" ? "STATUS_CODE_ERROR" : "STATUS_CODE_OK",
                        },
                        attributes: [
                            makeAttribute("dev_wizard.flow_id", event.flowId),
                            makeAttribute("dev_wizard.step_type", event.stepType),
                            makeAttribute("dev_wizard.step_index", String(event.index)),
                            makeAttribute("dev_wizard.step_next", event.next ? String(event.next) : "null"),
                        ],
                        events: active?.events,
                    };
                    if (active?.attributes) {
                        span.attributes = mergeAttributes(span.attributes ?? [], active.attributes);
                    }
                    trace.spans.push(span);
                    trace.activeSteps.delete(event.stepId);
                    break;
                }
                case "command.result": {
                    if (!trace) {
                        break;
                    }
                    const active = trace.activeSteps.get(event.stepId);
                    if (!active) {
                        break;
                    }
                    const attributes = [
                        makeAttribute("dev_wizard.command", event.command),
                        makeAttribute("dev_wizard.cwd", event.cwd ?? ""),
                        makeAttribute("dev_wizard.dry_run", String(event.dryRun)),
                        makeAttribute("dev_wizard.success", String(event.success)),
                    ];
                    if (typeof event.exitCode === "number") {
                        attributes.push(makeAttribute("dev_wizard.exit_code", String(event.exitCode)));
                    }
                    if (typeof event.durationMs === "number") {
                        attributes.push(makeAttribute("dev_wizard.duration_ms", String(event.durationMs)));
                    }
                    active.events.push({
                        name: "command.result",
                        timeUnixNano: toUnixNano(Date.now()),
                        attributes,
                    });
                    break;
                }
                case "branch.decision": {
                    if (!trace) {
                        break;
                    }
                    const spanState = trace.activeSteps.get(event.stepId);
                    if (!spanState) {
                        break;
                    }
                    spanState.events.push({
                        name: "branch.decision",
                        timeUnixNano: toUnixNano(Date.now()),
                        attributes: [
                            makeAttribute("dev_wizard.expression", event.expression),
                            makeAttribute("dev_wizard.result", String(event.result)),
                            makeAttribute("dev_wizard.target", event.target ?? "null"),
                        ],
                    });
                    break;
                }
                case "prompt.answer": {
                    if (!trace) {
                        break;
                    }
                    const spanState = trace.activeSteps.get(event.stepId);
                    if (!spanState) {
                        break;
                    }
                    spanState.events.push({
                        name: "prompt.answer",
                        timeUnixNano: toUnixNano(Date.now()),
                        attributes: [
                            makeAttribute("dev_wizard.flow_id", event.flowId),
                            makeAttribute("dev_wizard.step_id", event.stepId),
                            makeAttribute("dev_wizard.answer_redacted", "true"),
                        ],
                    });
                    break;
                }
                case "prompt.persistence": {
                    if (!trace) {
                        break;
                    }
                    const spanState = trace.activeSteps.get(event.stepId);
                    if (!spanState) {
                        break;
                    }
                    const attributes = [
                        makeAttribute("dev_wizard.flow_id", event.flowId),
                        makeAttribute("dev_wizard.step_id", event.stepId),
                        makeAttribute("dev_wizard.persistence_scope", event.scope),
                        makeAttribute("dev_wizard.persistence_key", event.key),
                        makeAttribute("dev_wizard.persistence_status", event.status),
                    ];
                    if (event.projectId) {
                        attributes.push(makeAttribute("dev_wizard.project_id", event.projectId));
                    }
                    if (typeof event.applied === "boolean") {
                        attributes.push(makeAttribute("dev_wizard.persistence_applied", String(event.applied)));
                    }
                    spanState.events.push({
                        name: "prompt.persistence",
                        timeUnixNano: toUnixNano(Date.now()),
                        attributes,
                    });
                    break;
                }
                case "policy.decision": {
                    if (!trace) {
                        break;
                    }
                    const spanState = trace.activeSteps.get(event.stepId);
                    if (!spanState) {
                        break;
                    }
                    const attributes = [
                        makeAttribute("dev_wizard.flow_id", event.flowId),
                        makeAttribute("dev_wizard.rule_id", event.ruleId),
                        makeAttribute("dev_wizard.rule_level", event.ruleLevel),
                        makeAttribute("dev_wizard.enforced_level", event.enforcedLevel),
                        makeAttribute("dev_wizard.acknowledged", String(event.acknowledged)),
                        makeAttribute("dev_wizard.command", event.command),
                    ];
                    if (event.note) {
                        attributes.push(makeAttribute("dev_wizard.policy_note", event.note));
                    }
                    spanState.events.push({
                        name: "policy.decision",
                        timeUnixNano: toUnixNano(Date.now()),
                        attributes,
                    });
                    break;
                }
                case "scenario.complete": {
                    if (!trace) {
                        break;
                    }
                    trace.status =
                        event.status === "success" ? "STATUS_CODE_OK" : "STATUS_CODE_ERROR";
                    trace.endTimeMs = toMillis(event.endedAt) ?? Date.now();
                    for (const spanState of trace.activeSteps.values()) {
                        const now = Date.now();
                        trace.spans.push({
                            traceId: trace.traceId,
                            spanId: spanState.spanId,
                            parentSpanId: trace.rootSpanId,
                            name: spanState.name,
                            kind: "SPAN_KIND_INTERNAL",
                            startTimeUnixNano: toUnixNano(spanState.startTimeMs),
                            endTimeUnixNano: toUnixNano(now),
                            status: { code: "STATUS_CODE_ERROR" },
                            attributes: spanState.attributes,
                            events: spanState.events,
                        });
                    }
                    trace.activeSteps.clear();
                    const completedTrace = trace;
                    trace = undefined;
                    enqueue(async () => {
                        await sendTrace(completedTrace, options.endpoint, headers);
                    });
                    break;
                }
                default:
                    break;
            }
        },
        close() {
            return pending;
        },
    };
}
function generateTraceId() {
    return randomBytes(16).toString("hex");
}
function generateSpanId() {
    return randomBytes(8).toString("hex");
}
function toUnixNano(ms) {
    return Math.round(ms * 1e6).toString();
}
function toMillis(timestamp) {
    if (!timestamp) {
        return Date.now();
    }
    const parsed = Date.parse(timestamp);
    return Number.isNaN(parsed) ? Date.now() : parsed;
}
function makeAttribute(key, value) {
    return {
        key,
        value: {
            stringValue: value,
        },
    };
}
function mergeAttributes(base, extra) {
    const seen = new Set();
    const result = [];
    for (const attribute of base) {
        result.push(attribute);
        seen.add(attribute.key);
    }
    for (const attribute of extra) {
        if (!seen.has(attribute.key)) {
            result.push(attribute);
        }
    }
    return result;
}
async function sendTrace(context, endpoint, headers) {
    if (!context.endTimeMs) {
        context.endTimeMs = Date.now();
    }
    const resourceAttributes = Object.entries(context.resourceAttributes).map(([key, value]) => makeAttribute(key, value));
    const rootSpan = {
        traceId: context.traceId,
        spanId: context.rootSpanId,
        name: context.rootSpanName,
        kind: "SPAN_KIND_INTERNAL",
        startTimeUnixNano: toUnixNano(context.startTimeMs),
        endTimeUnixNano: toUnixNano(context.endTimeMs),
        status: { code: context.status },
        attributes: resourceAttributes,
    };
    const payload = {
        resourceSpans: [
            {
                resource: {
                    attributes: resourceAttributes,
                },
                scopeSpans: [
                    {
                        scope: {
                            name: context.scopeName,
                        },
                        spans: [rootSpan, ...context.spans],
                    },
                ],
            },
        ],
    };
    await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
    });
}
//# sourceMappingURL=otlpExporter.js.map