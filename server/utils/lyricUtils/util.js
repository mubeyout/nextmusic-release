"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.decodeName = void 0;
const encodeNames = {
    '&nbsp;': ' ',
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&apos;': "'",
    '&#039;': "'",
};
const decodeName = (str = '') => {
    return str?.replace(/(?:&amp;|&lt;|&gt;|&quot;|&apos;|&#039;|&nbsp;)/gm, (s) => encodeNames[s]) ?? '';
};
exports.decodeName = decodeName;
