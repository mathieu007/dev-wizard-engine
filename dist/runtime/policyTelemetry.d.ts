import type { WizardLogEvent, WizardLogWriter } from "./logWriter";
export type PolicyDecisionEvent = Extract<WizardLogEvent, {
    type: "policy.decision";
}>;
export interface PolicyTelemetryHookOptions {
    onDecision: (event: PolicyDecisionEvent) => void;
}
export declare function createPolicyTelemetryHook(options: PolicyTelemetryHookOptions): WizardLogWriter;
