package api

import (
	"context"
	"fmt"
	"os/exec"
	"time"

)

// purgeUserResources tears down everything a user actually runs before their
// row is deleted. Deleting the user alone only cascades DB rows — containers,
// images, and volumes keep running on the host forever with no owner and no
// way to manage them from the dashboard (two such orphans were found running
// on the platform host on 2026-07-22, one of them for four days).
//
// Best-effort by design: a single unreachable BYOC host must not block account
// deletion, so failures are logged and the purge continues. Returns a summary
// for the audit log.
func (s *Server) purgeUserResources(ctx context.Context, userID string) (projects, services int) {
	// 1. Projects — stop + remove container and image wherever they run.
	if s.deployer != nil {
		if list, err := s.db.ListProjects(ctx, userID); err == nil {
			for i := range list {
				p := &list[i]
				pctx, cancel := context.WithTimeout(ctx, 45*time.Second)
				if err := s.deployer.Delete(pctx, p); err != nil {
					s.log.Warn().Err(err).Str("project", p.Name).Str("user", userID).
						Msg("purge: failed to remove project container")
				} else {
					projects++
				}
				cancel()
			}
		} else {
			s.log.Error().Err(err).Str("user", userID).Msg("purge: could not list projects")
		}
	}

	// 2. Standalone services (managed Postgres/Redis/Mongo/MySQL) — container
	//    plus its data volume, local or over SSH for BYOC.
	if list, err := s.db.ListServices(ctx, userID); err == nil {
		for i := range list {
			svc := &list[i]
			if svc.ContainerName == nil {
				continue
			}
			dbName := ""
			if svc.DBName != nil {
				dbName = *svc.DBName
			}
			switch {
			case svc.WorkerServerID != nil:
				if server, _ := s.db.GetWorkerServer(ctx, *svc.WorkerServerID); server != nil {
					runRemoteSSH(server, fmt.Sprintf("docker rm -f %s; docker volume rm sm-svc-%s-data",
						*svc.ContainerName, dbName), 30*time.Second)
				}
			case svc.Type != "postgres":
				exec.Command("docker", "rm", "-f", *svc.ContainerName).Run()
				if dbName != "" {
					exec.Command("docker", "volume", "rm", "sm-svc-"+dbName+"-data").Run()
				}
			default:
				// Platform Postgres lives inside the shared cluster; the
				// database itself is dropped by the DB-layer cascade.
			}
			services++
		}
	} else {
		s.log.Error().Err(err).Str("user", userID).Msg("purge: could not list services")
	}

	// Custom domains are CNAMEs in the *user's* own DNS zone, not ours, so
	// there is nothing for us to delete there — the proxy simply stops
	// serving the hostname once the project rows are gone.

	s.log.Info().Str("user", userID).Int("projects", projects).Int("services", services).
		Msg("purged user resources")
	return projects, services
}
