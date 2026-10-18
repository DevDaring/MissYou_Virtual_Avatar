import os

import pytest

from app.storage import CHUNK, LocalEncryptedStorage


def test_roundtrip_and_ranges(tmp_path):
    st = LocalEncryptedStorage(tmp_path / "objects")
    data = os.urandom(CHUNK * 2 + 12345)
    size, sha = st.put_bytes("u/p/x.bin", data)
    assert size == len(data)
    raw = (tmp_path / "objects/u/p/x.bin").read_bytes()
    assert data[:64] not in raw  # encrypted at rest
    assert st.read_all("u/p/x.bin") == data
    for a, b in [(0, 10), (CHUNK - 5, CHUNK + 5), (len(data) - 100, len(data) - 1), (CHUNK * 2, CHUNK * 2 + 2)]:
        assert b"".join(st.iter_range("u/p/x.bin", a, b)) == data[a:b + 1]


def test_tampering_is_detected(tmp_path):
    st = LocalEncryptedStorage(tmp_path / "objects")
    st.put_bytes("k.bin", b"hello world" * 100)
    p = tmp_path / "objects/k.bin"
    b = bytearray(p.read_bytes())
    b[40] ^= 0xFF
    p.write_bytes(bytes(b))
    with pytest.raises(Exception):
        st.read_all("k.bin")


def test_path_traversal_rejected(tmp_path):
    st = LocalEncryptedStorage(tmp_path / "objects")
    with pytest.raises(ValueError):
        st.path("../../etc/passwd")


def test_signed_urls_expire():
    from app.security import check_media_sig, sign_media
    u = sign_media("abc", 60)
    q = dict(x.split("=") for x in u.split("?")[1].split("&"))
    assert check_media_sig("abc", int(q["exp"]), q["sig"])
    assert not check_media_sig("abd", int(q["exp"]), q["sig"])
    assert not check_media_sig("abc", 1, q["sig"])
