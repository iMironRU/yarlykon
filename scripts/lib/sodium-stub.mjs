// TODO(v1): заменить на libsodium-wrappers.
//
// Установка:
//   cd scripts && npm init -y && npm i libsodium-wrappers
//
// Реализация после установки:
//
//   import _sodium from 'libsodium-wrappers';
//   await _sodium.ready;
//   const sodium = _sodium;
//
//   export async function sealedBox(message, publicKeyB64) {
//     const pk = sodium.from_base64(publicKeyB64, sodium.base64_variants.ORIGINAL);
//     const msg = sodium.from_string(message);
//     const cipher = sodium.crypto_box_seal(msg, pk);
//     return sodium.to_base64(cipher, sodium.base64_variants.ORIGINAL);
//   }

export default {
  async sealedBox(message, publicKeyB64) {
    throw new Error(
      'sodium not installed. cd scripts && npm i libsodium-wrappers, then replace this stub.',
    );
  },
};
