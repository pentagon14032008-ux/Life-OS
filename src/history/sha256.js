// Minimal SHA-256 (sync) implementation for integrity chain.
// Based on public-domain style reference implementations (compact, no deps).
function rotr(n, x){ return (x >>> n) | (x << (32 - n)); }
function ch(x,y,z){ return (x & y) ^ (~x & z); }
function maj(x,y,z){ return (x & y) ^ (x & z) ^ (y & z); }
function Sigma0(x){ return rotr(2,x) ^ rotr(13,x) ^ rotr(22,x); }
function Sigma1(x){ return rotr(6,x) ^ rotr(11,x) ^ rotr(25,x); }
function sigma0(x){ return rotr(7,x) ^ rotr(18,x) ^ (x>>>3); }
function sigma1(x){ return rotr(17,x) ^ rotr(19,x) ^ (x>>>10); }

const K = new Uint32Array([
  0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
  0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
  0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
  0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
  0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
  0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
  0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
  0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
]);

function toBytes(str){
  const enc = new TextEncoder();
  return enc.encode(str);
}

function bytesToHex(bytes){
  let out = "";
  for (let i=0;i<bytes.length;i++){
    out += bytes[i].toString(16).padStart(2,"0");
  }
  return out;
}

export function sha256Hex(message){
  const msg = toBytes(String(message));
  const l = msg.length;
  const bitLenHi = Math.floor((l * 8) / 0x100000000);
  const bitLenLo = (l * 8) >>> 0;

  // padding: 1 bit + zeros + 64-bit length
  const withOne = l + 1;
  const padLen = (withOne % 64 <= 56) ? (56 - (withOne % 64)) : (56 + (64 - (withOne % 64)));
  const total = withOne + padLen + 8;
  const buf = new Uint8Array(total);
  buf.set(msg,0);
  buf[l] = 0x80;
  // length big-endian
  const dv = new DataView(buf.buffer);
  dv.setUint32(total-8, bitLenHi, false);
  dv.setUint32(total-4, bitLenLo, false);

  let h0=0x6a09e667, h1=0xbb67ae85, h2=0x3c6ef372, h3=0xa54ff53a;
  let h4=0x510e527f, h5=0x9b05688c, h6=0x1f83d9ab, h7=0x5be0cd19;

  const w = new Uint32Array(64);

  for (let off=0; off<total; off+=64){
    for (let i=0;i<16;i++){
      w[i] = dv.getUint32(off + i*4, false);
    }
    for (let i=16;i<64;i++){
      w[i] = (sigma1(w[i-2]) + w[i-7] + sigma0(w[i-15]) + w[i-16]) >>> 0;
    }

    let a=h0,b=h1,c=h2,d=h3,e=h4,f=h5,g=h6,h=h7;
    for (let i=0;i<64;i++){
      const t1 = (h + Sigma1(e) + ch(e,f,g) + K[i] + w[i]) >>> 0;
      const t2 = (Sigma0(a) + maj(a,b,c)) >>> 0;
      h=g; g=f; f=e; e=(d + t1) >>> 0;
      d=c; c=b; b=a; a=(t1 + t2) >>> 0;
    }
    h0=(h0+a)>>>0; h1=(h1+b)>>>0; h2=(h2+c)>>>0; h3=(h3+d)>>>0;
    h4=(h4+e)>>>0; h5=(h5+f)>>>0; h6=(h6+g)>>>0; h7=(h7+h)>>>0;
  }

  const out = new Uint8Array(32);
  const odv = new DataView(out.buffer);
  odv.setUint32(0,h0,false); odv.setUint32(4,h1,false); odv.setUint32(8,h2,false); odv.setUint32(12,h3,false);
  odv.setUint32(16,h4,false); odv.setUint32(20,h5,false); odv.setUint32(24,h6,false); odv.setUint32(28,h7,false);
  return bytesToHex(out);
}
