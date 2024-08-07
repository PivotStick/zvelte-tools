[
    (identifier)
    (attribute_name)
] @variable

((identifier) @type
  (#lua-match? @type "^[A-Z]"))

(component_name) @type

[
    (attribute_value)
    (string_literal)
] @string

(numeric_literal) @number

(null_literal) @keyword

[
    "true"
    "false"
] @boolean

(filter_expression
    callee: (identifier) @function)

(snippet_start
  name: (identifier) @function)

(call_expression
  callee: (member_expression
    property: (identifier) @function.method))

(call_expression
  callee: (identifier) @function.method)

(regular_element_name) @tag

[
    "<"
    "</"
    ">"
    "/>"
    "{"
    "}"
    "{{"
    "}}"
    "%"
] @tag.delimiter

[
    "import"
    "from"
] @keyword.import

[
    "if"
    "endif"
    "else"
    "elseif"
] @keyword.conditional

[
    "snippet"
    "endsnippet"

    "key"
    "endkey"
] @keyword.conditional

[
 "for"
 "endfor"
] @keyword.repeat

(for_start
  "in" @keyword.repeat)

[
  "."
  "?"
  ","
  ":"
  "|"
  "@"
] @punctuation.delimiter

(ternary_expression
    [
        "?"
        ":"
    ] @keyword.conditional)

[
    "("
    ")"
    "["
    "]"
] @punctuation.bracket

[
  "-"
  "-="
  "+"
  "+="
  "~"
  "~="
  "/="
  "<="
  "="
  "=="
  "!="
  "=>"
  ">="
  "||"
  "*"
  "??"
  "*="
  "..."
] @operator

(binary_expression
    [
        "<"
        ">"
    ] @operator)

(object
    [
        "{"
        "}"
    ] @punctuation.bracket)

[
    "in"
    "not"
    "and"
    "or"
    "is"
    "render"
    "html"
] @keyword
