from langgraph.graph import StateGraph, END

from .state import GraphState
from .nodes.requirement_parser import parse_requirement
from .nodes.task_decomposer import decompose_tasks
from .nodes.priority_assessor import assess_priority
from .nodes.resource_allocator import allocate_resources
from .nodes.adjustment_loop import check_and_adjust
from .nodes.output_summary import generate_output


def _should_adjust(state: GraphState) -> str:
    """
    Determine whether the workflow should loop back for resource adjustment.

    @param state: Current graph state
    @returns: Next node name - either 'adjust' for re-allocation or 'output' to finalize
    """
    has_conflict = state.get("has_conflict", False)
    adjustment_count = state.get("adjustment_count", 0)
    max_adjustments = state.get("max_adjustments", 3)

    if has_conflict and adjustment_count < max_adjustments:
        return "adjust"
    return "output"


def build_workflow() -> StateGraph:
    """
    Build and compile the LangGraph workflow for the AI project manager.

    The workflow follows this pipeline:
    1. Parse requirement (natural language -> structured)
    2. Decompose into subtasks
    3. Assess priority for each subtask
    4. Allocate resources (team members + schedule)
    5. If conflict detected -> adjust and re-allocate (loop)
    6. Generate final output

    @returns: Compiled LangGraph workflow ready for invocation
    """
    graph = StateGraph(GraphState)

    graph.add_node("parse", parse_requirement)
    graph.add_node("decompose", decompose_tasks)
    graph.add_node("prioritize", assess_priority)
    graph.add_node("allocate", allocate_resources)
    graph.add_node("adjust", check_and_adjust)
    graph.add_node("output", generate_output)

    graph.set_entry_point("parse")
    graph.add_edge("parse", "decompose")
    graph.add_edge("decompose", "prioritize")
    graph.add_edge("prioritize", "allocate")

    graph.add_conditional_edges("allocate", _should_adjust, {
        "adjust": "adjust",
        "output": "output",
    })

    graph.add_edge("adjust", "allocate")
    graph.add_edge("output", END)

    return graph.compile()
