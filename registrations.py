"""Aircraft registration helpers."""

import re
from typing import Optional

# US N-numbers map to ICAO24 codes arithmetically (a00001-adf7c7). The scheme
# skips the letters I and O and allows up to two trailing letters.
_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ"
_SUFFIX = 1 + len(_LETTERS) * (1 + len(_LETTERS))   # 601 codes after a prefix
_BUCKET4 = 1 + len(_LETTERS) + 10                    # 35
_BUCKET3 = 10 * _BUCKET4 + _SUFFIX                   # 951
_BUCKET2 = 10 * _BUCKET3 + _SUFFIX                   # 10111
_BUCKET1 = 10 * _BUCKET2 + _SUFFIX                   # 101711
_BUCKETS = {1: _BUCKET2, 2: _BUCKET3, 3: _BUCKET4}
N_NUMBER = re.compile(r"^N[1-9][0-9]{0,4}$|^N[1-9][0-9]{0,3}[A-HJ-NP-Z]$|^N[1-9][0-9]{0,2}[A-HJ-NP-Z]{2}$")


def _suffix_offset(letters: str) -> int:
    offset = (len(_LETTERS) + 1) * _LETTERS.index(letters[0]) + 1
    if len(letters) == 2:
        offset += _LETTERS.index(letters[1]) + 1
    return offset


def n_number_to_icao24(registration: str) -> Optional[str]:
    """ICAO24 hex code of a US registration such as N283VA, or None if it is not a valid N-number."""
    value = re.sub(r"[\s-]", "", (registration or "").upper())
    if not N_NUMBER.match(value):
        return None
    body = value[1:]
    code = 0xA00001 + (int(body[0]) - 1) * _BUCKET1
    for index in range(1, len(body)):
        char = body[index]
        if index == 4:
            code += _LETTERS.index(char) + 1 if char in _LETTERS else int(char) + 25
            break
        if char in _LETTERS:
            code += _suffix_offset(body[index:])
            break
        code += int(char) * _BUCKETS[index] + _SUFFIX
    return f"{code:06x}"


def looks_like_icao24(value: str) -> bool:
    return bool(re.fullmatch(r"[0-9a-fA-F]{6}", (value or "").strip()))
