export namespace collection {
	
	export class Auth {
	    type: string;
	
	    static createFrom(source: any = {}) {
	        return new Auth(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.type = source["type"];
	    }
	}
	export class GraphQL {
	    query: string;
	    variables: string;
	
	    static createFrom(source: any = {}) {
	        return new GraphQL(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.query = source["query"];
	        this.variables = source["variables"];
	    }
	}
	export class BodyFile {
	    src: string;
	
	    static createFrom(source: any = {}) {
	        return new BodyFile(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.src = source["src"];
	    }
	}
	export class KV {
	    key: string;
	    value: string;
	    disabled: boolean;
	    type: string;
	    src: number[];
	
	    static createFrom(source: any = {}) {
	        return new KV(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.key = source["key"];
	        this.value = source["value"];
	        this.disabled = source["disabled"];
	        this.type = source["type"];
	        this.src = source["src"];
	    }
	}
	export class Body {
	    mode: string;
	    raw: string;
	    urlencoded: KV[];
	    formdata: KV[];
	    file?: BodyFile;
	    graphql?: GraphQL;
	
	    static createFrom(source: any = {}) {
	        return new Body(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.mode = source["mode"];
	        this.raw = source["raw"];
	        this.urlencoded = this.convertValues(source["urlencoded"], KV);
	        this.formdata = this.convertValues(source["formdata"], KV);
	        this.file = this.convertValues(source["file"], BodyFile);
	        this.graphql = this.convertValues(source["graphql"], GraphQL);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class EnvValue {
	    key: string;
	    value: string;
	    type: string;
	    enabled: boolean;
	
	    static createFrom(source: any = {}) {
	        return new EnvValue(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.key = source["key"];
	        this.value = source["value"];
	        this.type = source["type"];
	        this.enabled = source["enabled"];
	    }
	}
	export class Environment {
	    id: string;
	    name: string;
	    values: EnvValue[];
	    _postman_variable_scope: string;
	    "x-restly-collection": string;
	
	    static createFrom(source: any = {}) {
	        return new Environment(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.values = this.convertValues(source["values"], EnvValue);
	        this._postman_variable_scope = source["_postman_variable_scope"];
	        this["x-restly-collection"] = source["x-restly-collection"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class Script {
	    type: string;
	    exec: string[];
	
	    static createFrom(source: any = {}) {
	        return new Script(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.type = source["type"];
	        this.exec = source["exec"];
	    }
	}
	export class Event {
	    listen: string;
	    script?: Script;
	    disabled: boolean;
	
	    static createFrom(source: any = {}) {
	        return new Event(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.listen = source["listen"];
	        this.script = this.convertValues(source["script"], Script);
	        this.disabled = source["disabled"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class Variable {
	    key: string;
	    value: string;
	    type: string;
	    disabled: boolean;
	
	    static createFrom(source: any = {}) {
	        return new Variable(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.key = source["key"];
	        this.value = source["value"];
	        this.type = source["type"];
	        this.disabled = source["disabled"];
	    }
	}
	export class URL {
	    raw: string;
	    query: KV[];
	    variable: KV[];
	
	    static createFrom(source: any = {}) {
	        return new URL(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.raw = source["raw"];
	        this.query = this.convertValues(source["query"], KV);
	        this.variable = this.convertValues(source["variable"], KV);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class Request {
	    method: string;
	    url?: URL;
	    header: KV[];
	    body?: Body;
	    auth?: Auth;
	
	    static createFrom(source: any = {}) {
	        return new Request(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.method = source["method"];
	        this.url = this.convertValues(source["url"], URL);
	        this.header = this.convertValues(source["header"], KV);
	        this.body = this.convertValues(source["body"], Body);
	        this.auth = this.convertValues(source["auth"], Auth);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class Item {
	    name: string;
	    request?: Request;
	    item: Item[];
	    event: Event[];
	    variable: Variable[];
	    auth?: Auth;
	
	    static createFrom(source: any = {}) {
	        return new Item(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.request = this.convertValues(source["request"], Request);
	        this.item = this.convertValues(source["item"], Item);
	        this.event = this.convertValues(source["event"], Event);
	        this.variable = this.convertValues(source["variable"], Variable);
	        this.auth = this.convertValues(source["auth"], Auth);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	
	
	

}

export namespace history {
	
	export class Entry {
	    id: string;
	    time: number;
	    method: string;
	    url: string;
	    code: number;
	    durationMs: number;
	    size: number;
	    error: string;
	    item?: collection.Item;
	
	    static createFrom(source: any = {}) {
	        return new Entry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.time = source["time"];
	        this.method = source["method"];
	        this.url = source["url"];
	        this.code = source["code"];
	        this.durationMs = source["durationMs"];
	        this.size = source["size"];
	        this.error = source["error"];
	        this.item = this.convertValues(source["item"], collection.Item);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace httpx {
	
	export class ClientCert {
	    host: string;
	    certFile: string;
	    keyFile: string;
	
	    static createFrom(source: any = {}) {
	        return new ClientCert(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.host = source["host"];
	        this.certFile = source["certFile"];
	        this.keyFile = source["keyFile"];
	    }
	}
	export class Cookie {
	    name: string;
	    value: string;
	    domain: string;
	    path: string;
	    expires: string;
	    httpOnly: boolean;
	    secure: boolean;
	    hostOnly: boolean;
	
	    static createFrom(source: any = {}) {
	        return new Cookie(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.value = source["value"];
	        this.domain = source["domain"];
	        this.path = source["path"];
	        this.expires = source["expires"];
	        this.httpOnly = source["httpOnly"];
	        this.secure = source["secure"];
	        this.hostOnly = source["hostOnly"];
	    }
	}
	export class Header {
	    key: string;
	    value: string;
	
	    static createFrom(source: any = {}) {
	        return new Header(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.key = source["key"];
	        this.value = source["value"];
	    }
	}
	export class Network {
	    proxyMode: string;
	    proxyUrl: string;
	    proxyBypass: string;
	    verifyTls: boolean;
	    caFile: string;
	    clientCerts: ClientCert[];
	
	    static createFrom(source: any = {}) {
	        return new Network(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.proxyMode = source["proxyMode"];
	        this.proxyUrl = source["proxyUrl"];
	        this.proxyBypass = source["proxyBypass"];
	        this.verifyTls = source["verifyTls"];
	        this.caFile = source["caFile"];
	        this.clientCerts = this.convertValues(source["clientCerts"], ClientCert);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class Timings {
	    dns: number;
	    connect: number;
	    tls: number;
	    firstByte: number;
	    total: number;
	
	    static createFrom(source: any = {}) {
	        return new Timings(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.dns = source["dns"];
	        this.connect = source["connect"];
	        this.tls = source["tls"];
	        this.firstByte = source["firstByte"];
	        this.total = source["total"];
	    }
	}
	export class Response {
	    code: number;
	    status: string;
	    header: Header[];
	    cookies: Cookie[];
	    size: number;
	    timings: Timings;
	
	    static createFrom(source: any = {}) {
	        return new Response(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.code = source["code"];
	        this.status = source["status"];
	        this.header = this.convertValues(source["header"], Header);
	        this.cookies = this.convertValues(source["cookies"], Cookie);
	        this.size = source["size"];
	        this.timings = this.convertValues(source["timings"], Timings);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace main {
	
	export class AppInfo {
	    version: string;
	    commit: string;
	    buildTime: string;
	    goVersion: string;
	
	    static createFrom(source: any = {}) {
	        return new AppInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.version = source["version"];
	        this.commit = source["commit"];
	        this.buildTime = source["buildTime"];
	        this.goVersion = source["goVersion"];
	    }
	}
	export class FileRef {
	    file: string;
	    name: string;
	    collection?: string;
	
	    static createFrom(source: any = {}) {
	        return new FileRef(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.file = source["file"];
	        this.name = source["name"];
	        this.collection = source["collection"];
	    }
	}
	export class RunInput {
	    file: string;
	    path: number[];
	    env: string;
	    iterations: number;
	    delayMs: number;
	
	    static createFrom(source: any = {}) {
	        return new RunInput(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.file = source["file"];
	        this.path = source["path"];
	        this.env = source["env"];
	        this.iterations = source["iterations"];
	        this.delayMs = source["delayMs"];
	    }
	}
	export class SendInput {
	    file: string;
	    path: number[];
	    item?: collection.Item;
	    env: string;
	
	    static createFrom(source: any = {}) {
	        return new SendInput(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.file = source["file"];
	        this.path = source["path"];
	        this.item = this.convertValues(source["item"], collection.Item);
	        this.env = source["env"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class SendResult {
	    response?: httpx.Response;
	    body: string;
	    binary: boolean;
	    truncated: boolean;
	    tests: script.TestResult[];
	    console: string[];
	    error: string;
	    variables: collection.Variable[];
	    environment?: collection.Environment;
	
	    static createFrom(source: any = {}) {
	        return new SendResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.response = this.convertValues(source["response"], httpx.Response);
	        this.body = source["body"];
	        this.binary = source["binary"];
	        this.truncated = source["truncated"];
	        this.tests = this.convertValues(source["tests"], script.TestResult);
	        this.console = source["console"];
	        this.error = source["error"];
	        this.variables = this.convertValues(source["variables"], collection.Variable);
	        this.environment = this.convertValues(source["environment"], collection.Environment);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class Settings {
	    network: httpx.Network;
	
	    static createFrom(source: any = {}) {
	        return new Settings(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.network = this.convertValues(source["network"], httpx.Network);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class TextFile {
	    file: string;
	    data: string;
	
	    static createFrom(source: any = {}) {
	        return new TextFile(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.file = source["file"];
	        this.data = source["data"];
	    }
	}
	export class Workspace {
	    dir: string;
	    collections: FileRef[];
	    environments: FileRef[];
	    globals: string;
	
	    static createFrom(source: any = {}) {
	        return new Workspace(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.dir = source["dir"];
	        this.collections = this.convertValues(source["collections"], FileRef);
	        this.environments = this.convertValues(source["environments"], FileRef);
	        this.globals = source["globals"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace script {
	
	export class TestResult {
	    name: string;
	    passed: boolean;
	    error: string;
	
	    static createFrom(source: any = {}) {
	        return new TestResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.passed = source["passed"];
	        this.error = source["error"];
	    }
	}

}

