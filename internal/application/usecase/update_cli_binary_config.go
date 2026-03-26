package usecase

// UpdateCliBinaryConfig defines the interface for pushing CLI binary config to the process layer.
type UpdateCliBinaryConfig interface {
	UpdateCliBinaryConfig(cliBinaryPath string, commandOverrides map[string]string)
}
