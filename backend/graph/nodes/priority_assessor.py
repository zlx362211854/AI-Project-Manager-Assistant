import json
import logging

from langchain_core.messages import SystemMessage, HumanMessage

from ..state import GraphState
from ..prompts import PRIORITY_PROMPT
from ...models.task import Priority
from ...utils.llm import create_llm, strip_code_fence

logger = logging.getLogger(__name__)


def assess_priority(state: GraphState) -> GraphState:
    """
    Assess and assign priority levels to each subtask.

    @param state: Current graph state with subtasks list
    @returns: Updated state with priority-annotated subtasks
    """
    subtasks = state.get("subtasks", [])
    if not subtasks:
        return {**state, "error": "No subtasks to prioritize"}

    try:
        llm = create_llm(temperature=0)
        task_descriptions = "\n".join(
            f"- {t.title} (est: {t.estimated_time}h, deps: {len(t.dependencies)})"
            for t in subtasks
        )
        messages = [
            SystemMessage(content=PRIORITY_PROMPT),
            HumanMessage(content=f"Assess priorities for these tasks:\n{task_descriptions}"),
        ]
        response = llm.invoke(messages)
        content = strip_code_fence(response.content.strip())

        priority_map = json.loads(content)
        valid_priorities = {p.value for p in Priority}

        updated = []
        for task in subtasks:
            raw_priority = priority_map.get(task.title, "medium").lower()
            if raw_priority not in valid_priorities:
                raw_priority = "medium"
            task_copy = task.model_copy(update={"priority": Priority(raw_priority)})
            updated.append(task_copy)

        logger.info("Priority assessment complete")
        return {**state, "subtasks": updated, "error": None}

    except Exception as e:
        logger.error("Priority assessment failed: %s", e)
        return {**state, "error": f"Priority assessment failed: {str(e)}"}
