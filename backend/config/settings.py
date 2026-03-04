import json
import os
from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings

from ..models.team import TeamConfig, TeamMember


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""
    openai_api_key: str = Field(default="", alias="OPENAI_API_KEY")
    openai_api_base: str = Field(default="", alias="OPENAI_API_BASE")
    openai_model: str = Field(default="gpt-4o-mini", alias="OPENAI_MODEL")
    output_format: str = Field(default="markdown", alias="OUTPUT_FORMAT")
    max_adjustments: int = Field(default=3, alias="MAX_ADJUSTMENTS")
    team_config_path: str = Field(
        default="backend/config/team_config.json",
        alias="TEAM_CONFIG_PATH",
    )

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


@lru_cache()
def get_settings() -> Settings:
    """Get cached application settings singleton."""
    return Settings()


def load_team_config(config_path: str | None = None) -> TeamConfig:
    """
    Load team configuration from a JSON file.

    @param config_path: Path to team config JSON file. Uses default if None.
    @returns: TeamConfig object with team members
    """
    if config_path is None:
        config_path = get_settings().team_config_path

    path = Path(config_path)
    if not path.exists():
        return _default_team_config()

    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)

    members = [TeamMember(**m) for m in data.get("members", [])]
    return TeamConfig(
        members=members,
        max_adjustment_iterations=data.get("max_adjustment_iterations", 3),
    )


def _default_team_config() -> TeamConfig:
    """Provide a default team configuration for demo purposes."""
    return TeamConfig(
        members=[
            TeamMember(
                role="architect",
                skills=["system_design", "architecture", "technical_planning"],
                max_hours_per_week=40,
            ),
            TeamMember(
                role="developer",
                skills=["python", "javascript", "react", "backend", "frontend"],
                max_hours_per_week=40,
            ),
            TeamMember(
                role="qa",
                skills=["testing", "automation", "quality_assurance"],
                max_hours_per_week=40,
            ),
            TeamMember(
                role="devops",
                skills=["ci_cd", "docker", "cloud", "infrastructure"],
                max_hours_per_week=32,
            ),
        ],
        max_adjustment_iterations=3,
    )
