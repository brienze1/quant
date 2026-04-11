package entity

// ChangelogEntry represents a single version entry in the changelog.
type ChangelogEntry struct {
	Version string                `json:"version"`
	Date    string                `json:"date"`
	Changes map[string][]string   `json:"changes"`
}

// Changelog holds the full changelog data.
type Changelog struct {
	Entries []ChangelogEntry `json:"entries"`
}
