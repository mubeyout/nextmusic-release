"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// import { httpFetch } from '../../request'
const musicInfo_1 = require("./musicInfo");
const getSongId = async (mInfo) => {
    if (mInfo.songmid != mInfo.copyrightId)
        return mInfo.songmid;
    const musicInfo = await (0, musicInfo_1.getMusicInfo)(mInfo.copyrightId);
    return musicInfo.songmid;
};
// export const getSongId = async(musicInfo, retry = 0) => {
//   if (musicInfo.songmid != musicInfo.copyrightId) return musicInfo.songmid
//   if (++retry > 2) return Promise.reject(new Error('max retry'))
//   const requestObj = httpFetch(`https://app.c.nf.migu.cn/MIGUM2.0/v2.0/content/listen-url?netType=00&resourceType=2&songId=${musicInfo.copyrightId}&toneFlag=PQ`, {
//     headers: {
//       'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/69.0.3497.100 Safari/537.36',
//       channel: '0146921',
//     },
//   })
//   return requestObj.promise.then(({ body }) => {
//     console.log(body)
//     if (!body || body.code !== '000000') return this.getSongId(musicInfo, retry)
//     const id = body.data.songItem.songId
//     if (!id) throw new Error('failed')
//     return id
//   })
// }
exports.default = getSongId;
