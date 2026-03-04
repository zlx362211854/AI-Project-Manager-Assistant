import queue
import threading
import time


class StreamEmitter:
    """
    Thread-safe emitter for streaming text chunks and events
    from the workflow to the SSE endpoint via a queue.

    Supports:
    - Blocking clarification requests that pause the workflow
    - Event history replay for reconnecting clients
    - Cancellation signal to terminate orphaned workflow threads
    - Immediate unblock of clarification waits on disconnect
    """

    # Sessions with no active consumer are cleaned up after this many seconds.
    SESSION_TTL = 300

    def __init__(self, session_id: str = ""):
        self._queue: queue.Queue[tuple[str, str | dict | None]] = queue.Queue()
        self.session_id = session_id
        self._answer_event = threading.Event()
        self._answers: dict[str, str | list[str]] = {}

        # Append-only history of every emitted event for replay on reconnect.
        self._history: list[tuple[str, str | dict | None]] = []
        self._history_lock = threading.Lock()

        # Set when the workflow thread should abort (e.g. session cancelled).
        self._cancelled = threading.Event()

        # Set when the workflow is fully done (done/error emitted).
        self._finished = threading.Event()

        # Timestamp of last consumer disconnect; None while connected.
        self._disconnected_at: float | None = None
        self._connected = False

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _emit(self, event_type: str, data: str | dict | None) -> None:
        """Record to history and push to live queue."""
        entry = (event_type, data)
        with self._history_lock:
            self._history.append(entry)
        self._queue.put(entry)

    # ------------------------------------------------------------------
    # Public emit methods
    # ------------------------------------------------------------------

    def text(self, content: str) -> None:
        """Emit a text chunk (for chat-like streaming)."""
        if content:
            self._emit("text", content)

    def step(self, step_name: str, label: str) -> None:
        """Emit a step completion event."""
        self._emit("step", {"step": step_name, "label": label})

    def tasks_update(self, subtasks: list) -> None:
        """Emit a progressive table update with current subtask state."""
        self._emit("tasks_update", [
            t.model_dump() if hasattr(t, "model_dump") else t for t in subtasks
        ])

    def result(self, data: dict) -> None:
        """Emit the final structured result."""
        self._emit("result", data)

    def error(self, message: str) -> None:
        """Emit an error event."""
        self._emit("error", message)

    def done(self) -> None:
        """Signal that the stream is finished."""
        self._emit("done", None)
        self._finished.set()

    def task_processing(self, task_id: str) -> None:
        """Emit an event indicating a specific task is currently being scanned."""
        self._emit("task_processing", {"task_id": task_id})

    def clarification(self, data: dict) -> dict[str, str | list[str]]:
        """
        Emit a clarification request and block until the user answers
        or the session is cancelled.

        @param data: Clarification payload with questions
        @returns: User-provided answers keyed by question id
        """
        self._answer_event.clear()
        self._answers = {}
        data["session_id"] = self.session_id
        self._emit("clarification", data)
        # Poll so we can also react to cancellation without waiting the full timeout.
        while not self._answer_event.wait(timeout=5):
            if self._cancelled.is_set():
                return {}
        return self._answers

    def submit_answers(self, answers: dict[str, str | list[str]]) -> None:
        """
        Called from the API endpoint when the user submits answers.
        Unblocks the workflow thread waiting in clarification().

        @param answers: Map of question_id -> user answer
        """
        self._answers = answers
        self._answer_event.set()

    def cancel(self) -> None:
        """
        Signal the workflow thread to abort.
        Also unblocks any pending clarification wait immediately.
        """
        self._cancelled.set()
        self._answer_event.set()

    @property
    def is_cancelled(self) -> bool:
        """Return True if the workflow has been cancelled."""
        return self._cancelled.is_set()

    @property
    def is_finished(self) -> bool:
        """Return True if the workflow emitted done/error."""
        return self._finished.is_set()

    # ------------------------------------------------------------------
    # Consumer / reconnect helpers
    # ------------------------------------------------------------------

    def on_connect(self) -> None:
        """Mark that a consumer has connected (or reconnected)."""
        self._connected = True
        self._disconnected_at = None

    def on_disconnect(self) -> None:
        """Mark that the consumer disconnected."""
        self._connected = False
        self._disconnected_at = time.monotonic()

    def is_expired(self) -> bool:
        """
        Return True if the session has been disconnected longer than SESSION_TTL
        and the workflow is still running (finished sessions are cleaned up immediately).
        """
        if self._finished.is_set():
            return True
        if self._disconnected_at is None:
            return False
        return (time.monotonic() - self._disconnected_at) > self.SESSION_TTL

    def replay_history(self) -> list[tuple[str, str | dict | None]]:
        """Return a snapshot of all events emitted so far for replay."""
        with self._history_lock:
            return list(self._history)

    def get(self, timeout: float | None = None) -> tuple[str, str | dict | None]:
        """
        Read the next event from the queue (blocking).

        @param timeout: Optional timeout in seconds
        @returns: Tuple of (event_type, data)
        """
        return self._queue.get(timeout=timeout)
