import logging
from datetime import datetime, timedelta

from ..state import GraphState
from ...models.task import Priority

logger = logging.getLogger(__name__)

PRIORITY_ORDER = {
    Priority.CRITICAL: 0,
    Priority.HIGH: 1,
    Priority.MEDIUM: 2,
    Priority.LOW: 3,
}


def allocate_resources(state: GraphState) -> GraphState:
    """
    Allocate team members and schedule dates for each subtask
    based on priority, dependencies, and member availability.
    Prefers the member with the most remaining capacity.

    @param state: Current graph state with subtasks and team_config
    @returns: Updated state with assigned subtasks and conflict flag
    """
    subtasks = state.get("subtasks", [])
    team_config = state.get("team_config")

    if not subtasks:
        return {**state, "error": "No subtasks to allocate"}

    if not team_config or not team_config.members:
        return {**state, "error": "No team members configured"}

    members = [m.model_copy() for m in team_config.members]
    sorted_tasks = sorted(subtasks, key=lambda t: PRIORITY_ORDER.get(t.priority, 2))

    has_conflict = False
    task_end_dates: dict[str, datetime] = {}
    base_date = datetime.now().replace(hour=9, minute=0, second=0, microsecond=0)

    updated_tasks = []
    for task in sorted_tasks:
        dep_end = base_date
        for dep_id in task.dependencies:
            if dep_id in task_end_dates and task_end_dates[dep_id] > dep_end:
                dep_end = task_end_dates[dep_id]

        candidates = sorted(members, key=lambda m: m.available_hours, reverse=True)
        best_member = None

        for member in candidates:
            if member.available_hours >= task.estimated_time:
                best_member = member
                break

        if best_member is None:
            for member in candidates:
                if member.available_hours > 0:
                    best_member = member
                    break

        if best_member is None:
            has_conflict = True
            logger.warning("No available member for task: %s", task.title)
            updated_tasks.append(task)
            continue

        if best_member.available_hours < task.estimated_time:
            has_conflict = True

        start = max(dep_end, base_date)
        work_days = max(1, int((task.estimated_time + 7) // 8))
        end = start + timedelta(days=work_days)

        best_member.current_load += task.estimated_time
        task_end_dates[task.id] = end

        task_copy = task.model_copy(update={
            "assignee": best_member.role,
            "start_date": start.strftime("%Y-%m-%d"),
            "end_date": end.strftime("%Y-%m-%d"),
        })
        updated_tasks.append(task_copy)

    logger.info("Resource allocation complete. Conflict: %s", has_conflict)
    return {
        **state,
        "subtasks": updated_tasks,
        "has_conflict": has_conflict,
        "error": None,
    }
