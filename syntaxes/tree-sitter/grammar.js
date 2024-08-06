/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

module.exports = grammar({
	name: "zvelte",

	conflicts: ($) => [[$.elseif_block], [$.else_block]],

	rules: {
		document: ($) => repeat($._node),

		comment: () => seq("<!--", optional(/([^-][^-][^>])+/), "-->"),

		_node: ($) => choice($.comment, $.template, $.tag, $.text),

		// ---- TEMPLATE ----

		template: ($) => choice($.component, $.script_tag, $.regular_element),

		// text
		text: () => /[^{<]+/,

		script_tag: ($) =>
			seq(
				"<",
				alias("script", "regular_element_name"),
				repeat($.attribute),
				"/>",
				/[\s\S]+/,
				"</",
				alias("script", "regular_element_name"),
				">",
			),

		// regular element
		regular_element: ($) =>
			choice(
				seq("<", $.regular_element_name, repeat($.attribute), "/>"),
				seq(
					"<",
					$.regular_element_name,
					repeat($.attribute),
					">",
					repeat($._node),
					"</",
					$.regular_element_name,
					">",
				),
			),
		regular_element_name: () => /[a-z][a-z0-9\:\-]*/,

		attribute: ($) =>
			choice(
				seq(
					$.attribute_name,
					optional(
						seq("=", choice($.attribute_value, $.expression_tag)),
					),
				),
				$.spread_attribute,
				$.expression_tag,
			),

		attribute_name: () => /[^\s=\/>]+/,
		attribute_value: ($) =>
			choice(
				seq('"', repeat(choice(/[^"{]+/, $.expression_tag)), '"'),
				seq("'", repeat(choice(/[^'{]+/, $.expression_tag)), "'"),
			),

		spread_attribute: ($) => seq("{{", "...", $._expression, "}}"),

		// component
		component: ($) =>
			choice(
				seq("<", $.component_name, repeat($.attribute), "/>"),
				seq(
					"<",
					$.component_name,
					repeat($.attribute),
					">",
					repeat($._node),
					"</",
					$.component_name,
					">",
				),
			),
		component_name: () => /[A-Z][\w]*/,

		// ---- TAGS ----
		tag: ($) =>
			choice(
				$.expression_tag,
				$.if_tag,
				$.for_tag,
				$.key_tag,
				$.snippet_tag,
				$.set_tag,
				$.import_tag,
				$.html_tag,
				$.render_tag,
			),

		else_block: ($) => seq("{", "%", "else", "%", "}", repeat($._node)),

		// if tag
		if_tag: ($) =>
			seq(
				$.if_start,
				repeat($._node),
				repeat($.elseif_block),
				optional($.else_block),
				$.if_end,
			),

		if_start: ($) => seq("{", "%", "if", $._expression, "%", "}"),

		elseif_block: ($) =>
			seq("{", "%", "elseif", $._expression, "%", "}", repeat($._node)),

		if_end: () => seq("{", "%", "endif", "%", "}"),

		// for tag
		for_tag: ($) =>
			seq(
				$.for_start,
				repeat($._node),
				optional($.else_block),
				$.for_end,
			),

		for_start: ($) =>
			seq(
				"{",
				"%",
				"for",
				$.identifier,
				"in",
				$._expression,
				optional(seq("#", "(", $._expression, ")")),
				"%",
				"}",
			),

		for_end: () => seq("{", "%", "endfor", "%", "}"),

		// key tag
		key_tag: ($) => seq($.key_start, repeat($._node), $.key_end),

		key_start: ($) => seq("{", "%", "key", $._expression, "%", "}"),

		key_end: () => seq("{", "%", "endkey", "%", "}"),

		// snippet tag
		snippet_tag: ($) =>
			seq($.snippet_start, repeat($._node), $.snippet_end),

		snippet_start: ($) =>
			seq(
				"{",
				"%",
				"snippet",
				field("name", $.identifier),
				"(",
				commaSep(optional($.identifier)),
				")",
				"%",
				"}",
			),

		snippet_end: () => seq("{", "%", "endsnippet", "%", "}"),

		// set tag
		set_tag: ($) => seq("{", "%", "set", $.assignment_expression, "%", "}"),

		import_tag: ($) =>
			seq(
				"{",
				"%",
				"import",
				$.identifier,
				"from",
				$.string_literal,
				"%",
				"}",
			),

		// html tag
		html_tag: ($) => seq("{{", "@", "html", $._expression, "}}"),
		// render tag
		render_tag: ($) => seq("{{", "@", "render", $.call_expression, "}}"),

		expression_tag: ($) => seq("{{", $._expression, "}}"),

		// ---- EXPRESSIONS ----

		_expression: ($) =>
			choice(
				$.member_expression,
				$.binary_expression,
				$.unary_expression,
				$.object,
				$.array,
				$.ternary_expression,
				$.filter_expression,
				$.call_expression,
				$.arrow_expression,
				$.numeric_literal,
				$.boolean_literal,
				$.string_literal,
				$.null_literal,
				$.identifier,
				$.parenthezied_expression,
				$.assignment_expression,
			),

		unary_expression: ($) =>
			prec.left(0, seq(choice("not", "-", "+"), $._expression)),

		binary_expression: ($) =>
			choice(
				prec.left(
					4,
					seq($._expression, field("operator", ">"), $._expression),
				),
				prec.left(
					4,
					seq($._expression, field("operator", "<"), $._expression),
				),
				prec.left(
					4,
					seq($._expression, field("operator", "<="), $._expression),
				),
				prec.left(
					4,
					seq($._expression, field("operator", ">="), $._expression),
				),
				prec.left(
					4,
					seq($._expression, field("operator", "=="), $._expression),
				),
				prec.left(
					4,
					seq($._expression, field("operator", "!="), $._expression),
				),

				prec.left(
					3,
					seq($._expression, field("operator", "and"), $._expression),
				),
				prec.left(
					3,
					seq($._expression, field("operator", "??"), $._expression),
				),
				prec.left(
					3,
					seq($._expression, field("operator", "in"), $._expression),
				),
				prec.left(
					3,
					seq($._expression, field("operator", "is"), $._expression),
				),
				prec.left(
					3,
					seq($._expression, field("operator", "or"), $._expression),
				),
				prec.left(
					3,
					seq($._expression, field("operator", "||"), $._expression),
				),

				prec.left(
					2,
					seq($._expression, field("operator", "~"), $._expression),
				),
				prec.left(
					2,
					seq($._expression, field("operator", "*"), $._expression),
				),
				prec.left(
					2,
					seq($._expression, field("operator", "/"), $._expression),
				),

				prec.left(
					1,
					seq($._expression, field("operator", "-"), $._expression),
				),
				prec.left(
					1,
					seq($._expression, field("operator", "+"), $._expression),
				),
			),

		ternary_expression: ($) =>
			prec.right(
				8,
				seq(
					field("condition", $._expression),
					"?",
					field("consequence", $._expression),
					":",
					field("alternative", $._expression),
				),
			),

		arrow_expression: ($) =>
			prec(
				10,
				seq(choice($.arguments, $.identifier), "=>", $._expression),
			),

		member_expression: ($) =>
			prec(
				7,
				seq(
					field("object", $._expression),
					optional("?"),
					".",
					field("property", $.identifier),
				),
			),

		filter_expression: ($) =>
			prec.left(
				11,
				seq(
					$._expression,
					"|",
					field("callee", $.identifier),
					optional($.arguments),
				),
			),

		array: ($) => seq("[", commaSep(optional($._expression)), "]"),

		object: ($) => prec.left(seq("{", commaSep(optional($.pair)), "}")),

		pair: ($) =>
			seq(
				field("key", $._property_name),
				":",
				field("value", $._expression),
			),

		parenthezied_expression: ($) => seq("(", $._expression, ")"),

		assignment_expression: ($) =>
			prec.right(
				seq(
					choice($.identifier, $.member_expression),
					choice("=", "+=", "-=", "/=", "*=", "~="),
					$._expression,
				),
			),

		_property_name: ($) =>
			choice($.identifier, $.numeric_literal, $.string_literal),

		call_expression: ($) =>
			prec(
				11,
				seq(
					field("callee", $._expression),
					field("arguments", $.arguments),
				),
			),

		identifier: () => /[a-zA-Z_\$][\w]*/,

		string_literal: () =>
			choice(seq('"', /[^"]*/, '"'), seq("'", /[^']*/, "'")),

		numeric_literal: () => /([0-9]*\.)?[0-9]+/,

		boolean_literal: () => choice("true", "false"),

		null_literal: () => "null",

		arguments: ($) => seq("(", commaSep(optional($._expression)), ")"),
	},
});

/**
 * Creates a rule to match one or more of the rules separated by a comma
 *
 * @param {Rule} rule
 *
 * @return {SeqRule}
 *
 */
function commaSep1(rule) {
	return seq(rule, repeat(seq(",", rule)));
}

/**
 * Creates a rule to optionally match one or more of the rules separated by a comma
 *
 * @param {Rule} rule
 *
 * @return {ChoiceRule}
 *
 */
function commaSep(rule) {
	return optional(commaSep1(rule));
}
