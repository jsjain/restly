// pm.js builds the pm API on top of the raw bridges Go sets on the runtime before this file
// runs: __local/__data/__environment/__collection/__globals (live Go maps), __requestJSON,
// __responseJSON, __infoJSON (JSON text), __host (Go bridge functions), atob/btoa, require.
//
// Everything a script is allowed to see is a plain global: pm, console, tests, responseBody,
// responseCode, responseHeaders, responseTime, postman. Internal helpers are prefixed with __
// so they stay out of a script's way without needing an IIFE (which would also hide
// __settleWrapper from the separately-compiled wrapped script that calls it).

function __toStoredString(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch (e) {
      return String(value);
    }
  }
  return String(value);
}

// __describeError keeps one line of stack (the throw site) when there is one; used for the
// one error that Run() returns to Go for the whole script.
function __describeError(e) {
  if (e === null || e === undefined) return String(e);
  if (typeof e === "string") return e;
  if (typeof e === "object" && typeof e.message === "string") {
    if (typeof e.stack === "string") {
      var throwSite = e.stack.split("\n")[1];
      if (throwSite) return e.message + " (" + throwSite.trim() + ")";
    }
    return e.message;
  }
  try {
    return JSON.stringify(e);
  } catch (ex) {
    return String(e);
  }
}

// __errorMessage is __describeError without the stack, for pm.test failures ("failed with the message").
function __errorMessage(e) {
  if (e === null || e === undefined) return String(e);
  if (typeof e === "string") return e;
  if (typeof e === "object" && typeof e.message === "string") return e.message;
  try {
    return JSON.stringify(e);
  } catch (ex) {
    return String(e);
  }
}

function __formatConsoleArg(value) {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (value instanceof Error) return value.message;
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch (e) {
      return String(value);
    }
  }
  return String(value);
}

function __makeConsoleMethod(level) {
  return function () {
    var parts = [];
    for (var i = 0; i < arguments.length; i++) parts.push(__formatConsoleArg(arguments[i]));
    __host.log(level + ": " + parts.join(" "));
  };
}

var console = {
  log: __makeConsoleMethod("log"),
  info: __makeConsoleMethod("info"),
  warn: __makeConsoleMethod("warn"),
  error: __makeConsoleMethod("error"),
  debug: __makeConsoleMethod("debug"),
};

// __makeScope wraps a live Go map (map[string]string) as get/set/has/unset/clear/toObject.
function __makeScope(map, readonly) {
  return {
    get: function (key) {
      return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : undefined;
    },
    set: function (key, value) {
      if (readonly) throw new Error("this variable scope is read-only");
      map[key] = __toStoredString(value);
    },
    unset: function (key) {
      delete map[key];
    },
    has: function (key) {
      return Object.prototype.hasOwnProperty.call(map, key);
    },
    clear: function () {
      for (var key in map) {
        if (Object.prototype.hasOwnProperty.call(map, key)) delete map[key];
      }
    },
    toObject: function () {
      var out = {};
      for (var key in map) {
        if (Object.prototype.hasOwnProperty.call(map, key)) out[key] = map[key];
      }
      return out;
    },
    replaceIn: function (text) {
      return __host.replace(text);
    },
  };
}

var pm = {};

pm.environment = __makeScope(__environment, false);
pm.collectionVariables = __makeScope(__collection, false);
pm.globals = __makeScope(__globals, false);

var __iterationScope = __makeScope(__data, true);
pm.iterationData = {
  get: __iterationScope.get,
  has: __iterationScope.has,
  toObject: __iterationScope.toObject,
};

pm.variables = {
  get: function (key) {
    var layers = [__local, __data, __environment, __collection, __globals];
    for (var i = 0; i < layers.length; i++) {
      if (Object.prototype.hasOwnProperty.call(layers[i], key)) return layers[i][key];
    }
    return undefined;
  },
  set: function (key, value) {
    __local[key] = __toStoredString(value);
  },
  has: function (key) {
    return pm.variables.get(key) !== undefined;
  },
  toObject: function () {
    var out = {};
    [__globals, __collection, __environment, __data, __local].forEach(function (map) {
      for (var key in map) {
        if (Object.prototype.hasOwnProperty.call(map, key)) out[key] = map[key];
      }
    });
    return out;
  },
  replaceIn: function (text) {
    return __host.replace(text);
  },
};

var __info = JSON.parse(__infoJSON);
pm.info = {
  eventName: __info.eventName,
  iteration: __info.iteration,
  iterationCount: __info.iterationCount,
  requestName: __info.requestName,
  requestId: __info.requestId,
};

