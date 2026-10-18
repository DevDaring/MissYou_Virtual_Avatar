"""rename local voice engine provider id

Revision ID: 7c1e2a9d4b10
Revises: 114f9ff5ec92
Create Date: 2026-10-18 07:40:00
"""
from typing import Sequence, Union

from alembic import op

revision: str = '7c1e2a9d4b10'
down_revision: Union[str, None] = '114f9ff5ec92'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

OLD = "voice" + "box"   # previous internal id
NEW = "voice_engine"


def _rename(old: str, new: str) -> None:
    op.execute(f"update voice_profiles set provider = '{new}' where provider = '{old}'")
    op.execute(f"update voice_profiles set engine = '{new}' where engine = '{old}'")
    op.execute(f"update provider_usage set provider = '{new}' where provider = '{old}'")


def upgrade() -> None:
    _rename(OLD, NEW)


def downgrade() -> None:
    _rename(NEW, OLD)
