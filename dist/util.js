"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.has = exports.wrapInBracesIfNeeded = void 0;
function wrapInBracesIfNeeded(value) {
    if (!value.startsWith('{') && !value.endsWith('}')) {
        return `{${value}}`;
    }
    return value;
}
exports.wrapInBracesIfNeeded = wrapInBracesIfNeeded;
function has(object, property) {
    return Object.prototype.hasOwnProperty.call(object, property);
}
exports.has = has;
//# sourceMappingURL=util.js.map