import json
import uuid
import logging

from langchain_core.messages import SystemMessage, HumanMessage

from ..state import GraphState
from ..prompts import DECOMPOSE_PROMPT
from ...models.task import SubTask
from ...utils.llm import create_llm, strip_code_fence

logger = logging.getLogger(__name__)


def decompose_tasks(state: GraphState) -> GraphState:
    """
    Decompose a structured requirement into a list of subtasks using AI.

    @param state: Current graph state with a parsed requirement
    @returns: Updated state with decomposed subtasks
    """
    requirement = state.get("requirement")
    if not requirement:
        return {**state, "error": "No requirement to decompose"}

    try:
        llm = create_llm(temperature=0.2)
        prompt = (
            f"Requirement: {requirement.title}\n"
            f"Description: {requirement.description}\n"
            f"Type: {requirement.type}\n"
            f"Estimated total time: {requirement.estimated_time or 'Unknown'} hours\n\n"
            "Break this into subtasks."
        )
        messages = [
            SystemMessage(content=DECOMPOSE_PROMPT),
            HumanMessage(content=prompt),
        ]
        response = llm.invoke(messages)
        content = strip_code_fence(response.content.strip())

        raw_tasks = json.loads(content)
        title_to_id: dict[str, str] = {}
        subtasks: list[SubTask] = []

        for item in raw_tasks:
            task_id = str(uuid.uuid4())[:8]
            title_to_id[item["title"]] = task_id

        for item in raw_tasks:
            task_id = title_to_id[item["title"]]
            dep_ids = [
                title_to_id[dep]
                for dep in item.get("dependencies", [])
                if dep in title_to_id
            ]
            subtask = SubTask(
                id=task_id,
                title=item["title"],
                description=item.get("description", ""),
                user_story=item.get("user_story", ""),
                acceptance_criteria=item.get("acceptance_criteria", []),
                technical_notes=item.get("technical_notes", ""),
                estimated_time=item.get("estimated_time", 2),
                dependencies=dep_ids,
            )
            subtasks.append(subtask)

        logger.info("Decomposed into %d subtasks", len(subtasks))
        return {**state, "subtasks": subtasks, "error": None}

    except Exception as e:
        logger.error("Task decomposition failed: %s", e)
        return {**state, "error": f"Task decomposition failed: {str(e)}"}
