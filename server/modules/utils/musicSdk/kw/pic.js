"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const request_1 = require("../../request");
const util_1 = require("./util");
exports.default = {
    getPic({ songmid }) {
        const requestObj = (0, request_1.httpFetch)(`http://artistpicserver.kuwo.cn/pic.web?corp=kuwo&type=rid_pic&pictype=1000&size=1000&rid=${songmid}`);
        requestObj.promise = requestObj.promise.then(({ body }) => /^http/.test(body) ? (0, util_1.formatPic)(body) : null);
        return requestObj.promise;
    },
};
