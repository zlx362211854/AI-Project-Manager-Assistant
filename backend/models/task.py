from typing import Optional
from pydantic import BaseModel, Field
from enum import Enum


class TaskType(str, Enum):
    """Enumeration of supported task types."""
    FEATURE = "feature"
    BUG_FIX = "bug_fix"
    IMPROVEMENT = "improvement"
    RESEARCH = "research"
    DOCUMENTATION = "documentation"
    TESTING = "testing"
    INFRASTRUCTURE = "infrastructure"


class Priority(str, Enum):
    """Task priority levels."""
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class Requirement(BaseModel):
    """Structured requirement parsed from natural language input."""
    title: str = Field(..., description="Short title of the requirement")
    description: str = Field(..., description="Detailed description")
    type: TaskType = Field(default=TaskType.FEATURE, description="Type of the requirement")
    estimated_time: Optional[float] = Field(None, description="Estimated hours for the entire requirement")


class SubTask(BaseModel):
    """A subtask decomposed from a high-level requirement."""
    id: str = Field(..., description="Unique identifier for the subtask")
    title: str = Field(..., description="Short title of the subtask")
    description: str = Field(default="", description="Detailed description of the subtask")
    user_story: str = Field(default="", description="User story in 'As a... I want... So that...' format")
    acceptance_criteria: list[str] = Field(default_factory=list, description="List of acceptance criteria")
    technical_notes: str = Field(default="", description="Technical implementation notes or constraints")
    estimated_time: float = Field(default=1.0, description="Estimated hours to complete")
    priority: Priority = Field(default=Priority.MEDIUM, description="Priority level")
    assignee: Optional[str] = Field(None, description="Assigned team member name")
    start_date: Optional[str] = Field(None, description="Planned start date (ISO format)")
    end_date: Optional[str] = Field(None, description="Planned end date (ISO format)")
    dependencies: list[str] = Field(default_factory=list, description="IDs of dependent subtasks")
    pending_answers: Optional[dict] = Field(None, description="Transient: user answers awaiting LLM enrichment")


class Task(BaseModel):
    """Top-level task containing a requirement and its decomposed subtasks."""
    requirement: Requirement
    subtasks: list[SubTask] = Field(default_factory=list)
    status: str = Field(default="pending", description="Overall task status")
    adjustment_count: int = Field(default=0, description="Number of resource adjustment iterations")
