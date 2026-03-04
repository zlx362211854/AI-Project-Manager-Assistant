import logging

from ..state import GraphState
from ...models.task import Priority

logger = logging.getLogger(__name__)

PRIORITY_ORDER = {
    Priority.CRITICAL: 0,
    Priority.HIGH: 1,
    Priority.MEDIUM: 2,
    Priority.LOW: 3,
}


def check_and_adjust(state: GraphState) -> GraphState:
    """
    Check for resource conflicts and adjust task allocation if needed.
    Handles both total capacity overflow and per-member overload by
    redistributing tasks more evenly and reducing lower-priority task hours.

    @param state: Current graph state with conflict flag and subtasks
    @returns: Updated state with adjusted subtasks and incremented adjustment count
    """
    has_conflict = state.get("has_conflict", False)
    adjustment_count = state.get("adjustment_count", 0)
    max_adjustments = state.get("max_adjustments", 3)

    if not has_conflict or adjustment_count >= max_adjustments:
        return state

    subtasks = state.get("subtasks", [])
    team_config = state.get("team_config")

    if not team_config or not subtasks:
        return state

    total_available = sum(m.max_hours_per_week for m in team_config.members)
    total_needed = sum(t.estimated_time for t in subtasks)

    adjusted = []
    if total_needed > total_available:
        reduction_factor = min(0.8, total_available / total_needed)
        for task in subtasks:
            new_time = max(1.0, task.estimated_time * reduction_factor)
            task_copy = task.model_copy(update={
                "estimated_time": round(new_time, 1),
                "assignee": None,
                "start_date": None,
                "end_date": None,
            })
            adjusted.append(task_copy)
        logger.info(
            "Adjustment iteration %d: reduced all tasks by factor %.2f",
            adjustment_count + 1, reduction_factor,
        )
    else:
        sorted_tasks = sorted(
            subtasks,
            key=lambda t: PRIORITY_ORDER.get(t.priority, 2),
            reverse=True,
        )
        remaining = total_needed - total_available
        for task in sorted_tasks:
            if remaining > 0:
                cut = min(task.estimated_time * 0.3, remaining)
                new_time = max(1.0, task.estimated_time - cut)
                remaining -= (task.estimated_time - new_time)
                task_copy = task.model_copy(update={
                    "estimated_time": round(new_time, 1),
                    "assignee": None,
                    "start_date": None,
                    "end_date": None,
                })
                adjusted.append(task_copy)
            else:
                adjusted.append(task.model_copy(update={
                    "assignee": None,
                    "start_date": None,
                    "end_date": None,
                }))
        logger.info(
            "Adjustment iteration %d: trimmed low-priority tasks for per-member balance",
            adjustment_count + 1,
        )

    for member in team_config.members:
        member.current_load = 0.0

    return {
        **state,
        "subtasks": adjusted,
        "has_conflict": False,
        "adjustment_count": adjustment_count + 1,
    }
