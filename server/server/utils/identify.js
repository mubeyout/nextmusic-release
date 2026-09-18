"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getFingerprint = getFingerprint;
exports.lookupSong = lookupSong;
exports.identifyLocalSong = identifyLocalSong;
const child_process_1 = require("child_process");
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const fs_1 = __importDefault(require("fs"));
// @ts-ignore
const needle_1 = __importDefault(require("needle"));
/**
 * AcoustID 歌曲识别工具类
 */
// AcoustID 配置
const API_KEY = 'Ti0HHLDf9O';
const API_URL = 'https://api.acoustid.org/v2/lookup';
/**
 * 获取 fpcalc 二进制路径
 */
function getFpcalcPath() {
    // 1. 检查 PATH 中是否已存在 (例如 Linux/Docker 环境下安装了 chromaprint)
    const checkGlobal = (0, child_process_1.spawnSync)(os_1.default.platform() === 'win32' ? 'where' : 'which', ['fpcalc'], { encoding: 'utf8' });
    if (checkGlobal.status === 0) {
        return 'fpcalc';
    }
    // 2. 检查本地打包目录
    const platform = os_1.default.platform(); // win32, linux, darwin
    const arch = os_1.default.arch(); // x64, arm64
    // 构造可能的平台特定文件名
    let platformBinaryName = '';
    if (platform === 'win32') {
        platformBinaryName = `fpcalc-win-${arch === 'arm64' ? 'arm64' : 'x64'}.exe`;
    }
    else if (platform === 'linux') {
        if (arch === 'arm64')
            platformBinaryName = 'fpcalc-linux-arm64';
        else if (arch === 'arm')
            platformBinaryName = 'fpcalc-linux-arm';
        else
            platformBinaryName = 'fpcalc-linux-x64';
    }
    else if (platform === 'darwin') {
        platformBinaryName = 'fpcalc-macos';
    }
    const binDir = path_1.default.join(process.cwd(), 'public/music/bin');
    // 优先匹配带平台的名称
    if (platformBinaryName) {
        const platformPath = path_1.default.join(binDir, platformBinaryName);
        if (fs_1.default.existsSync(platformPath))
            return platformPath;
    }
    // 次优先匹配通用名称 (兼容旧版或手动放置)
    const genericName = platform === 'win32' ? 'fpcalc.exe' : 'fpcalc';
    const genericPath = path_1.default.join(binDir, genericName);
    if (fs_1.default.existsSync(genericPath))
        return genericPath;
    return null;
}
/**
 * 提取音频指纹
 */
function getFingerprint(filePath) {
    const fpcalcPath = getFpcalcPath();
    if (!fpcalcPath) {
        throw new Error('未找到 fpcalc 二进制文件。Docker 环境请安装 chromaprint (apk add chromaprint)');
    }
    const result = (0, child_process_1.spawnSync)(fpcalcPath, ['-json', filePath], { encoding: 'utf8' });
    if (result.error)
        throw new Error(`启动 fpcalc 失败: ${result.error.message}`);
    if (result.status !== 0)
        throw new Error(`fpcalc 报错: ${result.stderr}`);
    return JSON.parse(result.stdout);
}
/**
 * 查询 AcoustID
 */
async function lookupSong(fingerprint, duration) {
    const params = {
        format: 'json',
        client: API_KEY,
        duration: Math.floor(duration),
        fingerprint: fingerprint,
        meta: 'recordings releasegroups releases tracks'
    };
    try {
        const response = await (0, needle_1.default)('post', API_URL, params, {
            json: false,
            multipart: false
        });
        if (response.statusCode !== 200) {
            throw new Error(`AcoustID API 返回状态码 ${response.statusCode}`);
        }
        return response.body;
    }
    catch (error) {
        throw new Error(`AcoustID 查询失败: ${error.message}`);
    }
}
/**
 * 识别本地歌曲并返回格式化的结果
 */
async function identifyLocalSong(filePath) {
    const { fingerprint, duration } = getFingerprint(filePath);
    const data = await lookupSong(fingerprint, duration);
    if (!data.results || data.results.length === 0) {
        return [];
    }
    // 转换成统一格式
    const formattedResults = data.results.map((result) => {
        if (!result.recordings || result.recordings.length === 0) {
            return null;
        }
        const rec = result.recordings[0];
        const artists = rec.artists ? rec.artists.map((a) => a.name).join(', ') : '未知歌手';
        const album = (rec.releasegroups && rec.releasegroups.length > 0) ? rec.releasegroups[0].title : '';
        return {
            name: rec.title,
            singer: artists,
            album: album,
            score: result.score
        };
    }).filter(Boolean);
    // 按得分排序
    return formattedResults.sort((a, b) => b.score - a.score);
}
