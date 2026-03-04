"""
Interactive clarification agent.

Handles two-phase requirement clarification:
  Phase 1 (pre-decompose): Thorough upfront requirement analysis.
  Phase 2 (post-decompose): Targeted per-task ambiguity scan.

Deduplicates questions across both phases so the same question
is never asked twice in a single workflow run.
"""
import json
import re
import uuid
import logging

from langchain_core.messages import SystemMessage, HumanMessage

from ...utils.llm import call_llm_silent, strip_code_fence
from ...utils.stream import StreamEmitter
from ...models.task import SubTask, Priority
from ..prompts import (
    PRE_DECOMPOSE_CLARIFICATION_PROMPT,
    PRE_DECOMPOSE_CLARIFICATION_TECHNICAL_PROMPT,
    TASK_CLARIFICATION_PROMPT,
    TASK_CLARIFICATION_TECHNICAL_PROMPT,
    TASK_ENRICH_PROMPT,
)

logger = logging.getLogger(__name__)


def normalize_question(text: str) -> str:
    """
    Normalize a question string for deduplication comparison.
    Lowercases, strips punctuation, and collapses whitespace.

    @param text: Raw question text
    @returns: Normalized string for set-based comparison
    """
    text = text.lower().strip()
    text = re.sub(r"[^\w\s]", "", text)
    text = re.sub(r"\s+", " ", text)
    return text


def deduplicate_questions(questions: list[dict], asked_set: set[str]) -> list[dict]:
    """
    Remove questions whose normalized text has already been asked.
    Adds new unique questions to asked_set as a side effect.

    @param questions: Candidate questions from the LLM
    @param asked_set: Mutable set of already-asked normalized question texts
    @returns: Filtered list of unique questions
    """
    unique = []
    for q in questions:
        norm = normalize_question(q.get("text", ""))
        if norm and norm not in asked_set:
            unique.append(q)
            asked_set.add(norm)
    return unique


def format_answers(answers: dict[str, str | list[str]]) -> str:
    """
    Format user answers into a human-readable string for LLM context.

    @param answers: Map of question_id to answer value
    @returns: Formatted multi-line string
    """
    parts = []
    for qid, answer in answers.items():
        if isinstance(answer, list):
            parts.append(f"- {qid}: {', '.join(answer)}")
        else:
            parts.append(f"- {qid}: {answer}")
    return "\n".join(parts)


def enrich_with_answers(original_text: str, all_answers: dict[str, str | list[str]]) -> str:
    """
    Append user clarification answers to the original prompt text.

    @param original_text: Original requirement or task description
    @param all_answers: All user-provided answers collected so far
    @returns: Enriched text with answers appended
    """
    if not all_answers:
        return original_text
    return f"{original_text}\n\nAdditional clarifications from the user:\n{format_answers(all_answers)}"


def check_clarification(
    prompt_text: str,
    system_prompt: str,
    phase: str,
    context: str,
    emitter: StreamEmitter,
    asked_set: set[str],
    lang_suffix: str = "",
) -> dict[str, str | list[str]]:
    """
    Ask the LLM to detect ambiguities and generate clarification questions.
    Deduplicates against previously asked questions.
    If unique questions remain, emits them and blocks until the user answers.

    @param prompt_text: Content to analyze for ambiguity
    @param system_prompt: System prompt for the clarification LLM call
    @param phase: Current workflow phase name (for UI context)
    @param context: Brief human-readable context shown in the UI
    @param emitter: StreamEmitter for event emission and blocking
    @param asked_set: Mutable set of already-asked normalized question texts
    @param lang_suffix: Language instruction suffix to append to system prompt
    @returns: User answers dict (empty if no clarification needed or skipped)
    """
    try:
        messages = [
            SystemMessage(content=system_prompt + lang_suffix),
            HumanMessage(content=prompt_text),
        ]
        response = call_llm_silent(messages, temperature=0)
        content = strip_code_fence(response)
        data = json.loads(content)

        if not data.get("needs_clarification", False):
            return {}

        questions = data.get("questions", [])
        if not questions:
            return {}

        for q in questions:
            if "id" not in q:
                q["id"] = str(uuid.uuid4())[:8]

        questions = deduplicate_questions(questions, asked_set)
        if not questions:
            return {}

        emitter.text(f"\n\n> Clarification needed for **{context}**\n\n")

        answers = emitter.clarification({
            "phase": phase,
            "context": context,
            "questions": questions,
        })

        if answers:
            emitter.text("> User feedback received, continuing...\n\n")

        return answers

    except (json.JSONDecodeError, Exception) as e:
        logger.warning("Clarification check failed: %s", e)
        return {}


