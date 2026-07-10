import fs from 'fs';
import vm from 'vm';
import crypto from 'crypto';

const code = fs.readFileSync(new URL('../js/core/pbkdf2-fallback.js', import.meta.url), 'utf8')
    + '\nglobalThis.__h = TVC_Pbkdf2.pbkdf2Hex("0000", "tvc-pms-salt-v2", 100000, 32);';
vm.runInThisContext(code);

const expected = crypto.pbkdf2Sync('0000', 'tvc-pms-salt-v2', 100000, 32, 'sha256').toString('hex');
const ok = globalThis.__h === expected;
console.log(ok ? 'PASS' : 'FAIL');
if (!ok) {
    console.log('expected', expected);
    console.log('got     ', globalThis.__h);
}
process.exit(ok ? 0 : 1);
