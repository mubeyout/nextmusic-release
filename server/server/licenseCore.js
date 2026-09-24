// licenseCore.js —— License/entitlement 底座(老板 0924 全案拍板,10 项按推荐)
// 形态:Ed25519 签名 entitlement;自托管=每实例独立密钥(首次启动生成,客户端 TOFU 锁定公钥);
// 托管平台=中心签发(未来内嵌平台公钥,同一验证路径)。签名密钥永不轮换(运维红线:丢失=该实例全部 license 失效)。
// tier: pro(¥58 买断)/family(¥12,seats≤6)/host(托管 ¥10 含 Pro 全权益)——features 按 tier 推导,支持细粒度覆盖。
// 部署两态:config.selfHostUnlocked(默认 true)=自托管全功能直通,门控层不拦;托管平台置 false 后 license 生效。
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

// ── 密钥管理(实例级,永不轮换) ──
let keypair = null; // {publicKey, privateKey}(KeyObject)
function keyPath() {
    const dataPath = process.env.DATA_PATH || path.join(process.cwd(), 'data');
    return path.join(dataPath, 'license_ed25519.key');
}
function ensureKeys() {
    if (keypair)
        return keypair;
    const p = keyPath();
    try {
        const raw = fs.readFileSync(p, 'utf-8').trim();
        // 从私钥推导公钥(规范做法,公钥不落盘)
        const privateKey = crypto.createPrivateKey(raw);
        keypair = { privateKey, publicKey: crypto.createPublicKey(privateKey) };
        return keypair;
    }
    catch (e) { /* 无私钥 → 首次生成 */ }
    try {
        const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
        const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, pem, { mode: 0o600 });
        console.log('[license] Ed25519 keypair generated (KEEP SAFE — 永不轮换,丢失=全部 license 失效)');
        keypair = { publicKey, privateKey };
        return keypair;
    }
    catch (e) {
        console.error('[license] key init failed:', e.message);
        return null;
    }
}
function publicKeyB64() {
    const k = ensureKeys();
    if (!k)
        return null;
    return k.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
}

// ── features 推导(门控口径 0924 定案) ──
// 客户端 Pro 9 候选 + 服务端门;基础播放/歌词/断点恢复永不入门(红线)
const TIER_FEATURES = {
    community: [], // 免费层=上游能力面+免费生态底座
    pro: ['eq_pro', 'lyrics_pro', 'webdav_backup', 'batch_offline', 'progress_roam', 'theme_store', 'tv_enhance', 'carlink_pro'],
    family: [], // 由 pro 推导+共享组
    host: ['*'], // 托管 ¥10:Pro 全权益+托管能力(细粒度后续按需收)
};
function featuresFor(tier, extra) {
    const base = tier === 'family' ? [...TIER_FEATURES.pro] : [...(TIER_FEATURES[tier] || [])];
    if (tier === 'family')
        base.push('sharedlib_family');
    if (Array.isArray(extra))
        base.push(...extra);
    return base;
}

// ── entitlement 签发/验证 ──
function canonicalJson(obj) {
    // 稳定序列化(键排序,数组保序)——签名双方必须字节一致
    if (obj === null || typeof obj !== 'object')
        return JSON.stringify(obj);
    if (Array.isArray(obj))
        return '[' + obj.map(canonicalJson).join(',') + ']';
    return '{' + Object.keys(obj).sort().map(k => JSON.stringify(k) + ':' + canonicalJson(obj[k])).join(',') + '}';
}
/** 签发(登录激活成功后调用):payload+Ed25519 签名 → {payload, sig, alg:'ed25519', serverPubkey} */
function signEntitlement(payload) {
    const k = ensureKeys();
    if (!k)
        throw new Error('license key unavailable');
    const body = canonicalJson(payload);
    const sig = crypto.sign(null, Buffer.from(body, 'utf-8'), k.privateKey);
    return { payload, sig: sig.toString('base64'), alg: 'ed25519', serverPubkey: publicKeyB64() };
}
/** 验证(客户端上报回服务器复核/调试用) */
function verifyEntitlement(ent) {
    try {
        const k = ensureKeys();
        const body = Buffer.from(canonicalJson(ent.payload), 'utf-8');
        return crypto.verify(null, body, k.publicKey, Buffer.from(ent.sig, 'base64'));
    }
    catch (e) {
        return false;
    }
}

