import path from "node:path";
import { defineConfig } from "vitest/config";

const engineRoot = path.resolve(__dirname, "src");

export default defineConfig({
	resolve: {
		alias: [
			{
				find: /^@ScaffoldStack/dev-wizard-engine$/,
				replacement: path.join(engineRoot, "index.ts"),
			},
			{
				find: /^@ScaffoldStack/dev-wizard-engine\/(.*)$/,
				replacement: `${engineRoot}/$1`,
			},
		],
	},
});
