// Minimal CJS runner for TypeScript tests without adding a full test framework
const tsnode = require('ts-node')
tsnode.register({
	transpileOnly: true,
	compilerOptions: {
		module: 'commonjs',
		moduleResolution: 'node',
		esModuleInterop: true,
	},
})

require('./cleanPrompt.spec.ts')
require('./tag-classifier.spec.ts')
require('./background-detector.spec.ts');
require('./tag-conflicts.spec.ts');
require('./tag-conflicts-property.spec.ts');
require('./reverse-prompt-parser.spec.ts');