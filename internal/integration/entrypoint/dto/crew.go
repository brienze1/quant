// Package dto contains data transfer objects for the entrypoint layer.
package dto

import (
	"time"

	"quant/internal/domain/entity"
)

// CrewAssignmentResponse represents the response payload for a single crew assignment.
type CrewAssignmentResponse struct {
	WorkerSessionID     string `json:"workerSessionId"`
	SupervisorSessionID string `json:"supervisorSessionId"`
	CreatedAt           string `json:"createdAt"`
}

// CrewAssignmentResponseFromEntity converts a domain entity to a CrewAssignmentResponse DTO.
func CrewAssignmentResponseFromEntity(a entity.CrewAssignment) CrewAssignmentResponse {
	return CrewAssignmentResponse{
		WorkerSessionID:     a.WorkerSessionID,
		SupervisorSessionID: a.SupervisorSessionID,
		CreatedAt:           a.CreatedAt.Format(time.RFC3339),
	}
}

// CrewAssignmentResponseListFromEntities converts a slice of domain entities to a slice of CrewAssignmentResponse DTOs.
func CrewAssignmentResponseListFromEntities(assignments []entity.CrewAssignment) []CrewAssignmentResponse {
	responses := make([]CrewAssignmentResponse, len(assignments))
	for i, assignment := range assignments {
		responses[i] = CrewAssignmentResponseFromEntity(assignment)
	}
	return responses
}

// CrewEnvelopeResponse represents the response payload for a single crew envelope.
type CrewEnvelopeResponse struct {
	ID            string `json:"id"`
	FromSessionID string `json:"fromSessionId"`
	ToSessionID   string `json:"toSessionId"`
	Type          string `json:"type"`
	Summary       string `json:"summary"`
	Status        string `json:"status"`
	CreatedAt     string `json:"createdAt"`
	DeliveredAt   string `json:"deliveredAt"`
}

// CrewEnvelopeResponseFromEntity converts a domain entity to a CrewEnvelopeResponse DTO.
func CrewEnvelopeResponseFromEntity(e entity.CrewEnvelope) CrewEnvelopeResponse {
	deliveredAt := ""
	if e.DeliveredAt != nil {
		deliveredAt = e.DeliveredAt.Format(time.RFC3339)
	}

	return CrewEnvelopeResponse{
		ID:            e.ID,
		FromSessionID: e.FromSessionID,
		ToSessionID:   e.ToSessionID,
		Type:          e.Type,
		Summary:       e.Summary,
		Status:        e.Status,
		CreatedAt:     e.CreatedAt.Format(time.RFC3339),
		DeliveredAt:   deliveredAt,
	}
}

// CrewEnvelopeResponseListFromEntities converts a slice of domain entities to a slice of CrewEnvelopeResponse DTOs.
func CrewEnvelopeResponseListFromEntities(envelopes []entity.CrewEnvelope) []CrewEnvelopeResponse {
	responses := make([]CrewEnvelopeResponse, len(envelopes))
	for i, envelope := range envelopes {
		responses[i] = CrewEnvelopeResponseFromEntity(envelope)
	}
	return responses
}
