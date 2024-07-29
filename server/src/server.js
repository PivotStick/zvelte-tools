import {
	createConnection,
	TextDocuments,
	ProposedFeatures,
	TextDocumentSyncKind,
	MarkupKind,
	Hover,
} from "vscode-languageserver/node.js";

import { TextDocument } from "vscode-languageserver-textdocument";
import { parse } from "@pivotass/zvelte/parser";

// Create a connection for the server, using Node's IPC as a transport.
// Also include all preview / proposed LSP features.
const connection = createConnection(
	ProposedFeatures.all,
	process.stdin,
	process.stdout,
);

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
	try {
		parse(change.document.getText());
		connection.sendDiagnostics({
			uri: change.document.uri,
			diagnostics: [],
		});
	} catch (/** @type {any} */ error) {
		connection.sendDiagnostics({
			uri: change.document.uri,
			diagnostics: [
				{
					message: error.text,
					range: {
						start: {
							line: error.range.start.ln,
							character: error.range.start.col - 1,
						},
						end: {
							line: error.range.end.ln,
							character: error.range.end.col,
						},
					},
				},
			],
		});
	}
});

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();
