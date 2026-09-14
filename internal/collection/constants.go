package collection

// SchemaV21 is the info.schema of a v2.1 collection. Saves always write it.
const SchemaV21 = "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"

// Kinds returned by DetectKind.
const (
	KindCollection  = "collection"
	KindEnvironment = "environment"
)

// Postman cannot export WebSocket requests, so Restly marks its own with this item member.
const (
	TypeKey       = "x-restly-type"
	TypeWebSocket = "websocket"
)
