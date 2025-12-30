import type { PolicyConfig, PolicyLevel, PolicyRule } from "../loader/types";
export interface PolicyEvaluationContext {
    flowId: string;
    stepId: string;
    command: string;
    preset?: string;
}
export interface PolicyDecision {
    rule: PolicyRule;
    level: PolicyLevel;
    enforcedLevel: PolicyLevel;
    acknowledged: boolean;
    note?: string;
}
export interface PolicyEngine {
    evaluateCommand(context: PolicyEvaluationContext): PolicyDecision | undefined;
    acknowledge(ruleId: string): void;
    isAcknowledged(ruleId: string): boolean;
}
interface PolicyEngineOptions {
    config?: PolicyConfig;
    acknowledgedRuleIds?: Iterable<string>;
}
export declare function createPolicyEngine(options: PolicyEngineOptions): PolicyEngine | undefined;
export {};
