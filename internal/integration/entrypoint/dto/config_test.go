package dto

import (
	"testing"

	"quant/internal/domain/entity"
)

// TestVoiceConfigDTOLanguageRoundTrip verifies the voice Language field survives
// both the entity→DTO (ConfigResponseFromEntity) and DTO→entity (ToEntity)
// conversions.
func TestVoiceConfigDTOLanguageRoundTrip(t *testing.T) {
	cfg := entity.Config{
		Voice: entity.VoiceConfig{Language: "pt-br"},
	}

	// entity → response DTO
	resp := ConfigResponseFromEntity(cfg)
	if resp.Voice.Language != "pt-br" {
		t.Fatalf("ConfigResponseFromEntity dropped Language: %q", resp.Voice.Language)
	}

	// request DTO → entity
	req := SaveConfigRequest{Voice: VoiceConfigDTO{Language: "pt-br"}}
	got := req.ToEntity()
	if got.Voice.Language != "pt-br" {
		t.Fatalf("SaveConfigRequest.ToEntity dropped Language: %q", got.Voice.Language)
	}
}
