package api

import (
	_ "embed"
	"encoding/json"
	"sort"
	"strings"
)

// Deployzy docs, extracted from web/src/lib/docs.ts at build time and embedded so
// the agent can answer "how do I…" grounded in the real documentation instead of
// guessing. Regenerate by re-running the extraction if the docs change.
//
//go:embed aiassets/docs.json
var docsJSON []byte

type docPage struct {
	Slug        string `json:"slug"`
	Title       string `json:"title"`
	Description string `json:"description"`
	Category    string `json:"category"`
	Content     string `json:"content"`
}

var docsIndex []docPage

func loadDocs() []docPage {
	if docsIndex == nil {
		_ = json.Unmarshal(docsJSON, &docsIndex)
	}
	return docsIndex
}

// searchDocs returns the top-matching doc pages for a query, as a compact string
// the model can read. Simple keyword scoring (title matches weighted heavily) —
// no embedding infra needed, deterministic, and plenty for 24 pages.
func searchDocs(query string, limit int) string {
	pages := loadDocs()
	terms := tokenize(query)
	if len(terms) == 0 {
		return `{"results":[],"note":"empty query"}`
	}
	type scored struct {
		p     docPage
		score int
	}
	var ranked []scored
	for _, p := range pages {
		titleL := strings.ToLower(p.Title + " " + p.Slug + " " + p.Description)
		bodyL := strings.ToLower(p.Content)
		s := 0
		for _, t := range terms {
			if strings.Contains(titleL, t) {
				s += 5
			}
			s += strings.Count(bodyL, t)
		}
		if s > 0 {
			ranked = append(ranked, scored{p, s})
		}
	}
	sort.Slice(ranked, func(i, j int) bool { return ranked[i].score > ranked[j].score })
	if limit <= 0 {
		limit = 3
	}
	if len(ranked) > limit {
		ranked = ranked[:limit]
	}

	results := []map[string]string{}
	for _, r := range ranked {
		body := r.p.Content
		if len(body) > 1400 { // keep the tool result compact
			body = body[:1400] + "…"
		}
		results = append(results, map[string]string{
			"title":   r.p.Title,
			"url":     "https://deployzy.com/docs/" + r.p.Slug,
			"content": body,
		})
	}
	out, _ := json.Marshal(map[string]any{"results": results, "count": len(results)})
	return string(out)
}

var stopWords = map[string]bool{
	"the": true, "a": true, "an": true, "how": true, "do": true, "i": true, "to": true,
	"is": true, "in": true, "on": true, "of": true, "for": true, "my": true, "can": true,
	"what": true, "and": true, "with": true, "does": true, "it": true, "you": true,
}

func tokenize(s string) []string {
	var out []string
	for _, w := range strings.FieldsFunc(strings.ToLower(s), func(r rune) bool {
		return !(r >= 'a' && r <= 'z') && !(r >= '0' && r <= '9')
	}) {
		if len(w) >= 2 && !stopWords[w] {
			out = append(out, w)
		}
	}
	return out
}
