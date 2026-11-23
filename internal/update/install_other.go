//go:build !windows

package update

import "os/exec"

// setCmdLine does nothing off Windows: only a KindWindowsSetup target reaches it, and the cmd
// binary it starts does not exist there, so Start fails with a clear error.
func setCmdLine(_ *exec.Cmd, _ string) {}
