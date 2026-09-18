"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authConnect = exports.authCode = void 0;
const constants_1 = require("../constants");
const tools_1 = require("../utils/tools");
const node_querystring_1 = __importDefault(require("node:querystring"));
const cache_1 = __importDefault(require("../utils/cache"));
const user_1 = require("../user");
const utils_1 = require("../utils");
const getAvailableIP = (req) => {
    let ip = (0, tools_1.getIP)(req);
    return ip && (cache_1.default.get(ip) ?? 0) < 10 ? ip : null;
};
const verifyByKey = (encryptMsg, userId, targetUserName) => {
    const userName = (0, user_1.getUserName)(userId);
    if (!userName)
        return null;
    // 如果指定了目标用户名（通过URL路径），则必须匹配
    if (global.lx.config['user.enablePath'] && targetUserName && userName !== targetUserName) {
        return null;
    }
    const userSpace = (0, user_1.getUserSpace)(userName);
    const keyInfo = userSpace.dataManage.getClientKeyInfo(userId);
    if (!keyInfo)
        return null;
    let text;
    try {
        text = (0, tools_1.aesDecrypt)(encryptMsg, keyInfo.key);
    }
    catch (err) {
        return null;
    }
    // console.log(text)
    if (text.startsWith(constants_1.SYNC_CODE.authMsg)) {
        const deviceName = text.replace(constants_1.SYNC_CODE.authMsg, '') || 'Unknown';
        if (deviceName != keyInfo.deviceName) {
            keyInfo.deviceName = deviceName;
            userSpace.dataManage.saveClientKeyInfo(keyInfo);
        }
        return (0, tools_1.aesEncrypt)(constants_1.SYNC_CODE.helloMsg, keyInfo.key);
    }
    return null;
};
const verifyByCode = (encryptMsg, users, targetUserName) => {
    for (const userInfo of users) {
        if (targetUserName && userInfo.name !== targetUserName)
            continue;
        let key = (userInfo.syncKey ?? (0, utils_1.toMD5)(userInfo.password)).substring(0, 16); // [P1 安全债]迁移后用 syncKey 派生(LX 配对协议不变);未迁移兑底旧路径
        // const iv = Buffer.from(key.split('').reverse().join('')).toString('base64')
        key = Buffer.from(key).toString('base64');
        // console.log(req.headers.m, authCode, key)
        let text;
        try {
            text = (0, tools_1.aesDecrypt)(encryptMsg, key);
        }
        catch {
            continue;
        }
        // console.log(text)
        if (text.startsWith(constants_1.SYNC_CODE.authMsg)) {
            const data = text.split('\n');
            const publicKey = `-----BEGIN PUBLIC KEY-----\n${data[1]}\n-----END PUBLIC KEY-----`;
            const deviceName = data[2] || 'Unknown';
            const isMobile = data[3] == 'lx_music_mobile';
            const keyInfo = (0, user_1.createClientKeyInfo)(deviceName, isMobile);
            const userSpace = (0, user_1.getUserSpace)(userInfo.name);
            userSpace.dataManage.saveClientKeyInfo(keyInfo);
            (0, user_1.setUserName)(keyInfo.clientId, userInfo.name);
            return (0, tools_1.rsaEncrypt)(Buffer.from(JSON.stringify({
                clientId: keyInfo.clientId,
                key: keyInfo.key,
                serverName: global.lx.config.serverName,
            })), publicKey);
        }
    }
    return null;
};
const authCode = async (req, res, users, targetUserName) => {
    let code = 401;
    let msg = constants_1.SYNC_CODE.msgAuthFailed;
    let ip = getAvailableIP(req);
    if (ip) {
        if (typeof req.headers.m == 'string' && req.headers.m) {
            const userId = req.headers.i;
            const _msg = typeof userId == 'string' && userId
                ? verifyByKey(req.headers.m, userId, targetUserName)
                : verifyByCode(req.headers.m, users, targetUserName);
            if (_msg != null) {
                msg = _msg;
                code = 200;
            }
        }
        if (code != 200) {
            const num = cache_1.default.get(ip) ?? 0;
            // if (num > 20) return
            cache_1.default.set(ip, num + 1);
        }
    }
    else {
        code = 403;
        msg = constants_1.SYNC_CODE.msgBlockedIp;
    }
    // console.log(req.headers)
    res.writeHead(code);
    res.end(msg);
};
exports.authCode = authCode;
const verifyConnection = (encryptMsg, userId) => {
    const userName = (0, user_1.getUserName)(userId);
    // console.log(userName)
    if (!userName)
        return false;
    const userSpace = (0, user_1.getUserSpace)(userName);
    const keyInfo = userSpace.dataManage.getClientKeyInfo(userId);
    if (!keyInfo)
        return false;
    let text;
    try {
        text = (0, tools_1.aesDecrypt)(encryptMsg, keyInfo.key);
    }
    catch (err) {
        return false;
    }
    // console.log(text)
    return text == constants_1.SYNC_CODE.msgConnect;
};
const authConnect = async (req) => {
    let ip = getAvailableIP(req);
    if (ip) {
        const query = node_querystring_1.default.parse(req.url.split('?')[1]);
        const i = query.i;
        const t = query.t;
        if (typeof i == 'string' && typeof t == 'string' && verifyConnection(t, i)) {
            // 验证 URL 路径中的用户名是否与连接的客户端所属用户一致
            if (global.lx.config['user.enablePath']) {
                const path = req.url.split('?')[0];
                const pathParts = path.split('/').filter(p => p);
                // 假设路径格式为 /<username>
                // 解码 URL 编码的用户名
                const urlUserName = pathParts[0] ? decodeURIComponent(pathParts[0]) : null;
                const clientUserName = (0, user_1.getUserName)(i);
                // console.log('Auth check path:', urlUserName, clientUserName)
                if (urlUserName && urlUserName !== 'socket' && clientUserName && urlUserName !== clientUserName) {
                    // 如果路径中有用户名，且与客户端所属用户不一致，则拒绝连接
                    throw new Error('User mismatch');
                }
            }
            return;
        }
        const num = cache_1.default.get(ip) ?? 0;
        cache_1.default.set(ip, num + 1);
    }
    throw new Error('failed');
};
exports.authConnect = authConnect;
