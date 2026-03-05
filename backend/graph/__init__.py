from langgraph.types import Command
from .workflow import build_workflow
from .state import GraphState

_workflow = None

def get_workflow():
    global _workflow
    if _workflow is None:
        _workflow = build_workflow()
    return _workflow

def run_workflow_with_interrupt(
    initial_state: dict,
    thread_id: str,
    resume_answers: dict | None = None,
) -> tuple[GraphState | None, dict | None]:
    """
    Run LangGraph workflow, handling interrupt for user clarification.
    
    @param initial_state: Initial state for new workflow
    @param thread_id: Thread ID for checkpointer (session_id)
    @param resume_answers: Answers from user to resume (if recovering from interrupt)
    @returns: Tuple of (final_state, interrupt_data)
        - final_state: None if interrupted
        - interrupt_data: dict with questions if interrupted, None if complete
    """
    workflow = get_workflow()
    config = {"configurable": {"thread_id": thread_id}}
    
    try:
        if resume_answers:
            result = workflow.invoke(
                Command(resume=resume_answers),
                config=config,
            )
        else:
            result = workflow.invoke(initial_state, config=config)
        
        return result, None
        
    except Exception as e:
        from langgraph.errors import NodeInterrupt
        if isinstance(e, NodeInterrupt):
            interrupt_data = e.interrupt
            return None, interrupt_data
        raise

__all__ = ["build_workflow", "get_workflow", "run_workflow_with_interrupt", "GraphState"]
