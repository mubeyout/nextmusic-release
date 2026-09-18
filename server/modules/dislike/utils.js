"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.filterRules = void 0;
const constants_1 = require("../../constants");
const filterRules = (rules) => {
    const list = [];
    for (const item of rules.split('\n')) {
        if (!item)
            continue;
        let [name, singer] = item.split(constants_1.SPLIT_CHAR.DISLIKE_NAME);
        if (name) {
            name = name.replaceAll(constants_1.SPLIT_CHAR.DISLIKE_NAME, constants_1.SPLIT_CHAR.DISLIKE_NAME_ALIAS).toLocaleLowerCase().trim();
            if (singer) {
                singer = singer.replaceAll(constants_1.SPLIT_CHAR.DISLIKE_NAME, constants_1.SPLIT_CHAR.DISLIKE_NAME_ALIAS).toLocaleLowerCase().trim();
                list.push(`${name}${constants_1.SPLIT_CHAR.DISLIKE_NAME}${singer}`);
            }
            else {
                list.push(name);
            }
        }
        else if (singer) {
            singer = singer.replaceAll(constants_1.SPLIT_CHAR.DISLIKE_NAME, constants_1.SPLIT_CHAR.DISLIKE_NAME_ALIAS).toLocaleLowerCase().trim();
            list.push(`${constants_1.SPLIT_CHAR.DISLIKE_NAME}${singer}`);
        }
    }
    return new Set(list);
};
exports.filterRules = filterRules;
