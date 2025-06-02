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
	Location,
} from "vscode-languageserver/node.js";

import { TextDocument } from "vscode-languageserver-textdocument";
import { parse, indexesToRange } from "@pivotass/zvelte/parser";
import { walk } from "zimmerframe";
import { existsSync, readdirSync } from "fs";
import { basename, dirname, join } from "path";
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

connection.onInitialize((args) => {
	return {
		capabilities: {
			textDocumentSync: TextDocumentSyncKind.Incremental,
			documentHighlightProvider: true,
			documentFormattingProvider: true,
			definitionProvider: true,
			completionProvider: {
				triggerCharacters: ["<"],
			},
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

	const { parserOptions } = getUriMeta(params.textDocument.uri);
	const source = doc.getText();

	try {
		return [
			{
				newText: format(source, parserOptions),
				range: {
					start: doc.positionAt(0),
					end: doc.positionAt(source.length),
				},
			},
		];
	} catch (error) {
		console.error(error);
		return null;
	}
});

/**
 * @param {string} uri
 */
function getUriMeta(uri) {
	const inZone = uri.includes("/zone.app/");
	const origin = inZone ? (/^file:(.*\/zone\.app)/.exec(uri)?.[1] ?? "") : "";

	const parserOptions = {
		specialTag: inZone ? "zone" : undefined,
	};

	return {
		inZone,
		origin,
		parserOptions,
	};
}

/**
 * @param {string} origin
 */
function findAllComponents(origin) {
	/**
	 * @type {string[]}
	 */
	const zveltePaths = [];

	const walk = (path = origin) => {
		const entries = readdirSync(path, { withFileTypes: true });
		for (const entry of entries) {
			if (entry.isDirectory()) {
				walk(join(path, entry.name));
			} else if (entry.isFile() && entry.name.endsWith(".zvelte")) {
				zveltePaths.push(join(path, entry.name));
			}
		}
	};

	walk();

	return zveltePaths.map((uri) => {
		const path = uri.replace(origin.replace(/^\/+/, "/"), "");
		let php = path;

		if (path.startsWith("/components")) {
			const [, endpoint] = /^\/components\/(.*)$/.exec(path) ?? [];
			php = `CMP/${endpoint.replace(".zvelte", "")}`;
		} else if (path.startsWith("/apps/")) {
			const [, app, portal, endpoint] =
				/^\/apps\/(\w+)\/(\w+)\/components\/(.*)$/.exec(path) ?? [];
			php = `CMP/App/${app}/${portal}/${endpoint.replace(".zvelte", "")}`;
		}

		return {
			uri,
			php,
			name: basename(uri).replace(".zvelte", ""),
		};
	});
}

documents.onDidChangeContent((change) => {
	const { inZone, origin, parserOptions } = getUriMeta(change.document.uri);

	/**
	 * @param {import("@pivotass/zvelte/types").ImportTag} node
	 */
	function importSourceToAbsolute(node) {
		if (inZone && /^[A-Z]/.test(node.specifier.name)) {
			if (node.source.value.startsWith("CMP/App")) {
				const regex = /^CMP\/App\/([^/]+)\/([^/]+)\/(.+)$/;
				const match = regex.exec(node.source.value);

				if (!match) throw new Error("Namespace malformed.");

				const [, app, portal, path] = match;
				const fullpath = join(
					origin,
					"apps",
					app,
					portal,
					"components",
					path + ".zvelte",
				);

				return fullpath;
			}

			const regex = /^CMP\/(.+)$/;
			const match = regex.exec(node.source.value);

			if (match) {
				const [, path] = match;
				const fullpath = join(origin, "components", path + ".zvelte");

				return fullpath;
			}
		}

		return node.source.value.startsWith("/")
			? node.source.value
			: join(
					dirname(change.document.uri.slice("file:/".length)),
					node.source.value,
				);
	}

	/**
	 * @param {import("@pivotass/zvelte/types").ImportTag} node
	 */
	function resolveCMPImport(node) {
		if (!inZone || !/^[A-Z]/.test(node.specifier.name)) return;

		try {
			const fullpath = importSourceToAbsolute(node);

			if (!existsSync(fullpath)) {
				return `Component \`${fullpath}\` not found.`;
			}
		} catch (error) {
			if (typeof error === "string") return error;

			if (error instanceof Error) return error.message;

			return "Something went wrong while analyzing.";
		}
	}

	/**
	 * @type {Diagnostic[]}
	 */
	const diagnostics = [];
	/**
	 * @type {Location[]}
	 */
	const definitions = [];

	try {
		const source = change.document.getText();
		const ast = parse(source, parserOptions);

		/**
		 * @param {Pick<import("@pivotass/zvelte/types").ZvelteNode, "start" | "end">} node
		 * @returns {import("vscode-languageserver-textdocument").Range}
		 */
		function nodeToRange(node) {
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
		}

		/**
		 * @type {Record<string, DocumentHighlight[]>}
		 */
		const highlights = {};

		ast.imports.forEach((n, i) => {
			const specifierRange = nodeToRange(n.specifier);
			const unresolved = resolveCMPImport(n);

			if (unresolved) {
				diagnostics.push({
					severity: DiagnosticSeverity.Error,
					message: unresolved,
					range: nodeToRange(n.source),
				});
			} else {
				let path = importSourceToAbsolute(n);
				const uri = "file://" + path;

				definitions.push({
					uri,
					range: specifierRange,
				});

				definitions.push({
					uri,
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
		 *      name: string;
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
				Identifier(node, { next }) {
					const range = nodeToRange(node);
					const importPair = ast.imports.find(
						(i) => i.specifier.name === node.name,
					);

					const nameRange = {
						start: {
							line: range.start.line,
							character: range.start.character,
						},
						end: {
							line: range.start.line,
							character: range.start.character + node.name.length,
						},
					};

					if (importPair) {
						let path = importSourceToAbsolute(importPair);

						definitions.push({
							uri: "file://" + path,
							range: nameRange,
						});
					}

					components.push({
						name: node.name,
						range,
					});

					(highlights[node.name] ??= []).push({
						range: nameRange,
					});

					next();
				},
				Component(node, { next }) {
					const range = nodeToRange(node);
					const importPair = ast.imports.find(
						(i) => i.specifier.name === node.name,
					);

					const nameRange = {
						start: {
							line: range.start.line,
							character: range.start.character + 1,
						},
						end: {
							line: range.start.line,
							character:
								range.start.character + 1 + node.name.length,
						},
					};

					if (importPair) {
						let path = importSourceToAbsolute(importPair);

						definitions.push({
							uri: "file://" + path,
							range: nameRange,
						});
					}

					components.push({
						name: node.name,
						range,
					});

					(highlights[node.name] ??= []).push({
						range: nameRange,
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

		connection.onDefinition((params) => {
			for (const def of definitions) {
				if (isInRange(params.position, def.range)) {
					return /** @type {import("vscode-languageserver").Location} */ ({
						uri: def.uri,
						range: {
							start: { line: 0, character: 0 },
							end: { line: 0, character: 0 },
						},
					});
				}
			}

			return null;
		});

		connection.onCompletion((params, token, workDoneProgress) => {
			const cmps = findAllComponents(origin);

			return {
				isIncomplete: false,
				items: cmps.map((c) => {
					const additionalTextEdits = [];

					if (
						!ast.imports.find(
							(def) => def.specifier.name === c.name,
						)
					) {
						additionalTextEdits.push({
							newText: `{% import ${c.name} from "${c.php}" %}\n`,
							range: {
								start: { line: 0, character: 0 },
								end: { line: 0, character: 0 },
							},
						});
					}

					return {
						label: c.name,
						insertText: `${c.name}></${c.name}>`,
						documentation: c.php,
						additionalTextEdits,
					};
				}),
			};
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
