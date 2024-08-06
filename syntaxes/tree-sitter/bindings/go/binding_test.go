package tree_sitter_zvelte_test

import (
	"testing"

	tree_sitter "github.com/smacker/go-tree-sitter"
	"github.com/tree-sitter/tree-sitter-zvelte"
)

func TestCanLoadGrammar(t *testing.T) {
	language := tree_sitter.NewLanguage(tree_sitter_zvelte.Language())
	if language == nil {
		t.Errorf("Error loading Zvelte grammar")
	}
}
