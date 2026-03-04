import json
import logging

from ..state import GraphState

logger = logging.getLogger(__name__)


def _format_json(state: GraphState) -> str:
    """Format the output as JSON."""
    requirement = state.get("requirement")
    subtasks = state.get("subtasks", [])

    output = {
        "requirement": requirement.model_dump() if requirement else None,
        "subtasks": [t.model_dump() for t in subtasks],
        "total_estimated_hours": round(sum(t.estimated_time for t in subtasks)),
        "adjustment_iterations": state.get("adjustment_count", 0),
    }
    return json.dumps(output, indent=2, default=str)


def _format_markdown(state: GraphState) -> str:
    """Format the output as Markdown."""
    requirement = state.get("requirement")
    subtasks = state.get("subtasks", [])
    total_hours = round(sum(t.estimated_time for t in subtasks))

    lines = []
    if requirement:
        lines.append(f"# {requirement.title}")
        lines.append(f"\n**Type:** {requirement.type.value}")
        lines.append(f"**Description:** {requirement.description}")
        lines.append(f"**Total Estimated Hours:** {total_hours}")
        lines.append("")

    lines.append("## Task Breakdown\n")
    lines.append("| # | Task | Priority | Est. Hours | Role | Start | End |")
    lines.append("|---|------|----------|-----------|------|-------|-----|")

    for i, task in enumerate(subtasks, 1):
        lines.append(
            f"| {i} | {task.title} | {task.priority.value} | "
            f"{round(task.estimated_time)}h | {task.assignee or 'Unassigned'} | "
            f"{task.start_date or 'TBD'} | {task.end_date or 'TBD'} |"
        )

    if state.get("adjustment_count", 0) > 0:
        lines.append(
            f"\n> Note: Tasks were adjusted {state['adjustment_count']} time(s) "
            "due to resource constraints."
        )

    return "\n".join(lines)


def generate_output(state: GraphState) -> GraphState:
    """
    Generate the final output in the requested format (JSON or Markdown).

    @param state: Current graph state with all processed subtasks
    @returns: Updated state with final_output string
    """
    output_format = state.get("output_format", "markdown")

    try:
        if output_format == "json":
            result = _format_json(state)
        else:
            result = _format_markdown(state)

        logger.info("Output generated in %s format", output_format)
        return {**state, "final_output": result, "error": None}

    except Exception as e:
        logger.error("Output generation failed: %s", e)
        return {**state, "error": f"Output generation failed: {str(e)}"}
