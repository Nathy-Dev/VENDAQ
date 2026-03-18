import { useMultiFileAuthState as getMultiFileAuthState } from '@whiskeysockets/baileys';
console.log('Successfully imported and aliased getMultiFileAuthState');
if (typeof getMultiFileAuthState === 'function') {
    console.log('getMultiFileAuthState is a function');
} else {
    console.log('getMultiFileAuthState is NOT a function');
}