pm.execution = {
  setNextRequest: function (nameOrNull) {
    var isNull = nameOrNull === null || nameOrNull === undefined;
    __host.setNextRequest(isNull ? "" : String(nameOrNull), isNull);
  },
  skipRequest: function () {
    // Real Postman only honors this in pre-request scripts; a test script call is a no-op.
    if (pm.info.eventName === "prerequest") __host.skipRequest();
  },
};

// ---- chai, loaded lazily on first use ----

function __ensureChai() {
  return __host.loadChai();
}

Object.defineProperty(pm, "expect", {
  get: function () {
    return __ensureChai().expect;
  },
});

// ---- KV lists (headers, query params, cookies) ----

// __makeKVList wraps an array of {key/name, value, disabled} objects. keyField lets it serve
// both header-shaped ({key,value}) and cookie-shaped ({name,value}) arrays.
function __makeKVList(getArray, opts) {
  opts = opts || {};
  var keyField = opts.keyField || "key";
  var ci = !!opts.caseInsensitive;
  var onChange = opts.onChange || function () {};

  function keyEq(a, b) {
    return ci ? String(a).toLowerCase() === String(b).toLowerCase() : a === b;
  }

  var list = {
    get: function (name) {
      var arr = getArray();
      for (var i = 0; i < arr.length; i++) {
        if (!arr[i].disabled && keyEq(arr[i][keyField], name)) return arr[i].value;
      }
      return undefined;
    },
    has: function (name) {
      var arr = getArray();
      for (var i = 0; i < arr.length; i++) {
        if (!arr[i].disabled && keyEq(arr[i][keyField], name)) return true;
      }
      return false;
    },
    add: function (item) {
      var entry = {};
      entry[keyField] = item.key !== undefined ? item.key : item[keyField];
      entry.value = item.value !== undefined ? String(item.value) : "";
      entry.disabled = !!item.disabled;
      getArray().push(entry);
      onChange();
    },
    upsert: function (item) {
      var arr = getArray();
      var name = item.key !== undefined ? item.key : item[keyField];
      for (var i = 0; i < arr.length; i++) {
        if (keyEq(arr[i][keyField], name)) {
          arr[i].value = item.value !== undefined ? String(item.value) : "";
          arr[i].disabled = !!item.disabled;
          onChange();
          return;
        }
      }
      list.add(item);
    },
    remove: function (name) {
      var arr = getArray();
      for (var i = arr.length - 1; i >= 0; i--) {
        if (keyEq(arr[i][keyField], name)) arr.splice(i, 1);
      }
      onChange();
    },
    toObject: function () {
      var out = {};
      getArray().forEach(function (item) {
        if (!item.disabled) out[item[keyField]] = item.value;
      });
      return out;
    },
    each: function (fn) {
      getArray().forEach(function (item) {
        fn(item);
      });
    },
    all: function () {
      return getArray().slice();
    },
  };
  return list;
}

// ---- pm.request ----

function __normalizeUrl(url) {
  if (typeof url === "string") return { raw: url, query: [], variable: [] };
  url = url || {};
  if (!url.query) url.query = [];
  if (!url.variable) url.variable = [];
  return url;
}

function __stripQuery(raw) {
  var hashIdx = raw.indexOf("#");
  var hash = hashIdx >= 0 ? raw.slice(hashIdx) : "";
  var base = hashIdx >= 0 ? raw.slice(0, hashIdx) : raw;
  var qIdx = base.indexOf("?");
  base = qIdx >= 0 ? base.slice(0, qIdx) : base;
  return { base: base, hash: hash };
}

function __queryString(query) {
  return (query || [])
    .filter(function (q) {
      return !q.disabled;
    })
    .map(function (q) {
      return q.key + "=" + (q.value || "");
    })
    .join("&");
}

// __rawWithQuery is the read-only rule behind url.toString(): only rebuilt when there are
// query entries to apply; an empty query array leaves whatever raw already has alone.
function __rawWithQuery(url) {
  if (!url.query || !url.query.length) return url.raw || "";
  var parts = __stripQuery(url.raw || "");
  var qs = __queryString(url.query);
  return parts.base + (qs ? "?" + qs : "") + parts.hash;
}

// __syncRaw is the mutating counterpart used after add/upsert/remove: the query array is now
// authoritative, so an emptied array clears the query string instead of leaving it stale.
function __syncRaw(url) {
  var parts = __stripQuery(url.raw || "");
  var qs = __queryString(url.query);
  url.raw = parts.base + (qs ? "?" + qs : "") + parts.hash;
}

function __buildUrlApi(url) {
  var query = __makeKVList(
    function () {
      return url.query;
    },
    {
      onChange: function () {
        __syncRaw(url);
      },
    }
  );
  return {
    get raw() {
      return url.raw || "";
    },
    set raw(value) {
      url.raw = value;
    },
    toString: function () {
      return __rawWithQuery(url);
    },
    getHost: function () {
      return Array.isArray(url.host) ? url.host.join(".") : "";
    },
    getPath: function () {
      return Array.isArray(url.path) ? "/" + url.path.join("/") : "";
    },
    query: query,
    toJSON: function () {
      return url;
    },
  };
}

