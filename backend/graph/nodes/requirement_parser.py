import json
import logging

from langchain_core.messages import SystemMessage, HumanMessage

from ..state import GraphState
from ..prompts import PARSE_PROMPT
from ...models.task import Requirement, TaskType
from ...utils.llm import create_llm, strip_code_fence

logger = logging.getLogger(__name__)


def parse_requirement(state: GraphState) -> GraphState:
    """
    Parse raw natural language input into a structured Requirement object.

    @param state: Current graph state containing raw_input
    @returns: Updated state with parsed requirement
    """
    raw_input = state.get("raw_input", "")
    if not raw_input:
        return {**state, "error": "No input provided"}

    try:
        llm = create_llm(temperature=0)
        messages = [
            SystemMessage(content=PARSE_PROMPT),
            HumanMessage(content=f"Parse this requirement:\n\n{raw_input}"),
        ]
        response = llm.invoke(messages)
        content = strip_code_fence(response.content.strip())

        data = json.loads(content)
        task_type = data.get("type", "feature")
        if task_type not in [t.value for t in TaskType]:
            task_type = "feature"

        requirement = Requirement(
            title=data.get("title", "Untitled"),
            description=data.get("description", raw_input),
            type=TaskType(task_type),
            estimated_time=data.get("estimated_time"),
        )

        logger.info("Parsed requirement: %s", requirement.title)
        return {**state, "requirement": requirement, "error": None}

    except Exception as e:
        logger.error("Failed to parse requirement: %s", e)
        return {**state, "error": f"Requirement parsing failed: {str(e)}"}
