"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const lru_cache_1 = require("lru-cache");
exports.default = {
    store: new lru_cache_1.LRUCache({
        max: 10000,
        ttl: 1000 * 60 * 60 * 24 * 2,
        // updateAgeOnGet: true,
    }),
    get(key) {
        return this.store.get(key);
    },
    set(key, value) {
        return this.store.set(key, value);
    },
    has(key) {
        return this.store.has(key);
    },
    delete(key) {
        return this.store.delete(key);
    },
    clear() {
        this.store.clear();
    },
};
