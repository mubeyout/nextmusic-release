"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.tokenLog = exports.loginLog = exports.accessLog = exports.syncLog = exports.startupLog = exports.initLogger = void 0;
const node_path_1 = __importDefault(require("node:path"));
const log4js_1 = __importDefault(require("log4js"));
const createLogConfig = (logPath) => {
    return {
        appenders: {
            access: {
                type: 'file',
                filename: node_path_1.default.join(logPath, 'access.log'),
                maxLogSize: 1024 * 1024 * 10,
                category: 'access',
                // compress: true,
                keepFileExt: true,
                numBackups: 10,
            },
            app: {
                type: 'file',
                filename: node_path_1.default.join(logPath, 'app.log'),
                maxLogSize: 10485760,
                backups: 10,
                keepFileExt: true,
            },
            errorFile: {
                type: 'file',
                filename: node_path_1.default.join(logPath, 'errors.log'),
            },
            errors: {
                type: 'logLevelFilter',
                level: 'ERROR',
                appender: 'errorFile',
            },
            console: {
                type: 'console',
            },
            login: {
                type: 'file',
                filename: node_path_1.default.join(logPath, 'login.log'),
                maxLogSize: 1024 * 1024 * 10,
                category: 'login',
                keepFileExt: true,
                numBackups: 10,
            },
            token: {
                type: 'file',
                filename: node_path_1.default.join(logPath, 'token.log'),
                maxLogSize: 1024 * 1024 * 10,
                category: 'token',
                keepFileExt: true,
                numBackups: 10,
            },
        },
        categories: {
            default: { appenders: ['app', 'errors', 'console'], level: 'DEBUG' },
            access: { appenders: ['access'], level: 'ALL' },
            login: { appenders: ['login'], level: 'ALL' },
            token: { appenders: ['token'], level: 'ALL' },
        },
    };
};
const initLogger = () => {
    log4js_1.default.configure(createLogConfig(global.lx.logPath));
};
exports.initLogger = initLogger;
exports.startupLog = log4js_1.default.getLogger('startup');
exports.syncLog = log4js_1.default.getLogger('sync');
exports.accessLog = log4js_1.default.getLogger('access');
exports.loginLog = log4js_1.default.getLogger('login');
exports.tokenLog = log4js_1.default.getLogger('token');
