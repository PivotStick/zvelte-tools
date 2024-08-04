import {
	createConnection,
	TextDocuments,
	ProposedFeatures,
	TextDocumentSyncKind,
	Diagnostic,
	DiagnosticSeverity,
	DocumentHighlight,
	Range,
	Position,
} from "vscode-languageserver/node.js";

import { TextDocument } from "vscode-languageserver-textdocument";
import { parse, indexesToRange } from "@pivotass/zvelte/parser";
import { walk } from "zimmerframe";
import { existsSync } from "fs";
import { join } from "path";
import { format } from "./formatter.js";

// Create a connection for the server, using Node's IPC as a transport.
// Also include all preview / proposed LSP features.
const connection = createConnection(
	ProposedFeatures.all,
	process.stdin,
	process.stdout,
);

// Create a simple text document manager.
const documents = new TextDocuments(TextDocument);

connection.onInitialize(() => {
	return {
		capabilities: {
			textDocumentSync: TextDocumentSyncKind.Incremental,
			documentHighlightProvider: true,
			documentFormattingProvider: false,
		},
	};
});

/**
 * @param {Position} position
 * @param {Range} range
 */
function isInRange(position, range) {
	return (
		position.line >= range.start.line &&
		position.character >= range.start.character &&
		position.line <= range.end.line &&
		position.character <= range.end.character
	);
}

connection.onDocumentFormatting((params) => {
	const doc = documents.get(params.textDocument.uri);
	if (!doc) return null;

	const source = doc.getText();

	try {
		return [
			{
				newText: format(source),
				range: {
					start: doc.positionAt(0),
					end: doc.positionAt(source.length),
				},
			},
		];
	} catch (error) {
		return null;
	}
});

documents.onDidChangeContent((change) => {
	const inZone = change.document.uri.includes("/zone.app/");
	const origin = inZone
		? /^file:(.*\/zone\.app)/.exec(change.document.uri)?.[1] ?? ""
		: "";

	/**
	 * @param {import("@pivotass/zvelte/types").ImportTag} node
	 */
	function resolveCMPImport(node) {
		if (!inZone) return;
		const regex = /^CMP\/App\/([^/]+)\/([^/]+)\/(.+)$/;
		const match = regex.exec(node.source.value);

		try {
			if (!match) throw new Error("Namespace malformed.");
			const [, app, portal, path] = match;
			const fullpath = join(
				origin,
				"apps",
				app,
				portal,
				"components",
				path,
			);

			if (!existsSync(fullpath + ".php")) {
				return `Component \`${node.specifier.name}\` not found.`;
			}
		} catch (error) {
			if (typeof error === "string") return error;
			return "Something went wrong while analyzing.";
		}
	}

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
		 * @type {Record<string, DocumentHighlight[]>}
		 */
		const highlights = {};

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
			const specifierRange = nodeToRange(n.specifier);
			const unresolved = resolveCMPImport(n);

			if (unresolved) {
				diagnostics.push({
					severity: DiagnosticSeverity.Error,
					message: unresolved,
					range: nodeToRange(n.source),
				});
			}

			if (
				ast.imports.find(
					(_, _i) =>
						_i !== i && _.specifier.name === n.specifier.name,
				)
			) {
				diagnostics.push({
					severity: DiagnosticSeverity.Error,
					message: `Duplicate identifier "${n.specifier.name}"`,
					range: specifierRange,
				});
			}

			(highlights[n.specifier.name] ??= []).push({
				range: specifierRange,
			});
		});

		/**
		 *  @type {{
		 *      node: import("@pivotass/zvelte/types").Component;
		 *      range: import("vscode-languageserver").Range;
		 *  }[]}
		 */
		const components = [];

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

					components.push({
						node,
						range,
					});

					(highlights[node.name] ??= []).push({
						range: {
							start: {
								line: range.start.line,
								character: range.start.character + 1,
							},
							end: {
								line: range.start.line,
								character:
									range.start.character +
									1 +
									node.name.length,
							},
						},
					});

					next();
				},
			},
		);

		for (const node of ast.imports) {
			if (!components.find((c) => c.node.name === node.specifier.name)) {
				diagnostics.push({
					message: `Unused import`,
					severity: DiagnosticSeverity.Hint,
					range: nodeToRange(node),
				});
			}
		}

		connection.onDocumentHighlight((params) => {
			for (const [_key, ranges] of Object.entries(highlights)) {
				for (const range of ranges) {
					if (isInRange(params.position, range.range)) {
						return ranges;
					}
				}
			}

			return null;
		});
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
