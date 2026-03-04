"""
Streaming workflow orchestrator.

Manually runs each workflow step with LLM token streaming,
emitting text chunks and progressive tasks_update events
for real-time table rendering on the frontend.

Two-phase interactive clarification is delegated to
graph.agents.clarifier, which handles question deduplication
and the blocking emitter.clarification() call.

Architecture:
  streaming.py  ← workflow orchestration only (this file)
  agents/clarifier.py  ← interactive clarification logic
  prompts.py    ← all LLM system prompts
  utils/llm.py  ← LLM factory + stream_llm / call_llm_silent helpers
"""
import json
import uuid
import logging
from datetime import datetime, timedelta

from langchain_core.messages import SystemMessage, HumanMessage

from ..utils.stream import StreamEmitter
from ..utils.llm import stream_llm, strip_code_fence
from ..models.task import Requirement, TaskType, SubTask, Priority
from ..models.team import TeamConfig
from .prompts import PARSE_PROMPT, DECOMPOSE_PROMPT, PRIORITY_PROMPT, EXTEND_DECOMPOSE_PROMPT, EXTEND_PRIORITY_PROMPT
from .nodes.resource_allocator import PRIORITY_ORDER
from .agents.clarifier import (
    clarify_requirement,
    clarify_tasks,
    enrich_with_answers,
)

logger = logging.getLogger(__name__)


def _lang_instruction(language: str) -> str:
    """
    Return a system-level instruction suffix that forces the LLM to respond
    in the specified language.

    @param language: Language code (en or zh)
    @returns: Instruction string to append to system prompts
    """
    if language == "zh":
        return (
            "\n\nIMPORTANT: You MUST respond entirely in Chinese (simplified). "
            "All text output — titles, descriptions, user stories, acceptance criteria, "
            "technical notes, questions, and any other text — must be in Chinese. "
            "JSON keys remain in English, but all string values must be in Chinese."
        )
    return ""


def _step_parse(
    raw_input: str,
    enriched_input: str,
    emitter: StreamEmitter,
    lang_suffix: str = "",
) -> Requirement | None:
    """
    Run the requirement parsing step with streaming.

    @param raw_input: Original user input
    @param enriched_input: Input enriched with clarification answers
    @param emitter: StreamEmitter for events
    @param lang_suffix: Language instruction for LLM
    @returns: Parsed Requirement or None on failure
    """
    emitter.text("**Parsing requirement...**\n\n")

    messages = [
        SystemMessage(content=PARSE_PROMPT + lang_suffix),
        HumanMessage(content=f"Parse this requirement:\n\n{enriched_input}"),
    ]
    response = stream_llm(messages, emitter.text, temperature=0)
    content = strip_code_fence(response)

    try:
        data = json.loads(content)
    except json.JSONDecodeError:
        return None

    task_type = data.get("type", "feature")
    if task_type not in [t.value for t in TaskType]:
        task_type = "feature"

    req = Requirement(
        title=data.get("title", "Untitled"),
        description=data.get("description", enriched_input),
        type=TaskType(task_type),
        estimated_time=data.get("estimated_time"),
    )

    emitter.text(f"\n\n> **{req.title}** — {req.type.value}")
    if req.estimated_time:
        emitter.text(f", ~{req.estimated_time}h")
    emitter.text("\n\n")
    emitter.step("parse", "Requirement parsed")
    return req


def _build_subtask(item: dict, title_to_id: dict[str, str]) -> SubTask:
    """
    Construct a SubTask from a raw dict, resolving dependency titles to IDs.

    @param item: Raw task dict from LLM JSON output
    @param title_to_id: Mapping of task title to pre-assigned UUID
    @returns: Constructed SubTask instance
    """
    task_id = title_to_id[item["title"]]
    dep_ids = [title_to_id[d]
               for d in item.get("dependencies", []) if d in title_to_id]
    return SubTask(
        id=task_id,
        title=item["title"],
        description=item.get("description", ""),
        user_story=item.get("user_story", ""),
        acceptance_criteria=item.get("acceptance_criteria", []),
        technical_notes=item.get("technical_notes", ""),
        estimated_time=item.get("estimated_time", 2),
        dependencies=dep_ids,
    )


