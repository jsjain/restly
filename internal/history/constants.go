package history

const (
	fileMode = 0o600

	// maxScanLineBytes lets bufio.Scanner read a long line instead of failing with "token too long".
	maxScanLineBytes = 4 << 20 // 4 MB

	// maxStoredLineBytes is the largest encoded entry kept whole; past this, Add drops the request body.
	maxStoredLineBytes = 1 << 20 // 1 MB

	// compactionFactor rewrites the file once it holds more than this many times limit lines.
	compactionFactor = 2

	droppedBodyNotice = "body was not kept because it was over 1 MB"
)
