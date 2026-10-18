"""Encrypted object storage on local disk.

Every object is encrypted at rest with AES-256-GCM in independent 1 MiB
chunks, so a byte-range request (video seeking) only decrypts the chunks it
touches. Each chunk's associated data binds it to its object key and index,
so chunks cannot be swapped or reordered.

File layout:  b"MYE1" | u32 chunk_size | { nonce(12) | ciphertext+tag }*

An S3-compatible non-AWS backend (Cloudflare R2 / B2 / Wasabi) can be added
behind the same four methods; see docs/DECISIONS.md.
"""
from __future__ import annotations

import base64
import hashlib
import logging
import os
import struct
import tempfile
from collections.abc import Iterator
from pathlib import Path

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from .config import settings

log = logging.getLogger("missyou.storage")
MAGIC = b"MYE1"
CHUNK = 1024 * 1024
OVERHEAD = 12 + 16


def _key() -> bytes:
    raw = settings.media_key
    if raw:
        k = base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4))
        if len(k) != 32:
            raise RuntimeError("MISSYOU_MEDIA_KEY must be 32 bytes, urlsafe-base64")
        return k
    if settings.is_prod:
        raise RuntimeError("MISSYOU_MEDIA_KEY is required in production")
    log.warning("MISSYOU_MEDIA_KEY unset; deriving a development key")
    return hashlib.sha256(("dev-media:" + settings.jwt_secret).encode()).digest()


class LocalEncryptedStorage:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)
        self._aes = AESGCM(_key())

    def path(self, key: str) -> Path:
        p = (self.root / key).resolve()
        if self.root.resolve() not in p.parents:
            raise ValueError("bad storage key")
        return p

    def _aad(self, key: str, idx: int) -> bytes:
        return f"{key}:{idx}".encode()

    def put_stream(self, key: str, chunks: Iterator[bytes]) -> tuple[int, str]:
        """Encrypt an iterator of plaintext bytes. Returns (size, sha256)."""
        dest = self.path(key)
        dest.parent.mkdir(parents=True, exist_ok=True)
        tmp = dest.with_suffix(".part")
        h = hashlib.sha256()
        size = 0
        idx = 0
        buf = b""
        with open(tmp, "wb") as out:
            out.write(MAGIC + struct.pack(">I", CHUNK))

            def flush(block: bytes) -> None:
                nonlocal idx
                nonce = os.urandom(12)
                out.write(nonce + self._aes.encrypt(nonce, block, self._aad(key, idx)))
                idx += 1

            for piece in chunks:
                h.update(piece)
                size += len(piece)
                buf += piece
                while len(buf) >= CHUNK:
                    flush(buf[:CHUNK])
                    buf = buf[CHUNK:]
            if buf or idx == 0:
                flush(buf)
        os.replace(tmp, dest)
        return size, h.hexdigest()

    def put_bytes(self, key: str, data: bytes) -> tuple[int, str]:
        return self.put_stream(key, iter([data]))

    def put_file(self, key: str, src: Path) -> tuple[int, str]:
        def gen() -> Iterator[bytes]:
            with open(src, "rb") as f:
                while True:
                    b = f.read(CHUNK)
                    if not b:
                        break
                    yield b
        return self.put_stream(key, gen())

    def _chunks(self, key: str, first: int = 0) -> Iterator[tuple[int, bytes]]:
        p = self.path(key)
        with open(p, "rb") as f:
            head = f.read(8)
            if head[:4] != MAGIC:
                raise ValueError("not an encrypted object")
            csize = struct.unpack(">I", head[4:8])[0]
            block = csize + OVERHEAD
            f.seek(8 + first * block)
            idx = first
            while True:
                raw = f.read(block)
                if not raw:
                    break
                yield idx, self._aes.decrypt(raw[:12], raw[12:], self._aad(key, idx))
                idx += 1

    def read_all(self, key: str) -> bytes:
        return b"".join(c for _, c in self._chunks(key))

    def iter_range(self, key: str, start: int, end: int) -> Iterator[bytes]:
        """Plaintext bytes [start, end] inclusive."""
        first = start // CHUNK
        pos = first * CHUNK
        for _, chunk in self._chunks(key, first):
            lo = max(start - pos, 0)
            hi = min(end - pos + 1, len(chunk))
            if lo < hi:
                yield chunk[lo:hi]
            pos += len(chunk)
            if pos > end:
                break

    def to_temp(self, key: str, suffix: str = "") -> Path:
        """Decrypt to a private temp file (caller deletes it)."""
        fd, name = tempfile.mkstemp(suffix=suffix, prefix="my_", dir=self.scratch_dir())
        with os.fdopen(fd, "wb") as out:
            for _, c in self._chunks(key):
                out.write(c)
        return Path(name)

    def scratch_dir(self) -> Path:
        d = self.root.parent / "tmp"
        d.mkdir(parents=True, exist_ok=True)
        return d

    def delete(self, key: str) -> bool:
        p = self.path(key)
        if p.exists():
            p.unlink()
            return True
        return False

    def exists(self, key: str) -> bool:
        return self.path(key).exists()


_storage: LocalEncryptedStorage | None = None


def storage() -> LocalEncryptedStorage:
    global _storage
    if _storage is None:
        _storage = LocalEncryptedStorage(settings.storage_dir / "objects")
    return _storage