// ── license 记录管理(data/licenses.json) ──
function storePath() {
    const dataPath = process.env.DATA_PATH || path.join(process.cwd(), 'data');
    return path.join(dataPath, 'licenses.json');
}
function readAll() {
    try {
        return JSON.parse(fs.readFileSync(storePath(), 'utf-8'));
    }
    catch (e) {
        return {};
    }
}
function writeAll(all) {
    fs.mkdirSync(path.dirname(storePath()), { recursive: true });
    fs.writeFileSync(storePath(), JSON.stringify(all, null, 2));
}
/** 生成展示用 key: NM-XXXXX-XXXXX-XXXXX */
function newLicenseKey() {
    const seg = () => crypto.randomBytes(3).toString('hex').toUpperCase().slice(0, 5);
    return `NM-${seg()}-${seg()}-${seg()}`;
}
/** admin 创建 license(人工发放:爱发电→后台发 key) */
function createLicense({ tier, seats, maxDevices, features, note }) {
    const all = readAll();
    const key = newLicenseKey();
    all[key] = {
        key, tier: tier || 'pro',
        seats: tier === 'family' ? Math.min(Number(seats) || 6, 6) : 1,
        maxDevices: Math.min(Number(maxDevices) || 5, 10),
        features: featuresFor(tier, features),
        note: note || '',
        boundAccount: null, activatedAt: null,
        revoked: false, createdAt: Date.now(), exp: null, // exp=null 永久(买断口径)
        devices: [],
    };
    writeAll(all);
    return all[key];
}
/** 激活:绑定账号+登记设备(超 maxDevices 拒新);返回 entitlement 签名包 */
function activate(key, account, installId, deviceName) {
    const all = readAll();
    const lic = all[key];
    if (!lic)
        return { ok: false, code: 404, reason: 'license 不存在' };
    if (lic.revoked)
        return { ok: false, code: 403, reason: 'license 已吊销' };
    if (lic.exp && Date.now() > lic.exp)
        return { ok: false, code: 403, reason: 'license 已过期' };
    if (lic.boundAccount && lic.boundAccount !== account)
        return { ok: false, code: 403, reason: `license 已绑定账号 ${lic.boundAccount}` };
    if (!lic.boundAccount) {
        lic.boundAccount = account;
        lic.activatedAt = Date.now();
    }
    // 设备登记(LRU:lastAt 刷新;超限拒新,用户可在 app/后台删设备)
    let dev = lic.devices.find(d => d.installId === installId);
    if (!dev) {
        if (lic.devices.length >= lic.maxDevices)
            return { ok: false, code: 403, reason: `设备数已达上限(${lic.maxDevices}),请先在设备管理移除旧设备` };
        dev = { installId, name: deviceName || '未命名设备', firstAt: Date.now() };
        lic.devices.push(dev);
    }
    dev.lastAt = Date.now();
    writeAll(all);
    const ent = signEntitlement({
        v: 1, key, tier: lic.tier, features: lic.features, seats: lic.seats,
        account, device: { installId, name: dev.name },
        iat: Date.now(), exp: lic.exp, // 永久=exp:null(随 license 吊销失效,复核用 revokedAt)
    });
    return { ok: true, ent };
}
/** 复核(客户端定期/离线宽限期过后重验):吊销/过期检查 */
function revalidate(key, account, installId) {
    const lic = readAll()[key];
    if (!lic || lic.revoked || (lic.exp && Date.now() > lic.exp))
        return { ok: false, reason: 'license 已失效' };
    if (lic.boundAccount !== account)
        return { ok: false, reason: 'license 与账号不匹配' };
    if (!lic.devices.some(d => d.installId === installId))
        return { ok: false, reason: '设备未登记' };
    return { ok: true };
}
function byAccount(account) {
    const all = readAll();
    return Object.values(all).filter(l => l.boundAccount === account && !l.revoked)
        .map(l => ({ key: l.key, tier: l.tier, seats: l.seats, features: l.features, maxDevices: l.maxDevices, devices: l.devices, exp: l.exp, activatedAt: l.activatedAt }));
}
function removeDevice(key, installId) {
    const all = readAll();
    const lic = all[key];
    if (!lic)
        return false;
    const before = lic.devices.length;
    lic.devices = lic.devices.filter(d => d.installId !== installId);
    writeAll(all);
    return lic.devices.length < before;
}
function revoke(key) {
    const all = readAll();
    if (!all[key])
        return false;
    all[key].revoked = true;
    writeAll(all);
    return true;
}

/** 门控执行:自托管直通(两态),托管侧按 feature 检查——挂 API 入口用 */
function checkFeature(account, feature) {
    if (global.lx.config['license.selfHostUnlocked'] !== false)
        return { ok: true }; // 自托管全开(默认)
    const lics = byAccount(account);
    if (lics.some(l => l.features.includes('*') || l.features.includes(feature)))
        return { ok: true };
    return { ok: false, reason: '此功能需要 Pro 授权', feature };
}

module.exports = {
    publicKeyB64, signEntitlement, verifyEntitlement,
    createLicense, activate, revalidate, byAccount, removeDevice, revoke,
    checkFeature, featuresFor, readAll,
};
