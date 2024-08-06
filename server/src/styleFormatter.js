/**
 * @typedef {import("postcss").AnyNode} AnyNode
 * @typedef {import("./formatter.js").State} State
 *
 * @typedef {import("zimmerframe").Context<AnyNode, State>} FormatContext
 *
 * @type {import("zimmerframe").Visitors<AnyNode, State>}
 */
export const styleVisitors = {
	_(node, { state, next }) {
		if (node.type in styleVisitors) {
			return next();
		}

		state.add(`[$ ${node.type} $]`);
	},

	root(node, { state, visit }) {
		for (let i = 0; i < node.nodes.length; i++) {
			visit(node.nodes[i]);

			if (i !== node.nodes.length - 1) {
				state.nl(2);
			}
		}
	},

	rule(node, { state, visit }) {
		state.add(node.selectors.join(`,\n${state.indentation}`));
		state.add(" {");
		state.nl();
		state.indent();

		renderNodes(node.nodes, { state, visit });

		state.dedent();
		state.add("}");
	},

	decl(node, { state }) {
		state.add(`${node.prop}: ${node.value}`);

		if (node.important) {
			state.add(" !important");
		}

		state.add(";");
	},

	atrule(node, { state, visit }) {
		state.add(`@${node.name} ${node.params} {`);

		if (node.nodes) {
			state.nl();
			state.indent();

			renderNodes(node.nodes, { state, visit });

			state.dedent();
		}

		state.add("}");
	},

	comment(node, { state }) {
		state.add("// " + node.text);
	},
};

/**
 * @param {AnyNode[]} nodes
 * @param {Pick<FormatContext, "state" | "visit">} context
 */
function renderNodes(nodes, { state, visit }) {
	for (let i = 0; i < nodes.length; i++) {
		const child = nodes[i];
		const next = nodes[i + 1];

		visit(child);
		state.nl();

		if (next && (next.type === "rule" || next.type !== child.type)) {
			state.nl();
		}
	}
}
