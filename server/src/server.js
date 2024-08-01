import {
	createConnection,
	TextDocuments,
	ProposedFeatures,
	TextDocumentSyncKind,
	Diagnostic,
	DiagnosticSeverity,
	DocumentHighlight,
	DocumentHighlightKind,
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
	const inZone = change.document.uri.includes("/zone.app/");

	/**
	 * @type {Diagnostic[]}
	 */
	const diagnostics = [];

	try {
		const source = change.document.getText();
		const ast = parse(source, {
			specialTag: inZone ? "zone" : undefined,
		});

		/**
		 * @param {Pick<import("@pivotass/zvelte/types").ZvelteNode, "start" | "end">} node
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

		ast.imports.forEach((n, i) => {
			if (
				ast.imports.find(
					(_, _i) =>
						_i !== i && _.specifier.name === n.specifier.name,
				)
			) {
				diagnostics.push({
					severity: DiagnosticSeverity.Error,
					message: `Duplicate identifier "${n.specifier.name}"`,
					range: nodeToRange(n.specifier),
				});
			}
		});

		/**
		 *  @type {import("@pivotass/zvelte/types").Component[]}
		 */
		const components = [];
		/**
		 * @type {DocumentHighlight[]}
		 */
		const symbols = [];

		walk(
			/** @type {import("@pivotass/zvelte/types").ZvelteNode} */ (
				ast.fragment
			),
			null,
			{
				Component(node, { next }) {
					const range = nodeToRange(node);

					if (
						!ast.imports.find((i) => i.specifier.name === node.name)
					) {
						diagnostics.push({
							message: `"${node.name}" is not defined, forgot an import tag?`,
							severity: DiagnosticSeverity.Warning,
							range,
						});
					}

					components.push(node);
					symbols.push({
						kind: DocumentHighlightKind.Read,
						range,
					});

					next();
				},
			},
		);

		for (const node of ast.imports) {
			if (!components.find((c) => c.name === node.specifier.name)) {
				diagnostics.push({
					message: `Unused import`,
					severity: DiagnosticSeverity.Hint,
					range: nodeToRange(node),
				});
			}
		}

		connection.onDocumentHighlight(() => symbols);
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
