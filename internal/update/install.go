package update

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
)

// Install replaces the running copy described by target with the downloaded file. When relaunch is
// set, the new version is started afterwards. A failed install leaves the old version in place.
func Install(ctx context.Context, target Target, file string, relaunch bool) error {
	switch target.Kind {
	case KindMacApp:
		return installMacApp(ctx, target, file, relaunch)
	case KindWindowsSetup:
		return installWindowsSetup(ctx, target, file, relaunch)
	case KindWindowsPortable:
		return installBinary(ctx, target, file, relaunch, writeFileAsBinary)
	case KindLinuxTar:
		return installBinary(ctx, target, file, relaunch, writeTarBinary)
	default:
		return fmt.Errorf("%w: %s", ErrNoticeOnly, target.Path)
	}
}

// Relaunch starts the installed copy again. It is the fallback when an install after "Restart to
// update" fails, so the user is not left with Restly closed.
func Relaunch(ctx context.Context, target Target) error {
	if target.Kind == KindMacApp {
		return run(ctx, "open", "-n", target.Path)
	}
	return startDetached(ctx, target.Path)
}

// Cleanup removes the previous version left by the last swap.
func Cleanup(target Target) {
	if target.Kind == KindNoticeOnly {
		return
	}
	// A failure here only leaves a stale file that the next start tries again.
	_ = os.RemoveAll(target.Path + oldSuffix)
}

func installMacApp(ctx context.Context, target Target, dmg string, relaunch bool) (err error) {
	mountPoint, err := os.MkdirTemp("", "restly-mount-")
	if err != nil {
		return fmt.Errorf("failed to create mount point: %w", err)
	}
	defer os.Remove(mountPoint)

	if err = run(ctx, "hdiutil", "attach", "-nobrowse", "-readonly", "-noautoopen", "-mountpoint", mountPoint, dmg); err != nil {
		return err
	}
	defer func() {
		if detachErr := detach(context.WithoutCancel(ctx), mountPoint); detachErr != nil {
			err = errors.Join(err, detachErr)
		}
	}()

	staged := target.Path + newSuffix
	if err = os.RemoveAll(staged); err != nil {
		return fmt.Errorf("failed to clear %s: %w", staged, err)
	}
	if err = run(ctx, "ditto", filepath.Join(mountPoint, macBundleName), staged); err != nil {
		os.RemoveAll(staged)
		return err
	}
	if err = swap(target.Path, staged); err != nil {
		os.RemoveAll(staged)
		return err
	}
	// The old bundle is removed now; if that fails Cleanup retries at the next start.
	_ = os.RemoveAll(target.Path + oldSuffix)

	if relaunch {
		return run(ctx, "open", "-n", target.Path)
	}
	return nil
}

func detach(ctx context.Context, mountPoint string) error {
	if err := run(ctx, "hdiutil", "detach", mountPoint); err != nil {
		return run(ctx, "hdiutil", "detach", "-force", mountPoint)
	}
	return nil
}

func installWindowsSetup(ctx context.Context, target Target, setup string, relaunch bool) error {
	cmd := exec.CommandContext(context.WithoutCancel(ctx), "cmd")
	setCmdLine(cmd, windowsSetupCmdLine(setup, target.Path, relaunch))
	return startCommand(cmd)
}

// installBinary stages the new executable beside the old one, swaps them, and starts the new one.
func installBinary(ctx context.Context, target Target, file string, relaunch bool, stage func(dst, src string) error) error {
	staged := target.Path + newSuffix
	if err := stage(staged, file); err != nil {
		return err
	}
	if err := swap(target.Path, staged); err != nil {
		os.Remove(staged)
		return err
	}
	if relaunch {
		return startDetached(ctx, target.Path)
	}
	return nil
}
