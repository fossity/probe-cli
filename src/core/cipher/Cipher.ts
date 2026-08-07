// SPDX-FileCopyrightText: 2021-2026 Fossity LLC (fossity.com)
// SPDX-License-Identifier: GPL-2.0-only

import fs from 'fs';
import crypto from 'crypto';
import * as buffer from 'buffer';
import { brand, packageExtension } from '../../runtime/brand';

export class Cipher {
  private AES_key: Buffer;
  private AES_IV: Buffer;

  private RSA_pub_key: string;

  constructor(publicKey: string) {
    this.RSA_pub_key = publicKey;
  }

  private generateAES128params() {
    const AESkey = crypto.randomBytes(16);
    const AESiv = crypto.randomBytes(16);

    this.AES_key = AESkey;
    this.AES_IV = AESiv;

    return { AESkey, AESiv };
  }

  //WARNING: This function will not cipher data longer than 128 bytes.
  //The current implementation of this class uses RSA 2048 bits so, cipherContentRSA() will not encrypt data longer than 128 bytes!!
  private cipherContentRSA(plaintext: Buffer, pubKey: string): Buffer {
    return crypto.publicEncrypt({ key: pubKey, padding: crypto.constants.RSA_PKCS1_PADDING }, plaintext);
  }

  private longToByteArray(long: number): Array<number> {
    // we want to represent the input as a 8-bytes array
    const byteArray = [0, 0, 0, 0, 0, 0, 0, 0];

    for (let index = 0; index < byteArray.length; index++) {
      // eslint-disable-next-line no-bitwise
      const byte = long & 0xff;
      byteArray[index] = byte;
      // eslint-disable-next-line no-param-reassign
      long = (long - byte) / 256;
    }

    return byteArray;
  }

  private cipherContent_AES128_CBC(textPlainData: Buffer, key: Buffer, iv: Buffer): Buffer {
    const cipher = crypto.createCipheriv('aes-128-cbc', key, iv);
    return Buffer.concat([cipher.update(textPlainData), cipher.final()]);
  }

  // Here a hybrid scheme is used to cipher the data.
  // Simetric: AES-CBC-128
  // Assimetric: RSA-2048, PKCS1
  public cipherPackage(data: Buffer): Buffer {
    const { AESkey, AESiv } = this.generateAES128params();
    const size = Buffer.from(this.longToByteArray(data.length));

    const header = Buffer.concat([size, AESkey, AESiv]);
    const headerCiphered = this.cipherContentRSA(header, this.RSA_pub_key);

    const cipherText = this.cipherContent_AES128_CBC(data, AESkey, AESiv);

    const packageQi = Buffer.concat([headerCiphered, cipherText]);
    return packageQi;
  }

  /**
   * The skip offset is the real RSA block length: it depends on the key, so it cannot be a
   * constant. For the key shipped in `brand.config.json` it is 256 bytes.
   */
  public generateDecrypBash(scriptName: string, packageName: string) {
    const headerBytes = crypto.publicEncrypt(
      { key: this.RSA_pub_key, padding: crypto.constants.RSA_PKCS1_PADDING },
      Buffer.alloc(40),
    ).length;
    return `#!/bin/bash
# You can use this script to decrypt the package and review the content.
# Please be careful with this script as it contains the keys to open the package.
# Usage ./${scriptName}

dd iflag=skip_bytes if=${packageName}${packageExtension} of=${packageName}.enc skip=${headerBytes} bs=1M #Removes the encrypted header
openssl aes-128-cbc -d -in ${packageName}.enc -out ${packageName}.zip -iv ${this.AES_IV.toString('hex')} -K ${this.AES_key.toString('hex')}

rm ${packageName}.enc
    `;
  }
}
