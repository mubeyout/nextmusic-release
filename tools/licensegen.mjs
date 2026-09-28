#!/usr/bin/env node
// tools/licensegen.mjs —— 发码器 CLI(D1a 0928:面包多卡密批量生成,禁止部署——离线工具)
// 码格式: licenseCore.signCompact 紧凑编码 = b64u(canonicalJson(payload)) + '.' + b64u(Ed25519 sig)
//   直接复用 licenseCore 现有 canonicalJson 序列化/签名路径(与 signEntitlement 字节一致),验签同径 verifyCompact。
// 私钥: --key 路径 > 环境变量 NEXTMUSIC_LICENSE_KEY/LICENSE_KEY > ~/.nextmusic/license-key.pem;
//   不存在则生成新钥对并打印公钥指纹+安全警告(签发钥永不轮换红线——丢失=已发码全部无法补签)。
// 幂等安全: 绝不覆盖已有输出文件。
//
// 用法示例:
//   node tools/licensegen.mjs --tier pro --count 3 --out pro-codes.txt
//   node tools/licensegen.mjs --tier family --count 2 --out family-codes.txt
//   node tools/licensegen.mjs --tier m1_beta --count 1 --out m1-codes.txt
//   node tools/licensegen.mjs --trial 7 --count 1 --out trial-codes.txt   (或 --tier trial,天数默认 7)
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const licenseCore = require(path.join(here, '..', 'server', 'server', 'licenseCore.js'));

const SELLABLE_TIERS = ['pro', 'family', 'm1_beta', 'trial']; // free 不发码;host/community 已废
const DAY_MS = 86400000;

function die(msg, code = 1) {
    console.error(`[licensegen] ✗ ${msg}`);
    process.exit(code);
}

function parseArgs(argv) {
    const args = { count: 1 };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        const next = () => (i + 1 < argv.length ? argv[++i] : undefined);
        const nextNumber = () => {
            const v = next();
            return v !== undefined && !Number.isNaN(Number(v)) ? Number(v) : undefined;
        };
        if (a === '--tier')
            args.tier = next();
        else if (a === '--count')
            args.count = nextNumber();
        else if (a === '--out')
            args.out = next();
        else if (a === '--key')
            args.key = next();
        else if (a === '--trial') {
            const peek = argv[i + 1];
            if (peek !== undefined && !Number.isNaN(Number(peek)))
                args.trial = Number(next());
            else
                args.trial = 7; // 天数可选,默认 7
        }
        else if (a === '--help' || a === '-h')
            args.help = true;
        else
            die(`未知参数: ${a}(--help 查看用法)`);
    }
    return args;
}

function usage() {
    console.log(`用法: node tools/licensegen.mjs --tier pro|family|m1_beta [--count N] --out file [--key pemPath]
      node tools/licensegen.mjs --trial [days] [--count N] --out file   # tier=trial,默认 7 天
私钥: --key > $NEXTMUSIC_LICENSE_KEY > $LICENSE_KEY > ~/.nextmusic/license-key.pem(缺则生成新钥对)`);
}

function resolveKeyPath(cliKey) {
    if (cliKey)
        return cliKey;
    if (process.env.NEXTMUSIC_LICENSE_KEY)
        return process.env.NEXTMUSIC_LICENSE_KEY;
    if (process.env.LICENSE_KEY)
        return process.env.LICENSE_KEY;
    return path.join(process.env.HOME || process.env.USERPROFILE || '.', '.nextmusic', 'license-key.pem');
}

function loadOrCreatePrivateKey(keyPath) {
    try {
        const raw = fs.readFileSync(keyPath, 'utf-8').trim();
        return { privateKey: crypto.createPrivateKey(raw), created: false, keyPath };
    }
    catch (e) { /* 无私钥 → 生成新钥对 */ }
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    fs.mkdirSync(path.dirname(keyPath), { recursive: true });
    fs.writeFileSync(keyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
    const der = publicKey.export({ type: 'spki', format: 'der' });
    const fp = crypto.createHash('sha256').update(der).digest('hex');
    console.error(`[licensegen] 新钥对已生成: ${keyPath}(mode 600)`);
    console.error(`[licensegen] 公钥指纹(SHA-256/SPKI DER): ${fp}`);
    console.error(`[licensegen] 公钥(SPKI base64,兑换端验签用): ${der.toString('base64')}`);
    console.error('[licensegen] ⚠️ 安全警告: 私钥=发码权柄,严禁泄露/提交仓库/多人传递;永不轮换——丢失=已发码全部无法补签!');
    return { privateKey, created: true, keyPath };
}

/** 签名码载荷:与 activate() entitlement 同构(去 account/device——兑换时绑定) */
function makePayload(tier, trialDays) {
    const now = Date.now();
    return {
        v: 2,
        jti: licenseCore.newLicenseKey(), // NM-XXXXX-XXXXX-XXXXX(展示/兑换索引)
        tier,
        features: licenseCore.featuresPayloadMap(licenseCore.featuresFor(tier)), // 布尔节(五源恒真)
        limits: licenseCore.tierLimits(tier), // 数值节(缺省/-1=不限,本期不执法)
        seats: tier === 'family' ? 6 : 1,
        iat: now,
        exp: tier === 'trial' ? now + trialDays * DAY_MS : null, // trial=限时;pro/family/m1_beta=perpetual 买断
    };
}

// ── main ──
const args = parseArgs(process.argv.slice(2));
if (args.help) {
    usage();
    process.exit(0);
}
let tier = args.tier;
let trialDays = 7;
if (args.trial !== undefined) {
    tier = 'trial';
    trialDays = args.trial || 7;
}
if (!tier)
    die('缺少 --tier pro|family|m1_beta(试用改用 --trial [天])');
if (!SELLABLE_TIERS.includes(tier))
    die(`不支持发码 tier: ${tier}(可发: ${SELLABLE_TIERS.join('/')}——free 不发码)`);
const count = Number(args.count);
if (!Number.isInteger(count) || count < 1)
    die(`--count 须为 ≥1 整数,收到: ${args.count}`);
if (!args.out)
    die('缺少 --out 输出文件路径');
if (fs.existsSync(args.out))
    die(`输出文件已存在,拒绝覆盖(幂等安全): ${args.out}`);

const { privateKey, created, keyPath } = loadOrCreatePrivateKey(resolveKeyPath(args.key));
const codes = [];
for (let i = 0; i < count; i++)
    codes.push(licenseCore.signCompact(makePayload(tier, trialDays), privateKey));

// 自验回读:坏码不出门(verifyCompact 与服务端兑换同径)
const pub = crypto.createPublicKey(privateKey);
for (const c of codes) {
    const p = licenseCore.verifyCompact(c, pub);
    if (!p || p.tier !== tier)
        die(`自验失败,拒写文件(tier=${tier})`);
}

fs.writeFileSync(args.out, codes.join('\n') + '\n'); // 面包多卡密导入格式:每行一码
console.error(`[licensegen] ✓ tier=${tier}${tier === 'trial' ? `(${trialDays}天)` : '(perpetual)'} ×${count} → ${args.out}`);
console.error(`[licensegen] 自验回读 ${codes.length}/${codes.length} 通过;钥: ${keyPath}${created ? '(新生成)' : ''}`);