function __buildRequestApi(reqData) {
  if (!reqData.header) reqData.header = [];
  if (!reqData.body) reqData.body = {};
  reqData.url = __normalizeUrl(reqData.url);
  var urlApi = __buildUrlApi(reqData.url);

  var api = {
    headers: __makeKVList(
      function () {
        return reqData.header;
      },
      { caseInsensitive: true }
    ),
    get body() {
      return reqData.body;
    },
    set body(value) {
      reqData.body = value;
    },
    get auth() {
      return reqData.auth;
    },
    set auth(value) {
      reqData.auth = value;
    },
    get method() {
      return reqData.method;
    },
    set method(value) {
      reqData.method = value;
    },
    toJSON: function () {
      return reqData;
    },
  };
  Object.defineProperty(api, "url", {
    get: function () {
      return urlApi;
    },
    set: function (value) {
      reqData.url = __normalizeUrl(value);
      urlApi = __buildUrlApi(reqData.url);
    },
  });
  return api;
}

var __reqData = JSON.parse(__requestJSON || "{}");
pm.request = __buildRequestApi(__reqData);

// ---- pm.response (test scripts only) ----

function __buildResponseAssertions(resp) {
  function expect(actual, msg) {
    return __ensureChai().expect(actual, msg);
  }
  function status(codeOrReason) {
    if (typeof codeOrReason === "number") {
      expect(resp.code, "expected response to have status " + codeOrReason + " but got " + resp.code).to.equal(codeOrReason);
    } else {
      expect(resp.status).to.equal(codeOrReason);
    }
  }
  function notStatus(codeOrReason) {
    if (typeof codeOrReason === "number") {
      expect(resp.code).to.not.equal(codeOrReason);
    } else {
      expect(resp.status).to.not.equal(codeOrReason);
    }
  }
  function header(key, value) {
    expect(resp.headers.has(key), "expected response to have header '" + key + "'").to.equal(true);
    if (value !== undefined) expect(resp.headers.get(key)).to.equal(value);
  }
  function notHeader(key, value) {
    if (value !== undefined) {
      expect(resp.headers.get(key)).to.not.equal(value);
    } else {
      expect(resp.headers.has(key)).to.equal(false);
    }
  }
  function body(text) {
    expect(resp.text()).to.equal(text);
  }
  function notBody(text) {
    expect(resp.text()).to.not.equal(text);
  }
  function jsonBody() {
    resp.json(); // throws a clear error on invalid JSON
    return true;
  }
  function inRange(low, high, label) {
    expect(resp.code >= low && resp.code < high, "expected a " + label + " status, got " + resp.code).to.equal(true);
  }
  function contentTypeIsJSON() {
    var ct = resp.headers.get("Content-Type") || "";
    expect(ct.indexOf("json") !== -1, "expected content-type to include 'json', got '" + ct + "'").to.equal(true);
  }

  return {
    have: { status: status, header: header, body: body, jsonBody: jsonBody },
    get be() {
      return {
        get ok() {
          status(200);
          return true;
        },
        get success() {
          inRange(200, 300, "2xx");
          return true;
        },
        get error() {
          inRange(400, 600, "4xx or 5xx");
          return true;
        },
        get clientError() {
          inRange(400, 500, "4xx");
          return true;
        },
        get serverError() {
          inRange(500, 600, "5xx");
          return true;
        },
        get json() {
          contentTypeIsJSON();
          return true;
        },
      };
    },
    not: { have: { status: notStatus, header: notHeader, body: notBody } },
  };
}

function __buildResponseApi(data) {
  var cachedJSON, hasCachedJSON = false;
  var api = {
    code: data.code,
    status: data.status,
    responseTime: data.responseTime,
    responseSize: data.size,
    headers: __makeKVList(
      function () {
        return data.headers || [];
      },
      { caseInsensitive: true }
    ),
    cookies: __makeKVList(
      function () {
        return data.cookies || [];
      },
      { keyField: "name" }
    ),
    text: function () {
      return data.body;
    },
    json: function () {
      if (!hasCachedJSON) {
        try {
          cachedJSON = JSON.parse(data.body);
        } catch (e) {
          throw new Error("response body is not valid JSON: " + e.message);
        }
        hasCachedJSON = true;
      }
      return cachedJSON;
    },
  };
  Object.defineProperty(api, "to", {
    get: function () {
      return __buildResponseAssertions(api);
    },
  });
  return api;
}

