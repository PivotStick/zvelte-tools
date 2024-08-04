import { walk } from "zimmerframe";
import { parse } from "@pivotass/zvelte/parser";
import postcss from "postcss-scss";
import { styleVisitors } from "./styleFormatter.js";
import { VoidElements } from "./constants.js";

/**
 * @typedef {import("zimmerframe").Context<import("@pivotass/zvelte/types").ZvelteNode, State>} FormatContext
 *
 * @typedef {{
 *  readonly source: string;
 *  readonly indentation: string;
 *  add(text: string): void;
 *  indent(): void;
 *  dedent(): void;
 *  nl(count?: number): void;
 * }} State
 *
 * @param {string} source
 */
export function format(source) {
	let out = "";
	let indentation = 0;

	/**
	 * @type {State}
	 */
	const state = {
		get source() {
			return source;
		},
		get indentation() {
			return "\t".repeat(indentation);
		},
		add(text) {
			if (out[out.length - 1] !== "\n") {
				out += text;
				return;
			}

			out += `${state.indentation}${text}`;
		},
		nl(count = 1) {
			state.add("\n".repeat(count));
		},
		indent() {
			indentation++;
		},
		dedent() {
			indentation--;
		},
	};

	walk(parse(source), state, visitors);

	return out;
}

/**
 * @type {import("zimmerframe").Visitors<import("@pivotass/zvelte/types").ZvelteNode, State>}
 */
