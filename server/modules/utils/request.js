"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkUrl = exports.http_jsonp = exports.httpPost = exports.httpGet = exports.http = exports.cancelHttp = exports.httpFetch = void 0;
const needle_1 = __importDefault(require("needle"));
const env_1 = require("./env");
const message_1 = require("./message");
const options_1 = require("./musicSdk/options");
const zlib_1 = require("zlib");
const tunnel = __importStar(require("tunnel"));
const httpsRxp = /^https:/;
// Mock proxy config from global.lx.config if needed, or environment variables
const getRequestAgent = async (url) => {
    const config = global.lx?.config || {};
    const proxyEnabled = config['proxy.all.enabled'];
    const proxyAddress = config['proxy.all.address'];
    if (proxyEnabled && proxyAddress) {
        try {
            const proxyUrl = new URL(proxyAddress);
            if (proxyUrl.protocol === 'http:' || proxyUrl.protocol === 'https:') {
                const isHttps = httpsRxp.test(url);
                const tunnelOptions = {
                    proxy: {
                        host: proxyUrl.hostname,
                        port: proxyUrl.port,
                        proxyAuth: proxyUrl.username ? `${proxyUrl.username}:${proxyUrl.password}` : undefined
                    }
                };
                return (isHttps ? tunnel.httpsOverHttp : tunnel.httpOverHttp)(tunnelOptions);
            }
            else if (proxyUrl.protocol.startsWith('socks')) {
                const { SocksProxyAgent } = await import('socks-proxy-agent');
                return new SocksProxyAgent(proxyAddress);
            }
        }
        catch (e) {
            // console.error('[Request] Invalid proxy address:', proxyAddress, e)
        }
    }
    if (process.env.HTTPS_PROXY) {
        try {
            const proxyUrl = new URL(process.env.HTTPS_PROXY);
            const tunnelOptions = {
                proxy: {
                    host: proxyUrl.hostname,
                    port: proxyUrl.port,
                    proxyAuth: proxyUrl.username ? `${proxyUrl.username}:${proxyUrl.password}` : undefined
                }
            };
            return (httpsRxp.test(url) ? tunnel.httpsOverHttp : tunnel.httpOverHttp)(tunnelOptions);
        }
        catch (e) { }
    }
    return undefined;
};
const request = (url, options, callback) => {
    let data;
    if (options.body) {
        data = options.body;
    }
    else if (options.form) {
        data = options.form;
        // data.content_type = 'application/x-www-form-urlencoded'
        options.json = false;
    }
    else if (options.formData) {
        data = options.formData;
        // data.content_type = 'multipart/form-data'
        options.json = false;
    }
    options.response_timeout = options.timeout;
    options.read_timeout = options.timeout;
    return needle_1.default.request(options.method || 'get', url, data, options, (err, resp, body) => {
        if (!err) {
            body = resp.body = resp.raw.toString();
            try {
                resp.body = JSON.parse(resp.body);
            }
            catch (_) { }
            body = resp.body;
        }
        callback(err, resp, body);
    }).request;
};
const defaultHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};
const buildHttpPromose = (url, options) => {
    let obj = {
        isCancelled: false,
        cancelHttp: () => {
            if (!obj.requestObj)
                return obj.isCancelled = true;
            (0, exports.cancelHttp)(obj.requestObj);
            obj.requestObj = null;
            obj.promise = obj.cancelHttp = null;
            if (obj.cancelFn)
                obj.cancelFn(new Error(message_1.requestMsg.cancelRequest));
            obj.cancelFn = null;
        },
    };
    obj.promise = new Promise((resolve, reject) => {
        obj.cancelFn = reject;
        env_1.debugRequest && console.log(`\n---send request------${url}------------`);
        fetchData(url, options.method, options, (err, resp, body) => {
            env_1.debugRequest && console.log(`\n---response------${url}------------`);
            env_1.debugRequest && console.log(body);
            obj.requestObj = null;
            obj.cancelFn = null;
            if (err)
                return reject(err);
            resolve(resp);
        }).then(ro => {
            obj.requestObj = ro;
            if (obj.isCancelled)
                obj.cancelHttp();
        });
    });
    return obj;
};
const httpFetch = (url, options = { method: 'get' }) => {
    const requestObj = buildHttpPromose(url, options);
    requestObj.promise = requestObj.promise.catch(err => {
        if (err.message === 'socket hang up') {
            return Promise.reject(new Error(message_1.requestMsg.unachievable));
        }
        switch (err.code) {
            case 'ETIMEDOUT':
            case 'ESOCKETTIMEDOUT':
                return Promise.reject(new Error(message_1.requestMsg.timeout));
            case 'ENOTFOUND':
                return Promise.reject(new Error(message_1.requestMsg.notConnectNetwork));
            default:
                return Promise.reject(err);
        }
    });
    return requestObj;
};
exports.httpFetch = httpFetch;
const cancelHttp = requestObj => {
    if (!requestObj)
        return;
    if (!requestObj.abort)
        return;
    requestObj.abort();
};
exports.cancelHttp = cancelHttp;
const http = (url, options, cb) => {
    if (typeof options === 'function') {
        cb = options;
        options = {};
    }
    // 默认选项
    if (options.method == null)
        options.method = 'get';
    env_1.debugRequest && console.log(`\n---send request------${url}------------`);
    return fetchData(url, options.method, options, (err, resp, body) => {
        env_1.debugRequest && console.log(`\n---response------${url}------------`);
        env_1.debugRequest && console.log(body);
        if (err) {
            env_1.debugRequest && console.log(JSON.stringify(err));
        }
        cb(err, resp, body);
    });
};
exports.http = http;
const httpGet = (url, options, callback) => {
    if (typeof options === 'function') {
        callback = options;
        options = {};
    }
    env_1.debugRequest && console.log(`\n---send request-------${url}------------`);
    return fetchData(url, 'get', options, function (err, resp, body) {
        env_1.debugRequest && console.log(`\n---response------${url}------------`);
        env_1.debugRequest && console.log(body);
        if (err) {
            env_1.debugRequest && console.log(JSON.stringify(err));
        }
        callback(err, resp, body);
    });
};
exports.httpGet = httpGet;
const httpPost = (url, data, options, callback) => {
    if (typeof options === 'function') {
        callback = options;
        options = {};
    }
    options.data = data;
    env_1.debugRequest && console.log(`\n---send request-------${url}------------`);
    return fetchData(url, 'post', options, function (err, resp, body) {
        env_1.debugRequest && console.log(`\n---response------${url}------------`);
        env_1.debugRequest && console.log(body);
        if (err) {
            env_1.debugRequest && console.log(JSON.stringify(err));
        }
        callback(err, resp, body);
    });
};
exports.httpPost = httpPost;
const http_jsonp = (url, options, callback) => {
    // Node.js doesn't support JSONP natively in the way browsers do.
    // However, musicSdk uses it to fetch data.
    // We can simulate it by standard GET and manual parsing if strictly necessary,
    // or typically APIs just return JSON if we don't ask for JSONP callback or handle it manually.
    // Needle ignores jsonp parameters, so we implement a basic GET.
    if (typeof options === 'function') {
        callback = options;
        options = {};
    }
    let jsonpCallback = 'jsonpCallback';
    if (url.indexOf('?') < 0)
        url += '?';
    url += `&${options.jsonpCallback}=${jsonpCallback}`;
    options.format = 'script';
    env_1.debugRequest && console.log(`\n---send request-------${url}------------`);
    return fetchData(url, 'get', options, function (err, resp, body) {
        env_1.debugRequest && console.log(`\n---response------${url}------------`);
        env_1.debugRequest && console.log(body);
        if (err) {
            env_1.debugRequest && console.log(JSON.stringify(err));
        }
        else {
            // Manual JSONP parsing
            try {
                body = JSON.parse(body.replace(new RegExp(`^${jsonpCallback}\\(({.*})\\)$`), '$1'));
            }
            catch (e) {
                // If regex fails, maybe it returned plain JSON or error
            }
        }
        callback(err, resp, body);
    });
};
exports.http_jsonp = http_jsonp;
const handleDeflateRaw = data => new Promise((resolve, reject) => {
    (0, zlib_1.deflateRaw)(data, (err, buf) => {
        if (err)
            return reject(err);
        resolve(buf);
    });
});
const regx = /(?:\d\w)+/g;
const fetchData = async (url, method, { headers = {}, format = 'json', timeout = 15000, ...options }, callback) => {
    // console.log('---start---', url)
    headers = Object.assign({}, headers);
    if (headers[options_1.bHh]) {
        const path = url.replace(/^https?:\/\/[\w.:]+\//, '/');
        let s = Buffer.from(options_1.bHh, 'hex').toString();
        s = s.replace(s.substr(-1), '');
        s = Buffer.from(s, 'base64').toString();
        // Process versions mocking
        const v1 = '2050201'; // Mock version numbers
        const v2 = '10';
        // let v = process.versions.app... // This was electron specific
        let v = v1.split('-')[0].split('.').map(n => n.length < 3 ? n.padStart(3, '0') : n).join('');
        headers[s] = !s || `${(await handleDeflateRaw(Buffer.from(JSON.stringify(`${path}${v}`.match(regx), null, 1).concat(v)).toString('base64'))).toString('hex')}&${parseInt(v)}${v2}`;
        delete headers[options_1.bHh];
    }
    return request(url, {
        ...options,
        method,
        headers: Object.assign({}, defaultHeaders, headers),
        timeout,
        agent: await getRequestAgent(url),
        json: format === 'json',
        rejectUnauthorized: false,
    }, (err, resp, body) => {
        if (err)
            return callback(err, null);
        callback(null, resp, body);
    });
};
const checkUrl = (url, options = {}) => {
    return new Promise((resolve, reject) => {
        fetchData(url, 'head', options, (err, resp) => {
            if (err)
                return reject(err);
            if (resp.statusCode === 200) {
                resolve();
            }
            else {
                reject(new Error(resp.statusCode));
            }
        });
    });
};
exports.checkUrl = checkUrl;
