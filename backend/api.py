"""
FastAPI server for the AI Project Manager Assistant.

Provides REST endpoints including SSE streaming for real-time
chat-like text output during workflow execution, with support
for interactive clarification questions.
"""
import asyncio
import json
import uuid
import logging
import threading
import time
from typing import AsyncGenerator

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sse_starlette import EventSourceResponse
from pydantic import BaseModel, Field

from .config.settings import load_team_config, get_settings
from .graph.workflow import build_workflow
from .utils.stream import StreamEmitter
from .graph.streaming import run_streaming_workflow, run_extend_workflow
from .models.task import Requirement, TaskType, SubTask, Priority

logger = logging.getLogger(__name__)

app = FastAPI(
    title="AI Project Manager API",
    description="REST API for the AI Project Manager Assistant",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_sessions: dict[str, StreamEmitter] = {}
_sessions_lock = threading.Lock()


def create_initial_state(
    requirement_text: str,
    output_format: str = "markdown",
    team_config_path: str | None = None,
) -> dict:
    """Build the initial state dict for the LangGraph workflow."""
    settings = get_settings()
    team_config = load_team_config(team_config_path)

    return {
        "raw_input": requirement_text,
        "requirement": None,
        "subtasks": [],
        "team_config": team_config,
        "has_conflict": False,
        "adjustment_count": 0,
        "max_adjustments": settings.max_adjustments,
        "output_format": output_format,
        "final_output": "",
        "error": None,
    }


def run_workflow(
    requirement_text: str,
    output_format: str = "markdown",
    team_config_path: str | None = None,
) -> str:
    """Execute the full AI project manager workflow."""
    initial_state = create_initial_state(
        requirement_text, output_format, team_config_path)
    workflow = build_workflow()
    result = workflow.invoke(initial_state)

    if result.get("error"):
        raise RuntimeError(f"Workflow failed: {result['error']}")

    return result.get("final_output", "")


def _cleanup_sessions() -> None:
    """
    Background thread: periodically remove expired sessions.
    A session is expired when the workflow finished or the client has been
    disconnected longer than StreamEmitter.SESSION_TTL seconds.
    """
    while True:
        time.sleep(60)
        with _sessions_lock:
            expired = [sid for sid, em in _sessions.items() if em.is_expired()]
            for sid in expired:
                _sessions.pop(sid, None)
                logger.debug("Cleaned up expired session %s", sid)


threading.Thread(target=_cleanup_sessions, daemon=True,
                 name="session-cleanup").start()


class RequirementRequest(BaseModel):
    """Request body for processing a requirement."""
    requirement: str = Field(...,
                             description="Natural language requirement text")
    output_format: str = Field(
        default="json", description="Output format: json or markdown")
    language: str = Field(
        default="en", description="Output language: en or zh")
    collect_technical: bool = Field(
        default=False, description="Whether to collect technical implementation details during clarification")


class RequirementResponse(BaseModel):
    """Response body with processed task plan."""
    success: bool
    output: str
    format: str


class TeamConfigResponse(BaseModel):
    """Response body for team configuration."""
    members: list[dict]
    max_adjustment_iterations: int


class ClarifyRequest(BaseModel):
    """Request body for submitting clarification answers."""
    answers: dict[str, str | list[str]] = Field(
        ..., description="Map of question_id to answer (string or list of strings)"
    )


class ExtendRequest(BaseModel):
    """Request body for extending an existing task plan with a new requirement."""
    new_requirement: str = Field(
        ..., description="Additional requirement to add to the existing plan")
    existing_result: dict = Field(
        ..., description="The current ProcessResult JSON (requirement + subtasks + …)")
    language: str = Field(
        default="en", description="Output language: en or zh")


def _make_sse_event(event: str, data: dict | str) -> dict:
    """Format a Server-Sent Event dict for sse-starlette."""
    payload = data if isinstance(data, dict) else {"content": data}
    return {"event": event, "data": payload}


async def _stream_events_async(emitter: StreamEmitter):
    """
    Async SSE event consumer: reads from the emitter queue WITHOUT blocking
    the uvicorn event loop.

    Yields dicts that sse-starlette will serialize automatically.
    """
    loop = asyncio.get_event_loop()
    while True:
        try:
            event_type, data = await loop.run_in_executor(
                None, lambda: emitter.get(timeout=30)
            )
        except Exception:
            yield {"event": "keepalive", "data": {}}
            continue

        if event_type == "done":
            yield {"event": "done", "data": {}}
            break
        elif event_type == "error":
            yield {"event": "error", "data": {"message": data}}
            yield {"event": "done", "data": {}}
            break
        elif event_type == "text":
            yield {"event": "text", "data": {"content": data}}
        elif event_type == "step":
            yield {"event": "step", "data": data}
        elif event_type == "tasks_update":
            yield {"event": "tasks_update", "data": {"tasks": data}}
        elif event_type == "result":
            yield {"event": "result", "data": data}
        elif event_type == "task_processing":
            yield {"event": "task_processing", "data": data}
        elif event_type == "clarification":
            yield {"event": "clarification", "data": data}


async def _generate_sse_async(
    requirement: str,
    output_format: str,
    language: str = "en",
    collect_technical: bool = False,
) -> AsyncGenerator[str, None]:
    """
    Async SSE generator: starts the workflow thread, then drains the emitter
    queue without blocking the event loop.

    @param requirement: Natural language requirement text
    @param output_format: Desired output format
    @param language: Output language (en or zh)
    @param collect_technical: Whether to collect technical implementation details
    @yields: SSE-formatted event strings
    """
    session_id = str(uuid.uuid4())[:12]
    settings = get_settings()
    team_config = load_team_config()
    emitter = StreamEmitter(session_id=session_id)

    with _sessions_lock:
        _sessions[session_id] = emitter

    emitter.on_connect()
    yield _make_sse_event("session", {"session_id": session_id})

    thread = threading.Thread(
        target=run_streaming_workflow,
        args=(requirement, output_format, team_config,
              settings.max_adjustments, emitter, language, collect_technical),
        daemon=True,
    )
    thread.start()

    try:
        async for chunk in _stream_events_async(emitter):
            yield chunk
    finally:
        emitter.on_disconnect()
        logger.debug("Client disconnected from session %s", session_id)


@app.get("/api/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "ok", "service": "ai-project-manager"}


@app.post("/api/process", response_model=RequirementResponse)
def process_requirement(request: RequirementRequest):
    """
    Process a requirement (non-streaming fallback).

    @param request: RequirementRequest with the requirement text
    @returns: RequirementResponse with the generated task plan
    """
    try:
        output = run_workflow(
            requirement_text=request.requirement,
            output_format=request.output_format,
        )
        return RequirementResponse(
            success=True,
            output=output,
            format=request.output_format,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/process/stream")
async def process_requirement_stream(request: RequirementRequest):
    """
    Process a requirement with SSE streaming for chat-like output.
    Uses an async generator so the uvicorn event loop is never blocked
    while waiting for LLM tokens — /api/health and other endpoints
    remain responsive throughout.

    Events:
      - session: {session_id}           -- session identifier for clarification
      - text: {content}                  -- streamed text chunk
      - step: {step, label}              -- a workflow step completed
      - tasks_update: {tasks}            -- progressive task table data
      - clarification: {questions, ...}  -- user input needed
      - result: {output}                 -- final structured JSON result
      - error: {message}                 -- error occurred
      - done: {}                         -- stream complete

    @param request: RequirementRequest
    @returns: SSE EventSourceResponse
    """
    return EventSourceResponse(
        _generate_sse_async(request.requirement, request.output_format,
                            request.language, request.collect_technical),
    )


@app.get("/api/process/stream/resume/{session_id}")
async def resume_stream(session_id: str):
    """
    Reconnect to an existing session and receive a replay of all past events
    followed by any new events as the workflow continues.

    The client should call this instead of starting a new workflow when it
    already has a session_id (e.g. after a network drop).

    @param session_id: Session ID received from the original /stream request
    @returns: SSE EventSourceResponse with history replay + live continuation
    """
    with _sessions_lock:
        emitter = _sessions.get(session_id)

    if emitter is None:
        raise HTTPException(
            status_code=404, detail="Session not found or expired")

    async def _resume_generator() -> AsyncGenerator[str, None]:
        emitter.on_connect()
        try:
            # Replay all events emitted so far (no blocking I/O, just memory).
            history = emitter.replay_history()
            for event_type, data in history:
                if event_type == "done":
                    yield _make_sse_event("done", {})
                    return
                elif event_type == "error":
                    yield _make_sse_event("error", {"message": data})
                    yield _make_sse_event("done", {})
                    return
                elif event_type == "text":
                    yield _make_sse_event("text", {"content": data})
                elif event_type == "step":
                    yield _make_sse_event("step", data)
                elif event_type == "tasks_update":
                    yield _make_sse_event("tasks_update", {"tasks": data})
                elif event_type == "result":
                    yield _make_sse_event("result", data)
                elif event_type == "task_processing":
                    yield _make_sse_event("task_processing", data)
                elif event_type == "clarification":
                    yield _make_sse_event("clarification", data)

            if emitter.is_finished:
                return

            # Continue with live async stream.
            async for chunk in _stream_events_async(emitter):
                yield chunk
        finally:
            emitter.on_disconnect()

    return EventSourceResponse(
        _resume_generator(),
    )


@app.post("/api/process/cancel/{session_id}")
async def cancel_session(session_id: str):
    """
    Cancel an active workflow session.
    Immediately unblocks any pending clarification wait and signals the
    workflow thread to stop at the next checkpoint.

    @param session_id: Active session ID to cancel
    @returns: Confirmation
    """
    with _sessions_lock:
        emitter = _sessions.pop(session_id, None)
    if emitter:
        emitter.cancel()
    return {"status": "cancelled", "session_id": session_id}


@app.post("/api/process/clarify/{session_id}")
async def submit_clarification(session_id: str, request: ClarifyRequest):
    """
    Submit user answers to clarification questions.
    Unblocks the paused workflow thread so it can continue.

    @param session_id: Active streaming session ID
    @param request: ClarifyRequest with answer map
    @returns: Confirmation
    """
    with _sessions_lock:
        emitter = _sessions.get(session_id)
    if not emitter:
        raise HTTPException(
            status_code=404, detail="Session not found or expired")

    emitter.submit_answers(request.answers)
    return {"status": "ok", "session_id": session_id}


@app.get("/api/team", response_model=TeamConfigResponse)
async def get_team_config():
    """Get the current team configuration."""
    config = load_team_config()
    return TeamConfigResponse(
        members=[m.model_dump() for m in config.members],
        max_adjustment_iterations=config.max_adjustment_iterations,
    )


@app.post("/api/process/extend/stream")
async def extend_requirement_stream(request: ExtendRequest):
    """
    Extend an existing completed task plan with additional requirements.

    Accepts the full current ProcessResult plus a new natural-language requirement.
    Runs an incremental workflow that generates ONLY the new tasks, then merges
    them with the existing plan and streams the result back via SSE.

    Uses an async generator to keep the event loop unblocked.

    @param request: ExtendRequest with new_requirement and existing_result
    @returns: SSE EventSourceResponse with merged task plan
    """
    existing_result = request.existing_result
    existing_subtask_dicts = existing_result.get("subtasks", [])
    existing_req_dict = existing_result.get("requirement", {})

    try:
        task_type = existing_req_dict.get("type", "feature")
        if task_type not in [t.value for t in TaskType]:
            task_type = "feature"
        existing_requirement = Requirement(
            title=existing_req_dict.get("title", "Untitled"),
            description=existing_req_dict.get("description", ""),
            type=TaskType(task_type),
            estimated_time=existing_req_dict.get("estimated_time"),
        )
        existing_subtasks = [
            SubTask(
                id=t.get("id", ""),
                title=t.get("title", ""),
                description=t.get("description", ""),
                user_story=t.get("user_story", ""),
                acceptance_criteria=t.get("acceptance_criteria", []),
                technical_notes=t.get("technical_notes", ""),
                estimated_time=t.get("estimated_time", 2),
                priority=Priority(t.get("priority", "medium")),
                assignee=t.get("assignee"),
                start_date=t.get("start_date"),
                end_date=t.get("end_date"),
                dependencies=t.get("dependencies", []),
            )
            for t in existing_subtask_dicts
        ]
    except Exception as e:
        raise HTTPException(
            status_code=422, detail=f"Invalid existing_result: {e}")

    settings = get_settings()
    team_config = load_team_config()

    async def _generate_extend_sse_async() -> AsyncGenerator[str, None]:
        session_id = str(uuid.uuid4())[:12]
        emitter = StreamEmitter(session_id=session_id)
        with _sessions_lock:
            _sessions[session_id] = emitter
        emitter.on_connect()
        yield _make_sse_event("session", {"session_id": session_id})

        thread = threading.Thread(
            target=run_extend_workflow,
            args=(
                request.new_requirement,
                existing_subtasks,
                existing_requirement,
                team_config,
                settings.max_adjustments,
                emitter,
                request.language,
            ),
            daemon=True,
        )
        thread.start()

        try:
            async for chunk in _stream_events_async(emitter):
                yield chunk
        finally:
            emitter.on_disconnect()

    return EventSourceResponse(
        _generate_extend_sse_async(),
    )