const visitors = {
	_(node, { state, next }) {
		if (node.type in visitors) {
			return next();
		}

		state.add(`[ ${node.type} ]`);
	},

	Root(node, { state, visit }) {
		node.imports.forEach((node) => {
			visit(node);
			state.nl();
		});

		const { cleaned } = cleanNodes(node.fragment.nodes, { trim: true });

		if (cleaned.length) {
			if (node.imports.length) state.nl();

			for (const child of cleaned) {
				visit(child);
			}
		}

		if (node.css) {
			if (cleaned.length || node.imports.length) {
				state.add("\n\n");
			}

			state.add("<style");
			for (const attr of node.css.attributes) {
				state.add(" ");
				visit(attr);
			}
			state.add(">\n");
			state.indent();

			walk(postcss.parse(node.css.code), state, styleVisitors);

			state.dedent();
			state.nl();
			state.add("</style>");
		}
	},

	ImportTag(node, { state }) {
		state.add(
			`{% import ${node.specifier.name} from "${node.source.value}" %}`,
		);
	},

	Fragment(node, { state, visit }) {
		const { cleaned } = cleanNodes(node.nodes);
		if (!cleaned.length) return;

		state.indent();
		for (const child of cleaned) visit(child);
		state.dedent();
	},

	Text(node, { state }) {
		if (node.metadata?.startPadding) {
			state.add(node.metadata.startPadding);
		}

		if (node.data) {
			state.add(node.data);
		}

		if (node.metadata?.endPadding) {
			state.add(node.metadata.endPadding);
		}
	},

	RegularElement(node, { state, visit }) {
		state.add(`<${node.name}`);
		const meta = renderElementAttributes(node, { state, visit });

		if (VoidElements.includes(node.name)) {
			if (!meta.neededWrap) state.add(" ");
			state.add("/>");
			return;
		}

		state.add(">");

		visit(node.fragment);

		state.add(`</${node.name}>`);
	},

	SpreadAttribute(node, { state, visit }) {
		state.add("{{ ...");
		visit(node.expression);
		state.add(" }}");
	},

	Attribute(node, { state, visit }) {
		// Checks if shorthand is possible
		if (
			node.value !== true &&
			node.value.length === 1 &&
			node.value[0].type === "ExpressionTag" &&
			node.value[0].expression.type === "Identifier" &&
			node.value[0].expression.name === node.name
		) {
			state.add(`{{ ${node.value[0].expression.name} }}`);
			return;
		}

		state.add(node.name);
		if (node.value !== true) {
			const quotted =
				node.value.length > 1 || node.value[0].type !== "ExpressionTag";

			state.add("=");

			if (quotted) {
				state.add('"');
			}

			node.value.forEach((node) => visit(node));

			if (quotted) {
				state.add('"');
			}
		}
	},

	ClassDirective(node, { state, visit }) {
		state.add(`class:${node.name}`);
		if (
			node.expression.type !== "Identifier" ||
			node.expression.name !== node.name
		) {
			state.add(`={{ `);
			visit(node.expression);
			state.add(` }}`);
		}
	},

	OnDirective(node, { state, visit }) {
		state.add(`on:${node.name}`);
		if (node.expression) {
			state.add("={{ ");
			visit(node.expression);
			state.add(" }}");
		}
	},

	TransitionDirective(node, { state, visit }) {
		if (node.intro && node.outro) {
			state.add("transition:");
		} else if (node.intro) {
			state.add("in:");
		} else {
			state.add("out:");
		}

		state.add(node.name);

		if (node.expression) {
			state.add("={{ ");
			visit(node.expression);
			state.add(" }}");
		}
	},

	UseDirective(node, { state, visit }) {
		state.add(`use:${node.name}`);

		if (node.expression) {
			state.add("={{ ");
			visit(node.expression);
			state.add(" }}");
		}
	},

	BindDirective(node, { state, visit }) {
		state.add(`bind:${node.name}`);
		if (
			node.expression.type !== "Identifier" ||
			node.expression.name !== node.name
		) {
			state.add("={{ ");
			visit(node.expression);
			state.add(" }}");
		}
	},

	ArrowFunctionExpression(node, { state, visit }) {
		state.add("(");
		for (let i = 0; i < node.params.length; i++) {
			const param = node.params[i];
			visit(param);

			if (i !== node.params.length - 1) {
				state.add(", ");
			}
		}
		state.add(") => ");
		visit(node.body);
	},

	AssignmentExpression(node, { state, visit }) {
		visit(node.left);
		state.add(` ${node.operator} `);
		visit(node.right);
	},

	ObjectExpression(node, { state, visit }) {
		if (!node.properties.length) return state.add("{}");

		const indent = state.source
			.slice(node.start + 1, node.properties[0].start)
			.includes("\n");

		const spacing = indent ? "\n" : " ";

		state.add(`{${spacing}`);

		if (indent) state.indent();

		for (const prop of node.properties) {
			visit(prop);

			if (prop !== node.properties[node.properties.length - 1]) {
				state.add(`,${spacing}`);
			}
		}

		if (indent) state.dedent();

		state.add(spacing);
		state.add("}");
	},

	Property(node, { state, visit }) {
		let key = "";
		if (node.key.type === "StringLiteral") {
			if (/^[a-zA-Z_\$][\w]*$/.test(node.key.value)) {
				key = node.key.value;
			} else {
				key = node.key.raw;
			}
		} else {
			key = node.key.name;
		}

		state.add(`${key}: `);
		visit(node.value);
	},

	UpdateExpression(node, { state, visit }) {
		if (node.prefix) {
			state.add(node.operator);
		}

		visit(node.argument);

		if (!node.prefix) {
			state.add(node.operator);
		}
	},

	ArrayExpression(node, { state, visit }) {
		if (!node.elements.length) return state.add("[]");

		const indent = state.source
			.slice(node.start + 1, node.elements[0].start)
			.includes("\n");

		const spacing = indent ? "\n" : " ";

		state.add("[");

		if (indent) {
			state.nl();
			state.indent();
		}

		for (const item of node.elements) {
			visit(item);

			if (item !== node.elements[node.elements.length - 1]) {
				state.add(",");
				state.add(spacing);
			}
		}

		if (indent) {
			state.nl();
			state.dedent();
		}

		state.add("]");
	},

	RangeExpression(node, { state, visit }) {
		visit(node.from);
		state.add("..");
		visit(node.to);
	},

	Comment(node, { state }) {
		state.add(`<!-- ${node.data.trim()} -->`);
	},

	StringLiteral(node, { state }) {
		state.add(node.raw);
	},

	BooleanLiteral(node, { state }) {
		state.add(node.raw);
	},

	BinaryExpression(node, { path, state, visit }) {
		const parent = path[path.length - 1];

		let group = false;

		if (
			parent.type === "BinaryExpression" ||
			parent.type === "LogicalExpression"
		) {
			group = precedences[parent.operator] > precedences[node.operator];
		}

		if (group) state.add("(");

		visit(node.left);
		state.add(` ${node.operator} `);
		visit(node.right);

		if (group) state.add(")");
	},

	CallExpression: callExpressionVisitor,
	FilterExpression: callExpressionVisitor,

	Identifier(node, { state }) {
		state.add(node.name);
	},

	NumericLiteral(node, { state }) {
		state.add(node.value.toString());
	},

	NullLiteral(node, { state }) {
		state.add(node.raw);
	},

	IsExpression(node, { state, visit }) {
		visit(node.left);
		state.add(" is ");
		if (node.not) {
			state.add(" not ");
		}
		visit(node.right);
	},

	InExpression(node, { state, visit }) {
		visit(node.left);
		if (node.not) {
			state.add(" not ");
		}
		state.add(" in ");
		visit(node.right);
	},

	MemberExpression(node, { state, visit }) {
		visit(node.object);
		if (node.optional) {
			state.add("?.");
		}

		if (node.computed) {
			state.add("[");
			visit(node.property);
			state.add("]");
		} else {
			if (!node.optional) {
				state.add(".");
			}

			visit(node.property);
		}
	},

	LogicalExpression(node, { state, visit }) {
		visit(node.left);
		state.add(` ${node.operator} `);
		visit(node.right);
	},

	UnaryExpression(node, { state, visit }) {
		state.add(node.operator);
		if (node.operator === "not") {
			state.add(" ");
		}
		visit(node.argument);
	},

	RenderTag(node, { state, visit }) {
		state.add("{{ @render ");
		visit(node.expression);
		state.add(" }}");
	},

	HtmlTag(node, { state, visit }) {
		state.add("{{ @html ");
		visit(node.expression);
		state.add(" }}");
	},

	ConditionalExpression(node, { state, visit }) {
		visit(node.test);
		state.add(" ? ");
		visit(node.consequent);
		state.add(" : ");
		visit(node.alternate);
	},

	ExpressionTag(node, { state, visit }) {
		state.add("{{ ");
		visit(node.expression);
		state.add(" }}");
	},

	ForBlock(node, { state, visit }) {
		state.add("{% for ");
		if (node.index) {
			visit(node.index);
			state.add(", ");
		}

		visit(node.context);
		state.add(" in ");

		visit(node.expression);

		if (node.key) {
			state.add("#(");
			visit(node.key);
			state.add(")");
		}

		state.add(" %}");

		visit(node.body);

		if (node.fallback) {
			state.add("{% else %}");

			visit(node.fallback);
		}

		state.add("{% endfor %}");
	},

	IfBlock(node, { state, visit }) {
		state.add("{% ");
		if (node.elseif) {
			state.add("else");
		}
		state.add("if ");
		visit(node.test);
		state.add(" %}");

		visit(node.consequent);

		if (node.alternate) {
			if (
				node.alternate.nodes.length === 1 &&
				node.alternate.nodes[0].type === "IfBlock" &&
				node.alternate.nodes[0].elseif
			) {
				const elseIf = node.alternate.nodes[0];
				visit(elseIf);
			} else {
				state.add("{% else %}");
				visit(node.alternate);
			}
		}

		if (!node.elseif) {
			state.add("{% endif %}");
		}
	},

	KeyBlock(node, { state, visit }) {
		state.add("{% key ");
		visit(node.expression);
		state.add(" %}");

		visit(node.fragment);

		state.add("{% endkey %}");
	},

	SnippetBlock(node, { state, visit }) {
		state.add(`{% snippet ${node.expression.name}(`);

		for (const param of node.parameters) {
			visit(param);

			if (param !== node.parameters[node.parameters.length - 1]) {
				state.add(", ");
			}
		}

		state.add(") %}");

		visit(node.body);

		state.add("{% endsnippet %}");
	},

	AwaitBlock(node, { state, visit }) {
		state.add(`{% await `);
		visit(node.expression);

		if (!node.pending) {
			if (node.then) {
				state.add(" then");

				if (node.value) {
					state.add(" ");
					visit(node.value);
				}
			} else if (node.catch) {
				state.add(" catch");

				if (node.error) {
					state.add(" ");
					visit(node.error);
				}
			}

			state.add(" %}");
			const body = node.then ?? node.catch;
			if (body) visit(body);
		} else {
			state.add(" %}");
			visit(node.pending);

			if (node.then) {
				const { cleaned } = cleanNodes(node.then.nodes);

				if (cleaned.length) {
					state.add("{% then");

					if (node.value) {
						state.add(" ");
						visit(node.value);
					}

					state.add(" %}");
					state.indent();
					for (const child of cleaned) visit(child);
					state.dedent();
				}
			}

			if (node.catch) {
				const { cleaned } = cleanNodes(node.catch.nodes);

				if (cleaned.length) {
					state.add("{% catch");

					if (node.error) {
						state.add(" ");
						visit(node.error);
					}

					state.add(" %}");
					state.indent();
					for (const child of cleaned) visit(child);
					state.dedent();
				}
			}
		}

		state.add(`{% endawait %}`);
	},

	Variable(node, { state, visit }) {
		state.add("{% set ");
		visit(node.assignment);
		state.add(" %}");
	},

	TitleElement(node, { state, visit }) {
		state.add("<title");
		renderElementAttributes(node, { state, visit });
		state.add(">");
		visit(node.fragment);
		state.add("</title>");
	},

	Component: renderElementLike,
	ZvelteComponent: renderElementLike,
	ZvelteSelf: renderElementLike,
	ZvelteHead: renderElementLike,
	ZvelteElement: renderElementLike,
};

