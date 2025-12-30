export interface WizardLogAdapter {
    info(message: string): void;
    warn(message: string): void;
    success(message: string): void;
    error(message: string): void;
    step?(message: string): void;
    message?(message: string): void;
}
export declare const defaultWizardLog: WizardLogAdapter;
