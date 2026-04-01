package usecase

// DeleteAgent defines the interface for deleting an agent.
type DeleteAgent interface {
	DeleteAgent(id string) error
}
