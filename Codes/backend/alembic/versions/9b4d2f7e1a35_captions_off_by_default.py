"""captions off by default in calls

Revision ID: 9b4d2f7e1a35
Revises: 7c1e2a9d4b10
Create Date: 2026-10-18 09:10:00
"""
from typing import Sequence, Union

from alembic import op

revision: str = '9b4d2f7e1a35'
down_revision: Union[str, None] = '7c1e2a9d4b10'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Captions covered the face; they now start hidden and the caller taps CC to show them.
    op.execute("update users set prefs = jsonb_set(prefs, '{captions}', 'false')")


def downgrade() -> None:
    op.execute("update users set prefs = jsonb_set(prefs, '{captions}', 'true')")
