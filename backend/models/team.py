from pydantic import BaseModel, Field


class TeamMember(BaseModel):
    """Represents a role-based resource with capacity."""
    role: str = Field(..., description="Role name, e.g. senior_developer, qa_engineer")
    skills: list[str] = Field(default_factory=list, description="List of skills")
    max_hours_per_week: float = Field(default=40.0, description="Maximum available hours per week")
    current_load: float = Field(default=0.0, description="Currently allocated hours")

    @property
    def available_hours(self) -> float:
        """Calculate remaining available hours."""
        return max(0, self.max_hours_per_week - self.current_load)


class TeamConfig(BaseModel):
    """Configuration for team roles used in resource allocation."""
    members: list[TeamMember] = Field(default_factory=list)
    max_adjustment_iterations: int = Field(default=3, description="Maximum loop iterations for resource adjustment")
