package usecase

// UpdateBasePersona defines the interface for pushing the configured base persona
// (the system prompt appended to spawned sessions) to the process layer so it is
// applied to the next session started, without a restart.
type UpdateBasePersona interface {
	UpdateBasePersona(basePersona string)
}
