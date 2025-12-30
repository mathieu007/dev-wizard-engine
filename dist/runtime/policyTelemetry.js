export function createPolicyTelemetryHook(options) {
    return {
        write(event) {
            if (event.type === "policy.decision") {
                options.onDecision(event);
            }
        },
        close() {
            return Promise.resolve();
        },
    };
}
//# sourceMappingURL=policyTelemetry.js.map