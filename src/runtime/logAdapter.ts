export interface WizardLogAdapter {
	info(message: string): void;
	warn(message: string): void;
	success(message: string): void;
	error(message: string): void;
	step?(message: string): void;
	message?(message: string): void;
}

export const defaultWizardLog: WizardLogAdapter = {
	info(message: string) {
		console.log(message);
	},
	warn(message: string) {
		console.warn(message);
	},
	success(message: string) {
		console.log(message);
	},
	error(message: string) {
		console.error(message);
	},
	step(message: string) {
		console.log(message);
	},
	message(message: string) {
		console.log(message);
	},
};
