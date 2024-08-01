const path = require("path");
const { workspace, ExtensionContext } = require("vscode");

const {
	LanguageClient,
	LanguageClientOptions,
	ServerOptions,
	TransportKind,
} = require("vscode-languageclient/node");

/**
 * @type {LanguageClient}
 */
let client;

/**
 * @param {ExtensionContext} context
 */
module.exports.activate = function (context) {
	// The server is implemented in node
	const serverModule = context.asAbsolutePath(
		path.join("server", "src", "server.js"),
	);

	/**
	 * If the extension is launched in debug mode then the debug server options are used
	 * Otherwise the run options are used
	 *
	 * @type {ServerOptions}
	 */
	const serverOptions = {
		run: { module: serverModule, transport: TransportKind.stdio },
		debug: {
			module: serverModule,
			transport: TransportKind.stdio,
			options: {
				execArgv: ["--nolazy", "--inspect=6009"],
			},
		},
	};

	/**
	 * Options to control the language client
	 * @type {LanguageClientOptions}
	 */
	const clientOptions = {
		// Register the server for all documents by default
		documentSelector: [{ scheme: "file", language: "zvelte" }],
		synchronize: {
			// Notify the server about file changes to '.clientrc files contained in the workspace
			fileEvents: workspace.createFileSystemWatcher("**/.clientrc"),
		},
	};

	// Create the language client and start the client.
	client = new LanguageClient(
		"zvelte",
		"Zvelte language server",
		serverOptions,
		clientOptions,
	);

	// Start the client. This will also launch the server
	client.start();
};

/**
 * @returns {Thenable<void> | undefined}
 */
module.exports.deactivate = function () {
	return client?.stop();
};