def _step_decompose(
    requirement: Requirement,
    emitter: StreamEmitter,
    lang_suffix: str = "",
) -> list[SubTask]:
    """
    Run the task decomposition step with streaming.

    Parses the LLM JSON stream incrementally: each time a complete top-level
    object ``{...}`` is detected in the token stream, it is immediately
    converted to a SubTask and emitted via tasks_update so the frontend table
    populates in real time rather than waiting for the full response.

    @param requirement: Parsed requirement
    @param emitter: StreamEmitter for events
    @param lang_suffix: Language instruction for LLM
    @returns: List of decomposed subtasks
    """
    emitter.text("**Decomposing into subtasks...**\n\n")

    prompt = (
        f"Requirement: {requirement.title}\n"
        f"Description: {requirement.description}\n"
        f"Type: {requirement.type}\n"
        f"Estimated total time: {requirement.estimated_time or 'Unknown'} hours\n\n"
        "Break this into subtasks."
    )
    messages = [
        SystemMessage(content=DECOMPOSE_PROMPT + lang_suffix),
        HumanMessage(content=prompt),
    ]

    # Incremental JSON object detector state
    accumulated: list[str] = []   # all tokens, for final fallback parse
    obj_buf: list[str] = []       # tokens inside the current top-level object
    depth = 0                     # brace nesting depth
    in_string = False             # whether we are inside a JSON string
    escape_next = False           # whether the next char is escaped
    raw_items: list[dict] = []    # successfully parsed task dicts (in order)
    # title → id map built lazily; ids are assigned on first parse of each task
    title_to_id: dict[str, str] = {}
    # running subtask list emitted progressively
    streaming_subtasks: list[SubTask] = []

    def on_token(token: str) -> None:
        nonlocal depth, in_string, escape_next

        emitter.text(token)
        accumulated.append(token)

        for ch in token:
            if escape_next:
                escape_next = False
                if depth > 0:
                    obj_buf.append(ch)
                continue

            if ch == '\\' and in_string:
                escape_next = True
                if depth > 0:
                    obj_buf.append(ch)
                continue

            if ch == '"' and depth > 0:
                in_string = not in_string

            if in_string:
                if depth > 0:
                    obj_buf.append(ch)
                continue

            if ch == '{':
                depth += 1
                obj_buf.append(ch)
            elif ch == '}' and depth > 0:
                obj_buf.append(ch)
                depth -= 1
                if depth == 0:
                    # A complete top-level object has been accumulated
                    candidate = "".join(obj_buf)
                    obj_buf.clear()
                    try:
                        item = json.loads(candidate)
                        if isinstance(item, dict) and "title" in item:
                            title = item["title"]
                            if title not in title_to_id:
                                title_to_id[title] = str(uuid.uuid4())[:8]
                            raw_items.append(item)
                            task = _build_subtask(item, title_to_id)
                            streaming_subtasks.append(task)
                            emitter.tasks_update(list(streaming_subtasks))
                    except json.JSONDecodeError:
                        pass
            elif depth > 0:
                obj_buf.append(ch)

    stream_llm(messages, on_token, temperature=0.2)

    # If incremental parsing produced all tasks, use that result directly.
    # Otherwise fall back to parsing the full accumulated response.
    if raw_items:
        subtasks = list(streaming_subtasks)
    else:
        content = strip_code_fence("".join(accumulated))
        try:
            fallback_items = json.loads(content)
        except json.JSONDecodeError:
            return []

        for item in fallback_items:
            if item["title"] not in title_to_id:
                title_to_id[item["title"]] = str(uuid.uuid4())[:8]

        subtasks = [_build_subtask(item, title_to_id)
                    for item in fallback_items]
        emitter.tasks_update(subtasks)

    emitter.text(f"\n\n> {len(subtasks)} subtasks created\n\n")
    emitter.step("decompose", f"Decomposed into {len(subtasks)} subtasks")
    return subtasks


