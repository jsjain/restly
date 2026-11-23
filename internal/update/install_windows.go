package update

import (
	"os/exec"
	"syscall"
)

// setCmdLine bypasses Go's argument quoting, which cmd does not understand.
func setCmdLine(cmd *exec.Cmd, line string) {
	cmd.SysProcAttr = &syscall.SysProcAttr{CmdLine: line}
}
