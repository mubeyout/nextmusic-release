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
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.callObj = exports.modules = exports.sync = void 0;
const handler_1 = __importDefault(require("./handler"));
const modules_1 = require("../../modules");
var sync_1 = require("./sync");
Object.defineProperty(exports, "sync", { enumerable: true, get: function () { return sync_1.sync; } });
var modules_2 = require("../../modules");
Object.defineProperty(exports, "modules", { enumerable: true, get: function () { return modules_2.modules; } });
__exportStar(require("./event"), exports);
exports.callObj = {
    ...handler_1.default,
    ...modules_1.callObj,
};