def _step_prioritize(
    subtasks: list[SubTask],
    emitter: StreamEmitter,
    lang_suffix: str = "",
) -> list[SubTask]:
    """
    Run the priority assessment step with streaming.

    @param subtasks: Decomposed subtasks
    @param emitter: StreamEmitter for events
    @param lang_suffix: Language instruction for LLM
    @returns: Subtasks with priority assigned
    """
    emitter.text("**Assessing priorities...**\n\n")

    task_descriptions = "\n".join(
        f"- {t.title} (est: {t.estimated_time}h, deps: {len(t.dependencies)})"
        for t in subtasks
    )
    messages = [
        SystemMessage(content=PRIORITY_PROMPT + lang_suffix),
        HumanMessage(
            content=f"Assess priorities for these tasks:\n{task_descriptions}"),
    ]
    response = stream_llm(messages, emitter.text, temperature=0)
    content = strip_code_fence(response)

    try:
        priority_map = json.loads(content)
    except json.JSONDecodeError:
        return subtasks

    valid = {p.value for p in Priority}
    updated = []
    for task in subtasks:
        raw = priority_map.get(task.title, "medium").lower()
        if raw not in valid:
            raw = "medium"
        updated.append(task.model_copy(update={"priority": Priority(raw)}))

    counts: dict[str, int] = {}
    for t in updated:
        counts[t.priority.value] = counts.get(t.priority.value, 0) + 1
    summary = ", ".join(f"{v} {k}" for k, v in counts.items())
    emitter.text(f"\n\n> Priorities: {summary}\n\n")
    emitter.tasks_update(updated)
    emitter.step("prioritize", "Priorities assessed")
    return updated


