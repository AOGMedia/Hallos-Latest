/**
 * ZegoCloud Official Server Assistant
 * Based on: https://github.com/ZEGOCLOUD/zego_server_assistant
 * 
 * This is the official ZegoCloud token generation implementation
 * Converted to proper Node.js module format
 */

const crypto = require('crypto');

// Error codes enum
const ErrorCode = {
  success: 0,
  appIDInvalid: 1,
  userIDInvalid: 3,
  secretInvalid: 5,
  effectiveTimeInSecondsInvalid: 6
};

/**
 * Generate random number within given range
 * @param {number} a - Min value
 * @param {number} b - Max value
 * @returns {number} Random number
 */
function RndNum(a, b) {
  return Math.ceil((a + (b - a)) * Math.random());
}

/**
 * Generate random 16 character string for IV
 * @returns {string} Random 16 character string
 */
function makeRandomIv() {
  const str = '0123456789abcdefghijklmnopqrstuvwxyz';
  const result = [];
  for (let i = 0; i < 16; i++) {
    const r = Math.floor(Math.random() * str.length);
    result.push(str.charAt(r));
  }
  return result.join('');
}

/**
 * Determine AES algorithm based on key length
 * @param {string} keyBase64 - Base64 encoded key
 * @returns {string} AES algorithm
 */
function getAlgorithm(keyBase64) {
  const key = Buffer.from(keyBase64);
  switch (key.length) {
    case 16:
      return 'aes-128-cbc';
    case 24:
      return 'aes-192-cbc';
    case 32:
      return 'aes-256-cbc';
    default:
      throw new Error('Invalid key length: ' + key.length);
  }
}

/**
 * AES encryption using CBC/PKCS5Padding mode
 * @param {string} plainText - Text to encrypt
 * @param {string} key - Encryption key
 * @param {string} iv - Initialization vector
 * @returns {ArrayBuffer} Encrypted data
 */
function aesEncrypt(plainText, key, iv) {
  const cipher = crypto.createCipheriv(getAlgorithm(key), key, iv);
  cipher.setAutoPadding(true);
  const encrypted = cipher.update(plainText);
  const final = cipher.final();
  const out = Buffer.concat([encrypted, final]);
  return Uint8Array.from(out).buffer;
}

/**
 * Generate ZegoCloud Token (Version 04) - Official Implementation
 * @param {number} appId - ZegoCloud App ID
 * @param {string} userId - User ID
 * @param {string} secret - 32-byte server secret
 * @param {number} effectiveTimeInSeconds - Token validity in seconds
 * @param {string} payload - Optional payload (JSON string)
 * @returns {string} ZegoCloud token
 */
function generateToken04(appId, userId, secret, effectiveTimeInSeconds, payload) {
  // Validate appId
  if (!appId || typeof appId !== 'number') {
    throw {
      errorCode: ErrorCode.appIDInvalid,
      errorMessage: 'appID invalid'
    };
  }

  // Validate userId
  if (!userId || typeof userId !== 'string') {
    throw {
      errorCode: ErrorCode.userIDInvalid,
      errorMessage: 'userId invalid'
    };
  }

  // Validate secret (must be exactly 32 bytes)
  if (!secret || typeof secret !== 'string' || secret.length !== 32) {
    throw {
      errorCode: ErrorCode.secretInvalid,
      errorMessage: 'secret must be a 32 byte string'
    };
  }

  // Validate effectiveTimeInSeconds
  if (!effectiveTimeInSeconds || typeof effectiveTimeInSeconds !== 'number') {
    throw {
      errorCode: ErrorCode.effectiveTimeInSecondsInvalid,
      errorMessage: 'effectiveTimeInSeconds invalid'
    };
  }

  const createTime = Math.floor(new Date().getTime() / 1000);
  
  // Create token info object (ZegoCloud's exact format)
  const tokenInfo = {
    app_id: appId,
    user_id: userId,
    nonce: RndNum(-2147483648, 2147483647),
    ctime: createTime,
    expire: createTime + effectiveTimeInSeconds,
    payload: payload || ''
  };

  const plaintText = JSON.stringify(tokenInfo);
  console.log('✅ ZegoCloud token payload:', plaintText);

  const iv = makeRandomIv();
  console.log('✅ ZegoCloud IV generated:', iv);

  const encryptBuf = aesEncrypt(plaintText, secret, iv);

  // Create binary header (ZegoCloud's exact format)
  const b1 = new Uint8Array(8);  // 8 bytes for expire time
  const b2 = new Uint8Array(2);  // 2 bytes for IV length
  const b3 = new Uint8Array(2);  // 2 bytes for encrypted data length

  new DataView(b1.buffer).setBigInt64(0, BigInt(tokenInfo.expire), false);
  new DataView(b2.buffer).setUint16(0, iv.length, false);
  new DataView(b3.buffer).setUint16(0, encryptBuf.byteLength, false);

  // Concatenate all binary data (ZegoCloud's exact format)
  const buf = Buffer.concat([
    Buffer.from(b1),           // 8 bytes: expire time
    Buffer.from(b2),           // 2 bytes: IV length
    Buffer.from(iv),           // 16 bytes: IV
    Buffer.from(b3),           // 2 bytes: encrypted data length
    Buffer.from(encryptBuf),   // encrypted JSON
  ]);

  const dv = new DataView(Uint8Array.from(buf).buffer);
  
  // Return final token: Version 04 + Base64 encoded binary data
  const token = '04' + Buffer.from(dv.buffer).toString('base64');
  
  console.log(`✅ ZegoCloud official token generated (${token.length} chars)`);
  
  return token;
}

/**
 * Create payload for room privileges
 * @param {string} roomId - Room ID
 * @param {Object} privileges - Privilege object {1: loginRoom, 2: publishStream}
 * @returns {string} JSON payload string
 */
function createRoomPayload(roomId, privileges = {}) {
  const payloadObject = {
    room_id: roomId,
    privilege: {
      1: privileges.loginRoom !== undefined ? privileges.loginRoom : 1,     // Login room privilege
      2: privileges.publishStream !== undefined ? privileges.publishStream : 0  // Publish stream privilege
    },
    stream_id_list: null
  };
  
  return JSON.stringify(payloadObject);
}

/**
 * Helper function to generate token with room privileges
 * @param {number} appId - ZegoCloud App ID
 * @param {string} userId - User ID
 * @param {string} secret - 32-byte server secret
 * @param {number} effectiveTimeInSeconds - Token validity in seconds
 * @param {string} roomId - Room ID
 * @param {string} role - User role ('host', 'participant', 'audience')
 * @returns {string} ZegoCloud token with room privileges
 */
function generateTokenWithRoomPrivileges(appId, userId, secret, effectiveTimeInSeconds, roomId, role = 'participant') {
  // Set privileges based on role
  const privileges = {
    loginRoom: 1, // Everyone can login
    publishStream: (role === 'host' || role === 'participant') ? 1 : 0 // Only hosts and participants can publish
  };
  
  const payload = createRoomPayload(roomId, privileges);
  
  return generateToken04(appId, userId, secret, effectiveTimeInSeconds, payload);
}

module.exports = {
  generateToken04,
  createRoomPayload,
  generateTokenWithRoomPrivileges,
  ErrorCode
};