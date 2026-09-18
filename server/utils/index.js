"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkAndCreateDirSync = exports.toMD5 = exports.filterFileName = exports.createDirSync = void 0;
const node_fs_1 = __importDefault(require("node:fs"));
const node_crypto_1 = __importDefault(require("node:crypto"));
const createDirSync = (path) => {
    if (!node_fs_1.default.existsSync(path)) {
        try {
            node_fs_1.default.mkdirSync(path, { recursive: true });
        }
        catch (e) {
            if (e.code !== 'EEXIST') {
                console.error('Could not set up log directory, error was: ', e);
                process.exit(1);
            }
        }
    }
};
exports.createDirSync = createDirSync;
const fileNameRxp = /[\\/:*?#"<>|]/g;
const filterFileName = (name) => name.replace(fileNameRxp, '');
exports.filterFileName = filterFileName;
/**
 * 创建 MD5 hash
 * @param {*} str
 */
const toMD5 = (str) => node_crypto_1.default.createHash('md5').update(str).digest('hex');
exports.toMD5 = toMD5;
const checkAndCreateDirSync = (path) => {
    if (!node_fs_1.default.existsSync(path)) {
        node_fs_1.default.mkdirSync(path, { recursive: true });
    }
};
exports.checkAndCreateDirSync = checkAndCreateDirSync;
