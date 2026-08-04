/* Generate Ed25519 keypair for Pilot license signing */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const keyDir = path.join(__dirname, '..', 'electron', 'keys');
fs.mkdirSync(keyDir, { recursive: true });

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const pubPem = publicKey.export({ type: 'spki', format: 'pem' });
const privPem = privateKey.export({ type: 'pkcs8', format: 'pem' });

const pubPath = path.join(keyDir, 'public.pem');
const privPath = path.join(keyDir, 'private.pem');

if (fs.existsSync(pubPath) && fs.existsSync(privPath) && !process.argv.includes('--force')) {
    console.log('Keys already exist. Use --force to overwrite.');
    process.exit(0);
}

fs.writeFileSync(pubPath, pubPem);
fs.writeFileSync(privPath, privPem);
console.log('Wrote', pubPath);
console.log('Wrote', privPath);
console.log('Keep private.pem out of git / distribution packages.');
