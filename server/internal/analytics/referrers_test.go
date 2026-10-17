package analytics

import "testing"

func TestClassifyReferrer(t *testing.T) {
	cases := map[string][2]string{
		"www.google.com":      {"Google", "search"},
		"google.co.uk":        {"Google", "search"},
		"www.google.com.br":   {"Google", "search"},
		"accounts.google.com": {"", ""}, // OAuth sign-in, not search
		"mail.google.com":     {"", ""},
		"gemini.google.com":   {"Gemini", "llm"},
		"chatgpt.com":         {"ChatGPT", "llm"},
		"search.yahoo.com":    {"Yahoo", "search"},
		"cn.bing.com":         {"Bing", "search"},
		"x.com":               {"X / Twitter", "social"},
		"netflix.com":         {"", ""}, // used to match "x.com"
		"bit.co.uk":           {"", ""}, // used to match "t.co"
		"something-you.com":   {"", ""}, // used to match "you.com"
		"deployzy.com":        {"", ""},
		"yandex.ru":           {"Yandex", "search"},
	}
	for host, want := range cases {
		src, ch := ClassifyReferrer(host)
		if src != want[0] || ch != want[1] {
			t.Errorf("ClassifyReferrer(%q) = (%q,%q), want (%q,%q)", host, src, ch, want[0], want[1])
		}
	}
}
