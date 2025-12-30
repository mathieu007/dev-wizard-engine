export class PromptCancelledError extends Error {
	constructor(message = "Prompt cancelled by user.") {
		super(message);
		this.name = "PromptCancelledError";
	}
}

export interface PromptDriver {
	text(options: {
		message: string;
		initialValue?: string;
		placeholder?: string;
		validate?: (value: string) => string | undefined;
	}): Promise<string>;

	textWithHistory(options: {
		message: string;
		initialValue?: string;
		validate?: (value: string) => string | undefined;
		history: readonly string[];
	}): Promise<string>;

	confirm(options: { message: string; initialValue?: boolean }): Promise<boolean>;

	select<Value extends string>(options: {
		message: string;
		options: Array<{ value: Value; label?: string; hint?: string }>;
		initialValue?: Value;
		maxItems?: number;
	}): Promise<Value>;

	multiselect(options: {
		message: string;
		options: Array<{ value: string; label?: string; hint?: string }>;
		initialValues?: string[];
		required?: boolean;
		showSelectionOrder?: boolean;
		maxItems?: number;
	}): Promise<string[]>;

	selectWithShortcuts<Value extends string>(options: {
		message: string;
		options: Array<{ value: Value; label?: string; hint?: string }>;
		initialValue?: Value;
		maxItems?: number;
		shortcuts?: Array<{ key: string; value: Value; action: string }>;
		onShortcut?: (action: string) => void;
	}): Promise<Value>;
}

export class NonInteractivePromptDriver implements PromptDriver {
	constructor(private readonly hint?: string) {}

	private fail(): never {
		throw new Error(
			this.hint ??
				"Non-interactive run cannot prompt. Provide values via --answers/--set or run in collect mode first.",
		);
	}

	async text(options: {
		message: string;
		initialValue?: string;
		placeholder?: string;
		validate?: (value: string) => string | undefined;
	}): Promise<string> {
		void options;
		return this.fail();
	}

	async textWithHistory(options: {
		message: string;
		initialValue?: string;
		validate?: (value: string) => string | undefined;
		history: readonly string[];
	}): Promise<string> {
		void options;
		return this.fail();
	}

	async confirm(options: { message: string; initialValue?: boolean }): Promise<boolean> {
		void options;
		return this.fail();
	}

	async select<Value extends string>(options: {
		message: string;
		options: Array<{ value: Value; label?: string; hint?: string }>;
		initialValue?: Value;
		maxItems?: number;
	}): Promise<Value> {
		void options;
		return this.fail();
	}

	async multiselect(options: {
		message: string;
		options: Array<{ value: string; label?: string; hint?: string }>;
		initialValues?: string[];
		required?: boolean;
		showSelectionOrder?: boolean;
		maxItems?: number;
	}): Promise<string[]> {
		void options;
		return this.fail();
	}

	async selectWithShortcuts<Value extends string>(options: {
		message: string;
		options: Array<{ value: Value; label?: string; hint?: string }>;
		initialValue?: Value;
		maxItems?: number;
		shortcuts?: Array<{ key: string; value: Value; action: string }>;
		onShortcut?: (action: string) => void;
	}): Promise<Value> {
		void options;
		return this.fail();
	}
}
