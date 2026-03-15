package usecase

// ResetDatabase defines the interface for resetting the application database.
type ResetDatabase interface {
	ResetDatabase() error
}
