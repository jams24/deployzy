//go:build !windows

package deploy

import (
	"os"
	"syscall"
)

// statInode returns the Unix inode of a file, used to detect log rotation
// (a new file at the same path gets a different inode). 0 when unavailable.
func statInode(fi os.FileInfo) int64 {
	if st, ok := fi.Sys().(*syscall.Stat_t); ok {
		return int64(st.Ino)
	}
	return 0
}
