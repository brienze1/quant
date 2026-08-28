package service

import (
	"errors"
	"testing"

	"quant/internal/domain/entity"
)

type spyNotifier struct {
	calls int
}

func (s *spyNotifier) SendNotification(string, string) error {
	s.calls++
	return nil
}

// TestSendNotificationRespectsSetting verifies the desktop-notification switch
// is enforced in the service, so it holds no matter which caller asks.
func TestSendNotificationRespectsSetting(t *testing.T) {
	cases := []struct {
		name      string
		enabled   bool
		wantCalls int
	}{
		{name: "enabled sends", enabled: true, wantCalls: 1},
		{name: "disabled stays quiet", enabled: false, wantCalls: 0},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			cfg := entity.NewDefaultConfig()
			cfg.SystemNotifications = tc.enabled
			notifier := &spyNotifier{}
			s := &configManagerService{
				loadConfig:       stubLoadConfig{cfg: &cfg},
				sendNotification: notifier,
			}

			if err := s.SendNotification("quant", "done"); err != nil {
				t.Fatalf("SendNotification: %v", err)
			}
			if notifier.calls != tc.wantCalls {
				t.Errorf("notifier calls: got %d want %d", notifier.calls, tc.wantCalls)
			}
		})
	}
}

// TestSendNotificationConfigError surfaces a config read failure instead of
// silently notifying.
func TestSendNotificationConfigError(t *testing.T) {
	notifier := &spyNotifier{}
	s := &configManagerService{
		loadConfig:       stubLoadConfig{err: errors.New("boom")},
		sendNotification: notifier,
	}

	if err := s.SendNotification("quant", "done"); err == nil {
		t.Fatal("expected an error when the config cannot be read")
	}
	if notifier.calls != 0 {
		t.Errorf("notifier called %d times despite the config error", notifier.calls)
	}
}

// TestDefaultConfigEnablesSystemNotifications pins the default so upgrading
// users keep the behaviour they had before the switch existed.
func TestDefaultConfigEnablesSystemNotifications(t *testing.T) {
	if !entity.NewDefaultConfig().SystemNotifications {
		t.Error("system notifications should default to on")
	}
}
