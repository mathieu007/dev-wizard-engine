export class PromptCancelledError extends Error {
    constructor(message = "Prompt cancelled by user.") {
        super(message);
        this.name = "PromptCancelledError";
    }
}
export class NonInteractivePromptDriver {
    hint;
    constructor(hint) {
        this.hint = hint;
    }
    fail() {
        throw new Error(this.hint ??
            "Non-interactive run cannot prompt. Provide values via --answers/--set or run in collect mode first.");
    }
    async text(options) {
        void options;
        return this.fail();
    }
    async textWithHistory(options) {
        void options;
        return this.fail();
    }
    async confirm(options) {
        void options;
        return this.fail();
    }
    async select(options) {
        void options;
        return this.fail();
    }
    async multiselect(options) {
        void options;
        return this.fail();
    }
    async selectWithShortcuts(options) {
        void options;
        return this.fail();
    }
}
//# sourceMappingURL=promptDriver.js.map