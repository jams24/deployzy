package deploy

import "context"

// Host paths. Everything lives under /opt/deployzy. Hosts provisioned before
// the rename keep their data in /opt/serverme; ensureDataRoot links
// /opt/deployzy to it there (no data is moved, running containers are
// untouched), and on the primary /opt/serverme is itself a link to
// /opt/deployzy. Either way both names resolve to the same directory.
const (
	DataRoot     = "/opt/deployzy"
	BuildTmpRoot = "/tmp/deployzy-build"
	legacyRoot   = "/opt/serverme"
)

// ensureDataRoot makes DataRoot exist on the runner's host: a symlink to the
// legacy tree when only that exists, otherwise a real directory. Idempotent
// and cheap (one shell round-trip).
func ensureDataRoot(ctx context.Context, r *Runner) {
	_, _ = r.RunShell(ctx, `if [ ! -e `+DataRoot+` ] && [ -d `+legacyRoot+` ]; then ln -s `+legacyRoot+` `+DataRoot+`; fi; mkdir -p `+DataRoot+`/project-data`)
}
