"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const util_1 = require("./util");
exports.default = {
    requestObj: null,
    cancelTipSearch() {
        if (this.requestObj && this.requestObj.cancelHttp)
            this.requestObj.cancelHttp();
    },
    tipSearchBySong(str) {
        this.cancelTipSearch();
        this.requestObj = (0, util_1.createHttpFetch)(`https://searchtip.kugou.com/getSearchTip?MusicTipCount=10&keyword=${encodeURIComponent(str)}`, {
            headers: {
                referer: 'https://www.kugou.com/',
            },
        });
        return this.requestObj.then(body => {
            return body[0].RecordDatas;
        });
    },
    handleResult(rawData) {
        return rawData.map(info => info.HintInfo);
    },
    async search(str) {
        return this.tipSearchBySong(str).then(result => this.handleResult(result));
    },
};
