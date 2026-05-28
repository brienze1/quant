// Package service contains application service implementations with business logic.
package service

import (
	"fmt"
	"sync"
	"time"

	"github.com/robfig/cron/v3"

	"quant/internal/application/adapter"
	"quant/internal/application/usecase"
	"quant/internal/domain/enums/scheduletype"
)

// jobScheduler runs scheduled jobs based on their cron expressions or intervals.
type jobScheduler struct {
	findJob    usecase.FindJob
	jobManager adapter.JobManager
	updateJob  usecase.UpdateJob

	mu      sync.Mutex
	running bool
	stop    chan struct{}
}

// NewJobScheduler creates a new scheduler that checks for due jobs periodically.
func NewJobScheduler(
	findJob usecase.FindJob,
	jobManager adapter.JobManager,
	updateJob usecase.UpdateJob,
) adapter.JobScheduler {
	return &jobScheduler{
		findJob:    findJob,
		jobManager: jobManager,
		updateJob:  updateJob,
	}
}

// Start begins the scheduler loop. It checks every 30 seconds for jobs that are due.
func (s *jobScheduler) Start() {
	s.mu.Lock()
	if s.running {
		s.mu.Unlock()
		return
	}
	s.running = true
	s.stop = make(chan struct{})
	s.mu.Unlock()

	go s.loop()
}

// Stop halts the scheduler loop.
func (s *jobScheduler) Stop() {
	s.mu.Lock()
	defer s.mu.Unlock()

	if !s.running {
		return
	}
	s.running = false
	close(s.stop)
}

// loop is the main scheduler goroutine.
func (s *jobScheduler) loop() {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	// Run once immediately on startup
	s.checkAndRunDueJobs()

	for {
		select {
		case <-ticker.C:
			s.checkAndRunDueJobs()
		case <-s.stop:
			return
		}
	}
}

// checkAndRunDueJobs finds all scheduled jobs and runs any that are due.
func (s *jobScheduler) checkAndRunDueJobs() {
	jobs, err := s.findJob.FindScheduledJobs()
	if err != nil {
		fmt.Printf("scheduler: failed to find scheduled jobs: %v\n", err)
		return
	}

	now := time.Now()

	for _, job := range jobs {
		if !job.ScheduleEnabled {
			continue
		}

		// Check if the job's start time has arrived (if set)
		if job.ScheduleStartTime != nil && now.Before(*job.ScheduleStartTime) {
			continue
		}

		isDue := false

		if job.CronExpression != "" {
			isDue = s.isCronDue(job.CronExpression, job.LastRunAt, now)
		} else if job.ScheduleInterval > 0 {
			isDue = s.isIntervalDue(job.ScheduleInterval, job.LastRunAt, now)
		}

		if !isDue {
			continue
		}

		// For one-time jobs, disable the schedule after triggering
		if job.ScheduleType == scheduletype.OneTime {
			job.ScheduleEnabled = false
			_ = s.updateJob.UpdateJob(job)
		}

		fmt.Printf("scheduler: running job %s (%s)\n", job.Name, job.ID)
		_, err := s.jobManager.RunJob(job.ID, "", nil)
		if err != nil {
			fmt.Printf("scheduler: failed to run job %s: %v\n", job.Name, err)
		}
	}
}

// isCronDue checks if a job should run based on its cron expression.
func (s *jobScheduler) isCronDue(expr string, lastRunAt *time.Time, now time.Time) bool {
	parser := cron.NewParser(cron.Minute | cron.Hour | cron.Dom | cron.Month | cron.Dow)
	schedule, err := parser.Parse(expr)
	if err != nil {
		fmt.Printf("scheduler: invalid cron expression %q: %v\n", expr, err)
		return false
	}

	var lastRun time.Time
	if lastRunAt != nil {
		lastRun = *lastRunAt
	} else {
		// Never run before — use a time in the past so the next scheduled time is calculated
		lastRun = now.Add(-24 * time.Hour)
	}

	nextRun := schedule.Next(lastRun)
	return !nextRun.After(now)
}

// isIntervalDue checks if enough time has passed since the last run.
func (s *jobScheduler) isIntervalDue(intervalMinutes int, lastRunAt *time.Time, now time.Time) bool {
	if lastRunAt == nil {
		return true // Never run before
	}

	interval := time.Duration(intervalMinutes) * time.Minute
	return now.Sub(*lastRunAt) >= interval
}
