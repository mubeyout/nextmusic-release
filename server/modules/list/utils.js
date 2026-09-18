"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildUserListInfoFull = void 0;
// 构建列表信息对象，用于统一字段位置顺序
const buildUserListInfoFull = ({ id, name, source, sourceListId, list, locationUpdateTime }) => {
    return {
        id,
        name,
        source,
        sourceListId,
        locationUpdateTime,
        list,
    };
};
exports.buildUserListInfoFull = buildUserListInfoFull;
