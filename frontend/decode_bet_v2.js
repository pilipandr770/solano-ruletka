// Decode bet account raw data - manual without imports
const hex = '75bba5aec21c774cd60846dd622d1f107722ce07b9888dda33c1dfa8ef170373d7f2577e40771cf2c5502bf0a5b1819da0139e670cc197926ee52a9ddae74204f85f4672357f4bfb010000000000000023002400000000000000000e00ece85369000000000e41f780e9906f0dc7dcb637a35a48e0610477a6256dbbfb6375e79e019b6792f5cf047dce5637b26a5b31bc99f6defd668191134e5678aa8a90259748c12e32000000';
const data = Buffer.from(hex, 'hex');

const bs58 = require('bs58');

console.log('Total length:', data.length, 'bytes');

// Discriminator
const disc = data.slice(0, 8);
console.log('Discriminator:', disc.toString('hex'));

let o = 8;
const table = bs58.encode(data.slice(o, o + 32)); o += 32;
const player = bs58.encode(data.slice(o, o + 32)); o += 32;

console.log('Table:', table);
console.log('Player:', player);

const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
const stake = view.getBigUint64(o, true); o += 8;
console.log('Stake:', stake.toString());

const multiplier = view.getUint16(o, true); o += 2;
console.log('Multiplier:', multiplier);

const maxTotalPayout = view.getBigUint64(o, true); o += 8;
console.log('MaxPayout:', maxTotalPayout.toString());

console.log('Offset after maxPayout:', o);

const kindTag = view.getUint8(o); o += 1;
console.log('KindTag:', kindTag);

// Assuming payload is 1 byte for tag 11 (Dozen)
const payload = view.getUint8(o); o += 1;
console.log('Payload:', payload);

const state = view.getUint8(o); o += 1;
console.log('State:', state);

const createdTs = view.getBigInt64(o, true); o += 8;
console.log('CreatedTs:', createdTs.toString());

const force = data.slice(o, o + 32); o += 32;
console.log('Force:', force.toString('hex'));

const randomnessAccount = bs58.encode(data.slice(o, o + 32)); o += 32;
console.log('RandomnessAccount:', randomnessAccount);

const resultNumberOpt = view.getUint8(o); o += 1;
console.log('ResultNumberOpt:', resultNumberOpt);

if (resultNumberOpt === 1) {
    const resultNumber = view.getUint8(o); o += 1;
    console.log('ResultNumber:', resultNumber);
}
