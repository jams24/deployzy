//go:build windows

package deploy

import "os"

// statInode has no inode concept on Windows — rotation detection falls back to
// size-based cursor handling. The server only runs on Linux in production.
func statInode(fi os.FileInfo) int64 { return 0 }