if (__responseJSON) {
  pm.response = __buildResponseApi(JSON.parse(__responseJSON));
  var responseBody = pm.response.text();
  var responseCode = { code: pm.response.code, name: pm.response.status };
  var responseHeaders = pm.response.headers.toObject();
  var responseTime = pm.response.responseTime;
}

// ---- pm.sendRequest ----

function __normalizeSendHeader(header) {
  if (Array.isArray(header)) {
    return header.map(function (item) {
      return { key: item.key, value: __toStoredString(item.value), disabled: !!item.disabled };
    });
  }
  if (header && typeof header === "object") {
    return Object.keys(header).map(function (key) {
      return { key: key, value: __toStoredString(header[key]) };
    });
  }
  return [];
}

function __normalizeSendRequest(req) {
  if (typeof req === "string") return { method: "GET", url: { raw: req } };
  req = req || {};
  var out = {
    method: req.method || "GET",
    url: __normalizeUrl(req.url),
    header: __normalizeSendHeader(req.header),
  };
  if (req.body) out.body = req.body;
  return out;
}

pm.sendRequest = function (req, callback) {
  var reqObj = __normalizeSendRequest(req);
  __pending++;
  var promise = new Promise(function (resolve, reject) {
    __host.sendRequest(JSON.stringify(reqObj)).then(
      function (json) {
        var res = __buildResponseApi(JSON.parse(json));
        if (callback) callback(null, res);
        resolve(res);
      },
      function (err) {
        if (callback) {
          callback(err);
          resolve(undefined);
        } else {
          reject(err);
        }
      }
    );
  });
  // ponytail: pending-- runs in the microtask right after this .then, so if a chained .then
  // on the caller's side kicks off *new* pending work, it can race __checkDone. Not exercised
  // by any current script pattern; revisit with a real pending-count callback if it ever bites.
  promise.then(
    function () {
      __pending--;
      __checkDone();
    },
    function () {
      __pending--;
      __checkDone();
    }
  );
  return promise;
};

// ---- pm.test ----

function __runTest(name, fn) {
  var idx = __host.reserveTest(name);
  __pending++;
  function finish(passed, err) {
    __host.fillTest(idx, passed, passed ? "" : __errorMessage(err));
    __pending--;
    __checkDone();
  }
  try {
    if (fn.length === 1) {
      var called = false;
      fn(function (err) {
        if (called) return;
        called = true;
        if (err) finish(false, err);
        else finish(true);
      });
      return;
    }
    var result = fn();
    if (result && typeof result.then === "function") {
      result.then(
        function () {
          finish(true);
        },
        function (err) {
          finish(false, err);
        }
      );
      return;
    }
    finish(true);
  } catch (e) {
    finish(false, e);
  }
}

pm.test = function (name, fn) {
  __runTest(name, fn);
};
pm.test.skip = function () {};

// ---- legacy Postman globals ----

var tests = {};

var postman = {
  setEnvironmentVariable: function (key, value) {
    pm.environment.set(key, value);
  },
  getEnvironmentVariable: function (key) {
    return pm.environment.get(key);
  },
  clearEnvironmentVariable: function (key) {
    pm.environment.unset(key);
  },
  setGlobalVariable: function (key, value) {
    pm.globals.set(key, value);
  },
  getGlobalVariable: function (key) {
    return pm.globals.get(key);
  },
  clearGlobalVariable: function (key) {
    pm.globals.unset(key);
  },
  setNextRequest: function (name) {
    pm.execution.setNextRequest(name);
  },
};

// ---- completion tracking ----
//
// The wrapped script (a separate program compiled by Go) ends with a call to
// __settleWrapper(true) or __settleWrapper(false, err) once its top-level promise settles.
// __checkDone waits for that AND for every pm.test/pm.sendRequest started along the way.

var __pending = 0;
var __wrapperDone = false;
var __wrapperErr = null;
var __finished = false;

// __trimEmptyRequestFields undoes the defaults __buildRequestApi added for scripts that never
// touched header/body, so an untouched request round-trips without gaining stray JSON keys.
function __trimEmptyRequestFields() {
  if (__reqData.header && __reqData.header.length === 0) delete __reqData.header;
  if (__reqData.body && Object.keys(__reqData.body).length === 0) delete __reqData.body;
}

function __checkDone() {
  if (__finished || !__wrapperDone || __pending > 0) return;
  __finished = true;
  __trimEmptyRequestFields();
  for (var key in tests) {
    if (Object.prototype.hasOwnProperty.call(tests, key)) {
      var idx = __host.reserveTest(key);
      __host.fillTest(idx, !!tests[key], "");
    }
  }
  __host.finish(__wrapperErr !== null ? __describeError(__wrapperErr) : "");
}

function __settleWrapper(ok, err) {
  __wrapperDone = true;
  if (!ok) __wrapperErr = err;
  __checkDone();
}
