"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendStatus = exports.decryptMsg = exports.encryptMsg = exports.rsaDecrypt = exports.rsaEncrypt = exports.aesDecrypt = exports.aesEncrypt = exports.getIP = exports.generateCode = exports.getAddress = void 0;
const node_os_1 = require("node:os");
const node_crypto_1 = require("node:crypto");
// import { join } from 'node:path'
const node_zlib_1 = __importDefault(require("node:zlib"));
// import getStore from '@/utils/store'
const log4js_1 = require("./log4js");
const data_1 = require("../user/data");
// import { saveClientKeyInfo } from './data'
const getAddress = () => {
    const nets = (0, node_os_1.networkInterfaces)();
    const results = [];
    // console.log(nets)
    for (const interfaceInfos of Object.values(nets)) {
        if (!interfaceInfos)
            continue;
        // Skip over non-IPv4 and internal (i.e. 127.0.0.1) addresses
        for (const interfaceInfo of interfaceInfos) {
            if (interfaceInfo.family === 'IPv4' && !interfaceInfo.internal) {
                results.push(interfaceInfo.address);
            }
        }
    }
    return results;
};
exports.getAddress = getAddress;
const generateCode = () => {
    return Math.random().toString().substring(2, 8);
};
exports.generateCode = generateCode;
const getIP = (request) => {
    let ip;
    if (global.lx.config['proxy.enabled']) {
        const proxyIp = request.headers[global.lx.config['proxy.header']];
        if (typeof proxyIp == 'string')
            ip = proxyIp;
    }
    ip ||= request.socket.remoteAddress;
    return ip;
};
exports.getIP = getIP;
const aesEncrypt = (buffer, key) => {
    const cipher = (0, node_crypto_1.createCipheriv)('aes-128-ecb', Buffer.from(key, 'base64'), '');
    return Buffer.concat([cipher.update(buffer), cipher.final()]).toString('base64');
};
exports.aesEncrypt = aesEncrypt;
const aesDecrypt = (text, key) => {
    const decipher = (0, node_crypto_1.createDecipheriv)('aes-128-ecb', Buffer.from(key, 'base64'), '');
    return Buffer.concat([decipher.update(Buffer.from(text, 'base64')), decipher.final()]).toString();
};
exports.aesDecrypt = aesDecrypt;
const rsaEncrypt = (buffer, key) => {
    return (0, node_crypto_1.publicEncrypt)({ key, padding: node_crypto_1.constants.RSA_PKCS1_OAEP_PADDING }, buffer).toString('base64');
};
exports.rsaEncrypt = rsaEncrypt;
const rsaDecrypt = (buffer, key) => {
    return (0, node_crypto_1.privateDecrypt)({ key, padding: node_crypto_1.constants.RSA_PKCS1_OAEP_PADDING }, buffer);
};
exports.rsaDecrypt = rsaDecrypt;
const gzip = async (data) => new Promise((resolve, reject) => {
    node_zlib_1.default.gzip(data, (err, buf) => {
        if (err) {
            reject(err);
            return;
        }
        resolve(buf.toString('base64'));
    });
});
const unGzip = async (data) => new Promise((resolve, reject) => {
    node_zlib_1.default.gunzip(Buffer.from(data, 'base64'), (err, buf) => {
        if (err) {
            reject(err);
            return;
        }
        resolve(buf.toString());
    });
});
const encryptMsg = async (keyInfo, msg) => {
    return msg.length > 1024
        ? 'cg_' + await gzip(msg)
        : msg;
    // if (!keyInfo) return ''
    // return aesEncrypt(msg, keyInfo.key, keyInfo.iv)
};
exports.encryptMsg = encryptMsg;
const decryptMsg = async (keyInfo, enMsg) => {
    return enMsg.substring(0, 3) == 'cg_'
        ? await unGzip(enMsg.replace('cg_', ''))
        : enMsg;
    // console.log('decmsg raw: ', len.length, 'en: ', enMsg.length)
    // if (!keyInfo) return ''
    // let msg = ''
    // try {
    //   msg = aesDecrypt(enMsg, keyInfo.key, keyInfo.iv)
    // } catch (err) {
    //   console.log(err)
    // }
    // return msg
};
exports.decryptMsg = decryptMsg;
// export const getSnapshotFilePath = (keyInfo: LX.Sync.KeyInfo): string => {
//   return join(global.lx.snapshotPath, `snapshot_${keyInfo.snapshotKey}.json`)
// }
const sendStatus = (status) => {
    log4js_1.syncLog.info('status', status.devices.map(d => `${(0, data_1.getUserName)(d.clientId) ?? ''} ${d.deviceName}`));
};
exports.sendStatus = sendStatus;
