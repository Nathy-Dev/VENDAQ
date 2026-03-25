"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const baileys_1 = require("@whiskeysockets/baileys");
console.log('Successfully imported and aliased getMultiFileAuthState');
if (typeof baileys_1.useMultiFileAuthState === 'function') {
    console.log('getMultiFileAuthState is a function');
}
else {
    console.log('getMultiFileAuthState is NOT a function');
}
