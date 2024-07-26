import {
	createConnection,
	TextDocuments,
	ProposedFeatures,
	TextDocumentSyncKind,
} from "vscode-languageserver/node.js";

import { TextDocument } from "vscode-languageserver-textdocument";

// Create a connection for the server, using Node's IPC as a transport.
// Also include all preview / proposed LSP features.
const connection = createConnection(ProposedFeatures.all);

// Create a simple text document manager.
const documents = new TextDocuments(TextDocument);

connection.onInitialize((params) => {
	return {
		capabilities: {
			textDocumentSync: TextDocumentSyncKind.Incremental,
		},
	};
});

documents.onDidChangeContent((change) => {
	connection.window.showInformationMessage("Hello! " + change.document.uri);
});

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();
