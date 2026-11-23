// Chiffrement HTTPS : certificat fourni par le service informatique, ou certificat auto-signé généré automatiquement.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

// Noms et adresses par lesquels le serveur peut être joint (inclus dans le certificat auto-signé)
function serverNames(extra = '') {
  const dns = new Set(['localhost', os.hostname()]);
  const ips = new Set(['127.0.0.1']);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) if (i.family === 'IPv4' || i.family === 4) ips.add(i.address);
  }
  for (const n of String(extra).split(',').map((s) => s.trim()).filter(Boolean)) {
    (/^\d{1,3}(\.\d{1,3}){3}$/.test(n) ? ips : dns).add(n);
  }
  // Seuls les noms DNS valides (lettres sans accent, chiffres, points, tirets) peuvent figurer dans le certificat
  return { dns: [...dns].filter((n) => /^[A-Za-z0-9]([A-Za-z0-9-]{0,62})(\.[A-Za-z0-9]([A-Za-z0-9-]{0,62}))*$/.test(n)).sort(), ips: [...ips].sort() };
}
const lanAddresses = () => serverNames().ips.filter((ip) => ip !== '127.0.0.1');

const CERT_FORMAT = 3; // incrémenté si la façon de générer le certificat change (régénération automatique)
const fingerprint = (certPem) => new crypto.X509Certificate(certPem).fingerprint256;

// Certificat auto-signé : réutilisé tant qu'il couvre toutes les adresses actuelles et n'expire pas dans les 30 jours
function ensureSelfSigned(dir, extraNames) {
  fs.mkdirSync(dir, { recursive: true });
  const certFile = path.join(dir, 'cert.pem'), keyFile = path.join(dir, 'key.pem'), metaFile = path.join(dir, 'cert-info.json');
  const names = serverNames(extraNames);
  try {
    const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
    const cert = fs.readFileSync(certFile, 'utf8'), key = fs.readFileSync(keyFile, 'utf8');
    if (meta.format !== CERT_FORMAT) throw new Error('ancien format');
    const covered = names.dns.every((n) => meta.dns.includes(n)) && names.ips.every((n) => meta.ips.includes(n));
    const valid = new Date(new crypto.X509Certificate(cert).validTo) - Date.now() > 30 * 86400000;
    if (covered && valid) return { cert, key, names: meta, regenerated: false, fingerprint: fingerprint(cert), certFile };
  } catch { /* pas encore de certificat */ }
  const selfsigned = require('selfsigned');
  // Attention : noms en ASCII uniquement (un accent rend le certificat invalide pour Chrome : ERR_SSL_SERVER_CERT_BAD_FORMAT)
  const pems = selfsigned.generate([{ name: 'commonName', value: 'Application Quiz' }, { name: 'organizationName', value: 'Application Quiz (self-signed)' }], {
    days: 397, keySize: 2048, algorithm: 'sha256',
    extensions: [
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
      { name: 'extKeyUsage', serverAuth: true },
      { name: 'subjectAltName', altNames: [...names.dns.map((value) => ({ type: 2, value })), ...names.ips.map((ip) => ({ type: 7, ip }))] },
    ],
  });
  fs.writeFileSync(keyFile, pems.private, { mode: 0o600 });
  fs.writeFileSync(certFile, pems.cert);
  fs.writeFileSync(metaFile, JSON.stringify({ ...names, format: CERT_FORMAT, createdAt: new Date().toISOString() }, null, 2));
  return { cert: pems.cert, key: pems.private, names, regenerated: true, fingerprint: fingerprint(pems.cert), certFile };
}

// Certificat fourni (fichiers PEM) : vérifié au démarrage pour donner un message clair en cas de problème
function loadProvided(certPath, keyPath) {
  let cert, key;
  try { cert = fs.readFileSync(certPath, 'utf8'); } catch (e) { throw new Error(`certificat introuvable : ${certPath} (${e.code})`); }
  try { key = fs.readFileSync(keyPath, 'utf8'); } catch (e) { throw new Error(`clé privée introuvable : ${keyPath} (${e.code})`); }
  const x = new crypto.X509Certificate(cert);
  if (!x.checkPrivateKey(crypto.createPrivateKey(key))) throw new Error('la clé privée ne correspond pas au certificat');
  if (new Date(x.validTo) < new Date()) throw new Error(`certificat expiré depuis le ${new Date(x.validTo).toLocaleDateString('fr-FR')}`);
  return { cert, key, fingerprint: x.fingerprint256, subject: x.subjectAltName || x.subject, validTo: x.validTo };
}

module.exports = { ensureSelfSigned, loadProvided, lanAddresses };
