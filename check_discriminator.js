const crypto = require('crypto');

function toSnakeCase(s) { 
  return s.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '');
}

const first8 = [0x75, 0xbb, 0xa5, 0xae, 0xc2, 0x1c, 0x77, 0x4c];
console.log('Account data first 8 bytes:', first8.map(b => '0x' + b.toString(16).padStart(2, '0')).join(' '));

['BetAccount', 'Table', 'TableAccount', 'GlobalConfig'].forEach(acc => {
  const hash = crypto.createHash('sha256').update('account:' + toSnakeCase(acc)).digest();
  console.log(acc + ' discriminator:', Array.from(hash.slice(0,8)).map(b => '0x' + b.toString(16).padStart(2, '0')).join(' '));
});
