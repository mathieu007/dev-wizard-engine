import fs from "node:fs";
import path from "node:path";
export function createLogWriter(filePath, options) {
    const resolvedPath = path.resolve(filePath);
    const directory = path.dirname(resolvedPath);
    fs.mkdirSync(directory, { recursive: true });
    const stream = fs.createWriteStream(resolvedPath, {
        flags: "a",
        encoding: "utf8",
    });
    return createWritableLogWriter(stream, { closeStream: true, options });
}
export function createStreamLogWriter(stream, options) {
    return createWritableLogWriter(stream, { closeStream: false, options });
}
function createWritableLogWriter(stream, { closeStream, options, }) {
    return {
        write(event) {
            const payload = {
                timestamp: new Date().toISOString(),
                ...sanitizeEvent(event, options),
            };
            stream.write(`${JSON.stringify(payload)}\n`);
        },
        close() {
            if (!closeStream) {
                return Promise.resolve();
            }
            return new Promise((resolve, reject) => {
                const handleFinish = () => {
                    cleanup();
                    resolve();
                };
                const handleError = (error) => {
                    cleanup();
                    reject(error);
                };
                const cleanup = () => {
                    stream.removeListener("finish", handleFinish);
                    stream.removeListener("close", handleFinish);
                    stream.removeListener("error", handleError);
                };
                stream.once("finish", handleFinish);
                stream.once("close", handleFinish);
                stream.once("error", handleError);
                stream.end();
            });
        },
    };
}
function sanitizeEvent(event, options) {
    if (!options) {
        return event;
    }
    let sanitized = event;
    if (options.redactPromptValues && event.type === "prompt.answer") {
        sanitized = {
            ...event,
            value: "[redacted]",
        };
    }
    if (options.redactCommandOutput && sanitized.type === "command.result") {
        const { stdout, stderr, ...rest } = sanitized;
        void stdout;
        void stderr;
        sanitized = {
            ...rest,
            stdout: undefined,
            stderr: undefined,
        };
    }
    return sanitized;
}
//# sourceMappingURL=logWriter.js.map