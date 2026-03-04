from typing import Optional
from typing_extensions import TypedDict

from ..models.task import Requirement, SubTask
from ..models.team import TeamConfig


class GraphState(TypedDict, total=False):
    """State object that flows through the LangGraph workflow."""
    raw_input: str
    requirement: Optional[Requirement]
    subtasks: list[SubTask]
    team_config: TeamConfig
    has_conflict: bool
    adjustment_count: int
    max_adjustments: int
    output_format: str
    final_output: str
    error: Optional[str]
