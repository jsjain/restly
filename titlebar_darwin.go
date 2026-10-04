package main

/*
#cgo CFLAGS: -x objective-c
#cgo LDFLAGS: -framework Cocoa
#import <Cocoa/Cocoa.h>

// The hidden-inset title bar uses the regular unified toolbar, which centers the traffic lights
// in a 52pt row. The compact style centers them in a 38pt row, matching the webview's top bar.
static void compactTitleBar(void) {
	dispatch_async(dispatch_get_main_queue(), ^{
		if (@available(macOS 11.0, *)) {
			for (NSWindow *window in [NSApp windows]) {
				window.toolbarStyle = NSWindowToolbarStyleUnifiedCompact;
			}
		}
	});
}
*/
import "C"

func compactTitleBar() { C.compactTitleBar() }