/**
 * @param {import("@pivotass/zvelte/types").ElementLike} node
 * @param {FormatContext} context
 */
function renderElementLike(node, { state, visit }) {
	state.add(`<${node.name}`);

	const { neededWrap } = renderElementAttributes(node, { state, visit });
	const { cleaned } = cleanNodes(node.fragment.nodes);

	if (!cleaned.length) {
		if (!neededWrap) state.add(" ");
		state.add("/>");
		return;
	}

	state.add(">");
	state.indent();
	for (const child of cleaned) visit(child);
	state.dedent();
	state.add(`</${node.name}>`);
}

/**
 * @param {import("@pivotass/zvelte/types").ZvelteNode} node
 */
function isEmptyTextNode(node) {
	return node.type === "Text" && !node.data.trim();
}

/**
 * @param {RegExp} regex
 * @param {string} str
 * @param {number} count
 */
function hasPadding(regex, str, count) {
	return regex
		.exec(str)?.[0]
		.replace(/[^\n]/g, "")
		.includes("\n".repeat(count));
}

/**
 * @param {import("@pivotass/zvelte/types").ZvelteNode[]} nodes
 */
function cleanNodes(nodes, { trim = false } = {}) {
	if (!nodes.length || nodes.every(isEmptyTextNode)) return { cleaned: [] };

	if (trim) {
		nodes = trimNodes(nodes);
	}

	const cleaned = nodes.map((n, i) => {
		if (n.type === "Text") {
			const first = i === 0;
			const last = i === nodes.length - 1;
			const between = !first && !last;

			let data = n.data.trim();

			let startPadding = "";
			let endPadding = "";

			if (hasPadding(/^\s+/, n.data, 1)) startPadding += "\n";

			if ((data || between) && !first && hasPadding(/^\s+/, n.data, 2))
				startPadding += "\n";

			if (data) {
				if (hasPadding(/\s+$/, n.data, 1)) endPadding += "\n";
				if (!last && hasPadding(/\s+$/, n.data, 2)) endPadding += "\n";
			}

			return {
				...n,
				data,
				metadata: {
					startPadding,
					endPadding,
				},
			};
		}

		return n;
	});

	return {
		cleaned,
	};
}

