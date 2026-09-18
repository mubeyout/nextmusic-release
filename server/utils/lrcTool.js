"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseLyrics = exports.buildLyrics = void 0;
const timeFieldExp = /^(?:\[[\d:.]+\])+/g;
const timeExp = /\d{1,3}(:\d{1,3}){0,2}(?:\.\d{1,3})/g;
const t_rxp_1 = /^0+(\d+)/;
const t_rxp_2 = /:0+(\d+)/g;
const t_rxp_3 = /\.0+(\d+)/;
const formatTimeLabel = (label) => {
    return label.replace(t_rxp_1, '$1')
        .replace(t_rxp_2, ':$1')
        .replace(t_rxp_3, '.$1');
};
const filterExtendedLyricLabel = (lrcTimeLabels, extendedLyric) => {
    const extendedLines = extendedLyric.split(/\r\n|\n|\r/);
    const lines = [];
    for (let i = 0; i < extendedLines.length; i++) {
        let line = extendedLines[i].trim();
        let result = timeFieldExp.exec(line);
        if (!result)
            continue;
        const timeField = result[0];
        const text = line.replace(timeFieldExp, '').trim();
        if (!text)
            continue;
        let times = timeField.match(timeExp);
        if (times == null)
            continue;
        const newTimes = times.filter((time) => {
            const timeStr = formatTimeLabel(time);
            return lrcTimeLabels.has(timeStr);
        });
        if (newTimes.length != times.length) {
            if (!newTimes.length)
                continue;
            line = `[${newTimes.join('][')}]${text}`;
        }
        lines.push(line);
    }
    return lines.join('\n');
};
const parseLrcTimeLabel = (lrc) => {
    const lines = lrc.split(/\r\n|\n|\r/);
    const linesSet = new Set();
    const length = lines.length;
    for (let i = 0; i < length; i++) {
        const line = lines[i].trim();
        let result = timeFieldExp.exec(line);
        if (result) {
            const timeField = result[0];
            const text = line.replace(timeFieldExp, '').trim();
            if (text) {
                const times = timeField.match(timeExp);
                if (times == null)
                    continue;
                for (let time of times) {
                    linesSet.add(formatTimeLabel(time));
                }
            }
        }
    }
    return linesSet;
};
const buildAwlyric = (lrcData) => {
    let lrc = [];
    if (lrcData.lyric) {
        lrc.push(`lrc:${Buffer.from(lrcData.lyric.trim(), 'utf-8').toString('base64')}`);
    }
    if (lrcData.tlyric) {
        lrc.push(`tlrc:${Buffer.from(lrcData.tlyric.trim(), 'utf-8').toString('base64')}`);
    }
    if (lrcData.rlyric) {
        lrc.push(`rlrc:${Buffer.from(lrcData.rlyric.trim(), 'utf-8').toString('base64')}`);
    }
    if (lrcData.lxlyric) {
        lrc.push(`awlrc:${Buffer.from(lrcData.lxlyric.trim(), 'utf-8').toString('base64')}`);
    }
    return lrc.length ? `[awlrc:${lrc.join(',')}]` : '';
};
const buildLyrics = (lrcData, downloadAwlrc = true, downloadTlrc = true, downloadRlrc = true) => {
    const data = {
        lyric: lrcData.lyric || lrcData.lrc || '',
        tlyric: lrcData.tlyric || '',
        rlyric: lrcData.rlyric || '',
        lxlyric: lrcData.lxlyric || lrcData.klyric || '',
    };
    if (!data.tlyric && !data.rlyric && !data.lxlyric)
        return data.lyric;
    const lrcTimeLabels = parseLrcTimeLabel(data.lyric || '');
    let lrc = data.lyric || '';
    if (downloadTlrc && data.tlyric) {
        lrc = lrc.trim() + `\n\n${filterExtendedLyricLabel(lrcTimeLabels, data.tlyric)}\n`;
    }
    if (downloadRlrc && data.rlyric) {
        lrc = lrc.trim() + `\n\n${filterExtendedLyricLabel(lrcTimeLabels, data.rlyric)}\n`;
    }
    if (downloadAwlrc) {
        const awlrc = buildAwlyric(data);
        if (awlrc)
            lrc = lrc.trim() + `\n\n${awlrc}\n`;
    }
    return lrc;
};
exports.buildLyrics = buildLyrics;
const parseLyrics = (lrc) => {
    const obj = {
        lyric: '',
        tlyric: '',
        rlyric: '',
        lxlyric: '',
    };
    const awlrcReg = /\[awlrc:(.+)\]/;
    const result = lrc.match(awlrcReg);
    if (result) {
        const awlrc = result[1];
        const pairs = awlrc.split(',');
        for (const pair of pairs) {
            const [type, data] = pair.split(':');
            const content = Buffer.from(data, 'base64').toString('utf-8');
            switch (type) {
                case 'lrc':
                    obj.lyric = content;
                    break;
                case 'tlrc':
                    obj.tlyric = content;
                    break;
                case 'rlrc':
                    obj.rlyric = content;
                    break;
                case 'awlrc':
                    obj.lxlyric = content;
                    break;
            }
        }
    }
    else {
        // Fallback for regular LRC without [awlrc:] tag
        // Try to split by \n\n if it was built using buildLyrics without awlrc
        const segments = lrc.split('\n\n');
        if (segments.length > 1) {
            obj.lyric = segments[0];
            // This is a bit fragile, so we only do it if the first segment looks like LRC
            if (!segments[0].includes('[00:')) {
                obj.lyric = lrc;
            }
            else {
                // Determine if other segments are translations or romaji
                for (let i = 1; i < segments.length; i++) {
                    const seg = segments[i].trim();
                    if (!seg)
                        continue;
                    if (seg.startsWith('[awlrc:'))
                        continue;
                    // We don't have a good way to tell them apart without the tag,
                    // so we just put them in tlyric if it's empty
                    if (!obj.tlyric)
                        obj.tlyric = seg;
                    else if (!obj.rlyric)
                        obj.rlyric = seg;
                }
            }
        }
        else {
            obj.lyric = lrc;
        }
    }
    // Add aliases for compatibility
    obj.lrc = obj.lyric;
    obj.klyric = obj.lxlyric;
    return obj;
};
exports.parseLyrics = parseLyrics;
