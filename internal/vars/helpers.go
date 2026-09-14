package vars

import (
	"crypto/rand"
	"fmt"
	mathrand "math/rand/v2"
	"strconv"
	"time"
)

// dynamic returns Postman dynamic variables. Only the common ones are supported.
func dynamic(name string) (string, bool) {
	switch name {
	case "$guid", "$randomUUID":
		return UUID(), true
	case "$timestamp":
		return strconv.FormatInt(time.Now().Unix(), 10), true
	case "$isoTimestamp":
		return time.Now().UTC().Format("2006-01-02T15:04:05.000Z"), true
	case "$randomInt":
		return strconv.Itoa(mathrand.IntN(1001)), true
	}
	return "", false
}

// UUID returns a random version 4 UUID.
func UUID() string {
	var bits [16]byte
	_, _ = rand.Read(bits[:]) // crypto/rand.Read never returns an error
	bits[6] = bits[6]&0x0f | 0x40
	bits[8] = bits[8]&0x3f | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", bits[0:4], bits[4:6], bits[6:8], bits[8:10], bits[10:])
}
