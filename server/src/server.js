import {
	createConnection,
	TextDocuments,
	ProposedFeatures,
	TextDocumentSyncKind,
	MarkupKind,
	Hover,
	Diagnostic,
	DiagnosticSeverity,
} from "vscode-languageserver/node.js";

import { TextDocument } from "vscode-languageserver-textdocument";
import { parse, indexesToRange } from "@pivotass/zvelte/parser";
import { walk } from "zimmerframe";

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
	/**
	 * @type {Diagnostic[]}
	 */
	const diagnostics = [];

	try {
		const source = change.document.getText();
		const ast = parse(source);
		/**
		 * @param {import("@pivotass/zvelte/types").ZvelteNode} node
		 * @returns {import("vscode-languageserver-textdocument").Range}
		 */
		const nodeToRange = (node) => {
			const range = indexesToRange(node.start, node.end, source);
			return {
				start: {
					line: range.start.ln,
					character: range.start.col,
				},
				end: {
					line: range.end.ln,
					character: range.end.col,
				},
			};
		};

		walk(
			/** @type {import("@pivotass/zvelte/types").ZvelteNode} */ (
				ast.fragment
			),
			null,
			{
				Component(node, { next }) {
					if (
						!ast.imports.find((i) => i.specifier.name === node.name)
					) {
						diagnostics.push({
							message: `"${node.name}" is not defined, forgot an import tag?`,
							severity: DiagnosticSeverity.Warning,
							range: nodeToRange(node),
						});
					}
					next();
				},
			},
		);
	} catch (/** @type {any} */ error) {
		const { start, end } = error.range;

		diagnostics.push({
			message: error.text,
			range: {
				start: {
					line: start.ln,
					character: start.col,
				},
				end: {
					line: end.ln,
					character: end.col,
				},
			},
		});
	}

	connection.sendDiagnostics({
		uri: change.document.uri,
		diagnostics,
	});
});

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();