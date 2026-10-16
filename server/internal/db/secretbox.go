package db

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"io"
	"strings"
)

// Small AES-256-GCM helper for encrypting user secrets at rest (currently the
// per-user BYOK AI keys). The key is derived from the app's JWT secret via
// SHA-256, so no extra config is needed; SetSecretKey is called once at startup.
// Stored values are prefixed "enc:" so plaintext (legacy / unset-key) rows are
// still readable — decrypt() returns them unchanged.

const encPrefix = "enc:"

// SetSecretKey derives and stores the 32-byte encryption key from a passphrase
// (the JWT secret). Safe to call once at startup.
func (d *DB) SetSecretKey(passphrase string) {
	h := sha256.Sum256([]byte("deployzy-secretbox:" + passphrase))
	d.secretKey = h[:]
}

// encrypt returns "enc:<base64(nonce||ciphertext)>". Falls back to plaintext if
// no key is set (so nothing breaks in a misconfigured/dev environment).
func (d *DB) encrypt(plaintext string) string {
	if len(d.secretKey) != 32 || plaintext == "" {
		return plaintext
	}
	block, err := aes.NewCipher(d.secretKey)
	if err != nil {
		return plaintext
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return plaintext
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return plaintext
	}
	sealed := gcm.Seal(nonce, nonce, []byte(plaintext), nil)
	return encPrefix + base64.StdEncoding.EncodeToString(sealed)
}

// decrypt reverses encrypt. A value without the prefix is returned unchanged
// (legacy plaintext). On any failure it returns "" rather than corrupt data.
func (d *DB) decrypt(stored string) string {
	if !strings.HasPrefix(stored, encPrefix) {
		return stored // legacy plaintext
	}
	if len(d.secretKey) != 32 {
		return ""
	}
	raw, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(stored, encPrefix))
	if err != nil {
		return ""
	}
	block, err := aes.NewCipher(d.secretKey)
	if err != nil {
		return ""
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil || len(raw) < gcm.NonceSize() {
		return ""
	}
	nonce, ct := raw[:gcm.NonceSize()], raw[gcm.NonceSize():]
	pt, err := gcm.Open(nil, nonce, ct, nil)
	if err != nil {
		return ""
	}
	return string(pt)
}
