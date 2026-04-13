// Package entity contains domain entities representing core business objects.
package entity

// JobTrigger represents a trigger chain between two jobs.
// When SourceJobID completes with the specified outcome, TargetJobID is executed.
type JobTrigger struct {
	ID           string
	SourceJobID  string // the job whose completion fires the trigger
	TargetJobID  string // the job to run
	TriggerOn    string // "success" | "failure" | "custom"
	CustomPrompt string // per-trigger evaluation prompt, only used when TriggerOn == "custom"
}

// CustomTriggerRef is used in create/update requests to specify a custom trigger target and its prompt.
type CustomTriggerRef struct {
	TargetJobID  string `json:"targetJobId"`
	CustomPrompt string `json:"customPrompt"`
}