def _enrich_task_with_answers(
    task: SubTask,
    answers: dict[str, str | list[str]],
    lang_suffix: str = "",
) -> SubTask:
    """
    Use the LLM to rewrite a task's fields based on clarification answers.
    Falls back to the original task if the LLM call or parse fails.

    @param task: Original subtask to enrich
    @param answers: User-provided clarification answers
    @param lang_suffix: Language instruction for LLM
    @returns: Updated SubTask with enriched fields
    """
    formatted_answers = format_answers(answers)
    prompt = (
        f"Original task:\n"
        f"- title: {task.title}\n"
        f"- description: {task.description}\n"
        f"- user_story: {task.user_story}\n"
        f"- acceptance_criteria: {task.acceptance_criteria}\n"
        f"- technical_notes: {task.technical_notes}\n"
        f"- estimated_time: {task.estimated_time}\n\n"
        f"Clarification answers from the user:\n{formatted_answers}\n\n"
        "Update the task fields to incorporate this clarification."
    )
    try:
        messages = [
            SystemMessage(content=TASK_ENRICH_PROMPT + lang_suffix),
            HumanMessage(content=prompt),
        ]
        response = call_llm_silent(messages, temperature=0)
        content = strip_code_fence(response)
        data = json.loads(content)

        valid_priorities = {p.value for p in Priority}
        raw_priority = str(data.get("priority", task.priority.value)).lower()
        if raw_priority not in valid_priorities:
            raw_priority = task.priority.value

        return task.model_copy(update={
            "title": data.get("title", task.title),
            "description": data.get("description", task.description),
            "user_story": data.get("user_story", task.user_story),
            "acceptance_criteria": data.get("acceptance_criteria", task.acceptance_criteria),
            "technical_notes": data.get("technical_notes", task.technical_notes),
            "estimated_time": data.get("estimated_time", task.estimated_time),
        })
    except Exception as e:
        logger.warning("Task enrichment failed for '%s': %s", task.title, e)
        return task


def clarify_requirement(
    raw_input: str,
    emitter: StreamEmitter,
    asked_set: set[str],
    lang_suffix: str = "",
    collect_technical: bool = False,
) -> dict[str, str | list[str]]:
    """
    Phase 1: Thorough pre-decompose requirement clarification.
    Collects as many answers as possible before task generation begins.

    @param raw_input: Raw requirement text from the user
    @param emitter: StreamEmitter for events and blocking
    @param asked_set: Mutable set for question deduplication
    @param lang_suffix: Language instruction for LLM
    @param collect_technical: Whether to also ask about technical implementation details
    @returns: All collected answers
    """
    emitter.text("**Reviewing requirement for clarifications...**\n\n")

    prompt = PRE_DECOMPOSE_CLARIFICATION_TECHNICAL_PROMPT if collect_technical else PRE_DECOMPOSE_CLARIFICATION_PROMPT

    return check_clarification(
        f"Thoroughly analyze this requirement for ALL ambiguities and missing information:\n\n{raw_input}",
        prompt,
        "requirement",
        "Requirement Analysis",
        emitter,
        asked_set,
        lang_suffix,
    )


def clarify_tasks(
    subtasks: list[SubTask],
    emitter: StreamEmitter,
    asked_set: set[str],
    lang_suffix: str = "",
    collect_technical: bool = False,
) -> list[SubTask]:
    """
    Phase 2: Per-task ambiguity scan after decomposition.
    Only asks about tasks the LLM considers genuinely ambiguous,
    and skips questions already asked in Phase 1.

    @param subtasks: List of decomposed subtasks
    @param emitter: StreamEmitter for events and blocking
    @param asked_set: Mutable set for question deduplication
    @param lang_suffix: Language instruction for LLM
    @param collect_technical: Whether to also ask about technical implementation details
    @returns: Updated subtasks with any clarification answers incorporated
    """
    asked_list = "\n".join(f"- {q}" for q in asked_set) if asked_set else "None"
    task_prompt_template = TASK_CLARIFICATION_TECHNICAL_PROMPT if collect_technical else TASK_CLARIFICATION_PROMPT

    updated = []
    any_changed = False

    for task in subtasks:
        emitter.task_processing(task.id)

        analysis_text = (
            f"Task: {task.title}\n"
            f"Description: {task.description}\n"
            f"User Story: {task.user_story}\n"
            f"Acceptance Criteria: {', '.join(task.acceptance_criteria)}\n"
            f"Technical Notes: {task.technical_notes}"
        )

        system_prompt = task_prompt_template.format(asked_questions=asked_list)

        answers = check_clarification(
            f"Analyze this task for ambiguities:\n\n{analysis_text}",
            system_prompt,
            f"task:{task.id}",
            task.title,
            emitter,
            asked_set,
            lang_suffix,
        )

        if answers:
            # Immediately show user answers in the task row while LLM enriches.
            pending_task = task.model_copy(update={"pending_answers": answers})
            pre_snapshot = updated + [pending_task] + subtasks[len(updated) + 1:]
            emitter.tasks_update(pre_snapshot)

            task = _enrich_task_with_answers(task, answers, lang_suffix)
            any_changed = True
            current_snapshot = updated + [task] + subtasks[len(updated) + 1:]
            emitter.tasks_update(current_snapshot)

        updated.append(task)

    emitter.task_processing("")

    if any_changed:
        emitter.tasks_update(updated)

    return updated
