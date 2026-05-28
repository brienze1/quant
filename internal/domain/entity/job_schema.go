package entity

// JobInputSpec declares one expected input for a job.
//
// Type values: "string" | "number" | "boolean" | "object" | "array".
// Validation against an inbound payload happens in the pre-run gate
// (internal/application/service/job_manager.go, executeWithRetries).
type JobInputSpec struct {
	Key      string `json:"key"`
	Type     string `json:"type"`
	Required bool   `json:"required"`
}

// JobOutputSpec declares one output the job is expected to emit
// (sentinel block or LLM eval) OR pass through verbatim from inbound.
//
// Source values:
//   - "produced"    : value must appear in the job's <quant-output>{...} block
//     or be returned by the legacy LLM eval fallback.
//   - "passthrough" : value is copied verbatim from inbound_metadata into the
//     run's metadata; any value the job emits for this key is
//     silently dropped.
type JobOutputSpec struct {
	Key    string `json:"key"`
	Type   string `json:"type"`
	Source string `json:"source"`
}
