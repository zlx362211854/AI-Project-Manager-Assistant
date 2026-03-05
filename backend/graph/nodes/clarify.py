import json
import logging
from typing import Union

from langchain_core.messages import SystemMessage, HumanMessage
from langgraph.types import interrupt, Command

from ..state import GraphState
from ...utils.llm import call_llm_silent, strip_code_fence
from ..prompts import (
    PRE_DECOMPOSE_CLARIFICATION_PROMPT,
    PRE_DECOMPOSE_CLARIFICATION_TECHNICAL_PROMPT,
    TASK_CLARIFICATION_PROMPT,
    TASK_CLARIFICATION_TECHNICAL_PROMPT,
)

logger = logging.getLogger(__name__)


def _call_clarification_llm(
    prompt_text: str,
    system_prompt: str,
    lang_suffix: str = "",
) -> tuple[bool, list[dict]]:
    """
    Call LLM to generate clarification questions.

    @param prompt_text: Content to analyze for ambiguity
    @param system_prompt: System prompt for the clarification LLM
    @param lang_suffix: Language instruction suffix
    @returns: Tuple of (needs_clarification, questions)
    """
    try:
        messages = [
            SystemMessage(content=system_prompt + lang_suffix),
            HumanMessage(content=prompt_text),
        ]
        response = call_llm_silent(messages, temperature=0)
        content = strip_code_fence(response)
        data = json.loads(content)

        needs_clarification = data.get("needs_clarification", False)
        questions = data.get("questions", []) if needs_clarification else []

        return needs_clarification, questions

    except (json.JSONDecodeError, Exception) as e:
        logger.warning("Clarification LLM call failed: %s", e)
        return False, []


def _enrich_input_with_answers(
    original_text: str,
    answers: dict[str, str | list[str]],
) -> str:
    """Append user clarification answers to the original prompt text."""
    if not answers:
        return original_text

    parts = []
    for qid, answer in answers.items():
        if isinstance(answer, list):
            parts.append(f"- {qid}: {', '.join(answer)}")
        else:
            parts.append(f"- {qid}: {answer}")

    answers_text = "\n".join(parts)
    return f"{original_text}\n\nAdditional clarifications from the user:\n{answers_text}"


def clarify_requirement_node(
    state: GraphState,
    collect_technical: bool = False,
    lang_suffix: str = "",
) -> Union[GraphState, Command]:
    """
    Phase 1 Clarification Node: Ask clarification questions before decompose.

    Uses LangGraph interrupt to pause and wait for user answers.

    @param state: Current graph state
    @param collect_technical: Whether to also collect technical details
    @param lang_suffix: Language instruction suffix
    @returns: Updated state with enriched_input, or Command to resume with answers
    """
    raw_input = state.get("raw_input", "")
    clarification_answers = state.get("clarification_answers", {})

    if clarification_answers:
        enriched_input = _enrich_input_with_answers(
            raw_input, clarification_answers)
        logger.info("Requirement clarification complete, enriched input length: %d", len(
            enriched_input))
        return {
            "enriched_input": enriched_input,
            "clarification_answers": {},
            "clarification_questions": [],
            "needs_clarification": False,
        }

    system_prompt = (
        PRE_DECOMPOSE_CLARIFICATION_TECHNICAL_PROMPT
        if collect_technical
        else PRE_DECOMPOSE_CLARIFICATION_PROMPT
    )

    needs_clarification, questions = _call_clarification_llm(
        raw_input, system_prompt, lang_suffix
    )

    if not needs_clarification or not questions:
        return {
            "enriched_input": raw_input,
            "needs_clarification": False,
        }

    logger.info(
        "Pausing for requirement clarification, %d questions", len(questions))

    result = interrupt({
        "phase": "requirement",
        "context": "requirement analysis",
        "questions": questions,
    })

    if isinstance(result, dict) and "clarification_answers" in result:
        answers = result["clarification_answers"]
        enriched_input = _enrich_input_with_answers(raw_input, answers)
        return {
            "enriched_input": enriched_input,
            "clarification_answers": {},
            "clarification_questions": [],
            "needs_clarification": False,
        }

    return {"enriched_input": raw_input, "needs_clarification": False}


def clarify_tasks_node(
    state: GraphState,
    lang_suffix: str = "",
) -> Union[GraphState, Command]:
    """
    Phase 2 Clarification Node: Ask clarification questions after decompose.

    Uses LangGraph interrupt to pause and wait for user answers.

    @param state: Current graph state with subtasks
    @param lang_suffix: Language instruction suffix
    @returns: Updated state with enriched subtasks, or Command to resume
    """
    subtasks = state.get("subtasks", [])
    clarification_answers = state.get("clarification_answers", {})

    if clarification_answers:
        logger.info("Task clarification complete for %d tasks", len(subtasks))
        return {
            "clarification_answers": {},
            "clarification_questions": [],
            "needs_clarification": False,
        }

    all_task_texts = "\n\n".join([
        f"Task: {t.title}\nDescription: {t.description}\nEst: {t.estimated_time}h"
        for t in subtasks
    ])

    needs_clarification, questions = _call_clarification_llm(
        all_task_texts, TASK_CLARIFICATION_PROMPT, lang_suffix
    )

    if not needs_clarification or not questions:
        logger.info("No task clarification needed")
        return {"needs_clarification": False}

    logger.info("Pausing for task clarification, %d questions", len(questions))

    result = interrupt({
        "phase": "tasks",
        "context": "task analysis",
        "questions": questions,
    })

    if isinstance(result, dict) and "clarification_answers" in result:
        return {
            "clarification_answers": {},
            "clarification_questions": [],
            "needs_clarification": False,
        }

    return {"needs_clarification": False}
