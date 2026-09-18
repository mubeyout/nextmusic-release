"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.eapiDecrypt = exports.eapi = exports.linuxapi = exports.weapi = void 0;
// https://github.com/Binaryify/NeteaseCloudMusicApi/blob/master/util/crypto.js
const crypto_1 = require("crypto");
const iv = Buffer.from('0102030405060708');
const presetKey = Buffer.from('0CoJUm6Qyw8W8jud');
const linuxapiKey = Buffer.from('rFgB&h#%2?^eDg:Q');
const base62 = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const publicKey = '-----BEGIN PUBLIC KEY-----\nMIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDgtQn2JZ34ZC28NWYpAUd98iZ37BUrX/aKzmFbt7clFSs6sXqHauqKWqdtLkF2KexO40H1YTX8z2lSgBBOAxLsvaklV8k4cBFK9snQXE9/DDaFt6Rr7iVZMldczhC0JNgTz+SHXT6CBHuX3e9SdB1Ua44oncaTWz7OBGLbCiK45wIDAQAB\n-----END PUBLIC KEY-----';
const eapiKey = 'e82ckenh8dichen8';
const aesEncrypt = (buffer, mode, key, iv) => {
    const cipher = (0, crypto_1.createCipheriv)(mode, key, iv);
    return Buffer.concat([cipher.update(buffer), cipher.final()]);
};
const aesDecrypt = function (cipherBuffer, mode, key, iv) {
    let decipher = (0, crypto_1.createDecipheriv)(mode, key, iv);
    return Buffer.concat([decipher.update(cipherBuffer), decipher.final()]);
};
const rsaEncrypt = (buffer, key) => {
    buffer = Buffer.concat([Buffer.alloc(128 - buffer.length), buffer]);
    return (0, crypto_1.publicEncrypt)({ key, padding: crypto_1.constants.RSA_NO_PADDING }, buffer);
};
const weapi = object => {
    const text = JSON.stringify(object);
    const secretKey = (0, crypto_1.randomBytes)(16).map(n => (base62.charAt(n % 62).charCodeAt()));
    return {
        params: aesEncrypt(Buffer.from(aesEncrypt(Buffer.from(text), 'aes-128-cbc', presetKey, iv).toString('base64')), 'aes-128-cbc', secretKey, iv).toString('base64'),
        encSecKey: rsaEncrypt(secretKey.reverse(), publicKey).toString('hex'),
    };
};
exports.weapi = weapi;
const linuxapi = object => {
    const text = JSON.stringify(object);
    return {
        eparams: aesEncrypt(Buffer.from(text), 'aes-128-ecb', linuxapiKey, '').toString('hex').toUpperCase(),
    };
};
exports.linuxapi = linuxapi;
const eapi = (url, object) => {
    const text = typeof object === 'object' ? JSON.stringify(object) : object;
    const message = `nobody${url}use${text}md5forencrypt`;
    const digest = (0, crypto_1.createHash)('md5').update(message).digest('hex');
    const data = `${url}-36cd479b6b5-${text}-36cd479b6b5-${digest}`;
    return {
        params: aesEncrypt(Buffer.from(data), 'aes-128-ecb', eapiKey, '').toString('hex').toUpperCase(),
    };
};
exports.eapi = eapi;
const eapiDecrypt = cipherBuffer => {
    return aesDecrypt(cipherBuffer, 'aes-128-ecb', eapiKey, '').toString();
};
exports.eapiDecrypt = eapiDecrypt;
