import type { WizardLogWriter } from "../logWriter";
export interface OtlpExporterOptions {
    endpoint: string;
    headers?: Record<string, string>;
    serviceName?: string;
    scopeName?: string;
    resourceAttributes?: Record<string, string>;
}
export declare function createOtlpLogWriter(options: OtlpExporterOptions): WizardLogWriter;