def _step_allocate(
    subtasks: list[SubTask],
    team_config: TeamConfig,
    emitter: StreamEmitter,
) -> tuple[list[SubTask], bool]:
    """
    Run the resource allocation step (no LLM call).

    @param subtasks: Priority-sorted subtasks
    @param team_config: Team configuration with member availability
    @param emitter: StreamEmitter for events
    @returns: Tuple of (updated subtasks, has_conflict flag)
    """
    emitter.text("**Allocating resources...**\n\n")

    members = [m.model_copy() for m in team_config.members]
    sorted_tasks = sorted(
        subtasks, key=lambda t: PRIORITY_ORDER.get(t.priority, 2))

    has_conflict = False
    task_end_dates: dict[str, datetime] = {}
    base_date = datetime.now().replace(hour=9, minute=0, second=0, microsecond=0)
    updated: list[SubTask] = []

    for task in sorted_tasks:
        dep_end = base_date
        for dep_id in task.dependencies:
            if dep_id in task_end_dates and task_end_dates[dep_id] > dep_end:
                dep_end = task_end_dates[dep_id]

        candidates = sorted(
            members, key=lambda m: m.available_hours, reverse=True)
        best = next((m for m in candidates if m.available_hours >=
                    task.estimated_time), None)
        if best is None:
            best = next((m for m in candidates if m.available_hours > 0), None)

        if best is None:
            has_conflict = True
            updated.append(task)
            continue

        if best.available_hours < task.estimated_time:
            has_conflict = True

        start = max(dep_end, base_date)
        work_days = max(1, int((task.estimated_time + 7) // 8))
        end = start + timedelta(days=work_days)
        best.current_load += task.estimated_time
        task_end_dates[task.id] = end

        updated.append(task.model_copy(update={
            "assignee": best.role,
            "start_date": start.strftime("%Y-%m-%d"),
            "end_date": end.strftime("%Y-%m-%d"),
        }))

    status = "Conflicts detected, adjusting..." if has_conflict else f"All tasks assigned to {len({t.assignee for t in updated if t.assignee})} members"
    emitter.text(f"> {status}\n\n")
    emitter.tasks_update(updated)
    emitter.step("allocate", "Resources allocated")
    return updated, has_conflict


def run_streaming_workflow(
    raw_input: str,
    output_format: str,
    team_config: TeamConfig,
    max_adjustments: int,
    emitter: StreamEmitter,
    language: str = "en",
    collect_technical: bool = False,
) -> None:
    """
    Execute the full workflow with two-phase interactive clarification.

    Flow:
      1. Phase 1 — Thorough requirement clarification (pre-decompose)
      2. Parse requirement (enriched with user answers)
      3. Decompose into subtasks
      4. Phase 2 — Per-task ambiguity scan (post-decompose, deduplicated)
      5. Prioritize
      6. Allocate resources (with adjustment loop on conflict)

    @param raw_input: Natural language requirement
    @param output_format: Output format (json/markdown)
    @param team_config: Team configuration
    @param max_adjustments: Max resource adjustment iterations
    @param emitter: StreamEmitter for pushing events
    @param language: Output language (en or zh)
    @param collect_technical: Whether to also collect technical implementation details
    """
    asked_set: set[str] = set()
    lang_suffix = _lang_instruction(language)

    def _check_cancel() -> bool:
        """Return True and log if the workflow has been cancelled."""
        if emitter.is_cancelled:
            logger.info("Workflow cancelled for session %s",
                        emitter.session_id)
            return True
        return False

    try:
        req_answers = clarify_requirement(
            raw_input, emitter, asked_set, lang_suffix, collect_technical)
        if _check_cancel():
            return
        enriched_input = enrich_with_answers(raw_input, req_answers)

        requirement = _step_parse(
            raw_input, enriched_input, emitter, lang_suffix)
        if not requirement:
            emitter.error("Failed to parse requirement")
            return
        if _check_cancel():
            return

        subtasks = _step_decompose(requirement, emitter, lang_suffix)
        if not subtasks:
            emitter.error("Failed to decompose tasks")
            return
        if _check_cancel():
            return

        subtasks = clarify_tasks(
            subtasks, emitter, asked_set, lang_suffix, collect_technical)
        if _check_cancel():
            return

        subtasks = _step_prioritize(subtasks, emitter, lang_suffix)
        if _check_cancel():
            return

        adjustment_count = 0
        for _ in range(max_adjustments + 1):
            if _check_cancel():
                return
            subtasks, has_conflict = _step_allocate(
                subtasks, team_config, emitter)
            if not has_conflict:
                break
            adjustment_count += 1
            if adjustment_count < max_adjustments:
                emitter.text(
                    "> Adjusting tasks due to resource conflicts...\n\n")
                total_available = sum(
                    m.max_hours_per_week for m in team_config.members)
                total_needed = sum(t.estimated_time for t in subtasks)
                factor = min(
                    0.8, total_available / total_needed) if total_needed > total_available else 0.9
                subtasks = [
                    t.model_copy(update={
                        "estimated_time": round(max(1.0, t.estimated_time * factor), 1),
                        "assignee": None,
                        "start_date": None,
                        "end_date": None,
                    })
                    for t in subtasks
                ]
                for m in team_config.members:
                    m.current_load = 0.0

        emitter.step("output", "Complete")

        total_hours = round(sum(t.estimated_time for t in subtasks))
        json_output = json.dumps({
            "requirement": requirement.model_dump(),
            "subtasks": [t.model_dump() for t in subtasks],
            "total_estimated_hours": total_hours,
            "adjustment_iterations": adjustment_count,
        }, indent=2, default=str)

        emitter.result({
            "success": True,
            "output": json_output,
            "format": output_format,
        })

    except Exception as e:
        logger.error("Streaming workflow failed: %s", e)
        emitter.error(str(e))
    finally:
        emitter.done()


# ---------------------------------------------------------------------------
# Incremental extension workflow
# ---------------------------------------------------------------------------

def run_extend_workflow(
    new_requirement: str,
    existing_subtasks: list[SubTask],
    existing_requirement: Requirement,
    team_config: TeamConfig,
    max_adjustments: int,
    emitter: StreamEmitter,
    language: str = "en",
) -> None:
    """
    Extend an existing task plan with new subtasks derived from an additional requirement.

    The workflow is aware of all existing tasks and generates ONLY incremental
    new tasks. The final result event contains the full merged plan.

    Flow:
      1. Build context summary of existing tasks for the LLM
      2. Decompose the new requirement into NEW subtasks only
      3. Prioritize the new subtasks (with context of existing priorities)
      4. Allocate resources for new tasks (continuing from existing schedule)
      5. Emit merged result (existing + new tasks)

    @param new_requirement: Additional natural language requirement to add
    @param existing_subtasks: Already-planned subtasks from previous run
    @param existing_requirement: The original top-level requirement (for context)
    @param team_config: Team configuration
    @param max_adjustments: Max resource conflict adjustment iterations
    @param emitter: StreamEmitter for pushing events
    @param language: Output language (en or zh)
    """
    lang_suffix = _lang_instruction(language)

    def _check_cancel() -> bool:
        if emitter.is_cancelled:
            logger.info("Extend workflow cancelled for session %s",
                        emitter.session_id)
            return True
        return False

    try:
        # ── 1. Build existing tasks summary for the LLM prompt ──────────────
        existing_tasks_summary = "\n".join(
            f"- [{t.priority.value.upper()}] {t.title} (est: {t.estimated_time}h)"
            + (f" | depends on: {', '.join(t.dependencies)}" if t.dependencies else "")
            for t in existing_subtasks
        )
        existing_priority_summary = "\n".join(
            f"- {t.title}: {t.priority.value}"
            for t in existing_subtasks
        )

        # ── 2. Decompose new requirement into incremental subtasks ───────────
        emitter.text(f"**Analysing additional requirement...**\n\n")
        emitter.text(
            f"> Existing plan: {len(existing_subtasks)} tasks — only new tasks will be added.\n\n")

        decompose_system = EXTEND_DECOMPOSE_PROMPT.format(
            existing_tasks_summary=existing_tasks_summary
        ) + lang_suffix

        prompt = (
            f"Existing project: {existing_requirement.title}\n"
            f"Additional requirement: {new_requirement}\n\n"
            "Generate ONLY the new subtasks needed for the additional requirement."
        )
        messages = [
            SystemMessage(content=decompose_system),
            HumanMessage(content=prompt),
        ]

        # Reuse the same incremental JSON streaming approach as _step_decompose
        accumulated: list[str] = []
        obj_buf: list[str] = []
        depth = 0
        in_string = False
        escape_next = False
        raw_items: list[dict] = []
        title_to_id: dict[str, str] = {}
        streaming_new_tasks: list[SubTask] = []

        # Pre-populate existing titles → ids so dependencies resolve correctly
        existing_title_to_id = {t.title: t.id for t in existing_subtasks}

        def on_token(token: str) -> None:
            nonlocal depth, in_string, escape_next
            emitter.text(token)
            accumulated.append(token)

            for ch in token:
                if escape_next:
                    escape_next = False
                    if depth > 0:
                        obj_buf.append(ch)
                    continue
                if ch == '\\' and in_string:
                    escape_next = True
                    if depth > 0:
                        obj_buf.append(ch)
                    continue
                if ch == '"' and depth > 0:
                    in_string = not in_string
                if in_string:
                    if depth > 0:
                        obj_buf.append(ch)
                    continue
                if ch == '{':
                    depth += 1
                    obj_buf.append(ch)
                elif ch == '}' and depth > 0:
                    obj_buf.append(ch)
                    depth -= 1
                    if depth == 0:
                        candidate = "".join(obj_buf)
                        obj_buf.clear()
                        try:
                            item = json.loads(candidate)
                            if isinstance(item, dict) and "title" in item:
                                title = item["title"]
                                if title not in title_to_id:
                                    title_to_id[title] = str(uuid.uuid4())[:8]
                                raw_items.append(item)
                                # Resolve dependency IDs (may include existing tasks)
                                combined_id_map = {
                                    **existing_title_to_id, **title_to_id}
                                dep_ids = [
                                    combined_id_map[d]
                                    for d in item.get("dependencies", [])
                                    if d in combined_id_map
                                ]
                                task = SubTask(
                                    id=title_to_id[title],
                                    title=item["title"],
                                    description=item.get("description", ""),
                                    user_story=item.get("user_story", ""),
                                    acceptance_criteria=item.get(
                                        "acceptance_criteria", []),
                                    technical_notes=item.get(
                                        "technical_notes", ""),
                                    estimated_time=item.get(
                                        "estimated_time", 2),
                                    dependencies=dep_ids,
                                )
                                streaming_new_tasks.append(task)
                                # Emit merged view: existing + new so far
                                emitter.tasks_update(
                                    list(existing_subtasks) + list(streaming_new_tasks))
                        except json.JSONDecodeError:
                            pass
                elif depth > 0:
                    obj_buf.append(ch)

        stream_llm(messages, on_token, temperature=0.2)

        if raw_items:
            new_subtasks = list(streaming_new_tasks)
        else:
            content = strip_code_fence("".join(accumulated))
            try:
                fallback_items = json.loads(content)
            except json.JSONDecodeError:
                fallback_items = []
            combined_id_map = {**existing_title_to_id, **title_to_id}
            new_subtasks = []
            for item in (fallback_items if isinstance(fallback_items, list) else []):
                if "title" not in item:
                    continue
                if item["title"] not in title_to_id:
                    title_to_id[item["title"]] = str(uuid.uuid4())[:8]
                combined_id_map = {**existing_title_to_id, **title_to_id}
                dep_ids = [combined_id_map[d] for d in item.get(
                    "dependencies", []) if d in combined_id_map]
                new_subtasks.append(SubTask(
                    id=title_to_id[item["title"]],
                    title=item["title"],
                    description=item.get("description", ""),
                    user_story=item.get("user_story", ""),
                    acceptance_criteria=item.get("acceptance_criteria", []),
                    technical_notes=item.get("technical_notes", ""),
                    estimated_time=item.get("estimated_time", 2),
                    dependencies=dep_ids,
                ))
            emitter.tasks_update(list(existing_subtasks) + new_subtasks)

        if not new_subtasks:
            emitter.text(
                "\n\n> No new tasks needed — the existing plan already covers this requirement.\n\n")
            emitter.step("decompose", "No new tasks needed")
            # Emit the existing result unchanged
            total_hours = round(
                sum(t.estimated_time for t in existing_subtasks))
            emitter.result({
                "success": True,
                "output": json.dumps({
                    "requirement": existing_requirement.model_dump(),
                    "subtasks": [t.model_dump() for t in existing_subtasks],
                    "total_estimated_hours": total_hours,
                    "adjustment_iterations": 0,
                }, indent=2, default=str),
                "format": "json",
            })
            return

        emitter.text(f"\n\n> {len(new_subtasks)} new task(s) identified\n\n")
        emitter.step("decompose", f"Added {len(new_subtasks)} new subtasks")

        if _check_cancel():
            return

        # ── 3. Prioritize new subtasks ────────────────────────────────────────
        emitter.text("**Assessing priorities for new tasks...**\n\n")
        priority_system = EXTEND_PRIORITY_PROMPT.format(
            existing_priority_summary=existing_priority_summary
        ) + lang_suffix
        task_descriptions = "\n".join(
            f"- {t.title} (est: {t.estimated_time}h, deps: {len(t.dependencies)})"
            for t in new_subtasks
        )
        p_messages = [
            SystemMessage(content=priority_system),
            HumanMessage(
                content=f"Assess priorities for these NEW tasks:\n{task_descriptions}"),
        ]
        p_response = stream_llm(p_messages, emitter.text, temperature=0)
        p_content = strip_code_fence(p_response)
        logger.info("Priority response received: %s", p_content[:500])

        try:
            priority_map = json.loads(p_content)
        except json.JSONDecodeError as e:
            logger.warning(
                "Failed to parse priority response as JSON: %s. Response was: %s", e, p_content[:500])
            priority_map = {}

        valid = {p.value for p in Priority}
        logger.info("Valid priorities: %s, priority_map: %s",
                    valid, priority_map)
        prioritized_new: list[SubTask] = []
        for task in new_subtasks:
            raw = priority_map.get(task.title, "medium").lower()
            logger.info("Task %s: raw priority = %s", task.title, raw)
            if raw not in valid:
                raw = "medium"
            prioritized_new.append(task.model_copy(
                update={"priority": Priority(raw)}))

        emitter.step("prioritize", "Priorities assessed for new tasks")
        logger.info("Priority assessment complete for %d tasks",
                    len(prioritized_new))
        if _check_cancel():
            return

        # ── 4. Allocate resources (continuing schedule from existing plan) ────
        emitter.text("**Allocating resources for new tasks...**\n\n")

        # Find the latest end date from existing tasks to start new tasks after
        latest_existing_end = datetime.now().replace(
            hour=9, minute=0, second=0, microsecond=0)
        for t in existing_subtasks:
            if t.end_date:
                try:
                    end_dt = datetime.strptime(t.end_date, "%Y-%m-%d")
                    if end_dt > latest_existing_end:
                        latest_existing_end = end_dt
                except ValueError:
                    pass

        members = [m.model_copy() for m in team_config.members]
        sorted_new = sorted(
            prioritized_new, key=lambda t: PRIORITY_ORDER.get(t.priority, 2))

        all_task_ids = {t.id: t for t in existing_subtasks}
        existing_end_map = {t.id: (datetime.strptime(
            t.end_date, "%Y-%m-%d") if t.end_date else latest_existing_end) for t in existing_subtasks}

        allocated_new: list[SubTask] = []
        new_end_map: dict[str, datetime] = {}
        has_conflict = False

        for task in sorted_new:
            dep_end = latest_existing_end
            for dep_id in task.dependencies:
                candidate = existing_end_map.get(
                    dep_id) or new_end_map.get(dep_id)
                if candidate and candidate > dep_end:
                    dep_end = candidate

            candidates = sorted(
                members, key=lambda m: m.available_hours, reverse=True)
            best = next(
                (m for m in candidates if m.available_hours >= task.estimated_time), None)
            if best is None:
                best = next(
                    (m for m in candidates if m.available_hours > 0), None)
            if best is None:
                has_conflict = True
                allocated_new.append(task)
                continue

            if best.available_hours < task.estimated_time:
                has_conflict = True

            start = max(dep_end, latest_existing_end)
            work_days = max(1, int((task.estimated_time + 7) // 8))
            end = start + timedelta(days=work_days)
            best.current_load += task.estimated_time
            new_end_map[task.id] = end

            allocated_new.append(task.model_copy(update={
                "assignee": best.role,
                "start_date": start.strftime("%Y-%m-%d"),
                "end_date": end.strftime("%Y-%m-%d"),
            }))

        status = "Conflicts detected" if has_conflict else f"All new tasks assigned"
        emitter.text(f"> {status}\n\n")
        emitter.step("allocate", "Resources allocated for new tasks")

        # ── 5. Emit merged result ─────────────────────────────────────────────
        all_subtasks = list(existing_subtasks) + allocated_new
        emitter.tasks_update(all_subtasks)
        emitter.step("output", "Complete")

        total_hours = round(sum(t.estimated_time for t in all_subtasks))
        emitter.result({
            "success": True,
            "output": json.dumps({
                "requirement": existing_requirement.model_dump(),
                "subtasks": [t.model_dump() for t in all_subtasks],
                "total_estimated_hours": total_hours,
                "adjustment_iterations": 0,
                "extended_with": new_requirement,
                "new_task_count": len(allocated_new),
            }, indent=2, default=str),
            "format": "json",
        })

    except Exception as e:
        import traceback
        logger.error("Extend workflow failed: %s\n%s",
                     e, traceback.format_exc())
        emitter.error(str(e))
    finally:
        emitter.done()
