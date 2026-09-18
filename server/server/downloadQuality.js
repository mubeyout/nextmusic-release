"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveWithQualityFallback = exports.getDownloadQualityCandidates = exports.DOWNLOAD_QUALITY_PRIORITY = void 0;
exports.DOWNLOAD_QUALITY_PRIORITY = [
    'master',
    'atmos_plus',
    'atmos',
    'hires',
    'flac24bit',
    'flac',
    '320k',
    '192k',
    '128k',
];
const getDownloadQualityCandidates = (requestedQuality) => {
    const index = exports.DOWNLOAD_QUALITY_PRIORITY.indexOf(requestedQuality);
    if (index < 0)
        return [requestedQuality];
    return exports.DOWNLOAD_QUALITY_PRIORITY.slice(index);
};
exports.getDownloadQualityCandidates = getDownloadQualityCandidates;
const resolveWithQualityFallback = async (requestedQuality, resolve) => {
    const errors = [];
    for (const quality of (0, exports.getDownloadQualityCandidates)(requestedQuality)) {
        try {
            const result = await resolve(quality);
            if (!result?.url)
                throw new Error('cannot resolve download URL');
            return {
                result,
                quality: result.type || quality,
            };
        }
        catch (err) {
            errors.push(`${quality}: ${err?.message || 'resolve failed'}`);
        }
    }
    throw new Error(`Selected quality and all lower qualities failed (${errors.join('; ')})`);
};
exports.resolveWithQualityFallback = resolveWithQualityFallback;