/**
 * @param {import("@pivotass/zvelte/types").ZvelteNode[]} nodes
 */
function trimNodes(nodes) {
	let start = nodes.findIndex((node) => !isEmptyTextNode(node));
	let end = nodes.findLastIndex((node) => !isEmptyTextNode(node));

	if (start <= -1) start = 0;
	if (end <= -1) start = nodes.length - 1;

	nodes = nodes.slice(start, end + 1);

	const first = nodes[0];
	const last = nodes[nodes.length - 1];

	if (first.type === "Text") {
		nodes[0] = {
			...first,
			data: first.data.trimStart(),
		};
	}

	if (last.type === "Text") {
		nodes[nodes.length - 1] = {
			...last,
			data: last.data.trimStart(),
		};
	}

	return nodes;
}

/**
 * @param {import("@pivotass/zvelte/types").ElementLike} node
 * @param {Pick<FormatContext, "state" | "visit">} context
 */
function renderElementAttributes(node, { state, visit }) {
	let wrap = false;

	if (node.attributes.length) {
		const from = node.start + node.name.length + 1;
		const sliced = state.source.slice(from, node.attributes[0].start);

		wrap = sliced.includes("\n");
	}

	if (wrap) state.indent();
	for (const attr of node.attributes) {
		state.add(wrap ? "\n" : " ");
		visit(attr);
	}
	if (wrap) {
		state.dedent();
		state.nl();
	}

	return {
		neededWrap: wrap,
	};
}

/**
 * @param {import("@pivotass/zvelte/types").CallExpression | import("@pivotass/zvelte/types").FilterExpression} node
 * @param {FormatContext} context
 */
function callExpressionVisitor(node, { state, visit }) {
	visit(node.type === "CallExpression" ? node.callee : node.name);

	if (node.optional) {
		state.add("?.");
	}

	state.add("(");
	for (let i = 0; i < node.arguments.length; i++) {
		const arg = node.arguments[i];
		visit(arg);

		if (i !== node.arguments.length - 1) {
			state.add(", ");
		}
	}
	state.add(")");
}

/**
 * @type {Record<import("@pivotass/zvelte/types").BinaryExpression["operator"] | import("@pivotass/zvelte/types").LogicalExpression["operator"], number>}
 */
const precedences = {
	and: 4,
	or: 4,
	"||": 4,
	"??": 4,

	"*": 3,
	"/": 3,

	"+": 2,
	"-": 2,

	"<": 1,
	">": 1,
	">=": 1,
	"<=": 1,
	"==": 1,
	"!=": 1,

	"~": 0,
};
